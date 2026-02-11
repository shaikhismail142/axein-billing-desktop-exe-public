import { NextResponse } from "next/server";
import { listBusinessTemplates } from "@/app/lib/business-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: listBusinessTemplates() });
}
