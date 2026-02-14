export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { isKeygenUnlocked } from "@/app/lib/keygen-session";
import { pool } from "@/lib/db";

function keygenApiAvailable() {
  return process.env.AXEIN_APP_MODE === "keygen" || process.env.AXEIN_INCLUDE_KEYGEN_UI === "1";
}

function forbidden(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function GET(req: Request) {
  try {
    if (!keygenApiAvailable()) {
      return NextResponse.json({ ok: false, error: "Not available on this install" }, { status: 404 });
    }
    if (req.headers.get("x-admin") !== "1") {
      return forbidden("Admin context required");
    }
    if (!isKeygenUnlocked(req)) {
      return forbidden("Keygen unlock required");
    }

    const url = new URL(req.url);
    const page = clampInt(url.searchParams.get("page"), 1, 1, 10_000);
    const pageSize = clampInt(url.searchParams.get("page_size"), 20, 5, 100);
    const sort = String(url.searchParams.get("sort") || "created_at").toLowerCase();
    const dir = String(url.searchParams.get("dir") || "desc").toLowerCase() === "asc" ? "asc" : "desc";

    const sortColumn =
      sort === "expires_at"
        ? "expires_at"
        : sort === "business_name"
        ? "business_name"
        : sort === "user_limit"
        ? "user_limit"
        : "created_at";

    const offset = (page - 1) * pageSize;

    let total = 0;
    let totalPages = 0;
    let items: any[] = [];
    try {
      const totalRs = await pool.query(`SELECT COUNT(*)::int AS total FROM keygen_license_issues`);
      total = Number(totalRs.rows?.[0]?.total || 0);
      totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

      const itemsRs = await pool.query(
        `SELECT id, created_at, mode,
                license_key, email, business_name, business_type,
                usage_mode, installation_scope, license_type,
                user_limit, computer_limit, valid_from, expires_at,
                activation_token
           FROM keygen_license_issues
          ORDER BY ${sortColumn} ${dir.toUpperCase()} NULLS LAST, id DESC
          LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      );
      items = itemsRs.rows || [];
    } catch (e: any) {
      // If someone upgrades binaries but hasn't applied DB migrations yet,
      // keep Keygen usable and show empty history instead of a hard failure.
      if (String(e?.code || "") === "42P01") {
        return NextResponse.json({
          ok: true,
          page,
          page_size: pageSize,
          total: 0,
          total_pages: 0,
          sort: sortColumn,
          dir,
          items: [],
          warning: "Keygen history table is missing. Apply migrations and restart.",
        });
      }
      throw e;
    }

    return NextResponse.json({
      ok: true,
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      sort: sortColumn,
      dir,
      items,
    });
  } catch (err: any) {
    console.error("GET /api/staff/keygen/history failed:", err);
    return NextResponse.json({ ok: false, error: String(err?.message || "Failed") }, { status: 500 });
  }
}
