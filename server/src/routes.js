import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "./models.js";
import { Tenant, SubscriptionPayment } from "./platform-models.js";
import { readyTenant } from "./tenant-db.js";
import { accessStatus, audit } from "./saas-services.js";
import { password } from "./saas-validations.js";
import { fail } from "./validations.js";
import auth from "./routes/auth.js";
import platform from "./routes/platform.js";
import team from "./routes/team.js";
import catalog from "./routes/catalog.js";
import sales from "./routes/sales.js";
import upload from "./routes/upload.js";
const router = Router();
router.use(auth);
router.use(async (req, res, next) => {
  let token;
  try {
    token = jwt.verify(
      req.cookies.counter_session || "",
      process.env.JWT_SECRET,
      { algorithms: ["HS256"] },
    );
  } catch {
    return next(fail("Please sign in", 401));
  }
  const user = await User.findById(token.sub);
  if (!user || !user.isActive || token.version !== (user.tokenVersion || 0))
    return next(fail("Please sign in again", 401));
  req.user = user;
  next();
});
router.get("/auth/me", async (req, res) => {
  const tenant = req.user.tenantId
    ? await Tenant.findById(req.user.tenantId)
    : null;
  res.json({
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
    mustChangePassword: req.user.mustChangePassword,
    tenant: tenant
      ? {
          _id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          subscription: tenant.subscription,
          access: accessStatus(tenant),
        }
      : null,
  });
});
router.post("/auth/password", async (req, res) => {
  const input = z
    .object({
      currentPassword: z.string().min(1).max(128),
      newPassword: password,
    })
    .parse(req.body);
  if (!(await bcrypt.compare(input.currentPassword, req.user.passwordHash)))
    throw fail("Current password is incorrect");
  if (input.currentPassword === input.newPassword)
    throw fail("Choose a different password");
  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await User.updateOne(
    { _id: req.user.id },
    {
      $set: { passwordHash, mustChangePassword: false },
      $inc: { tokenVersion: 1 },
    },
  );
  res.clearCookie("counter_session", { path: "/api" }).json({ ok: true });
});
router.use((req, res, next) =>
  req.user.mustChangePassword
    ? next(fail("Change your temporary password before continuing", 403))
    : next(),
);
router.use(
  "/platform",
  (req, res, next) =>
    req.user.role === "platform_admin"
      ? next()
      : next(fail("Platform administrator access required", 403)),
  platform,
);
router.use(async (req, res, next) => {
  if (
    !req.user.tenantId ||
    !["client_admin", "cashier"].includes(req.user.role)
  )
    return next(fail("A client account is required for shop operations", 403));
  req.tenant = await Tenant.findById(req.user.tenantId);
  if (!req.tenant) return next(fail("Client account not found", 403));
  req.models = await readyTenant(req.tenant.id);
  next();
});
router.get("/subscription", async (req, res) =>
  res.json({
    tenant: {
      _id: req.tenant.id,
      name: req.tenant.name,
      slug: req.tenant.slug,
      ownerEmail: req.tenant.ownerEmail,
      status: req.tenant.status,
      subscription: req.tenant.subscription,
    },
    access: accessStatus(req.tenant),
    usage: {
      products: await req.models.Product.countDocuments({
        isActive: true,
        kind: { $ne: "parent" },
      }),
      users: await User.countDocuments({
        tenantId: req.tenant.id,
        isActive: true,
      }),
    },
    payments:
      req.user.role === "client_admin"
        ? await SubscriptionPayment.find({ tenantId: req.tenant.id })
            .select("-requestHash -idempotencyKey")
            .sort({ createdAt: -1 })
        : [],
  }),
);
router.use((req, res, next) => {
  const status = accessStatus(req.tenant);
  const path = req.path.toLowerCase();
  if (
    ["expired", "suspended"].includes(status) &&
    !["GET", "HEAD"].includes(req.method)
  )
    return next(
      fail(
        `Your workspace is ${status}. Contact the platform administrator to renew or reactivate.`,
        403,
      ),
    );
  if (
    req.user.role === "cashier" &&
    ((!["GET", "HEAD"].includes(req.method) &&
      !(req.method === "POST" && path.replace(/\/$/, "") === "/invoices")) ||
      path.startsWith("/team") ||
      path.startsWith("/reports"))
  )
    return next(fail("Shop administrator access required", 403));
  const plan = req.tenant.subscription.planSnapshot;
  if (path.startsWith("/reports") && !plan.reportsEnabled)
    return next(fail("Sales reports are not included in your package", 403));
  if (path.startsWith("/upload") && !plan.imagesEnabled)
    return next(fail("Image uploads are not included in your package", 403));
  next();
});
router.use(team, catalog, sales, upload);
export default router;
