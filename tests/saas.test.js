import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
process.env.MONGOMS_DOWNLOAD_DIR = fileURLToPath(
  new URL("../.mongodb-binaries", import.meta.url),
);
let repl, app, P, U, admin, modelsFor, clientA, clientB, tenantA, tenantB, plan;
const password = randomBytes(20).toString("hex"),
  newPassword = randomBytes(20).toString("hex");
const onboarding = (overrides = {}) => ({
  name: "Client " + randomUUID().slice(0, 6),
  slug: "shop-" + randomUUID(),
  ownerName: "Shop Owner",
  ownerEmail: randomUUID() + "@example.com",
  ownerPassword: password,
  planId: plan._id,
  cycle: "monthly",
  paymentMethod: "Bank Transfer",
  paymentReference: "Bank ref 123",
  note: "Test activation",
  idempotencyKey: randomUUID(),
  trialDays: 0,
  ...overrides,
});
async function createClient(overrides = {}) {
  const input = onboarding(overrides);
  const result = await admin
    .post("/api/platform/clients")
    .send(input)
    .expect(201);
  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ email: input.ownerEmail, password })
    .expect(200);
  await agent.get("/api/products").expect(403);
  await agent
    .post("/api/auth/password")
    .send({ currentPassword: password, newPassword })
    .expect(200);
  await agent
    .post("/api/auth/login")
    .send({ email: input.ownerEmail, password: newPassword })
    .expect(200);
  return { tenant: result.body, agent, input };
}
const productData = (sku = "SHARED-SKU") => ({
  name: "Private product",
  sku,
  sellingPrice: 10000,
  stockQuantity: 10,
});
const sale = (p) => ({
  idempotencyKey: randomUUID(),
  items: [{ productId: p._id, quantity: 1 }],
  amountPaid: 10000,
  paymentMethod: "Cash",
});
before(
  async () => {
    process.env.JWT_SECRET = randomBytes(48).toString("hex");
    process.env.NODE_ENV = "test";
    repl = await MongoMemoryReplSet.create({
      binary: { version: "8.0.12" },
      replSet: { count: 1 },
    });
    process.env.MONGODB_URI = repl.getUri("saas-test");
    await (await import("../server/src/config.js")).connect();
    P = await import("../server/src/platform-models.js");
    const legacy = await import("../server/src/models.js");
    U = legacy.User;
    await Promise.all(
      [...Object.values(P), ...Object.values(legacy)]
        .filter((m) => typeof m?.init === "function")
        .map((m) => m.init()),
    );
    const tenantDb = await import("../server/src/tenant-db.js");
    modelsFor = tenantDb.readyTenant;
    assert.ok(
      tenantDb.tenantDatabaseName("aaaaaaaaaaaaaaaaaaaaaaaa").length <= 38,
    );
    await U.create({
      email: "platform@test.local",
      passwordHash: await bcrypt.hash(password, 4),
      role: "platform_admin",
    });
    ({ app } = await import("../server/src/app.js"));
    admin = request.agent(app);
    await admin
      .post("/api/auth/login")
      .send({ email: "platform@test.local", password })
      .expect(200);
    ({ body: plan } = await admin
      .post("/api/platform/packages")
      .send({
        name: "Growth",
        description: "Test plan",
        monthlyPrice: 99900,
        yearlyPrice: 999000,
        maxProducts: 100,
        maxUsers: 3,
        reportsEnabled: true,
        imagesEnabled: true,
      })
      .expect(201));
    const a = await createClient(),
      b = await createClient();
    tenantA = a.tenant;
    clientA = a.agent;
    tenantB = b.tenant;
    clientB = b.agent;
  },
  { timeout: 240000 },
);
after(async () => {
  await mongoose.disconnect();
  if (repl) await repl.stop();
});
test("onboarding creates client, owner, isolated settings and payment atomically", async () => {
  const detail = (
    await admin.get("/api/platform/clients/" + tenantA._id).expect(200)
  ).body;
  assert.equal(detail.members.length, 1);
  assert.equal(detail.payments.length, 1);
  assert.equal(detail.payments[0].amount, 99900);
  assert.equal(detail.usage.products, 0);
  assert.equal(
    (await clientA.get("/api/settings").expect(200)).body.shopName,
    tenantA.name,
  );
  await clientA.get("/api/platform/clients").expect(403);
  await clientA.post("/api/platform/packages").send({}).expect(403);
  await admin.get("/api/products").expect(403);
});
test("tenant A cannot read or mutate tenant B through any record ID", async () => {
  const { body: a } = await clientA
      .post("/api/products")
      .send(productData())
      .expect(201),
    { body: b } = await clientB
      .post("/api/products")
      .send(productData())
      .expect(201);
  assert.notEqual(a._id, b._id);
  assert.equal(
    (
      await clientA
        .get("/api/products")
        .set("X-Tenant-ID", tenantB._id)
        .query({ tenantId: tenantB._id })
        .expect(200)
    ).body.length,
    1,
  );
  await clientA.get("/api/products/" + b._id).expect(404);
  await clientA
    .put("/api/products/" + b._id)
    .send(productData())
    .expect(404);
  await clientA
    .patch("/api/products/" + b._id + "/stock")
    .send({ type: "Correction", quantity: 100, note: "Cross tenant" })
    .expect(404);
  await clientA.delete("/api/products/" + b._id).expect(404);
  await clientA.post("/api/invoices").send(sale(b)).expect(409);
  const { body: category } = await clientB
    .post("/api/categories")
    .send({ name: "Private category" })
    .expect(201);
  await clientA
    .post("/api/products")
    .send({ ...productData("CATEGORY"), category: category._id })
    .expect(400);
  const { body: customer } = await clientB
    .post("/api/customers")
    .send({ name: "Private customer" })
    .expect(201);
  await clientA
    .put("/api/customers/" + customer._id)
    .send({ name: "Changed" })
    .expect(404);
  await clientA
    .post("/api/invoices")
    .send({ ...sale(a), customerId: customer._id })
    .expect(404);
  const { body: invoiceB } = await clientB
    .post("/api/invoices")
    .send(sale(b))
    .expect(201);
  const { body: invoiceA } = await clientA
    .post("/api/invoices")
    .send(sale(a))
    .expect(201);
  assert.equal(invoiceA.invoiceNumber, invoiceB.invoiceNumber);
  assert.match(invoiceA.shareUrl, /\/b\//);
  const publicToken = invoiceA.shareUrl.split("/b/")[1];
  const { body: publicInvoice } = await request(app)
    .get("/api/public/invoices/" + publicToken)
    .expect(200);
  assert.equal(publicInvoice.invoiceNumber, invoiceA.invoiceNumber);
  assert.equal(publicInvoice.idempotencyKey, undefined);
  await request(app)
    .get("/api/public/invoices/notfoundtokenvalue12")
    .expect(404);
  await clientA.get("/api/invoices/" + invoiceB._id).expect(404);
  await clientA
    .post("/api/invoices/" + invoiceB._id + "/cancel")
    .send({ reason: "Cross tenant" })
    .expect(404);
  assert.equal(
    (
      await clientA
        .get("/api/inventory/transactions?productId=" + b._id)
        .expect(200)
    ).body.length,
    0,
  );
  assert.equal(
    (await clientA.get("/api/reports/sales").expect(200)).body.count,
    1,
  );
  const sub = (await clientA.get("/api/subscription").expect(200)).body;
  assert.ok(sub.payments.every((p) => p.tenantId === tenantA._id));
});
test("duplicate onboarding and duplicate owner email cannot create partial clients", async () => {
  const input = onboarding();
  const [a, b] = await Promise.all([
    admin.post("/api/platform/clients").send(input),
    admin.post("/api/platform/clients").send(input),
  ]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.equal(a.body._id, b.body._id);
  assert.equal(
    await P.SubscriptionPayment.countDocuments({
      idempotencyKey: input.idempotencyKey,
    }),
    1,
  );
  const before = await P.Tenant.countDocuments();
  await admin
    .post("/api/platform/clients")
    .send(onboarding({ ownerEmail: tenantA.ownerEmail }))
    .expect(409);
  assert.equal(await P.Tenant.countDocuments(), before);
});
test("expiry and suspension block writes but preserve history and renewal access", async () => {
  await P.Tenant.updateOne(
    { _id: tenantA._id },
    { $set: { "subscription.endsAt": new Date(Date.now() - 1000) } },
  );
  await clientA.post("/api/products").send(productData("EXPIRED")).expect(403);
  await clientA.post("/api/invoices").send({}).expect(403);
  await clientA.get("/api/invoices").expect(200);
  assert.equal(
    (await clientA.get("/api/subscription").expect(200)).body.access,
    "expired",
  );
  await P.Tenant.updateOne(
    { _id: tenantA._id },
    {
      $set: {
        "subscription.endsAt": new Date(Date.now() + 86400000),
        status: "suspended",
      },
    },
  );
  await clientA.put("/api/settings").send({}).expect(403);
  await clientA.get("/api/settings").expect(200);
  await P.Tenant.updateOne(
    { _id: tenantA._id },
    { $set: { status: "active" } },
  );
});
test("monthly renewal is idempotent, concurrent stale renewals conflict, receipts snapshot prices", async () => {
  const tenant = await P.Tenant.findById(tenantA._id),
    original = new Date(tenant.subscription.endsAt);
  const input = {
    planId: plan._id,
    cycle: "monthly",
    mode: "extend",
    revision: tenant.revision,
    paymentMethod: "UPI",
    paymentReference: "renewal 123",
    note: "",
    idempotencyKey: randomUUID(),
  };
  const [a, b] = await Promise.all([
    admin.post(`/api/platform/clients/${tenant.id}/renew`).send(input),
    admin.post(`/api/platform/clients/${tenant.id}/renew`).send(input),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(a.body._id, b.body._id);
  const { addPeriod } = await import("../server/src/saas-services.js");
  assert.equal(
    new Date(a.body.periodEnd).toISOString(),
    addPeriod(original, "monthly").toISOString(),
  );
  await admin
    .post(`/api/platform/clients/${tenant.id}/renew`)
    .send({ ...input, idempotencyKey: randomUUID() })
    .expect(409);
  await admin
    .put("/api/platform/packages/" + plan._id)
    .send({ ...plan, monthlyPrice: 123400 })
    .expect(200);
  assert.equal(
    (await P.SubscriptionPayment.findById(a.body._id)).amount,
    99900,
  );
  assert.equal(
    (await P.Tenant.findById(tenant.id)).subscription.planSnapshot.monthlyPrice,
    99900,
  );
});
test("calendar periods clamp month end and leap-day annual renewal", async () => {
  const { addPeriod } = await import("../server/src/saas-services.js");
  assert.equal(
    addPeriod("2026-01-31T12:00:00Z", "monthly").toISOString(),
    "2026-02-28T12:00:00.000Z",
  );
  assert.equal(
    addPeriod("2024-02-29T12:00:00Z", "yearly").toISOString(),
    "2025-02-28T12:00:00.000Z",
  );
});
test("product quotas remain enforced under concurrent creates and plan features are gated", async () => {
  const { body: small } = await admin
    .post("/api/platform/packages")
    .send({
      name: "Small",
      monthlyPrice: 100,
      yearlyPrice: 1000,
      maxProducts: 1,
      maxUsers: 1,
      reportsEnabled: false,
      imagesEnabled: false,
    })
    .expect(201);
  const c = await createClient({ planId: small._id });
  const results = await Promise.all([
    c.agent.post("/api/products").send(productData("ONE")),
    c.agent.post("/api/products").send(productData("TWO")),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 403]);
  await c.agent.get("/api/reports/sales").expect(403);
  await c.agent.post("/api/upload/product-image").expect(403);
  await c.agent
    .post("/api/team")
    .send({
      name: "Staff",
      email: randomUUID() + "@example.com",
      password,
      role: "cashier",
    })
    .expect(403);
  const p = (await c.agent.get("/api/products")).body[0];
  await c.agent.delete("/api/products/" + p._id).expect(200);
  await c.agent.post("/api/products").send(productData("NEW")).expect(201);
  await c.agent
    .put("/api/products/" + p._id)
    .send({ ...p, isActive: true })
    .expect(403);
});
test("cashier permissions, temporary password changes and revocation are enforced", async () => {
  const email = randomUUID() + "@example.com";
  await clientA
    .post("/api/team")
    .send({ name: "Cashier", email, password, role: "cashier" })
    .expect(201);
  const cashier = request.agent(app);
  await cashier.post("/api/auth/login").send({ email, password }).expect(200);
  await cashier.get("/api/products").expect(403);
  await cashier
    .post("/api/auth/password")
    .send({ currentPassword: password, newPassword })
    .expect(200);
  await cashier.get("/api/auth/me").expect(401);
  await cashier
    .post("/api/auth/login")
    .send({ email, password: newPassword })
    .expect(200);
  await cashier.get("/api/products").expect(200);
  await cashier.get("/api/settings").expect(200);
  await cashier.get("/api/team").expect(403);
  await cashier.post("/api/products").send(productData()).expect(403);
  await cashier.get("/api/platform/overview").expect(403);
  const p = (await cashier.get("/api/products")).body[0];
  const { body: invoice } = await cashier
    .post("/api/invoices")
    .send(sale(p))
    .expect(201);
  await cashier
    .post("/api/invoices/" + invoice._id + "/cancel")
    .send({ reason: "No permission" })
    .expect(403);
  const member = await U.findOne({ email });
  await clientB
    .patch("/api/team/" + member.id)
    .send({ isActive: false })
    .expect(404);
  await clientA
    .patch("/api/team/" + member.id)
    .send({ isActive: false })
    .expect(200);
  await cashier.get("/api/products").expect(401);
});
test("package replacement refuses unsafe downgrades and archived packages", async () => {
  const t = await P.Tenant.findById(tenantA._id),
    small = await P.Package.findOne({ name: "Small" });
  const input = {
    planId: small.id,
    cycle: "yearly",
    mode: "replace",
    revision: t.revision,
    paymentMethod: "Cash",
    paymentReference: "downgrade",
    note: "",
    idempotencyKey: randomUUID(),
  };
  await clientA.post("/api/products").send(productData("SECOND")).expect(201);
  await admin
    .post(`/api/platform/clients/${t.id}/renew`)
    .send(input)
    .expect(409);
  await P.Package.updateOne({ _id: small.id }, { $set: { isActive: false } });
  await admin
    .post("/api/platform/clients")
    .send(onboarding({ planId: small.id }))
    .expect(400);
});
test("platform password reset revokes sessions, requires change, and never reveals credentials", async () => {
  const member = await U.findOne({ email: tenantB.ownerEmail });
  const response = await admin
    .post(`/api/platform/clients/${tenantB._id}/reset-password`)
    .send({ userId: member.id, password })
    .expect(200);
  assert.deepEqual(response.body, { ok: true });
  await clientB.get("/api/auth/me").expect(401);
  const detail = (await admin.get("/api/platform/clients/" + tenantB._id)).body;
  assert.ok(detail.members.every((m) => !("passwordHash" in m)));
  await admin.get("/api/platform/overview").expect(200);
  await admin.get("/api/platform/audit").expect(200);
});

test("feature and role guards cannot be bypassed with differently cased routes", async () => {
  const member = await U.findOne({ tenantId: tenantA._id, role: "cashier" });
  await U.updateOne({ _id: member.id }, { $set: { isActive: true } });
  const cashier = request.agent(app);
  await cashier
    .post("/api/auth/login")
    .send({ email: member.email, password: newPassword })
    .expect(200);
  await cashier.get("/api/TEAM").expect(403);
  await cashier.get("/api/REPORTS/sales").expect(403);
});

test("legacy migration copies retail records and preserves source data and passwords", async () => {
  const { spawn } = await import("node:child_process");
  const legacy = await import("../server/src/models.js");
  const email = "legacy-owner@example.com";
  const passwordHash = await bcrypt.hash(password, 4);
  const { insertedId } = await U.collection.insertOne({
    email,
    passwordHash,
    role: "admin",
  });
  const p = await legacy.Product.create(productData("LEGACY"));
  await legacy.ShopSettings.create({ shopName: "Original legacy shop" });
  await legacy.Counter.create({ key: "invoice-2026", value: 42 });
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/migrate-legacy.js"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          ...process.env,
          MIGRATION_OWNER_EMAIL: email,
          MIGRATION_CLIENT_NAME: "Migrated Shop",
          MIGRATION_CLIENT_SLUG: "migrated-shop",
          MIGRATION_PACKAGE_NAME: "Growth",
        },
        windowsHide: true,
      });
      let output = "";
      child.stdout.on("data", (b) => (output += b));
      child.stderr.on("data", (b) => (output += b));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
  const result = await run();
  assert.equal(result.code, 0, result.output);
  const tenant = await P.Tenant.findOne({ slug: "migrated-shop" }),
    models = await modelsFor(tenant.id);
  assert.equal((await models.Product.findById(p.id)).sku, "LEGACY");
  assert.equal((await models.Counter.findOne()).value, 42);
  assert.equal(await legacy.Product.countDocuments(), 1);
  const user = await U.findById(insertedId);
  assert.equal(String(user.tenantId), tenant.id);
  assert.equal(user.passwordHash, passwordHash);
  assert.equal(user.mustChangePassword, true);
  assert.equal((await run()).code, 1);
  assert.equal(await P.Tenant.countDocuments({ slug: "migrated-shop" }), 1);
});
