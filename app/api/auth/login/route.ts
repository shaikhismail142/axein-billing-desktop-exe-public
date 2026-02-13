export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import {
  createSessionToken,
  makeSessionCookie,
} from "@/app/lib/session";

type LoginBody = {
  email?: string;
  password?: string;
  business_code?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as LoginBody;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const businessCode = String(body.business_code || "").trim().toLowerCase();

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email and password are required" }, { status: 400 });
    }

    const userRs = await pool.query(
      `SELECT
         u.id,
         u.business_id,
         u.full_name,
         u.email,
         u.password_hash,
         lower(u.status) AS status,
         b.code AS business_code,
         b.name AS business_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
      WHERE lower(u.email) = $1
        AND b.is_active = TRUE
        AND ($2 = '' OR lower(b.code) = $2)
      ORDER BY u.id ASC
      LIMIT 1`,
      [email, businessCode]
    );
    if (!userRs.rowCount) {
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const user = userRs.rows[0] as any;
    if (String(user.status || "").toLowerCase() !== "active") {
      return NextResponse.json(
        { ok: false, error: "User is not active. Please wait for admin approval." },
        { status: 403 }
      );
    }

    const passwordHash = String(user.password_hash || "");
    const passwordOk = await bcrypt.compare(password, passwordHash);
    if (!passwordOk) {
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const roleRs = await pool.query(
      `SELECT DISTINCT lower(r.code) AS code
         FROM user_role_map m
         JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = $1
          AND (r.business_id = $2 OR r.business_id IS NULL)
      ORDER BY code ASC`,
      [user.id, user.business_id]
    );
    const roleCodes = (roleRs.rows || []).map((row: any) => String(row.code || "")).filter(Boolean);

    const token = createSessionToken({
      user_id: Number(user.id),
      business_id: Number(user.business_id),
      email: String(user.email || ""),
      full_name: String(user.full_name || ""),
      role_codes: roleCodes,
    });

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: Number(user.id),
          business_id: Number(user.business_id),
          full_name: String(user.full_name || ""),
          email: String(user.email || ""),
          business_code: String(user.business_code || ""),
          business_name: String(user.business_name || ""),
          role_codes: roleCodes,
        },
      },
      {
        headers: {
          "Set-Cookie": makeSessionCookie(token),
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    console.error("POST /api/auth/login failed:", err);
    return NextResponse.json({ ok: false, error: "Login failed" }, { status: 500 });
  }
}

