# AxEin Billing Desktop Troubleshooting (Customer)

This page is for quick diagnostics on Windows 10/11. If you are not comfortable running commands, share this file with your IT/support team.

## Basic Checks

1. Restart the app (close it fully, then open again).
2. Restart the PC.
3. Make sure you installed the latest build from AxEin support.

## Check If The Local Server Is Running

AxEin Billing Desktop runs a local server and the UI connects to it.

PowerShell:

```powershell
$port=3199
Test-NetConnection 127.0.0.1 -Port $port
Invoke-RestMethod "http://127.0.0.1:$port/api/health"
Invoke-RestMethod "http://127.0.0.1:$port/api/license/status"
```

Expected:

- `api/health` returns `ok : True`
- `api/license/status` returns license/trial details

If `Test-NetConnection` fails:

- The runtime did not start, or another process is using the port.

## Find Running Processes And Ports

PowerShell:

```powershell
Get-Process | Where-Object { $_.ProcessName -match "AxEin|axein|node" } | Select-Object ProcessName,Id
netstat -ano | findstr ":3199"
```

If port `3199` is used by another app, AxEin cannot start its server.

## Restart The App Cleanly

PowerShell:

```powershell
taskkill /IM "AxEin Billing Desktop.exe" /F 2>$null
Start-Process "$env:LOCALAPPDATA\Programs\AxEin Billing Desktop\AxEin Billing Desktop.exe"
```

If the EXE path does not exist, reinstall the app.

## Activation Issues

If activation fails:

- Prefer pasting the **Activation Token** (single line starting with `L-...`) into the license box.
- If using JSON, ensure it includes a `signature` field.

If you see “Forbidden”:

- You may be using a token issued for a different device.
- Share the **Device ID** shown on the license screen with AxEin support.

## Print / PDF Issues

If A4 preview or PDF download doesn’t work:

1. Verify server health (see above).
2. Open the invoice/purchase again and retry `Download PDF`.
3. Try `Print / Save` and choose “Microsoft Print to PDF” (Windows) to confirm print pipeline works.

## Blank/White Screen

Common causes:

- Server not running on `127.0.0.1:3199`
- Blocked local loopback by security software
- Corrupted runtime update folder

Try:

```powershell
Invoke-RestMethod "http://127.0.0.1:3199/api/health"
```

If it fails, reinstall using the latest installer.

## Collect Support Bundle

If the app provides a “Support Bundle” download in Profile/Logs, download it and share it with support.

## What To Share With Support

- Windows version (10/11) and whether it is 64-bit
- App version (from About/Settings if available)
- Device ID (from activation screen)
- Output of the `api/health` and `api/license/status` commands
- A short description of what you clicked and what happened

