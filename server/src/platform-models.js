import mongoose from "mongoose";
const { Schema } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });
const model = (name, fields) =>
  mongoose.model(name, new Schema(fields, { timestamps: true }));
export const Package = model("Package", {
  name: { type: String, required: true, unique: true },
  description: String,
  monthlyPrice: { type: Number, required: true, min: 0 },
  yearlyPrice: { type: Number, required: true, min: 0 },
  maxProducts: { type: Number, required: true, min: 1 },
  maxUsers: { type: Number, required: true, min: 1 },
  reportsEnabled: { type: Boolean, default: true },
  imagesEnabled: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});
export const Tenant = model("Tenant", {
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  ownerEmail: { type: String, required: true },
  phone: String,
  notes: String,
  status: { type: String, enum: ["active", "suspended"], default: "active" },
  subscription: {
    planId: ref("Package"),
    planSnapshot: Schema.Types.Mixed,
    cycle: { type: String, enum: ["monthly", "yearly"] },
    state: { type: String, enum: ["active", "trial"] },
    startsAt: Date,
    endsAt: Date,
  },
  revision: { type: Number, default: 0 },
  usageRevision: { type: Number, default: 0 },
});
export const SubscriptionPayment = model("SubscriptionPayment", {
  tenantId: ref("Tenant"),
  receiptNumber: { type: String, unique: true },
  idempotencyKey: { type: String, unique: true },
  requestHash: String,
  clientSnapshot: Schema.Types.Mixed,
  planSnapshot: Schema.Types.Mixed,
  cycle: String,
  amount: Number,
  paymentMethod: String,
  paymentReference: String,
  note: String,
  periodStart: Date,
  periodEnd: Date,
  actor: ref("User"),
});
export const AuditEvent = model("AuditEvent", {
  actor: ref("User"),
  actorEmail: String,
  tenantId: ref("Tenant"),
  action: String,
  details: Schema.Types.Mixed,
});
export const PlatformCounter = model("PlatformCounter", {
  key: { type: String, unique: true },
  value: { type: Number, default: 0 },
});
