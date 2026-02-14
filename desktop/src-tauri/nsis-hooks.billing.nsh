; NSIS hook macros for AxEin Billing Desktop installer
; Runs before file copy to avoid "Error opening file for writing" during upgrades/re-installs.

!macro NSIS_HOOK_PREINSTALL
  ; Stop the running app (if any)
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "AxEin Billing Desktop.exe" /T'
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "axein-billing-desktop.exe" /T'

  ; Stop orphan Node runtimes spawned by this app (scoped by install path)
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=''SilentlyContinue''; $base = Join-Path $env:LOCALAPPDATA ''AxEin Billing Desktop''; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like ($base + ''\\*\\node.exe'')) } | Stop-Process -Force; Start-Sleep -Milliseconds 300"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Best effort: stop app + its node runtime so uninstall doesn't fail on locked files.
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "AxEin Billing Desktop.exe" /T'
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "axein-billing-desktop.exe" /T'
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=''SilentlyContinue''; $base = Join-Path $env:LOCALAPPDATA ''AxEin Billing Desktop''; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like ($base + ''\\*\\node.exe'')) } | Stop-Process -Force; Start-Sleep -Milliseconds 300"'
!macroend
