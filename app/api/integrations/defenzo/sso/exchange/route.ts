export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateIntegrationEnvelope, authenticateIntegrationRequest } from "@/app/lib/integration-auth";
import { createSessionToken, makeSessionCookie } from "@/app/lib/session";
import { getTenantEntitlement } from "@/app/lib/tenant-entitlements";

const ROLE_MAP: Record<string, string> = {
  admin: "admin",
  manager: "manager",
  technician: "viewer",
};

function safeNextPath(value: unknown): string {
  const path = String(value || "/dashboard");
  return path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
}

export async function POST(req: Request) {
  const contentType = String(req.headers.get("content-type") || "");
  let rawBody = "";
  let body: any = {};
  let client = null;
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    rawBody = String(form.get("payload") || "");
    client = await authenticateIntegrationEnvelope({
      clientKey: String(form.get("client_key") || ""),
      timestamp: String(form.get("timestamp") || ""),
      nonce: String(form.get("nonce") || ""),
      signature: String(form.get("signature") || ""),
      signedBody: rawBody,
    });
    body = JSON.parse(rawBody || "{}");
  } else {
    rawBody = await req.text();
    client = await authenticateIntegrationRequest(req, rawBody);
    body = JSON.parse(rawBody || "{}");
  }
  if (!client || client.provider !== "defenzo") {
    return NextResponse.json({ error: "invalid_integration_signature" }, { status: 401 });
  }
  const externalUserId = String(body.user_id || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const fullName = String(body.full_name || "").trim();
  const sourceRole = String(body.role || "").trim().toLowerCase();
  if (!externalUserId || !email || !fullName || !email.includes("@")) {
    return NextResponse.json({ error: "invalid_user_payload" }, { status: 400 });
  }

  const entitlement = await getTenantEntitlement(client.businessId);
  if (["draft", "suspended"].includes(entitlement.status)) {
    return NextResponse.json({ error: "tenant_unavailable", entitlement }, { status: 403 });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    let userRs = await db.query(
      `SELECT id FROM users WHERE business_id = $1 AND lower(email) = $2 LIMIT 1`,
      [client.businessId, email]
    );
    if (!userRs.rowCount) {
      const countRs = await db.query(
        `SELECT COUNT(*)::int AS count FROM users WHERE business_id = $1 AND status = 'active'`,
        [client.businessId]
      );
      if (Number(countRs.rows[0]?.count || 0) >= entitlement.userLimit) {
        await db.query("ROLLBACK");
        return NextResponse.json({ error: "seat_limit_reached" }, { status: 409 });
      }
      userRs = await db.query(
        `INSERT INTO users (business_id, full_name, email, status, approved_at)
         VALUES ($1, $2, $3, 'active', NOW()) RETURNING id`,
        [client.businessId, fullName, email]
      );
    } else {
      await db.query(
        `UPDATE users SET full_name = $3, status = 'active', updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [userRs.rows[0].id, client.businessId, fullName]
      );
    }
    const userId = Number(userRs.rows[0].id);
    const roleCode = ROLE_MAP[sourceRole] || "viewer";
    const roleRs = await db.query(
      `SELECT id FROM roles WHERE lower(code) = $1 AND (business_id = $2 OR business_id IS NULL)
       ORDER BY business_id NULLS LAST LIMIT 1`,
      [roleCode, client.businessId]
    );
    if (roleRs.rowCount) {
      await db.query(`DELETE FROM user_role_map WHERE user_id = $1`, [userId]);
      await db.query(
        `INSERT INTO user_role_map (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, roleRs.rows[0].id]
      );
    }
    await db.query(
      `INSERT INTO integration_record_links
        (business_id, provider, entity_type, external_id, internal_id, meta_json)
       VALUES ($1, 'defenzo', 'user', $2, $3, $4::jsonb)
       ON CONFLICT (business_id, provider, entity_type, external_id)
       DO UPDATE SET internal_id = EXCLUDED.internal_id, last_synced_at = NOW(), meta_json = EXCLUDED.meta_json`,
      [client.businessId, externalUserId, String(userId), JSON.stringify({ source_role: sourceRole })]
    );
    await db.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'integration.sso.login', 'user', $3, $4::jsonb)`,
      [client.businessId, userId, String(userId), JSON.stringify({ provider: "defenzo", external_user_id: externalUserId })]
    );
    await db.query("COMMIT");

    const token = createSessionToken({
      user_id: userId,
      business_id: client.businessId,
      email,
      full_name: fullName,
      role_codes: [roleCode],
    });
    const publicOrigin = String(process.env.AXEIN_PUBLIC_URL || "").trim();
    const redirect = new URL(safeNextPath(body.next), publicOrigin || req.url);
    const response = NextResponse.redirect(redirect, 303);
    response.headers.set("Set-Cookie", makeSessionCookie(token));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    await db.query("ROLLBACK");
    console.error("Defenzo SSO exchange failed", error);
    return NextResponse.json({ error: "sso_exchange_failed" }, { status: 500 });
  } finally {
    db.release();
  }
}
