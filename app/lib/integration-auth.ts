import crypto from "node:crypto";
import { pool } from "@/lib/db";

const MAX_CLOCK_SKEW_SECONDS = 300;

function hmac(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export function signIntegrationPayload(secret: string, timestamp: string, nonce: string, body: string): string {
  return hmac(secret, `${timestamp}.${nonce}.${body}`);
}

export async function authenticateIntegrationRequest(req: Request, rawBody: string) {
  const clientKey = String(req.headers.get("x-axein-client") || "").trim();
  const timestamp = String(req.headers.get("x-axein-timestamp") || "").trim();
  const nonce = String(req.headers.get("x-axein-nonce") || "").trim();
  const signature = String(req.headers.get("x-axein-signature") || "").trim();
  if (!clientKey || !timestamp || !nonce || !signature) return null;

  return authenticateIntegrationEnvelope({ clientKey, timestamp, nonce, signature, signedBody: rawBody });
}

export async function authenticateIntegrationEnvelope(input: {
  clientKey: string; timestamp: string; nonce: string; signature: string; signedBody: string;
}) {
  const { clientKey, timestamp, nonce, signature, signedBody } = input;
  const issuedAt = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > MAX_CLOCK_SKEW_SECONDS) return null;
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(nonce)) return null;

  const rs = await pool.query(
    `SELECT id, business_id, provider, secret_hash
       FROM integration_clients
      WHERE client_key = $1 AND status = 'active'
      LIMIT 1`,
    [clientKey]
  );
  if (!rs.rowCount) return null;
  const client = rs.rows[0] as any;
  const envName = `AXEIN_INTEGRATION_SECRET_${String(client.provider).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const secret = String(process.env[envName] || "");
  if (!secret || !safeEqual(hmac(secret, clientKey), String(client.secret_hash))) return null;
  if (!safeEqual(signIntegrationPayload(secret, timestamp, nonce, signedBody), signature)) return null;

  const nonceRs = await pool.query(
    `INSERT INTO integration_nonces (client_id, nonce, expires_at, consumed_at)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes', NOW())
     ON CONFLICT (client_id, nonce) DO NOTHING
     RETURNING nonce`,
    [client.id, nonce]
  );
  if (!nonceRs.rowCount) return null;
  return { id: Number(client.id), businessId: Number(client.business_id), provider: String(client.provider) };
}
