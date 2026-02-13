#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const runtimeCmd = process.execPath;
const runtimeScript = path.join(root, "desktop", "scripts", "run-local-runtime.mjs");
const smokePort = Number(process.env.PORT || "3199");
const baseUrl = `http://127.0.0.1:${smokePort}`;

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
      AXEIN_INCLUDE_KEYGEN_UI: "1",
      AXEIN_FORCE_EMBEDDED_DB: "1",
      AXEIN_ALLOW_ADMIN_HEADER: "1",
      PORT: String(smokePort),
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
    },
    stdio: "inherit",
  });

  try {
    const health = await waitHealth(`${baseUrl}/api/health`);
    if (!health?.ok) {
      throw new Error("Health check did not return ok=true");
    }

    const issueGet = await fetch(`${baseUrl}/api/staff/keygen/issue`, {
      cache: "no-store",
    });
    const issueGetJson = await issueGet.json().catch(() => ({}));
    if (!issueGet.ok || !issueGetJson?.ok || issueGetJson?.available !== true) {
      throw new Error(
        `Keygen GET diagnostics failed: status=${issueGet.status} body=${JSON.stringify(issueGetJson)}`
      );
    }

    const activate = await fetch(`${baseUrl}/activate`, {
      cache: "no-store",
      redirect: "manual",
    });
    const activateLocation = activate.headers.get("location") || "";
    if (
      !(activate.status >= 300 && activate.status < 400) ||
      !activateLocation.includes("/staff/keygen")
    ) {
      throw new Error(
        `Keygen routing failed: expected /activate redirect to /staff/keygen (status=${activate.status}, location=${activateLocation})`
      );
    }

    const keygenPage = await fetch(`${baseUrl}/staff/keygen`, { cache: "no-store" });
    const keygenHtml = await keygenPage.text();
    if (!keygenPage.ok || !keygenHtml.includes("AxEin Staff Keygen")) {
      throw new Error("Keygen page content check failed");
    }

    const invalidPost = await fetch(`${baseUrl}/api/staff/keygen/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": "1" },
      body: JSON.stringify({
        super_password: "invalid",
        email: "smoke@axein.local",
        business_name: "Smoke",
        business_type: "general_store",
        user_limit: 1,
        computer_limit: 1,
        validity_months: 1,
      }),
      cache: "no-store",
    });
    const invalidJson = await invalidPost.json().catch(() => ({}));
    if (invalidPost.status !== 403) {
      throw new Error(
        `Keygen invalid-password check failed: status=${invalidPost.status} body=${JSON.stringify(invalidJson)}`
      );
    }

    console.log("Desktop keygen self-test passed.");
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error("desktop keygen self-test failed:", err.message || err);
  process.exit(1);
});
