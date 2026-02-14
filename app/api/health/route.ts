export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: process.env.AXEIN_DESKTOP === "1" ? "desktop" : "web",
    appMode: process.env.AXEIN_APP_MODE || null,
    port: process.env.PORT ? Number(process.env.PORT) : null,
    appVersion: process.env.AXEIN_APP_VERSION || null,
  });
}
