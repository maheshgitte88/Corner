import { v2 as cloudinary } from "cloudinary";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { fail } from "../validations.js";
import { imageOptions, prepareImage } from "./images.js";
export function providerConfig(provider, env = process.env) {
  if (provider === "cloudinary") {
    const {
      CLOUDINARY_CLOUD_NAME: cloud_name,
      CLOUDINARY_API_KEY: api_key,
      CLOUDINARY_API_SECRET: api_secret,
    } = env;
    if (!cloud_name || !api_key || !api_secret)
      throw fail("Cloudinary image storage is not configured", 503);
    return { cloud_name, api_key, api_secret, secure: true };
  }
  const bucket = env.AWS_S3_BUCKET_NAME,
    region = env.AWS_REGION;
  if (!bucket || !region) throw fail("S3 image storage is not configured", 503);
  return {
    bucket,
    region,
    baseUrl: (
      env.S3_PUBLIC_BASE_URL || `https://${bucket}.s3.${region}.amazonaws.com`
    ).replace(/\/$/, ""),
  };
}
export async function uploadCloudinary(image, key, config, sdk = cloudinary) {
  const result = await new Promise((resolve, reject) => {
    const stream = sdk.uploader.upload_stream(
      { ...config, public_id: key, resource_type: "image", overwrite: false },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.on("error", reject);
    stream.end(image.buffer);
  });
  if (!result?.secure_url?.startsWith("https://") || !result.public_id)
    throw new Error("Invalid image provider response");
  return { imageUrl: result.secure_url, imageKey: result.public_id };
}
export async function uploadS3(
  image,
  key,
  config,
  client = new S3Client({ region: config.region }),
) {
  const imageKey = `${key}.${image.extension}`;
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: imageKey,
      Body: image.buffer,
      ContentType: image.contentType,
    }),
  );
  return { imageKey, imageUrl: `${config.baseUrl}/${imageKey}` };
}
export async function storeProductImage(
  file,
  tenantId,
  {
    env = process.env,
    adapters = { cloudinary: uploadCloudinary, s3: uploadS3 },
  } = {},
) {
  if (!/^[a-f0-9]{24}$/i.test(String(tenantId)))
    throw fail("A verified client workspace is required", 403);
  const options = imageOptions(env);
  const image = await prepareImage(file, options);
  const config = providerConfig(options.provider, env);
  const key = `tenants/${tenantId}/products/${randomUUID()}`;
  try {
    const result = await adapters[options.provider](image, key, config);
    return { ...result, imageProvider: options.provider };
  } catch {
    throw fail("Image upload failed. Please try again.", 502);
  }
}
