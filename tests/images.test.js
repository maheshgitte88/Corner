import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import sharp from "sharp";
import { imageOptions, prepareImage } from "../server/src/storage/images.js";
import {
  storeProductImage,
  providerConfig,
  uploadCloudinary,
  uploadS3,
} from "../server/src/storage/providers.js";
const tenant = "aabbccddeeff001122334455";
const cloudEnv = {
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret",
};
const s3Env = {
  IMAGE_STORAGE_PROVIDER: "s3",
  AWS_REGION: "ap-south-1",
  AWS_S3_BUCKET_NAME: "test-bucket",
};
const fixture = async (format = "png") => ({
  buffer: await sharp({
    create: {
      width: 120,
      height: 90,
      channels: 4,
      background: { r: 120, g: 80, b: 40, alpha: 0.7 },
    },
  })
    [format]()
    .toBuffer(),
  mimetype: format === "jpeg" ? "image/jpeg" : `image/${format}`,
});
test("Cloudinary defaults and compression are explicit, validated environment settings", () => {
  assert.equal(imageOptions({}).provider, "cloudinary");
  assert.equal(imageOptions({}).enabled, false);
  assert.equal(
    imageOptions({
      IMAGE_STORAGE_PROVIDER: "s3",
      IMAGE_COMPRESSION_ENABLED: "TRUE",
    }).enabled,
    true,
  );
  for (const env of [
    { IMAGE_STORAGE_PROVIDER: "other" },
    { IMAGE_COMPRESSION_ENABLED: "yes" },
    { IMAGE_COMPRESSION_ENABLED: "true", IMAGE_COMPRESSION_QUALITY: "101" },
    { IMAGE_COMPRESSION_ENABLED: "true", IMAGE_MAX_WIDTH: "NaN" },
  ])
    assert.throws(() => imageOptions(env));
  assert.doesNotThrow(() =>
    imageOptions({
      IMAGE_COMPRESSION_ENABLED: "false",
      IMAGE_COMPRESSION_QUALITY: "ignored",
    }),
  );
});
test("disabled compression preserves the original PNG, JPEG and WebP bytes", async () => {
  for (const format of ["png", "jpeg", "webp"]) {
    const file = await fixture(format),
      image = await prepareImage(file, imageOptions({}));
    assert.deepEqual(image.buffer, file.buffer);
    assert.equal(image.contentType, file.mimetype);
  }
});
test("enabled compression resizes to configured bounds and encodes WebP", async () => {
  const file = await fixture();
  const output = await prepareImage(
    file,
    imageOptions({
      IMAGE_COMPRESSION_ENABLED: "true",
      IMAGE_MAX_WIDTH: "64",
      IMAGE_MAX_HEIGHT: "64",
      IMAGE_COMPRESSION_QUALITY: "65",
    }),
  );
  const metadata = await sharp(output.buffer).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 48);
  assert.ok(metadata.hasAlpha);
  assert.equal(output.contentType, "image/webp");
  assert.equal(output.extension, "webp");
  assert.notDeepEqual(file.buffer, output.buffer);
  const small = await prepareImage(
    file,
    imageOptions({ IMAGE_COMPRESSION_ENABLED: "true" }),
  );
  assert.equal((await sharp(small.buffer).metadata()).width, 120);
});
test("validation rejects corrupt, mismatched and oversized images even without compression", async () => {
  const file = await fixture();
  for (const value of [
    undefined,
    { ...file, mimetype: "image/jpeg" },
    {
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      mimetype: "image/png",
    },
    { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: "image/png" },
  ])
    await assert.rejects(
      () => prepareImage(value, imageOptions({})),
      (e) => e.status === 400,
    );
});
test("provider switching routes uploads and keeps tenant keys and provider metadata", async () => {
  const file = await fixture();
  let captured = [];
  const adapters = Object.fromEntries(
    ["cloudinary", "s3"].map((provider) => [
      provider,
      async (image, key, config) => {
        captured.push({ provider, image, key, config });
        return {
          imageKey: key + "." + image.extension,
          imageUrl: "https://example.test/" + key,
        };
      },
    ]),
  );
  const first = await storeProductImage(file, tenant, {
    env: cloudEnv,
    adapters,
  });
  assert.equal(first.imageProvider, "cloudinary");
  assert.deepEqual(captured[0].image.buffer, file.buffer);
  assert.ok(captured[0].key.startsWith(`tenants/${tenant}/products/`));
  const second = await storeProductImage(file, tenant, {
    env: { ...s3Env, IMAGE_COMPRESSION_ENABLED: "true" },
    adapters,
  });
  assert.equal(second.imageProvider, "s3");
  assert.equal(captured[1].image.contentType, "image/webp");
  assert.notEqual(first.imageKey, second.imageKey);
  assert.ok(first.imageUrl.startsWith("https://example.test/"));
  await assert.rejects(
    () =>
      storeProductImage(file, "../another-tenant", { env: cloudEnv, adapters }),
    (e) => e.status === 403,
  );
});
test("only the selected provider needs credentials and failures are sanitized", async () => {
  assert.equal(providerConfig("cloudinary", cloudEnv).cloud_name, "test-cloud");
  assert.equal(providerConfig("s3", s3Env).bucket, "test-bucket");
  assert.throws(
    () => providerConfig("cloudinary", s3Env),
    (e) => e.status === 503,
  );
  assert.throws(
    () => providerConfig("s3", cloudEnv),
    (e) => e.status === 503,
  );

  const file = await fixture();
  await assert.rejects(
    () =>
      storeProductImage(file, tenant, {
        env: cloudEnv,
        adapters: {
          cloudinary: async () => {
            throw new Error("private provider details");
          },
        },
      }),
    (e) => e.status === 502 && !e.message.includes("private"),
  );
});
test("S3 adapter uploads the prepared bytes with matching key extension and MIME", async () => {
  const image = await prepareImage(
    await fixture(),
    imageOptions({ IMAGE_COMPRESSION_ENABLED: "true" }),
  );
  let command;
  const result = await uploadS3(
    image,
    `tenants/${tenant}/products/test`,
    { bucket: "bucket", region: "ap-south-1", baseUrl: "https://cdn.test" },
    {
      send: async (value) => {
        command = value;
      },
    },
  );
  assert.equal(command.input.ContentType, "image/webp");
  assert.deepEqual(command.input.Body, image.buffer);
  assert.equal(command.input.Key, `tenants/${tenant}/products/test.webp`);
  assert.equal(result.imageUrl, "https://cdn.test/" + command.input.Key);
});
test("Cloudinary streams prepared bytes securely without provider-side transformations", async () => {
  const image = await prepareImage(await fixture(), imageOptions({}));
  let options, bytes;
  const sdk = {
    uploader: {
      upload_stream: (opts, callback) => {
        options = opts;
        return new Writable({
          write(chunk, encoding, next) {
            bytes = chunk;
            next();
          },
          final(next) {
            callback(null, {
              secure_url:
                "https://res.cloudinary.com/test/image/upload/test.png",
              public_id: opts.public_id,
            });
            next();
          },
        });
      },
    },
  };
  const result = await uploadCloudinary(
    image,
    `tenants/${tenant}/products/test`,
    providerConfig("cloudinary", cloudEnv),
    sdk,
  );
  assert.deepEqual(bytes, image.buffer);
  assert.equal(options.overwrite, false);
  assert.equal(options.resource_type, "image");
  assert.equal(options.cloud_name, "test-cloud");
  assert.equal(options.transformation, undefined);
  assert.equal(options.quality, undefined);
  assert.equal(result.imageKey, `tenants/${tenant}/products/test`);
});
