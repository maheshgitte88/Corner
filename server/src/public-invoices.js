import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { PublicInvoiceLink } from "./platform-models.js";
import { readyTenant } from "./tenant-db.js";
import { fail } from "./validations.js";

const tokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,48}$/);

export function shareUrl(token) {
  return `${config.publicAppUrl}/b/${token}`;
}

export function publicInvoicePayload(invoice) {
  const body = invoice.toObject ? invoice.toObject() : { ...invoice };
  delete body.idempotencyKey;
  delete body.requestHash;
  delete body.user;
  delete body.__v;
  return body;
}

export async function ensurePublicLink(tenantId, invoiceId) {
  const existing = await PublicInvoiceLink.findOne({ tenantId, invoiceId });
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    try {
      return await PublicInvoiceLink.create({
        token: randomBytes(18).toString("base64url"),
        tenantId,
        invoiceId,
      });
    } catch (e) {
      if (e.code !== 11000) throw e;
      const again = await PublicInvoiceLink.findOne({ tenantId, invoiceId });
      if (again) return again;
    }
  }
  throw fail("Could not create a public invoice link", 500);
}

export function withShare(invoice, link) {
  return {
    ...publicInvoicePayload(invoice),
    shareUrl: shareUrl(link.token),
  };
}

export const publicInvoices = Router();
publicInvoices.get("/invoices/:token", async (req, res) => {
  const token = tokenSchema.parse(req.params.token);
  const link = await PublicInvoiceLink.findOne({ token });
  if (!link) throw fail("Invoice link not found", 404);
  const models = await readyTenant(link.tenantId);
  const invoice = await models.Invoice.findById(link.invoiceId);
  if (!invoice) throw fail("Invoice link not found", 404);
  res.json(publicInvoicePayload(invoice));
});
