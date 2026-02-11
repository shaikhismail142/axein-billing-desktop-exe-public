"use client";

import { useEffect, useState } from "react";

type LanStatus = {
  business_id: number;
  seat_usage?: {
    seat_limit: number;
    active_users: number;
    active_clients: number;
    used_seats: number;
    remaining_seats: number;
  } | null;
  host: null | {
    host_uid: string;
    host_name: string;
    mode: "standalone" | "lan_host";
    allow_pairing: boolean;
    require_approval: boolean;
    bind_address: string;
    port: number;
    updated_at: string;
  };
  clients: Array<{
    client_uid: string;
    device_name: string;
    role_code: string;
    status: string;
    paired_at: string;
    last_seen_at?: string | null;
  }>;
  available_roles?: string[];
  active_pairing_sessions?: Array<{
    pairing_uid: string;
    status: string;
    expires_at: string;
    max_uses: number;
    used_uses: number;
    created_at: string;
  }>;
  sync?: {
    latest_event_id?: number;
    events_24h?: number;
  };
};

export default function ProfileNetworkPage() {
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string>("");
  const [pairingMeta, setPairingMeta] = useState<string>("");
  const [roleByClient, setRoleByClient] = useState<Record<string, string>>({});
  const seatsFull = (status?.seat_usage?.remaining_seats ?? 1) <= 0;

  const [cfg, setCfg] = useState({
    host_name: "",
    mode: "standalone",
    allow_pairing: true,
    require_approval: true,
    bind_address: "0.0.0.0",
    port: 3199,
  });

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/lan/status", { cache: "no-store", headers: { "x-admin": "1" } });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to load LAN status");
      setStatus(j);
      const roles: Record<string, string> = {};
      for (const row of Array.isArray(j?.clients) ? j.clients : []) {
        roles[String(row.client_uid)] = String(row.role_code || "billing_staff");
      }
      setRoleByClient(roles);
      if (j?.host) {
        setCfg({
          host_name: j.host.host_name || "",
          mode: j.host.mode || "standalone",
          allow_pairing: Boolean(j.host.allow_pairing),
          require_approval: Boolean(j.host.require_approval),
          bind_address: j.host.bind_address || "0.0.0.0",
          port: Number(j.host.port || 3199),
        });
      }
    } catch (e: any) {
      setError(String(e?.message || "Failed to load LAN status"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveConfig() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/lan/host/configure", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify(cfg),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Failed to save LAN config");
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to save LAN config"));
      setBusy(false);
    }
  }

  async function generatePairingCode() {
    setBusy(true);
    setError(null);
    setPairingCode("");
    setPairingMeta("");
    try {
      const r = await fetch("/api/lan/host/pairing-code", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({ ttl_minutes: 10, max_uses: 1 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Failed to generate pairing code");
      setPairingCode(String(j.pairing_code || ""));
      setPairingMeta(`Expires: ${new Date(j.expires_at).toLocaleString()}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to generate pairing code"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(clientUid: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/lan/clients/${encodeURIComponent(clientUid)}/revoke`, {
        method: "POST",
        headers: { "x-admin": "1" },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Failed to revoke client");
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to revoke client"));
      setBusy(false);
    }
  }

  async function updateRole(clientUid: string) {
    const roleCode = String(roleByClient[clientUid] || "").trim();
    if (!roleCode) return;

    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/lan/clients/${encodeURIComponent(clientUid)}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({ role_code: roleCode }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Failed to update client role");
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to update client role"));
      setBusy(false);
    }
  }

  async function approve(clientUid: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/lan/clients/${encodeURIComponent(clientUid)}/approve`, {
        method: "POST",
        headers: { "x-admin": "1" },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Failed to approve client");
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to approve client"));
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>Network (LAN Mode)</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Configure host mode for multi-PC usage, generate pairing codes, and manage connected clients.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          <span className="muted">Sync Event ID: {Number(status?.sync?.latest_event_id || 0)}</span>
          <span className="muted">Events (24h): {Number(status?.sync?.events_24h || 0)}</span>
          <span className="muted">
            Seat Usage: {Number(status?.seat_usage?.used_seats || 0)}/{Number(status?.seat_usage?.seat_limit || 0)}
          </span>
        </div>
        {seatsFull ? (
          <div style={{ color: "var(--warning)", marginTop: 8 }}>
            Seat limit reached. Pairing and approvals are blocked until seats are freed or license is upgraded.
          </div>
        ) : null}
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Host Configuration</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <label>
            <div className="muted">Host Name</div>
            <input className="input" value={cfg.host_name} onChange={(e) => setCfg((s) => ({ ...s, host_name: e.target.value }))} />
          </label>
          <label>
            <div className="muted">Mode</div>
            <select className="input" value={cfg.mode} onChange={(e) => setCfg((s) => ({ ...s, mode: e.target.value as any }))}>
              <option value="standalone">Standalone</option>
              <option value="lan_host">LAN Host</option>
            </select>
          </label>
          <label>
            <div className="muted">Bind Address</div>
            <input className="input" value={cfg.bind_address} onChange={(e) => setCfg((s) => ({ ...s, bind_address: e.target.value }))} />
          </label>
          <label>
            <div className="muted">Port</div>
            <input className="input" type="number" min={1024} max={65535} value={cfg.port} onChange={(e) => setCfg((s) => ({ ...s, port: Number(e.target.value) || 3199 }))} />
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={cfg.allow_pairing} onChange={(e) => setCfg((s) => ({ ...s, allow_pairing: e.target.checked }))} />
            Allow pairing
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={cfg.require_approval} onChange={(e) => setCfg((s) => ({ ...s, require_approval: e.target.checked }))} />
            Require approval
          </label>
          <button className="btn" disabled={busy} onClick={saveConfig}>Save Host Config</button>
          <button className="btn" disabled={busy || seatsFull} onClick={generatePairingCode}>Generate Pairing Code</button>
        </div>

        {pairingCode ? (
          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div className="muted">Pairing Code</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>{pairingCode}</div>
            <div className="muted">{pairingMeta}</div>
          </div>
        ) : null}

        {error ? <div style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div> : null}
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Connected Clients</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Role</th>
                <th>Status</th>
                <th>Paired</th>
                <th>Last Seen</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(status?.clients || []).map((c) => (
                <tr key={c.client_uid}>
                  <td>{c.device_name}<div className="muted text-xs">{c.client_uid}</div></td>
                  <td>
                    <select
                      className="input"
                      value={roleByClient[c.client_uid] || c.role_code || "billing_staff"}
                      onChange={(e) =>
                        setRoleByClient((s) => ({
                          ...s,
                          [c.client_uid]: e.target.value,
                        }))
                      }
                    >
                      {(status?.available_roles || ["billing_staff", "accountant", "manager", "viewer", "admin", "owner"]).map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </td>
                  <td>{c.status}</td>
                  <td>{new Date(c.paired_at).toLocaleString()}</td>
                  <td>{c.last_seen_at ? new Date(c.last_seen_at).toLocaleString() : "-"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(roleByClient[c.client_uid] || c.role_code) !== c.role_code ? (
                        <button className="btn" disabled={busy} onClick={() => updateRole(c.client_uid)}>Save Role</button>
                      ) : null}
                      {c.status === "pending" ? (
                        <button className="btn" disabled={busy || seatsFull} onClick={() => approve(c.client_uid)}>Approve</button>
                      ) : null}
                      {c.status === "active" ? (
                        <button className="btn" disabled={busy} onClick={() => revoke(c.client_uid)}>Revoke</button>
                      ) : null}
                      {c.status !== "active" && c.status !== "pending" ? "-" : null}
                    </div>
                  </td>
                </tr>
              ))}
              {(status?.clients || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">No LAN clients connected.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Active Pairing Sessions</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Uses</th>
              </tr>
            </thead>
            <tbody>
              {(status?.active_pairing_sessions || []).map((session) => (
                <tr key={session.pairing_uid}>
                  <td>{session.pairing_uid}</td>
                  <td>{session.status}</td>
                  <td>{new Date(session.expires_at).toLocaleString()}</td>
                  <td>{session.used_uses}/{session.max_uses}</td>
                </tr>
              ))}
              {(status?.active_pairing_sessions || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">No active pairing sessions.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
