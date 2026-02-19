#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const smokeDbDir = path.join(os.tmpdir(), `axein-smoke-db-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const runtimeCmd = process.execPath;
const runtimeScript = path.join(root, "desktop", "scripts", "run-local-runtime.mjs");

function getAvailablePort(preferredPort = 3199) {
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

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function expectOkResponse(url, options = {}, label = "request") {
  const res = await fetch(url, options);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${label} failed (${res.status}): ${txt || res.statusText}`);
  }
  return res;
}

function adminHeaders(extra = {}) {
  return { "x-admin": "1", ...extra };
}

async function main() {
  const smokePort = Number(await getAvailablePort(Number(process.env.PORT || "3199")));
  const baseUrl = `http://127.0.0.1:${smokePort}`;
  const child = spawn(runtimeCmd, [runtimeScript], {
    cwd: root,
    env: {
      ...process.env,
      AXEIN_DESKTOP: "1",
      AXEIN_FORCE_EMBEDDED_DB: "1",
      AXEIN_ALLOW_ADMIN_HEADER: "1",
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
      headers: adminHeaders(),
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
      headers: adminHeaders(),
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
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ role_codes: ["billing_staff"] }),
      }
    );
    if (!approveUser.res.ok || !approveUser.json?.ok) {
      throw new Error(`Approve user smoke failed: ${approveUser.json?.error || approveUser.res.statusText}`);
    }

    const users = await requestJson(`${baseUrl}/api/admin/users`, {
      headers: adminHeaders(),
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
      headers: adminHeaders(),
    });
    if (!readLogs.res.ok) {
      throw new Error(`Log read smoke failed: ${readLogs.json?.error || readLogs.res.statusText}`);
    }

    const keygenUiBlock = await fetch(`${baseUrl}/staff/keygen`, {
      redirect: "manual",
      cache: "no-store",
    });
    const keygenLocation = keygenUiBlock.headers.get("location") || "";
    const keygenBlocked =
      (keygenUiBlock.status >= 300 && keygenUiBlock.status < 400 && keygenLocation.includes("/activate")) ||
      keygenUiBlock.status === 404;
    if (!keygenBlocked) {
      throw new Error(
        `Billing runtime smoke failed: staff keygen UI should not be accessible (status=${keygenUiBlock.status}, location=${keygenLocation})`
      );
    }

    // Core module API sweep (products/invoices/quotations/purchases/reports)
    const seedProduct = await requestJson(`${baseUrl}/api/products`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: `Smoke Product ${suffix}`,
        category: "general",
        price: 120,
        selling_price: 120,
        stock_qty: 10,
        gst_slab: 18,
      }),
    });
    if (!seedProduct.res.ok || !seedProduct.json?.ok) {
      throw new Error(`Product create smoke failed: ${seedProduct.json?.error || seedProduct.res.statusText}`);
    }
    const productId = Number(seedProduct.json?.item?.id || 0);
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new Error("Product create smoke failed: missing item id");
    }

    await expectOkResponse(
      `${baseUrl}/api/products?page=1&perPage=20&q=${encodeURIComponent(`Smoke Product ${suffix}`)}`,
      { headers: adminHeaders() },
      "Products list"
    );
    await expectOkResponse(`${baseUrl}/api/products/export`, { headers: adminHeaders() }, "Products export");

    const quoteCreate = await requestJson(`${baseUrl}/api/quotations`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        customer_name: `Smoke Customer ${suffix}`,
        notes: "smoke quotation",
        items: [
          {
            product_id: productId,
            description: `Smoke Product ${suffix}`,
            qty: 1,
            price: 120,
            tax: 18,
            discount: 0,
          },
        ],
      }),
    });
    if (!quoteCreate.res.ok || !quoteCreate.json?.ok) {
      throw new Error(`Quotation create smoke failed: ${quoteCreate.json?.error || quoteCreate.res.statusText}`);
    }
    const quotationId = Number(quoteCreate.json?.data?.id || quoteCreate.json?.id || 0);
    if (!Number.isFinite(quotationId) || quotationId <= 0) {
      throw new Error("Quotation create smoke failed: missing quotation id");
    }

    await expectOkResponse(`${baseUrl}/api/quotations?page=1&perPage=20`, { headers: adminHeaders() }, "Quotations list");
    await expectOkResponse(`${baseUrl}/api/quotations/export`, { headers: adminHeaders() }, "Quotations export");
    await expectOkResponse(
      `${baseUrl}/api/quotations/${quotationId}/pdf`,
      { headers: adminHeaders() },
      "Quotation PDF"
    );

    const saleCreate = await requestJson(`${baseUrl}/api/sales`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        customer_name: `Smoke Customer ${suffix}`,
        payment_method: "cash",
        amount_paid: 141.6,
        items: [
          {
            product_id: productId,
            name: `Smoke Product ${suffix}`,
            qty: 1,
            unit_price: 120,
            gst_slab: 18,
            discount_pct: 0,
          },
        ],
      }),
    });
    if (!saleCreate.res.ok) {
      throw new Error(`Sale create smoke failed: ${saleCreate.json?.error || saleCreate.res.statusText}`);
    }
    const saleId = Number(saleCreate.json?.sale_id || saleCreate.json?.id || 0);
    if (!Number.isFinite(saleId) || saleId <= 0) {
      throw new Error("Sale create smoke failed: missing sale id");
    }

    await expectOkResponse(`${baseUrl}/api/invoices?page=1&perPage=20`, { headers: adminHeaders() }, "Invoices list");
    await expectOkResponse(`${baseUrl}/api/invoices/export`, { headers: adminHeaders() }, "Invoices export");
    await expectOkResponse(`${baseUrl}/api/invoices/${saleId}/pdf`, { headers: adminHeaders() }, "Invoice PDF");

    const purchaseCreate = await requestJson(`${baseUrl}/api/purchases`, {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        vendor_name: `Smoke Vendor ${suffix}`,
        invoice_no: `P-${suffix}`,
        purchase_date: new Date().toISOString().slice(0, 10),
        amount_paid: 50,
        payment_method: "cash",
        add_to_inventory: false,
        items: [
          {
            product_id: productId,
            qty: 1,
            cost_price: 50,
            mrp: 120,
            tax_rate: 18,
            discount: 0,
          },
        ],
      }),
    });
    if (!purchaseCreate.res.ok || !purchaseCreate.json?.ok) {
      throw new Error(`Purchase create smoke failed: ${purchaseCreate.json?.error || purchaseCreate.res.statusText}`);
    }
    const purchaseId = Number(purchaseCreate.json?.purchase_id || 0);
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      throw new Error("Purchase create smoke failed: missing purchase id");
    }

    await expectOkResponse(`${baseUrl}/api/purchases?limit=20`, { headers: adminHeaders() }, "Purchases list");
    await expectOkResponse(`${baseUrl}/api/purchases/${purchaseId}/pdf`, { headers: adminHeaders() }, "Purchase PDF");
    await expectOkResponse(`${baseUrl}/api/low-stock`, { headers: adminHeaders() }, "Low-stock list");

    const reportFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const reportTo = new Date().toISOString().slice(0, 10);
    await expectOkResponse(
      `${baseUrl}/api/reports/tax?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`,
      { headers: adminHeaders() },
      "Tax report"
    );
    await expectOkResponse(
      `${baseUrl}/api/reports/tax/export?format=pdf&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`,
      { headers: adminHeaders() },
      "Tax PDF export"
    );
    await expectOkResponse(
      `${baseUrl}/api/reports/movers?from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`,
      { headers: adminHeaders() },
      "Movers report"
    );
    await expectOkResponse(`${baseUrl}/api/reports/dead-stock?days=30`, { headers: adminHeaders() }, "Dead stock report");

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
