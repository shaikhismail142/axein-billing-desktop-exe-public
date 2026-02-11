"use client";

import { useState } from "react";

export default function SignUpPage() {
  const [form, setForm] = useState({
    business_code: "",
    full_name: "",
    email: "",
    phone: "",
    password: "",
    requested_role: "billing_staff",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function update(key: string, value: string) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/users/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Sign up failed");
      setOk("Signup submitted. Wait for admin approval.");
      setForm({ ...form, password: "" });
    } catch (e: any) {
      setError(String(e?.message || "Sign up failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16, maxWidth: 620, margin: "0 auto" }}>
        <h1 style={{ margin: 0 }}>Sign Up</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Request access to your business workspace. Admin approval is required.
        </p>

        <form onSubmit={submit} style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <label>
            <div className="muted">Business Code</div>
            <input className="input" value={form.business_code} onChange={(e) => update("business_code", e.target.value)} required />
          </label>
          <label>
            <div className="muted">Full Name</div>
            <input className="input" value={form.full_name} onChange={(e) => update("full_name", e.target.value)} required />
          </label>
          <label>
            <div className="muted">Email</div>
            <input className="input" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required />
          </label>
          <label>
            <div className="muted">Phone</div>
            <input className="input" value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          </label>
          <label>
            <div className="muted">Requested Role</div>
            <select className="input" value={form.requested_role} onChange={(e) => update("requested_role", e.target.value)}>
              <option value="billing_staff">Billing Staff</option>
              <option value="accountant">Accountant</option>
              <option value="manager">Manager</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label>
            <div className="muted">Password</div>
            <input className="input" type="password" minLength={6} value={form.password} onChange={(e) => update("password", e.target.value)} required />
          </label>

          {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}
          {ok ? <div style={{ color: "var(--success)" }}>{ok}</div> : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Submitting..." : "Sign Up"}
          </button>
        </form>
      </div>
    </div>
  );
}
