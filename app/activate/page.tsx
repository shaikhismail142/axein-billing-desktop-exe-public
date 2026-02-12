// app/activate/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BUSINESS_TYPES } from "../register-business/_constants";

type Status = {
  isLicensed: boolean;
  trialActive: boolean;
  daysLeft: number | null;
  expiresAt: string | null;
  canStartTrial: boolean;
  deviceId: string;
};

const defaultBusiness = {
  business_name: "",
  business_type: "general_store",
  user_limit: 5,
  computer_limit: 1,
  usage_mode: "standalone" as "standalone" | "lan_host",
  owner_name: "",
  owner_email: "",
  owner_password: "",
};

const steps = ["License", "Business", "Template", "Finish"] as const;

export default function ActivateWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState<typeof steps[number]>("License");
  const [status, setStatus] = useState<Status | null>(null);
  const [licenseInput, setLicenseInput] = useState("");
  const [licenseMsg, setLicenseMsg] = useState<string | null>(null);
  const [licenseErr, setLicenseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [business, setBusiness] = useState(defaultBusiness);
  const [businessErr, setBusinessErr] = useState<string | null>(null);
  const [businessOk, setBusinessOk] = useState<string | null>(null);

  const [templateKey, setTemplateKey] = useState("auto");

  useEffect(() => {
    refreshStatus();
  }, []);

  async function refreshStatus() {
    try {
      const res = await fetch("/api/license/status", { cache: "no-store" });
      const j = await res.json();
      setStatus({
        isLicensed: !!j?.isLicensed,
        trialActive: !!j?.trialActive,
        daysLeft: j?.daysLeft ?? null,
        expiresAt: j?.expiresAt ?? null,
        canStartTrial: j?.canStartTrial !== false,
        deviceId: j?.deviceId || j?.status?.deviceId || "unknown-device",
      });
      if (j?.isLicensed || j?.trialActive) {
        setStep("Business");
      }
    } catch {
      // ignore
    }
  }

  async function startTrial() {
    setBusy(true);
    setLicenseErr(null);
    setLicenseMsg(null);
    try {
      const res = await fetch("/api/license/start-trial", {
        method: "POST",
        headers: { "x-admin": "1" },
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Trial start failed");
      setLicenseMsg("Trial started.");
      await refreshStatus();
      setStep("Business");
    } catch (e: any) {
      setLicenseErr(String(e?.message || "Trial failed"));
    } finally {
      setBusy(false);
    }
  }

  async function verifyLicense() {
    setBusy(true);
    setLicenseErr(null);
    setLicenseMsg(null);
    try {
      const body =
        licenseInput.trim().startsWith("{") || licenseInput.trim().startsWith("L-")
          ? { token: licenseInput.trim() }
          : { license_key: licenseInput.trim() };
      const res = await fetch("/api/license/verify-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "License verification failed");
      setLicenseMsg("License activated.");
      await refreshStatus();
      setStep("Business");
    } catch (e: any) {
      setLicenseErr(String(e?.message || "License verification failed"));
    } finally {
      setBusy(false);
    }
  }

  function nextStep(target?: typeof steps[number]) {
    const currentIndex = steps.indexOf(step);
    const next = target ?? steps[Math.min(currentIndex + 1, steps.length - 1)];
    setStep(next);
  }

  function prevStep() {
    const currentIndex = steps.indexOf(step);
    setStep(steps[Math.max(0, currentIndex - 1)]);
  }

  async function saveBusiness() {
    setBusy(true);
    setBusinessErr(null);
    setBusinessOk(null);
    try {
      const res = await fetch("/api/onboarding/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: business.business_name,
          business_type: business.business_type,
          user_limit: business.user_limit,
          computer_limit: business.computer_limit,
          usage_mode: business.usage_mode,
          owner: {
            full_name: business.owner_name,
            email: business.owner_email,
            password: business.owner_password,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Business registration failed");
      setBusinessOk(`Registered: ${j?.business?.name || "Success"}`);
      setStep("Template");
    } catch (e: any) {
      setBusinessErr(String(e?.message || "Business registration failed"));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    router.replace("/dashboard");
  }

  const progress = useMemo(() => {
    const idx = steps.indexOf(step);
    return ((idx + 1) / steps.length) * 100;
  }, [step]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">AxEin Billing Setup</h1>
          <p className="text-sm text-slate-600">Follow the wizard to activate, register your business, and start billing.</p>
        </div>
        <Link href="/" className="text-sm underline text-slate-600">Skip to app (if already active)</Link>
      </div>

      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <WizardHeader step={step} onPrev={prevStep} />
        {step === "License" && (
          <LicenseStep
            status={status}
            licenseInput={licenseInput}
            setLicenseInput={setLicenseInput}
            onVerify={verifyLicense}
            onTrial={startTrial}
            busy={busy}
            msg={licenseMsg}
            err={licenseErr}
            deviceId={status?.deviceId}
            onNext={() => nextStep("Business")}
          />
        )}
        {step === "Business" && (
          <BusinessStep
            business={business}
            setBusiness={setBusiness}
            busy={busy}
            err={businessErr}
            ok={businessOk}
            onSave={saveBusiness}
            onBack={prevStep}
          />
        )}
        {step === "Template" && (
          <TemplateStep
            businessType={business.business_type}
            setBusinessType={(v) => setBusiness((s) => ({ ...s, business_type: v }))}
            templateKey={templateKey}
            setTemplateKey={setTemplateKey}
            onNext={() => nextStep("Finish")}
            onBack={prevStep}
          />
        )}
        {step === "Finish" && (
          <FinishStep onDone={finish} onBack={prevStep} />
        )}
      </div>
    </main>
  );
}

function WizardHeader({ step, onPrev }: { step: typeof steps[number]; onPrev: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex gap-2 text-sm text-slate-500">
        {steps.map((s) => (
          <span key={s} className={["px-3 py-1 rounded-full border", s === step ? "border-indigo-500 text-indigo-700" : "border-slate-200"].join(" ")}>
            {s}
          </span>
        ))}
      </div>
      {step !== "License" && (
        <button onClick={onPrev} className="text-sm underline text-slate-600">Back</button>
      )}
    </div>
  );
}

function LicenseStep({
  status,
  licenseInput,
  setLicenseInput,
  onVerify,
  onTrial,
  busy,
  msg,
  err,
  deviceId,
  onNext,
}: any) {
  const canContinue = Boolean(status?.isLicensed || status?.trialActive);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Step 1 of 4 — Enter your license token or start a 7-day trial. Device ID is shown below for support.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-3">
          <label className="text-sm font-medium text-slate-700">License token (L-...) or JSON</label>
          <textarea
            className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed break-words break-all shadow-inner focus:border-indigo-400 focus:outline-none"
            rows={3}
            value={licenseInput}
            onChange={(e) => setLicenseInput(e.target.value)}
            placeholder="Paste license token from staff keygen"
          />
          <div className="flex gap-3">
            <button
              onClick={onVerify}
              disabled={busy || !licenseInput.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-white text-sm font-semibold disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Validate License"}
            </button>
            <button
              onClick={onTrial}
              disabled={busy || status?.trialActive || status?.isLicensed || status?.canStartTrial === false}
              className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-semibold text-amber-700 bg-amber-50 disabled:opacity-60"
            >
              {busy ? "Working…" : status?.trialActive ? "Trial Running" : "Start 7-day Trial"}
            </button>
            <button
              onClick={onNext}
              disabled={!canContinue}
              className="rounded-lg border px-4 py-2 text-sm disabled:opacity-60"
            >
              Continue
            </button>
          </div>
          {msg && <div className="text-sm text-emerald-700">{msg}</div>}
          {err && <div className="text-sm text-rose-700">{err}</div>}
          {status?.trialActive && (
            <div className="text-xs text-slate-600">
              Trial ends: {status?.expiresAt || status?.trialExpiresAt || "—"} • Days left: {status?.daysLeft ?? "—"}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="font-semibold text-slate-700 mb-1">Device ID</div>
          <div className="break-all rounded-lg bg-white p-2 border border-slate-200 text-xs font-mono leading-tight">
            {deviceId || "unknown-device"}
          </div>
          <div className="mt-2 text-xs text-slate-500">Share this with AxEin support for licensing.</div>
        </div>
      </div>
    </div>
  );
}

function BusinessStep({ business, setBusiness, busy, err, ok, onSave, onBack }: any) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Step 2 of 4 — Capture business details and create the first admin.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Input label="Business name" value={business.business_name} onChange={(v: string) => setBusiness((s: any) => ({ ...s, business_name: v }))} />
        <Select
          label="Business type"
          value={business.business_type}
          onChange={(v: string) => setBusiness((s: any) => ({ ...s, business_type: v }))}
          options={BUSINESS_TYPES}
        />
        <Input type="number" label="Users" value={business.user_limit} onChange={(v: string) => setBusiness((s: any) => ({ ...s, user_limit: Number(v) || 1 }))} />
        <Input type="number" label="Computers" value={business.computer_limit} onChange={(v: string) => setBusiness((s: any) => ({ ...s, computer_limit: Number(v) || 1 }))} />
        <Select
          label="Usage mode"
          value={business.usage_mode}
          onChange={(v: string) =>
            setBusiness((s: any) => ({
              ...s,
              usage_mode: v,
              computer_limit: v === "standalone" ? 1 : Math.max(s.computer_limit, 2),
            }))
          }
          options={[
            ["standalone", "Standalone (single PC)"],
            ["lan_host", "Business LAN (host + clients)"],
          ]}
        />
        <Input label="Owner/Admin name" value={business.owner_name} onChange={(v: string) => setBusiness((s: any) => ({ ...s, owner_name: v }))} />
        <Input type="email" label="Owner/Admin email" value={business.owner_email} onChange={(v: string) => setBusiness((s: any) => ({ ...s, owner_email: v }))} />
        <Input type="password" label="Owner/Admin password" value={business.owner_password} onChange={(v: string) => setBusiness((s: any) => ({ ...s, owner_password: v }))} />
      </div>
      {ok && <div className="text-sm text-emerald-700">{ok}</div>}
      {err && <div className="text-sm text-rose-700">{err}</div>}
      <div className="flex gap-3">
        <button onClick={onBack} className="rounded-lg border px-4 py-2 text-sm">Back</button>
        <button onClick={onSave} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-60">
          {busy ? "Saving…" : "Save & Continue"}
        </button>
      </div>
    </div>
  );
}

function TemplateStep({ businessType, setBusinessType, templateKey, setTemplateKey, onNext, onBack }: any) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Step 3 of 4 — Pick template/navigation defaults.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Business type template"
          value={businessType}
          onChange={setBusinessType}
          options={BUSINESS_TYPES}
        />
        <Select
          label="Template variant"
          value={templateKey}
          onChange={setTemplateKey}
          options={[
            ["auto", "Auto (match business type)"],
            ["thermal", "Thermal invoice layout"],
            ["a4", "A4 invoice layout"],
          ]}
        />
      </div>
      <div className="flex gap-3">
        <button onClick={onBack} className="rounded-lg border px-4 py-2 text-sm">Back</button>
        <button onClick={onNext} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">Continue</button>
      </div>
    </div>
  );
}

function FinishStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Step 4 of 4 — You are ready to bill.</p>
      <ul className="text-sm list-disc pl-5 text-slate-700 space-y-1">
        <li>License/trial activated</li>
        <li>Business and template saved</li>
        <li>You can change template later from Profile &gt; Settings</li>
      </ul>
      <div className="flex gap-3">
        <button onClick={onBack} className="rounded-lg border px-4 py-2 text-sm">Back</button>
        <button onClick={onDone} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white">Open Billing</button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: any) {
  return (
    <label className="space-y-1 text-sm">
      <div className="text-slate-700">{label}</div>
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 shadow-inner focus:border-indigo-400 focus:outline-none"
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Select({ label, value, onChange, options }: any) {
  return (
    <label className="space-y-1 text-sm">
      <div className="text-slate-700">{label}</div>
      <select
        className="w-full rounded-lg border border-slate-300 px-3 py-2 shadow-inner focus:border-indigo-400 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt: any) => (
          <option key={opt[0]} value={opt[0]}>
            {opt[1]}
          </option>
        ))}
      </select>
    </label>
  );
}
