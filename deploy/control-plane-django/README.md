# AxEin billing control-plane extension

This patch extends the existing `axein.in/admin/billing` Django application with
SaaS tenant, plan, seat, module, date and synchronization controls. The deployed
operational ledger remains a separate Next.js/PostgreSQL service.

Apply from the Django project root only after taking a database and source backup:

```bash
patch -p1 < billing-portal-saas.patch
python manage.py makemigrations billing_portal --check --dry-run
python manage.py check
python manage.py test billing_portal
python manage.py migrate billing_portal --noinput
```

Required protected environment variables:

```text
AXEIN_SAAS_BASE_URL=http://127.0.0.1:3200
AXEIN_SAAS_CONTROL_CLIENT=axein-control-room
AXEIN_SAAS_CONTROL_SECRET=<same generated value used by the SaaS runtime>
```

Never commit the secret or store it in `SaasTenant`. Staff provision or update
tenants using the Django admin action **Provision or sync selected tenants to
AxEin SaaS**.
