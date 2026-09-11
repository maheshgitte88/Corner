import mongoose from "mongoose";
const { Schema } = mongoose;
const opts = { timestamps: true };
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });
const model = (name, fields) => mongoose.model(name, new Schema(fields, opts));
export const Product = model("Product", {
  name: { type: String, required: true },
  sku: { type: String, required: true, unique: true },
  barcode: String,
  category: ref("Category"),
  brand: String,
  description: String,
  imageUrl: String,
  imageKey: String,
  imageProvider: { type: String, enum: ["", "cloudinary", "s3"], default: "" },
  purchasePrice: { type: Number, default: 0 },
  sellingPrice: { type: Number, required: true, min: 1 },
  taxPercent: { type: Number, default: 0 },
  stockQuantity: { type: Number, default: 0, min: 0 },
  minimumStock: { type: Number, default: 5 },
  unit: { type: String, default: "pcs" },
  isActive: { type: Boolean, default: true },
});
export const Category = model("Category", {
  name: { type: String, required: true, unique: true },
  description: String,
  isActive: { type: Boolean, default: true },
});
export const Customer = model("Customer", {
  name: { type: String, required: true },
  phone: String,
  email: String,
  address: String,
  gstNumber: String,
});
export const InventoryTransaction = model("InventoryTransaction", {
  productId: ref("Product"),
  transactionType: String,
  previousQuantity: Number,
  quantityChange: Number,
  newQuantity: Number,
  referenceType: String,
  referenceId: String,
  note: String,
  user: ref("User"),
});
export const Invoice = model("Invoice", {
  invoiceNumber: { type: String, unique: true },
  idempotencyKey: { type: String, unique: true },
  requestHash: String,
  customer: ref("Customer"),
  customerSnapshot: Schema.Types.Mixed,
  shopSnapshot: Schema.Types.Mixed,
  items: [Schema.Types.Mixed],
  subtotal: Number,
  itemDiscount: Number,
  billDiscount: Number,
  discount: Number,
  tax: Number,
  roundOff: Number,
  grandTotal: Number,
  amountPaid: Number,
  balance: Number,
  paymentMethod: String,
  status: { type: String, default: "Completed" },
  cancellationReason: String,
  cancelledAt: Date,
  user: ref("User"),
});
export const ShopSettings = model("ShopSettings", {
  singleton: { type: String, unique: true, default: "shop" },
  shopName: { type: String, default: "Your neighbourhood store" },
  logoUrl: String,
  address: String,
  phone: String,
  email: String,
  gstNumber: String,
  currency: { type: String, default: "INR" },
  invoicePrefix: { type: String, default: "INV" },
  defaultTax: { type: Number, default: 0 },
  invoiceFooter: {
    type: String,
    default: "Thank you for shopping with us. See you again!",
  },
  printFormat: { type: String, default: "A4" },
});
export const User = model("User", {
  email: { type: String, unique: true },
  passwordHash: String,
  role: {
    type: String,
    enum: ["platform_admin", "client_admin", "cashier"],
    default: "client_admin",
  },
  tenantId: ref("Tenant"),
  name: String,
  isActive: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0 },
});
export const Counter = model("Counter", {
  key: { type: String, unique: true },
  value: { type: Number, default: 0 },
});
Invoice.schema.index({ createdAt: -1 });
InventoryTransaction.schema.index({ productId: 1, createdAt: -1 });
Product.schema.index({ barcode: 1 });
