// app/api/inventory/adjustments/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { requireAnyPermission } from "@/app/lib/request-access";

/** ------------ Types for payload ------------ */
type ReasonLiteral =
  | "adjustment"
  | "sale"
  | "return"
  | "purchase"
  | "damage"
  | "loss"
  | "promo"
  | "correction";

type NewItem = {
  product_id: number | string;
  delta_qty: number | string;
  unit_cost?: number | string | null;
  notes?: string | null;
};

type NewAdjustmentBody = {
  reason?: ReasonLiteral | string;
  reference?: string | null;
  notes?: string | null;
  items: NewItem[];
};

/** ------------ Helpers ------------ */
function nstr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseDateOrNull(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
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

/** ============================================
 *  GET /api/inventory/adjustments
 *  Query: ?page=&perPage=&q=&status=&from=&to=
 * ============================================ */
export async function GET(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(200, Math.max(1, Number(url.searchParams.get("perPage") || 20)));
  const q = (url.searchParams.get("q") || "").trim();
  const status = (url.searchParams.get("status") || "").trim().toLowerCase();
  const from = parseDateOrNull(url.searchParams.get("from"));
  const to = parseDateOrNull(url.searchParams.get("to"));

  const [aCols, iCols] = await Promise.all([
    getTableColumns(pool, "inventory_adjustments"),
    getTableColumns(pool, "inventory_adjustment_items"),
  ]);
  const hasAdjustBusiness = aCols.has("business_id");
  const hasItemsBusiness = iCols.has("business_id");

  const where: string[] = [];
  const params: any[] = [];

  if (hasAdjustBusiness) {
    params.push(businessId);
    where.push(`ia.business_id = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(`(ia.reason ILIKE $${i} OR ia.reference ILIKE $${i} OR ia.notes ILIKE $${i})`);
  }

  if (status && ["draft", "posted", "reversed"].includes(status)) {
    params.push(status);
    where.push(`ia.status = $${params.length}`);
  }

  if (from) {
    params.push(from.toISOString());
    where.push(`ia.adjustment_date >= $${params.length}`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`ia.adjustment_date <= $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows: cnt } = await pool.query(
    `SELECT COUNT(*)::int AS cnt
       FROM inventory_adjustments ia
       ${whereSql}`,
    params
  );
  const total = cnt[0]?.cnt ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const offset = (page - 1) * perPage;

  const pageParams = [...params, perPage, offset];
  const linesBusinessJoin = hasItemsBusiness && hasAdjustBusiness ? " AND i.business_id = ia.business_id" : "";
  const list = await pool.query(
    `
    SELECT
      ia.id,
      ia.adjustment_date,
      ia.status,
      ia.reason,
      ia.reference,
      ia.notes,
      ia.created_at,
      ia.posted_at,
      (
        SELECT COUNT(*)::int
        FROM inventory_adjustment_items i
        WHERE i.adjustment_id = ia.id${linesBusinessJoin}
      ) AS lines
    FROM inventory_adjustments ia
    ${whereSql}
    ORDER BY ia.adjustment_date DESC, ia.id DESC
    LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}
    `,
    pageParams
  );

  return NextResponse.json({
    items: list.rows,
    total,
    page,
    perPage,
    totalPages,
  });
}

/** ============================================
 *  POST /api/inventory/adjustments
 *  Creates a DRAFT header + lines (no stock change yet).
 * ============================================ */
export async function POST(req: Request) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;

  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if (!access.ok) return access.response;
  const businessId = access.ctx.businessId;

  let body: NewAdjustmentBody;
  try {
    body = (await req.json()) as NewAdjustmentBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: "At least one item is required" }, { status: 400 });
  }

  const allowed: ReasonLiteral[] = [
    "adjustment",
    "sale",
    "return",
    "purchase",
    "damage",
    "loss",
    "promo",
    "correction",
  ];
  const rawReason = String(body.reason ?? "adjustment").toLowerCase();
  const reason: ReasonLiteral = (allowed as string[]).includes(rawReason)
    ? (rawReason as ReasonLiteral)
    : "adjustment";

  const reference = nstr(body.reference);
  const notes = nstr(body.notes);

  type Line = { product_id: number; delta_qty: number; unit_cost: number | null; notes: string | null };
  const lines: Line[] = [];

  for (const it of items) {
    const product_id = Number((it as any).product_id);
    const delta_qty = Number((it as any).delta_qty);
    const unit_costRaw = (it as any).unit_cost;
    const unit_cost = unit_costRaw == null || unit_costRaw === "" ? null : Number(unit_costRaw);
    const lnNotes = nstr((it as any).notes);

    if (!Number.isFinite(product_id) || product_id <= 0) {
      return NextResponse.json({ ok: false, error: "Each item needs a valid product_id" }, { status: 400 });
    }
    if (!Number.isFinite(delta_qty) || delta_qty === 0) {
      return NextResponse.json({ ok: false, error: "Each item needs a non-zero delta_qty" }, { status: 400 });
    }
    if (unit_cost != null && !Number.isFinite(unit_cost)) {
      return NextResponse.json({ ok: false, error: "unit_cost must be a number" }, { status: 400 });
    }

    lines.push({ product_id, delta_qty, unit_cost, notes: lnNotes });
  }

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

    const productIds = Array.from(new Set(lines.map((it) => String(it.product_id))));
    const found = await client.query(
      `SELECT id::text
         FROM products
        WHERE id::text = ANY($1::text[])${hasProductsBusiness ? " AND business_id = $2" : ""}`,
      hasProductsBusiness ? [productIds, businessId] : [productIds]
    );
    const foundSet = new Set<string>((found.rows || []).map((r: any) => String(r.id)));
    const missing = productIds.filter((pid) => !foundSet.has(pid));
    if (missing.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, error: `Unknown product_id(s): ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const headCols = [
      ...(hasAdjustBusiness ? ["business_id"] : []),
      "adjustment_date",
      "status",
      "reason",
      "reference",
      "notes",
      "meta",
    ];
    const headVals = [
      ...(hasAdjustBusiness ? [businessId] : []),
      new Date().toISOString(),
      "draft",
      reason,
      reference,
      notes,
    ];
    const headPh = headVals.map((_, idx) => `$${idx + 1}`);

    const headIns = await client.query(
      `INSERT INTO inventory_adjustments (${headCols.join(", ")})
       VALUES (${headPh.join(", ")}, '{}'::jsonb)
       RETURNING id`,
      headVals
    );
    const id = Number(headIns.rows[0].id);

    for (const ln of lines) {
      const cols = [
        ...(hasItemsBusiness ? ["business_id"] : []),
        "adjustment_id",
        "product_id",
        "delta_qty",
        "unit_cost",
        "notes",
        "meta",
      ];
      const vals = [
        ...(hasItemsBusiness ? [businessId] : []),
        id,
        ln.product_id,
        ln.delta_qty,
        ln.unit_cost,
        ln.notes,
      ];
      const ph = vals.map((_, idx) => `$${idx + 1}`);
      await client.query(
        `INSERT INTO inventory_adjustment_items (${cols.join(", ")}) VALUES (${ph.join(", ")}, '{}'::jsonb)`,
        vals
      );
    }

    await client.query(
      `UPDATE inventory_adjustments
          SET meta = jsonb_set(
            COALESCE(meta,'{}'::jsonb),
            '{items_summary}',
            jsonb_build_object('lines', $2::int, 'net_delta', $3::numeric)::jsonb,
            true
          )
        WHERE id = $1${hasAdjustBusiness ? " AND business_id = $4" : ""}`,
      hasAdjustBusiness
        ? [id, lines.length, lines.reduce((a, b) => a + Number(b.delta_qty || 0), 0), businessId]
        : [id, lines.length, lines.reduce((a, b) => a + Number(b.delta_qty || 0), 0)]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Create failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
