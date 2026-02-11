// app/api/invoices/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/lib/platform-context";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const businessId = getRequestBusinessId(req, 1);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scopedCheck = await client.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='sales'
          AND column_name='business_id'
        LIMIT 1`
    );
    const hasSalesBusiness = (scopedCheck.rowCount || 0) > 0;
    const salesScopeWhere = hasSalesBusiness ? "id=$1 AND business_id=$2" : "id=$1";
    const salesScopeParams = hasSalesBusiness ? [id, businessId] : [id];

    const rs = await client.query(`SELECT meta FROM sales WHERE ${salesScopeWhere} FOR UPDATE`, salesScopeParams);
    if (!rs.rowCount) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Not found" }, { status: 404 }); }
    const meta = { ...(rs.rows[0].meta || {}) };

    if (typeof body.is_return === "boolean") meta.is_return = body.is_return;
    if (body.amount_paid !== undefined) meta.amount_paid = Number(body.amount_paid || 0);
    if (typeof body.notes === "string") meta.notes = body.notes;

    // Update payment columns if present
    let paid = Number(meta.amount_paid || 0);
    if (!Number.isFinite(paid)) paid = 0;
    const saleRow = await client.query(`SELECT total FROM sales WHERE ${salesScopeWhere}`, salesScopeParams);
    const total = Number(saleRow.rows?.[0]?.total || 0);
    const pending = Math.max(total - paid, 0);
    const status = paid >= total - 0.01 ? "Paid" : paid > 0 ? "Partial" : "Pending";
    meta.pending_amount = pending;
    meta.payment_status = status;

    try {
      if (hasSalesBusiness) {
        await client.query(
          `UPDATE sales
             SET amount_paid=$2, pending_amount=$3, payment_status=$4, meta=$5, updated_at=now()
           WHERE id=$1 AND business_id=$6`,
          [id, paid, pending, status, meta, businessId]
        );
      } else {
        await client.query(
          `UPDATE sales
             SET amount_paid=$2, pending_amount=$3, payment_status=$4, meta=$5, updated_at=now()
           WHERE id=$1`,
          [id, paid, pending, status, meta]
        );
      }
    } catch {
      if (hasSalesBusiness) {
        await client.query(`UPDATE sales SET meta=$2, updated_at=now() WHERE id=$1 AND business_id=$3`, [id, meta, businessId]);
      } else {
        await client.query(`UPDATE sales SET meta=$2, updated_at=now() WHERE id=$1`, [id, meta]);
      }
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/invoices/[id] failed", e);
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
