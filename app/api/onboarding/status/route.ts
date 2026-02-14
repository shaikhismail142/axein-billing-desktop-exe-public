export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    const bizRs = await pool.query(
      `SELECT id, code, name, business_type, usage_mode, user_limit, computer_limit, updated_at
         FROM businesses
        WHERE is_active = TRUE
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`
    );
    const business = bizRs.rows?.[0] || null;
    if (!business) {
      return NextResponse.json({ ok: true, hasBusiness: false, hasUsers: false, business: null });
    }

    const usersRs = await pool.query(
      `SELECT COUNT(*)::int AS cnt
         FROM users
        WHERE business_id = $1`,
      [business.id]
    );
    const cnt = Number(usersRs.rows?.[0]?.cnt || 0);
    return NextResponse.json({
      ok: true,
      hasBusiness: true,
      hasUsers: cnt > 0,
      business,
    });
  } catch (err) {
    console.error("GET /api/onboarding/status failed:", err);
    return NextResponse.json({ error: "Failed to load onboarding status" }, { status: 500 });
  }
}

