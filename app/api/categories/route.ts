import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db";
import { guardApiActivated } from "@/app/lib/activation-guard";
import { requireAnyPermission } from "@/app/lib/request-access";

export const dynamic = "force-dynamic";

async function getColumns(client: any, table: string): Promise<Set<string>> {
  const rs = await client.query(
    `SELECT lower(column_name) AS col
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set<string>((rs.rows || []).map((r: any) => String(r.col)));
}

export async function GET(req: Request) {
  await guardApiActivated(true);
  const access = await requireAnyPermission(
    req,
    ["perm.products.manage", "perm.inventory.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  try {
    let items: { id?: number; name: string }[] = [];

    let categoryCols = new Set<string>();
    try {
      categoryCols = await getColumns(pool, "categories");
      const hasCategoryBusiness = categoryCols.has("business_id");
      const { rows } = await pool.query(
        `SELECT id, name
           FROM categories
          ${hasCategoryBusiness ? "WHERE business_id = $1" : ""}
          ORDER BY name`,
        hasCategoryBusiness ? [businessId] : []
      );
      items = rows;
    } catch {
      // categories table may not exist; fallback below
    }

    try {
      const productCols = await getColumns(pool, "products").catch(() => new Set<string>());
      const hasProductBusiness = productCols.has("business_id");
      const { rows } = await pool.query(
        `
        SELECT DISTINCT
          COALESCE(NULLIF(p.meta->>'category',''), NULLIF(p.category,'')) AS name
        FROM products p
        WHERE COALESCE(NULLIF(p.meta->>'category',''), NULLIF(p.category,'')) IS NOT NULL
          ${hasProductBusiness ? "AND p.business_id = $1" : ""}
        ORDER BY 1
        `,
        hasProductBusiness ? [businessId] : []
      );
      const fromProducts = rows.map((r: any) => ({ name: String(r.name) }));
      const seen = new Set(items.map((i) => i.name.toLowerCase()));
      for (const it of fromProducts) {
        const key = it.name.toLowerCase();
        if (!seen.has(key)) {
          items.push(it);
          seen.add(key);
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("GET /api/categories failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  await guardApiActivated(true);
  const access = await requireAnyPermission(
    req,
    ["perm.products.manage", "perm.inventory.manage", "perm.sales.manage"],
    "Forbidden"
  );
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  try {
    const { name } = await req.json();
    const n = String(name || "").trim();
    if (!n) return NextResponse.json({ error: "Name required" }, { status: 400 });

    try {
      const categoryCols = await getColumns(pool, "categories").catch(() => new Set<string>());
      const hasCategoryBusiness = categoryCols.has("business_id");
      const { rows } = await pool.query(
        hasCategoryBusiness
          ? "INSERT INTO categories(name, business_id) VALUES($1, $2) ON CONFLICT DO NOTHING RETURNING id"
          : "INSERT INTO categories(name) VALUES($1) ON CONFLICT (name) DO NOTHING RETURNING id",
        hasCategoryBusiness ? [n, businessId] : [n]
      );
      return NextResponse.json({ id: rows?.[0]?.id ?? null, ok: true }, { status: 201 });
    } catch {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
  } catch (err) {
    console.error("POST /api/categories failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
