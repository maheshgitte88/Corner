import { z } from "zod";
import { id } from "./validations.js";
const text = z.string().trim().max(500);
export const password = z.string().min(12).max(128);
export const packageInput = z.object({
  name: text.min(2).max(80),
  description: text.default(""),
  monthlyPrice: z.number().int().min(0).max(1e9),
  yearlyPrice: z.number().int().min(0).max(1e10),
  maxProducts: z.number().int().min(1).max(1000000),
  maxUsers: z.number().int().min(1).max(1000),
  reportsEnabled: z.boolean(),
  imagesEnabled: z.boolean(),
  isActive: z.boolean().default(true),
});
export const billingInput = z.object({
  planId: id,
  cycle: z.enum(["monthly", "yearly"]),
  paymentMethod: z.enum(["Cash", "UPI", "Card", "Bank Transfer", "Other"]),
  paymentReference: text.min(1),
  note: text.default(""),
  idempotencyKey: z.uuid(),
});
export const onboardInput = billingInput.extend({
  name: text.min(2).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(50),
  ownerName: text.min(1).max(100),
  ownerEmail: z.email().transform((s) => s.toLowerCase()),
  ownerPassword: password,
  phone: text.max(30).default(""),
  trialDays: z.number().int().min(0).max(30).default(0),
});
export const renewInput = billingInput.extend({
  mode: z.enum(["extend", "replace"]),
  revision: z.number().int().min(0),
});
export const memberInput = z.object({
  name: text.min(1).max(100),
  email: z.email().transform((s) => s.toLowerCase()),
  password,
  role: z.enum(["client_admin", "cashier"]),
});
