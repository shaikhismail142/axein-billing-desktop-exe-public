import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requirePlatformAdmin } from "@/app/lib/platform-admin";

const MAX_CLOCK_SKEW_SECONDS = 300;

type PlatformAuthorization =
  | { ok: true; actorUserId: number | null; actorLabel: string }
  | { ok: false; response: NextResponse };

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && (crypto.timingSafeEqual as (x: any, y: any) => boolean)(a, b);
}

function bodyDigest(rawBody: string) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

export function createControlPlaneSignature(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}) {
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    bodyDigest(input.rawBody),
  ].join("\n");
  return crypto.createHmac("sha256", input.secret).update(canonical).digest("base64url");
}

async function requireControlPlaneService(req: Request, rawBody: string) {
  const configuredClient = String(process.env.AXEIN_CONTROL_PLANE_CLIENT || "").trim();
  const secret = String(process.env.AXEIN_CONTROL_PLANE_SECRET || "").trim();
  const client = String(req.headers.get("x-axein-client") || "").trim();
  const timestamp = String(req.headers.get("x-axein-timestamp") || "").trim();
  const nonce = String(req.headers.get("x-axein-nonce") || "").trim();
  const signature = String(req.headers.get("x-axein-signature") || "").trim();
  if (!configuredClient || !secret) return { ok: false as const, status: 503, error: "control_plane_not_configured" };
  if (client !== configuredClient || !/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !signature) {
    return { ok: false as const, status: 401, error: "invalid_control_plane_credentials" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false as const, status: 401, error: "control_plane_request_expired" };
  }
  const url = new URL(req.url);
  const expected = createControlPlaneSignature({ secret, method: req.method, path: url.pathname, timestamp, nonce, rawBody });
  if (!safeEqual(signature, expected)) return { ok: false as const, status: 401, error: "invalid_control_plane_signature" };

  const inserted = await pool.query(
    `INSERT INTO control_plane_nonces (client_key,nonce,expires_at)
     VALUES ($1,$2,NOW() + INTERVAL '10 minutes') ON CONFLICT DO NOTHING RETURNING nonce`,
    [client, nonce]
  );
  if (!inserted.rowCount) return { ok: false as const, status: 409, error: "control_plane_replay_detected" };
  await pool.query(`DELETE FROM control_plane_nonces WHERE expires_at < NOW()`);
  return { ok: true as const, actorUserId: null, actorLabel: `service:${client}` };
}

export async function authorizePlatformRequest(req: Request, rawBody = ""): Promise<PlatformAuthorization> {
  if (req.headers.has("x-axein-signature")) {
    const service = await requireControlPlaneService(req, rawBody);
    if (!service.ok) {
      return { ok: false as const, response: NextResponse.json({ error: service.error }, { status: service.status }) };
    }
    return service;
  }
  const admin = await requirePlatformAdmin(req);
  if (!admin.ok) return { ok: false, response: admin.response };
  return {
    ok: true as const,
    actorUserId: admin.session.user_id,
    actorLabel: admin.session.email,
  };
}
