import mongoose from "mongoose";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";

import { calculate } from "../../shared/billing.js";
import { fail } from "./validations.js";
export async function atomic(work) {
  return mongoose.connection.transaction(work);
}
export async function changeStock(
  product,
  next,
  type,
  note,
  user,
  session,
  referenceId = "",
  models,
) {
  const { Product, InventoryTransaction } = models;
  if (next < 0) throw fail("Insufficient stock", 409);
  if (product.kind === "parent")
    throw fail("Parent products do not hold stock", 400);
  if (
    !["kg", "gram", "litre", "ml"].includes(product.unit) &&
    !Number.isInteger(next)
  )
    throw fail("This product requires whole quantities");
  const previous = product.stockQuantity;
  const changed = await Product.updateOne(
    { _id: product._id, stockQuantity: previous },
    { $set: { stockQuantity: next } },
    { session },
  );
  if (!changed.modifiedCount && previous !== next)
    throw fail("Stock changed. Try again.", 409);
  await InventoryTransaction.create(
    [
      {
        productId: product._id,
        previousQuantity: previous,
        quantityChange: new Decimal(next).minus(previous).toNumber(),
        newQuantity: next,
        transactionType: type,
        note,
        user,
        referenceType: referenceId ? "Invoice" : "Manual",
        referenceId,
      },
    ],
    { session },
  );
}
export async function checkout(input, user, models) {
  const { Product, Invoice, Customer, ShopSettings, Counter } = models;
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const previous = await Invoice.findOne({
    idempotencyKey: input.idempotencyKey,
  });
  if (previous) {
    if (previous.requestHash !== requestHash)
      throw fail("Checkout key already used for another bill", 409);
    return previous;
  }
  const sequenceYear = new Date().getFullYear();
  await Counter.updateOne(
    { key: `invoice-${sequenceYear}` },
    { $setOnInsert: { value: 0 } },
    { upsert: true },
  ).catch((e) => {
    if (e.code !== 11000) throw e;
  });
  try {
    return await atomic(async (session) => {
      const existing = await Invoice.findOne({
        idempotencyKey: input.idempotencyKey,
      }).session(session);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw fail("Checkout key already used", 409);
        return existing;
      }
      const products = await Product.find({
        _id: { $in: input.items.map((i) => i.productId) },
        isActive: true,
      }).session(session);
      const lines = input.items.map((item) => {
        const p = products.find((p) => p.id === item.productId);
        if (!p) throw fail("A product is no longer available", 409);
        if (p.kind === "parent")
          throw fail("Choose a product size or pack before checkout", 409);
        if (!["standalone", "variant"].includes(p.kind || "standalone"))
          throw fail("A product is no longer available", 409);
        if (p.stockQuantity < item.quantity)
          throw fail(
            `Insufficient stock for ${p.variantLabel ? `${p.name} · ${p.variantLabel}` : p.name}`,
            409,
          );
        return {
          productId: p.id,
          productName: p.name,
          variantLabel: p.variantLabel || "",
          sku: p.sku,
          unit: p.unit,
          quantity: item.quantity,
          unitPrice: p.sellingPrice,
          taxPercent: p.taxPercent,
          discount: item.discount,
        };
      });
      let totals;
      try {
        totals = calculate(lines, input.discount, input.amountPaid);
      } catch (e) {
        throw fail(e.message);
      }
      const shop = await ShopSettings.findOne().session(session).lean();
      const year = new Date().getFullYear();
      const counter = await Counter.findOneAndUpdate(
        { key: `invoice-${year}` },
        { $inc: { value: 1 } },
        { upsert: true, new: true, session },
      );
      const cust = input.customerId
        ? await Customer.findById(input.customerId).session(session).lean()
        : input.customer;
      if (input.customerId && !cust) throw fail("Customer not found", 404);
      const [invoice] = await Invoice.create(
        [
          {
            ...totals,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            invoiceNumber: `${shop?.invoicePrefix || "INV"}-${year}-${String(counter.value).padStart(6, "0")}`,
            customer: input.customerId,
            customerSnapshot: cust || { name: "Walk-in Customer" },
            shopSnapshot: shop || { shopName: "Counter" },
            paymentMethod: input.paymentMethod,
            user,
          },
        ],
        { session },
      );
      for (const line of lines) {
        const p = products.find((p) => p.id === line.productId);
        await changeStock(
          p,
          new Decimal(p.stockQuantity).minus(line.quantity).toNumber(),
          "Sale",
          "Sale completed",
          user,
          session,
          invoice.id,
          models,
        );
      }
      return invoice;
    });
  } catch (e) {
    if (e.code === 11000) {
      const saved = await Invoice.findOne({
        idempotencyKey: input.idempotencyKey,
      });
      if (saved && saved.requestHash === requestHash) return saved;
    }
    throw e;
  }
}
export async function cancel(id, reason, user, models) {
  const { Product, Invoice } = models;
  return atomic(async (session) => {
    const invoice = await Invoice.findById(id).session(session);
    if (!invoice) throw fail("Invoice not found", 404);
    if (invoice.status !== "Completed")
      throw fail("Invoice has already been cancelled", 409);
    invoice.status = "Cancelled";
    invoice.cancellationReason = reason;
    invoice.cancelledAt = new Date();
    await invoice.save({ session });
    for (const line of invoice.items) {
      const p = await Product.findById(line.productId).session(session);
      if (!p) throw fail("Product missing; cancellation aborted", 409);
      await changeStock(
        p,
        new Decimal(p.stockQuantity).plus(line.quantity).toNumber(),
        "Cancellation",
        reason,
        user,
        session,
        invoice.id,
        models,
      );
    }
    return invoice;
  });
}
