export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";

type SignupBody = {
  business_id?: number;
  business_code?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  password?: string;
  requested_role?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SignupBody;
  const fullName = String(body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim() || null;
  const password = String(body.password || "");
  const requestedRole = String(body.requested_role || "billing_staff").trim().toLowerCase();

  if (!fullName || !email || password.length < 6) {
    return NextResponse.json(
      { error: "full_name, email and password(min 6 chars) are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let businessId = Number(body.business_id || 0);
    if (!Number.isFinite(businessId) || businessId <= 0) {
      const code = String(body.business_code || "").trim().toLowerCase();
      if (!code) {
        return NextResponse.json(
          { error: "business_id or business_code is required" },
          { status: 400 }
        );
      }
      const br = await client.query(
        `SELECT id, user_limit FROM businesses WHERE lower(code) = $1 AND is_active = TRUE LIMIT 1`,
        [code]
      );
      if (br.rowCount === 0) {
        return NextResponse.json({ error: "Business not found" }, { status: 404 });
      }
      businessId = Number(br.rows[0].id);
    }

    const activeRs = await client.query(
      `SELECT COUNT(*)::int AS active_users FROM users WHERE business_id = $1 AND status = 'active'`,
      [businessId]
    );
    let limitRs;
    try {
      limitRs = await client.query(
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
    } catch {
      limitRs = await client.query(
        `SELECT user_limit FROM businesses WHERE id = $1 LIMIT 1`,
        [businessId]
      );
    }
    const activeUsers = Number(activeRs.rows?.[0]?.active_users || 0);
    const userLimit = Number(limitRs.rows?.[0]?.user_limit || 1);
    if (activeUsers >= userLimit) {
      return NextResponse.json(
        { error: `User seat limit reached (${userLimit}). Contact admin.` },
        { status: 403 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const userRs = await client.query(
      `INSERT INTO users (business_id, full_name, email, phone, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, business_id, full_name, email, status, created_at`,
      [businessId, fullName, email, phone, passwordHash]
    );
    const user = userRs.rows[0];

    await client.query(
      `INSERT INTO approvals (business_id, user_id, request_type, status, meta)
       VALUES ($1, $2, 'signup', 'pending', $3::jsonb)`,
      [businessId, user.id, JSON.stringify({ requested_role: requestedRole })]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (err: any) {
    await client.query("ROLLBACK");
    const message = String(err?.message || "");
    console.error("POST /api/users/signup failed:", err);
    if (message.includes("users_business_email_uq") || message.includes("duplicate")) {
      return NextResponse.json({ error: "User already exists for this business" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create signup request" }, { status: 500 });
  } finally {
    client.release();
  }
}
