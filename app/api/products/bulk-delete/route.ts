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

type DeleteSummary = {
  deleted: number;
  blocked: number;
  blockedIds: number[];
};

async function deleteProductsOneByOne(ids: number[], scoped: boolean, businessId: number): Promise<DeleteSummary> {
  const client = await pool.connect();
  let deleted = 0;
  let blocked = 0;
  const blockedIds: number[] = [];

  try {
    await client.query("BEGIN");
    for (const id of ids) {
      await client.query("SAVEPOINT product_delete_sp");
      try {
        const res = scoped
          ? await client.query(`DELETE FROM products WHERE id = $1 AND business_id = $2`, [id, businessId])
          : await client.query(`DELETE FROM products WHERE id = $1`, [id]);
        deleted += Number(res.rowCount || 0);
        await client.query("RELEASE SAVEPOINT product_delete_sp");
      } catch (err: any) {
        await client.query("ROLLBACK TO SAVEPOINT product_delete_sp");
        await client.query("RELEASE SAVEPOINT product_delete_sp");
        // Keep deleting independent rows when FK constraints block a subset.
        if (String(err?.code || "") === "23503") {
          blocked += 1;
          if (blockedIds.length < 25) blockedIds.push(id);
          continue;
        }
        throw err;
      }
    }
    await client.query("COMMIT");
    return { deleted, blocked, blockedIds };
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Delete failed");
  } finally {
    client.release();
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

  const clean = Array.isArray(ids)
    ? ids.filter((n) => Number.isFinite(Number(n))).map(Number)
    : [];

  let targetIds: number[] = clean;
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
    const rs = await pool.query(`SELECT p.id FROM products p ${whereSql}`, params);
    targetIds = (rs.rows || [])
      .map((r: any) => Number(r.id))
      .filter((n: number) => Number.isFinite(n));
  }

  if (!targetIds.length) {
    return NextResponse.json({ ok: true, deleted: 0, blocked: 0, scope: all ? "all-filtered" : "selected" });
  }

  const summary = await deleteProductsOneByOne(targetIds, scoped, businessId);
  return NextResponse.json({
    ok: true,
    deleted: summary.deleted,
    blocked: summary.blocked,
    blocked_ids: summary.blockedIds,
    scope: all ? "all-filtered" : "selected",
    message:
      summary.blocked > 0
        ? `${summary.deleted} deleted, ${summary.blocked} blocked (linked records).`
        : `${summary.deleted} deleted.`,
  });
}
