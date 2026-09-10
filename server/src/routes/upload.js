import { Router } from "express";
import { z } from "zod";
import * as M from "../models.js";
import * as V from "../validations.js";
const router = Router();
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
router.post(
  "/upload/product-image",
  upload.single("image"),
  async (req, res) => {
    const f = req.file;
    if (!f) throw V.fail("Choose an image");
    const b = f.buffer;
    const type = b
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : b[0] === 255 && b[1] === 216 && b[2] === 255
        ? "image/jpeg"
        : b.toString("ascii", 0, 4) === "RIFF" &&
            b.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : null;
    if (!type || type !== f.mimetype)
      throw V.fail("Upload a valid PNG, JPEG or WebP image");
    const bucket = process.env.AWS_S3_BUCKET_NAME,
      region = process.env.AWS_REGION;
    if (!bucket || !region)
      throw V.fail(
        "Image storage is not configured. Products can be saved without images.",
        503,
      );
    const key = `products/${randomUUID()}.${type.split("/")[1]}`;
    const client = new S3Client({ region });
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: b,
          ContentType: type,
        }),
      );
    } catch {
      throw V.fail("Image upload failed. Please try again.", 502);
    }
    res.json({
      imageKey: key,
      imageUrl: `${(process.env.S3_PUBLIC_BASE_URL || `https://${bucket}.s3.${region}.amazonaws.com`).replace(/\/$/, "")}/${key}`,
    });
  },
);
export default router;
