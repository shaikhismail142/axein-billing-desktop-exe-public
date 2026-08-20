# AxEin SaaS / Defenzo deployment

## Security boundary

`AXEIN_DEPLOYMENT_MODE=saas` is mandatory. It disables desktop tenant headers,
LAN identity, activation screens, keygen screens and the default session secret.
Never expose the app with desktop deployment mode on a public host.

## First deployment

1. Provision a supported Linux VPS, Docker Engine, a TLS reverse proxy and DNS for
   `billing.axein.in`.
2. Copy `.env.saas.example` to `.env.saas` outside source control and replace every
   placeholder with generated secrets.
   Use the same `AXEIN_CONTROL_PLANE_SECRET` in the protected Django service
   environment; it is never stored in a tenant or integration database row.
3. Start PostgreSQL, apply migrations, then start the application:

```bash
docker compose --env-file .env.saas -f docker-compose.saas.yml up -d db
docker compose --env-file .env.saas -f docker-compose.saas.yml run --rm app node desktop/scripts/apply-migrations.mjs
docker compose --env-file .env.saas -f docker-compose.saas.yml up -d app
curl --fail https://billing.axein.in/api/health
```

4. Create one active `is_system_admin` user with a strong password, sign in through
   `/login`, and open `/platform/tenants`.
5. Create the Defenzo tenant in draft mode, set the automotive template, and create
   the Defenzo integration. Store the displayed secret immediately.
6. Set `AXEIN_INTEGRATION_SECRET_DEFENZO` to that secret and restart the app.
7. Put the client key and same secret in
   `/home/u455196571/private/axein-integration.php` on Defenzo. Keep `enabled=false`
   until staging SSO and migration reconciliation pass.

Defenzo customer and vehicle create/edit actions and job-card creation write to
`axein_sync_outbox`. Delivery is idempotent, HMAC-signed and retried with exponential
backoff. Enabling the integration starts delivery; a failed AxEin request never rolls
back the Defenzo transaction.

SaaS logos are stored under tenant-specific prefixes in the configured private
S3-compatible bucket and are streamed only after tenant authentication. Do not use
ephemeral container storage for customer assets.

## Backups

Run a nightly encrypted `pg_dump --format=custom`, retain 7 daily, 5 weekly and 12
monthly copies in storage separate from the VPS, and perform a test restore monthly.
Object storage versioning must be enabled for logos and document attachments.

## Release checks

```bash
npm ci
npm run saas:selftest
npm run saas:build
npm run desktop:lan:selftest
npm run desktop:keygen:selftest
docker compose --env-file .env.saas -f docker-compose.saas.yml config
```

Do not enable Defenzo until SSO replay, tenant isolation, role mapping, expiry/read-only,
event idempotency, invoice totals, PDF/thermal printing and backup restoration pass.
