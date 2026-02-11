export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";
import { randomId, randomToken } from "@/app/lib/lan-crypto";

type Body = {
  host_name?: string;
  mode?: "standalone" | "lan_host";
  allow_pairing?: boolean;
  require_approval?: boolean;
  bind_address?: string;
  port?: number;
};

export async function PUT(req: NextRequest) {
  const access = await requireAnyPermission(req, ["perm.settings.manage"], "Forbidden");
  if (!access.ok) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);
  const body = (await req.json().catch(() => ({}))) as Body;

  const mode = body.mode === "lan_host" ? "lan_host" : "standalone";
  const hostName = String(body.host_name || "").trim() || `AxEin Host ${businessId}`;
  const bindAddress = String(body.bind_address || "").trim() || "0.0.0.0";
  const port = Number(body.port || 3199);

  if (!Number.isFinite(port) || port < 1024 || port > 65535) {
    return NextResponse.json({ error: "port must be between 1024 and 65535" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT business_id FROM lan_host_configs WHERE business_id = $1 LIMIT 1`,
      [businessId]
    );

    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO lan_host_configs
          (business_id, host_uid, host_name, host_secret, mode, allow_pairing, require_approval, bind_address, port)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          businessId,
          randomId("host"),
          hostName,
          randomToken(32),
          mode,
          body.allow_pairing !== false,
          body.require_approval !== false,
          bindAddress,
          port,
        ]
      );
    } else {
      await client.query(
        `UPDATE lan_host_configs
            SET host_name = $2,
                mode = $3,
                allow_pairing = $4,
                require_approval = $5,
                bind_address = $6,
                port = $7,
                updated_at = NOW()
          WHERE business_id = $1`,
        [
          businessId,
          hostName,
          mode,
          body.allow_pairing !== false,
          body.require_approval !== false,
          bindAddress,
          port,
        ]
      );
    }

    await client.query(
      `UPDATE businesses
          SET usage_mode = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [businessId, mode]
    );

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'lan.configure', 'lan_host_configs', $1::text, $3::jsonb)`,
      [
        businessId,
        actorUserId,
        JSON.stringify({ mode, host_name: hostName, allow_pairing: body.allow_pairing !== false, require_approval: body.require_approval !== false, port }),
      ]
    );

    await client.query("COMMIT");

    const finalRs = await pool.query(
      `SELECT business_id, host_uid, host_name, mode, allow_pairing, require_approval, bind_address, port, updated_at
         FROM lan_host_configs
        WHERE business_id = $1
        LIMIT 1`,
      [businessId]
    );

    return NextResponse.json({ ok: true, host: finalRs.rows?.[0] || null });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/lan/host/configure failed:", err);
    return NextResponse.json({ error: "Failed to configure LAN host" }, { status: 500 });
  } finally {
    client.release();
  }
}
