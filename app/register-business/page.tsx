"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type FormState = {
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
};

const businessTypes = [
  ["clinic", "Clinic"],
  ["general_store", "General Store"],
  ["spa_saloon", "Spa/Saloon"],
  ["hardware_store", "Hardware Store"],
  ["mobile_store", "Mobile Store"],
  ["hotel", "Hotel"],
  ["restaurant", "Restaurant"],
  ["school_institute", "School/Institute"],
] as const;

export default function RegisterBusinessPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
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
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);

    try {
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
      setOk(`Business registered: ${j?.business?.name || "Success"}`);
      setTimeout(() => router.push("/dashboard"), 900);
    } catch (e: any) {
      setError(String(e?.message || "Registration failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16, maxWidth: 940, margin: "0 auto" }}>
        <h1 style={{ margin: 0 }}>Register Business</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Configure business type, user seats, computer capacity, and owner account.
        </p>

        <form onSubmit={submit} style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <label>
              <div className="muted">Business Name</div>
              <input className="input" value={form.business_name} onChange={(e) => update("business_name", e.target.value)} required />
            </label>
            <label>
              <div className="muted">Business Type</div>
              <select className="input" value={form.business_type} onChange={(e) => update("business_type", e.target.value)}>
                {businessTypes.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
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
              <div className="muted">Owner Password</div>
              <input className="input" type="password" minLength={6} value={form.owner_password} onChange={(e) => update("owner_password", e.target.value)} required />
            </label>
          </div>

          {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
          {ok ? <div style={{ color: "var(--success)" }}>{ok}</div> : null}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy} type="submit">
              {busy ? "Registering..." : "Register Business"}
            </button>
            <a className="btn" href="/signup">Open User Sign Up</a>
          </div>
        </form>
      </div>
    </div>
  );
}
