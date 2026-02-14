"use client";

import { useEffect, useMemo, useState } from "react";

type KeygenForm = {
  mode: "new" | "extend";
  existing_license_key: string;
  extend_from_expires_at: string;
  email: string;
  business_name: string;
  business_type: string;
  usage_mode: "standalone" | "lan_host";
  user_limit: number;
  computer_limit: number;
  license_type: string;
  validity_months: number;
  installation_scope: "single_pc" | "business_lan";
  features: string;
};

type KeygenResponse = {
  ok: boolean;
  error?: string;
  packed_token?: string;
  signature?: string;
  summary?: {
    license_key: string;
    valid_from: string;
    expires_at: string;
    user_limit: number;
    computer_limit: number;
    license_type: string;
    usage_mode: string;
    installation_scope: string;
  };
  payload?: Record<string, unknown>;
};

type HistoryItem = {
  id: number;
  created_at: string;
  mode: string;
  license_key: string;
  email: string;
  business_name: string;
  business_type: string;
  usage_mode: string;
  installation_scope: string;
  license_type: string;
  user_limit: number;
  computer_limit: number;
  valid_from: string;
  expires_at: string;
  activation_token?: string | null;
};

type HistoryResponse = {
  ok: boolean;
  error?: string;
  items?: HistoryItem[];
  total?: number;
  total_pages?: number;
};

const BUSINESS_TYPES = [
  ["clinic", "Clinic"],
  ["general_store", "General Store"],
  ["spa_saloon", "Spa/Salon"],
  ["hardware_store", "Hardware Store"],
  ["mobile_store", "Mobile Store"],
  ["pharmacy", "Pharmacy"],
  ["boutique", "Boutique / Clothing"],
  ["electronics_store", "Electronics Store"],
  ["bakery", "Bakery / Cafe"],
  ["hotel", "Hotel"],
  ["restaurant", "Restaurant"],
  ["school_institute", "School/Institute"],
] as const;

function toIsoDateOnly(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

async function copyText(value: string) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

function fmtLocalDateTime(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN");
  } catch {
    return iso;
  }
}

function makeActivationJson(result: KeygenResponse | null) {
  if (!result?.ok) return "";
  const payload = result.payload || {};
  const signature = String(result.signature || "").trim();
  return JSON.stringify(
    signature ? { ...payload, signature } : payload,
    null,
    2
  );
}

export default function StaffKeygenPage() {
  const [busy, setBusy] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [result, setResult] = useState<KeygenResponse | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [available, setAvailable] = useState(true);
  const [superPassword, setSuperPassword] = useState("");

  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historySort, setHistorySort] = useState("created_at");
  const [historyDir, setHistoryDir] = useState<"asc" | "desc">("desc");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  const [form, setForm] = useState<KeygenForm>({
    mode: "new",
    existing_license_key: "",
    extend_from_expires_at: "",
    email: "",
    business_name: "",
    business_type: "general_store",
    usage_mode: "standalone",
    user_limit: 5,
    computer_limit: 1,
    license_type: "standard",
    validity_months: 12,
    installation_scope: "single_pc",
    features: "billing,inventory,quotations,reports,logs",
  });

  function update<K extends keyof KeygenForm>(key: K, value: KeygenForm[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  const suggestedScope = useMemo(
    () => (form.usage_mode === "lan_host" ? "business_lan" : "single_pc"),
    [form.usage_mode]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/staff/keygen/unlock", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          unlocked?: boolean;
          message?: string;
        };
        if (!active) return;
        setAvailable(data.available !== false);
        setUnlocked(!!data.unlocked);
        if (data.available === false && data.message) {
          setError(data.message);
        }
      } catch {
        if (!active) return;
        setError("Failed to initialize keygen unlock state");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!unlocked) {
      setHistoryItems([]);
      setHistoryTotal(0);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }

    let active = true;
    (async () => {
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const qs = new URLSearchParams({
          page: String(historyPage),
          page_size: String(historyPageSize),
          sort: historySort,
          dir: historyDir,
        });
        const res = await fetch(`/api/staff/keygen/history?${qs.toString()}`, {
          cache: "no-store",
          headers: { "x-admin": "1" },
        });
        const data = (await res.json().catch(() => ({}))) as HistoryResponse;
        if (!active) return;
        if (!res.ok || !data?.ok) {
          throw new Error(String((data as any)?.error || "Failed to load issuance history"));
        }
        setHistoryItems(Array.isArray(data.items) ? data.items : []);
        setHistoryTotal(Number(data.total || 0));
      } catch (e: any) {
        if (!active) return;
        setHistoryError(String(e?.message || "Failed to load issuance history"));
      } finally {
        if (!active) return;
        setHistoryLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [unlocked, historyPage, historyPageSize, historySort, historyDir, historyReloadKey]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    setResult(null);

    try {
      const body = {
        ...form,
        installation_scope: form.installation_scope || suggestedScope,
      };
      const res = await fetch("/api/staff/keygen/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as KeygenResponse;
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Key generation failed"));
      }
      setResult(data);
      setOk("License key generated successfully.");
      setHistoryReloadKey((n) => n + 1);
      if (data?.summary?.expires_at) {
        update("extend_from_expires_at", toIsoDateOnly(data.summary.expires_at));
        if (form.mode === "new") {
          update("mode", "extend");
          update("existing_license_key", data.summary.license_key);
        }
      }
    } catch (e: any) {
      setError(String(e?.message || "Key generation failed"));
    } finally {
      setBusy(false);
    }
  }

  async function unlockForm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!superPassword.trim()) {
      setError("Enter super password to continue.");
      return;
    }
    setUnlockBusy(true);
    try {
      const res = await fetch("/api/staff/keygen/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({ super_password: superPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(String(data.error || "Super password validation failed"));
      }
      setUnlocked(true);
      setSuperPassword("");
    } catch (e: any) {
      setError(String(e?.message || "Super password validation failed"));
      setUnlocked(false);
    } finally {
      setUnlockBusy(false);
    }
  }

  async function lockForm() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/staff/keygen/unlock", { method: "DELETE" });
      setUnlocked(false);
      setOk(null);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 1100, margin: "24px auto" }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ margin: 0 }}>AxEin Staff Keygen</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Staff-only license generator. Use super password, set user/computer limits, and issue tokens for activation or extension.
        </p>

        {!unlocked ? (
          <form onSubmit={unlockForm} style={{ marginTop: 14, display: "grid", gap: 12, maxWidth: 420 }}>
            <label>
              <div className="muted">Super Password</div>
              <input
                className="input"
                type="password"
                value={superPassword}
                onChange={(e) => setSuperPassword(e.target.value)}
                autoFocus
                required
              />
            </label>
            {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
            <div>
              <button className="btn" type="submit" disabled={unlockBusy || !available}>
                {unlockBusy ? "Checking..." : "Continue"}
              </button>
            </div>
          </form>
        ) : (
        <form onSubmit={submit} style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <label>
              <div className="muted">Mode</div>
              <select className="input" value={form.mode} onChange={(e) => update("mode", e.target.value as KeygenForm["mode"])}>
                <option value="new">New License</option>
                <option value="extend">Extend Existing License</option>
              </select>
            </label>
            <label>
              <div className="muted">Customer Email</div>
              <input className="input" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
            </label>
            <label>
              <div className="muted">Business Name</div>
              <input className="input" value={form.business_name} onChange={(e) => update("business_name", e.target.value)} required />
            </label>
            <label>
              <div className="muted">Business Type</div>
              <select className="input" value={form.business_type} onChange={(e) => update("business_type", e.target.value)}>
                {BUSINESS_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              <div className="muted">Usage Mode</div>
              <select
                className="input"
                value={form.usage_mode}
                onChange={(e) => {
                  const usageMode = e.target.value as KeygenForm["usage_mode"];
                  setForm((prev) => ({
                    ...prev,
                    usage_mode: usageMode,
                    installation_scope: usageMode === "lan_host" ? "business_lan" : "single_pc",
                    computer_limit: usageMode === "lan_host" ? Math.max(2, prev.computer_limit) : 1,
                  }));
                }}
              >
                <option value="standalone">Standalone</option>
                <option value="lan_host">LAN Host</option>
              </select>
            </label>
            <label>
              <div className="muted">License Type</div>
              <select className="input" value={form.license_type} onChange={(e) => update("license_type", e.target.value)}>
                <option value="starter">Starter</option>
                <option value="standard">Standard</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </label>
            <label>
              <div className="muted">No. of Users</div>
              <input className="input" type="number" min={1} value={form.user_limit} onChange={(e) => update("user_limit", Number(e.target.value) || 1)} />
            </label>
            <label>
              <div className="muted">No. of Computers</div>
              <input className="input" type="number" min={1} value={form.computer_limit} onChange={(e) => update("computer_limit", Number(e.target.value) || 1)} />
            </label>
            <label>
              <div className="muted">Validity (months)</div>
              <input className="input" type="number" min={1} value={form.validity_months} onChange={(e) => update("validity_months", Number(e.target.value) || 1)} />
            </label>
            <label>
              <div className="muted">Installation Scope</div>
              <select className="input" value={form.installation_scope} onChange={(e) => update("installation_scope", e.target.value as KeygenForm["installation_scope"])}>
                <option value="single_pc">Single PC</option>
                <option value="business_lan">Business LAN</option>
              </select>
            </label>
            <label>
              <div className="muted">Features (comma separated)</div>
              <input className="input" value={form.features} onChange={(e) => update("features", e.target.value)} />
            </label>
            {form.mode === "extend" ? (
              <>
                <label>
                  <div className="muted">Existing License Key</div>
                  <input
                    className="input"
                    value={form.existing_license_key}
                    onChange={(e) => update("existing_license_key", e.target.value)}
                    required={form.mode === "extend"}
                  />
                </label>
                <label>
                  <div className="muted">Extend From Expiry Date</div>
                  <input
                    className="input"
                    type="date"
                    value={form.extend_from_expires_at}
                    onChange={(e) => update("extend_from_expires_at", e.target.value)}
                  />
                </label>
              </>
            ) : null}
          </div>

          {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
          {ok ? <div style={{ color: "var(--success)" }}>{ok}</div> : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Generating..." : "Generate License Key"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={lockForm}
            >
              Lock
            </button>
          </div>
        </form>
        )}

        {result?.ok ? (
          <div className="card" style={{ marginTop: 14, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Generated License</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
              <div><strong>License Key:</strong> {result.summary?.license_key}</div>
              <div><strong>Valid From:</strong> {result.summary?.valid_from}</div>
              <div><strong>Expires At:</strong> {result.summary?.expires_at}</div>
              <div><strong>User Limit:</strong> {result.summary?.user_limit}</div>
              <div><strong>Computer Limit:</strong> {result.summary?.computer_limit}</div>
              <div><strong>Type:</strong> {result.summary?.license_type}</div>
            </div>

            <label style={{ display: "block", marginTop: 10 }}>
              <div className="muted">Packed Activation Token</div>
              <textarea className="input" readOnly rows={4} value={result.packed_token || ""} />
            </label>

            <label style={{ display: "block", marginTop: 10 }}>
              <div className="muted">Activation JSON (includes signature)</div>
              <textarea className="input" readOnly rows={6} value={makeActivationJson(result)} />
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => copyText(result.packed_token || "")}>Copy Token</button>
              <button className="btn" onClick={() => copyText(makeActivationJson(result))}>Copy Activation JSON</button>
            </div>
          </div>
        ) : null}

        {unlocked ? (
          <div className="card" style={{ marginTop: 14, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0 }}>Issuance History</h3>
                <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  Tracks issued licenses for support and renewals.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  className="input"
                  value={historySort}
                  onChange={(e) => {
                    setHistorySort(e.target.value);
                    setHistoryPage(1);
                  }}
                  title="Sort by"
                >
                  <option value="created_at">Issued At</option>
                  <option value="expires_at">Expiry Date</option>
                  <option value="business_name">Business Name</option>
                  <option value="user_limit">User Limit</option>
                </select>
                <select
                  className="input"
                  value={historyDir}
                  onChange={(e) => {
                    setHistoryDir((e.target.value === "asc" ? "asc" : "desc") as any);
                    setHistoryPage(1);
                  }}
                  title="Sort direction"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
                <select
                  className="input"
                  value={historyPageSize}
                  onChange={(e) => {
                    setHistoryPageSize(Number(e.target.value) || 20);
                    setHistoryPage(1);
                  }}
                  title="Rows per page"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                <button className="btn" type="button" onClick={() => setHistoryReloadKey((n) => n + 1)} disabled={historyLoading}>
                  {historyLoading ? "Loading..." : "Refresh"}
                </button>
              </div>
            </div>

            {historyError ? <div style={{ color: "var(--danger)", marginTop: 10 }}>{historyError}</div> : null}

            <div style={{ marginTop: 12, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
                <thead style={{ background: "var(--thead)", color: "var(--thead-text)" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>Issued</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>Business</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>Email</th>
                    <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>Users</th>
                    <th style={{ textAlign: "right", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>PCs</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>Expires</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>License Key</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyItems.length === 0 && !historyLoading ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 12, opacity: 0.7 }}>
                        No licenses issued yet.
                      </td>
                    </tr>
                  ) : null}
                  {historyItems.map((it) => (
                    <tr key={it.id}>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)", whiteSpace: "nowrap" }}>
                        {fmtLocalDateTime(it.created_at)}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>
                        <div style={{ fontWeight: 700 }}>{it.business_name}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {it.business_type} • {it.usage_mode}
                        </div>
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>{it.email}</td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)", textAlign: "right" }}>
                        {it.user_limit}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)", textAlign: "right" }}>
                        {it.computer_limit}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)", whiteSpace: "nowrap" }}>
                        {toIsoDateOnly(it.expires_at)}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace" }}>
                        {it.license_key}
                      </td>
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--glass-brd)" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button className="btn" type="button" onClick={() => copyText(it.license_key)}>
                            Copy Key
                          </button>
                          {it.activation_token ? (
                            <button className="btn" type="button" onClick={() => copyText(String(it.activation_token))}>
                              Copy Token
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <div className="muted" style={{ fontSize: 13 }}>
                Total: <b>{historyTotal}</b>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" type="button" onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={historyPage <= 1 || historyLoading}>
                  Prev
                </button>
                <div className="muted" style={{ fontSize: 13 }}>
                  Page <b>{historyPage}</b>
                </div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setHistoryPage((p) => p + 1)}
                  disabled={historyLoading || historyPage * historyPageSize >= historyTotal}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
