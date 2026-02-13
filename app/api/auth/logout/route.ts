export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { makeClearedSessionCookie } from "@/app/lib/session";

export async function POST() {
  return NextResponse.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": makeClearedSessionCookie(),
        "Cache-Control": "no-store",
      },
    }
  );
}

