'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from "next/link";
import { useTheme } from "@/app/providers/ThemeProvider";

const LicensePanel = dynamic(
  () => import('@/app/activate/_components/LicensePanel'),
  { ssr: false, loading: () => <div className="p-6 text-sm opacity-70">Loading activation panel…</div> }
);

type Business = {
  name: string;
  legal_name?: string;
  address: string;
  phone: string;
  gstin: string;
  pan?: string;
  email?: string;
  website?: string;
  currency?: string;
  timezone?: string;
  date_format?: string;
  quotation_prefix?: string;
  purchase_prefix?: string;
  job_card_prefix?: string;
  invoice_prefix: string;
  state_code: string;
  signature_name: string;
  signature_title: string;
  signature_image_url: string;
  logo_url?: string; // uploaded logo URL for print/PDF
  bank_account_name?: string;
  bank_account_number?: string;
  bank_ifsc?: string;
  bank_name?: string;
  bank_branch?: string;
  bank_upi?: string;
};

type ColorTheme = "blue" | "green" | "amber" | "rose" | "purple" | "slate" | "orange" | "console";

const DEFAULTS: Business = {
  name: '',
  legal_name: '',
  address: '',
  phone: '',
  gstin: '',
  pan: '',
  email: '',
  website: '',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  date_format: 'DD/MM/YYYY',
  quotation_prefix: 'QUO',
  purchase_prefix: 'PUR',
  job_card_prefix: 'JOB',
  invoice_prefix: 'INV',
  state_code: '27',
  signature_name: '',
  signature_title: 'Proprietor',
  signature_image_url: '',
  logo_url: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_ifsc: '',
  bank_name: '',
  bank_branch: '',
  bank_upi: '',
};

const COLOR_THEME_STORAGE_KEY = "axein_color_theme";

// ---- Trial status types ----
type LicenseStatus =
  | { mode: 'active'; license?: Record<string, any> }
  | { mode: 'trial'; trial_expires_at: string }
  | { mode: 'inactive'; reason?: string };

function formatISTDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function formatCountdown(msLeft: number) {
  if (msLeft <= 0) return 'Expired';
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function normalizeStatus(raw: any): LicenseStatus | null {
  if (!raw || typeof raw !== 'object') return null;

  const mode = raw.mode || raw.status || raw.state;

  const trialExpires =
    raw.trial_expires_at ||
    raw.trialExpiry ||
    raw.trial_expiry ||
    (raw.trial && (raw.trial.expires_at || raw.trial.expiresAt));

  if (mode === 'trial' || raw.is_trial === true || raw.trial === true || raw.trialActive === true) {
    if (trialExpires) return { mode: 'trial', trial_expires_at: String(trialExpires) };
    return { mode: 'trial', trial_expires_at: new Date(Date.now() + 7 * 864e5).toISOString() };
  }

  if (mode === 'active' || raw.active === true || raw.is_active === true || raw.isLicensed === true) {
    return { mode: 'active', license: raw.license || raw.data || undefined };
  }

  const reason =
    raw.reason ||
    raw.message ||
    (typeof mode === 'string' && mode !== 'inactive' ? String(mode) : undefined);
  return { mode: 'inactive', reason };
}

export default function SettingsPage() {
  const { mode, setTheme, uiScale, setUiScale, resetZoom } = useTheme();
  const [form, setForm] = useState<Business>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Backup/Restore state
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [dlProgress, setDlProgress] = useState<number | null>(null); // null=idle, -1=indeterminate, 0..100
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreReport, setRestoreReport] = useState<any | null>(null);

  // License status
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);

  // Invoice defaults
  const [invNotes, setInvNotes] = useState("");
  const [invTerms, setInvTerms] = useState("");
  const [savingInvDef, setSavingInvDef] = useState(false);
  const [okInvDef, setOkInvDef] = useState(false);

  // Logo upload state
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [colorTheme, setColorTheme] = useState<ColorTheme>("blue");
  const previewSrc = (() => {
    if (!form.logo_url) return "";
    if (typeof window === "undefined") return form.logo_url;
    try {
      return new URL(form.logo_url, window.location.origin).toString();
    } catch {
      return form.logo_url;
    }
  })();

  function applyColorTheme(nextTheme: ColorTheme) {
    if (typeof window === "undefined") return;
    document.documentElement.setAttribute("data-color-theme", nextTheme);
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, nextTheme);
  }

  // Load business settings
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await fetch('/api/settings', { cache: 'no-store' });
        const j = await r.json();
        setForm({ ...DEFAULTS, ...(j || {}) });
      } catch (e) {
        console.error(e);
        setError('Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    const normalized: ColorTheme =
      saved === "green" || saved === "amber" || saved === "rose" || saved === "blue" ||
      saved === "purple" || saved === "slate" || saved === "orange" || saved === "console"
        ? saved
        : "blue";
    setColorTheme(normalized);
    document.documentElement.setAttribute("data-color-theme", normalized);
  }, []);

  // Reset preview error when URL changes
  useEffect(() => {
    setLogoPreviewError(false);
  }, [form.logo_url]);

  // Load invoice defaults
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/settings?key=invoice_defaults', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (typeof j?.notes_default === 'string') setInvNotes(j.notes_default);
        if (typeof j?.terms_default === 'string') setInvTerms(j.terms_default);
      } catch { /* ignore */ }
    })();
  }, []);

  // License/trial status
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/license/status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const norm = normalizeStatus(data);
        setLicenseStatus(norm);
      } catch { /* ignore */ }
    })();
  }, []);
  useEffect(() => {
    if (!licenseStatus || licenseStatus.mode !== 'trial') return;
    const expiryISO = licenseStatus.trial_expires_at;
    const tick = () => {
      const now = Date.now();
      const end = new Date(expiryISO).getTime();
      setCountdown(formatCountdown(end - now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [licenseStatus]);

  function update<K extends keyof Business>(key: K, value: Business[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave() {
    try {
      setSaving(true);
      setOk(false);
      setError(null);
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error('Save failed');
      setOk(true);
    } catch (e) {
      console.error(e);
      setError('Failed to save settings');
    } finally {
      setSaving(false);
      setTimeout(() => setOk(false), 2000);
    }
  }

  // ---------- Logo upload (multipart -> /api/uploads/logo -> { url }) ----------
  function openLogoPicker() {
    logoInputRef.current?.click();
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);

    // Basic validations
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setLogoError('Please upload a PNG, JPG, or WebP image.');
      e.target.value = '';
      return;
    }
    const MAX_MB = 2;
    if (file.size > MAX_MB * 1024 * 1024) {
      setLogoError(`Max size is ${MAX_MB} MB.`);
      e.target.value = '';
      return;
    }

    // Upload
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/uploads/logo', { method: 'POST', body: fd });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(t || 'Upload failed');
      }
      const data = await res.json().catch(() => ({}));
      const url = String(data?.url || '');
      if (!url) throw new Error('Upload response missing url');

      // Set in form (bust cache for preview only)
      update('logo_url', url);
    } catch (err: any) {
      setLogoError(err?.message || 'Upload failed');
    } finally {
      setLogoBusy(false);
      e.target.value = '';
    }
  }

  function clearLogo() {
    // This only clears the setting; it does not delete the file on disk.
    update('logo_url', '');
  }

  // ---------- Backup (ZIP) ----------
  async function runBackup() {
    try {
      setBackupBusy(true);
      setBackupMsg(null);
      setDlProgress(-1); // start as indeterminate

      const res = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin': '1',
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Backup failed');

      const total = Number(res.headers.get('Content-Length') || 0);
      if (total > 0) setDlProgress(0);

      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      if (!reader) {
        const blob = await res.blob();
        triggerDownload(blob, res);
        setBackupMsg('✅ Backup downloaded.');
        setDlProgress(null);
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (total > 0) setDlProgress(Math.min(100, Math.round((received / total) * 100)));
        }
      }

      // Merge chunks
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) { merged.set(c, offset); offset += c.length; }

      const blob = new Blob([merged.buffer], { type: 'application/zip' });
      triggerDownload(blob, res);
      setBackupMsg('✅ Backup downloaded. Check your Downloads folder.');
    } catch (e: any) {
      setBackupMsg(`❌ ${e.message || 'Backup failed'}`);
    } finally {
      setBackupBusy(false);
      setTimeout(() => setDlProgress(null), 800);
    }
  }

  function triggerDownload(blob: Blob, res: Response) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="(.+?)"/);
    a.href = url;
    a.download = m?.[1] || 'axein-backup.zip';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Save invoice defaults
  async function saveInvoiceDefaults() {
    try {
      setSavingInvDef(true);
      setOkInvDef(false);
      const r = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'invoice_defaults',
          value_json: { notes_default: invNotes, terms_default: invTerms },
        }),
      });
      if (!r.ok) throw new Error('Save failed');
      setOkInvDef(true);
      setTimeout(() => setOkInvDef(false), 2000);
    } catch (e) {
      alert((e as Error).message || 'Failed to save defaults');
    } finally {
      setSavingInvDef(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="card" style={{ padding: 16 }}>
          Loading settings…
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link className="btn" href="/profile/settings/invoice-fields">Invoice Custom Fields</Link>
      </div>

      {licenseStatus && (
        <div
          className={[
            "rounded-2xl border p-4 shadow-sm",
            licenseStatus.mode === 'trial'
              ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700/40"
              : licenseStatus.mode === 'active'
              ? "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/40"
              : "bg-rose-50 border-rose-200 dark:bg-rose-900/20 dark:border-rose-700/40",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              {licenseStatus.mode === 'trial' && (
                <>
                  <div className="font-semibold">
                    Your 7-day trial is active until {formatISTDateTime(licenseStatus.trial_expires_at)}
                  </div>
                  <div className="text-sm opacity-80">
                    Time remaining:{" "}
                    <span className="tabular-nums font-medium">{countdown ?? '—'}</span>
                  </div>
                </>
              )}
              {licenseStatus.mode === 'active' && (
                <div className="font-semibold">License active ✅</div>
              )}
              {licenseStatus.mode === 'inactive' && (
                <div className="font-semibold">
                  License inactive ❌{licenseStatus.reason ? ` — ${licenseStatus.reason}` : ''}
                </div>
              )}
            </div>
            <div className="text-xs opacity-60">
              mode: <code>{licenseStatus.mode}</code>
            </div>
          </div>
        </div>
      )}

      <section className="card" style={{ padding: 16 }}>
        <h2 className="mb-3 text-lg font-semibold">Appearance</h2>
        <p className="mb-3 text-sm opacity-80">
          Choose UI mode and color preset for backgrounds, controls, and navigation accents.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <label>
            <div className="muted">UI Mode</div>
            <select
              className="input"
              value={mode}
              onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </label>
          <label>
            <div className="muted">Color Preset</div>
            <select
              className="input"
              value={colorTheme}
              onChange={(e) => {
                const next = e.target.value as ColorTheme;
                setColorTheme(next);
                applyColorTheme(next);
              }}
            >
              <option value="blue">Blue (Default)</option>
              <option value="green">Green</option>
              <option value="amber">Amber</option>
              <option value="rose">Rose</option>
              <option value="purple">Purple</option>
              <option value="slate">Grey</option>
              <option value="orange">Orange</option>
              <option value="console">Vintage Console</option>
            </select>
          </label>
          <label>
            <div className="muted">UI Scale</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                className="input"
                style={{ padding: 0, height: 36 }}
                type="range"
                min={0.85}
                max={1.35}
                step={0.05}
                value={uiScale}
                onChange={(e) => setUiScale(Number(e.target.value || 1))}
              />
              <div className="tabular-nums" style={{ minWidth: 56 }}>
                {Math.round(uiScale * 100)}%
              </div>
              <button className="btn" type="button" onClick={resetZoom}>
                Reset
              </button>
            </div>
          </label>
        </div>
      </section>

      {/* Business Settings */}
      <section className="card" style={{ padding: 16 }}>
        <h2 className="mb-4 text-lg font-semibold">Business Profile</h2>

        {error && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800/40 dark:bg-amber-900/20">
            {error}
          </div>
        )}
        {ok && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-800/40 dark:bg-emerald-900/20">
            Saved!
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input className="input" placeholder="Business Name"
                 value={form.name} onChange={e => update('name', e.target.value)} />
          <input className="input" placeholder="Legal Business Name"
                 value={form.legal_name || ""} onChange={e => update('legal_name', e.target.value)} />
          <input className="input" placeholder="Phone"
                 value={form.phone} onChange={e => update('phone', e.target.value)} />
          <input className="input" type="email" placeholder="Business Email"
                 value={form.email || ""} onChange={e => update('email', e.target.value)} />
          <input className="input" placeholder="Website"
                 value={form.website || ""} onChange={e => update('website', e.target.value)} />
          <input className="input" placeholder="GSTIN"
                 value={form.gstin} onChange={e => update('gstin', e.target.value)} />
          <input className="input" placeholder="PAN"
                 value={form.pan || ""} onChange={e => update('pan', e.target.value)} />
          <input className="input" placeholder="Invoice Prefix (e.g., INV)"
                 value={form.invoice_prefix} onChange={e => update('invoice_prefix', e.target.value)} />
          <input className="input" placeholder="Quotation Prefix (e.g., QUO)"
                 value={form.quotation_prefix || ""} onChange={e => update('quotation_prefix', e.target.value)} />
          <input className="input" placeholder="Purchase Prefix (e.g., PUR)"
                 value={form.purchase_prefix || ""} onChange={e => update('purchase_prefix', e.target.value)} />
          <input className="input" placeholder="Job Card Prefix (e.g., JOB)"
                 value={form.job_card_prefix || ""} onChange={e => update('job_card_prefix', e.target.value)} />
          <input className="input" placeholder="State Code (e.g., 27)"
                 value={form.state_code} onChange={e => update('state_code', e.target.value)} />
          <select className="input" value={form.currency || "INR"} onChange={e => update('currency', e.target.value)}>
            <option value="INR">INR - Indian Rupee</option>
            <option value="USD">USD - US Dollar</option>
            <option value="AED">AED - UAE Dirham</option>
          </select>
          <select className="input" value={form.timezone || "Asia/Kolkata"} onChange={e => update('timezone', e.target.value)}>
            <option value="Asia/Kolkata">Asia/Kolkata</option>
            <option value="Asia/Dubai">Asia/Dubai</option>
            <option value="UTC">UTC</option>
          </select>
          <select className="input" value={form.date_format || "DD/MM/YYYY"} onChange={e => update('date_format', e.target.value)}>
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
          <input className="input" placeholder="Signature Image URL"
                 value={form.signature_image_url} onChange={e => update('signature_image_url', e.target.value)} />
          <input className="input" placeholder="Signature Name"
                 value={form.signature_name} onChange={e => update('signature_name', e.target.value)} />
          <input className="input" placeholder="Signature Title"
                 value={form.signature_title} onChange={e => update('signature_title', e.target.value)} />

          {/* Company Logo Uploader */}
          <div className="md:col-span-2">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-sm font-medium mb-1">Company Logo</div>
                <div className="text-xs opacity-70 mb-2">
                  PNG, JPG, or WebP • up to 2&nbsp;MB. Recommended size: <b>400×120px</b> (or ~3:1).
                  The invoice renders logos at ~48px height, so use a clean, high‑contrast logo.
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn"
                    onClick={openLogoPicker}
                    disabled={logoBusy}
                    aria-busy={logoBusy}
                  >
                    {logoBusy ? 'Uploading…' : (form.logo_url ? 'Replace Logo' : 'Upload Logo')}
                  </button>
                  {form.logo_url ? (
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={clearLogo}
                      disabled={logoBusy}
                      title="Clears the saved logo URL (does not delete uploaded file)"
                    >
                      Remove Logo
                    </button>
                  ) : null}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleLogoChange}
                  />
                </div>

                {logoError && (
                  <div className="mt-2 text-sm text-red-600">{logoError}</div>
                )}

                {form.logo_url ? (
                  <div className="mt-3">
                    <div className="text-xs opacity-70 mb-1">Preview</div>
                    <div
                      className="rounded-xl border p-3 inline-flex items-center justify-center"
                      style={{ minHeight: 80, minWidth: 180, background: "var(--glass-bg)", borderColor: "var(--glass-brd)" }}
                    >
                      {/* Using <img> deliberately so the same URL works in server-side PDF rendering */}
                      {!logoPreviewError ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewSrc}
                            alt="Company Logo"
                            onError={() => setLogoPreviewError(true)}
                            style={{
                              maxHeight: 64, // preview; PDF will use ~48px max
                              maxWidth: 260,
                              objectFit: 'contain',
                            }}
                          />
                        </>
                      ) : (
                        <div className="text-xs muted">Preview unavailable. Check the logo URL.</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <textarea className="input md:col-span-2" placeholder="Address" style={{ minHeight: 80 }}
                    value={form.address} onChange={e => update('address', e.target.value)} />

          <div className="md:col-span-2 mt-2 text-sm font-semibold">Bank Details (printed on invoice)</div>
          <input className="input" placeholder="Bank Name"
                 value={form.bank_name || ""} onChange={e => update('bank_name', e.target.value)} />
          <input className="input" placeholder="Branch"
                 value={form.bank_branch || ""} onChange={e => update('bank_branch', e.target.value)} />
          <input className="input" placeholder="Account Name"
                 value={form.bank_account_name || ""} onChange={e => update('bank_account_name', e.target.value)} />
          <input className="input" placeholder="Account Number"
                 value={form.bank_account_number || ""} onChange={e => update('bank_account_number', e.target.value)} />
          <input className="input" placeholder="IFSC Code"
                 value={form.bank_ifsc || ""} onChange={e => update('bank_ifsc', e.target.value)} />
          <input className="input" placeholder="UPI ID (optional)"
                 value={form.bank_upi || ""} onChange={e => update('bank_upi', e.target.value)} />
        </div>

        <div className="mt-3 flex gap-2">
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <Link href="/">Back to Home</Link>
        </div>
      </section>

      {/* Invoice Defaults */}
      <section className="card" style={{ padding: 16 }}>
        <h2 className="mb-3 text-lg font-semibold">Invoice Defaults</h2>
        {okInvDef && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-800/40 dark:bg-emerald-900/20">
            Saved!
          </div>
        )}
        <div className="grid grid-cols-1 gap-3">
          <textarea className="input" placeholder="Default Notes"
                    style={{ minHeight: 80 }}
                    value={invNotes} onChange={e => setInvNotes(e.target.value)} />
          <textarea className="input" placeholder="Default Terms & Conditions"
                    style={{ minHeight: 110 }}
                    value={invTerms} onChange={e => setInvTerms(e.target.value)} />
        </div>
        <div className="mt-3 flex gap-2">
          <button className="btn btn-primary" onClick={saveInvoiceDefaults} disabled={savingInvDef}>
            {savingInvDef ? 'Saving…' : 'Save Invoice Defaults'}
          </button>
          <span className="text-xs opacity-70">Quick Billing will prefill these, but you can edit per invoice.</span>
        </div>
      </section>

      {/* Activation & Trial */}
      <section className="card" style={{ padding: 0 }}>
        <div className="flex items-center justify-between border-b p-4" style={{ borderColor: "var(--glass-brd)" }}>
          <h2 className="text-lg font-semibold">Activation & Extend License</h2>
          <span className="text-xs opacity-70">Paste a new key to renew/upgrade seats or validity</span>
        </div>
        <Suspense fallback={<div className="p-6 text-sm opacity-70">Loading…</div>}>
          <LicensePanel redirectOnActive={false} redirectAfterSuccess={false} />
        </Suspense>
      </section>

      {/* Template reset */}
      <section className="card" style={{ padding: 16 }}>
        <h2 className="text-lg font-semibold">Setup Wizard</h2>
        <p className="mt-1 text-sm opacity-80">
          Re-run the setup wizard to review activation and update template/navigation defaults. License stays intact.
        </p>
        <div className="mt-3">
          <Link className="btn btn-primary" href="/activate">Open Setup Wizard</Link>
        </div>
      </section>

      {/* Backup & Restore */}
      <section className="card" style={{ padding: 16 }}>
        <h2 className="text-lg font-semibold">Admin • Backups</h2>
        <p className="mt-1 text-sm opacity-80">
          Download a <strong>.zip</strong> archive (no password).<br />
          <strong>Restore behavior:</strong> records are <em>upserted</em> — existing rows with the same <code>id</code>/<code>key</code> are overwritten; missing rows are not deleted.
        </p>

        <div className="mt-3 flex gap-2">
          <button className="btn btn-primary" onClick={runBackup} disabled={backupBusy}>
            {backupBusy ? 'Preparing…' : 'Download Backup (.zip)'}
          </button>
        </div>

        {/* Progress bar */}
        {dlProgress !== null && (
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-2 transition-[width] duration-150"
                style={{
                  width: dlProgress < 0 ? '100%' : `${dlProgress}%`,
                  background: 'var(--progress, #3b82f6)',
                  animation: dlProgress < 0 ? 'indet 1s linear infinite' as any : undefined,
                }}
              />
            </div>
            <div className="mt-1 text-xs opacity-70">
              {dlProgress < 0 ? 'Packaging backup…' : `${dlProgress}%`}
            </div>
            <style>{`@keyframes indet { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }`}</style>
          </div>
        )}

        <h3 className="mt-5 text-base font-semibold">Restore from Backup (.zip)</h3>
        <ol className="mt-1 list-decimal pl-5 text-sm opacity-80">
          <li>Select the backup <strong>.zip</strong> file</li>
          <li>Click <strong>Validate</strong> to inspect contents</li>
          <li>Click <strong>Apply Restore</strong> to upsert records</li>
        </ol>

        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          className="input mt-2"
        />
        <div className="mt-2 flex gap-2">
          <button
            className="btn"
            onClick={async () => {
              const f = fileRef.current?.files?.[0];
              if (!f) return alert('Choose a .zip file first');
              if (!f.name.endsWith('.zip')) return alert('Selected file is not a .zip archive');
              try {
                const ab = await f.arrayBuffer();
                const res = await fetch('/api/admin/restore?apply=false', {
                  method: 'POST',
                  headers: { 'x-admin': '1', 'Content-Type': 'application/zip' },
                  body: ab,
                });
                const text = await res.text();
                if (!res.ok) throw new Error(text);
                const data = JSON.parse(text);
                setRestoreReport(data.report);
                setBackupMsg('✅ Backup validated. Review the report, then click Apply.');
              } catch (e: any) {
                setBackupMsg(`❌ ${e.message || 'Validation failed'}`);
              }
            }}
          >
            Validate
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const f = fileRef.current?.files?.[0];
              if (!f) return alert('Choose a .zip file first');
              if (!f.name.endsWith('.zip')) return alert('Selected file is not a .zip archive');
              try {
                const ab = await f.arrayBuffer();
                const res = await fetch('/api/admin/restore?apply=true', {
                  method: 'POST',
                  headers: { 'x-admin': '1', 'Content-Type': 'application/zip' },
                  body: ab,
                });
                const text = await res.text();
                if (!res.ok) throw new Error(text);
                setBackupMsg('✅ Restore completed.');
              } catch (e: any) {
                setBackupMsg(`❌ ${e.message || 'Restore failed'}`);
              }
            }}
          >
            Apply Restore
          </button>
        </div>

        {restoreReport && (
          <div className="mt-3 text-sm">
            <div className="opacity-70">Validation report:</div>
            <ul className="ml-5 list-disc">
              <li>manifest.json: {restoreReport.hasManifest ? '✅' : '❌'}</li>
              <li>db/customers.csv: {restoreReport.hasCustomers ? '✅' : '❌'}</li>
              <li>db/categories.csv: {restoreReport.hasCategories ? '✅' : '❌'}</li>
              <li>db/products.csv: {restoreReport.hasProducts ? '✅' : '❌'}</li>
              <li>db/suppliers.csv: {restoreReport.hasSuppliers ? '✅' : '❌'}</li>
              <li>db/purchases.csv: {restoreReport.hasPurchases ? '✅' : '❌'}</li>
              <li>db/purchase_items.csv: {restoreReport.hasPurchaseItems ? '✅' : '❌'}</li>
              <li>db/quotations.csv: {restoreReport.hasQuotations ? '✅' : '❌'}</li>
              <li>db/quotation_items.csv: {restoreReport.hasQuotationItems ? '✅' : '❌'}</li>
              <li>db/sales.csv: {restoreReport.hasSales ? '✅' : '❌'}</li>
              <li>db/sale_items.csv: {restoreReport.hasSaleItems ? '✅' : '❌'}</li>
              <li>db/product_batches.csv: {restoreReport.hasBatches ? '✅' : '❌'}</li>
              <li>db/stock_movements.csv: {restoreReport.hasMovements ? '✅' : '❌'}</li>
              <li>db/inventory_adjustments.csv: {restoreReport.hasAdjustments ? '✅' : '❌'}</li>
              <li>db/inventory_adjustment_items.csv: {restoreReport.hasAdjustmentItems ? '✅' : '❌'}</li>
              <li>db/notifications.csv: {restoreReport.hasNotifications ? '✅' : '❌'}</li>
              <li>db/settings.json: {restoreReport.hasSettings ? '✅' : '❌'}</li>
              <li>invoice PDFs: {restoreReport.invoicesPdfCount}</li>
            </ul>
          </div>
        )}

        {backupMsg && <div className="mt-3 text-sm">{backupMsg}</div>}
      </section>
    </main>
  );
}
