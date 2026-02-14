; NSIS hook macros for AxEin License Keygen installer
; Prevents file lock errors when reinstalling/upgrading (node.exe inside _up_ runtime).

!macro NSIS_HOOK_PREINSTALL
  ; Stop the running app (if any)
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "AxEin License Keygen.exe" /T'
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "axein-license-keygen.exe" /T'

  ; Stop orphan Node runtimes spawned by this app (scoped by install path)
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=''SilentlyContinue''; $base = Join-Path $env:LOCALAPPDATA ''AxEin License Keygen''; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like ($base + ''\\*\\node.exe'')) } | Stop-Process -Force; Start-Sleep -Milliseconds 300"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "AxEin License Keygen.exe" /T'
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "axein-license-keygen.exe" /T'
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=''SilentlyContinue''; $base = Join-Path $env:LOCALAPPDATA ''AxEin License Keygen''; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like ($base + ''\\*\\node.exe'')) } | Stop-Process -Force; Start-Sleep -Milliseconds 300"'
!macroend
