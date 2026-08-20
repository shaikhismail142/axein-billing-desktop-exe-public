export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/app/lib/request-access";
import {
  canViewBusinessRevenue,
  getUserPermissionCodes,
  getUserRoles,
} from "@/app/lib/platform-rbac";

export async function GET(req: Request) {
  try {
    const access = await requireAuthenticated(req);
    if ("response" in access) return access.response;
    const businessId = access.ctx.businessId;
    const userId = access.ctx.userId;

    const [roles, permissions] = await Promise.all([
      getUserRoles(userId, businessId),
      getUserPermissionCodes(userId, businessId),
    ]);

    const revenueVisible = canViewBusinessRevenue(roles, permissions);

    return NextResponse.json({
      user_id: userId,
      business_id: businessId,
      roles,
      permissions,
      access: {
        revenue_visible: revenueVisible,
      },
    });
  } catch (err) {
    console.error("GET /api/profile/access failed:", err);
    return NextResponse.json({ error: "Failed to resolve access" }, { status: 500 });
  }
}
