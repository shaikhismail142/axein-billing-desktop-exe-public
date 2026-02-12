AxEin Billing Desktop - Installer Notes
======================================

Included installers:
- AxEin Billing Desktop (customer app)
- AxEin License Keygen (staff-only)

Staff super password:
- Set via environment variable `AXEIN_SUPER_KEYGEN_PASSWORD` **before** building the keygen.
- Do NOT ship the super password or private key to customers.

Installing (Windows 10/11):
1) Run `AxEin Billing Desktop_*_setup.exe`.
2) Launch the app; the setup wizard will open.
3) Enter license token or start 7-day trial.
4) Provide business details and pick the business template.
5) Finish and start billing.

Staff keygen:
1) Run `AxEin License Keygen_*_setup.exe` on staff machine only.
2) Enter super password, fill business/license limits, generate token.
3) Share ONLY the packed token (starts with L-) with the customer.

Logs:
- Billing app logs and support bundle are available under Profile > Logs (in-app).

Troubleshooting:
- If license validation fails, confirm the device ID the customer provides and re-issue a token if needed.
- If trial button is disabled, ensure the installation has not previously started a trial.
- For LAN host/client issues, rerun the LAN self-test: `npm run desktop:lan:selftest` (dev) or via Profile > Network.
