#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");

const runtimeCmd = process.execPath;
const runtimeScript = path.join(root, "desktop", "scripts", "run-local-runtime.mjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHealth(url, timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        return json;
      }
    } catch {
      // retry
    }
    await sleep(600);
  }
  throw new Error(`Health endpoint not ready: ${url}`);
}

async function main() {
  const child = spawn(runtimeCmd, [runtimeScript], {
    cwd: root,
    env: {
      ...process.env,
      AXEIN_DESKTOP: "1",
      PORT: process.env.PORT || "3199",
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
    },
    stdio: "inherit",
  });

  try {
    const health = await waitHealth("http://127.0.0.1:3199/api/health");
    if (!health?.ok) {
      throw new Error("Health check did not return ok=true");
    }
    console.log("Desktop runtime smoke test passed.");
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error("desktop smoke test failed:", err.message || err);
  process.exit(1);
});
