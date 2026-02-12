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
    const debug = process.env.AXEIN_DEBUG_SIGNUP === "1";
    let businessId = Number(body.business_id || 0);
    const businessCode = String(body.business_code || "").trim().toLowerCase();

    const businessesRs = await client.query(
      `SELECT id, code, is_active
         FROM businesses
        ORDER BY id ASC`
    );
    const businesses = (businessesRs.rows || [])
      .map((row) => ({
        id: Number(row.id || 0),
        code: String(row.code || "").trim().toLowerCase(),
        isActive: row.is_active !== false,
      }))
      .filter((row) => Number.isFinite(row.id) && row.id > 0);
    const activeBusinesses = businesses.filter((row) => row.isActive);
    let businessFound = false;

    if (debug) {
      console.warn("[signup] resolve input", {
        businessId,
        businessCode,
        businesses: businesses.map((row) => ({ id: row.id, code: row.code, isActive: row.isActive })),
      });
    }

    if (Number.isFinite(businessId) && businessId > 0) {
      const byId = businesses.find((row) => row.id === businessId);
      if (byId?.isActive) {
        businessFound = true;
      }
    } else if (businessCode) {
      const byCode = activeBusinesses.find((row) => row.code && row.code === businessCode);
      if (byCode) {
        businessId = byCode.id;
        businessFound = true;
      }
    }

    if (!businessFound && activeBusinesses.length === 1) {
      businessId = activeBusinesses[0].id;
      businessFound = true;
    }

    if (!businessFound || !Number.isFinite(businessId) || businessId <= 0) {
      if (debug) {
        console.warn("[signup] business resolution failed", { businessId, businessCode, activeCount: activeBusinesses.length });
      }
      return NextResponse.json(
        {
          error: "Business not found",
          ...(debug
            ? {
                debug: {
                  business_id: Number(body.business_id || 0),
                  business_code: businessCode || null,
                  resolved_business_id: businessId,
                  active_businesses: activeBusinesses.map((row) => ({ id: row.id, code: row.code })),
                  all_businesses: businesses.map((row) => ({
                    id: row.id,
                    code: row.code,
                    is_active: row.isActive,
                  })),
                },
              }
            : {}),
        },
        { status: 404 }
      );
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
