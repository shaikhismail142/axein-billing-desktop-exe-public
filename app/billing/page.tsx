'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from "next/link";
import { Plus, RotateCcw, Search, Trash2, UserRound, X } from "lucide-react";
import {
  computeCustomFieldTotals,
  getCustomFieldOptions,
  CustomFieldDataType,
} from "@/app/lib/custom-fields";

type Product = {
  id: number;
  name: string;
  sku?: string;
  gst_slab?: number;
  selling_price?: number;
  price?: number;
  stock_qty?: number;
  low_stock_threshold?: number;
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

type Customer = {
  id: number;
  name: string;
  phone?: string;
  gstin?: string;
};

type Item = {
  product_id?: number;
  name: string;
  gst_slab: number;
  qty: number;
  unit_price: number;
  discount_pct: number;
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

type CustomInvoiceField = {
  id: number;
  field_key: string;
  label: string;
  data_type: CustomFieldDataType;
  required: boolean;
  visible: boolean;
  position: number;
  config_json?: Record<string, unknown> | null;
};

const RESERVED_INVOICE_FIELD_KEYS = new Set(["payment_mode", "customer_phone"]);

function inr(n: number) {
  const amt = (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `INR (Rs/-) ${amt}`;
}

function todayInput(): string {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Billing() {
  // Product search
  const [q, setQ] = useState('');
  const [suggest, setSuggest] = useState<Product[]>([]);

  // Customer search
  const [custQ, setCustQ] = useState('');
  const [custSuggest, setCustSuggest] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState<string>('');

  // Items
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);

  // NEW: per-invoice fields (prefilled from settings)
  const [invoiceDate, setInvoiceDate] = useState<string>(() => todayInput());
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [extraLabel, setExtraLabel] = useState<string>("Service Charge");
  const [extraAmount, setExtraAmount] = useState<number>(0);
  const [customFields, setCustomFields] = useState<CustomInvoiceField[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [hiddenOptionalFields, setHiddenOptionalFields] = useState<Set<string>>(() => new Set());
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(() => new Set());

  // Payment
  const [paymentMode, setPaymentMode] = useState<"paid" | "partial" | "pending">("paid");
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>("");

  // -------- Prefill Notes/Terms from settings ----------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/settings?key=invoice_defaults`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (typeof j?.notes_default === 'string') setNotes(j.notes_default);
        if (typeof j?.terms_default === 'string') setTerms(j.terms_default);
      } catch { /* ignore */ }
    })();
  }, []);

  // -------- Load custom invoice fields ----------
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/settings/invoice-custom-fields?applies_to=invoice&visible=1`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        const list = Array.isArray(j?.items) ? j.items : [];
        setCustomFields(
          list
            .map((row: any) => ({
              id: Number(row.id),
              field_key: String(row.field_key || ""),
              label: String(row.label || ""),
              data_type: String(row.data_type || "text") as CustomFieldDataType,
              required: Boolean(row.required),
              visible: row.visible !== false,
              position: Number(row.position || 100),
              config_json: row.config_json && typeof row.config_json === "object" ? row.config_json : {},
            }))
            .filter(
              (row: CustomInvoiceField) =>
                row.field_key &&
                row.label &&
                !RESERVED_INVOICE_FIELD_KEYS.has(String(row.field_key || "").toLowerCase())
            )
        );
      } catch {
        // Keep billing flow working even when custom-field API is unavailable.
      }
    })();
  }, []);

  // -------- Product search ----------
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setSuggest([]); return; }
      const r = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      setSuggest(j.items || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function addProduct(p: Product) {
    const stock = Number(p.stock_qty ?? 0);
    const low = Number(p.low_stock_threshold ?? 0);
    if (stock <= low) {
      const proceed = confirm(
        stock <= 0
          ? `“${p.name}” appears to be out of stock (stock: ${stock}). Add anyway?`
          : `“${p.name}” is at/under low threshold (stock: ${stock}, low: ${low}). Add anyway?`
      );
      if (!proceed) return;
    }
    const unitPrice = Number(p.selling_price ?? p.price ?? 0);
    setItems((prev) => [...prev, {
      product_id: p.id,
      name: p.name,
      gst_slab: Number(p.gst_slab ?? 18),
      qty: 1,
      unit_price: unitPrice,
      discount_pct: 0,
      category: p.category ?? null,
      hsn_code: p.hsn_code ?? null,
      batch_no: p.batch_no ?? "",
      exp_date: p.exp_date ?? "",
    }]);
    setQ(''); setSuggest([]);
  }

  // -------- Customer search ----------
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!custQ.trim()) { setCustSuggest([]); return; }
      const r = await fetch(`/api/customers?q=${encodeURIComponent(custQ)}`);
      const j = await r.json();
      setCustSuggest(j.items || []);
    }, 250);
    return () => clearTimeout(t);
  }, [custQ]);

  function pickCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustQ(''); setCustSuggest([]);
  }
  function clearCustomer() { setCustomerId(null); setCustomerName(''); }

  // -------- Items helpers ----------
  function updateItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeItem(i: number) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  function hideOptionalField(fieldKey: string) {
    setHiddenOptionalFields((prev) => new Set(prev).add(fieldKey));
    setCustomFieldValues((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }

  function hideOptionalSection(section: string) {
    setHiddenSections((prev) => new Set(prev).add(section));
    if (section === "charge") setExtraAmount(0);
    if (section === "notes") setNotes("");
    if (section === "terms") setTerms("");
  }

  function lineTotals(it: Item) {
    const gross = it.qty * it.unit_price;
    const discount = +(gross * (Number(it.discount_pct || 0) / 100)).toFixed(2);
    const taxable = +(gross - discount).toFixed(2);
    const tax = +((taxable * Number(it.gst_slab || 0)) / 100).toFixed(2);
    const total = +(taxable + tax).toFixed(2);
    return { taxable, tax, total };
  }

  const totals = useMemo(
    () => items.reduce((acc, it) => {
      const t = lineTotals(it);
      acc.taxable += t.taxable; acc.tax += t.tax; acc.total += t.total;
      return acc;
    }, { taxable: 0, tax: 0, total: 0 }),
    [items]
  );

  const customComputed = useMemo(
    () => computeCustomFieldTotals(customFields, customFieldValues, totals.taxable),
    [customFields, customFieldValues, totals.taxable]
  );

  const extra = Math.max(0, Number(extraAmount || 0));
  const customExtraAmount = Number(customComputed.extraAmount || 0);
  const customExtraTaxAmount = Number(customComputed.extraTaxAmount || 0);
  const totalExtraAmount = +(extra + customExtraAmount).toFixed(2);
  const totalTaxAmount = +(totals.tax + customExtraTaxAmount).toFixed(2);
  const grandTotal = +(totals.taxable + totalTaxAmount + totalExtraAmount).toFixed(2);
  const pendingAmount = Math.max(grandTotal - (Number(amountPaid) || 0), 0);

  useEffect(() => {
    if (paymentMode === "paid") setAmountPaid(grandTotal);
    if (paymentMode === "pending") setAmountPaid(0);
  }, [paymentMode, grandTotal]);

  // -------- Save sale ----------
  async function save() {
    if (!items.length) return alert('No items in bill');

    const orderedCustomFields = [...customFields].sort(
      (a, b) => Number(a.position || 0) - Number(b.position || 0) || a.id - b.id
    );
    const customFieldsPayload: Record<string, string> = {};
    for (const field of orderedCustomFields) {
      const raw = customFieldValues[field.field_key];
      const value = raw == null ? "" : String(raw).trim();
      if (field.required && !value) {
        return alert(`Please fill required field: ${field.label}`);
      }
      if (value) customFieldsPayload[field.field_key] = value;
    }
    for (const [k, v] of Object.entries(customComputed.values || {})) {
      if (v != null && String(v).trim()) customFieldsPayload[k] = String(v).trim();
    }

    try {
      setSaving(true);
      const patientName = customFieldsPayload.patient_name || null;
      const doctorName = customFieldsPayload.doctor_name || null;
      const payload = {
        customer_id: customerId,
        customer_name: customerId ? undefined : (customerName || '').trim() || undefined,
        patient_name: patientName,
        doctor_name: doctorName,
        custom_fields: customFieldsPayload,
        invoice_date: invoiceDate ? new Date(`${invoiceDate}T00:00:00`).toISOString() : null,
        notes: (notes || "").trim() || null,
        terms: (terms || "").trim() || null,
        extra_label: (extraLabel || "").trim() || null,
        extra_amount: totalExtraAmount,
        extra_tax_amount: customExtraTaxAmount,
        custom_field_totals: {
          extra_amount: customExtraAmount,
          extra_tax_amount: customExtraTaxAmount,
          taxable_base: customComputed.taxableBase,
        },
        amount_paid: Number(amountPaid || 0),
        payment_method: paymentMethod || null,
        items: items.map((it) => ({
          product_id: it.product_id || null,
          name: it.name,
          gst_slab: Number(it.gst_slab || 0),
          qty: Number(it.qty || 0),
          unit_price: Number(it.unit_price || 0),
          discount_pct: Number(it.discount_pct || 0),
          batch_no: it.batch_no || null,
          exp_date: it.exp_date || null,
        })),
      };
      const r = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const raw = await r.text();
      let j: any = null;
      try { j = raw ? JSON.parse(raw) : null; } catch {}
      if (!r.ok) {
        const msg = j?.detail || j?.error || raw || 'save failed';
        throw new Error(msg);
      }
      if (!j) j = {};
      window.location.href = `/invoices/${j.id}`;
    } catch (e) {
      console.error(e);
      alert(`Failed to save: ${(e as any)?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="quick-billing-workspace">
        <div className="quick-billing-shell">
          <header className="quick-billing-titlebar">
            <div>
              <div className="quick-billing-kicker">Sales counter</div>
              <h1>New Invoice</h1>
              <p>Create the invoice from top to bottom. Optional details can be hidden for faster billing.</p>
            </div>
            <div className="quick-billing-date">
              <label htmlFor="quick-invoice-date">Invoice date</label>
              <input
                id="quick-invoice-date"
                className="input"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
              <span>Backdated invoices are supported.</span>
            </div>
          </header>

        <section className="quick-billing-section quick-customer-section">
          <div className="quick-section-heading">
            <div className="quick-section-icon"><UserRound size={18} /></div>
            <div><h2>Customer details</h2><p>Optional for walk-in sales.</p></div>
          </div>
          <div className="quick-customer-row">
            <div className="quick-field-grow">
              <label htmlFor="quick-customer-name">Customer name <span>(optional)</span></label>
              <div style={{ position: 'relative' }}>
                <input
                  id="quick-customer-name"
                  className="input"
                  placeholder="Search an existing customer or type a new customer name"
                  value={customerName || custQ}
                  onChange={(e) => {
                    if (customerId) setCustomerId(null);
                    setCustomerName(e.target.value);
                    setCustQ(e.target.value);
                  }}
                />
                {!!custSuggest.length && (
                  <div
                    className="card"
                    style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 20, maxHeight: 240, overflow: 'auto', border: '1px solid var(--glass-brd)' }}
                  >
                    {custSuggest.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => pickCustomer(c)}
                        style={{ padding: '8px 10px', borderTop: '1px solid var(--glass-brd)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
                      >
                        <span>{c.name}</span>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                          {c.phone || c.gstin ? [c.phone, c.gstin].filter(Boolean).join(' • ') : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button className="btn quick-clear-button" onClick={clearCustomer} disabled={!customerName && !customerId}>
              <X size={16} /> Clear
            </button>
          </div>
          {customerId && (
            <div style={{ marginTop: 6, color: 'var(--success)', fontSize: 12 }}>
              Linked to an existing customer record
            </div>
          )}
        </section>

        {(hiddenOptionalFields.size > 0 || hiddenSections.size > 0) && (
          <div className="quick-restore-bar">
            <span>Hidden optional fields: {hiddenOptionalFields.size + hiddenSections.size}</span>
            <button className="btn" type="button" onClick={() => { setHiddenOptionalFields(new Set()); setHiddenSections(new Set()); }}>
              <RotateCcw size={15} /> Restore optional fields
            </button>
          </div>
        )}

        {/* Template and custom invoice fields */}
        {customFields.length > 0 ? (
          <section className="quick-billing-section">
            <div className="quick-section-heading compact"><div><h2>Invoice details</h2><p>Fields marked optional can be removed from this invoice.</p></div></div>
            <div className="grid md:grid-cols-2 gap-3">
              {[...customFields]
                .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || a.id - b.id)
                .filter((field) => field.required || !hiddenOptionalFields.has(field.field_key))
                .map((field) => {
                  const options = getCustomFieldOptions(field);
                  const value = customFieldValues[field.field_key] || "";
                  const numericType =
                    field.data_type === "number" ||
                    field.data_type === "price" ||
                    field.data_type === "tax_percent";
                  return (
                    <div className="quick-custom-field" key={field.field_key}>
                      <div className="quick-field-label">
                        <label>{field.label} <span>{field.required ? "Required" : "Optional"}</span></label>
                        {!field.required && <button type="button" title={`Remove ${field.label}`} aria-label={`Remove ${field.label}`} onClick={() => hideOptionalField(field.field_key)}><X size={15} /></button>}
                      </div>

                      {field.data_type === "dropdown" ? (
                        <select
                          className="input"
                          value={value}
                          onChange={(e) =>
                            setCustomFieldValues((prev) => ({
                              ...prev,
                              [field.field_key]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Select</option>
                          {options.map((opt) => (
                            <option key={`${field.field_key}-${opt.value}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : field.data_type === "radio" ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                          {options.map((opt) => (
                            <label key={`${field.field_key}-${opt.value}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                type="radio"
                                name={field.field_key}
                                value={opt.value}
                                checked={value === opt.value}
                                onChange={(e) =>
                                  setCustomFieldValues((prev) => ({
                                    ...prev,
                                    [field.field_key]: e.target.value,
                                  }))
                                }
                              />
                              <span>{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <input
                          className="input"
                          type={numericType ? "number" : field.data_type === "date" ? "date" : "text"}
                          step={field.data_type === "tax_percent" ? "0.01" : undefined}
                          value={value}
                          onChange={(e) =>
                            setCustomFieldValues((prev) => ({
                              ...prev,
                              [field.field_key]: e.target.value,
                            }))
                          }
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        ) : null}

        {/* Product search / scan */}
        <section className="quick-billing-section quick-items-section">
          <div className="quick-section-heading compact"><div><h2>Invoice items</h2><p>Scan a barcode or search the product catalogue.</p></div><span className="quick-item-count">{items.length} item{items.length === 1 ? "" : "s"}</span></div>
        <div className="quick-product-search">
          <Search size={18} />
          <input className="input" placeholder="Search by product name, SKU or scan barcode" value={q} onChange={(e) => setQ(e.target.value)} />
          {!!suggest.length && (
            <div
              className="card"
              style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 20, maxHeight: 260, overflow: 'auto', border: '1px solid var(--glass-brd)' }}
            >
              {suggest.map((p) => (
                <div
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className="quick-product-option"
                >
                  <span>
                    {p.name} {p.sku ? `(${p.sku})` : ''}
                    {typeof p.stock_qty === 'number' ? ` • Stock: ${p.stock_qty}` : ''}
                    {p.category ? ` • ${p.category}` : ''}
                  </span>
                  <span><b>{inr(Number((p.selling_price ?? p.price) || 0))}</b><Plus size={17} /></span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Items grid */}
        <div className="quick-items-table">
          <div className="table-wrap">
            <table className="table" aria-label="Invoice line items">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Item</th>
                  <th style={{ width: 120 }}>Category</th>
                  <th style={{ width: 120 }}>HSN</th>
                  <th style={{ width: 120 }}>Lot</th>
                  <th style={{ width: 120 }}>Expiry</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Qty</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Rate</th>
                  <th style={{ width: 100, textAlign: 'right' }}>Disc %</th>
                  <th style={{ width: 80, textAlign: 'right' }}>GST %</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Line Total</th>
                  <th style={{ width: 52 }}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const t = lineTotals(it);
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</td>
                      <td>{it.category || '-'}</td>
                      <td>{it.hsn_code || '-'}</td>
                      <td>
                        <input
                          className="input"
                          value={it.batch_no ?? ""}
                          onChange={(e) => updateItem(i, { batch_no: e.target.value })}
                          style={{ height: 30, width: 120 }}
                          placeholder="Lot"
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="date"
                          value={it.exp_date ?? ""}
                          onChange={(e) => updateItem(i, { exp_date: e.target.value })}
                          style={{ height: 30, width: 130 }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={1}
                          value={it.qty}
                          onChange={(e) => updateItem(i, { qty: Number(e.target.value) })}
                          style={{ height: 30, width: 90, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={it.unit_price}
                          onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })}
                          style={{ height: 30, width: 120, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={it.discount_pct}
                          onChange={(e) => updateItem(i, { discount_pct: Number(e.target.value) })}
                          style={{ height: 30, width: 100, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={1}
                          value={it.gst_slab}
                          onChange={(e) => updateItem(i, { gst_slab: Number(e.target.value) })}
                          style={{ height: 30, width: 80, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(t.total)}</td>
                      <td>
                        <button className="quick-icon-button danger" type="button" title={`Remove ${it.name}`} aria-label={`Remove ${it.name}`} onClick={() => removeItem(i)}><Trash2 size={17} /></button>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={12} className="muted">
                      <div className="quick-empty-items"><Plus size={18} /> Search above to add the first product.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </section>

        {/* Extra + Notes/Terms */}
        <div className="quick-optional-grid">
          {!hiddenSections.has("charge") && <section className="quick-billing-section">
            <div className="quick-field-label"><label>Additional charge <span>Optional</span></label><button type="button" title="Remove additional charge" onClick={() => hideOptionalSection("charge")}><X size={15} /></button></div>
            <div className="flex items-center gap-2">
              <input
                className="input"
                placeholder="Label (e.g., Service Charge, Delivery)"
                value={extraLabel}
                onChange={(e) => setExtraLabel(e.target.value)}
              />
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                placeholder="Amount"
                value={extraAmount}
                onChange={(e) => setExtraAmount(Number(e.target.value))}
                style={{ width: 160 }}
              />
            </div>
            <div className="mt-2 text-xs opacity-70">This will be added to the total and shown on the invoice.</div>
          </section>}

          <section className="quick-billing-section">
            {!hiddenSections.has("notes") && <div className="quick-optional-block">
            <div className="quick-field-label"><label>Invoice notes <span>Optional</span></label><button type="button" title="Remove invoice notes" onClick={() => hideOptionalSection("notes")}><X size={15} /></button></div>
            <textarea className="input" style={{ minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>}
            {!hiddenSections.has("terms") && <div className="quick-optional-block">
            <div className="quick-field-label"><label>Terms &amp; conditions <span>Optional</span></label><button type="button" title="Remove terms and conditions" onClick={() => hideOptionalSection("terms")}><X size={15} /></button></div>
            <textarea className="input" style={{ minHeight: 70 }} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </div>}
          </section>
        </div>

        {/* Summary + Payment */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 12, flexWrap: "wrap" }}>
          <div />
          <div className="card no-break" style={{ padding: 12, minWidth: 320 }}>
            <div className="flex justify-between"><span>Taxable</span><b>{inr(totals.taxable)}</b></div>
            <div className="flex justify-between"><span>Tax</span><b>{inr(totals.tax)}</b></div>
            {customExtraTaxAmount !== 0 ? (
              <div className="flex justify-between"><span>Custom Tax</span><b>{inr(customExtraTaxAmount)}</b></div>
            ) : null}
            <div className="flex justify-between">
              <span>{extraLabel || 'Additional Charge'}</span><b>{inr(extra)}</b>
            </div>
            {customExtraAmount !== 0 ? (
              <div className="flex justify-between">
                <span>Custom Charges</span><b>{inr(customExtraAmount)}</b>
              </div>
            ) : null}
            <div className="flex justify-between" style={{ borderTop: '1px solid var(--glass-brd)', marginTop: 6, paddingTop: 6 }}>
              <span>Total</span><b style={{ fontSize: 18 }}>{inr(grandTotal)}</b>
            </div>
            <div className="flex justify-between mt-1"><span>Amount Paid</span><b>{inr(Number(amountPaid || 0))}</b></div>
            <div className="flex justify-between"><span>Pending</span><b>{inr(pendingAmount)}</b></div>
          </div>
        </div>

        <section className="quick-billing-section quick-payment-section">
          <div className="text-sm font-semibold mb-2">Payment</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs">Mode</label>
              <select
                className="input"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as any)}
              >
                <option value="paid">Paid in full</option>
                <option value="partial">Partial</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs">Amount Paid</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                value={amountPaid}
                onChange={(e) => {
                  const val = Number(e.target.value || 0);
                  setAmountPaid(val);
                  if (val <= 0) setPaymentMode("pending");
                  else if (val >= grandTotal - 0.01) setPaymentMode("paid");
                  else setPaymentMode("partial");
                }}
                style={{ width: 160, textAlign: "right" }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs">Method</label>
              <select
                className="input"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="">Not Set</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank">Bank</option>
                <option value="split">Split</option>
              </select>
            </div>
            <div className="text-xs opacity-70">
              Pending: <b>{inr(pendingAmount)}</b>
            </div>
          </div>
        </section>

        <div className="quick-billing-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving || items.length === 0}>
            {saving ? 'Saving...' : 'Save & View Invoice'}
          </button>
          <Link className="btn" href="/invoices/">View invoice history</Link>
        </div>
      </div>
    </main>
  );
}
