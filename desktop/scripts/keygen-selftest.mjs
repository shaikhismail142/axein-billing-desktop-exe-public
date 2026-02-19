#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const runtimeCmd = process.execPath;
const runtimeScript = path.join(root, "desktop", "scripts", "run-local-runtime.mjs");
const defaultSuperPassword = "AxEin!K3yG3n#2026@Sup3r-Only";

function getAvailablePort(preferredPort = 3299) {
  const tryPort = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", (err) => reject(err));
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address();
        const picked = typeof addr === "object" && addr ? addr.port : port;
        server.close(() => resolve(picked));
      });
    });

  return tryPort(preferredPort).catch(() => tryPort(0));
}

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
  const smokePort = Number(await getAvailablePort(Number(process.env.PORT || "3299")));
  const baseUrl = `http://127.0.0.1:${smokePort}`;
  const child = spawn(runtimeCmd, [runtimeScript], {
    cwd: root,
    env: {
      ...process.env,
      AXEIN_DESKTOP: "1",
      AXEIN_INCLUDE_KEYGEN_UI: "1",
      AXEIN_APP_MODE: "keygen",
      AXEIN_RUNTIME_PORT: String(smokePort),
      AXEIN_KEYGEN_PRIVATE_KEY_PATH:
        process.env.AXEIN_KEYGEN_PRIVATE_KEY_PATH ||
        path.join(root, "tools", "license-keygen", "ed25519-private.pem"),
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

    const unlockGet = await fetch(`${baseUrl}/api/staff/keygen/unlock`, {
      cache: "no-store",
    });
    const unlockGetJson = await unlockGet.json().catch(() => ({}));
    if (!unlockGet.ok || unlockGetJson?.available !== true) {
      throw new Error(
        `Keygen unlock GET check failed: status=${unlockGet.status} body=${JSON.stringify(unlockGetJson)}`
      );
    }

    const invalidUnlock = await fetch(`${baseUrl}/api/staff/keygen/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": "1" },
      body: JSON.stringify({ super_password: "invalid" }),
      cache: "no-store",
    });
    const invalidUnlockJson = await invalidUnlock.json().catch(() => ({}));
    if (invalidUnlock.status !== 403) {
      throw new Error(
        `Keygen unlock invalid-password check failed: status=${invalidUnlock.status} body=${JSON.stringify(invalidUnlockJson)}`
      );
    }

    const validUnlock = await fetch(`${baseUrl}/api/staff/keygen/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": "1" },
      body: JSON.stringify({
        super_password: process.env.AXEIN_SUPER_KEYGEN_PASSWORD || defaultSuperPassword,
      }),
      cache: "no-store",
    });
    const unlockCookie = validUnlock.headers.get("set-cookie") || "";
    const validUnlockJson = await validUnlock.json().catch(() => ({}));
    if (!validUnlock.ok || !validUnlockJson?.ok || !unlockCookie) {
      throw new Error(
        `Keygen unlock valid-password check failed: status=${validUnlock.status} body=${JSON.stringify(validUnlockJson)}`
      );
    }

    const issuePost = await fetch(`${baseUrl}/api/staff/keygen/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin": "1",
        cookie: unlockCookie,
      },
      body: JSON.stringify({
        mode: "new",
        email: "smoke@axein.local",
        business_name: "Smoke",
        business_type: "general_store",
        user_limit: 1,
        computer_limit: 1,
        validity_months: 1,
      }),
      cache: "no-store",
    });
    const issueJson = await issuePost.json().catch(() => ({}));
    if (!issuePost.ok || !issueJson?.ok || !issueJson?.packed_token) {
      throw new Error(
        `Keygen issue POST failed: status=${issuePost.status} body=${JSON.stringify(issueJson)}`
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
