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

function expiryFields(input) {
  const set = {};
  if (input.expiryFrom) set.expiryFrom = new Date(`${input.expiryFrom}T00:00:00+05:30`);
  else set.expiryFrom = null;
  if (input.expiryTo) set.expiryTo = new Date(`${input.expiryTo}T23:59:59.999+05:30`);
  else set.expiryTo = null;
  return set;
}

async function decorateProducts(Product, rows) {
  const parentIds = [
    ...new Set(
      rows.filter((p) => p.kind === "variant" && p.parentId).map((p) => String(p.parentId)),
    ),
  ];
  const parents = parentIds.length
    ? await Product.find({ _id: { $in: parentIds } }).lean()
    : [];
  const byId = Object.fromEntries(parents.map((p) => [String(p._id), p]));
  return rows.map((p) => {
    const parent = p.parentId ? byId[String(p.parentId)] : null;
    const parentName = parent?.name || p.name;
    return {
      ...p,
      parentName: p.kind === "variant" ? parentName : undefined,
      displayName: V.productDisplayName({
        ...p,
        parentName,
      }),
    };
  });
}

async function assertCategory(models, category) {
  if (category && !(await models.Category.exists({ _id: category })))
    throw V.fail("Category not found");
}

router.get("/products", async (req, res) => {
  const rows = await req.models.Product.find()
    .populate("category")
    .sort({ name: 1 })
    .lean();
  res.json(await decorateProducts(req.models.Product, rows));
});
router.get("/products/:id", async (req, res) => {
  const p = await req.models.Product.findById(req.params.id)
    .populate("category")
    .lean();
  if (!p) throw V.fail("Product not found", 404);
  const [decorated] = await decorateProducts(req.models.Product, [p]);
  if (p.kind === "parent") {
    const variants = await req.models.Product.find({ parentId: p._id })
      .sort({ variantLabel: 1 })
      .lean();
    decorated.variants = await decorateProducts(req.models.Product, variants);
  }
  res.json(decorated);
});
router.post("/products", async (req, res) => {
  if (Array.isArray(req.body?.variants)) {
    const input = V.productParent.parse(req.body);
    await assertCategory(req.models, input.category);
    const created = await atomic(async (session) => {
      const activeVariants = input.variants.filter((v) => v.isActive !== false);
      if (input.isActive !== false && activeVariants.length)
        await reserveCapacity(
          req.tenant.id,
          req.models,
          "products",
          session,
          activeVariants.length,
        );
      const [parent] = await req.models.Product.create(
        [
          {
            name: input.name,
            kind: "parent",
            category: input.category || null,
            brand: input.brand,
            description: input.description,
            imageUrl: input.imageUrl,
            imageKey: input.imageKey,
            imageProvider: input.imageProvider,
            isActive: input.isActive,
            sellingPrice: 0,
            stockQuantity: 0,
            sku: undefined,
          },
        ],
        { session },
      );
      const variants = [];
      for (const row of input.variants) {
        const [variant] = await req.models.Product.create(
          [
            {
              name: input.name,
              kind: "variant",
              parentId: parent._id,
              variantLabel: row.variantLabel,
              sku: row.sku,
              barcode: row.barcode,
              category: input.category || null,
              brand: input.brand,
              description: input.description,
              imageUrl: input.imageUrl,
              imageKey: input.imageKey,
              imageProvider: input.imageProvider,
              purchasePrice: row.purchasePrice,
              sellingPrice: row.sellingPrice,
              taxPercent: row.taxPercent,
              minimumStock: row.minimumStock,
              unit: row.unit,
              isActive: row.isActive,
              stockQuantity: 0,
              ...expiryFields(row),
            },
          ],
          { session },
        );
        await changeStock(
          variant,
          row.stockQuantity,
          "Opening",
          "Opening stock",
          req.user.id,
          session,
          "",
          req.models,
        );
        variants.push(variant);
      }
      return { parent, variants };
    });
    const parent = await req.models.Product.findById(created.parent.id)
      .populate("category")
      .lean();
    const variants = await req.models.Product.find({
      parentId: created.parent.id,
    }).lean();
    const [decorated] = await decorateProducts(req.models.Product, [parent]);
    decorated.variants = await decorateProducts(req.models.Product, variants);
    return res.status(201).json(decorated);
  }
  const input = V.product.parse(req.body);
  await assertCategory(req.models, input.category);
  const p = await atomic(async (session) => {
    if (input.isActive)
      await reserveCapacity(req.tenant.id, req.models, "products", session);
    const [p] = await req.models.Product.create(
      [
        {
          ...input,
          kind: "standalone",
          parentId: null,
          variantLabel: "",
          stockQuantity: 0,
          ...expiryFields(input),
        },
      ],
      { session },
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
  const [decorated] = await decorateProducts(req.models.Product, [
    p.toObject(),
  ]);
  res.status(201).json(decorated);
});
router.post("/products/:id/variants", async (req, res) => {
  const row = V.productVariant.parse(req.body);
  const parent = await req.models.Product.findById(req.params.id);
  if (!parent || parent.kind !== "parent")
    throw V.fail("Parent product not found", 404);
  const variant = await atomic(async (session) => {
    if (row.isActive)
      await reserveCapacity(req.tenant.id, req.models, "products", session);
    const [variant] = await req.models.Product.create(
      [
        {
          name: parent.name,
          kind: "variant",
          parentId: parent._id,
          variantLabel: row.variantLabel,
          sku: row.sku,
          barcode: row.barcode,
          category: parent.category,
          brand: parent.brand,
          description: parent.description,
          imageUrl: parent.imageUrl,
          imageKey: parent.imageKey,
          imageProvider: parent.imageProvider,
          purchasePrice: row.purchasePrice,
          sellingPrice: row.sellingPrice,
          taxPercent: row.taxPercent,
          minimumStock: row.minimumStock,
          unit: row.unit,
          isActive: row.isActive,
          stockQuantity: 0,
          ...expiryFields(row),
        },
      ],
      { session },
    );
    await changeStock(
      variant,
      row.stockQuantity,
      "Opening",
      "Opening stock",
      req.user.id,
      session,
      "",
      req.models,
    );
    return variant;
  });
  const [decorated] = await decorateProducts(req.models.Product, [
    (await req.models.Product.findById(variant.id)).toObject(),
  ]);
  res.status(201).json(decorated);
});
router.put("/products/:id", async (req, res) => {
  const current = await req.models.Product.findById(req.params.id);
  if (!current) throw V.fail("Product not found", 404);
  if (current.kind === "parent") {
    const input = V.productParentUpdate.parse(req.body);
    await assertCategory(req.models, input.category);
    const p = await atomic(async (session) => {
      const updated = await req.models.Product.findByIdAndUpdate(
        req.params.id,
        { $set: input },
        { new: true, session, runValidators: true },
      );
      await req.models.Product.updateMany(
        { parentId: req.params.id },
        {
          $set: {
            name: input.name,
            category: input.category || null,
            brand: input.brand,
            description: input.description,
            imageUrl: input.imageUrl,
            imageKey: input.imageKey,
            imageProvider: input.imageProvider,
            ...(input.isActive === false ? { isActive: false } : {}),
          },
        },
        { session },
      );
      return updated;
    });
    const [decorated] = await decorateProducts(req.models.Product, [
      p.toObject(),
    ]);
    return res.json(decorated);
  }
  const input = V.productSellableUpdate.parse(req.body);
  if (current.kind === "standalone")
    await assertCategory(req.models, input.category);
  if (current.kind === "variant" && !input.variantLabel)
    throw V.fail("Variant label is required");
  const p = await atomic(async (session) => {
    const row = await req.models.Product.findById(req.params.id).session(
      session,
    );
    if (!row) throw V.fail("Product not found", 404);
    if (input.isActive && !row.isActive)
      await reserveCapacity(req.tenant.id, req.models, "products", session);
    if (input.unit !== row.unit && row.stockQuantity !== 0)
      throw V.fail(
        "Set stock to zero with an adjustment before changing units",
      );
    const { expiryFrom, expiryTo, ...rest } = input;
    const $set = {
      ...rest,
      ...expiryFields({ expiryFrom, expiryTo }),
    };
    if (row.kind === "variant") {
      delete $set.name;
      delete $set.category;
      delete $set.brand;
      delete $set.description;
      delete $set.imageUrl;
      delete $set.imageKey;
      delete $set.imageProvider;
    }
    return req.models.Product.findByIdAndUpdate(
      req.params.id,
      { $set },
      { new: true, session, runValidators: true },
    );
  });
  const [decorated] = await decorateProducts(req.models.Product, [
    p.toObject(),
  ]);
  res.json(decorated);
});
router.delete("/products/:id", async (req, res) => {
  const current = await req.models.Product.findById(req.params.id);
  if (!current) throw V.fail("Product not found", 404);
  if (current.kind === "parent") {
    await req.models.Product.updateMany(
      { $or: [{ _id: current._id }, { parentId: current._id }] },
      { $set: { isActive: false } },
    );
  } else {
    await req.models.Product.findByIdAndUpdate(req.params.id, {
      $set: { isActive: false },
    });
  }
  const p = await req.models.Product.findById(req.params.id).lean();
  const [decorated] = await decorateProducts(req.models.Product, [p]);
  res.json(decorated);
});
router.patch("/products/:id/stock", async (req, res) => {
  const input = V.stock.parse(req.body);
  res.json(
    await atomic(async (session) => {
      const p = await req.models.Product.findById(req.params.id).session(
        session,
      );
      if (!p) throw V.fail("Product not found", 404);
      if (p.kind === "parent")
        throw V.fail("Parent products do not hold stock", 400);
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
  if (
    await req.models.Product.exists({
      category: req.params.id,
      kind: { $ne: "parent" },
    })
  )
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
      .populate("productId", "name sku unit variantLabel kind expiryTo")
      .sort({ createdAt: -1 })
      .limit(500),
  );
});
export default router;
