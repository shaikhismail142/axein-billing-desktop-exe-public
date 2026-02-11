export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { adjustStock } from "@/app/lib/inventory/stock";
import { requireAnyPermission } from "@/app/lib/request-access";

type ReasonLiteral =
  | "adjustment" | "sale" | "return" | "purchase"
  | "damage" | "loss" | "promo" | "correction";

const ALLOWED_REASONS = new Set<ReasonLiteral>([
  "adjustment","sale","return","purchase","damage","loss","promo","correction"
]);

async function getInventorySettings(client: any, businessId: number) {
  const cols = await getTableColumns(client, "settings").catch(() => new Set<string>());
  const hasSettingsBusiness = cols.has("business_id");
  const rs = await client.query(
    `SELECT value_json
       FROM settings
      WHERE key='inventory'${hasSettingsBusiness ? " AND business_id = $1" : ""}
      ORDER BY id DESC
      LIMIT 1`,
    hasSettingsBusiness ? [businessId] : []
  );
  const j = rs.rows?.[0]?.value_json || {};
  return { allow_negative_stock: !!j.allow_negative_stock };
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guardApiActivated(true);
  if ("response" in g) return g.response;
  const access = await requireAnyPermission(
    req,
    ["perm.inventory.manage", "perm.purchases.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const aCols = await getTableColumns(client, "inventory_adjustments");
    const iCols = await getTableColumns(client, "inventory_adjustment_items");
    const hasAdjustBusiness = aCols.has("business_id");
    const hasItemsBusiness = iCols.has("business_id");

    const head = await client.query(
      `SELECT id, status, reason, reference, notes
         FROM inventory_adjustments
        WHERE id=$1${hasAdjustBusiness ? " AND business_id = $2" : ""}
        FOR UPDATE`,
      hasAdjustBusiness ? [id, businessId] : [id]
    );
    if (head.rowCount === 0) throw new Error("Not found");
    if (head.rows[0].status !== "draft") throw new Error("Only drafts can be posted");

    const items = await client.query(
      `SELECT product_id, delta_qty, unit_cost, notes
         FROM inventory_adjustment_items
        WHERE adjustment_id=$1${hasItemsBusiness ? " AND business_id = $2" : ""}
        ORDER BY id ASC
        FOR UPDATE`,
      hasItemsBusiness ? [id, businessId] : [id]
    );
    if (items.rowCount === 0) throw new Error("No items to post");

    const settings = await getInventorySettings(client, businessId);
    const allowNeg = !!settings.allow_negative_stock;

    // Normalize the reason to a typed literal
    const rawReason = String(head.rows[0].reason ?? "adjustment").toLowerCase();
    const reason: ReasonLiteral = ALLOWED_REASONS.has(rawReason as ReasonLiteral)
      ? (rawReason as ReasonLiteral)
      : "adjustment";

    // Apply all deltas atomically
    for (const it of items.rows) {
      const res = await adjustStock({
        client,
        productId: Number(it.product_id),
        businessId,
        delta: Number(it.delta_qty),
        reason, // <- typed literal
        refType: "inventory_adjustment",
        refId: id,
        allowNegativeOverride: allowNeg,
        meta: {
          note: it.notes || null,
          reference: head.rows[0].reference || null,
          unit_cost: it.unit_cost ?? null,
        },
      });
      if (!res.ok) throw new Error(res.error || "Stock update failed");
    }

    await client.query(
      `UPDATE inventory_adjustments
          SET status='posted',
              posted_at = now(),
              meta = jsonb_set(COALESCE(meta,'{}'::jsonb), '{posted_summary}', to_jsonb(now()), true)
        WHERE id=$1${hasAdjustBusiness ? " AND business_id = $2" : ""}`,
      hasAdjustBusiness ? [id, businessId] : [id]
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ ok: false, error: e?.message || "Post failed" }, { status: 400 });
  } finally {
    client.release();
  }
}
