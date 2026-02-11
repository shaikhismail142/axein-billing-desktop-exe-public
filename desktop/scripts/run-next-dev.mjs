#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const env = {
  ...process.env,
  AXEIN_DESKTOP: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  APP_REQUIRE_BUSINESS_SETUP: process.env.APP_REQUIRE_BUSINESS_SETUP || "true",
};

const child = spawn(
  process.execPath,
  ["./node_modules/next/dist/bin/next", "dev", "-p", "3001"],
  {
    cwd: root,
    env,
    stdio: "inherit",
  }
);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

child.on("exit", (code) => process.exit(code ?? 0));
