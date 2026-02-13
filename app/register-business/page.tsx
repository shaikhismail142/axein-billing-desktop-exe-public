"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BUSINESS_TYPES } from "./_constants";

type FormState = {
  license_key: string;
  business_name: string;
  business_type: string;
  user_limit: number;
  computer_limit: number;
  license_plan_intent: string;
  usage_mode: "standalone" | "lan_host";
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  owner_password: string;
  owner_password_confirm: string;
};

function normalizeLicenseBody(raw: string) {
  if (raw.startsWith("L-")) return { token: raw };
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    if (!parsed?.license_key || !parsed?.email || !parsed?.expires_at || !parsed?.signature) {
      throw new Error("License JSON is missing required fields");
    }
    return {
      license_key: String(parsed.license_key),
      email: String(parsed.email),
      expires_at: String(parsed.expires_at),
      signature: String(parsed.signature),
    };
  }
  throw new Error("Paste a full key token starting with L- or valid license JSON");
}

export default function RegisterBusinessPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    license_key: "",
    business_name: "",
    business_type: "general_store",
    user_limit: 5,
    computer_limit: 1,
    license_plan_intent: "starter",
    usage_mode: "standalone",
    owner_name: "",
    owner_email: "",
    owner_phone: "",
    owner_password: "",
    owner_password_confirm: "",
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  const onboardingSummary = useMemo(() => {
    return `${form.user_limit} users • ${form.computer_limit} computers • ${form.usage_mode === "lan_host" ? "LAN mode" : "single PC"}`;
  }, [form.computer_limit, form.usage_mode, form.user_limit]);

  async function ensureActivationReady() {
    const statusRes = await fetch("/api/license/status", {
      cache: "no-store",
      headers: { "x-admin": "1" },
    });
    const status = await statusRes.json().catch(() => ({}));
    if (statusRes.ok && (status?.isLicensed || status?.trialActive)) {
      return;
    }

    const raw = form.license_key.trim();
    if (!raw) {
      throw new Error("License key is required before business registration");
    }
    const body = normalizeLicenseBody(raw);
    const verifyRes = await fetch("/api/license/verify-key", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin": "1" },
      body: JSON.stringify(body),
    });
    const verify = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !verify?.ok) {
      throw new Error(String(verify?.error || "License verification failed"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);

    try {
      if (form.owner_password !== form.owner_password_confirm) {
        throw new Error("Owner/Admin password confirmation does not match");
      }

      await ensureActivationReady();

      const res = await fetch("/api/onboarding/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: form.business_name,
          business_type: form.business_type,
          user_limit: form.user_limit,
          computer_limit: form.computer_limit,
          license_plan_intent: form.license_plan_intent,
          usage_mode: form.usage_mode,
          owner: {
            full_name: form.owner_name,
            email: form.owner_email,
            phone: form.owner_phone,
            password: form.owner_password,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Registration failed");
      setOk(
        `Business registered: ${j?.business?.name || "Success"} (Code: ${j?.business?.code || "n/a"})`
      );
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.owner_email,
          password: form.owner_password,
          business_code: j?.business?.code || "",
        }),
      }).catch(() => null);
      setTimeout(() => router.push("/dashboard"), 900);
    } catch (e: any) {
      setError(String(e?.message || "Registration failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: 0 }}>Register Business</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Activate license, select business template, and create the first Owner/Admin account.
        </p>

        <form onSubmit={submit} style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Step 1: Activation Key</div>
            <label>
              <div className="muted">License Key Token (L-...) or License JSON</div>
              <textarea
                className="input"
                rows={3}
                value={form.license_key}
                onChange={(e) => update("license_key", e.target.value)}
                placeholder="Paste the key generated from AxEin staff keygen"
              />
            </label>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              If trial/license is already active, this field is optional.
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Step 2: Business Setup</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
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
                <div className="muted">License Plan</div>
                <select className="input" value={form.license_plan_intent} onChange={(e) => update("license_plan_intent", e.target.value)}>
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
                <div className="muted">Usage Mode</div>
                <select
                  className="input"
                  value={form.usage_mode}
                  onChange={(e) => {
                    const mode = e.target.value as FormState["usage_mode"];
                    setForm((s) => ({
                      ...s,
                      usage_mode: mode,
                      computer_limit: mode === "standalone" ? 1 : Math.max(2, s.computer_limit),
                    }));
                  }}
                >
                  <option value="standalone">Standalone (Single PC)</option>
                  <option value="lan_host">LAN Host (Multi-PC)</option>
                </select>
              </label>
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Current setup: {onboardingSummary}
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Step 3: Owner/Admin Account</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
              <label>
                <div className="muted">Owner Name</div>
                <input className="input" value={form.owner_name} onChange={(e) => update("owner_name", e.target.value)} required />
              </label>
              <label>
                <div className="muted">Owner Email</div>
                <input className="input" type="email" value={form.owner_email} onChange={(e) => update("owner_email", e.target.value)} required />
              </label>
              <label>
                <div className="muted">Owner Phone</div>
                <input className="input" value={form.owner_phone} onChange={(e) => update("owner_phone", e.target.value)} />
              </label>
              <label>
                <div className="muted">Owner/Admin Password</div>
                <input className="input" type="password" minLength={6} value={form.owner_password} onChange={(e) => update("owner_password", e.target.value)} required />
              </label>
              <label>
                <div className="muted">Confirm Owner/Admin Password</div>
                <input className="input" type="password" minLength={6} value={form.owner_password_confirm} onChange={(e) => update("owner_password_confirm", e.target.value)} required />
              </label>
            </div>
          </div>

          {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
          {ok ? <div style={{ color: "var(--success)" }}>{ok}</div> : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={busy} type="submit">
              {busy ? "Registering..." : "Activate + Register Business"}
            </button>
            <a className="btn" href="/signup">Open User Sign Up</a>
          </div>
        </form>
      </div>
    </div>
  );
}
