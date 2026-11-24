# tools/heavy-run.ps1 <eta-min> <command...> -- the PowerShell door to tools/heavy-run.sh (the lock is bash). Vitest must be
# run from PowerShell with an uppercase D:\ path in this repo:
#   powershell -ExecutionPolicy Bypass -File D:\APPS\...\tools\heavy-run.ps1 15 npx vitest run
# heavy-run.sh's bash stays alive for the whole run, so the lock never looks stale. Exits with the command's status.
# No param() block on purpose: a command's own "-e" would be taken as an abbreviation of a parameter name.
if ($args.Count -lt 2) { Write-Error 'usage: heavy-run.ps1 <eta-min> <command...>'; exit 2 }
$bash = 'C:/Program Files/Git/bin/bash.exe'
if (-not (Test-Path $bash)) { $bash = (Get-Command bash -ErrorAction Stop).Source }
$sh = (Join-Path $PSScriptRoot 'heavy-run.sh').Replace([string][char]92, '/')
& $bash $sh @args
exit $LASTEXITCODE
