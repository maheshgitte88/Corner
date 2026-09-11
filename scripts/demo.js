import { MongoMemoryReplSet } from "mongodb-memory-server";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
const root = fileURLToPath(new URL("../", import.meta.url));
const demoPort = process.env.DEMO_PORT || "4100";
const demoDir = path.join(root, ".local-demo");
fs.mkdirSync(demoDir, { recursive: true });
const envFile = path.join(demoDir, ".env");
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(
    envFile,
    `ADMIN_EMAIL=demo@counter.local\nADMIN_PASSWORD=${randomBytes(18).toString("base64url")}\nJWT_SECRET=${randomBytes(48).toString("hex")}\n`,
    { mode: 0o600 },
  );
}
let credentials = dotenv.parse(fs.readFileSync(envFile));
if (!credentials.PLATFORM_ADMIN_EMAIL) {
  fs.appendFileSync(
    envFile,
    `PLATFORM_ADMIN_EMAIL=platform@counter.local\nPLATFORM_ADMIN_PASSWORD=${randomBytes(18).toString("base64url")}\n`,
  );
  credentials = dotenv.parse(fs.readFileSync(envFile));
}
process.env.MONGOMS_DOWNLOAD_DIR = path.join(root, ".mongodb-binaries");
console.log(
  "Starting an isolated local demo. Its database is temporary and resets when stopped.",
);
let repl;
try {
  repl = await MongoMemoryReplSet.create({
    binary: { version: "8.0.12" },
    replSet: { count: 1 },
  });
  const env = {
    ...process.env,
    ...credentials,
    MONGODB_URI: repl.getUri("counter-demo"),
    PORT: demoPort,
    CLIENT_URL: `http://localhost:${demoPort}`,
    NODE_ENV: "development",
    SEED_DEMO: "true",
  };
  const seed = spawn(process.execPath, ["server/src/seed.js"], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    seed.once("error", reject);
    seed.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Demo seed failed")),
    );
  });
  const server = spawn(process.execPath, ["server/src/server.js"], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  console.log(
    `\nOpen http://localhost:${demoPort}\nPlatform admin: ${credentials.PLATFORM_ADMIN_EMAIL}\nPlatform password: ${credentials.PLATFORM_ADMIN_PASSWORD}\n\nClient email: ${credentials.ADMIN_EMAIL}\nPassword: ${credentials.ADMIN_PASSWORD}\n\nThese generated local demo credentials are saved in .local-demo/.env.\nPress Ctrl+C to stop. Use your own MongoDB for permanent shop data.\n`,
  );
  const stop = () => server.kill();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", resolve);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (repl) await repl.stop();
}
