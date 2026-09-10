import { Router } from "express";
import { z } from "zod";
import * as M from "../models.js";
import * as V from "../validations.js";
const router = Router();
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { config } from "../config.js";
const cookie = {
  httpOnly: true,
  secure: config.production,
  sameSite: "strict",
  path: "/api",
  maxAge: 8 * 60 * 60 * 1000,
};
router.post(
  "/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }),
  async (req, res) => {
    const input = z
      .object({
        email: z.email().transform((s) => s.toLowerCase()),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const user = await M.User.findOne({ email: input.email });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
      throw V.fail("Email or password is incorrect", 401);
    res
      .cookie(
        "counter_session",
        jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, {
          expiresIn: "8h",
          algorithm: "HS256",
        }),
        cookie,
      )
      .json({ email: user.email, role: user.role });
  },
);
router.post("/auth/logout", (req, res) =>
  res.clearCookie("counter_session", cookie).json({ ok: true }),
);
export default router;
