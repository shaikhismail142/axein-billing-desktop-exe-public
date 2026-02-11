import { NextResponse } from "next/server";
import { saveActivationRecord } from "@/app/lib/license-activation";
import { requireAnyPermission } from "@/app/lib/request-access";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  const access = await requireAnyPermission(req, ["perm.license.manage", "perm.settings.manage"], "Forbidden");
  if ("response" in access) return access.response;
  const businessId = access.ctx.businessId;

  await saveActivationRecord({
    mode: "inactive",
    ok: false,
    reason: "Manually deactivated for QA",
    license: null,
    // keep trial_allowed as-is; just clear any running trial
    trial_started_at: null,
    trial_expires_at: null,
  });

  // Best-effort normalized-license mirror update when schema is available.
  try {
    await pool.query(
      `UPDATE licenses
          SET status = 'inactive',
              updated_at = NOW()
        WHERE business_id = $1
          AND lower(status) = 'active'`,
      [businessId]
    );
  } catch {}

  return NextResponse.json({ ok: true });
}
