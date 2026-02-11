# LAN Mode Design (Desktop)

## Objective
Enable one licensed AxEin business to run across multiple PCs in LAN mode while preserving role-based restrictions and auditability.

## Components
1. `lan_host_configs`
- Per-business host settings and host secret.
- Controls `mode`, `allow_pairing`, and network bind/port.

2. `lan_pairing_sessions`
- Short-lived pairing codes (hashed with host secret).
- Time-bound and usage-bound to prevent replay.

3. `lan_clients`
- Registered LAN clients with role assignment.
- Token hash stored server-side; raw token returned once at pairing.
- Status lifecycle: `pending` -> `active` -> `revoked`.

4. `lan_sync_jobs` / `lan_sync_events`
- Foundation tables for sync orchestration and event tracking.

## API surface
- `GET /api/lan/status`
- `PUT /api/lan/host/configure`
- `POST /api/lan/host/pairing-code`
- `POST /api/lan/pair/complete`
- `POST /api/lan/client/heartbeat`
- `GET /api/lan/clients`
- `POST /api/lan/clients/[client_uid]/approve`
- `POST /api/lan/clients/[client_uid]/revoke`
- `PUT /api/lan/clients/[client_uid]/role`
- `POST /api/lan/sync/events/push`
- `GET /api/lan/sync/events/pull`
- `POST /api/lan/sync/events/ack`
- `GET /api/lan/sync/status`

## Security controls
1. Pairing code hashes are stored, not raw values.
2. Client tokens are hashed with host secret and compared using timing-safe checks.
3. Seat limit is enforced during pairing using active license/business user limits.
4. Sync event writes support idempotency via `source_event_uid` unique keys.
5. LAN admin APIs and report/revenue APIs respect RBAC and business isolation.

## UI
- `Profile > Network (LAN)` for host config, pairing code generation, and client lifecycle management.
