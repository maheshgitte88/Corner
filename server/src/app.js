import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { config } from "./config.js";
import routes from "./routes.js";
export const app = express();
app.disable("x-powered-by");
app.use(helmet());
const origins = new Set([
  config.origin,
  ...(!config.production
    ? ["http://127.0.0.1:5174", "http://localhost:5174"]
    : []),
]);
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    credentials: true,
  }),
);
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    !origins.has(req.headers.origin)
  )
    return res.status(403).json({ message: "Origin is not allowed" });
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", rateLimit({ windowMs: 60 * 1000, limit: 300 }));
app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api", routes);
app.use("/api", (req, res) =>
  res.status(404).json({ message: "API route not found" }),
);
app.use(
  express.static(fileURLToPath(new URL("../../client/dist", import.meta.url))),
);
app.get("/{*path}", (req, res) =>
  res.sendFile(
    fileURLToPath(new URL("../../client/dist/index.html", import.meta.url)),
  ),
);
app.use((err, req, res, next) => {
  if (err instanceof ZodError)
    return res
      .status(400)
      .json({
        message: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
  if (err.code === 11000)
    return res
      .status(409)
      .json({ message: "This SKU, name or checkout reference already exists" });
  const status = err.status || (err.code === "LIMIT_FILE_SIZE" ? 400 : 500);
  if (status >= 500) console.error(err.message);
  res
    .status(status)
    .json({
      message:
        status >= 500
          ? "The operation could not be completed. Please try again."
          : err.message,
    });
});
