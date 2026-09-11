import { z } from "zod";
export const id = z.string().regex(/^[a-f\d]{24}$/i, "Invalid record ID");
const text = z.string().trim().max(500);
const optional = text.optional().default("");
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
export const product = z.object({
  name: text.min(1),
  sku: text
    .min(1)
    .max(80)
    .transform((s) => s.toUpperCase()),
  barcode: optional,
  category: id.nullable().optional(),
  brand: optional,
  description: optional,
  imageUrl: z
    .union([z.url().startsWith("https://"), z.literal("")])
    .optional()
    .default(""),
  imageKey: optional,
  imageProvider: z.enum(["", "cloudinary", "s3"]).optional().default(""),
  purchasePrice: cents.default(0),
  sellingPrice: cents.min(1),
  taxPercent: z.number().min(0).max(100).default(0),
  stockQuantity: quantity.default(0),
  minimumStock: quantity.default(5),
  unit: z
    .enum(["pcs", "kg", "gram", "litre", "ml", "box", "packet", "custom"])
    .default("pcs"),
  isActive: z.boolean().default(true),
});
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
