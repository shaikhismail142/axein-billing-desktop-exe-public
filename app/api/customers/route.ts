export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getRequestBusinessId } from "@/app/lib/platform-context";
import { requireAnyPermission } from "@/app/lib/request-access";

async function hasBusinessColumn() {
  try {
    const rs = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'customers'
          AND column_name = 'business_id'
        LIMIT 1`
    );
    return (rs.rowCount || 0) > 0;
  } catch {
    return false;
  }
}

/** GET /api/customers?q=...   → { items: [{id,name,phone,gstin,address}] } */
export async function GET(req: Request) {
  try {
    const access = await requireAnyPermission(
      req,
      ["perm.customers.manage", "perm.sales.manage", "perm.quotations.manage", "perm.payments.manage"],
      "Forbidden"
    );
    if ("response" in access) return access.response;

    const url = new URL(req.url);
    const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
    const scoped = await hasBusinessColumn();
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(50, Number(url.searchParams.get("limit") || 20));

    if (!q) {
      const rs = await pool.query(
        `SELECT c.id, c.name, c.phone, c.gstin, c.address,
                ${scoped ? "EXISTS(SELECT 1 FROM integration_record_links l WHERE l.business_id=$1 AND l.provider='defenzo' AND l.entity_type='customer' AND l.internal_id=c.id::text)" : "false"} AS crm_linked
           FROM customers c
          ${scoped ? "WHERE business_id = $1" : ""}
          ORDER BY c.name ASC
          LIMIT $${scoped ? 2 : 1}`,
        scoped ? [businessId, limit] : [limit]
      );
      return NextResponse.json({ items: rs.rows });
    }

    const rs = await pool.query(
        `SELECT c.id, c.name, c.phone, c.gstin, c.address,
                ${scoped ? "EXISTS(SELECT 1 FROM integration_record_links l WHERE l.business_id=$1 AND l.provider='defenzo' AND l.entity_type='customer' AND l.internal_id=c.id::text)" : "false"} AS crm_linked
         FROM customers c
        WHERE ${scoped ? "business_id = $1 AND" : ""}
          (name ILIKE $${scoped ? 2 : 1}
           OR phone ILIKE $${scoped ? 2 : 1}
           OR gstin ILIKE $${scoped ? 2 : 1})
        ORDER BY c.name ASC
        LIMIT $${scoped ? 3 : 2}`,
      scoped ? [businessId, `%${q}%`, limit] : [`%${q}%`, limit]
    );
    return NextResponse.json({ items: rs.rows });
  } catch (err) {
    console.error("GET /api/customers failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** Optional: create a quick customer if needed */
export async function POST(req: Request) {
  try {
    const access = await requireAnyPermission(
      req,
      ["perm.customers.manage", "perm.sales.manage", "perm.quotations.manage", "perm.payments.manage"],
      "Forbidden"
    );
    if ("response" in access) return access.response;

    const body = await req.json();
    const businessId = access.ctx.businessId || getRequestBusinessId(req, 1);
    const scoped = await hasBusinessColumn();
    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const params = [
      body.name.trim(),
      body.phone ? String(body.phone) : null,
      body.gstin ? String(body.gstin) : null,
      body.address ? String(body.address) : null,
    ];
    const rs = scoped
      ? await pool.query(
          `INSERT INTO customers(business_id, name, phone, gstin, address)
           VALUES($1, $2, $3, $4, $5)
           RETURNING id`,
          [businessId, ...params]
        )
      : await pool.query(
          `INSERT INTO customers(name, phone, gstin, address)
           VALUES($1, $2, $3, $4)
           RETURNING id`,
          params
        );
    return NextResponse.json({ id: rs.rows[0].id }, { status: 201 });
  } catch (err) {
    console.error("POST /api/customers failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
