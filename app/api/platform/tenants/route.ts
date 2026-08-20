export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requirePlatformAdmin } from "@/app/lib/platform-admin";
import { resolveBusinessTemplate, resolveTemplateNavigationItems } from "@/app/lib/business-templates";

const ALL_MODULES = ["dashboard", "billing", "invoices", "quotations", "products", "inventory", "purchases", "accounting", "reports", "audit"];

export async function GET(req: Request) {
  const admin = await requirePlatformAdmin(req);
  if (!admin.ok) return admin.response;
  const rs = await pool.query(
    `SELECT b.id,b.code,b.name,b.legal_name,b.business_type,b.tenant_status,b.branding_json,
            e.plan_code,e.status AS plan_status,e.starts_at,e.ends_at,e.user_limit,e.modules,
            COUNT(u.id) FILTER (WHERE u.status='active')::int AS active_users
       FROM businesses b LEFT JOIN tenant_entitlements e ON e.business_id=b.id
       LEFT JOIN users u ON u.business_id=b.id GROUP BY b.id,e.business_id
       ORDER BY b.updated_at DESC,b.id DESC`
  );
  return NextResponse.json({ items: rs.rows });
}

export async function POST(req: Request) {
  const admin = await requirePlatformAdmin(req);
  if (!admin.ok) return admin.response;
  const body = await req.json().catch(() => ({} as any));
  const code = String(body.code || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const name = String(body.name || "").trim();
  if (!code || !name) return NextResponse.json({ error: "code_and_name_required" }, { status: 400 });
  const limit = Math.max(1, Number(body.user_limit || 10));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const businessRs = await db.query(
      `INSERT INTO businesses (code,name,legal_name,business_type,user_limit,usage_mode,tenant_status,branding_json,config_json)
       VALUES ($1,$2,$3,$4,$5,'saas','active',$6::jsonb,$7::jsonb) RETURNING id`,
      [code,name,String(body.legal_name || name),String(body.business_type || "automotive_detailing"),limit,
       JSON.stringify(body.branding || {}),JSON.stringify({ template: body.business_type || "automotive_detailing" })]
    );
    const businessId = Number(businessRs.rows[0].id);
    await db.query(
      `INSERT INTO tenant_entitlements (business_id,plan_code,status,starts_at,ends_at,user_limit,modules,read_only_after_expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE)`,
      [businessId,String(body.plan_code || "defenzo-free-year"),String(body.plan_status || "draft"),body.starts_at || null,
       body.ends_at || null,limit,JSON.stringify(body.modules || ALL_MODULES)]
    );
    const template = resolveBusinessTemplate(String(body.business_type || "automotive_detailing") as any);
    await db.query(
      `INSERT INTO module_policies (business_id,module_key,policy_json)
       VALUES ($1,'navigation',$2::jsonb)`,
      [businessId, JSON.stringify({
        template: template.key,
        navigation: template.navigation,
        navigation_items: resolveTemplateNavigationItems(template.key),
        invoice_layout: template.invoiceLayout,
        workflow_hints: template.workflowHints,
      })]
    );
    for (const [position, field] of template.defaultInvoiceFields.entries()) {
      await db.query(
        `INSERT INTO invoice_custom_fields
          (business_id,field_key,label,data_type,required,visible,position,applies_to,preset_scope,config_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [businessId,field.key,field.label,field.data_type || "text",field.required,field.visible,position + 1,
         field.applies_to || "invoice",template.key,JSON.stringify({
           source: "tenant_provision",
           ...(field.options ? { options: field.options.map((value) => ({ label:value,value })) } : {}),
         })]
      );
    }
    await db.query(
      `INSERT INTO audit_logs (business_id,actor_user_id,action,entity_type,entity_id,meta_json)
       VALUES ($1,$2,'platform.tenant.create','business',$3,$4::jsonb)`,
      [businessId,admin.session.user_id,String(businessId),JSON.stringify({ code,plan_code:body.plan_code || "defenzo-free-year" })]
    );
    await db.query("COMMIT");
    return NextResponse.json({ ok:true,business_id:businessId }, { status:201 });
  } catch (error:any) {
    await db.query("ROLLBACK");
    return NextResponse.json({ error:error?.code === "23505" ? "tenant_code_exists" : "tenant_create_failed" }, { status:error?.code === "23505" ? 409 : 500 });
  } finally { db.release(); }
}

export async function PATCH(req: Request) {
  const admin = await requirePlatformAdmin(req);
  if (!admin.ok) return admin.response;
  const body = await req.json().catch(() => ({} as any));
  const businessId = Number(body.business_id || 0);
  if (businessId <= 0) return NextResponse.json({ error:"business_id_required" }, { status:400 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const before = await db.query(
      `SELECT b.name,b.legal_name,b.business_type,b.tenant_status,b.branding_json,e.*
       FROM businesses b LEFT JOIN tenant_entitlements e ON e.business_id=b.id WHERE b.id=$1 FOR UPDATE OF b`, [businessId]
    );
    if (!before.rowCount) { await db.query("ROLLBACK"); return NextResponse.json({ error:"tenant_not_found" }, { status:404 }); }
    const old = before.rows[0] as any;
    await db.query(
      `UPDATE businesses SET name=COALESCE($2,name),legal_name=COALESCE($3,legal_name),business_type=COALESCE($4,business_type),
       tenant_status=COALESCE($5,tenant_status),branding_json=COALESCE($6::jsonb,branding_json),updated_at=NOW() WHERE id=$1`,
      [businessId,body.name || null,body.legal_name || null,body.business_type || null,body.tenant_status || null,
       body.branding ? JSON.stringify(body.branding) : null]
    );
    await db.query(
      `INSERT INTO tenant_entitlements (business_id,plan_code,status,starts_at,ends_at,user_limit,modules,read_only_after_expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE)
       ON CONFLICT (business_id) DO UPDATE SET plan_code=EXCLUDED.plan_code,status=EXCLUDED.status,starts_at=EXCLUDED.starts_at,
       ends_at=EXCLUDED.ends_at,user_limit=EXCLUDED.user_limit,modules=EXCLUDED.modules,updated_at=NOW()`,
      [businessId,String(body.plan_code || old.plan_code || "standard"),String(body.plan_status || old.status || "draft"),
       body.starts_at ?? old.starts_at,body.ends_at ?? old.ends_at,Math.max(1,Number(body.user_limit || old.user_limit || 10)),
       JSON.stringify(body.modules || old.modules || ALL_MODULES)]
    );
    await db.query(
      `INSERT INTO audit_logs (business_id,actor_user_id,action,entity_type,entity_id,meta_json)
       VALUES ($1,$2,'platform.tenant.update','business',$3,$4::jsonb)`,
      [businessId,admin.session.user_id,String(businessId),JSON.stringify({ before:old,after:body })]
    );
    await db.query("COMMIT");
    return NextResponse.json({ ok:true });
  } catch (error) {
    await db.query("ROLLBACK"); console.error("Tenant update failed",error);
    return NextResponse.json({ error:"tenant_update_failed" }, { status:500 });
  } finally { db.release(); }
}
