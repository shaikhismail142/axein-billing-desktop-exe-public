import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db"; // your pg Pool
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const access = await requireAnyPermission(
    req,
    ["perm.customers.manage", "perm.sales.manage", "perm.quotations.manage", "perm.payments.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const { searchParams } = new URL(req.url);
  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10), 1), 50);

  try {
    const client = await pool.connect();
    try {
      // Adjust fields to your customers table; meta is JSONB per your project
      const scopedCheck = await client.query(
        `SELECT 1
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name='customers'
            AND column_name='business_id'
          LIMIT 1`
      );
      const hasBusinessId = (scopedCheck.rowCount || 0) > 0;
      const values: any[] = [];
      const whereParts: string[] = [];
      if (hasBusinessId) {
        values.push(businessId);
        whereParts.push(`c.business_id = $${values.length}`);
      }
      if (q) {
        values.push(`%${q}%`);
        const searchRef = `$${values.length}`;
        whereParts.push(`(
          c.name ILIKE ${searchRef} OR
          COALESCE(c.email, '') ILIKE ${searchRef} OR
          COALESCE(c.phone, '') ILIKE ${searchRef}
        )`);
      }
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

      values.push(limit);
      const sql = `
        SELECT
          c.id,
          c.name,
          c.email,
          c.phone,
          c.meta
        FROM customers c
        ${where}
        ORDER BY c.name ASC
        LIMIT $${values.length}
      `;
      const { rows } = await client.query(sql, values);

      return NextResponse.json({ ok: true, items: rows, count: rows.length }, {
        headers: { "Cache-Control": "no-store" },
      });
    } finally {
      client.release();
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Search failed" }, { status: 500 });
  }
}
