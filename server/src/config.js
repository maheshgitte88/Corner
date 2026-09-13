import dns from "node:dns";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
// Windows home-router DNS often refuses Node SRV/TXT lookups used by mongodb+srv.
if (
  process.platform === "win32" &&
  process.env.MONGODB_URI?.startsWith("mongodb+srv://")
)
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
export const config = {
  port: Number(process.env.PORT || 4100),
  origin: process.env.CLIENT_URL || "http://localhost:5174",
  production: process.env.NODE_ENV === "production",
  publicAppUrl: (
    process.env.PUBLIC_APP_URL ||
    process.env.CLIENT_URL ||
    "http://localhost:5174"
  ).replace(/\/$/, ""),
  vobiz: {
    authId: process.env.VOBIZ_AUTH_ID || "",
    authToken: process.env.VOBIZ_AUTH_TOKEN || "",
    channelId: process.env.VOBIZ_CHANNEL_ID || "",
    wabaId: process.env.VOBIZ_WABA_ID || "",
    template: process.env.VOBIZ_INVOICE_TEMPLATE || "invoice_ready",
    language: process.env.VOBIZ_TEMPLATE_LANGUAGE || "en",
  },
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
