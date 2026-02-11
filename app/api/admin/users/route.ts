export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

type CreateBody = {
  full_name?: string;
  email?: string;
  phone?: string;
  password?: string;
  role_codes?: string[];
  status?: "active" | "pending";
};

function normalizeRoleCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const row of input) {
    const v = String(row || "").trim().toLowerCase();
    if (v) out.add(v);
  }
  return [...out];
}

async function resolveUserSeatLimit(client: any, businessId: number) {
  const limitRs = await client.query(
    `SELECT COALESCE(
        (
          SELECT l.user_limit
            FROM licenses l
           WHERE l.business_id = $1
             AND lower(l.status) = 'active'
             AND (l.valid_to IS NULL OR l.valid_to >= NOW())
           ORDER BY l.valid_to DESC NULLS LAST, l.id DESC
           LIMIT 1
        ),
        b.user_limit
      ) AS user_limit
       FROM businesses b
      WHERE b.id = $1
      LIMIT 1`,
    [businessId]
  );
  return Number(limitRs.rows?.[0]?.user_limit || 1);
}

export async function GET(req: Request) {
  const access = await requireAnyPermission(req, ["perm.users.manage"], "Forbidden");
  if (!access.ok) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const rs = await pool.query(
    `SELECT
        u.id,
        u.full_name,
        u.email,
        u.phone,
        u.status,
        u.created_at,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object('code', r.code, 'name', r.name)
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'::json
        ) AS roles
       FROM users u
       LEFT JOIN user_role_map m ON m.user_id = u.id
       LEFT JOIN roles r ON r.id = m.role_id
      WHERE u.business_id = $1
      GROUP BY u.id
      ORDER BY u.created_at DESC`,
    [businessId]
  );

  return NextResponse.json({ items: rs.rows || [] });
}

export async function POST(req: Request) {
  const access = await requireAnyPermission(req, ["perm.users.manage"], "Forbidden");
  if (!access.ok) return access.response;

  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const actorUserId = access.ctx.userId > 0 ? access.ctx.userId : getRequestUserId(req, 1);

  const fullName = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim() || null;
  const password = String(body.password || "");
  const roleCodes = normalizeRoleCodes(body.role_codes);
  const status = String(body.status || "active").toLowerCase() === "pending" ? "pending" : "active";

  if (!fullName || !email || password.length < 6) {
    return NextResponse.json(
      { error: "full_name, email and password(min 6 chars) are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (status === "active") {
      const usageRs = await client.query(
        `SELECT
            (SELECT COUNT(*)::int FROM users WHERE business_id = $1 AND status = 'active') AS active_users,
            (SELECT COUNT(*)::int FROM lan_clients WHERE business_id = $1 AND status = 'active') AS active_clients`,
        [businessId]
      );
      const activeUsers = Number(usageRs.rows?.[0]?.active_users || 0);
      const activeClients = Number(usageRs.rows?.[0]?.active_clients || 0);
      const userLimit = await resolveUserSeatLimit(client, businessId);
      if (activeUsers + activeClients >= userLimit) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `Seat limit reached (${userLimit}). Upgrade license to add more users/devices.` },
          { status: 403 }
        );
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userRs = await client.query(
      `INSERT INTO users
        (business_id, full_name, email, phone, password_hash, status, created_by, approved_by, approved_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 = 'active' THEN NOW() ELSE NULL END)
       RETURNING id, full_name, email, status, created_at`,
      [businessId, fullName, email, phone, passwordHash, status, actorUserId, status === "active" ? actorUserId : null]
    );
    const user = userRs.rows[0];

    const effectiveRoleCodes = roleCodes.length > 0 ? roleCodes : ["billing_staff"];
    const roleRs = await client.query(
      `SELECT id, code
         FROM roles
        WHERE (business_id = $1 OR business_id IS NULL)
          AND lower(code) = ANY($2::text[])
        ORDER BY business_id NULLS LAST`,
      [businessId, effectiveRoleCodes]
    );

    for (const role of roleRs.rows || []) {
      await client.query(
        `INSERT INTO user_role_map (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [user.id, role.id]
      );
    }

    if (status === "pending") {
      await client.query(
        `INSERT INTO approvals (business_id, user_id, request_type, status, requested_by, meta)
         VALUES ($1, $2, 'admin_user_create', 'pending', $3, $4::jsonb)`,
        [businessId, user.id, actorUserId, JSON.stringify({ role_codes: effectiveRoleCodes })]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, 'user.create', 'user', $3::text, $4::jsonb)`,
      [businessId, actorUserId, user.id, JSON.stringify({ status, role_codes: effectiveRoleCodes })]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        ok: true,
        user,
        role_codes: roleRs.rows.map((r: any) => String(r.code)),
      },
      { status: 201 }
    );
  } catch (err: any) {
    await client.query("ROLLBACK");
    const message = String(err?.message || "");
    console.error("POST /api/admin/users failed:", err);
    if (message.includes("users_business_email_uq") || message.includes("duplicate")) {
      return NextResponse.json({ error: "User already exists for this business" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  } finally {
    client.release();
  }
}
