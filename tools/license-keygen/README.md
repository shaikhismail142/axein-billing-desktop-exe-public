# AxEin Billing - Staff License Keygen

Offline Ed25519 keygen tooling for AxEin desktop licensing.

## Files
- `issue-license.js`: main CLI (init/issue/verify)
- `ed25519-private.pem`: private signing key (staff only, secret)
- `info.json`: contains base64 SPKI public key for app verification
- `licenses/`: generated license files

## Staff Password Gate
Issuing licenses is blocked unless `AXEIN_STAFF_PASSWORD` is set and provided.

```bash
export AXEIN_STAFF_PASSWORD='your-staff-password'
```

## Initialize signing keys (one-time)
```bash
node tools/license-keygen/issue-license.js init
```

## Issue license (interactive)
```bash
node tools/license-keygen/issue-license.js issue --staff-pass 'your-staff-password'
```

This captures:
- business details
- business type
- usage mode
- seat/user limit
- license type
- validity period
- installation scope
- feature list

## Issue license (non-interactive)
```bash
node tools/license-keygen/issue-license.js issue \
  --staff-pass 'your-staff-password' \
  --email owner@example.com \
  --business 'Acme Clinic' \
  --business-type clinic \
  --usage-mode standalone \
  --users 10 \
  --license-type pro \
  --months 12 \
  --scope business_lan \
  --features reports,inventory,quotations
```

## Verify license file
```bash
node tools/license-keygen/issue-license.js verify ./tools/license-keygen/licenses/AXEIN-XXXX-XXXX-XXXX.json
```

## App activation
Use `packed_token` in API payload:
```json
{ "token": "L-AXEIN-...." }
```
