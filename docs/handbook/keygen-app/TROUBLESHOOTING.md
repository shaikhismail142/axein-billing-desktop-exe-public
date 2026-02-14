# AxEin License Keygen Troubleshooting (Staff)

This page is for AxEin staff diagnosing Keygen issues on Windows 10/11.

## Basic Checks

1. Close Keygen completely and reopen.
2. Restart the PC.
3. Ensure you installed the latest Keygen build from the AxEin release artifact.

## Check If Keygen Server Is Running (Port 3299)

PowerShell:

```powershell
$port=3299
Test-NetConnection 127.0.0.1 -Port $port
Invoke-RestMethod "http://127.0.0.1:$port/api/health"
Invoke-RestMethod "http://127.0.0.1:$port/api/staff/keygen/unlock"
```

Expected:

- `api/health` returns `ok : True`
- `api/staff/keygen/unlock` returns `available : True` when the private key is present

## “Not available on this install”

Meaning:

- Keygen was installed without the private key material, or
- You are running the Billing installer instead of Keygen

Fix:

- Reinstall using the Keygen installer from the latest GitHub Actions artifact.

## “Admin context required”

Keygen staff APIs require `x-admin: 1`.

When testing via PowerShell, include it:

```powershell
Invoke-RestMethod "http://127.0.0.1:3299/api/staff/keygen/history?page=1" -Headers @{ "x-admin"="1" }
```

Note:

- The Keygen UI sets this automatically for its own requests.

## Unlock Flow (PowerShell)

Unlock uses an HTTP-only cookie, so keep a session.

```powershell
$super = "<SUPER_PASSWORD>"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Invoke-WebRequest "http://127.0.0.1:3299/api/staff/keygen/unlock" -Method Post -WebSession $s `
  -Headers @{ "Content-Type"="application/json"; "x-admin"="1" } `
  -Body (@{ super_password = $super } | ConvertTo-Json)

Invoke-RestMethod "http://127.0.0.1:3299/api/staff/keygen/unlock" -WebSession $s
```

Expected:

- `unlocked : True`

## Issue A License (PowerShell)

```powershell
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# 1) Unlock first (see above)

# 2) Issue
$body = @{
  mode="new"
  email="customer@example.com"
  business_name="Customer Business"
  business_type="general_store"
  usage_mode="standalone"
  user_limit=5
  computer_limit=1
  license_type="standard"
  validity_months=12
  installation_scope="single_pc"
  features="billing,inventory,quotations,reports,logs"
}

Invoke-RestMethod "http://127.0.0.1:3299/api/staff/keygen/issue" -Method Post -WebSession $s `
  -Headers @{ "Content-Type"="application/json"; "x-admin"="1" } `
  -Body ($body | ConvertTo-Json)
```

## White/Blank Screen

Most common causes:

- Server is running but UI route is blocked/failed to load
- Port conflict or partial update state

Quick checks:

```powershell
Test-NetConnection 127.0.0.1 -Port 3299
Invoke-RestMethod "http://127.0.0.1:3299/api/health"
Start-Process "http://127.0.0.1:3299/staff/keygen"
```

If health is OK but UI is blank:

- Reinstall Keygen with the latest installer

## Find The Installed EXE

```powershell
Get-ChildItem "$env:LOCALAPPDATA\\Programs" -Recurse -Filter "AxEin License Keygen.exe" -ErrorAction SilentlyContinue | Select-Object -First 5 FullName
```

## Logs And Crash Dumps

Depending on build and runtime, logs may exist under:

- `%APPDATA%\\com.axein.billing.keygen\\logs`
- `%LOCALAPPDATA%\\CrashDumps`

PowerShell:

```powershell
$logDir="$env:APPDATA\\com.axein.billing.keygen\\logs"
Get-ChildItem $logDir -ErrorAction SilentlyContinue
Get-Content "$logDir\\runtime.stderr.log" -Tail 200 -ErrorAction SilentlyContinue
Get-Content "$logDir\\runtime.stdout.log" -Tail 200 -ErrorAction SilentlyContinue

Get-ChildItem "$env:LOCALAPPDATA\\CrashDumps" -ErrorAction SilentlyContinue | `
  Sort-Object LastWriteTime -Descending | Select-Object -First 10 FullName,LastWriteTime
```

