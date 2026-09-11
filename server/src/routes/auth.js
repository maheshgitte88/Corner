import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { User } from "../models.js";
import { fail } from "../validations.js";
import { config } from "../config.js";
const router = Router();
const cookie = {
  httpOnly: true,
  secure: config.production,
  sameSite: "strict",
  path: "/api",
  maxAge: 8 * 60 * 60 * 1000,
};
router.post(
  "/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }),
  async (req, res) => {
    const input = z
      .object({
        email: z.email().transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(128),
      })
      .parse(req.body);
    const user = await User.findOne({ email: input.email });
    if (
      !user ||
      !user.isActive ||
      !(await bcrypt.compare(input.password, user.passwordHash))
    )
      throw fail("Email or password is incorrect", 401);
    res
      .cookie(
        "counter_session",
        jwt.sign(
          { sub: user.id, version: user.tokenVersion || 0 },
          process.env.JWT_SECRET,
          { expiresIn: "8h", algorithm: "HS256" },
        ),
        cookie,
      )
      .json({
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      });
  },
);
router.post("/auth/logout", (req, res) =>
  res.clearCookie("counter_session", cookie).json({ ok: true }),
);
export default router;
