import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connect } from "./config.js";
import * as M from "./models.js";
import { changeStock, atomic } from "./services.js";
try {
  await connect();
  await Promise.all(Object.values(M).map((m) => m.init()));
  const email = process.env.ADMIN_EMAIL?.toLowerCase(),
    password = process.env.ADMIN_PASSWORD;
  if (
    !email ||
    !password ||
    password.length < 12 ||
    password.startsWith("replace-")
  )
    throw new Error(
      "Set ADMIN_EMAIL and a strong ADMIN_PASSWORD (12+ characters) in server/.env",
    );
  let user = await M.User.findOne({ email });
  if (!user)
    user = await M.User.create({
      email,
      passwordHash: await bcrypt.hash(password, 12),
    });
  await M.ShopSettings.updateOne(
    { singleton: "shop" },
    {
      $setOnInsert: {
        shopName: "Corner & Co.",
        address: "Your shop address",
        currency: "INR",
        invoicePrefix: "INV",
        defaultTax: 0,
        invoiceFooter: "Thank you for shopping local.",
        printFormat: "A4",
      },
    },
    { upsert: true },
  );
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
      );
    });
  }
  console.log("Seed complete. Existing records and passwords were preserved.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
