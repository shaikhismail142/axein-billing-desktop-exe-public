#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const serverPath = path.join(root, "desktop", "runtime", "app", "standalone", "server.js");
if (!fs.existsSync(serverPath)) {
  console.error("Missing desktop runtime server. Run: npm run desktop:prepare-runtime");
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: "production",
  AXEIN_DESKTOP: "1",
  APP_REQUIRE_BUSINESS_SETUP: process.env.APP_REQUIRE_BUSINESS_SETUP || "true",
  PORT: process.env.PORT || "3199",
  HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
};

const child = spawn(process.execPath, [serverPath], {
  cwd: path.dirname(serverPath),
  env,
  stdio: "inherit",
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

child.on("exit", (code) => process.exit(code ?? 0));
