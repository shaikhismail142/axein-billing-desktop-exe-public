"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CustomFieldAppliesTo,
  CustomFieldDataType,
  normalizeCustomFieldConfig,
} from "@/app/lib/custom-fields";

type InvoiceField = {
  id: number;
  field_key: string;
  label: string;
  data_type: CustomFieldDataType;
  required: boolean;
  visible: boolean;
  position: number;
  applies_to: CustomFieldAppliesTo;
  config_json?: Record<string, unknown> | null;
};

type DraftField = {
  id?: number;
  field_key: string;
  label: string;
  data_type: CustomFieldDataType;
  required: boolean;
  visible: boolean;
  position: number;
  applies_to: CustomFieldAppliesTo;
  options_text: string;
};

const emptyDraft: DraftField = {
  field_key: "",
  label: "",
  data_type: "text",
  required: false,
  visible: true,
  position: 100,
  applies_to: "invoice",
  options_text: "",
};

function normalizeFieldKey(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function parseOptionsText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function optionsTextFromConfig(config: Record<string, unknown> | null | undefined): string {
  if (!config || typeof config !== "object") return "";
  const options = Array.isArray(config.options) ? config.options : [];
  return options
    .map((row) => {
      if (typeof row === "string") return row.trim();
      if (row && typeof row === "object") {
        const item = row as Record<string, unknown>;
        return String(item.label ?? item.value ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildConfig(dataType: CustomFieldDataType, optionsText: string) {
  const options = parseOptionsText(optionsText);
  const base: Record<string, unknown> = {};
  if (dataType === "dropdown" || dataType === "radio") {
    base.options = options.map((opt) => ({ label: opt, value: opt }));
  }
  return normalizeCustomFieldConfig(dataType, base);
}

export default function InvoiceFieldSettingsPage() {
  const [items, setItems] = useState<InvoiceField[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftField>(emptyDraft);
  const [rowOptionsText, setRowOptionsText] = useState<Record<number, string>>({});

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/invoice-custom-fields?applies_to=all", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load custom fields");
      const next = (Array.isArray(data?.items) ? data.items : []) as InvoiceField[];
      setItems(next);
      const nextOptions: Record<number, string> = {};
      for (const row of next) {
        nextOptions[row.id] = optionsTextFromConfig(row.config_json);
      }
      setRowOptionsText(nextOptions);
    } catch (e: any) {
      setError(String(e?.message || "Failed to load custom fields"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          String(a.applies_to).localeCompare(String(b.applies_to)) ||
          Number(a.position || 0) - Number(b.position || 0) ||
          a.id - b.id
      ),
    [items]
  );

  async function createField() {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const payload = {
        ...draft,
        field_key: normalizeFieldKey(draft.field_key),
        config_json: buildConfig(draft.data_type, draft.options_text),
      };
      if (!payload.field_key || !payload.label.trim()) {
        throw new Error("Field key and label are required");
      }

      if (
        (payload.data_type === "dropdown" || payload.data_type === "radio") &&
        !Array.isArray((payload.config_json as any).options)
      ) {
        throw new Error("Provide options for dropdown/radio (one option per line).");
      }

      const res = await fetch("/api/settings/invoice-custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create custom field");

      setDraft(emptyDraft);
      setOk(`Field saved: ${payload.field_key}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to create custom field"));
    } finally {
      setSaving(false);
    }
  }

  async function saveRow(row: InvoiceField) {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const optionsText = rowOptionsText[row.id] || "";
      const configJson = buildConfig(row.data_type, optionsText);
      const res = await fetch("/api/settings/invoice-custom-fields", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin": "1" },
        body: JSON.stringify({
          id: row.id,
          label: row.label,
          data_type: row.data_type,
          required: row.required,
          visible: row.visible,
          position: row.position,
          applies_to: row.applies_to,
          config_json: configJson,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update custom field");
      setOk(`Field updated: ${row.field_key}`);
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to update custom field"));
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(id: number) {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/settings/invoice-custom-fields?id=${id}`, {
        method: "DELETE",
        headers: { "x-admin": "1" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to remove custom field");
      setOk("Custom field removed");
      await load();
    } catch (e: any) {
      setError(String(e?.message || "Failed to remove custom field"));
    } finally {
      setSaving(false);
    }
  }

  function updateRow(id: number, patch: Partial<InvoiceField>) {
    setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>Document Custom Fields</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Add smart fields for invoices, quotations, purchases, and products. Use type{" "}
          <b>Price</b> or <b>Tax %</b> for auto calculation in billing.
        </p>
        <div style={{ marginTop: 8 }}>
          <Link className="btn" href="/profile/settings">
            Back to Settings
          </Link>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Add Field</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
          <label>
            <div className="muted">Field Key</div>
            <input
              className="input"
              placeholder="e.g. service_type"
              value={draft.field_key}
              onChange={(e) => setDraft((s) => ({ ...s, field_key: e.target.value }))}
            />
          </label>
          <label>
            <div className="muted">Label</div>
            <input
              className="input"
              placeholder="Service Type"
              value={draft.label}
              onChange={(e) => setDraft((s) => ({ ...s, label: e.target.value }))}
            />
          </label>
          <label>
            <div className="muted">Applies To</div>
            <select
              className="input"
              value={draft.applies_to}
              onChange={(e) => setDraft((s) => ({ ...s, applies_to: e.target.value as CustomFieldAppliesTo }))}
            >
              <option value="invoice">Invoice</option>
              <option value="quotation">Quotation</option>
              <option value="purchase">Purchase</option>
              <option value="product">Product</option>
            </select>
          </label>
          <label>
            <div className="muted">Type</div>
            <select
              className="input"
              value={draft.data_type}
              onChange={(e) => setDraft((s) => ({ ...s, data_type: e.target.value as CustomFieldDataType }))}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="dropdown">Dropdown</option>
              <option value="radio">Radio</option>
              <option value="price">Price (adds amount)</option>
              <option value="tax_percent">Tax % (adds calculated tax)</option>
            </select>
          </label>
          <label>
            <div className="muted">Position</div>
            <input
              className="input"
              type="number"
              min={1}
              value={draft.position}
              onChange={(e) => setDraft((s) => ({ ...s, position: Number(e.target.value) || 100 }))}
            />
          </label>
        </div>
        {draft.data_type === "dropdown" || draft.data_type === "radio" ? (
          <label style={{ display: "block", marginTop: 10 }}>
            <div className="muted">Options (one per line)</div>
            <textarea
              className="input"
              rows={4}
              value={draft.options_text}
              onChange={(e) => setDraft((s) => ({ ...s, options_text: e.target.value }))}
              placeholder={"Option 1\nOption 2\nOption 3"}
            />
          </label>
        ) : null}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={draft.required}
              onChange={(e) => setDraft((s) => ({ ...s, required: e.target.checked }))}
            />
            Required
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={draft.visible}
              onChange={(e) => setDraft((s) => ({ ...s, visible: e.target.checked }))}
            />
            Visible
          </label>
          <button className="btn" disabled={saving} onClick={createField}>
            {saving ? "Saving..." : "Add Field"}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Configured Fields</h3>
          <button className="btn" disabled={busy || saving} onClick={load}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error ? <div style={{ marginTop: 8, color: "var(--danger)" }}>{error}</div> : null}
        {ok ? <div style={{ marginTop: 8, color: "var(--success)" }}>{ok}</div> : null}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Scope</th>
                <th>Type</th>
                <th>Options</th>
                <th>Pos</th>
                <th>Required</th>
                <th>Visible</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const showOptions = row.data_type === "dropdown" || row.data_type === "radio";
                return (
                  <tr key={row.id}>
                    <td>{row.field_key}</td>
                    <td>
                      <input
                        className="input"
                        value={row.label}
                        onChange={(e) => updateRow(row.id, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={row.applies_to}
                        onChange={(e) =>
                          updateRow(row.id, { applies_to: e.target.value as CustomFieldAppliesTo })
                        }
                      >
                        <option value="invoice">Invoice</option>
                        <option value="quotation">Quotation</option>
                        <option value="purchase">Purchase</option>
                        <option value="product">Product</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="input"
                        value={row.data_type}
                        onChange={(e) => updateRow(row.id, { data_type: e.target.value as CustomFieldDataType })}
                      >
                        <option value="text">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="dropdown">Dropdown</option>
                        <option value="radio">Radio</option>
                        <option value="price">Price</option>
                        <option value="tax_percent">Tax %</option>
                      </select>
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {showOptions ? (
                        <textarea
                          className="input"
                          rows={3}
                          value={rowOptionsText[row.id] || ""}
                          onChange={(e) =>
                            setRowOptionsText((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          placeholder={"Option 1\nOption 2"}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        value={row.position}
                        onChange={(e) => updateRow(row.id, { position: Number(e.target.value) || row.position })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(e) => updateRow(row.id, { required: e.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.visible}
                        onChange={(e) => updateRow(row.id, { visible: e.target.checked })}
                      />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn" disabled={saving} onClick={() => saveRow(row)}>
                          Save
                        </button>
                        <button className="btn" disabled={saving} onClick={() => removeRow(row.id)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="muted">
                    No custom fields configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
