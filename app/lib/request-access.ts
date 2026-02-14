import { NextResponse } from "next/server";
import { getRequestBusinessId, getRequestUserId } from "@/app/lib/platform-context";
import { canViewBusinessRevenue, getUserPermissionCodes, getUserRoles } from "@/app/lib/platform-rbac";
import { authenticateLanClient } from "@/app/lib/lan-auth";
import { readSessionFromRequest } from "@/app/lib/session";
import { pool } from "@/lib/db";

export type AccessContext = {
  businessId: number;
  userId: number;
  permissions: string[];
  revenueVisible: boolean;
};

function isAdminBypass(req: Request): boolean {
  if (process.env.DISABLE_ADMIN_CHECK === "1") return true;
  if (process.env.AXEIN_ALLOW_ADMIN_HEADER !== "1") return false;

  const admin = req.headers.get("x-admin");
  if (admin === "1") return true;
  const cookie = req.headers.get("cookie") || "";
  return /\bx-admin=1\b/.test(cookie);
}

async function resolveImplicitBusinessId(fallback = 1): Promise<number> {
  try {
    const rs = await pool.query(
      `SELECT id
         FROM businesses
        WHERE is_active = TRUE
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`
    );
    const id = Number(rs.rows?.[0]?.id || fallback);
    return Number.isFinite(id) && id > 0 ? id : fallback;
  } catch {
    return fallback;
  }
}

async function resolveImplicitUserId(businessId: number, fallback = 1): Promise<number> {
  try {
    const rs = await pool.query(
      `SELECT u.id,
              MIN(
                CASE
                  WHEN lower(r.code) = 'admin' THEN 0
                  WHEN lower(r.code) = 'owner' THEN 1
                  ELSE 2
                END
              ) AS role_rank
         FROM users u
         LEFT JOIN user_role_map m ON m.user_id = u.id
         LEFT JOIN roles r ON r.id = m.role_id
        WHERE u.business_id = $1
          AND u.status = 'active'
        GROUP BY u.id
        ORDER BY role_rank ASC, u.id ASC
        LIMIT 1`,
      [businessId]
    );
    const id = Number(rs.rows?.[0]?.id || fallback);
    return Number.isFinite(id) && id > 0 ? id : fallback;
  } catch {
    return fallback;
  }
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

  const session = readSessionFromRequest(req);
  if (session) {
    // Enforce user status on every request (prevents stale cookies after disable/reject).
    const statusRs = await pool
      .query(
        `SELECT lower(status) AS status
           FROM users
          WHERE id = $1
            AND business_id = $2
          LIMIT 1`,
        [session.user_id, session.business_id]
      )
      .catch(() => null);
    const status = String(statusRs?.rows?.[0]?.status || "").toLowerCase();
    if (status !== "active") {
      return {
        businessId: session.business_id,
        userId: 0,
        permissions: [],
        revenueVisible: false,
      };
    }

    const [roles, permissions] = await Promise.all([
      getUserRoles(session.user_id, session.business_id),
      getUserPermissionCodes(session.user_id, session.business_id),
    ]);
    return {
      businessId: session.business_id,
      userId: session.user_id,
      permissions,
      revenueVisible: canViewBusinessRevenue(roles, permissions),
    };
  }

  const requestedBusinessId = getRequestBusinessId(req, 0);
  const businessId = requestedBusinessId > 0 ? requestedBusinessId : await resolveImplicitBusinessId(1);

  const requestedUserId = getRequestUserId(req, 0);
  const shouldResolveImplicitUser = isAdminBypass(req);
  const userId = requestedUserId > 0
    ? requestedUserId
    : shouldResolveImplicitUser
    ? await resolveImplicitUserId(businessId, 1)
    : 0;

  if (userId <= 0) {
    return {
      businessId,
      userId: 0,
      permissions: [],
      revenueVisible: false,
    };
  }

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
