// app/api/license/verify-key/route.ts
import { NextResponse } from "next/server";
import {
  verifySignatureEd25519,
  saveActivationRecord,
  type LicensePayload,
} from "@/app/lib/license-activation";
import { pool } from "@/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";

function bad(msg: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: msg },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

// Token format: "L-<LICENSE_KEY>.<base64url(payload)>.<base64url(signature)>"
// payload JSON (v1/v2): { email, expires_at, ...optional v2 claims }
function parsePackedToken(raw: string) {
  const s = (raw || "").trim();
  if (!s.startsWith("L-")) throw new Error("Token must start with L-");
  const parts = s.split(".");
  if (parts.length < 3) throw new Error("Malformed token");

  const licenseKeyPart = parts[0].slice(2); // remove "L-"
  const payloadB64u = parts[1];
  const sigB64u = parts[2];

  const toB64 = (u: string) => u.replace(/-/g, "+").replace(/_/g, "/");
  const payloadJson = Buffer.from(toB64(payloadB64u), "base64").toString("utf8");

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error("Invalid token payload");
  }

  const signatureB64 = Buffer.from(toB64(sigB64u), "base64").toString("base64");

  return {
    ...payload,
    license_key: String(payload.license_key || licenseKeyPart || ""),
    email: String(payload.email || ""),
    expires_at: String(payload.expires_at || ""),
    signature: signatureB64,
  };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const access = await requireAnyPermission(req, ["perm.license.manage", "perm.settings.manage"], "Forbidden");
    if ("response" in access) return access.response;
    const businessId = access.ctx.businessId;

    const body = await req.json().catch(() => ({} as any));

    // --- Normalize inputs from multiple shapes ----------------------------
    // Supported:
    //  A) { token: "L-..." }  (packed token)
    //  B) { license_key, email, expires_at, signature } (JSON)
    //  C) { license_key: "L-..." }  (old client sending token under license_key)
    //  D) { license_key: "{...json...}" } (user pasted JSON into single box)
    let normalized: Partial<LicensePayload> = {};
    let signature = "";

    const rawTokenOrKey: string | undefined =
      typeof body?.token === "string"
        ? body.token
        : typeof body?.license_key === "string"
        ? body.license_key
        : undefined;

    const looksPacked = (s?: string) => !!s && s.startsWith("L-");

    if (looksPacked(rawTokenOrKey)) {
      // Packed token path
      const parsed = parsePackedToken(rawTokenOrKey!);
      signature = String(parsed.signature || "");
      normalized = parsed;
    } else if (
      typeof rawTokenOrKey === "string" &&
      rawTokenOrKey.trim().startsWith("{")
    ) {
      // JSON pasted into single box
      try {
        const j = JSON.parse(rawTokenOrKey.trim());
        signature = String(j.signature || "");
        normalized = {
          ...j,
          license_key: String(j.license_key || ""),
          email: String(j.email || ""),
          expires_at: String(j.expires_at || ""),
        };
      } catch {
        return bad("Invalid JSON pasted into license box");
      }
    } else if (
      body?.license_key &&
      body?.email &&
      body?.expires_at &&
      body?.signature
    ) {
      // Proper JSON fields
      signature = String(body.signature || "");
      normalized = {
        ...body,
        license_key: String(body.license_key || ""),
        email: String(body.email || ""),
        expires_at: String(body.expires_at || ""),
      };
    } else {
      return bad("Missing license token or required fields");
    }

    const licensePayload: Omit<LicensePayload, "signature"> = {
      license_key: String(normalized.license_key || ""),
      email: String(normalized.email || ""),
      expires_at: String(normalized.expires_at || ""),
      v: Number(normalized.v || 0) || undefined,
      business_name: normalized.business_name ? String(normalized.business_name) : undefined,
      business_type: normalized.business_type ? String(normalized.business_type) : undefined,
      license_type: normalized.license_type ? String(normalized.license_type) : undefined,
      usage_mode: normalized.usage_mode ? String(normalized.usage_mode) : undefined,
      installation_scope: normalized.installation_scope ? String(normalized.installation_scope) : undefined,
      user_limit: normalized.user_limit != null ? Number(normalized.user_limit) : undefined,
      valid_from: normalized.valid_from ? String(normalized.valid_from) : undefined,
      issued_at: normalized.issued_at ? String(normalized.issued_at) : undefined,
      features: Array.isArray(normalized.features)
        ? normalized.features.map((x: any) => String(x))
        : undefined,
    };

    if (!licensePayload.license_key || !licensePayload.email || !licensePayload.expires_at || !signature) {
      return bad("Incomplete license payload");
    }

    const PUBLIC_KEY = process.env.LICENSE_PUBLIC_KEY || "";
    if (!PUBLIC_KEY) return bad("Server missing LICENSE_PUBLIC_KEY", 500);

    // Verify signature: pass payload object (without signature)
    const ok = verifySignatureEd25519(
      licensePayload,
      signature,
      PUBLIC_KEY
    );
    if (!ok) return bad("Invalid license signature", 401);

    // Persist activation (only known fields accepted by your type)
    await saveActivationRecord({
      mode: "active",
      ok: true,
      reason: null,
      license: licensePayload,
    });

    // Mirror seat/license metadata in normalized table when available.
    try {
      const claimedBusinessId = Number((normalized as any).business_id || businessId);
      if (Number.isFinite(claimedBusinessId) && claimedBusinessId > 0 && claimedBusinessId !== businessId) {
        return bad("License business mismatch", 403);
      }
      const userLimit = Math.max(1, Number(licensePayload.user_limit || 1));
      const licenseType = String(licensePayload.license_type || "standard");
      const installationScope = String(licensePayload.installation_scope || "single_pc");
      const validFrom = licensePayload.valid_from ? new Date(licensePayload.valid_from).toISOString() : null;
      const validTo = licensePayload.expires_at ? new Date(licensePayload.expires_at).toISOString() : null;

      await pool.query(
        `INSERT INTO licenses
          (business_id, license_key, license_type, user_limit, valid_from, valid_to, status, installation_scope, payload_json)
         VALUES
          ($1, $2, $3, $4, $5, $6, 'active', $7, $8::jsonb)
         ON CONFLICT (business_id, license_key)
         DO UPDATE SET
            license_type = EXCLUDED.license_type,
            user_limit = EXCLUDED.user_limit,
            valid_from = EXCLUDED.valid_from,
            valid_to = EXCLUDED.valid_to,
            status = EXCLUDED.status,
            installation_scope = EXCLUDED.installation_scope,
            payload_json = EXCLUDED.payload_json,
            updated_at = NOW()`,
        [
          businessId,
          licensePayload.license_key,
          licenseType,
          userLimit,
          validFrom,
          validTo,
          installationScope,
          JSON.stringify(licensePayload),
        ]
      );

      await pool.query(
        `UPDATE businesses
            SET user_limit = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [businessId, userLimit]
      );
    } catch {
      // keep legacy activation path functional when new schema is not applied yet
    }

    return NextResponse.json(
      {
        ok: true,
        isLicensed: true,
        trialActive: false,
        status: { mode: "active", license: licensePayload },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return bad(e?.message || "License verification failed", 500);
  }
}
