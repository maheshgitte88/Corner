import { z } from "zod";
export const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid record ID");
const text = z.string().trim().max(500);
const optional = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => v ?? "");
const cents = z.number().int().min(0).max(1e12);
const quantity = z
  .number()
  .min(0)
  .max(1e9)
  .refine(
    (v) =>
      Number.isInteger(Math.round(v * 1000) * 1) &&
      Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6,
    "Use at most 3 decimal places",
  );
const unit = z
  .enum(["pcs", "kg", "gram", "litre", "ml", "box", "packet", "custom"])
  .default("pcs");
const optionalDate = z
  .union([z.iso.date(), z.literal(""), z.null(), z.undefined()])
  .optional()
  .transform((v) => (!v ? undefined : v));
const categoryId = z
  .union([id, z.null(), z.undefined(), z.object({ _id: id }).transform((o) => o._id)])
  .optional()
  .transform((v) => v || null);
const withExpiry = (schema) =>
  schema.superRefine((v, ctx) => {
    if (v.expiryFrom && v.expiryTo && v.expiryFrom > v.expiryTo)
      ctx.addIssue({
        code: "custom",
        message: "Expiry from date must be on or before expiry to date",
        path: ["expiryTo"],
      });
  });
const sellableFields = {
  sku: text
    .min(1)
    .max(80)
    .transform((s) => s.toUpperCase()),
  barcode: optional,
  purchasePrice: cents.default(0),
  sellingPrice: cents.min(1),
  taxPercent: z.number().min(0).max(100).default(0),
  stockQuantity: quantity.default(0),
  minimumStock: quantity.default(5),
  unit,
  expiryFrom: optionalDate,
  expiryTo: optionalDate,
};
export const product = withExpiry(
  z.object({
    name: text.min(1),
    kind: z.literal("standalone").optional().default("standalone"),
    category: categoryId,
    brand: optional,
    description: optional,
    imageUrl: z
      .union([z.url().startsWith("https://"), z.literal(""), z.null(), z.undefined()])
      .optional()
      .transform((v) => v || ""),
    imageKey: optional,
    imageProvider: z.enum(["", "cloudinary", "s3"]).optional().default(""),
    isActive: z.boolean().default(true),
    ...sellableFields,
  }),
);
export const productVariant = withExpiry(
  z.object({
    _id: id.optional(),
    variantLabel: text.min(1).max(80),
    ...sellableFields,
    isActive: z.boolean().default(true),
  }),
);
export const productParent = z.object({
  name: text.min(1),
  kind: z.literal("parent").optional().default("parent"),
  category: categoryId,
  brand: optional,
  description: optional,
  imageUrl: z
    .union([z.url().startsWith("https://"), z.literal(""), z.null(), z.undefined()])
    .optional()
    .transform((v) => v || ""),
  imageKey: optional,
  imageProvider: z.enum(["", "cloudinary", "s3"]).optional().default(""),
  isActive: z.boolean().default(true),
  variants: z.array(productVariant).min(1).max(100),
});
export const productParentUpdate = z.object({
  name: text.min(1),
  category: categoryId,
  brand: optional,
  description: optional,
  imageUrl: z
    .union([z.url().startsWith("https://"), z.literal(""), z.null(), z.undefined()])
    .optional()
    .transform((v) => v || ""),
  imageKey: optional,
  imageProvider: z.enum(["", "cloudinary", "s3"]).optional().default(""),
  isActive: z.boolean().default(true),
});
export const productSellableUpdate = withExpiry(
  z.object({
    name: text.min(1).optional(),
    variantLabel: z
      .string()
      .trim()
      .max(80)
      .optional()
      .nullable()
      .transform((v) => v ?? undefined),
    category: categoryId,
    brand: optional,
    description: optional,
    imageUrl: z
      .union([z.url().startsWith("https://"), z.literal(""), z.null(), z.undefined()])
      .optional()
      .transform((v) => v || ""),
    imageKey: optional,
    imageProvider: z.enum(["", "cloudinary", "s3"]).optional().default(""),
    sku: text
      .min(1)
      .max(80)
      .transform((s) => s.toUpperCase()),
    barcode: optional,
    purchasePrice: cents.default(0),
    sellingPrice: cents.min(1),
    taxPercent: z.number().min(0).max(100).default(0),
    minimumStock: quantity.default(5),
    unit,
    expiryFrom: optionalDate,
    expiryTo: optionalDate,
    isActive: z.boolean().default(true),
  }),
);
export const category = z.object({
  name: text.min(1).max(80),
  description: optional,
  isActive: z.boolean().default(true),
});
export const customer = z.object({
  name: text.min(1).max(100),
  phone: text.max(30).optional().default(""),
  email: z
    .union([z.email(), z.literal("")])
    .optional()
    .default(""),
  address: optional,
  gstNumber: text.max(30).optional().default(""),
});
export const sale = z
  .object({
    idempotencyKey: z.uuid(),
    items: z
      .array(
        z.object({
          productId: id,
          quantity: quantity.refine((v) => v > 0),
          discount: cents.default(0),
        }),
      )
      .min(1)
      .max(200),
    customerId: id.optional(),
    customer: customer.optional(),
    discount: z
      .object({
        type: z.enum(["flat", "percent"]),
        value: z.number().min(0).max(1e12),
      })
      .default({ type: "flat", value: 0 }),
    amountPaid: cents,
    paymentMethod: z.enum(["Cash", "UPI", "Card", "Bank Transfer", "Other"]),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    "Duplicate cart product",
  );
export const stock = z.object({
  type: z.enum([
    "Stock Added",
    "Stock Reduced",
    "Correction",
    "Damaged",
    "Returned",
    "Other",
  ]),
  quantity: quantity,
  note: text.min(1),
});
export const settings = z.object({
  shopName: text.min(1),
  logoUrl: z
    .union([z.url().startsWith("https://"), z.literal("")])
    .optional()
    .default(""),
  address: optional,
  phone: optional,
  email: z
    .union([z.email(), z.literal("")])
    .optional()
    .default(""),
  gstNumber: optional,
  currency: z.literal("INR").default("INR"),
  invoicePrefix: z.string().regex(/^[A-Z0-9-]{1,12}$/),
  defaultTax: z.number().min(0).max(100),
  invoiceFooter: optional,
  printFormat: z.enum(["A4", "80mm"]),
});
export const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export const SELLABLE_KINDS = ["standalone", "variant"];
/** Active sellable rows. Includes legacy products with no kind set. */
export const sellableFilter = {
  isActive: true,
  kind: { $ne: "parent" },
};
export const NEAR_EXPIRY_DAYS = 30;
function istDay(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}
function addIstDays(day, days) {
  const d = new Date(`${day}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return istDay(d);
}
export function productDisplayName(p) {
  if (p.kind === "variant" && p.variantLabel)
    return `${p.parentName || p.name} · ${p.variantLabel}`;
  return p.name;
}
export function expiryBuckets(products, now = new Date()) {
  const today = istDay(now);
  const nearLimit = addIstDays(today, NEAR_EXPIRY_DAYS);
  const decorate = (p) => ({
    ...p,
    displayName: productDisplayName(p),
  });
  const withExpiry = products.filter((p) => p.expiryTo);
  return {
    nearExpiry: withExpiry
      .filter((p) => {
        const day = istDay(p.expiryTo);
        return p.stockQuantity > 0 && day > today && day <= nearLimit;
      })
      .map(decorate),
    expired: withExpiry
      .filter((p) => p.stockQuantity > 0 && istDay(p.expiryTo) <= today)
      .map(decorate),
  };
}
