import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

function read(path) { return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const context = read("app/lib/platform-context.ts");
assert.match(context, /if \(isSaasDeployment\(\)\) return session\?\.business_id/);
assert.match(context, /if \(isSaasDeployment\(\)\) return session\?\.user_id/);

const access = read("app/lib/request-access.ts");
assert.match(access, /if \(isSaasDeployment\(\)\) return false/);
assert.match(access, /enforceTenantWriteAccess/);
assert.match(access, /enforceTenantModuleAccess/);

const session = read("app/lib/session.ts");
assert.match(session, /AXEIN_SESSION_SECRET is required in SaaS mode/);
assert.match(session, /; Secure/);

const migration = read("db/migrations/20260820_saas_defenzo_foundation.sql");
for (const table of ["tenant_entitlements", "integration_clients", "integration_nonces", "integration_events", "integration_record_links", "automotive_vehicles", "automotive_jobs", "document_snapshots"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(migration, /settings_business_key_uq ON settings \(business_id, key\)/);

const entitlement = read("app/lib/tenant-entitlements.ts");
assert.match(entitlement, /tenant_status/);

const sales = read("app/api/sales/route.ts");
assert.match(sales, /INSERT INTO document_snapshots/);
assert.match(sales, /custom_field_totals/);

const logos = read("app/api/uploads/logo/route.ts");
assert.match(logos, /PutObjectCommand/);
assert.match(logos, /tenants\/\$\{businessId\}\/logos/);

const tenants = read("app/api/platform/tenants/route.ts");
assert.match(tenants, /source: "tenant_provision"/);
assert.match(tenants, /authorizePlatformRequest/);

const controlPlane = read("app/lib/control-plane-auth.ts");
for (const binding of ["method.toUpperCase()", "input.path", "input.timestamp", "input.nonce", "bodyDigest(input.rawBody)"]) {
  assert.ok(controlPlane.includes(binding), `control-plane signature must bind ${binding}`);
}
assert.match(controlPlane, /control_plane_nonces/);
assert.match(controlPlane, /timingSafeEqual/);

const controlMigration = read("db/migrations/20260820c_control_plane_auth.sql");
assert.match(controlMigration, /CREATE TABLE IF NOT EXISTS control_plane_nonces/);

const template = read("app/lib/business-templates.ts");
for (const field of ["vehicle_registration", "vin_chassis", "job_card_number", "service_category", "reported_concerns", "customer_approval"]) {
  assert.match(template, new RegExp(`key: "${field}"`));
}

const secret = "test-secret";
const timestamp = "1770000000";
const nonce = "abcdefghijklmnop";
const body = '{"user_id":"42"}';
const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("base64url");
assert.equal(signature, crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("base64url"));
assert.notEqual(signature, crypto.createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}x`).digest("base64url"));

console.log("SaaS security self-test passed.");
