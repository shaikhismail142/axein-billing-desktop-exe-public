export type CustomFieldDataType =
  | "text"
  | "number"
  | "date"
  | "dropdown"
  | "radio"
  | "price"
  | "tax_percent";

export type CustomFieldAppliesTo =
  | "invoice"
  | "quotation"
  | "purchase"
  | "product";

export type CustomFieldOption = {
  label: string;
  value: string;
};

export type CustomFieldDefinition = {
  id?: number;
  field_key: string;
  label: string;
  data_type: CustomFieldDataType;
  required: boolean;
  visible: boolean;
  position: number;
  applies_to?: CustomFieldAppliesTo;
  config_json?: Record<string, unknown> | null;
};

export type CustomFieldComputation = {
  extraAmount: number;
  extraTaxAmount: number;
  taxableBase: number;
  values: Record<string, string>;
  breakdown: Array<{
    field_key: string;
    label: string;
    type: "price" | "tax_percent";
    input: number;
    amount: number;
  }>;
};

const DATA_TYPES: ReadonlySet<string> = new Set([
  "text",
  "number",
  "date",
  "dropdown",
  "radio",
  "price",
  "tax_percent",
]);

const APPLIES_TO: ReadonlySet<string> = new Set(["invoice", "quotation", "purchase", "product"]);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function normalizeCustomFieldDataType(input: unknown): CustomFieldDataType {
  const value = String(input || "text").trim().toLowerCase();
  return DATA_TYPES.has(value) ? (value as CustomFieldDataType) : "text";
}

export function normalizeCustomFieldAppliesTo(input: unknown): CustomFieldAppliesTo {
  const value = String(input || "invoice").trim().toLowerCase();
  return APPLIES_TO.has(value) ? (value as CustomFieldAppliesTo) : "invoice";
}

function normalizeOption(input: unknown): CustomFieldOption | null {
  if (typeof input === "string") {
    const v = input.trim();
    if (!v) return null;
    return { label: v, value: v };
  }
  if (input && typeof input === "object") {
    const row = input as Record<string, unknown>;
    const value = String(row.value ?? row.label ?? "").trim();
    const label = String(row.label ?? row.value ?? "").trim();
    if (!value || !label) return null;
    return { label: label.slice(0, 80), value: value.slice(0, 80) };
  }
  return null;
}

export function normalizeCustomFieldConfig(
  dataType: CustomFieldDataType,
  input: unknown
): Record<string, unknown> {
  const src = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

  const out: Record<string, unknown> = {};
  const placeholder = String(src.placeholder || "").trim();
  if (placeholder) out.placeholder = placeholder.slice(0, 120);

  if (dataType === "dropdown" || dataType === "radio") {
    const rawOptions = Array.isArray(src.options) ? src.options : [];
    const uniq = new Map<string, CustomFieldOption>();
    for (const raw of rawOptions) {
      const opt = normalizeOption(raw);
      if (!opt) continue;
      if (uniq.has(opt.value.toLowerCase())) continue;
      uniq.set(opt.value.toLowerCase(), opt);
      if (uniq.size >= 100) break;
    }
    out.options = Array.from(uniq.values());
  }

  if (dataType === "tax_percent") {
    const maxPct = Number(src.max_pct);
    if (Number.isFinite(maxPct)) out.max_pct = clamp(maxPct, 0, 1000);
  }

  return out;
}

export function getCustomFieldOptions(field: CustomFieldDefinition): CustomFieldOption[] {
  const cfg = field?.config_json && typeof field.config_json === "object"
    ? (field.config_json as Record<string, unknown>)
    : {};
  const options = Array.isArray(cfg.options) ? cfg.options : [];
  const out: CustomFieldOption[] = [];
  for (const raw of options) {
    const parsed = normalizeOption(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseNumberish(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export function computeCustomFieldTotals(
  fields: CustomFieldDefinition[],
  rawValues: Record<string, unknown>,
  taxableBase: number
): CustomFieldComputation {
  const ordered = [...fields].sort(
    (a, b) => Number(a.position || 0) - Number(b.position || 0) || Number(a.id || 0) - Number(b.id || 0)
  );
  const values: Record<string, string> = {};

  let extraAmount = 0;
  let extraTaxAmount = 0;
  const breakdown: CustomFieldComputation["breakdown"] = [];

  for (const field of ordered) {
    const raw = rawValues[field.field_key];
    const asString = raw == null ? "" : String(raw).trim();
    if (asString) values[field.field_key] = asString;

    if (field.data_type === "price") {
      const n = parseNumberish(raw);
      if (n != null) {
        const amount = round2(n);
        extraAmount = round2(extraAmount + amount);
        breakdown.push({
          field_key: field.field_key,
          label: field.label,
          type: "price",
          input: amount,
          amount,
        });
      }
    }
  }

  const baseForTax = round2(Math.max(0, Number(taxableBase || 0) + extraAmount));
  for (const field of ordered) {
    if (field.data_type !== "tax_percent") continue;
    const pct = parseNumberish(rawValues[field.field_key]);
    if (pct == null) continue;
    const safePct = clamp(pct, -1000, 1000);
    const amount = round2((baseForTax * safePct) / 100);
    extraTaxAmount = round2(extraTaxAmount + amount);
    breakdown.push({
      field_key: field.field_key,
      label: field.label,
      type: "tax_percent",
      input: round2(safePct),
      amount,
    });
  }

  return {
    extraAmount: round2(extraAmount),
    extraTaxAmount: round2(extraTaxAmount),
    taxableBase: round2(baseForTax),
    values,
    breakdown,
  };
}
