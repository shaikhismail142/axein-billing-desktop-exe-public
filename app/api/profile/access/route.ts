export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import {
  canViewBusinessRevenue,
  getUserPermissionCodes,
  getUserRoles,
} from "@/app/lib/platform-rbac";

export async function GET(req: Request) {
  try {
    const businessId = getRequestBusinessId(req, 1);
    const userId = getRequestUserId(req, 1);

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
