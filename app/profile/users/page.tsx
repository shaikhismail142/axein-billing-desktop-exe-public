"use client";

import { useEffect, useMemo, useState } from "react";

type PendingUser = {
  id: number;
  full_name: string;
  email: string;
  phone?: string | null;
  created_at: string;
  meta?: { requested_role?: string };
};

const ROLE_OPTIONS = ["billing_staff", "accountant", "manager", "viewer", "admin", "owner"];

export default function ProfileUsersPage() {
  const [items, setItems] = useState<PendingUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleByUser, setRoleByUser] = useState<Record<number, string>>({});

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users/pending", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load pending users");
      const list = Array.isArray(j?.items) ? j.items : [];
      setItems(list);
      const defaults: Record<number, string> = {};
      for (const it of list) {
        const fromMeta = String((it as any)?.meta?.requested_role || "").trim().toLowerCase();
        defaults[it.id] = ROLE_OPTIONS.includes(fromMeta) ? fromMeta : "billing_staff";
      }
      setRoleByUser(defaults);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load pending users"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(userId: number) {
    const role = roleByUser[userId] || "billing_staff";
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_codes: [role] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Approval failed");
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Approval failed"));
      setBusy(false);
    }
  }

  const total = useMemo(() => items.length, [items]);

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>User Access Approvals</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Approve signups and assign initial access roles.
        </p>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <strong>Pending Users: {total}</strong>
          <button className="btn" onClick={load} disabled={busy}>{busy ? "Refreshing..." : "Refresh"}</button>
        </div>
        {error ? <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div> : null}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Requested</th>
                <th style={{ width: 180 }}>Approve As</th>
                <th style={{ width: 140 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const requested = String((u as any)?.meta?.requested_role || "billing_staff");
                return (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td>{u.phone || "-"}</td>
                    <td>{requested}</td>
                    <td>
                      <select
                        className="input"
                        value={roleByUser[u.id] || "billing_staff"}
                        onChange={(e) =>
                          setRoleByUser((s) => ({
                            ...s,
                            [u.id]: e.target.value,
                          }))
                        }
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button className="btn" disabled={busy} onClick={() => approve(u.id)}>
                        Approve
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">No pending users.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
