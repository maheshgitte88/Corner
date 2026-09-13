import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.MONGOMS_DOWNLOAD_DIR ||= fileURLToPath(
  new URL("../.mongodb-binaries", import.meta.url),
);
let repl, app, M, admin;
const email = "test@example.com",
  password = randomBytes(20).toString("hex");
before(
  async () => {
    process.env.JWT_SECRET = randomBytes(48).toString("hex");
    process.env.NODE_ENV = "test";
    repl = await MongoMemoryReplSet.create({
      binary: { version: "8.0.12" },
      replSet: { count: 1 },
      instanceOpts: [{ storageEngine: "wiredTiger" }],
    });
    process.env.MONGODB_URI = repl.getUri("counter-test");
    const { connect } = await import("../server/src/config.js");
    await connect();
    const legacy = await import("../server/src/models.js");
    const platform = await import("../server/src/platform-models.js");
    await Promise.all(
      [...Object.values(legacy), ...Object.values(platform)]
        .filter((m) => typeof m?.init === "function")
        .map((m) => m.init()),
    );
    const plan = await platform.Package.create({
      name: "Test",
      monthlyPrice: 100,
      yearlyPrice: 1000,
      maxProducts: 1000,
      maxUsers: 5,
      reportsEnabled: true,
      imagesEnabled: true,
    });
    const tenant = await platform.Tenant.create({
      name: "Test shop",
      slug: "test-shop",
      ownerEmail: email,
      subscription: {
        planId: plan.id,
        planSnapshot: plan.toObject(),
        cycle: "monthly",
        state: "active",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86400000),
      },
    });
    M = await (
      await import("../server/src/tenant-db.js")
    ).readyTenant(tenant.id);
    await legacy.User.create({
      email,
      passwordHash: await bcrypt.hash(password, 4),
      tenantId: tenant.id,
      role: "client_admin",
    });
    await M.ShopSettings.create({
      shopName: "Test Shop",
      invoicePrefix: "TEST",
    });
    ({ app } = await import("../server/src/app.js"));
    admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email, password }).expect(200);
  },
  { timeout: 240000 },
);
after(async () => {
  await mongoose.disconnect();
  if (repl) await repl.stop();
});
const product = async (stock = 10, unit = "pcs") =>
  (
    await admin
      .post("/api/products")
      .send({
        name: "Test product",
        sku: randomUUID(),
        sellingPrice: 10000,
        stockQuantity: stock,
        taxPercent: 5,
        unit,
      })
      .expect(201)
  ).body;
const sale = (p, quantity = 1) => ({
  idempotencyKey: randomUUID(),
  items: [{ productId: p._id, quantity, discount: 0 }],
  amountPaid: 50000,
  paymentMethod: "Cash",
});
test("management authentication, login and validation", async () => {
  await request(app).get("/api/products").expect(401);
  await request(app)
    .post("/api/auth/login")
    .send({ email, password: "wrong" })
    .expect(401);
  await admin.get("/api/products/not-an-id").expect(400);
  await admin.post("/api/products").send({ name: "No SKU" }).expect(400);
  await admin
    .post("/api/products")
    .set("Origin", "https://evil.example")
    .send({})
    .expect(403);
});
test("product, sale, snapshots, cancellation and reprint retain consistent history", async () => {
  const p = await product();
  const input = sale(p, 2);
  const { body: i } = await admin
    .post("/api/invoices")
    .send({ ...input, grandTotal: 1 })
    .expect(201);
  assert.equal(i.grandTotal, 21000);
  assert.equal(i.customerSnapshot.name, "Walk-in Customer");
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 8);
  assert.equal(
    await M.InventoryTransaction.countDocuments({ productId: p._id }),
    2,
  );
  const duplicate = await admin
    .post("/api/invoices")
    .send({ ...input, grandTotal: 1 })
    .expect(201);
  assert.equal(duplicate.body._id, i._id);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 8);
  await admin
    .post("/api/invoices")
    .send({ ...input, amountPaid: 1 })
    .expect(409);
  await admin
    .put("/api/products/" + p._id)
    .send({ ...p, name: "Renamed", sellingPrice: 20000, stockQuantity: 999 })
    .expect(200);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 8);
  const saved = (await admin.get("/api/invoices/" + i._id).expect(200)).body;
  assert.equal(saved.status, "Completed");
  assert.match(saved.shareUrl, /\/b\//);
  const token = saved.shareUrl.split("/b/")[1];
  await request(app).get("/api/public/invoices/" + token).expect(200);
  assert.equal(saved.items[0].unitPrice, 10000);
  assert.equal(saved.items[0].productName, "Test product");
  await admin
    .post("/api/invoices/" + i._id + "/cancel")
    .send({ reason: "Customer returned the full bill" })
    .expect(200);
  await admin
    .post("/api/invoices/" + i._id + "/cancel")
    .send({ reason: "Repeat cancel" })
    .expect(409);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 10);
  assert.equal(
    await M.InventoryTransaction.countDocuments({ productId: p._id }),
    3,
  );
  assert.equal((await M.Invoice.findById(i._id)).status, "Cancelled");
});
test("insufficient stock rolls back invoice and every line movement", async () => {
  const p = await product(5),
    q = await product(1);
  const input = sale(p, 3);
  input.items.push({ productId: q._id, quantity: 2 });
  const before = await M.Invoice.countDocuments();
  await admin.post("/api/invoices").send(input).expect(409);
  assert.equal(await M.Invoice.countDocuments(), before);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 5);
  assert.equal(
    await M.InventoryTransaction.countDocuments({ productId: p._id }),
    1,
  );
});
test("concurrent sales cannot oversell the last unit", async () => {
  const p = await product(1);
  const results = await Promise.all([
    admin.post("/api/invoices").send(sale(p)),
    admin.post("/api/invoices").send(sale(p)),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 0);
  assert.equal(
    await M.InventoryTransaction.countDocuments({
      productId: p._id,
      transactionType: "Sale",
    }),
    1,
  );
});
test("simultaneous identical checkout requests deduct once", async () => {
  const p = await product(4),
    input = sale(p, 2);
  const results = await Promise.all([
    admin.post("/api/invoices").send(input),
    admin.post("/api/invoices").send(input),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  assert.equal(results[0].body._id, results[1].body._id);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 2);
});
test("stock adjustment audit and weighted quantities", async () => {
  const p = await product(5, "kg");
  await admin
    .patch("/api/products/" + p._id + "/stock")
    .send({ type: "Damaged", quantity: 0.5, note: "Packaging damage" })
    .expect(200);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 4.5);
  await admin
    .patch("/api/products/" + p._id + "/stock")
    .send({ type: "Stock Reduced", quantity: 100, note: "Invalid reduction" })
    .expect(409);
  await admin.post("/api/invoices").send(sale(p, 2.5)).expect(201);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 2);
  const whole = await product(3);
  await admin.post("/api/invoices").send(sale(whole, 1.5)).expect(400);
  await admin
    .patch("/api/products/" + whole._id + "/stock")
    .send({ type: "Stock Added", quantity: 0.5, note: "Invalid unit" })
    .expect(400);
});
test("category, customer, settings and report endpoints are integrated", async () => {
  const { body: c } = await admin
    .post("/api/categories")
    .send({ name: "Test category" })
    .expect(201);
  const { body: p } = await admin
    .post("/api/products")
    .send({
      name: "Categorised",
      sku: randomUUID(),
      category: c._id,
      sellingPrice: 100,
      stockQuantity: 2,
    })
    .expect(201);
  await admin.delete("/api/categories/" + c._id).expect(409);
  const { body: customer } = await admin
    .post("/api/customers")
    .send({ name: "Regular customer", email: "regular@example.com" })
    .expect(201);
  const input = sale(p);
  input.customerId = customer._id;
  const { body: i } = await admin.post("/api/invoices").send(input).expect(201);
  assert.equal(i.customerSnapshot.name, "Regular customer");
  await admin.get("/api/reports/sales").expect(200);
  await admin.get("/api/dashboard").expect(200);
  await admin.get("/api/invoices?from=invalid").expect(400);
  await admin.get("/api/settings").expect(200);
  await admin
    .post("/api/upload/product-image")
    .attach("image", Buffer.from("not an image"), {
      filename: "bad.png",
      contentType: "image/png",
    })
    .expect(400);
  await admin.delete("/api/products/" + p._id).expect(200);
  await admin.post("/api/invoices").send(sale(p)).expect(409);
});

test("a failure after an invoice and stock write rolls back everything", async () => {
  const p = await product(8);
  const input = sale(p, 2);
  const original = M.InventoryTransaction.create;
  M.InventoryTransaction.create = async () => {
    throw new Error("Simulated ledger storage failure");
  };
  try {
    await admin.post("/api/invoices").send(input).expect(500);
  } finally {
    M.InventoryTransaction.create = original;
  }
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 8);
  assert.equal(
    await M.Invoice.countDocuments({ idempotencyKey: input.idempotencyKey }),
    0,
  );
  assert.equal(
    await M.InventoryTransaction.countDocuments({ productId: p._id }),
    1,
  );
});

test("simultaneous cancellations restore stock once", async () => {
  const p = await product(5);
  const { body: invoice } = await admin
    .post("/api/invoices")
    .send(sale(p, 2))
    .expect(201);
  const results = await Promise.all([
    admin
      .post(`/api/invoices/${invoice._id}/cancel`)
      .send({ reason: "Full return" }),
    admin
      .post(`/api/invoices/${invoice._id}/cancel`)
      .send({ reason: "Full return" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await M.Product.findById(p._id)).stockQuantity, 5);
  assert.equal(
    await M.InventoryTransaction.countDocuments({
      productId: p._id,
      transactionType: "Cancellation",
    }),
    1,
  );
});

test("parent with variants sells by variant id and snapshots label", async () => {
  const { body: family } = await admin
    .post("/api/products")
    .send({
      name: "Water Bottle",
      variants: [
        {
          variantLabel: "500 ml",
          sku: "WB-500-" + randomUUID().slice(0, 8),
          sellingPrice: 2000,
          stockQuantity: 5,
          unit: "pcs",
          minimumStock: 2,
        },
        {
          variantLabel: "1 L",
          sku: "WB-1L-" + randomUUID().slice(0, 8),
          sellingPrice: 3500,
          stockQuantity: 8,
          unit: "pcs",
          minimumStock: 2,
        },
      ],
    })
    .expect(201);
  assert.equal(family.kind, "parent");
  assert.equal(family.variants.length, 2);
  const half = family.variants.find((v) => v.variantLabel === "500 ml");
  await admin.post("/api/invoices").send(sale(family)).expect(409);
  const { body: invoice } = await admin
    .post("/api/invoices")
    .send(sale(half, 1))
    .expect(201);
  assert.equal(invoice.items[0].variantLabel, "500 ml");
  assert.equal(invoice.items[0].productName, "Water Bottle");
  assert.equal((await M.Product.findById(half._id)).stockQuantity, 4);
  assert.equal((await M.Product.findById(family._id)).kind, "parent");
});

test("dashboard and reports expose near-expiry sellable stock", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const near = new Date(`${today}T12:00:00+05:30`);
  near.setUTCDate(near.getUTCDate() + 10);
  const nearDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(near);
  const { body: p } = await admin
    .post("/api/products")
    .send({
      name: "Milk pack",
      sku: "MILK-" + randomUUID().slice(0, 8),
      sellingPrice: 5000,
      stockQuantity: 4,
      minimumStock: 1,
      unit: "pcs",
      expiryFrom: today,
      expiryTo: nearDate,
    })
    .expect(201);
  const { body: dash } = await admin.get("/api/dashboard").expect(200);
  assert.ok(dash.nearExpiry.some((row) => row._id === p._id));
  assert.ok(dash.nearExpiry.every((row) => row.kind !== "parent"));
  const { body: report } = await admin.get("/api/reports/sales").expect(200);
  assert.ok(report.nearExpiry.some((row) => row._id === p._id));
});

test("expiry date today counts as expired stock", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const { body: p } = await admin
    .post("/api/products")
    .send({
      name: "Today expiry",
      sku: "EXP-" + randomUUID().slice(0, 8),
      sellingPrice: 1000,
      stockQuantity: 3,
      minimumStock: 1,
      unit: "pcs",
      expiryFrom: today,
      expiryTo: today,
    })
    .expect(201);
  const { body: dash } = await admin.get("/api/dashboard").expect(200);
  assert.ok(dash.expired.some((row) => row._id === p._id));
  assert.ok(!dash.nearExpiry.some((row) => row._id === p._id));
});
