export type BusinessType =
  | "clinic"
  | "general_store"
  | "spa_saloon"
  | "hardware_store"
  | "mobile_store"
  | "hotel"
  | "restaurant"
  | "school_institute";

export type TemplateField = {
  key: string;
  label: string;
  required: boolean;
  visible: boolean;
  data_type?: "text" | "number" | "date";
};

export type TemplateNavKey =
  | "dashboard"
  | "billing"
  | "invoices"
  | "quotations"
  | "products"
  | "inventory"
  | "purchases"
  | "accounting"
  | "profile";

export type TemplateNavItem = {
  key: TemplateNavKey;
  label: string;
  href: string;
};

export type BusinessTemplate = {
  key: BusinessType;
  label: string;
  invoiceLayout: "a4" | "thermal" | "hybrid";
  navigation: TemplateNavKey[];
  workflowHints: string[];
  defaultInvoiceFields: TemplateField[];
};

const COMMON_NAV: TemplateNavKey[] = [
  "dashboard",
  "billing",
  "invoices",
  "quotations",
  "products",
  "inventory",
  "purchases",
  "accounting",
  "profile",
];

const BASE_NAV_ITEMS: TemplateNavItem[] = [
  { key: "dashboard", label: "Dashboard & Reports", href: "/dashboard" },
  { key: "billing", label: "Quick Billing", href: "/billing" },
  { key: "invoices", label: "Invoices", href: "/invoices" },
  { key: "quotations", label: "Quotations", href: "/quotations" },
  { key: "products", label: "Products", href: "/products" },
  { key: "inventory", label: "Low Stock", href: "/inventory/low-stock" },
  { key: "purchases", label: "Purchases", href: "/inventory/purchases" },
  { key: "accounting", label: "Accounting", href: "/accounting" },
  { key: "profile", label: "Profile", href: "/profile" },
];

const NAV_LABEL_OVERRIDES: Record<BusinessType, Partial<Record<TemplateNavKey, string>>> = {
  clinic: {
    billing: "Consultation Billing",
    inventory: "Medicine Stock",
    purchases: "Supplier Purchases",
  },
  general_store: {},
  spa_saloon: {
    billing: "Service Billing",
    quotations: "Service Quotes",
    inventory: "Consumables",
  },
  hardware_store: {
    billing: "Counter Billing",
    inventory: "Store Inventory",
  },
  mobile_store: {
    billing: "Device Billing",
    inventory: "Device Inventory",
  },
  hotel: {
    billing: "Front Desk Billing",
    quotations: "Booking Quotes",
    inventory: "Kitchen/Room Stock",
  },
  restaurant: {
    billing: "Table Billing",
    quotations: "Party Quotes",
    inventory: "Kitchen Stock",
  },
  school_institute: {
    billing: "Fee Billing",
    quotations: "Fee Estimates",
    accounting: "Fee Accounting",
  },
};

export const BUSINESS_TEMPLATES: Record<BusinessType, BusinessTemplate> = {
  clinic: {
    key: "clinic",
    label: "Clinic",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["patient-first", "doctor-reference", "expiry-aware"],
    defaultInvoiceFields: [
      { key: "patient_name", label: "Patient Name", required: true, visible: true, data_type: "text" },
      { key: "doctor_name", label: "Doctor Name", required: false, visible: true, data_type: "text" },
      { key: "prescription_no", label: "Prescription No", required: false, visible: true, data_type: "text" },
      { key: "next_appointment_date", label: "Next Appointment Date", required: false, visible: true, data_type: "date" },
      { key: "consulting_fee", label: "Consulting Fee", required: false, visible: true, data_type: "number" },
      { key: "tests_fee", label: "Tests / Lab Fee", required: false, visible: true, data_type: "number" },
    ],
  },
  general_store: {
    key: "general_store",
    label: "General Store",
    invoiceLayout: "thermal",
    navigation: [...COMMON_NAV],
    workflowHints: ["fast-counter", "low-stock-priority"],
    defaultInvoiceFields: [
      { key: "customer_phone", label: "Customer Phone", required: false, visible: true, data_type: "text" },
      { key: "payment_mode", label: "Payment Mode", required: true, visible: true, data_type: "text" },
    ],
  },
  spa_saloon: {
    key: "spa_saloon",
    label: "Spa/Saloon",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["service-bundles", "appointment-aware"],
    defaultInvoiceFields: [
      { key: "service_staff", label: "Service Staff", required: false, visible: true, data_type: "text" },
      { key: "appointment_slot", label: "Appointment Slot", required: false, visible: true, data_type: "text" },
    ],
  },
  hardware_store: {
    key: "hardware_store",
    label: "Hardware Store",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["bulk-items", "gst-breakdown"],
    defaultInvoiceFields: [
      { key: "site_name", label: "Site Name", required: false, visible: true, data_type: "text" },
      { key: "transport_note", label: "Transport Note", required: false, visible: true, data_type: "text" },
    ],
  },
  mobile_store: {
    key: "mobile_store",
    label: "Mobile Store",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["imei-capture", "warranty-note"],
    defaultInvoiceFields: [
      { key: "imei_no", label: "IMEI No", required: true, visible: true, data_type: "text" },
      { key: "warranty_months", label: "Warranty (Months)", required: false, visible: true, data_type: "number" },
    ],
  },
  hotel: {
    key: "hotel",
    label: "Hotel",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["room-service", "checkin-checkout"],
    defaultInvoiceFields: [
      { key: "room_no", label: "Room No", required: true, visible: true, data_type: "text" },
      { key: "guest_name", label: "Guest Name", required: true, visible: true, data_type: "text" },
      { key: "check_in_date", label: "Check-in Date", required: false, visible: true, data_type: "date" },
      { key: "check_out_date", label: "Check-out Date", required: false, visible: true, data_type: "date" },
      { key: "stay_days", label: "Stay Days", required: false, visible: true, data_type: "number" },
      { key: "booking_ref", label: "Booking Reference", required: false, visible: true, data_type: "text" },
    ],
  },
  restaurant: {
    key: "restaurant",
    label: "Restaurant",
    invoiceLayout: "thermal",
    navigation: [...COMMON_NAV],
    workflowHints: ["table-orders", "kitchen-priority"],
    defaultInvoiceFields: [
      { key: "table_no", label: "Table No", required: false, visible: true, data_type: "text" },
      { key: "token_no", label: "Token No", required: false, visible: true, data_type: "text" },
      { key: "guests_count", label: "Guests", required: false, visible: true, data_type: "number" },
      { key: "server_name", label: "Server Name", required: false, visible: true, data_type: "text" },
      { key: "order_type", label: "Order Type (Dine-in/Takeaway)", required: false, visible: true, data_type: "text" },
      { key: "service_tax_pct", label: "Service Tax %", required: false, visible: true, data_type: "number" },
    ],
  },
  school_institute: {
    key: "school_institute",
    label: "School/Institute",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["student-ledger", "fee-cycles"],
    defaultInvoiceFields: [
      { key: "student_name", label: "Student Name", required: true, visible: true, data_type: "text" },
      { key: "class_section", label: "Class/Section", required: false, visible: true, data_type: "text" },
      { key: "roll_no", label: "Roll No", required: false, visible: true, data_type: "text" },
    ],
  },
};

export function listBusinessTemplates(): BusinessTemplate[] {
  return Object.values(BUSINESS_TEMPLATES);
}

export function isBusinessType(input: unknown): input is BusinessType {
  if (typeof input !== "string") return false;
  return Object.prototype.hasOwnProperty.call(BUSINESS_TEMPLATES, input);
}

export function resolveBusinessTemplate(input: unknown): BusinessTemplate {
  if (isBusinessType(input)) return BUSINESS_TEMPLATES[input];
  return BUSINESS_TEMPLATES.general_store;
}

export function resolveTemplateNavigationItems(input: unknown): TemplateNavItem[] {
  const template = resolveBusinessTemplate(input);
  const overrideMap = NAV_LABEL_OVERRIDES[template.key] || {};
  const baseByKey = new Map(BASE_NAV_ITEMS.map((item) => [item.key, item]));
  const items: TemplateNavItem[] = [];

  for (const key of template.navigation) {
    const base = baseByKey.get(key);
    if (!base) continue;
    items.push({
      ...base,
      label: overrideMap[key] || base.label,
    });
  }

  return items;
}
