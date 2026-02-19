'use client';

import * as React from 'react';
import {
  computeCustomFieldTotals,
  CustomFieldDataType,
  getCustomFieldOptions,
} from "@/app/lib/custom-fields";

type Product = {
  id: number;
  name: string;
  meta?: {
    sku?: string;
    selling_price?: number;
    hsn_code?: string;
    unit?: string;
  };
  category?: string | null;
  hsn_code?: string | null;
  batch_no?: string | null;
  exp_date?: string | null;
};

type Item = {
  product_id?: number;
  description: string;
  qty: number;
  price: number;
  tax: number;
  discount: number;
  batch_no?: string;
  exp_date?: string;
};

type CustomField = {
  id: number;
  field_key: string;
  label: string;
  data_type: CustomFieldDataType;
  required: boolean;
  visible: boolean;
  position: number;
  config_json?: Record<string, unknown> | null;
};

function inr(n: number) {
  const amount = Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `INR (Rs/-) ${amount}`;
}

export default function NewQuotationForm({
  products,
  customFields = [],
}: {
  products: Product[];
  customFields?: CustomField[];
}) {
  const [items, setItems] = React.useState<Item[]>([
    { product_id: undefined, description: '', qty: 1, price: 0, tax: 0, discount: 0, batch_no: '', exp_date: '' },
  ]);

  const [customerName, setCustomerName] = React.useState<string>('');
  const [customerId, setCustomerId] = React.useState<string>('');
  const [notes, setNotes] = React.useState('');
  const [terms, setTerms] = React.useState('');
  const [validUntil, setValidUntil] = React.useState<string>('');
  const [customFieldValues, setCustomFieldValues] = React.useState<Record<string, string>>({});

  const [saving, setSaving] = React.useState(false);
  const [savedId, setSavedId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const visibleCustomFields = React.useMemo(
    () =>
      [...customFields]
        .filter((f) => f?.visible !== false && f?.field_key && f?.label)
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || a.id - b.id),
    [customFields]
  );

  const baseTotals = React.useMemo(() => {
    let taxable = 0;
    let tax = 0;
    for (const it of items) {
      const qty = Number(it.qty || 0);
      const price = Number(it.price || 0);
      const gross = qty * price;
      const discRaw = Number(it.discount || 0);
      const discAbs = discRaw > 0 ? (discRaw <= 100 ? gross * (discRaw / 100) : discRaw) : 0;
      const afterDisc = Math.max(0, gross - discAbs);
      const taxPct = Math.max(0, Number(it.tax || 0));
      const taxAmt = (afterDisc * taxPct) / 100;
      taxable += afterDisc;
      tax += taxAmt;
    }
    return {
      taxable: Number(taxable.toFixed(2)),
      tax: Number(tax.toFixed(2)),
    };
  }, [items]);

  const customComputed = React.useMemo(
    () => computeCustomFieldTotals(visibleCustomFields, customFieldValues, baseTotals.taxable),
    [visibleCustomFields, customFieldValues, baseTotals.taxable]
  );

  const grandTotal = React.useMemo(
    () => Number((baseTotals.taxable + baseTotals.tax + customComputed.extraAmount + customComputed.extraTaxAmount).toFixed(2)),
    [baseTotals, customComputed.extraAmount, customComputed.extraTaxAmount]
  );

  const onSelectProduct = (row: number, productId: number) => {
    const p = products.find((x) => x.id === Number(productId));
    setItems((prev) => {
      const next = [...prev];
      const price = Number(p?.meta?.selling_price ?? 0);
      next[row] = {
        ...next[row],
        product_id: Number(productId) || undefined,
        description: next[row].description || p?.name || '',
        price,
        batch_no: p?.batch_no ?? next[row].batch_no ?? '',
        exp_date: p?.exp_date ?? next[row].exp_date ?? '',
      };
      return next;
    });
  };

  const onChange = (row: number, field: keyof Item, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      const v = field === 'description' || field === "batch_no" || field === "exp_date" ? value : Number(value || 0);
      next[row] = { ...next[row], [field]: v } as Item;
      return next;
    });
  };

  const addRow = () =>
    setItems((prev) => [
      ...prev,
      { product_id: undefined, description: '', qty: 1, price: 0, tax: 0, discount: 0, batch_no: '', exp_date: '' },
    ]);

  const saveQuotation = async () => {
    setSaving(true);
    setError(null);
    try {
      const parsedId =
        customerId.trim() === ''
          ? null
          : Number.isFinite(Number(customerId))
          ? Number(customerId)
          : null;

      const customPayload: Record<string, string> = {};
      for (const field of visibleCustomFields) {
        const raw = customFieldValues[field.field_key];
        const value = raw == null ? "" : String(raw).trim();
        if (field.required && !value) {
          throw new Error(`Please fill required field: ${field.label}`);
        }
        if (value) customPayload[field.field_key] = value;
      }
      for (const [k, v] of Object.entries(customComputed.values || {})) {
        if (v != null && String(v).trim()) customPayload[k] = String(v).trim();
      }

      const res = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: parsedId,
          customer_name: customerName || null,
          items,
          notes,
          terms,
          valid_until: validUntil || null,
          custom_fields: customPayload,
          custom_field_totals: {
            extra_amount: Number(customComputed.extraAmount || 0),
            extra_tax_amount: Number(customComputed.extraTaxAmount || 0),
            taxable_base: Number(customComputed.taxableBase || 0),
            grand_total: grandTotal,
          },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSavedId(data.id || data?.data?.id || null);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to save quotation');
    } finally {
      setSaving(false);
    }
  };

  const openPdf = () => {
    if (savedId) window.open(`/quotations/${savedId}/pdf`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Quotation</h1>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Customer Name (optional)</label>
          <input
            className="w-full rounded-md border px-3 py-2"
            placeholder="e.g. Rahul Sharma"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Customer ID (optional)</label>
          <input
            type="number"
            className="w-full rounded-md border px-3 py-2"
            placeholder="e.g. 12"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
        </div>
      </div>

      {items.map((it, i) => (
        <div
          key={i}
          className="grid grid-cols-12 gap-3 rounded-xl border p-4 bg-white/60 backdrop-blur"
        >
          <div className="col-span-3">
            <label className="block text-sm font-medium mb-1">Product</label>
            <select
              className="w-full rounded-md border px-3 py-2"
              value={it.product_id ?? ''}
              onChange={(e) => onSelectProduct(i, Number(e.target.value))}
            >
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.meta?.sku ? ` • ${p.meta.sku}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-3">
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              className="w-full rounded-md border px-3 py-2"
              value={it.description}
              onChange={(e) => onChange(i, 'description', e.target.value)}
              placeholder="Item description"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Quantity</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.qty}
              onChange={(e) => onChange(i, 'qty', e.target.value)}
            />
          </div>

          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Price</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.price}
              onChange={(e) => onChange(i, 'price', e.target.value)}
            />
          </div>

          <div className="col-span-1">
            <label className="block text-sm font-medium mb-1">Tax %</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.tax}
              onChange={(e) => onChange(i, 'tax', e.target.value)}
            />
          </div>

          <div className="col-span-1">
            <label className="block text-sm font-medium mb-1">Discount</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border px-3 py-2 text-right"
              value={it.discount}
              onChange={(e) => onChange(i, 'discount', e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="col-span-12 grid grid-cols-12 gap-3">
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">Category</label>
              <div className="w-full rounded-md border px-3 py-2 text-xs bg-white/40">
                {products.find((p) => p.id === Number(it.product_id))?.category || '—'}
              </div>
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">HSN Code</label>
              <div className="w-full rounded-md border px-3 py-2 text-xs bg-white/40">
                {products.find((p) => p.id === Number(it.product_id))?.hsn_code ||
                  products.find((p) => p.id === Number(it.product_id))?.meta?.hsn_code ||
                  '—'}
              </div>
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">Lot / Batch No</label>
              <input
                className="w-full rounded-md border px-3 py-2 text-xs"
                value={it.batch_no ?? ''}
                onChange={(e) => setItems((s) => { const n=[...s]; n[i]={...n[i], batch_no: e.target.value}; return n; })}
                placeholder="e.g., L1234"
              />
            </div>
            <div className="col-span-3">
              <label className="block text-xs font-medium mb-1">Expiry Date</label>
              <input
                type="date"
                className="w-full rounded-md border px-3 py-2 text-xs"
                value={it.exp_date ?? ''}
                onChange={(e) => setItems((s) => { const n=[...s]; n[i]={...n[i], exp_date: e.target.value}; return n; })}
              />
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="rounded-lg border px-3 py-2 text-sm"
      >
        + Add item
      </button>

      {visibleCustomFields.length > 0 ? (
        <div className="rounded-xl border p-4 bg-white/60 backdrop-blur">
          <div className="text-sm font-semibold mb-3">Custom Fields</div>
          <div className="grid grid-cols-12 gap-3">
            {visibleCustomFields.map((field) => {
              const value = customFieldValues[field.field_key] || "";
              const options = getCustomFieldOptions(field);
              const isNumeric =
                field.data_type === "number" ||
                field.data_type === "price" ||
                field.data_type === "tax_percent";
              return (
                <div className="col-span-6" key={field.field_key}>
                  <label className="block text-sm font-medium mb-1">
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  {field.data_type === "dropdown" ? (
                    <select
                      className="w-full rounded-md border px-3 py-2"
                      value={value}
                      onChange={(e) =>
                        setCustomFieldValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
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
                    <div className="flex flex-wrap gap-3">
                      {options.map((opt) => (
                        <label key={`${field.field_key}-${opt.value}`} className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name={field.field_key}
                            value={opt.value}
                            checked={value === opt.value}
                            onChange={(e) =>
                              setCustomFieldValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
                            }
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input
                      className="w-full rounded-md border px-3 py-2"
                      type={isNumeric ? "number" : field.data_type === "date" ? "date" : "text"}
                      step={field.data_type === "tax_percent" ? "0.01" : undefined}
                      value={value}
                      onChange={(e) =>
                        setCustomFieldValues((prev) => ({ ...prev, [field.field_key]: e.target.value }))
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            className="w-full rounded-md border px-3 py-2"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="col-span-6">
          <label className="block text-sm font-medium mb-1">Terms</label>
          <textarea
            className="w-full rounded-md border px-3 py-2"
            rows={4}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
          <div className="mt-3">
            <label className="block text-sm font-medium mb-1">Valid Until</label>
            <input
              type="date"
              className="w-full rounded-md border px-3 py-2"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4 bg-white/60 backdrop-blur">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>Taxable</div><div className="text-right font-medium">{inr(baseTotals.taxable)}</div>
          <div>Tax</div><div className="text-right font-medium">{inr(baseTotals.tax)}</div>
          {customComputed.extraTaxAmount !== 0 ? (
            <>
              <div>Custom Tax</div><div className="text-right font-medium">{inr(customComputed.extraTaxAmount)}</div>
            </>
          ) : null}
          {customComputed.extraAmount !== 0 ? (
            <>
              <div>Custom Charges</div><div className="text-right font-medium">{inr(customComputed.extraAmount)}</div>
            </>
          ) : null}
          <div className="font-semibold border-t pt-2">Grand Total</div>
          <div className="text-right font-semibold border-t pt-2">{inr(grandTotal)}</div>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={saveQuotation}
          disabled={saving || items.length === 0}
          className="rounded-lg bg-black text-white px-4 py-2 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Quotation'}
        </button>
        <button
          type="button"
          onClick={openPdf}
          disabled={!savedId}
          className="rounded-lg border px-4 py-2 disabled:opacity-50"
          title={savedId ? 'Open PDF' : 'Save first to get a PDF'}
        >
          Print / PDF
        </button>
      </div>
    </div>
  );
}
