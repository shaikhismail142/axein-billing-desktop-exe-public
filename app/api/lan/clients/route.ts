export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";

export async function GET(req: NextRequest) {
  const access = await requireAnyPermission(req, ["perm.users.manage", "perm.users.approve"], "Forbidden");
  if (!access.ok) return access.response;

  const businessId = access.ctx.businessId;
  const rs = await pool.query(
    `SELECT client_uid, device_name, role_code, status, paired_at, last_seen_at, last_ip, notes
       FROM lan_clients
      WHERE business_id = $1
      ORDER BY paired_at DESC`,
    [businessId]
  );

  return NextResponse.json({ items: rs.rows || [] });
}
