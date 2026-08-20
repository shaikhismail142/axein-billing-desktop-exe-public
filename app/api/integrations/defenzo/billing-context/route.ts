export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAnyPermission } from "@/app/lib/request-access";

type ServicePayload = {
  external_id?: unknown;
  service_id?: unknown;
  name?: unknown;
  category?: unknown;
  price?: unknown;
  base_price?: unknown;
};

export async function GET(req: Request) {
  const access = await requireAnyPermission(req, ["perm.sales.manage", "perm.quotations.manage"], "Forbidden");
  if ("response" in access) return access.response;

  const customerId = Number(new URL(req.url).searchParams.get("customer_id") || 0);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }

  const customer = await pool.query(
    `SELECT c.id,
            EXISTS(SELECT 1 FROM integration_record_links l
                    WHERE l.business_id=$2 AND l.provider='defenzo' AND l.entity_type='customer'
                      AND l.internal_id=c.id::text) AS crm_linked
       FROM customers c WHERE c.id=$1 AND c.business_id=$2 LIMIT 1`,
    [customerId, access.ctx.businessId]
  );
  if (!customer.rowCount) return NextResponse.json({ error: "customer_not_found" }, { status: 404 });

  const jobsRs = await pool.query(
    `SELECT j.id, j.job_number, j.status, j.details_json, j.updated_at,
            v.registration_number, v.make, v.model, v.variant
       FROM automotive_jobs j
       LEFT JOIN automotive_vehicles v ON v.id=j.vehicle_id AND v.business_id=j.business_id
      WHERE j.business_id=$1 AND j.customer_id=$2 AND j.source_system='defenzo'
      ORDER BY j.updated_at DESC, j.id DESC LIMIT 12`,
    [access.ctx.businessId, customerId]
  );

  const externalServiceIds = new Set<string>();
  for (const job of jobsRs.rows) {
    const services = Array.isArray(job.details_json?.services) ? job.details_json.services : [];
    for (const service of services as ServicePayload[]) {
      const id = String(service.external_id ?? service.service_id ?? "").trim();
      if (id) externalServiceIds.add(id);
    }
  }
  const links = externalServiceIds.size
    ? await pool.query(
        `SELECT l.external_id, p.id AS product_id, p.name, p.category, p.gst_slab,
                COALESCE(p.selling_price,p.price,0)::numeric AS selling_price
           FROM integration_record_links l
           JOIN products p ON p.id::text=l.internal_id AND p.business_id=l.business_id
          WHERE l.business_id=$1 AND l.provider='defenzo' AND l.entity_type='service'
            AND l.external_id=ANY($2::text[])`,
        [access.ctx.businessId, [...externalServiceIds]]
      )
    : { rows: [] as any[] };
  const byExternalId = new Map(links.rows.map((row: any) => [String(row.external_id), row]));

  const jobs = jobsRs.rows.map((job: any) => ({
    id: Number(job.id),
    job_number: String(job.job_number || ""),
    status: String(job.status || ""),
    updated_at: job.updated_at,
    vehicle: [job.registration_number, [job.make, job.model, job.variant].filter(Boolean).join(" ")].filter(Boolean).join(" - "),
    services: (Array.isArray(job.details_json?.services) ? job.details_json.services : []).map((service: ServicePayload) => {
      const externalId = String(service.external_id ?? service.service_id ?? "").trim();
      const product = byExternalId.get(externalId) as any;
      return {
        external_id: externalId,
        product_id: Number(product?.product_id || 0) || null,
        name: String(service.name || product?.name || "CRM service"),
        category: String(service.category || product?.category || "Service"),
        unit_price: Math.max(0, Number(service.price ?? service.base_price ?? product?.selling_price ?? 0) || 0),
        gst_slab: Number(product?.gst_slab ?? 18),
      };
    }),
  }));

  return NextResponse.json({ crm_linked: Boolean(customer.rows[0].crm_linked), jobs });
}
