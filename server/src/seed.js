import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { connect } from "./config.js";
import * as legacy from "./models.js";
import * as platform from "./platform-models.js";
import { readyTenant } from "./tenant-db.js";
import { onboard } from "./saas-services.js";
import { changeStock, atomic } from "./services.js";
try {
  await connect();
  await Promise.all(
    [...Object.values(legacy), ...Object.values(platform)]
      .filter((m) => typeof m?.init === "function")
      .map((m) => m.init()),
  );
  const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase(),
    password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (
    !email ||
    !password ||
    password.length < 12 ||
    password.startsWith("replace-")
  )
    throw new Error(
      "Set PLATFORM_ADMIN_EMAIL and a strong PLATFORM_ADMIN_PASSWORD (12+ characters).",
    );
  let owner = await legacy.User.findOne({ email });
  if (owner && owner.role !== "platform_admin")
    throw new Error(
      "Platform admin email already belongs to a client. Use a separate address.",
    );
  if (!owner)
    owner = await legacy.User.create({
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "platform_admin",
      name: "Platform administrator",
    });
  for (const input of [
    {
      name: "Starter",
      description: "The essentials for a growing shop",
      monthlyPrice: 99900,
      yearlyPrice: 999000,
      maxProducts: 100,
      maxUsers: 2,
      reportsEnabled: false,
      imagesEnabled: false,
    },
    {
      name: "Growth",
      description: "More room for your products and people",
      monthlyPrice: 199900,
      yearlyPrice: 1999000,
      maxProducts: 1000,
      maxUsers: 5,
      reportsEnabled: true,
      imagesEnabled: true,
    },
    {
      name: "Business",
      description: "Built for a busy retail operation",
      monthlyPrice: 399900,
      yearlyPrice: 3999000,
      maxProducts: 10000,
      maxUsers: 20,
      reportsEnabled: true,
      imagesEnabled: true,
    },
  ])
    await platform.Package.updateOne(
      { name: input.name },
      { $setOnInsert: input },
      { upsert: true },
    );
  if (process.env.SEED_DEMO === "true") {
    const demoEmail = process.env.ADMIN_EMAIL?.toLowerCase(),
      demoPassword = process.env.ADMIN_PASSWORD;
    if (!demoEmail || !demoPassword || demoPassword.length < 12)
      throw new Error("Set separate demo ADMIN_EMAIL and ADMIN_PASSWORD");
    let tenant = await platform.Tenant.findOne({ slug: "corner-and-co" });
    if (!tenant) {
      const plan = await platform.Package.findOne({ name: "Growth" });
      tenant = await onboard(
        {
          name: "Corner & Co.",
          slug: "corner-and-co",
          ownerName: "Demo shop owner",
          ownerEmail: demoEmail,
          ownerPassword: demoPassword,
          phone: "",
          planId: plan.id,
          cycle: "monthly",
          paymentMethod: "Other",
          paymentReference: "Local demo — no real payment",
          note: "Demo seed",
          idempotencyKey: randomUUID(),
          trialDays: 14,
        },
        owner,
      );
      await legacy.User.updateOne(
        { tenantId: tenant.id, email: demoEmail },
        { $set: { mustChangePassword: false } },
      );
    }
    const user = await legacy.User.findOne({
      tenantId: tenant.id,
      email: demoEmail,
    });
    const M = await readyTenant(tenant.id);
    const names = [
      "Grocery",
      "Beverages",
      "Electronics",
      "Personal Care",
      "Stationery",
    ];
    const cats = {};
    for (const name of names)
      cats[name] = await M.Category.findOneAndUpdate(
        { name },
        { $setOnInsert: { name, isActive: true } },
        { upsert: true, new: true },
      );
    const products = [
      ["Basmati rice", "GRO-001", "Grocery", 12500, 42, "kg", 5, 5],
      ["Whole wheat flour", "GRO-002", "Grocery", 6500, 28, "kg", 5, 0],
      ["Organic honey", "GRO-003", "Grocery", 28500, 4, "pcs", 5, 5],
      ["Cold brew coffee", "BEV-001", "Beverages", 15000, 24, "pcs", 5, 5],
      ["Sparkling water", "BEV-002", "Beverages", 6000, 36, "pcs", 5, 5],
      ["USB-C cable", "ELE-001", "Electronics", 29900, 12, "pcs", 5, 18],
      ["Wireless mouse", "ELE-002", "Electronics", 79900, 0, "pcs", 3, 18],
      ["Hand wash", "PER-001", "Personal Care", 12000, 18, "pcs", 5, 18],
      ["A5 notebook", "STA-001", "Stationery", 9500, 3, "pcs", 5, 12],
      ["Gel pen · blue", "STA-002", "Stationery", 2500, 60, "pcs", 10, 12],
    ];
    for (const [
      name,
      sku,
      category,
      sellingPrice,
      stockQuantity,
      unit,
      minimumStock,
      taxPercent,
    ] of products) {
      if (await M.Product.exists({ sku })) continue;
      await atomic(async (session) => {
        const [p] = await M.Product.create(
          [
            {
              name,
              sku,
              category: cats[category]._id,
              sellingPrice,
              purchasePrice: Math.round(sellingPrice * 0.7),
              unit,
              minimumStock,
              taxPercent,
              stockQuantity: 0,
              kind: "standalone",
            },
          ],
          { session },
        );
        await changeStock(
          p,
          stockQuantity,
          "Opening",
          "Demo opening stock",
          user.id,
          session,
          "",
          M,
        );
      });
    }
    if (!(await M.Product.exists({ name: "Water Bottle", kind: "parent" }))) {
      const near = new Date();
      near.setUTCDate(near.getUTCDate() + 20);
      await atomic(async (session) => {
        const [parent] = await M.Product.create(
          [
            {
              name: "Water Bottle",
              kind: "parent",
              category: cats.Beverages._id,
              brand: "Corner Springs",
              sellingPrice: 0,
              stockQuantity: 0,
            },
          ],
          { session },
        );
        for (const row of [
          ["250 ml", "WB-250", 1500, 20],
          ["500 ml", "WB-500", 2500, 3],
          ["1 L", "WB-1L", 4000, 12],
        ]) {
          const [variant] = await M.Product.create(
            [
              {
                name: "Water Bottle",
                kind: "variant",
                parentId: parent._id,
                variantLabel: row[0],
                sku: row[1],
                category: cats.Beverages._id,
                brand: "Corner Springs",
                sellingPrice: row[2],
                purchasePrice: Math.round(row[2] * 0.7),
                unit: "pcs",
                minimumStock: 5,
                taxPercent: 5,
                stockQuantity: 0,
                expiryTo: near,
              },
            ],
            { session },
          );
          await changeStock(
            variant,
            row[3],
            "Opening",
            "Demo opening stock",
            user.id,
            session,
            "",
            M,
          );
        }
      });
    }
  }
  console.log("Platform seed complete. Existing accounts and data preserved.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
