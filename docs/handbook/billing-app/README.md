# AxEin Billing Desktop (Customer Handbook)

This handbook explains how to install, activate, and use AxEin Billing Desktop for day-to-day billing, inventory, and reporting.

## Quick Start

1. Install `AxEin Billing Desktop_..._x64-setup.exe`.
2. Open **AxEin Billing Desktop**.
3. In **AxEin Billing Setup**:
   - Paste your activation token or activation JSON.
   - Click `Validate License` (or `Start 7-day Trial`).
   - Continue through **Business** and **Template**.

![License Key Insertion](images/license-key-insertion.png)

## System Requirements

- Windows 10 or Windows 11 (64-bit)
- Recommended: 8 GB RAM, SSD storage
- Works offline for billing; LAN Mode requires local network access (optional)

## Installation (Windows)

1. Run the installer: `AxEin Billing Desktop_..._x64-setup.exe`.
2. Choose an install location (default is fine).
3. Finish and launch the app.

If Windows shows SmartScreen:

- Click `More info` -> `Run anyway`.

## First-Time Setup Wizard

The setup wizard is the fastest way to get the app ready for billing.

### Step 1: License

You can activate via:

- **Activation Token** (a single line starting with `L-...`), or
- **Activation JSON** (a JSON block that includes `signature`)

Actions:

- `Validate License`: activates the license and unlocks the app.
- `Start 7-day Trial`: starts a limited free trial (if enabled for your build).

![License Key Insertion](images/license-key-insertion.png)

### Step 2: Business Details

Provide your business details. These are used on invoices and printouts.

Typical fields:

- Business name, address, phone
- GSTIN (if applicable)
- Invoice prefix and state code
- Signature details (optional)

### Step 3: Choose Business Type

Business type helps the app apply a sensible template (fields and layout defaults).

![Select Business Type](images/select-business-type.png)

### Step 4: Finish and Sign In

Create your first user (Owner/Admin) and continue to the app.

![Setup Sign Up](images/setup-sign-up.png)

## Navigation Overview

The main modules are available from the top navigation and/or side menu.

![Dashboard](images/dashboard.png)

## Dashboard

Use the dashboard to get a quick overview (sales, inventory, trends).

Tips:

- Use the date range controls to view daily/weekly/monthly performance.
- If you do not have access to certain reports, the app shows a restriction message.

![Dashboard](images/dashboard.png)

## Quick Billing (Create a Sale)

Quick Billing is the fastest way to generate an invoice.

Typical flow:

1. Set the **Invoice date** (useful for creating older bills when needed).
2. Select customer (optional).
3. Add items:
   - Search/scan product
   - Adjust quantity, rate, discount, GST
4. Set payment:
   - Paid in full or partial payment
5. Save and open invoice.

![Quick Billing](images/quick-billing-new-bill.png)

After saving, you can view the invoice and print/download.

![Sample Invoice](images/sample-invoice-new-bill.png)

## Invoices

### Invoice List

The invoices list lets you search, filter, export, and open any invoice.

![Invoice List](images/invoice-list-invoices-section.png)

### View Invoice

Inside an invoice you can:

- Download PDF
- Open Print / Thermal picker
- Edit (if your role allows)

![Invoice View](images/edit-existing-invoices-invoice-section.png)

### Print / Download (A4 and Thermal)

The print picker supports:

- **A4 Preview** for standard printers
- **Thermal Preview** for receipt printers (80mm/58mm)
- `Print / Save` to open the system print dialog (choose printer or “Save as PDF”)
- `Download PDF` to save a PDF file

![Print Preview](images/print-preview-new-invoice.png)

![Thermal Preview](images/thermal-print-preview-new-invoice.png)

## Products

### Product List

Use Products to create and manage your catalog.

![Products List](images/products-section-list.png)

### Add a Product

Fill in pricing, GST/HSN details, and optional inventory metadata.

![Add Product](images/adding-new-product-product-section.png)

## Quotations

Quotations help you prepare a quote and convert it to a sale when confirmed.

### Quotation List

![Quotation List](images/quotation-list-section.png)

### Create a Quotation

![New Quotation](images/quotation-new-quotation.png)

![Quotation Section](images/new-quotation-quotation-section.png)

## Inventory

Inventory includes stock, batches/lots, expiry tracking, adjustments, and low-stock.

![Inventory With Submodules](images/inventory-section-with-sub-modules.png)

![Inventory](images/inventory-section.png)

### Batches and Lots

Use batches/lots to track expiry and batch numbers (common for pharmacy/medical items).

![Batches and Lots](images/batches-and-lots-inventory-section.png)

### Stock Adjustments

Use stock adjustments to fix physical stock differences.

![Stock Adjustments](images/stock-adjustments-inventory-section.png)

## Purchases

Purchases are vendor bills and inventory receipts.

### Purchases List

![Purchases List](images/purchases-section.png)

### Create a Purchase

Tips:

- Select products from the dropdown (if enabled) or enter Product ID.
- Add batch number and expiry details when applicable.

![New Purchase](images/new-purchases-purchases.png)

## Reports

Use Reports for GST/tax summaries and other analytics.

![Reports (1/2)](images/reports-section-1-of-2.png)

![Reports (2/2)](images/reports-section-2-of-2.png)

## Accounting

Accounting summarizes receivables/payables and outstanding dues.

![Accounting](images/accounting-section.png)

## Profile and Settings

Use Profile for user access control, audit logs, LAN mode settings, and app settings.

![Profile](images/profile-section.png)

### User Access

Admins can add users, assign roles, and manage seats.

![User Access](images/profile-user-access-section.png)

### Audit Logs

Audit Logs show key user actions and access events for troubleshooting.

![Audit Logs](images/profile-audit-logs.png)

### LAN Mode (Optional)

LAN Mode allows multiple computers to use the same business database over a local network.

![LAN Mode Settings](images/profile-lan-mode-settings.png)

### Settings

Settings includes business profile, invoice defaults, theme, backups, and other options.

![Settings (1/2)](images/settings-1-of-2.png)

![Settings (2/2)](images/settings-2-of-2.png)

## Zoom and Theme

Top-right controls allow you to:

- Increase/decrease UI size (A+ / A-)
- Switch themes (Light/Dark/other options depending on your build)

## Troubleshooting

See `axein-billing-desktop-exe/docs/handbook/billing-app/TROUBLESHOOTING.md`.

