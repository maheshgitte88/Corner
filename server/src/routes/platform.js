import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
  Tenant,
  Package,
  SubscriptionPayment,
  AuditEvent,
} from "../platform-models.js";
import { User } from "../models.js";
import { id, fail } from "../validations.js";
import {
  packageInput,
  onboardInput,
  renewInput,
  password,
} from "../saas-validations.js";
import { onboard, renew, accessStatus, audit } from "../saas-services.js";
import { readyTenant } from "../tenant-db.js";
const router = Router();
router.param("id", (req, res, next, value) => {
  try {
    id.parse(value);
    next();
  } catch {
    next(fail("Invalid record ID"));
  }
});
router.get("/overview", async (req, res) => {
  const clients = await Tenant.find().lean(),
    payments = await SubscriptionPayment.find()
      .select("-requestHash -idempotencyKey")
      .sort({ createdAt: -1 })
      .lean();
  const active = clients.filter((t) => accessStatus(t) === "active");
  res.json({
    clients: clients.length,
    active: active.length,
    trials: clients.filter((t) => accessStatus(t) === "trial").length,
    expired: clients.filter((t) => accessStatus(t) === "expired").length,
    suspended: clients.filter((t) => t.status === "suspended").length,
    collected: payments.reduce((s, p) => s + p.amount, 0),
    mrr: active.reduce(
      (s, t) =>
        s +
        Math.round(
          t.subscription.planSnapshot[t.subscription.cycle + "Price"] /
            (t.subscription.cycle === "yearly" ? 12 : 1),
        ),
      0,
    ),
    expiring: clients.filter(
      (t) =>
        t.status === "active" &&
        new Date(t.subscription.endsAt) > new Date() &&
        new Date(t.subscription.endsAt) < new Date(Date.now() + 7 * 86400000),
    ),
    recentPayments: payments.slice(0, 6),
  });
});
router.get("/packages", async (req, res) =>
  res.json(await Package.find().sort({ monthlyPrice: 1 })),
);
router.post("/packages", async (req, res) => {
  const input = packageInput.parse(req.body);
  const p = await mongoose.connection.transaction(async (session) => {
    const [p] = await Package.create([input], { session });
    await audit(req.user, null, "package.created", { name: p.name }, session);
    return p;
  });
  res.status(201).json(p);
});
router.put("/packages/:id", async (req, res) => {
  const input = packageInput.parse(req.body);
  const p = await mongoose.connection.transaction(async (session) => {
    const p = await Package.findByIdAndUpdate(
      req.params.id,
      { $set: input },
      { new: true, session },
    );
    if (!p) throw fail("Package not found", 404);
    await audit(
      req.user,
      null,
      "package.updated",
      { id: p.id, name: p.name, isActive: p.isActive },
      session,
    );
    return p;
  });
  res.json(p);
});
router.get("/clients", async (req, res) =>
  res.json(
    (await Tenant.find().sort({ createdAt: -1 }).lean()).map((t) => ({
      ...t,
      access: accessStatus(t),
    })),
  ),
);
router.post("/clients", async (req, res) =>
  res.status(201).json(await onboard(onboardInput.parse(req.body), req.user)),
);
router.get("/clients/:id", async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw fail("Client not found", 404);
  const models = await readyTenant(tenant.id);
  res.json({
    tenant,
    access: accessStatus(tenant),
    usage: {
      products: await models.Product.countDocuments({
        isActive: true,
        kind: { $ne: "parent" },
      }),
      users: await User.countDocuments({ tenantId: tenant.id, isActive: true }),
    },
    members: await User.find({ tenantId: tenant.id }).select(
      "name email role isActive mustChangePassword",
    ),
    payments: await SubscriptionPayment.find({ tenantId: tenant.id })
      .select("-requestHash -idempotencyKey")
      .sort({ createdAt: -1 }),
  });
});
router.patch("/clients/:id", async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(100),
      phone: z.string().max(30),
      notes: z.string().max(2000),
      status: z.enum(["active", "suspended"]),
      revision: z.number().int().min(0),
    })
    .parse(req.body);
  const t = await mongoose.connection.transaction(async (session) => {
    const t = await Tenant.findOneAndUpdate(
      { _id: req.params.id, revision: input.revision },
      {
        $set: {
          name: input.name,
          phone: input.phone,
          notes: input.notes,
          status: input.status,
        },
        $inc: { revision: 1 },
      },
      { new: true, session },
    );
    if (!t)
      throw fail("Client changed or was not found. Refresh and retry.", 409);
    await audit(
      req.user,
      t.id,
      "client.updated",
      { status: t.status, name: t.name },
      session,
    );
    return t;
  });
  res.json(t);
});
router.post("/clients/:id/renew", async (req, res) =>
  res.json(await renew(req.params.id, renewInput.parse(req.body), req.user)),
);
router.post("/clients/:id/reset-password", async (req, res) => {
  const input = z.object({ userId: id, password }).parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findOneAndUpdate(
      { _id: input.userId, tenantId: req.params.id },
      {
        $set: { passwordHash, mustChangePassword: true },
        $inc: { tokenVersion: 1 },
      },
      { new: true, session },
    );
    if (!user) throw fail("Client user not found", 404);
    await audit(
      req.user,
      req.params.id,
      "user.password_reset",
      { email: user.email },
      session,
    );
  });
  res.json({ ok: true });
});
router.get("/payments", async (req, res) =>
  res.json(
    await SubscriptionPayment.find()
      .select("-requestHash -idempotencyKey")
      .sort({ createdAt: -1 }),
  ),
);
router.get("/audit", async (req, res) =>
  res.json(await AuditEvent.find().sort({ createdAt: -1 }).limit(200)),
);
export default router;
