export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { isBusinessType } from "@/app/lib/business-templates";
import { isKeygenUnlocked } from "@/app/lib/keygen-session";

type Body = {
  mode?: "new" | "extend";
  existing_license_key?: string;
  extend_from_expires_at?: string;
  email?: string;
  business_name?: string;
  business_type?: string;
  usage_mode?: "standalone" | "lan_host";
  user_limit?: number;
  computer_limit?: number;
  license_type?: string;
  validity_months?: number;
  installation_scope?: "single_pc" | "business_lan";
  valid_from?: string;
  features?: string[] | string;
};

function toBase64Url(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sanitizeInt(value: unknown, fallback: number, min = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function normalizeIsoDateStart(input?: string) {
  if (!input) return new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input}T00:00:00.000Z`;
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function addMonths(isoStart: string, months: number) {
  const d = new Date(isoStart);
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out.toISOString();
}

function rand4() {
  return Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, "0");
}

function generateLicenseKey() {
  return `AXEIN-${rand4()}-${rand4()}-${rand4()}`;
}

function canonicalV2(payload: Record<string, any>) {
  const normalized = {
    v: 2,
    license_key: String(payload.license_key || ""),
    email: String(payload.email || ""),
    expires_at: String(payload.expires_at || ""),
    business_name: String(payload.business_name || ""),
    business_type: String(payload.business_type || ""),
    license_type: String(payload.license_type || ""),
    usage_mode: String(payload.usage_mode || ""),
    installation_scope: String(payload.installation_scope || ""),
    user_limit: Number(payload.user_limit || 0),
    computer_limit: Number(payload.computer_limit || 0),
    valid_from: String(payload.valid_from || ""),
    issued_at: String(payload.issued_at || ""),
    features: Array.isArray(payload.features)
      ? payload.features.map((x: any) => String(x)).sort()
      : [],
  };
  return JSON.stringify(normalized);
}

function normalizeFeatures(raw: Body["features"]) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

async function resolvePrivateKeyPem() {
  const cwd = process.cwd();
  const explicit = process.env.AXEIN_KEYGEN_PRIVATE_KEY_PATH?.trim();
  const candidates = [
    explicit ? path.resolve(explicit) : "",
    path.join(cwd, "vendor", "keygen", "ed25519-private.pem"),
    path.join(cwd, "tools", "license-keygen", "ed25519-private.pem"),
    path.resolve(cwd, "..", "tools", "license-keygen", "ed25519-private.pem"),
    path.resolve(cwd, "..", "..", "tools", "license-keygen", "ed25519-private.pem"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const pem = await fs.readFile(candidate, "utf8");
      if (pem.includes("BEGIN PRIVATE KEY")) return pem;
    } catch {
      // continue
    }
  }
  throw new Error("Keygen private key not found. Configure AXEIN_KEYGEN_PRIVATE_KEY_PATH.");
}

function forbidden(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

function keygenApiAvailable() {
  return process.env.AXEIN_APP_MODE === "keygen" || process.env.AXEIN_INCLUDE_KEYGEN_UI === "1";
}

export async function GET() {
  if (!keygenApiAvailable()) {
    return NextResponse.json({
      ok: true,
      available: false,
      message: "Not available on this install",
    });
  }

  try {
    await resolvePrivateKeyPem();
    return NextResponse.json({
      ok: true,
      available: true,
      message: "Keygen endpoint ready. Use POST to issue a license key.",
    });
  } catch {
    return NextResponse.json({
      ok: true,
      available: false,
      message: "Not available on this install",
    });
  }
}

export async function POST(req: Request) {
  try {
    if (!keygenApiAvailable()) {
      return NextResponse.json({ ok: false, error: "Not available on this install" }, { status: 404 });
    }

    let privatePem = "";
    try {
      privatePem = await resolvePrivateKeyPem();
    } catch {
      return NextResponse.json({ ok: false, error: "Not available on this install" }, { status: 404 });
    }

    if (req.headers.get("x-admin") !== "1") {
      return forbidden("Admin context required");
    }
    if (!isKeygenUnlocked(req)) {
      return forbidden("Keygen unlock required");
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const email = String(body.email || "").trim().toLowerCase();
    const businessName = String(body.business_name || "").trim();
    const businessType = String(body.business_type || "").trim();
    const usageMode = body.usage_mode === "lan_host" ? "lan_host" : "standalone";
    const licenseType = String(body.license_type || "standard").trim().toLowerCase();
    const installationScope =
      body.installation_scope === "business_lan"
        ? "business_lan"
        : usageMode === "lan_host"
        ? "business_lan"
        : "single_pc";
    const userLimit = sanitizeInt(body.user_limit, 5, 1);
    const computerLimit = sanitizeInt(body.computer_limit, usageMode === "lan_host" ? 3 : 1, 1);
    const validityMonths = sanitizeInt(body.validity_months, 12, 1);

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Valid customer email is required" }, { status: 400 });
    }
    if (!businessName) {
      return NextResponse.json({ ok: false, error: "Business name is required" }, { status: 400 });
    }
    if (!isBusinessType(businessType)) {
      return NextResponse.json({ ok: false, error: "Business type is invalid" }, { status: 400 });
    }

    const mode = body.mode === "extend" ? "extend" : "new";
    const now = new Date();
    let validFrom = normalizeIsoDateStart(body.valid_from);

    if (mode === "extend" && !String(body.existing_license_key || "").trim()) {
      return NextResponse.json(
        { ok: false, error: "existing_license_key is required for extension mode" },
        { status: 400 }
      );
    }

    if (mode === "extend") {
      const extBase = body.extend_from_expires_at ? new Date(body.extend_from_expires_at) : null;
      if (extBase && !Number.isNaN(extBase.getTime()) && extBase.getTime() > now.getTime()) {
        validFrom = new Date(Date.UTC(extBase.getUTCFullYear(), extBase.getUTCMonth(), extBase.getUTCDate())).toISOString();
      }
    }

    const licenseKey = String(body.existing_license_key || "").trim() || generateLicenseKey();
    const payload = {
      v: 2,
      license_key: licenseKey,
      email,
      business_name: businessName,
      business_type: businessType,
      usage_mode: usageMode,
      user_limit: userLimit,
      computer_limit: computerLimit,
      license_type: licenseType,
      valid_from: validFrom,
      expires_at: addMonths(validFrom, validityMonths),
      installation_scope: installationScope,
      issued_at: now.toISOString(),
      features: normalizeFeatures(body.features),
    };

    const signingPayload = new TextEncoder().encode(canonicalV2(payload));
    const signature = crypto
      .sign(null, signingPayload, crypto.createPrivateKey(privatePem))
      .toString("base64");
    const payloadB64u = toBase64Url(JSON.stringify(payload));
    const signatureB64u = toBase64Url(Buffer.from(signature, "base64"));
    const packedToken = `L-${payload.license_key}.${payloadB64u}.${signatureB64u}`;
    const activationJson = { ...payload, signature };

    return NextResponse.json({
      ok: true,
      mode,
      activation_token: packedToken,
      activation_json: activationJson,
      activation_json_string: JSON.stringify(activationJson, null, 2),
      payload,
      signature,
      packed_token: packedToken,
      summary: {
        license_key: payload.license_key,
        valid_from: payload.valid_from,
        expires_at: payload.expires_at,
        user_limit: payload.user_limit,
        computer_limit: payload.computer_limit,
        license_type: payload.license_type,
        usage_mode: payload.usage_mode,
        installation_scope: payload.installation_scope,
      },
    });
  } catch (err: any) {
    console.error("POST /api/staff/keygen/issue failed:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || "Failed to generate key") },
      { status: 500 }
    );
  }
}
