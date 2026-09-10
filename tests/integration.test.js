import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.MONGOMS_DOWNLOAD_DIR ||= fileURLToPath(new URL("../.mongodb-binaries", import.meta.url));
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
    M = await import("../server/src/models.js");
    await Promise.all(Object.values(M).map((m) => m.init()));
    await M.User.create({
      email,
      passwordHash: await bcrypt.hash(password, 4),
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

