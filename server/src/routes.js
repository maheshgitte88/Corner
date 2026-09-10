import { Router } from "express";
import jwt from "jsonwebtoken";
import * as M from "./models.js";
import * as V from "./validations.js";
import auth from "./routes/auth.js";
import catalog from "./routes/catalog.js";
import sales from "./routes/sales.js";
import upload from "./routes/upload.js";
const router = Router();
router.use(auth);
router.use(async (req, res, next) => {
  try {
    const token = jwt.verify(
      req.cookies.counter_session || "",
      process.env.JWT_SECRET,
      { algorithms: ["HS256"] },
    );
    const user = await M.User.findById(token.sub);
    if (!user) throw Error();
    req.user = user;
    next();
  } catch {
    next(V.fail("Please sign in", 401));
  }
});
router.get("/auth/me", (req, res) =>
  res.json({ email: req.user.email, role: req.user.role }),
);
router.param("id", (req, res, next, value) => {
  try {
    V.id.parse(value);
    next();
  } catch {
    next(V.fail("Invalid record ID"));
  }
});
router.use(catalog, sales, upload);
export default router;
