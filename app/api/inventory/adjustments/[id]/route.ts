export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { requireAnyPermission } from "@/app/lib/request-access";

function nstr(v: unknown) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

async function getTableColumns(client: any, table: string): Promise<Set<string>> {
  const rs = await client.query(
    `SELECT lower(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  return new Set<string>((rs.rows || []).map((r: any) => String(r.col)));
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const [aCols, iCols, pCols] = await Promise.all([
    getTableColumns(pool, "inventory_adjustments"),
    getTableColumns(pool, "inventory_adjustment_items"),
    getTableColumns(pool, "products").catch(() => new Set<string>()),
  ]);
  const hasAdjustBusiness = aCols.has("business_id");
  const hasItemsBusiness = iCols.has("business_id");
  const hasProductsBusiness = pCols.has("business_id");

  const head = await pool.query(
    `SELECT id, adjustment_date, status, reason, reference, notes, created_at, posted_at, meta
       FROM inventory_adjustments
      WHERE id = $1${hasAdjustBusiness ? " AND business_id = $2" : ""}`,
    hasAdjustBusiness ? [id, businessId] : [id]
  );
  if (head.rowCount === 0) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const itemParams: any[] = [id];
  const itemBusinessRef = hasItemsBusiness || hasProductsBusiness ? `$${itemParams.push(businessId)}` : null;
  const items = await pool.query(
    `SELECT ia.id, ia.product_id, p.name AS product_name, ia.delta_qty, ia.unit_cost, ia.notes
       FROM inventory_adjustment_items ia
       JOIN products p
         ON p.id = ia.product_id${
           hasProductsBusiness ? ` AND p.business_id = ${hasItemsBusiness ? "ia.business_id" : itemBusinessRef}` : ""
         }
      WHERE ia.adjustment_id = $1${hasItemsBusiness ? ` AND ia.business_id = ${itemBusinessRef}` : ""}
      ORDER BY ia.id ASC`,
    itemParams
  );

  return NextResponse.json({ ok: true, header: head.rows[0], items: items.rows });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {}

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const [aCols, iCols, pCols] = await Promise.all([
      getTableColumns(client, "inventory_adjustments"),
      getTableColumns(client, "inventory_adjustment_items"),
      getTableColumns(client, "products").catch(() => new Set<string>()),
    ]);
    const hasAdjustBusiness = aCols.has("business_id");
    const hasItemsBusiness = iCols.has("business_id");
    const hasProductsBusiness = pCols.has("business_id");

    const head = await client.query(
      `SELECT status
         FROM inventory_adjustments
        WHERE id = $1${hasAdjustBusiness ? " AND business_id = $2" : ""}`,
      hasAdjustBusiness ? [id, businessId] : [id]
    );
    if (head.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (head.rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, error: "Only drafts can be edited" }, { status: 400 });
    }

    const fields: string[] = [];
    const paramsArr: any[] = [];
    if (payload.adjustment_date) {
      paramsArr.push(new Date(String(payload.adjustment_date)).toISOString());
      fields.push(`adjustment_date = $${paramsArr.length}`);
    }
    if (payload.reason) {
      paramsArr.push(String(payload.reason));
      fields.push(`reason = $${paramsArr.length}`);
    }
    if (payload.reference !== undefined) {
      paramsArr.push(nstr(payload.reference));
      fields.push(`reference = $${paramsArr.length}`);
    }
    if (payload.notes !== undefined) {
      paramsArr.push(nstr(payload.notes));
      fields.push(`notes = $${paramsArr.length}`);
    }

    if (fields.length) {
      const updateParams = [...paramsArr, id];
      if (hasAdjustBusiness) updateParams.push(businessId);
      await client.query(
        `UPDATE inventory_adjustments
            SET ${fields.join(", ")}
          WHERE id = $${paramsArr.length + 1}${
            hasAdjustBusiness ? ` AND business_id = $${paramsArr.length + 2}` : ""
          }`,
        updateParams
      );
    }

    if (Array.isArray(payload.items)) {
      const normItems = [];
      for (const it of payload.items) {
        const pid = Number(it.product_id);
        const delta = Number(it.delta_qty);
        if (!Number.isFinite(pid) || pid <= 0) {
          throw new Error("Invalid product_id in items");
        }
        if (!Number.isFinite(delta) || delta === 0) {
          throw new Error("delta_qty must be non-zero in items");
        }
        const unit_cost = it.unit_cost == null ? null : Number(it.unit_cost);
        normItems.push({ product_id: pid, delta_qty: delta, unit_cost, notes: nstr(it.notes) });
      }

      const productIds = Array.from(new Set(normItems.map((it) => String(it.product_id))));
      const found = await client.query(
        `SELECT id::text
           FROM products
          WHERE id::text = ANY($1::text[])${hasProductsBusiness ? " AND business_id = $2" : ""}`,
        hasProductsBusiness ? [productIds, businessId] : [productIds]
      );
      const foundSet = new Set<string>((found.rows || []).map((r: any) => String(r.id)));
      const missing = productIds.filter((pid) => !foundSet.has(pid));
      if (missing.length) {
        throw new Error(`Unknown product_id(s): ${missing.join(", ")}`);
      }

      await client.query(
        `DELETE FROM inventory_adjustment_items
          WHERE adjustment_id = $1${hasItemsBusiness ? " AND business_id = $2" : ""}`,
        hasItemsBusiness ? [id, businessId] : [id]
      );

      for (const it of normItems) {
        const cols = [
          ...(hasItemsBusiness ? ["business_id"] : []),
          "adjustment_id",
          "product_id",
          "delta_qty",
          "unit_cost",
          "notes",
        ];
        const vals = [
          ...(hasItemsBusiness ? [businessId] : []),
          id,
          it.product_id,
          it.delta_qty,
          it.unit_cost,
          it.notes,
        ];
        const ph = vals.map((_, idx) => `$${idx + 1}`);
        await client.query(
          `INSERT INTO inventory_adjustment_items (${cols.join(", ")}) VALUES (${ph.join(", ")})`,
          vals
        );
      }

      const sum = await client.query(
        `SELECT COUNT(*)::int AS lines, COALESCE(SUM(delta_qty),0) AS net_delta
           FROM inventory_adjustment_items
          WHERE adjustment_id = $1${hasItemsBusiness ? " AND business_id = $2" : ""}`,
        hasItemsBusiness ? [id, businessId] : [id]
      );
      await client.query(
        `UPDATE inventory_adjustments
            SET meta = jsonb_set(COALESCE(meta,'{}'::jsonb), '{items_summary}', to_jsonb($2::json), true)
          WHERE id = $1${hasAdjustBusiness ? " AND business_id = $3" : ""}`,
        hasAdjustBusiness
          ? [id, { lines: sum.rows[0].lines, net_delta: Number(sum.rows[0].net_delta) }, businessId]
          : [id, { lines: sum.rows[0].lines, net_delta: Number(sum.rows[0].net_delta) }]
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Update failed" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const [aCols, iCols] = await Promise.all([
      getTableColumns(client, "inventory_adjustments"),
      getTableColumns(client, "inventory_adjustment_items"),
    ]);
    const hasAdjustBusiness = aCols.has("business_id");
    const hasItemsBusiness = iCols.has("business_id");

    const rs = await client.query(
      `SELECT status FROM inventory_adjustments WHERE id = $1${hasAdjustBusiness ? " AND business_id = $2" : ""}`,
      hasAdjustBusiness ? [id, businessId] : [id]
    );
    if (rs.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (rs.rows[0].status !== "draft") {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, error: "Only drafts can be deleted" }, { status: 400 });
    }

    await client.query(
      `DELETE FROM inventory_adjustment_items
        WHERE adjustment_id = $1${hasItemsBusiness ? " AND business_id = $2" : ""}`,
      hasItemsBusiness ? [id, businessId] : [id]
    );

    const del = await client.query(
      `DELETE FROM inventory_adjustments
        WHERE id = $1${hasAdjustBusiness ? " AND business_id = $2" : ""}`,
      hasAdjustBusiness ? [id, businessId] : [id]
    );
    if (!del.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Delete failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
