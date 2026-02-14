"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PendingUser = {
  id: number;
  full_name: string;
  email: string;
  phone?: string | null;
  created_at: string;
  meta?: { requested_role?: string };
};

type BusinessUser = {
  id: number;
  full_name: string;
  email: string;
  phone?: string | null;
  status: string;
  created_at: string;
  roles: Array<{ code: string; name: string }>;
};

type SeatUsage = {
  seat_limit: number;
  computer_limit: number;
  active_users: number;
  active_clients: number;
  used_seats: number;
  remaining_seats: number;
  active_computers: number;
  remaining_computers: number;
};

type PermissionCatalogRow = {
  id: number;
  code: string;
  label: string;
  description?: string | null;
};

type RoleRow = {
  id: number;
  code: string;
  name: string;
  is_system: boolean;
  revenue_visible: boolean;
  permissions: Array<{ code: string; label: string }>;
};

const ROLE_OPTIONS = ["owner", "admin", "manager", "accountant", "billing_staff", "viewer"];

function permissionEntity(code: string) {
  const parts = String(code || "").split(".");
  if (parts.length >= 2 && parts[0] === "perm" && parts[1]) return parts[1];
  return "other";
}

export default function ProfileUsersPage() {
  const [pendingItems, setPendingItems] = useState<PendingUser[]>([]);
  const [users, setUsers] = useState<BusinessUser[]>([]);
  const [seatUsage, setSeatUsage] = useState<SeatUsage | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<PermissionCatalogRow[]>([]);

  const [roleByPendingUser, setRoleByPendingUser] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [createUserForm, setCreateUserForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    status: "active",
    role_code: "billing_staff",
  });

  const [selectedRoleId, setSelectedRoleId] = useState<number>(0);
  const [selectedRolePermCodes, setSelectedRolePermCodes] = useState<string[]>([]);

  const [roleCreate, setRoleCreate] = useState({
    name: "",
    code: "",
    revenue_visible: false,
  });

  const [permEntityFilter, setPermEntityFilter] = useState<string>("");
  const [permSearch, setPermSearch] = useState<string>("");

  const loadPendingUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users/pending", {
      cache: "no-store",
      headers: { "x-admin": "1" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to load pending users");
    const list = Array.isArray(data?.items) ? data.items : [];
    setPendingItems(list);
    const defaults: Record<number, string> = {};
    for (const item of list) {
      const fromMeta = String((item as any)?.meta?.requested_role || "").trim().toLowerCase();
      defaults[item.id] = ROLE_OPTIONS.includes(fromMeta) ? fromMeta : "billing_staff";
    }
    setRoleByPendingUser(defaults);
  }, []);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users", {
      cache: "no-store",
      headers: { "x-admin": "1" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to load users");
    setUsers(Array.isArray(data?.items) ? data.items : []);
    setSeatUsage(data?.seat_usage || null);
  }, []);

  const loadRolesAndPermissions = useCallback(async () => {
    const res = await fetch("/api/admin/rbac/roles", {
      cache: "no-store",
      headers: { "x-admin": "1" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to load role permissions");

    const roleList = Array.isArray(data?.roles) ? data.roles : [];
    const permissionList = Array.isArray(data?.permission_catalog) ? data.permission_catalog : [];

    setRoles(roleList);
    setPermissionCatalog(permissionList);

    if (roleList.length === 0) return;
    setSelectedRoleId((prev) => {
      const nextRoleId =
        roleList.some((r: RoleRow) => Number(r.id) === Number(prev)) ? Number(prev) : Number(roleList[0].id || 0);
      const role = roleList.find((r: RoleRow) => Number(r.id) === Number(nextRoleId));
      const perms = Array.isArray(role?.permissions)
        ? role.permissions.map((p: any) => String(p?.code || "")).filter(Boolean)
        : [];
      setSelectedRolePermCodes(Array.from(new Set(perms)));
      return nextRoleId;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await Promise.all([loadPendingUsers(), loadUsers(), loadRolesAndPermissions()]);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load user access data"));
    } finally {
      setBusy(false);
    }
  }, [loadPendingUsers, loadRolesAndPermissions, loadUsers]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const selectedRole = useMemo(
    () => roles.find((r) => Number(r.id) === Number(selectedRoleId)) || null,
    [roles, selectedRoleId]
  );
  const seatsFull = (seatUsage?.remaining_seats ?? 1) <= 0;

  const roleCodeOptions = useMemo(() => {
    const fromApi = roles
      .map((r) => String(r?.code || "").trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set([...ROLE_OPTIONS, ...fromApi])).sort();
  }, [roles]);

  const permissionEntities = useMemo(() => {
    const set = new Set<string>();
    for (const p of permissionCatalog) set.add(permissionEntity(p.code));
    return Array.from(set).sort();
  }, [permissionCatalog]);

  const filteredPermissionCatalog = useMemo(() => {
    const entity = permEntityFilter.trim().toLowerCase();
    const search = permSearch.trim().toLowerCase();
    return permissionCatalog.filter((p) => {
      if (entity && permissionEntity(p.code) !== entity) return false;
      if (!search) return true;
      const hay = `${p.code} ${p.label} ${p.description || ""}`.toLowerCase();
      return hay.includes(search);
    });
  }, [permissionCatalog, permEntityFilter, permSearch]);

  async function approvePendingUser(userId: number) {
    const roleCode = roleByPendingUser[userId] || "billing_staff";
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({ role_codes: [roleCode] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Approval failed");
      setOk(`User approved as ${roleCode}`);
      await refreshAll();
    } catch (e: any) {
      setError(String(e?.message || "Approval failed"));
    } finally {
      setSaving(false);
    }
  }

  async function rejectPendingUser(userId: number) {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reject`, {
        method: "POST",
        headers: { "x-admin": "1" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Rejection failed");
      setOk("User request rejected");
      await refreshAll();
    } catch (e: any) {
      setError(String(e?.message || "Rejection failed"));
    } finally {
      setSaving(false);
    }
  }

  async function createUserByAdmin() {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({
          ...createUserForm,
          role_codes: [createUserForm.role_code],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create user");
      setOk(`User created: ${data?.user?.email || createUserForm.email}`);
      setCreateUserForm({
        full_name: "",
        email: "",
        phone: "",
        password: "",
        status: "active",
        role_code: "billing_staff",
      });
      await refreshAll();
    } catch (e: any) {
      setError(String(e?.message || "Failed to create user"));
    } finally {
      setSaving(false);
    }
  }

  function togglePermissionCode(code: string, checked: boolean) {
    setSelectedRolePermCodes((prev) => {
      const set = new Set(prev);
      if (checked) set.add(code);
      else set.delete(code);
      return Array.from(set).sort();
    });
  }

  async function saveRolePermissions() {
    if (!selectedRoleId) return;

    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/admin/rbac/roles/${selectedRoleId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({ permission_codes: selectedRolePermCodes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update role permissions");
      setOk(`Permissions updated for role: ${selectedRole?.name || selectedRoleId}`);
      await loadRolesAndPermissions();
    } catch (e: any) {
      setError(String(e?.message || "Failed to update role permissions"));
    } finally {
      setSaving(false);
    }
  }

  async function createRole() {
    if (!roleCreate.name.trim()) {
      setError("Role name is required");
      return;
    }

    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/admin/rbac/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({
          name: roleCreate.name.trim(),
          code: roleCreate.code.trim() || undefined,
          revenue_visible: roleCreate.revenue_visible === true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to create role");

      const newRoleId = Number(data?.role?.id || 0);
      setOk(`Role created: ${data?.role?.name || roleCreate.name}`);
      setRoleCreate({ name: "", code: "", revenue_visible: false });
      await loadRolesAndPermissions();
      if (newRoleId > 0) {
        setSelectedRoleId(newRoleId);
        setSelectedRolePermCodes([]);
      }
    } catch (e: any) {
      setError(String(e?.message || "Failed to create role"));
    } finally {
      setSaving(false);
    }
  }

  async function resetPasswordForUser(user: BusinessUser) {
    const password = window.prompt(`Set new password for ${user.email} (min 6 chars):`, "");
    if (!password) return;
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to reset password");
      setOk(`Password reset for ${user.email}`);
    } catch (e: any) {
      setError(String(e?.message || "Failed to reset password"));
    } finally {
      setSaving(false);
    }
  }

  async function setUserStatus(user: BusinessUser, status: "active" | "disabled") {
    const verb = status === "disabled" ? "disable" : "enable";
    if (
      status === "disabled" &&
      !window.confirm(
        `Disable access for ${user.email}?\n\nThey will be logged out and will no longer count toward active seats.`
      )
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to ${verb} user`);
      setOk(`User ${verb}d: ${user.email}`);
      await refreshAll();
    } catch (e: any) {
      setError(String(e?.message || `Failed to ${verb} user`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>User Access</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Approve signups, create users, and configure role permissions per business.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <strong>Pending User Requests: {pendingItems.length}</strong>
          <button className="btn" disabled={busy || saving} onClick={refreshAll}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Seat usage: {seatUsage?.used_seats ?? 0}/{seatUsage?.seat_limit ?? 0}
          {" "}({seatUsage?.active_users ?? 0} users + {seatUsage?.active_clients ?? 0} LAN devices)
        </div>
        <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Computer usage: {seatUsage?.active_computers ?? 0}/{seatUsage?.computer_limit ?? 0} (host + LAN clients)
        </div>
        {seatsFull ? (
          <div style={{ marginTop: 8, color: "var(--warning)" }}>
            Active seat limit reached. Approvals/active user creation are blocked until seats are freed or license is upgraded.
          </div>
        ) : null}

        {error ? <div style={{ marginTop: 10, color: "var(--danger)" }}>{error}</div> : null}
        {ok ? <div style={{ marginTop: 10, color: "var(--success)" }}>{ok}</div> : null}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Requested</th>
                <th style={{ width: 180 }}>Approve As</th>
                <th style={{ width: 220 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingItems.map((user) => {
                const requested = String((user as any)?.meta?.requested_role || "billing_staff");
                return (
                  <tr key={user.id}>
                    <td>{user.full_name}</td>
                    <td>{user.email}</td>
                    <td>{user.phone || "-"}</td>
                    <td>{requested}</td>
                    <td>
                      <select
                        className="input"
                        value={roleByPendingUser[user.id] || "billing_staff"}
                        onChange={(e) =>
                          setRoleByPendingUser((prev) => ({
                            ...prev,
                            [user.id]: e.target.value,
                          }))
                        }
                      >
                        {roleCodeOptions.map((roleCode) => (
                          <option key={roleCode} value={roleCode}>
                            {roleCode}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn" disabled={saving || seatsFull} onClick={() => approvePendingUser(user.id)}>
                          Approve
                        </button>
                        <button className="btn" disabled={saving} onClick={() => rejectPendingUser(user.id)}>
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pendingItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No pending signup requests.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Create User (Admin)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <label>
            <div className="muted">Full Name</div>
            <input
              className="input"
              value={createUserForm.full_name}
              onChange={(e) => setCreateUserForm((s) => ({ ...s, full_name: e.target.value }))}
            />
          </label>
          <label>
            <div className="muted">Email</div>
            <input
              className="input"
              type="email"
              value={createUserForm.email}
              onChange={(e) => setCreateUserForm((s) => ({ ...s, email: e.target.value }))}
            />
          </label>
          <label>
            <div className="muted">Phone</div>
            <input
              className="input"
              value={createUserForm.phone}
              onChange={(e) => setCreateUserForm((s) => ({ ...s, phone: e.target.value }))}
            />
          </label>
          <label>
            <div className="muted">Password</div>
            <input
              className="input"
              type="password"
              minLength={6}
              value={createUserForm.password}
              onChange={(e) => setCreateUserForm((s) => ({ ...s, password: e.target.value }))}
            />
          </label>
          <label>
            <div className="muted">Role</div>
            <select
              className="input"
              value={createUserForm.role_code}
              onChange={(e) => setCreateUserForm((s) => ({ ...s, role_code: e.target.value }))}
            >
              {roleCodeOptions.map((roleCode) => (
                <option key={roleCode} value={roleCode}>
                  {roleCode}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="muted">Status</div>
            <select
              className="input"
              value={createUserForm.status}
              onChange={(e) => setCreateUserForm((s) => ({ ...s, status: e.target.value }))}
            >
              <option value="active">Active</option>
              <option value="pending">Pending</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            className="btn"
            disabled={saving || (createUserForm.status === "active" && seatsFull)}
            onClick={createUserByAdmin}
          >
            {saving ? "Saving..." : "Create User"}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Existing Users</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Roles</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.full_name}</td>
                  <td>{user.email}</td>
                  <td>{user.status}</td>
                  <td>
                    {Array.isArray(user.roles) && user.roles.length > 0
                      ? user.roles.map((r) => r.code).join(", ")
                      : "-"}
                  </td>
                  <td>{new Date(user.created_at).toLocaleString()}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" disabled={saving} onClick={() => resetPasswordForUser(user)}>
                        Reset Password
                      </button>
                      {String(user.status || "").toLowerCase() === "active" ? (
                        <button className="btn" disabled={saving} onClick={() => setUserStatus(user, "disabled")}>
                          Disable
                        </button>
                      ) : String(user.status || "").toLowerCase() === "disabled" ? (
                        <button className="btn" disabled={saving} onClick={() => setUserStatus(user, "active")}>
                          Enable
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No users found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Role Permissions</h3>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,320px) 1fr", gap: 12 }}>
          <div>
            <div className="card" style={{ padding: 12, marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Create Custom Role</div>
              <div style={{ display: "grid", gap: 8 }}>
                <label>
                  <div className="muted">Role Name</div>
                  <input
                    className="input"
                    value={roleCreate.name}
                    onChange={(e) => setRoleCreate((s) => ({ ...s, name: e.target.value }))}
                    placeholder="e.g. Store Supervisor"
                  />
                </label>
                <label>
                  <div className="muted">Role Code (optional)</div>
                  <input
                    className="input"
                    value={roleCreate.code}
                    onChange={(e) => setRoleCreate((s) => ({ ...s, code: e.target.value }))}
                    placeholder="e.g. store_supervisor"
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={roleCreate.revenue_visible}
                    onChange={(e) => setRoleCreate((s) => ({ ...s, revenue_visible: e.target.checked }))}
                  />
                  <span className="muted">Can view revenue reports</span>
                </label>
                <button className="btn" disabled={saving} onClick={createRole}>
                  {saving ? "Saving..." : "Create Role"}
                </button>
              </div>
            </div>

            <label>
              <div className="muted">Role</div>
              <select
                className="input"
                value={selectedRoleId || ""}
                onChange={(e) => {
                  const nextId = Number(e.target.value || 0);
                  setSelectedRoleId(nextId);
                  const role = roles.find((r) => Number(r.id) === nextId);
                  const nextCodes = Array.isArray(role?.permissions)
                    ? role.permissions.map((p: any) => String(p?.code || "")).filter(Boolean)
                    : [];
                  setSelectedRolePermCodes(Array.from(new Set(nextCodes)));
                }}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} ({role.code})
                  </option>
                ))}
              </select>
            </label>
            {selectedRole ? (
              <div className="muted" style={{ marginTop: 8 }}>
                Role type: {selectedRole.is_system ? "System" : "Business"} | Revenue visible:{" "}
                {selectedRole.revenue_visible ? "Yes" : "No"}
              </div>
            ) : null}
          </div>

          <div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <label className="muted">Entity</label>
              <select
                className="input"
                value={permEntityFilter}
                onChange={(e) => setPermEntityFilter(e.target.value)}
              >
                <option value="">All</option>
                {permissionEntities.map((ent) => (
                  <option key={ent} value={ent}>
                    {ent}
                  </option>
                ))}
              </select>
              <label className="muted">Search</label>
              <input
                className="input"
                value={permSearch}
                onChange={(e) => setPermSearch(e.target.value)}
                placeholder="code/label…"
                style={{ minWidth: 220 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                Showing {filteredPermissionCatalog.length}/{permissionCatalog.length}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
              {filteredPermissionCatalog.map((permission) => (
                <label key={permission.id} className="card" style={{ padding: 10, display: "flex", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={selectedRolePermCodes.includes(permission.code)}
                    onChange={(e) => togglePermissionCode(permission.code, e.target.checked)}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{permission.label}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{permission.code}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn" disabled={saving || !selectedRoleId} onClick={saveRolePermissions}>
                {saving ? "Saving..." : "Save Role Permissions"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
