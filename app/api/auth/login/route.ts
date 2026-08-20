export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { pool } from "@/lib/db";
import {
  createSessionToken,
  makeSessionCookie,
} from "@/app/lib/session";
import { isSaasDeployment } from "@/app/lib/deployment";

type LoginBody = {
  email?: string;
  password?: string;
  business_code?: string;
};

async function resolveBusinessIdForLoginAttempt(businessCode: string): Promise<number | null> {
  try {
    if (businessCode) {
      const rs = await pool.query(
        `SELECT id
           FROM businesses
          WHERE is_active = TRUE
            AND lower(code) = $1
          LIMIT 1`,
        [businessCode.toLowerCase()]
      );
      if (rs.rowCount) return Number(rs.rows[0].id);
    }
    const rs = await pool.query(
      `SELECT id
         FROM businesses
        WHERE is_active = TRUE
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`
    );
    if (rs.rowCount) return Number(rs.rows[0].id);
  } catch {
    // ignore
  }
  return null;
}

async function audit(
  businessId: number | null,
  action: string,
  entityType: string,
  entityId: string | null,
  actorUserId: number | null,
  meta: Record<string, unknown>
) {
  if (!businessId || businessId <= 0) return;
  try {
    await pool.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [businessId, actorUserId, action, entityType, entityId, JSON.stringify(meta || {})]
    );
  } catch {
    // never block auth on audit failures
  }
}

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
         u.is_system_admin,
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
      const bid = await resolveBusinessIdForLoginAttempt(businessCode);
      await audit(bid, "auth.login.failed", "user", email, null, {
        business_code: businessCode || null,
        reason: "user_not_found",
      });
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const user = userRs.rows[0] as any;
    const hasLocalPassword = String(user.password_hash || "").trim().length > 0;
    if (isSaasDeployment() && !Boolean(user.is_system_admin) && !hasLocalPassword) {
      await audit(Number(user.business_id), "auth.login.denied", "user", String(user.id), null, {
        email,
        reason: "sso_required",
      });
      return NextResponse.json(
        { ok: false, error: "Use your connected business portal to sign in." },
        { status: 403 }
      );
    }
    if (String(user.status || "").toLowerCase() !== "active") {
      await audit(Number(user.business_id), "auth.login.denied", "user", String(user.id), null, {
        email,
        business_code: String(user.business_code || ""),
        reason: "user_not_active",
        status: String(user.status || ""),
      });
      return NextResponse.json(
        { ok: false, error: "User is not active. Please wait for admin approval." },
        { status: 403 }
      );
    }

    const passwordHash = String(user.password_hash || "");
    const passwordOk = await bcrypt.compare(password, passwordHash);
    if (!passwordOk) {
      await audit(Number(user.business_id), "auth.login.failed", "user", String(user.id), null, {
        email,
        business_code: String(user.business_code || ""),
        reason: "invalid_password",
      });
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

    await audit(Number(user.business_id), "auth.login.success", "user", String(user.id), Number(user.id), {
      email,
      business_code: String(user.business_code || ""),
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
