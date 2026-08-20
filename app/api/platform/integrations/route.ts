export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requirePlatformAdmin } from "@/app/lib/platform-admin";

function digest(secret: string, clientKey: string) {
  return crypto.createHmac("sha256", secret).update(clientKey).digest("base64url");
}

export async function POST(req: Request) {
  const admin = await requirePlatformAdmin(req);
  if (!admin.ok) return admin.response;
  const body = await req.json().catch(() => ({} as any));
  const businessId = Number(body.business_id || 0);
  const provider = String(body.provider || "defenzo").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (businessId <= 0 || !provider) return NextResponse.json({ error: "invalid_integration" }, { status: 400 });
  const clientKey = `axein_${provider}_${crypto.randomBytes(12).toString("hex")}`;
  const secret = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO integration_clients (business_id,provider,client_key,secret_hash,allowed_return_origins)
     VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (business_id,provider) DO UPDATE SET client_key=EXCLUDED.client_key,
       previous_secret_hash=integration_clients.secret_hash,previous_secret_valid_until=NOW()+INTERVAL '24 hours',
       secret_hash=EXCLUDED.secret_hash,allowed_return_origins=EXCLUDED.allowed_return_origins,status='active',updated_at=NOW()`,
    [businessId, provider, clientKey, digest(secret, clientKey), JSON.stringify(body.allowed_return_origins || ["https://defenzo.in"])]
  );
  await pool.query(
    `INSERT INTO audit_logs (business_id,actor_user_id,action,entity_type,entity_id,meta_json)
     VALUES ($1,$2,'platform.integration.rotate','integration',$3,$4::jsonb)`,
    [businessId,admin.session.user_id,provider,JSON.stringify({ client_key:clientKey })]
  );
  return NextResponse.json({
    ok:true,
    client_key:clientKey,
    secret,
    environment_variable:`AXEIN_INTEGRATION_SECRET_${provider.toUpperCase().replace(/[^A-Z0-9]/g,"_")}`,
    warning:"This secret is shown once. Store it in both services and restart AxEin before testing.",
  });
}
