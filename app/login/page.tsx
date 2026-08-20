"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [form, setForm] = useState({
    email: "",
    password: "",
    business_code: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostedPortal, setHostedPortal] = useState(false);

  useEffect(() => {
    setHostedPortal(window.location.hostname === "billing.axein.in");
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.authenticated) {
          // Full navigation avoids WebView cookie propagation issues.
          window.location.replace("/dashboard");
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  function update(key: "email" | "password" | "business_code", value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error || "Login failed"));
      }
      // Full navigation avoids WebView cookie propagation issues.
      window.location.assign("/dashboard");
    } catch (err: any) {
      setError(String(err?.message || "Login failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}>
        <h1 style={{ margin: 0 }}>Sign In</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {hostedPortal
            ? "AxEin Billing uses your connected business portal for secure sign-in."
            : "Use your approved user account to access AxEin Billing."}
        </p>

        {hostedPortal ? (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            <a className="btn" href="https://defenzo.in/admin/">
              Return to Defenzo
            </a>
            <p className="muted" style={{ margin: 0 }}>
              Sign in to Defenzo, then select Invoice. You will not need a second password.
            </p>
          </div>
        ) : <form onSubmit={submit} style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <label>
            <div className="muted">Business Code (optional)</div>
            <input
              className="input"
              value={form.business_code}
              onChange={(e) => update("business_code", e.target.value)}
              placeholder="e.g. sample-1234"
            />
          </label>
          <label>
            <div className="muted">Email</div>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              required
            />
          </label>
          <label>
            <div className="muted">Password</div>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              required
            />
          </label>

          {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>}

        {!hostedPortal ? <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn" href="/activate">Go to Activation</a>
        </div> : null}
      </div>
    </div>
  );
}
