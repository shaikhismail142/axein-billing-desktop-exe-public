#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const smokeDbDir = path.join(os.tmpdir(), `axein-smoke-db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

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

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function main() {
  const child = spawn(runtimeCmd, [runtimeScript], {
    cwd: root,
    env: {
      ...process.env,
      AXEIN_DESKTOP: "1",
      AXEIN_FORCE_EMBEDDED_DB: "1",
      PORT: String(smokePort),
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
      AXEIN_DB_DATA_DIR: smokeDbDir,
    },
    stdio: "inherit",
  });

  try {
    const health = await waitHealth(`${baseUrl}/api/health`);
    if (!health?.ok) {
      throw new Error("Health check did not return ok=true");
    }

    const trial = await requestJson(`${baseUrl}/api/license/start-trial`, {
      method: "POST",
      headers: { "x-admin": "1" },
    });
    if (!trial.res.ok || !trial.json?.ok) {
      throw new Error(`Trial start smoke failed: ${trial.json?.error || trial.res.statusText}`);
    }

    const suffix = Date.now().toString().slice(-6);
    const registerPayload = {
      business_name: `Smoke Biz ${suffix}`,
      business_type: "general_store",
      user_limit: 5,
      computer_limit: 1,
      license_plan_intent: "starter",
      usage_mode: "standalone",
      owner: {
        full_name: "Smoke Owner",
        email: `smoke.owner.${suffix}@axein.local`,
        phone: "",
        password: "smoke123",
      },
    };

    const register = await requestJson(`${baseUrl}/api/onboarding/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registerPayload),
    });
    if (!register.res.ok) {
      throw new Error(`Onboarding smoke failed: ${register.json?.error || register.res.statusText}`);
    }
    const businessId = Number(register.json?.business?.id || 0);
    if (!Number.isFinite(businessId) || businessId <= 0) {
      throw new Error("Onboarding smoke failed: missing business id in response");
    }

    const signupEmail = `smoke.user.${suffix}@axein.local`;
    const signup = await requestJson(`${baseUrl}/api/users/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: businessId,
        full_name: "Smoke Staff",
        email: signupEmail,
        phone: "",
        password: "smoke123",
        requested_role: "billing_staff",
      }),
    });
    if (!signup.res.ok) {
      throw new Error(
        `Signup smoke failed: ${signup.json?.error || signup.res.statusText} (business_id=${businessId}, business=${JSON.stringify(register.json?.business || {})})`
      );
    }

    const writeLog = await requestJson(`${baseUrl}/api/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "info",
        source: "desktop:smoke",
        event_code: "smoke.test",
        message: "Smoke log write test",
        context: { phase: "runtime" },
      }),
    });
    if (!writeLog.res.ok) {
      throw new Error(`Log write smoke failed: ${writeLog.json?.error || writeLog.res.statusText}`);
    }

    const pendingUsers = await requestJson(`${baseUrl}/api/admin/users/pending`, {
      headers: { "x-admin": "1" },
    });
    if (!pendingUsers.res.ok) {
      throw new Error(`Pending users smoke failed: ${pendingUsers.json?.error || pendingUsers.res.statusText}`);
    }
    const pendingItems = Array.isArray(pendingUsers.json?.items) ? pendingUsers.json.items : [];
    const createdPendingUser = pendingItems.find((row) => row?.email === signupEmail);
    if (!createdPendingUser?.id) {
      throw new Error("Pending users smoke failed: newly signed-up user not present in pending list");
    }

    const approveUser = await requestJson(
      `${baseUrl}/api/admin/users/${createdPendingUser.id}/approve`,
      {
        method: "POST",
        headers: { "x-admin": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ role_codes: ["billing_staff"] }),
      }
    );
    if (!approveUser.res.ok || !approveUser.json?.ok) {
      throw new Error(`Approve user smoke failed: ${approveUser.json?.error || approveUser.res.statusText}`);
    }

    const users = await requestJson(`${baseUrl}/api/admin/users`, {
      headers: { "x-admin": "1" },
    });
    if (!users.res.ok) {
      throw new Error(`Users list smoke failed: ${users.json?.error || users.res.statusText}`);
    }
    const userItems = Array.isArray(users.json?.items) ? users.json.items : [];
    const approvedUser = userItems.find((row) => row?.email === signupEmail);
    if (!approvedUser || String(approvedUser.status || "").toLowerCase() !== "active") {
      throw new Error("Users list smoke failed: approved user not active in admin listing");
    }

    const readLogs = await requestJson(`${baseUrl}/api/logs?limit=5`, {
      headers: { "x-admin": "1" },
    });
    if (!readLogs.res.ok) {
      throw new Error(`Log read smoke failed: ${readLogs.json?.error || readLogs.res.statusText}`);
    }

    console.log("Desktop runtime smoke test passed.");
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    await fs.rm(smokeDbDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("desktop smoke test failed:", err.message || err);
  process.exit(1);
});
