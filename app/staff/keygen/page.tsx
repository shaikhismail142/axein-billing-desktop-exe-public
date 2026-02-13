"use client";

import { useMemo, useState } from "react";

type KeygenForm = {
  super_password: string;
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

const BUSINESS_TYPES = [
  ["clinic", "Clinic"],
  ["general_store", "General Store"],
  ["spa_saloon", "Spa/Saloon"],
  ["hardware_store", "Hardware Store"],
  ["mobile_store", "Mobile Store"],
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

export default function StaffKeygenPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [result, setResult] = useState<KeygenResponse | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const [form, setForm] = useState<KeygenForm>({
    super_password: "",
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

  function unlockForm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.super_password.trim()) {
      setError("Enter super password to continue.");
      return;
    }
    setUnlocked(true);
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
                value={form.super_password}
                onChange={(e) => update("super_password", e.target.value)}
                autoFocus
                required
              />
            </label>
            {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
            <div>
              <button className="btn" type="submit">Continue</button>
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
              onClick={() => {
                setUnlocked(false);
                setOk(null);
                setError(null);
              }}
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

            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => copyText(result.packed_token || "")}>Copy Token</button>
              <button className="btn" onClick={() => copyText(JSON.stringify(result.payload || {}, null, 2))}>Copy Payload JSON</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
