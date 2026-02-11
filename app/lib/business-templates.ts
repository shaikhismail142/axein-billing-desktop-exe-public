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
};

export type BusinessTemplate = {
  key: BusinessType;
  label: string;
  invoiceLayout: "a4" | "thermal" | "hybrid";
  navigation: string[];
  workflowHints: string[];
  defaultInvoiceFields: TemplateField[];
};

const COMMON_NAV = [
  "Dashboard",
  "Invoices",
  "Quotations",
  "Products",
  "Inventory",
  "Accounting",
  "Profile",
];

export const BUSINESS_TEMPLATES: Record<BusinessType, BusinessTemplate> = {
  clinic: {
    key: "clinic",
    label: "Clinic",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["patient-first", "doctor-reference", "expiry-aware"],
    defaultInvoiceFields: [
      { key: "patient_name", label: "Patient Name", required: true, visible: true },
      { key: "doctor_name", label: "Doctor Name", required: false, visible: true },
      { key: "prescription_no", label: "Prescription No", required: false, visible: true },
    ],
  },
  general_store: {
    key: "general_store",
    label: "General Store",
    invoiceLayout: "thermal",
    navigation: [...COMMON_NAV],
    workflowHints: ["fast-counter", "low-stock-priority"],
    defaultInvoiceFields: [
      { key: "customer_phone", label: "Customer Phone", required: false, visible: true },
      { key: "payment_mode", label: "Payment Mode", required: true, visible: true },
    ],
  },
  spa_saloon: {
    key: "spa_saloon",
    label: "Spa/Saloon",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["service-bundles", "appointment-aware"],
    defaultInvoiceFields: [
      { key: "service_staff", label: "Service Staff", required: false, visible: true },
      { key: "appointment_slot", label: "Appointment Slot", required: false, visible: true },
    ],
  },
  hardware_store: {
    key: "hardware_store",
    label: "Hardware Store",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["bulk-items", "gst-breakdown"],
    defaultInvoiceFields: [
      { key: "site_name", label: "Site Name", required: false, visible: true },
      { key: "transport_note", label: "Transport Note", required: false, visible: true },
    ],
  },
  mobile_store: {
    key: "mobile_store",
    label: "Mobile Store",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["imei-capture", "warranty-note"],
    defaultInvoiceFields: [
      { key: "imei_no", label: "IMEI No", required: true, visible: true },
      { key: "warranty_months", label: "Warranty (Months)", required: false, visible: true },
    ],
  },
  hotel: {
    key: "hotel",
    label: "Hotel",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["room-service", "checkin-checkout"],
    defaultInvoiceFields: [
      { key: "room_no", label: "Room No", required: true, visible: true },
      { key: "stay_period", label: "Stay Period", required: false, visible: true },
    ],
  },
  restaurant: {
    key: "restaurant",
    label: "Restaurant",
    invoiceLayout: "thermal",
    navigation: [...COMMON_NAV],
    workflowHints: ["table-orders", "kitchen-priority"],
    defaultInvoiceFields: [
      { key: "table_no", label: "Table No", required: false, visible: true },
      { key: "server_name", label: "Server Name", required: false, visible: true },
    ],
  },
  school_institute: {
    key: "school_institute",
    label: "School/Institute",
    invoiceLayout: "a4",
    navigation: [...COMMON_NAV],
    workflowHints: ["student-ledger", "fee-cycles"],
    defaultInvoiceFields: [
      { key: "student_name", label: "Student Name", required: true, visible: true },
      { key: "class_section", label: "Class/Section", required: false, visible: true },
      { key: "roll_no", label: "Roll No", required: false, visible: true },
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
