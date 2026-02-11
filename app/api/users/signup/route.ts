export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import { resolveSeatUsage } from "@/app/lib/seat-limits";

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
  let txStarted = false;
  try {
    let businessId = Number(body.business_id || 0);
    let businessFound = false;

    if (Number.isFinite(businessId) && businessId > 0) {
      const byIdRs = await client.query(
        `SELECT id
           FROM businesses
          WHERE id = $1
            AND is_active = TRUE
          LIMIT 1`,
        [businessId]
      );
      if (byIdRs.rowCount > 0) {
        businessFound = true;
      }
    } else {
      const code = String(body.business_code || "").trim().toLowerCase();
      if (!code) {
        return NextResponse.json(
          { error: "business_id or business_code is required" },
          { status: 400 }
        );
      }
      const byCodeRs = await client.query(
        `SELECT id
           FROM businesses
          WHERE lower(code) = $1
            AND is_active = TRUE
          LIMIT 1`,
        [code]
      );
      if (byCodeRs.rowCount > 0) {
        businessId = Number(byCodeRs.rows[0].id);
        businessFound = true;
      }
    }

    if (!businessFound || !Number.isFinite(businessId) || businessId <= 0) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const seatUsage = await resolveSeatUsage(client, businessId);
    if (seatUsage.used_seats >= seatUsage.seat_limit) {
      return NextResponse.json(
        {
          error: `User/device seat limit reached (${seatUsage.seat_limit}). Contact admin.`,
          seat_usage: seatUsage,
        },
        { status: 403 }
      );
    }

    await client.query("BEGIN");
    txStarted = true;

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

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, NULL, 'user.signup.request', 'user', $2::text, $3::jsonb)`,
      [businessId, user.id, JSON.stringify({ requested_role: requestedRole })]
    );

    await client.query("COMMIT");
    txStarted = false;
    return NextResponse.json({ ok: true, user, seat_usage: seatUsage }, { status: 201 });
  } catch (err: any) {
    if (txStarted) {
      await client.query("ROLLBACK");
      txStarted = false;
    }
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
