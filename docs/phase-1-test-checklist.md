# Phase 1 Test Checklist

## 1. Apply migration
```bash
# Example using local psql
psql "$DATABASE_URL" -f db/migrations/20260211_rbac_multibusiness_foundation.sql
```

## 2. Start app
```bash
npm run dev
```

## 3. Register business flow
1. Open `/register-business`
2. Submit business + owner details.
3. Confirm business and owner records are created.

## 4. Signup + approval flow
1. Open `/signup` and create a signup request.
2. Open `/profile/users` as admin/approver.
3. Approve pending user with selected role.

## 5. Access summary API
```bash
curl "http://localhost:3000/api/profile/access?business_id=1&user_id=1"
```
Verify `access.revenue_visible` is true only for admin-permitted users.

## 6. Logging flow
1. POST app log:
```bash
curl -X POST http://localhost:3000/api/logs \
  -H "Content-Type: application/json" \
  -d '{"message":"test log","level":"info","source":"manual"}'
```
2. Open `/profile/logs`
3. Download NDJSON from `/api/logs?format=ndjson`

## 7. License keygen (staff)
```bash
export AXEIN_STAFF_PASSWORD='your-secret'
node tools/license-keygen/issue-license.js issue --staff-pass 'your-secret'
```
Activate in app using `packed_token` against `/api/license/verify-key`.
