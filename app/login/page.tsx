"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    business_code: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.authenticated) {
          router.replace("/dashboard");
        }
      } catch {
        // ignore
      }
    })();
  }, [router]);

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
      router.replace("/dashboard");
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
          Use your approved user account to access AxEin Billing.
        </p>

        <form onSubmit={submit} style={{ marginTop: 12, display: "grid", gap: 10 }}>
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
        </form>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn" href="/signup">New user? Sign Up</a>
          <a className="btn" href="/activate">Go to Activation</a>
        </div>
      </div>
    </div>
  );
}

