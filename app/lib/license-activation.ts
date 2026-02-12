// app/lib/license-activation.ts
import "server-only";
import crypto from "node:crypto";
import { pool } from "@/app/lib/db";

export type LicensePayload = {
  license_key: string;
  email: string;
  expires_at: string; // ISO
  signature: string;  // base64
  v?: number;
  business_name?: string;
  business_type?: string;
  license_type?: string;
  usage_mode?: string;
  installation_scope?: string;
  user_limit?: number;
  computer_limit?: number;
  valid_from?: string;
  issued_at?: string;
  features?: string[];
};

export type ActivationRecord = {
  mode: "active" | "trial" | "inactive";
  ok: boolean;
  reason?: string | null;

  // When active
  license?: (Omit<LicensePayload, "signature"> & Record<string, any>) | null;

  // When trial
  trial_allowed?: boolean;
  trial_started_at?: string | null;
  trial_expires_at?: string | null;

  updated_at: string;
};

const NOW_ISO = () => new Date().toISOString();

const DEFAULTS: ActivationRecord = {
  mode: "inactive",
  ok: false,
  reason: null,
  license: null,
  trial_allowed: true,
  trial_started_at: null,
  trial_expires_at: null,
  updated_at: NOW_ISO(),
};

function canonicalV1(payload: Omit<LicensePayload, "signature">): string {
  return `${payload.license_key}\n${payload.email}\n${payload.expires_at}`;
}

function canonicalV2(payload: Omit<LicensePayload, "signature">): string {
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
      ? payload.features.map((x) => String(x)).sort()
      : [],
  };
  return JSON.stringify(normalized);
}

function canonicalV2Legacy(payload: Omit<LicensePayload, "signature">): string {
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
    valid_from: String(payload.valid_from || ""),
    issued_at: String(payload.issued_at || ""),
    features: Array.isArray(payload.features)
      ? payload.features.map((x) => String(x)).sort()
      : [],
  };
  return JSON.stringify(normalized);
}

function isModernActivationShape(v: any): v is ActivationRecord {
  return v && typeof v === "object" && typeof v.mode === "string" && typeof v.updated_at === "string";
}

async function settingsHasBusinessId(client: any): Promise<boolean> {
  try {
    const rs = await client.query(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='settings'
            AND column_name='business_id'
       ) AS has_business_id`
    );
    return Boolean(rs.rows?.[0]?.has_business_id);
  } catch {
    return false;
  }
}

async function resolveActivationBusinessId(client: any): Promise<number> {
  try {
    const rs = await client.query(
      `SELECT id
         FROM businesses
        WHERE is_active = TRUE
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`
    );
    const id = Number(rs.rows?.[0]?.id || 1);
    return Number.isFinite(id) && id > 0 ? id : 1;
  } catch {
    return 1;
  }
}

async function readActivationRaw(client: any, businessId: number, hasBusinessId: boolean) {
  if (!hasBusinessId) {
    const rs = await client.query(
      `SELECT value_json
         FROM settings
        WHERE key='activation'
        ORDER BY id DESC
        LIMIT 1`
    );
    return rs.rows?.[0]?.value_json ?? null;
  }

  let rs = await client.query(
    `SELECT value_json
       FROM settings
      WHERE key='activation'
        AND business_id = $1
      ORDER BY id DESC
      LIMIT 1`,
    [businessId]
  );
  if (!rs.rowCount) {
    rs = await client.query(
      `SELECT value_json
         FROM settings
        WHERE key='activation'
        ORDER BY id DESC
        LIMIT 1`
    );
  }
  return rs.rows?.[0]?.value_json ?? null;
}

async function writeActivationRaw(client: any, raw: any, businessId: number, hasBusinessId: boolean) {
  if (!hasBusinessId) {
    await client.query(
      `INSERT INTO settings (key, value_json)
       VALUES ('activation', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
      [JSON.stringify(raw)]
    );
    return;
  }

  const scoped = await client.query(
    `UPDATE settings
        SET value_json = $1::jsonb
      WHERE key = 'activation'
        AND business_id = $2`,
    [JSON.stringify(raw), businessId]
  );
  if (scoped.rowCount) return;

  const legacy = await client.query(
    `UPDATE settings
        SET value_json = $1::jsonb
      WHERE key = 'activation'`,
    [JSON.stringify(raw)]
  );
  if (legacy.rowCount) return;

  await client.query(
    `INSERT INTO settings (key, business_id, value_json)
     VALUES ('activation', $1, $2::jsonb)`,
    [businessId, JSON.stringify(raw)]
  );
}

/** Coerce legacy (flat) or wrapped shapes into a modern ActivationRecord */
function normalizeActivationShape(raw: any): ActivationRecord {
  if (!raw || typeof raw !== "object") return { ...DEFAULTS, updated_at: NOW_ISO() };

  // If wrapped { activation: {...} }, unwrap.
  const maybeInner = raw.activation ?? raw;

  if (isModernActivationShape(maybeInner)) {
    // Ensure defaults for optional flags
    const merged: ActivationRecord = {
      ...DEFAULTS,
      ...maybeInner,
      trial_allowed: maybeInner.trial_allowed ?? DEFAULTS.trial_allowed,
      updated_at: maybeInner.updated_at || NOW_ISO(),
    };
    return merged;
  }

  // Legacy flat shape from migration 0108: keys like is_licensed, license_key, license_payload, trial_* ...
  const isLicensed = !!maybeInner.is_licensed;
  const trialStarted = maybeInner.trial_started_at ? String(maybeInner.trial_started_at) : null;
  const trialExpires = maybeInner.trial_expires_at ? String(maybeInner.trial_expires_at) : null;
  const trialAllowed = maybeInner.trial_allowed !== false; // undefined => true

  let mode: ActivationRecord["mode"] = "inactive";
  if (isLicensed) mode = "active";
  else if (trialStarted && trialExpires && Date.parse(trialExpires) > Date.now()) mode = "trial";

  // Try to lift license payload if present
  let license: ActivationRecord["license"] = null;
  const lp = maybeInner.license_payload;
  if (lp && typeof lp === "object" && lp.license_key && lp.email && lp.expires_at) {
    license = { license_key: String(lp.license_key), email: String(lp.email), expires_at: String(lp.expires_at) };
  } else if (maybeInner.license_key) {
    // Minimal legacy info
    license = {
      license_key: String(maybeInner.license_key),
      email: String(maybeInner.email ?? ""),
      expires_at: String(maybeInner.expires_at ?? ""),
    };
  }

  return {
    ...DEFAULTS,
    mode,
    ok: isLicensed, // legacy "ok" roughly maps to licensed; trial->false
    reason: null,
    license,
    trial_allowed: trialAllowed,
    trial_started_at: trialStarted,
    trial_expires_at: trialExpires,
    updated_at: NOW_ISO(),
  };
}

export function verifySignatureEd25519(
  payload: Omit<LicensePayload, "signature">,
  signatureB64: string,
  publicKeyBase64: string
): boolean {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });

  const signature = Uint8Array.from(Buffer.from(signatureB64, "base64"));
  const candidates = [canonicalV2(payload), canonicalV2Legacy(payload), canonicalV1(payload)];

  for (const candidate of candidates) {
    const data = new TextEncoder().encode(candidate);
    const ok = crypto.verify(
      null,
      data,
      publicKey,
      signature
    );
    if (ok) return true;
  }
  return false;
}

/** Load the current activation record (normalized), or null if nothing persisted yet. */
export async function getActivationRecord(): Promise<ActivationRecord | null> {
  const client = await pool.connect();
  try {
    const hasBusinessId = await settingsHasBusinessId(client);
    const businessId = hasBusinessId ? await resolveActivationBusinessId(client) : 1;
    const v = await readActivationRaw(client, businessId, hasBusinessId);
    if (!v) return null;

    return normalizeActivationShape(v);
  } finally {
    client.release();
  }
}

/**
 * Save/merge the activation record.
 * Accepts a partial, merges with current + defaults, stamps updated_at, persists wrapped as { activation: ... },
 * mirrors "ok" into app_state, and returns the merged record.
 */
export async function saveActivationRecord(patch: Partial<ActivationRecord>): Promise<ActivationRecord> {
  const client = await pool.connect();
  try {
    const hasBusinessId = await settingsHasBusinessId(client);
    const businessId = hasBusinessId ? await resolveActivationBusinessId(client) : 1;

    // Read current (tolerate legacy)
    const current = await (async () => {
      const raw = await readActivationRaw(client, businessId, hasBusinessId);
      if (!raw) return null;
      return normalizeActivationShape(raw);
    })();

    const merged: ActivationRecord = {
      ...DEFAULTS,
      ...(current ?? {}),
      ...(patch ?? {}),
      updated_at: NOW_ISO(),
    };

    const wrapper = { activation: merged };

    // Source of truth
    await writeActivationRaw(client, wrapper, businessId, hasBusinessId);

    // Legacy mirror (optional)
    await client.query(
        `
        INSERT INTO app_state (k, v)
        VALUES ('activation', jsonb_build_object('ok', $1::boolean, 'updated_at', to_char(NOW(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
        ON CONFLICT (k) DO UPDATE
          SET v = EXCLUDED.v
        `,
        [merged.ok === true]
      );

    return merged;
  } finally {
    client.release();
  }
}

/** Normalize activation into a light-weight status */
export async function getActivationStatus(): Promise<{
  isLicensed: boolean;
  mode: "active" | "trial" | "inactive";
  trialActive: boolean;
  canStartTrial: boolean;
  daysLeft: number | null;
  expiresAt: string | null;
  reason?: string | null;
}> {
  const a = await getActivationRecord();
  if (!a) {
    return {
      isLicensed: false,
      mode: "inactive",
      trialActive: false,
      canStartTrial: true,
      daysLeft: 0,
      expiresAt: null,
      reason: "No activation record",
    };
  }

  const mode = a.mode ?? "inactive";
  const isLicensed = mode === "active";
  const trialActive = mode === "trial";
  const canStartTrial = !!a.trial_allowed && !isLicensed && !trialActive;

  let daysLeft: number | null = null;
  let expiresAt: string | null = null;
  if (trialActive && a.trial_expires_at) {
    const ms = new Date(a.trial_expires_at).getTime() - Date.now();
    daysLeft = ms > 0 ? Math.ceil(ms / 86400000) : 0;
    expiresAt = a.trial_expires_at;
  } else if (isLicensed && a.license?.expires_at) {
    expiresAt = a.license.expires_at;
  }

  return {
    isLicensed,
    mode,
    trialActive,
    canStartTrial,
    daysLeft,
    expiresAt,
    reason: a.reason ?? null,
  };
}

/** Seed/flip a 7-day trial window and persist it (helper used by admin or verify-key) */
export async function startTrial(days = 7) {
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86400000);

  const record = await saveActivationRecord({
    mode: "trial",
    ok: false,
    reason: null,
    license: null,
    trial_allowed: false, // once started, disable starting again
    trial_started_at: now.toISOString(),
    trial_expires_at: expires.toISOString(),
  });

  return record;
}
