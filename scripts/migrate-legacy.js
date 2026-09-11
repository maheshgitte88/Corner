import mongoose from "mongoose";
import { connect } from "../server/src/config.js";
import * as legacy from "../server/src/models.js";
import { Tenant, Package, AuditEvent } from "../server/src/platform-models.js";
import { readyTenant } from "../server/src/tenant-db.js";
const names = [
  "Product",
  "Category",
  "Customer",
  "InventoryTransaction",
  "Invoice",
  "ShopSettings",
  "Counter",
];
try {
  await connect();
  const email = process.env.MIGRATION_OWNER_EMAIL?.toLowerCase(),
    slug = process.env.MIGRATION_CLIENT_SLUG,
    name = process.env.MIGRATION_CLIENT_NAME;
  if (!email || !slug || !name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(
      "Set MIGRATION_OWNER_EMAIL, MIGRATION_CLIENT_SLUG and MIGRATION_CLIENT_NAME in server/.env.",
    );
  if (await Tenant.exists({ slug }))
    throw new Error("This client slug already exists. No changes made.");
  const owner = await legacy.User.findOne({
    email,
    tenantId: { $exists: false },
    role: { $ne: "platform_admin" },
  });
  if (!owner)
    throw new Error("Choose an existing unassigned legacy owner account.");
  const admin = await legacy.User.findOne({ role: "platform_admin" });
  if (!admin)
    throw new Error(
      "Run npm run seed first with a separate platform administrator email.",
    );
  const plan = await Package.findOne({
    name: process.env.MIGRATION_PACKAGE_NAME || "Growth",
    isActive: true,
  }).lean();
  if (!plan) throw new Error("Migration package not found.");
  const users = await legacy.User.find({
    tenantId: { $exists: false },
    role: { $ne: "platform_admin" },
  });
  const products = await legacy.Product.countDocuments({ isActive: true });
  if (products > plan.maxProducts || users.length > plan.maxUsers)
    throw new Error(
      "The selected package is smaller than current usage. Choose or create a larger package.",
    );
  const tenantId = new mongoose.Types.ObjectId(),
    target = await readyTenant(tenantId);
  await mongoose.connection.transaction(async (session) => {
    await Tenant.create(
      [
        {
          _id: tenantId,
          name,
          slug,
          ownerEmail: email,
          subscription: {
            planId: plan._id,
            planSnapshot: plan,
            cycle: "monthly",
            state: "trial",
            startsAt: new Date(),
            endsAt: new Date(Date.now() + 14 * 86400000),
          },
        },
      ],
      { session },
    );
    for (const model of names) {
      const docs = await legacy[model].find().session(session).lean();
      if (docs.length)
        await target[model].collection.insertMany(docs, { session });
    }
    await legacy.User.updateMany(
      { _id: { $in: users.map((u) => u._id) } },
      {
        $set: {
          tenantId,
          role: "client_admin",
          isActive: true,
          mustChangePassword: true,
        },
        $inc: { tokenVersion: 1 },
      },
      { session },
    );
    await AuditEvent.create(
      [
        {
          actor: admin._id,
          actorEmail: admin.email,
          tenantId,
          action: "client.legacy_migrated",
          details: { name, products, users: users.length },
        },
      ],
      { session },
    );
  });
  console.log(
    `Legacy shop copied into client ${slug}. Original retail collections were retained. Existing owner and staff passwords are preserved; first login requires a password change. A 14-day trial was granted. Record a renewal to continue access.`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
