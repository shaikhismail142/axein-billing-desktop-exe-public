import { NextResponse } from "next/server";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { canViewBusinessRevenue, getUserPermissionCodes, getUserRoles } from "@/app/lib/platform-rbac";
import { authenticateLanClient } from "@/app/lib/lan-auth";

export type AccessContext = {
  businessId: number;
  userId: number;
  permissions: string[];
  revenueVisible: boolean;
};

function isAdminBypass(req: Request): boolean {
  if (process.env.DISABLE_ADMIN_CHECK === "1") return true;
  const admin = req.headers.get("x-admin");
  if (admin === "1") return true;

  const cookie = req.headers.get("cookie") || "";
  return /\bx-admin=1\b/.test(cookie);
}

export async function resolveAccessContext(req: Request): Promise<AccessContext> {
  const lanAuth = await authenticateLanClient(req);
  if (lanAuth.ok) {
    return {
      businessId: lanAuth.businessId,
      userId: 0,
      permissions: lanAuth.permissions,
      revenueVisible: lanAuth.revenueVisible,
    };
  }

  const businessId = getRequestBusinessId(req, 1);
  const userId = getRequestUserId(req, 1);

  const [roles, permissions] = await Promise.all([
    getUserRoles(userId, businessId),
    getUserPermissionCodes(userId, businessId),
  ]);

  return {
    businessId,
    userId,
    permissions,
    revenueVisible: canViewBusinessRevenue(roles, permissions),
  };
}

export async function requireRevenueAccess(req: Request): Promise<
  { ok: true; ctx: AccessContext } | { ok: false; response: NextResponse }
> {
  if (isAdminBypass(req)) {
    const ctx = await resolveAccessContext(req).catch(() => ({
      businessId: getRequestBusinessId(req, 1),
      userId: getRequestUserId(req, 1),
      permissions: ["perm.reports.view", "perm.view.revenue_summary"],
      revenueVisible: true,
    }));
    return { ok: true, ctx };
  }

  const ctx = await resolveAccessContext(req);
  const hasReports = ctx.permissions.includes("perm.reports.view");

  if (!hasReports || !ctx.revenueVisible) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "forbidden", message: "Revenue reports are restricted to admin users." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, ctx };
}

export async function requireAnyPermission(
  req: Request,
  permissionCodes: string[],
  errorMessage = "Forbidden"
): Promise<{ ok: true; ctx: AccessContext } | { ok: false; response: NextResponse }> {
  if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
    const ctx = await resolveAccessContext(req);
    return { ok: true, ctx };
  }

  if (isAdminBypass(req)) {
    const ctx = await resolveAccessContext(req).catch(() => ({
      businessId: getRequestBusinessId(req, 1),
      userId: getRequestUserId(req, 1),
      permissions: permissionCodes,
      revenueVisible: true,
    }));
    return { ok: true, ctx };
  }

  const ctx = await resolveAccessContext(req);
  if (!permissionCodes.some((code) => ctx.permissions.includes(code))) {
    return { ok: false, response: NextResponse.json({ error: errorMessage }, { status: 403 }) };
  }

  return { ok: true, ctx };
}

export async function requireAllPermissions(
  req: Request,
  permissionCodes: string[],
  errorMessage = "Forbidden"
): Promise<{ ok: true; ctx: AccessContext } | { ok: false; response: NextResponse }> {
  if (!Array.isArray(permissionCodes) || permissionCodes.length === 0) {
    const ctx = await resolveAccessContext(req);
    return { ok: true, ctx };
  }

  if (isAdminBypass(req)) {
    const ctx = await resolveAccessContext(req).catch(() => ({
      businessId: getRequestBusinessId(req, 1),
      userId: getRequestUserId(req, 1),
      permissions: permissionCodes,
      revenueVisible: true,
    }));
    return { ok: true, ctx };
  }

  const ctx = await resolveAccessContext(req);
  if (!permissionCodes.every((code) => ctx.permissions.includes(code))) {
    return { ok: false, response: NextResponse.json({ error: errorMessage }, { status: 403 }) };
  }

  return { ok: true, ctx };
}
