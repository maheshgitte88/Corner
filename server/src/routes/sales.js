import { Router } from "express";
import { z } from "zod";
import * as M from "../models.js";
import * as V from "../validations.js";
const router = Router();
router.param("id", (req, res, next, value) => {
  try {
    V.id.parse(value);
    next();
  } catch {
    next(V.fail("Invalid record ID"));
  }
});
import { checkout, cancel } from "../services.js";
const dates = (q) => {
  const filter = {};
  if (q.from || q.to) {
    filter.createdAt = {};
    for (const key of ["from", "to"])
      if (q[key]) {
        const date = z.iso.date().parse(q[key]);
        filter.createdAt[key === "from" ? "$gte" : "$lte"] = new Date(
          `${date}T${key === "from" ? "00:00:00.000" : "23:59:59.999"}+05:30`,
        );
      }
  }
  return filter;
};
router.get("/invoices", async (req, res) => {
  const filter = dates(req.query);
  if (req.query.paymentMethod)
    filter.paymentMethod = z
      .enum(["Cash", "UPI", "Card", "Bank Transfer", "Other"])
      .parse(req.query.paymentMethod);
  res.json(await M.Invoice.find(filter).sort({ createdAt: -1 }).lean());
});
router.post("/invoices", async (req, res) =>
  res.status(201).json(await checkout(V.sale.parse(req.body), req.user.id)),
);
router.get("/invoices/:id", async (req, res) => {
  const i = await M.Invoice.findById(req.params.id);
  if (!i) throw V.fail("Invoice not found", 404);
  res.json(i);
});
router.post("/invoices/:id/cancel", async (req, res) =>
  res.json(
    await cancel(
      req.params.id,
      z.string().trim().min(3).max(500).parse(req.body.reason),
      req.user.id,
    ),
  ),
);
router.get("/settings", async (req, res) =>
  res.json((await M.ShopSettings.findOne()) || {}),
);
router.put("/settings", async (req, res) =>
  res.json(
    await M.ShopSettings.findOneAndUpdate(
      { singleton: "shop" },
      { $set: V.settings.parse(req.body) },
      { upsert: true, new: true },
    ),
  ),
);
router.get("/dashboard", async (req, res) => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  const start = new Date(today + "T00:00:00+05:30");
  const month = new Date(today.slice(0, 7) + "-01T00:00:00+05:30");
  const [products, sales, recent] = await Promise.all([
    M.Product.find({ isActive: true }).lean(),
    M.Invoice.find({ status: "Completed", createdAt: { $gte: month } }).lean(),
    M.Invoice.find().sort({ createdAt: -1 }).limit(6).lean(),
  ]);
  const todaySales = sales.filter((i) => i.createdAt >= start);
  res.json({
    totalProducts: products.length,
    totalQuantity: products.reduce((s, p) => s + p.stockQuantity, 0),
    lowStock: products.filter(
      (p) => p.stockQuantity > 0 && p.stockQuantity <= p.minimumStock,
    ),
    outOfStock: products.filter((p) => p.stockQuantity === 0).length,
    todaySales: todaySales.reduce((s, i) => s + i.grandTotal, 0),
    todayInvoices: todaySales.length,
    monthSales: sales.reduce((s, i) => s + i.grandTotal, 0),
    recent,
  });
});
router.get("/reports/sales", async (req, res) => {
  const invoices = await M.Invoice.find({
    ...dates(req.query),
    status: "Completed",
  }).lean();
  const products = {},
    payments = {},
    daily = {},
    monthly = {};
  for (const i of invoices) {
    payments[i.paymentMethod] = (payments[i.paymentMethod] || 0) + i.grandTotal;
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(i.createdAt);
    daily[day] = (daily[day] || 0) + i.grandTotal;
    monthly[day.slice(0, 7)] = (monthly[day.slice(0, 7)] || 0) + i.grandTotal;
    for (const l of i.items) {
      products[l.productId] ??= {
        name: l.productName,
        sku: l.sku,
        quantity: 0,
        total: 0,
      };
      products[l.productId].quantity += l.quantity;
      products[l.productId].total += l.lineTotal;
    }
  }
  res.json({
    count: invoices.length,
    total: invoices.reduce((s, i) => s + i.grandTotal, 0),
    products: Object.values(products).sort((a, b) => b.total - a.total),
    payments,
    daily,
    monthly,
  });
});
export default router;
