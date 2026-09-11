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
import Decimal from "decimal.js";
import { atomic, changeStock } from "../services.js";
import { reserveCapacity } from "../saas-services.js";
router.get("/products", async (req, res) =>
  res.json(
    await req.models.Product.find()
      .populate("category")
      .sort({ name: 1 })
      .lean(),
  ),
);
router.get("/products/:id", async (req, res) => {
  const p = await req.models.Product.findById(req.params.id).populate(
    "category",
  );
  if (!p) throw V.fail("Product not found", 404);
  res.json(p);
});
router.post("/products", async (req, res) => {
  const input = V.product.parse(req.body);
  if (
    input.category &&
    !(await req.models.Category.exists({ _id: input.category }))
  )
    throw V.fail("Category not found");
  const p = await atomic(async (session) => {
    if (input.isActive)
      await reserveCapacity(req.tenant.id, req.models, "products", session);
    const [p] = await req.models.Product.create(
      [{ ...input, stockQuantity: 0 }],
      {
        session,
      },
    );
    await changeStock(
      p,
      input.stockQuantity,
      "Opening",
      "Opening stock",
      req.user.id,
      session,
      "",
      req.models,
    );
    return req.models.Product.findById(p.id).session(session);
  });
  res.status(201).json(p);
});
router.put("/products/:id", async (req, res) => {
  const input = V.product.omit({ stockQuantity: true }).parse(req.body);
  if (
    input.category &&
    !(await req.models.Category.exists({ _id: input.category }))
  )
    throw V.fail("Category not found");
  const p = await atomic(async (session) => {
    const current = await req.models.Product.findById(req.params.id).session(
      session,
    );
    if (!current) throw V.fail("Product not found", 404);
    if (input.isActive && !current.isActive)
      await reserveCapacity(req.tenant.id, req.models, "products", session);
    if (input.unit !== current.unit && current.stockQuantity !== 0)
      throw V.fail(
        "Set stock to zero with an adjustment before changing units",
      );
    return req.models.Product.findByIdAndUpdate(
      req.params.id,
      { $set: input },
      { new: true, session, runValidators: true },
    );
  });
  res.json(p);
});
router.delete("/products/:id", async (req, res) => {
  const p = await req.models.Product.findByIdAndUpdate(
    req.params.id,
    { $set: { isActive: false } },
    { new: true },
  );
  if (!p) throw V.fail("Product not found", 404);
  res.json(p);
});
router.patch("/products/:id/stock", async (req, res) => {
  const input = V.stock.parse(req.body);
  res.json(
    await atomic(async (session) => {
      const p = await req.models.Product.findById(req.params.id).session(
        session,
      );
      if (!p) throw V.fail("Product not found", 404);
      const next =
        input.type === "Correction"
          ? input.quantity
          : new Decimal(p.stockQuantity)
              .plus(
                ["Stock Reduced", "Damaged"].includes(input.type)
                  ? -input.quantity
                  : input.quantity,
              )
              .toNumber();
      await changeStock(
        p,
        next,
        input.type,
        input.note,
        req.user.id,
        session,
        "",
        req.models,
      );
      return { ok: true };
    }),
  );
});
router.get("/categories", async (req, res) =>
  res.json(await req.models.Category.find().sort({ name: 1 })),
);
router.post("/categories", async (req, res) =>
  res
    .status(201)
    .json(await req.models.Category.create(V.category.parse(req.body))),
);
router.put("/categories/:id", async (req, res) => {
  const v = await req.models.Category.findByIdAndUpdate(
    req.params.id,
    { $set: V.category.parse(req.body) },
    { new: true },
  );
  if (!v) throw V.fail("Category not found", 404);
  res.json(v);
});
router.delete("/categories/:id", async (req, res) => {
  if (await req.models.Product.exists({ category: req.params.id }))
    throw V.fail("Category is in use", 409);
  await req.models.Category.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
router.get("/customers", async (req, res) =>
  res.json(await req.models.Customer.find().sort({ name: 1 })),
);
router.post("/customers", async (req, res) =>
  res
    .status(201)
    .json(await req.models.Customer.create(V.customer.parse(req.body))),
);
router.put("/customers/:id", async (req, res) => {
  const v = await req.models.Customer.findByIdAndUpdate(
    req.params.id,
    { $set: V.customer.parse(req.body) },
    { new: true },
  );
  if (!v) throw V.fail("Customer not found", 404);
  res.json(v);
});
router.get("/inventory/transactions", async (req, res) => {
  const filter = {};
  if (req.query.productId) filter.productId = V.id.parse(req.query.productId);
  res.json(
    await req.models.InventoryTransaction.find(filter)
      .populate("productId", "name sku unit")
      .sort({ createdAt: -1 })
      .limit(500),
  );
});
export default router;
