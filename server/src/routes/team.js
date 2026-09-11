import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../models.js";
import { id, fail } from "../validations.js";
import { memberInput, password } from "../saas-validations.js";
import { reserveCapacity, audit } from "../saas-services.js";
const router = Router();
router.get("/team", async (req, res) =>
  res.json(
    await User.find({ tenantId: req.tenant.id }).select(
      "name email role isActive mustChangePassword createdAt",
    ),
  ),
);
router.post("/team", async (req, res) => {
  const input = memberInput.parse(req.body),
    passwordHash = await bcrypt.hash(input.password, 12);
  const user = await mongoose.connection.transaction(async (session) => {
    await reserveCapacity(req.tenant.id, req.models, "users", session);
    const [user] = await User.create(
      [
        {
          name: input.name,
          email: input.email,
          role: input.role,
          passwordHash,
          tenantId: req.tenant.id,
          mustChangePassword: true,
        },
      ],
      { session },
    );
    await audit(
      req.user,
      req.tenant.id,
      "team.created",
      { email: user.email, role: user.role },
      session,
    );
    return user;
  });
  res.status(201).json({ id: user.id, email: user.email });
});
router.patch("/team/:id", async (req, res) => {
  id.parse(req.params.id);
  const input = z.object({ isActive: z.boolean() }).parse(req.body);
  if (req.params.id === req.user.id)
    throw fail("You cannot deactivate your own account");
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({
      _id: req.params.id,
      tenantId: req.tenant.id,
    }).session(session);
    if (!user) throw fail("Team member not found", 404);
    if (user.email === req.tenant.ownerEmail)
      throw fail("The client owner must remain active");
    if (input.isActive && !user.isActive)
      await reserveCapacity(req.tenant.id, req.models, "users", session);
    user.isActive = input.isActive;
    user.tokenVersion++;
    await user.save({ session });
    await audit(
      req.user,
      req.tenant.id,
      "team.status_changed",
      { email: user.email, isActive: user.isActive },
      session,
    );
  });
  res.json({ ok: true });
});
router.post("/team/:id/reset-password", async (req, res) => {
  id.parse(req.params.id);
  const input = z.object({ password }).parse(req.body);
  if (req.params.id === req.user.id)
    throw fail("Use Change password for your own account");
  const passwordHash = await bcrypt.hash(input.password, 12);
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenant.id },
      {
        $set: { passwordHash, mustChangePassword: true },
        $inc: { tokenVersion: 1 },
      },
      { new: true, session },
    );
    if (!user) throw fail("Team member not found", 404);
    await audit(
      req.user,
      req.tenant.id,
      "team.password_reset",
      { email: user.email },
      session,
    );
  });
  res.json({ ok: true });
});
export default router;
