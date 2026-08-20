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
    const hosted = window.location.hostname === "billing.axein.in";
    setHostedPortal(hosted);
    // Defenzo SSO redirects authenticated users directly to their requested
    // module. Redirecting again here can race the server guard and create a
    // /login <-> /dashboard loop when an old session cookie is present.
    if (hosted) return;
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
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 15% 15%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 34%), radial-gradient(circle at 85% 82%, color-mix(in oklab, #0f766e 18%, transparent), transparent 36%)",
        }}
      />
      <div className="relative w-full" style={{ maxWidth: 480 }}>
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="ax-brand-badge" style={{ width: 42, height: 42 }}>AB</span>
          <div>
            <div className="text-xl font-semibold tracking-tight">AxEin Billing</div>
            <div className="text-xs uppercase tracking-[0.2em] opacity-60">Defenzo Workspace</div>
          </div>
        </div>
        <div className="card" style={{ padding: 28, boxShadow: "0 24px 70px color-mix(in oklab, var(--text) 14%, transparent)" }}>
        <div className="mb-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "color-mix(in oklab, #0f766e 14%, transparent)", color: "#0f766e" }}>
          Secure business portal
        </div>
        <h1 className="text-3xl font-semibold tracking-tight" style={{ margin: 0 }}>Welcome back</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {hostedPortal
            ? "AxEin Billing uses your connected business portal for secure sign-in."
            : "Use your approved user account to access AxEin Billing."}
        </p>

        {hostedPortal ? (
          <div style={{ marginTop: 22, display: "grid", gap: 14 }}>
            <a className="btn btn-primary" href="https://defenzo.in/admin/" style={{ minHeight: 48, justifyContent: "center" }}>
              Continue with Defenzo
            </a>
            <p className="muted" style={{ margin: 0 }}>
              Sign in to Defenzo and select Invoice. Your authorized billing workspace will open automatically without another password.
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
        <p className="mt-5 text-center text-xs opacity-60">Protected by AxEin secure sign-in</p>
      </div>
    </div>
  );
}
