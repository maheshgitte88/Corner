import { Router } from "express";
import { z } from "zod";

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
import {
  ensurePublicLink,
  shareUrl,
  withShare,
} from "../public-invoices.js";
import {
  sendInvoiceWhatsApp,
  toE164,
  vobizConfigured,
} from "../vobiz-whatsapp.js";
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
  res.json(
    await req.models.Invoice.find(filter).sort({ createdAt: -1 }).lean(),
  );
});
router.post("/invoices", async (req, res) => {
  const invoice = await checkout(
    V.sale.parse(req.body),
    req.user.id,
    req.models,
  );
  const link = await ensurePublicLink(req.tenant.id, invoice.id);
  res.status(201).json(withShare(invoice, link));
});
router.get("/invoices/:id", async (req, res) => {
  const i = await req.models.Invoice.findById(req.params.id);
  if (!i) throw V.fail("Invoice not found", 404);
  const link = await ensurePublicLink(req.tenant.id, i.id);
  res.json(withShare(i, link));
});
router.post("/invoices/:id/share", async (req, res) => {
  const i = await req.models.Invoice.findById(req.params.id);
  if (!i) throw V.fail("Invoice not found", 404);
  const link = await ensurePublicLink(req.tenant.id, i.id);
  res.json({ shareUrl: shareUrl(link.token) });
});
router.post("/invoices/:id/whatsapp", async (req, res) => {
  const i = await req.models.Invoice.findById(req.params.id);
  if (!i) throw V.fail("Invoice not found", 404);
  const phone = toE164(req.body?.to || i.customerSnapshot?.phone);
  if (!phone)
    throw V.fail("Add a 10-digit mobile number before sending on WhatsApp");
  if (!vobizConfigured())
    throw V.fail("WhatsApp is not configured on this server", 503);
  const link = await ensurePublicLink(req.tenant.id, i.id);
  const shop = i.shopSnapshot?.shopName || req.tenant.name || "Counter24";
  await sendInvoiceWhatsApp({
    to: phone,
    name: i.customerSnapshot?.name || "Customer",
    shop,
    invoiceNumber: i.invoiceNumber,
    amount: ((i.grandTotal || 0) / 100).toFixed(2),
    token: link.token,
  });
  res.json({ sent: true, to: phone, shareUrl: shareUrl(link.token) });
});
router.post("/invoices/:id/cancel", async (req, res) =>
  res.json(
    await cancel(
      req.params.id,
      z.string().trim().min(3).max(500).parse(req.body.reason),
      req.user.id,
      req.models,
    ),
  ),
);
router.get("/settings", async (req, res) =>
  res.json((await req.models.ShopSettings.findOne()) || {}),
);
router.put("/settings", async (req, res) =>
  res.json(
    await req.models.ShopSettings.findOneAndUpdate(
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
  const [allProducts, sales, recent] = await Promise.all([
    req.models.Product.find(V.sellableFilter).lean(),
    req.models.Invoice.find({
      status: "Completed",
      createdAt: { $gte: month },
    }).lean(),
    req.models.Invoice.find().sort({ createdAt: -1 }).limit(6).lean(),
  ]);
  const parentIds = [
    ...new Set(
      allProducts
        .filter((p) => p.kind === "variant" && p.parentId)
        .map((p) => String(p.parentId)),
    ),
  ];
  const parents = parentIds.length
    ? await req.models.Product.find({ _id: { $in: parentIds } }).lean()
    : [];
  const parentNames = Object.fromEntries(
    parents.map((p) => [String(p._id), p.name]),
  );
  const products = allProducts.map((p) => ({
    ...p,
    parentName: p.parentId ? parentNames[String(p.parentId)] : undefined,
    displayName: V.productDisplayName({
      ...p,
      parentName: p.parentId ? parentNames[String(p.parentId)] : undefined,
    }),
  }));
  const todaySales = sales.filter((i) => i.createdAt >= start);
  const { nearExpiry, expired } = V.expiryBuckets(products);
  res.json({
    totalProducts: products.length,
    totalQuantity: products.reduce((s, p) => s + p.stockQuantity, 0),
    lowStock: products.filter(
      (p) => p.stockQuantity > 0 && p.stockQuantity <= p.minimumStock,
    ),
    outOfStock: products.filter((p) => p.stockQuantity === 0).length,
    nearExpiry,
    expired,
    expiredCount: expired.length,
    todaySales: todaySales.reduce((s, i) => s + i.grandTotal, 0),
    todayInvoices: todaySales.length,
    monthSales: sales.reduce((s, i) => s + i.grandTotal, 0),
    recent,
  });
});
router.get("/reports/sales", async (req, res) => {
  const invoices = await req.models.Invoice.find({
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
        name: l.variantLabel
          ? `${l.productName} · ${l.variantLabel}`
          : l.productName,
        sku: l.sku,
        quantity: 0,
        total: 0,
      };
      products[l.productId].quantity += l.quantity;
      products[l.productId].total += l.lineTotal;
    }
  }
  const catalogue = await req.models.Product.find(V.sellableFilter).lean();
  const parentIds = [
    ...new Set(
      catalogue
        .filter((p) => p.kind === "variant" && p.parentId)
        .map((p) => String(p.parentId)),
    ),
  ];
  const parents = parentIds.length
    ? await req.models.Product.find({ _id: { $in: parentIds } }).lean()
    : [];
  const parentNames = Object.fromEntries(
    parents.map((p) => [String(p._id), p.name]),
  );
  const decorated = catalogue.map((p) => ({
    ...p,
    parentName: p.parentId ? parentNames[String(p.parentId)] : undefined,
    displayName: V.productDisplayName({
      ...p,
      parentName: p.parentId ? parentNames[String(p.parentId)] : undefined,
    }),
  }));
  const { nearExpiry, expired } = V.expiryBuckets(decorated);
  res.json({
    count: invoices.length,
    total: invoices.reduce((s, i) => s + i.grandTotal, 0),
    products: Object.values(products).sort((a, b) => b.total - a.total),
    payments,
    daily,
    monthly,
    nearExpiry,
    expired,
  });
});
export default router;
