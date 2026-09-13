import mongoose from "mongoose";
import { createHash } from "node:crypto";
import * as legacy from "./models.js";
const names = [
  "Product",
  "Category",
  "Customer",
  "InventoryTransaction",
  "Invoice",
  "ShopSettings",
  "Counter",
];
const initialized = new Map();
export function tenantDatabaseName(tenantId) {
  if (!mongoose.isValidObjectId(tenantId))
    throw new Error("A verified tenant ID is required");
  // Atlas shared clusters limit names to 38 bytes. Full ObjectId (24) +
  // platform hash (8) + separator stays at 33.
  const platform = createHash("sha256")
    .update(mongoose.connection.name)
    .digest("hex")
    .slice(0, 8);
  return `${platform}_${tenantId}`;
}
export function tenantModels(tenantId) {
  const connection = mongoose.connection.useDb(tenantDatabaseName(tenantId), {
    useCache: true,
  });
  return Object.fromEntries(
    names.map((name) => [
      name,
      connection.models[name] ||
        connection.model(name, legacy[name].schema.clone()),
    ]),
  );
}
export async function readyTenant(tenantId) {
  const key = String(tenantId);
  const models = tenantModels(key);
  if (!initialized.has(key))
    initialized.set(
      key,
      (async () => {
        await legacy.ensureProductIndexes(models.Product.db);
        await Promise.all(
          Object.values(models)
            .filter((m) => typeof m?.init === "function")
            .map((m) => m.init()),
        );
      })().catch((e) => {
        initialized.delete(key);
        throw e;
      }),
    );
  await initialized.get(key);
  return models;
}
