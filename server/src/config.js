import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
export const config = {
  port: Number(process.env.PORT || 4100),
  origin: process.env.CLIENT_URL || "http://localhost:5174",
  production: process.env.NODE_ENV === "production",
};
export async function connect() {
  if (!process.env.MONGODB_URI)
    throw new Error(
      "Set MONGODB_URI in server/.env. MongoDB must be a replica set or Atlas.",
    );
  if (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    process.env.JWT_SECRET.startsWith("replace-")
  )
    throw new Error("Set a random JWT_SECRET of at least 32 characters.");
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid")
    throw new Error("Transactions require MongoDB Atlas or a replica set.");
}
