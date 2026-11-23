# tools/heavy-run.ps1 <eta-min> <command...> -- the PowerShell door to tools/heavy-run.sh (the lock is bash). Vitest must be
# run from PowerShell with an uppercase D:\ path in this repo:
#   powershell -File D:\APPS\...\tools\heavy-run.ps1 15 npx vitest run
# heavy-run.sh's bash stays alive for the whole run, so the lock never looks stale. Exits with the command's status.
param([Parameter(Mandatory = $true, Position = 0)][string]$EtaMin, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Command)
if (-not $Command -or $Command.Count -eq 0) { Write-Error 'usage: heavy-run.ps1 <eta-min> <command...>'; exit 2 }
$bash = 'C:/Program Files/Git/bin/bash.exe'
if (-not (Test-Path $bash)) { $bash = (Get-Command bash -ErrorAction Stop).Source }
$sh = (Join-Path $PSScriptRoot 'heavy-run.sh').Replace([string][char]92, '/')
& $bash $sh $EtaMin @Command
exit $LASTEXITCODE
