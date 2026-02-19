// app/api/products/bulk-delete/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

async function hasProductBusinessColumn() {
  try {
    const rs = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='products'
          AND column_name='business_id'
        LIMIT 1`
    );
    return (rs.rowCount || 0) > 0;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const access = await requireAnyPermission(
    req,
    ["perm.products.manage", "perm.inventory.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;

  const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
  const scoped = await hasProductBusinessColumn();
  const body = await req.json().catch(() => ({}));
  const ids: number[] | undefined = Array.isArray(body?.ids) ? body.ids : undefined;
  const all: boolean = !!body?.all;
  const q: string = (body?.q || "").trim();
  const category: string = (body?.category || "").trim();
  const lowOnly: boolean = String(body?.low || "").trim() === "1";

  if (!all && (!ids || ids.length === 0)) {
    return NextResponse.json({ error: "Provide ids[] or set all=true" }, { status: 400 });
  }

  if (all) {
    const params: any[] = scoped ? [businessId] : [];
    const where: string[] = [];
    if (scoped) {
      where.push(`p.business_id = $1`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(p.name ILIKE $${params.length} OR (p.meta->>'sku') ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`COALESCE(NULLIF(p.category,''), NULLIF(p.meta->>'category','')) = $${params.length}`);
    }
    if (lowOnly) {
      where.push(
        `COALESCE(NULLIF(p.meta->>'stock_qty','')::int, NULLIF(p.meta->>'stock','')::int, 0)
         <= COALESCE(NULLIF(p.meta->>'low_stock_threshold','')::int, 0)`
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rowCount } = await pool.query(`DELETE FROM products p ${whereSql}`, params);
    return NextResponse.json({ ok: true, deleted: rowCount, scope: "all-filtered" });
  } else {
    const clean = ids.filter((n) => Number.isFinite(Number(n))).map(Number);
    const { rowCount } = scoped
      ? await pool.query(`DELETE FROM products WHERE id = ANY($1::int[]) AND business_id = $2`, [clean, businessId])
      : await pool.query(`DELETE FROM products WHERE id = ANY($1::int[])`, [clean]);
    return NextResponse.json({ ok: true, deleted: rowCount, scope: "selected" });
  }
}
