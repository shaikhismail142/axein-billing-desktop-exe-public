# AxEin Desktop Post-Install Troubleshooting

Use these commands on customer machines when app pages fail (`404`), keygen does not open, or runtime APIs are unavailable.

## Windows PowerShell

### 1) Verify installed executables

```powershell
Get-ChildItem "$env:LOCALAPPDATA\Programs" -Directory | Where-Object Name -like "AxEin*"
Get-ChildItem "$env:LOCALAPPDATA\Programs\AxEin Billing Desktop" -Recurse -Filter *.exe -ErrorAction SilentlyContinue
Get-ChildItem "$env:LOCALAPPDATA\Programs\AxEin License Keygen" -Recurse -Filter *.exe -ErrorAction SilentlyContinue
```

### 2) Start app and check runtime APIs

```powershell
$billingExe = Get-ChildItem "$env:LOCALAPPDATA\Programs\AxEin Billing Desktop" -Recurse -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
Start-Process $billingExe
Start-Sleep -Seconds 2
$port=3199
Test-NetConnection 127.0.0.1 -Port $port
Invoke-RestMethod "http://127.0.0.1:$port/api/health"
Invoke-RestMethod "http://127.0.0.1:$port/api/license/status"
Invoke-RestMethod "http://127.0.0.1:$port/api/auth/session"
```

### 3) Check runtime packaging path (billing or keygen)

```powershell
$base="$env:LOCALAPPDATA\AxEin Billing Desktop"
Get-ChildItem "$base" -Recurse -Filter server.js -ErrorAction SilentlyContinue | Select-Object FullName
Get-ChildItem "$base" -Recurse -Filter "ed25519-private.pem" -ErrorAction SilentlyContinue | Select-Object FullName
```

### 4) Collect runtime logs

```powershell
Get-ChildItem "$env:APPDATA\com.axein.billing.desktop\logs" -ErrorAction SilentlyContinue
Get-Content "$env:APPDATA\com.axein.billing.desktop\logs\runtime.stderr.log" -Tail 200 -ErrorAction SilentlyContinue
Get-Content "$env:APPDATA\com.axein.billing.desktop\logs\runtime.stdout.log" -Tail 200 -ErrorAction SilentlyContinue
```

### 5) Recover from stale updater/runtime folder

```powershell
taskkill /IM "AxEin Billing Desktop.exe" /F
$base="$env:LOCALAPPDATA\AxEin Billing Desktop"
if (Test-Path "$base\_up_") { Rename-Item "$base\_up_" "_up__bak_$(Get-Date -Format yyyyMMddHHmmss)" }
$billingExe = Get-ChildItem "$env:LOCALAPPDATA\Programs\AxEin Billing Desktop" -Recurse -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
Start-Process $billingExe
```

### 6) Keygen API smoke check (inside keygen app runtime)

```powershell
$keygenExe = Get-ChildItem "$env:LOCALAPPDATA\Programs\AxEin License Keygen" -Recurse -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
Start-Process $keygenExe
Start-Sleep -Seconds 3
$port=3199
Invoke-RestMethod "http://127.0.0.1:$port/api/health"
Invoke-RestMethod "http://127.0.0.1:$port/api/staff/keygen/issue" -Method Post -Headers @{"Content-Type"="application/json";"x-admin"="1"} -Body '{"super_password":"invalid","email":"x@example.com","business_name":"X","business_type":"general_store","user_limit":1,"computer_limit":1,"validity_months":1}'
```

Expected: endpoint responds `403` (super password validation failed).  
If it returns `404 Not available on this install`, that machine has billing runtime (not keygen runtime).

## macOS/Linux quick checks

```bash
PORT=3199
curl -s "http://127.0.0.1:$PORT/api/health"
curl -s "http://127.0.0.1:$PORT/api/license/status"
curl -s "http://127.0.0.1:$PORT/api/auth/session"
```

### macOS local v1 flow (before downloading Windows package)

```bash
# Billing runtime smoke
npm run desktop:prepare-runtime
npm run desktop:smoke

# Keygen runtime smoke
node ./desktop/scripts/build-keygen-runtime.mjs
npm run desktop:keygen:selftest
```
