export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { authenticateIntegrationRequest } from "@/app/lib/integration-auth";

type EventBody = {
  event_id?: string;
  event_type?: string;
  entity_type?: "customer" | "vehicle" | "job";
  external_id?: string;
  version?: number;
  data?: Record<string, unknown>;
};

function text(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

async function linkedId(db: any, businessId: number, type: string, externalId: string): Promise<number | null> {
  const rs = await db.query(
    `SELECT internal_id FROM integration_record_links
      WHERE business_id = $1 AND provider = 'defenzo' AND entity_type = $2 AND external_id = $3`,
    [businessId, type, externalId]
  );
  const id = Number(rs.rows?.[0]?.internal_id || 0);
  return id > 0 ? id : null;
}

async function link(db: any, businessId: number, type: string, externalId: string, internalId: number, version: number) {
  await db.query(
    `INSERT INTO integration_record_links
      (business_id, provider, entity_type, external_id, internal_id, external_version)
     VALUES ($1, 'defenzo', $2, $3, $4, $5)
     ON CONFLICT (business_id, provider, entity_type, external_id)
     DO UPDATE SET internal_id = EXCLUDED.internal_id, external_version = EXCLUDED.external_version,
                   sync_status = 'synced', last_synced_at = NOW()`,
    [businessId, type, externalId, String(internalId), version]
  );
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const client = await authenticateIntegrationRequest(req, rawBody);
  if (!client || client.provider !== "defenzo") {
    return NextResponse.json({ error: "invalid_integration_signature" }, { status: 401 });
  }
  const body = JSON.parse(rawBody || "{}") as EventBody;
  const eventId = text(body.event_id, 160);
  const eventType = text(body.event_type, 100);
  const entityType = text(body.entity_type, 40);
  const externalId = text(body.external_id, 160);
  const version = Math.max(1, Number(body.version || 1));
  const data = body.data && typeof body.data === "object" ? body.data : {};
  if (!eventId || !eventType || !externalId || !["customer", "vehicle", "job"].includes(entityType)) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const eventRs = await db.query(
      `INSERT INTO integration_events
        (business_id, client_id, event_id, event_type, entity_type, external_id, version, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (client_id, event_id) DO NOTHING RETURNING id`,
      [client.businessId, client.id, eventId, eventType, entityType, externalId, version, JSON.stringify(data)]
    );
    if (!eventRs.rowCount) {
      await db.query("ROLLBACK");
      return NextResponse.json({ ok: true, duplicate: true });
    }
    const currentLink = await db.query(
      `SELECT external_version FROM integration_record_links
        WHERE business_id=$1 AND provider='defenzo' AND entity_type=$2 AND external_id=$3`,
      [client.businessId, entityType, externalId]
    );
    if (Number(currentLink.rows?.[0]?.external_version || 0) >= version) {
      await db.query(`UPDATE integration_events SET status='ignored', processed_at=NOW() WHERE id=$1`, [eventRs.rows[0].id]);
      await db.query("COMMIT");
      return NextResponse.json({ ok: true, ignored: true });
    }

    let internalId = await linkedId(db, client.businessId, entityType, externalId);
    if (entityType === "customer") {
      if (internalId) {
        await db.query(
          `UPDATE customers SET name=$3, phone=$4, email=$5, gstin=$6, address=$7
            WHERE id=$1 AND business_id=$2`,
          [internalId, client.businessId, text(data.name, 220), text(data.phone, 50) || null,
           text(data.email, 255) || null, text(data.gstin, 30) || null, text(data.address, 1000) || null]
        );
      } else {
        const rs = await db.query(
          `INSERT INTO customers (business_id, name, phone, email, gstin, address)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [client.businessId, text(data.name, 220) || "Unnamed customer", text(data.phone, 50) || null,
           text(data.email, 255) || null, text(data.gstin, 30) || null, text(data.address, 1000) || null]
        );
        internalId = Number(rs.rows[0].id);
      }
    } else if (entityType === "vehicle") {
      const customerId = data.customer_external_id
        ? await linkedId(db, client.businessId, "customer", text(data.customer_external_id, 160)) : null;
      const values = [customerId, text(data.registration_number, 50), text(data.vin, 100) || null,
        text(data.engine_number, 100) || null, text(data.make, 100) || null, text(data.model, 100) || null,
        text(data.variant, 100) || null, Number(data.model_year || 0) || null, text(data.colour, 60) || null,
        Number(data.odometer || 0) || null, JSON.stringify(data)];
      if (internalId) {
        await db.query(
          `UPDATE automotive_vehicles SET customer_id=$3, registration_number=$4, vin=$5, engine_number=$6,
             make=$7, model=$8, variant=$9, model_year=$10, colour=$11, odometer=$12, meta_json=$13::jsonb, updated_at=NOW()
           WHERE id=$1 AND business_id=$2`, [internalId, client.businessId, ...values]
        );
      } else {
        const rs = await db.query(
          `INSERT INTO automotive_vehicles
            (business_id,customer_id,registration_number,vin,engine_number,make,model,variant,model_year,colour,odometer,meta_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id`,
          [client.businessId, ...values]
        );
        internalId = Number(rs.rows[0].id);
      }
    } else {
      const vehicleId = data.vehicle_external_id
        ? await linkedId(db, client.businessId, "vehicle", text(data.vehicle_external_id, 160)) : null;
      const customerId = data.customer_external_id
        ? await linkedId(db, client.businessId, "customer", text(data.customer_external_id, 160)) : null;
      const jobNumber = text(data.job_number, 100) || `DEF-${externalId}`;
      if (internalId) {
        await db.query(
          `UPDATE automotive_jobs SET vehicle_id=$3, customer_id=$4, job_number=$5, status=$6,
             service_advisor=$7, assigned_technician=$8, details_json=$9::jsonb, updated_at=NOW()
           WHERE id=$1 AND business_id=$2`,
          [internalId, client.businessId, vehicleId, customerId, jobNumber, text(data.status, 40) || "open",
           text(data.service_advisor, 160) || null, text(data.assigned_technician, 160) || null, JSON.stringify(data)]
        );
      } else {
        const rs = await db.query(
          `INSERT INTO automotive_jobs
            (business_id,vehicle_id,customer_id,job_number,status,service_advisor,assigned_technician,source_system,source_external_id,details_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'defenzo',$8,$9::jsonb) RETURNING id`,
          [client.businessId, vehicleId, customerId, jobNumber, text(data.status, 40) || "open",
           text(data.service_advisor, 160) || null, text(data.assigned_technician, 160) || null, externalId, JSON.stringify(data)]
        );
        internalId = Number(rs.rows[0].id);
      }
    }
    await link(db, client.businessId, entityType, externalId, internalId!, version);
    await db.query(`UPDATE integration_events SET status='processed', processed_at=NOW() WHERE id=$1`, [eventRs.rows[0].id]);
    await db.query(
      `INSERT INTO audit_logs (business_id, action, entity_type, entity_id, meta_json)
       VALUES ($1, 'integration.sync', $2, $3, $4::jsonb)`,
      [client.businessId, entityType, String(internalId), JSON.stringify({ provider: "defenzo", event_id: eventId, external_id: externalId, version })]
    );
    await db.query("COMMIT");
    return NextResponse.json({ ok: true, entity_type: entityType, id: internalId });
  } catch (error: any) {
    await db.query("ROLLBACK");
    console.error("Defenzo event sync failed", error);
    return NextResponse.json({ error: "event_processing_failed" }, { status: 500 });
  } finally {
    db.release();
  }
}
