export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const started = Date.now();
  let database = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    database = "unavailable";
  }
  return NextResponse.json({
    ok: database === "ok",
    mode: process.env.AXEIN_DEPLOYMENT_MODE === "saas" ? "saas" : process.env.AXEIN_DESKTOP === "1" ? "desktop" : "web",
    database,
    latencyMs: Date.now() - started,
    appMode: process.env.AXEIN_APP_MODE || null,
    port: process.env.PORT ? Number(process.env.PORT) : null,
    appVersion: process.env.AXEIN_APP_VERSION || null,
  }, { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
