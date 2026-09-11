import sharp from "sharp";
import { fail } from "../validations.js";
const formats = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
export function imageOptions(env = process.env) {
  const provider = (env.IMAGE_STORAGE_PROVIDER || "cloudinary")
    .trim()
    .toLowerCase();
  if (!["cloudinary", "s3"].includes(provider))
    throw fail("IMAGE_STORAGE_PROVIDER must be cloudinary or s3", 503);
  const flag = (env.IMAGE_COMPRESSION_ENABLED || "false").trim().toLowerCase();
  if (!["true", "false"].includes(flag))
    throw fail("IMAGE_COMPRESSION_ENABLED must be true or false", 503);
  const enabled = flag === "true";
  const integer = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw fail(`${key} must be an integer between ${min} and ${max}`, 503);
    return value;
  };
  return {
    provider,
    enabled,
    quality: enabled ? integer("IMAGE_COMPRESSION_QUALITY", 80, 1, 100) : 80,
    maxWidth: enabled ? integer("IMAGE_MAX_WIDTH", 1600, 64, 8192) : 1600,
    maxHeight: enabled ? integer("IMAGE_MAX_HEIGHT", 1600, 64, 8192) : 1600,
  };
}
export async function prepareImage(file, options) {
  if (!file?.buffer) throw fail("Choose an image");
  if (file.buffer.length > 5 * 1024 * 1024)
    throw fail("Images must be 5 MB or smaller");
  if (!Object.values(formats).includes(file.mimetype))
    throw fail("Upload a valid PNG, JPEG or WebP image");
  try {
    const image = sharp(file.buffer, {
      limitInputPixels: 20000000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (formats[metadata.format] !== file.mimetype)
      throw new Error("MIME mismatch");
    if ((metadata.pages || 1) > 1)
      throw fail(
        "Animated images are not supported. Upload a still PNG, JPEG or WebP image.",
      );
    if (!options.enabled) {
      // Fully decode for validation, but send the exact original bytes when compression is off.
      await image.stats();
      return {
        buffer: file.buffer,
        contentType: file.mimetype,
        extension: metadata.format === "jpeg" ? "jpg" : metadata.format,
      };
    }
    const buffer = await image
      .rotate()
      .resize({
        width: options.maxWidth,
        height: options.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: options.quality })
      .toBuffer();
    return { buffer, contentType: "image/webp", extension: "webp" };
  } catch (error) {
    if (error.status) throw error;
    throw fail(
      "Invalid or oversized image. Use a still PNG, JPEG or WebP image up to 20 megapixels.",
    );
  }
}
