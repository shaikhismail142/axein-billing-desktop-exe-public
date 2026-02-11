import { NextResponse } from "next/server";
import { listBusinessTemplates, resolveTemplateNavigationItems } from "@/app/lib/business-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const items = listBusinessTemplates().map((template) => ({
    ...template,
    navigation_items: resolveTemplateNavigationItems(template.key),
  }));
  return NextResponse.json({ items });
}
