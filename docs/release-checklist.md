# Desktop Release Checklist

## Build preconditions
1. `npm ci` successful.
2. `npm run desktop:preflight` successful.
3. Local DB migration pass (`npm run desktop:db:migrate`) successful.
4. LAN security self-test pass (`npm run desktop:lan:selftest`).

## Build and package
1. `npm run desktop:web:build`
2. `npm run desktop:prepare-runtime`
3. `npm run desktop:bundle-node`
4. `npm run desktop:smoke`
5. `npm run desktop:build`
6. `npm run desktop:release:metadata`

## Verify artifacts
1. NSIS installer exists under `desktop/src-tauri/target/release/bundle/nsis`.
2. SHA256 sums file generated under `desktop/release/SHA256SUMS.txt`.
3. Installer launches app and `/api/health` returns `ok=true`.

## Functional gates
1. Register business flow works.
2. Signup + admin approval flow works.
3. License key activation works with staff keygen output.
4. Logs can be downloaded from Profile > Logs.
5. Revenue visibility remains admin-only.
