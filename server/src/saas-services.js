import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import {
  Tenant,
  Package,
  SubscriptionPayment,
  AuditEvent,
  PlatformCounter,
} from "./platform-models.js";
import { User } from "./models.js";
import { readyTenant } from "./tenant-db.js";
import { fail } from "./validations.js";
export const accessStatus = (t) =>
  t.status === "suspended"
    ? "suspended"
    : !t.subscription?.endsAt || new Date(t.subscription.endsAt) <= new Date()
      ? "expired"
      : t.subscription.state;
export function addPeriod(start, cycle) {
  const date = new Date(start),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + (cycle === "yearly" ? 12 : 1));
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}
export async function audit(actor, tenantId, action, details, session) {
  await AuditEvent.create(
    [
      {
        actor: actor.id || actor._id,
        actorEmail: actor.email,
        tenantId,
        action,
        details,
      },
    ],
    { session },
  );
}
const hash = (input) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
async function existing(key, requestHash) {
  const row = await SubscriptionPayment.findOne({ idempotencyKey: key });
  if (row && row.requestHash !== requestHash)
    throw fail("This request key was already used for different details", 409);
  return row;
}
async function sequence() {
  await PlatformCounter.updateOne(
    { key: "receipts" },
    { $setOnInsert: { value: 0 } },
    { upsert: true },
  ).catch((e) => {
    if (e.code !== 11000) throw e;
  });
}
async function receipt(
  input,
  tenant,
  plan,
  actor,
  periodStart,
  periodEnd,
  session,
  requestHash,
  amount,
) {
  const counter = await PlatformCounter.findOneAndUpdate(
    { key: "receipts" },
    { $inc: { value: 1 } },
    { new: true, session },
  );
  const [row] = await SubscriptionPayment.create(
    [
      {
        tenantId: tenant._id,
        receiptNumber: `SUB-${String(counter.value).padStart(7, "0")}`,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        clientSnapshot: { name: tenant.name, email: tenant.ownerEmail },
        planSnapshot: plan,
        cycle: input.cycle,
        amount,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference,
        note: input.note,
        periodStart,
        periodEnd,
        actor: actor.id || actor._id,
      },
    ],
    { session },
  );
  return row;
}
export async function onboard(input, actor) {
  const requestHash = hash(input),
    saved = await existing(input.idempotencyKey, requestHash);
  if (saved) return Tenant.findById(saved.tenantId);
  const plan = await Package.findOne({
    _id: input.planId,
    isActive: true,
  }).lean();
  if (!plan) throw fail("Choose an active package");
  const tenantId = new mongoose.Types.ObjectId(),
    models = await readyTenant(tenantId);
  const passwordHash = await bcrypt.hash(input.ownerPassword, 12);
  await sequence();
  try {
    return await mongoose.connection.transaction(async (session) => {
      const start = new Date(),
        end = input.trialDays
          ? new Date(start.getTime() + input.trialDays * 86400000)
          : addPeriod(start, input.cycle);
      const [tenant] = await Tenant.create(
        [
          {
            _id: tenantId,
            name: input.name,
            slug: input.slug,
            ownerEmail: input.ownerEmail,
            phone: input.phone,
            subscription: {
              planId: plan._id,
              planSnapshot: plan,
              cycle: input.cycle,
              state: input.trialDays ? "trial" : "active",
              startsAt: start,
              endsAt: end,
            },
          },
        ],
        { session },
      );
      await User.create(
        [
          {
            name: input.ownerName,
            email: input.ownerEmail,
            passwordHash,
            role: "client_admin",
            tenantId,
            mustChangePassword: true,
          },
        ],
        { session },
      );
      await models.ShopSettings.create(
        [{ shopName: input.name, email: input.ownerEmail, phone: input.phone }],
        { session },
      );
      await receipt(
        input,
        tenant,
        plan,
        actor,
        start,
        end,
        session,
        requestHash,
        input.trialDays ? 0 : plan[`${input.cycle}Price`],
      );
      await audit(
        actor,
        tenantId,
        "client.onboarded",
        { name: input.name, cycle: input.cycle, trialDays: input.trialDays },
        session,
      );
      return tenant;
    });
  } catch (e) {
    if (e.code === 11000) {
      const duplicate = await existing(input.idempotencyKey, requestHash);
      if (duplicate) return Tenant.findById(duplicate.tenantId);
    }
    throw e;
  }
}
export async function renew(tenantId, input, actor) {
  const requestHash = hash({ tenantId, ...input }),
    saved = await existing(input.idempotencyKey, requestHash);
  if (saved) return saved;
  await sequence();
  try {
    return await mongoose.connection.transaction(async (session) => {
      const prior = await SubscriptionPayment.findOne({
        idempotencyKey: input.idempotencyKey,
      }).session(session);
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw fail("Request key conflict", 409);
        return prior;
      }
      const tenant = await Tenant.findById(tenantId).session(session);
      if (!tenant) throw fail("Client not found", 404);
      if (tenant.revision !== input.revision)
        throw fail("Client details changed. Refresh before renewing.", 409);
      const plan = await Package.findOne({ _id: input.planId, isActive: true })
        .session(session)
        .lean();
      if (!plan) throw fail("Choose an active package");
      const models = await readyTenant(tenantId);
      const products = await models.Product.countDocuments({
        isActive: true,
      }).session(session);
      const users = await User.countDocuments({
        tenantId,
        isActive: true,
      }).session(session);
      if (products > plan.maxProducts || users > plan.maxUsers)
        throw fail(
          "Current usage exceeds this package. Archive products or deactivate team members first.",
          409,
        );
      if (
        input.mode === "extend" &&
        (String(tenant.subscription.planId) !== input.planId ||
          tenant.subscription.cycle !== input.cycle)
      )
        throw fail("Use Replace to change package or billing cycle");
      const now = new Date(),
        start =
          input.mode === "extend" && tenant.subscription.endsAt > now
            ? tenant.subscription.endsAt
            : now,
        end = addPeriod(start, input.cycle);
      tenant.subscription = {
        planId: plan._id,
        planSnapshot: plan,
        cycle: input.cycle,
        state: "active",
        startsAt: input.mode === "extend" ? tenant.subscription.startsAt : now,
        endsAt: end,
      };
      tenant.revision++;
      await tenant.save({ session });
      const row = await receipt(
        input,
        tenant,
        plan,
        actor,
        start,
        end,
        session,
        requestHash,
        plan[`${input.cycle}Price`],
      );
      await audit(
        actor,
        tenantId,
        "subscription." + input.mode,
        { receipt: row.receiptNumber, endsAt: end },
        session,
      );
      return row;
    });
  } catch (e) {
    if (e.code === 11000) {
      const duplicate = await existing(input.idempotencyKey, requestHash);
      if (duplicate) return duplicate;
    }
    throw e;
  }
}
export async function reserveCapacity(tenantId, models, kind, session) {
  // Serialize capacity checks with plan changes and other creates, inside the same transaction.
  const tenant = await Tenant.findOneAndUpdate(
    {
      _id: tenantId,
      status: "active",
      "subscription.endsAt": { $gt: new Date() },
    },
    { $inc: { usageRevision: 1 } },
    { new: true, session },
  );
  if (!tenant) throw fail("Your subscription is not active", 403);
  const count =
    kind === "products"
      ? await models.Product.countDocuments({ isActive: true }).session(session)
      : await User.countDocuments({ tenantId, isActive: true }).session(
          session,
        );
  const limit =
    tenant.subscription.planSnapshot[
      kind === "products" ? "maxProducts" : "maxUsers"
    ];
  if (count >= limit)
    throw fail(
      `Your package allows ${limit} active ${kind}. Contact the platform administrator to upgrade.`,
      403,
    );
}
