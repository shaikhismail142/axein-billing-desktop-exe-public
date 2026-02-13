// app/api/license/start-trial/route.ts
import { NextResponse } from "next/server";
import { startTrial, getActivationStatus } from "@/app/lib/license-activation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(_req: Request) {
  try {
    const current = await getActivationStatus();
    if (!current.canStartTrial) {
      return json(
        {
          ok: false,
          error: current.trialActive
            ? "Trial is already active"
            : current.isLicensed
            ? "License is already active"
            : "Trial is not available",
        },
        409
      );
    }

    const record = await startTrial(7);
    const status = await getActivationStatus();

    const trialActive = status.mode === "trial";
    const trialExpiresAt = (record as any)?.trial_expires_at ?? null;

    return json({
      ok: true,
      trialActive,
      trialExpiresAt,
      status,
    });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Failed to start trial" }, 400);
  }
}
