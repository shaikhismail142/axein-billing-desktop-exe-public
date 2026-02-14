; NSIS hook macros for AxEin License Keygen installer
; Prevents file lock errors when reinstalling/upgrading (node.exe inside _up_ runtime).

!macro NSIS_HOOK_PREINSTALL
  ; Stop the running app (if any)
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "AxEin License Keygen.exe" /T'
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "axein-license-keygen.exe" /T'

  ; Stop orphan Node runtimes spawned by this app (scoped by install path)
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=''SilentlyContinue''; $base = Join-Path $env:LOCALAPPDATA ''AxEin License Keygen''; function Kill-NodeForBase($b) { for ($i=0; $i -lt 24; $i++) { $procs = @(Get-CimInstance Win32_Process -Filter \"Name=''node.exe''\" | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath -like ($b + ''\\*'')) -or ($_.CommandLine -and $_.CommandLine -like (''*'' + $b + ''*'')) }); if (!$procs -or $procs.Count -eq 0) { break }; foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; Start-Sleep -Milliseconds 350 }; }; function Wait-Unlocked($p) { if (!(Test-Path $p)) { return }; for ($j=0; $j -lt 30; $j++) { try { $fs = [System.IO.File]::Open($p,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); $fs.Close(); return } catch { Start-Sleep -Milliseconds 350 } }; }; Kill-NodeForBase $base; Wait-Unlocked (Join-Path $base ''_up_\\runtime\\node\\node.exe''); Wait-Unlocked (Join-Path $base ''runtime\\node\\node.exe''); Start-Sleep -Milliseconds 350"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "AxEin License Keygen.exe" /T'
  nsExec::Exec '"$SYSDIR\\taskkill.exe" /F /IM "axein-license-keygen.exe" /T'
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference=''SilentlyContinue''; $base = Join-Path $env:LOCALAPPDATA ''AxEin License Keygen''; function Kill-NodeForBase($b) { for ($i=0; $i -lt 24; $i++) { $procs = @(Get-CimInstance Win32_Process -Filter \"Name=''node.exe''\" | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath -like ($b + ''\\*'')) -or ($_.CommandLine -and $_.CommandLine -like (''*'' + $b + ''*'')) }); if (!$procs -or $procs.Count -eq 0) { break }; foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; Start-Sleep -Milliseconds 350 }; }; function Wait-Unlocked($p) { if (!(Test-Path $p)) { return }; for ($j=0; $j -lt 30; $j++) { try { $fs = [System.IO.File]::Open($p,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None); $fs.Close(); return } catch { Start-Sleep -Milliseconds 350 } }; }; Kill-NodeForBase $base; Wait-Unlocked (Join-Path $base ''_up_\\runtime\\node\\node.exe''); Wait-Unlocked (Join-Path $base ''runtime\\node\\node.exe''); Start-Sleep -Milliseconds 350"'
!macroend
