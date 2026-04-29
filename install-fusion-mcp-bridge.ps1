# install-fusion-mcp-bridge.ps1
# -----------------------------------------------------------------
# Terminal-only installer for ndoo/fusion360-mcp-bridge.
# Run this AFTER cloning the bridge to your APPS folder:
#     cd C:\Users\danse\APPS
#     git clone https://github.com/ndoo/fusion360-mcp-bridge.git
#
# Then from the workspace folder (b-spline-generator-web-addin):
#     powershell -ExecutionPolicy Bypass -File .\install-fusion-mcp-bridge.ps1
#
# What it does (all idempotent -- safe to re-run):
#   1. Verifies Python >= 3.9 and the bridge clone path
#   2. Installs the MCP server's Python deps (pip --user)
#   3. Generates ~/.fusion-mcp-secret with mode 600-equivalent ACLs
#   4. Copies fusion-addin/FusionMCPBridge into Fusion's AddIns folder
#   5. Writes the mcpServers JSON snippet to a file you can paste,
#      AND attempts to merge it into Claude Desktop's config
#   6. Prints the two manual steps remaining (Fusion auto-runs the
#      add-in on next launch since runOnStartup=true; Claude Desktop
#      restart picks up the new MCP server)
# -----------------------------------------------------------------

param(
    [string]$BridgePath = "$env:USERPROFILE\APPS\fusion360-mcp-bridge",
    [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Warn($msg)     { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Fail($msg)     { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

# -----------------------------------------------------------------
# 1. Validate inputs
# -----------------------------------------------------------------
Step 1 "Validating inputs"

if (-not (Test-Path $BridgePath)) {
    Fail "Bridge clone not found at $BridgePath. Pass -BridgePath if you cloned elsewhere."
}
$addinSource = Join-Path $BridgePath "fusion-addin\FusionMCPBridge"
$serverSource = Join-Path $BridgePath "mcp-server\server.py"
$reqFile      = Join-Path $BridgePath "mcp-server\requirements.txt"
foreach ($p in @($addinSource, $serverSource, $reqFile)) {
    if (-not (Test-Path $p)) { Fail "Missing expected file/dir: $p" }
}
Ok "Bridge clone looks complete"

try {
    $pyVersionRaw = & $PythonExe --version 2>&1
    if ($pyVersionRaw -match "Python (\d+)\.(\d+)") {
        $major = [int]$Matches[1]; $minor = [int]$Matches[2]
        if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 9)) {
            Fail "Python 3.9+ required, found $pyVersionRaw"
        }
        Ok "Python OK: $pyVersionRaw"
    } else {
        Fail "Could not parse Python version from: $pyVersionRaw"
    }
} catch {
    Fail "Python not found at '$PythonExe'. Pass -PythonExe with the full path."
}

# -----------------------------------------------------------------
# 2. Install pip deps
# -----------------------------------------------------------------
Step 2 "Installing MCP server Python dependencies"
& $PythonExe -m pip install -r $reqFile --user --quiet
if ($LASTEXITCODE -ne 0) { Fail "pip install failed" }
Ok "Dependencies installed (pip --user)"

# -----------------------------------------------------------------
# 3. Generate shared secret
# -----------------------------------------------------------------
Step 3 "Generating shared secret"
$secretPath = Join-Path $env:USERPROFILE ".fusion-mcp-secret"
if (Test-Path $secretPath) {
    Ok "Secret already exists at $secretPath -- leaving as-is"
} else {
    $secret = & $PythonExe -c "import secrets; print(secrets.token_hex(32), end='')"
    Set-Content -Path $secretPath -Value $secret -NoNewline -Encoding ASCII
    # Lock down ACLs so only the owner can read/write
    icacls $secretPath /inheritance:r | Out-Null
    icacls $secretPath /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    Ok "Secret written to $secretPath (owner-only ACLs)"
}

# -----------------------------------------------------------------
# 4. Deploy the Fusion add-in
# -----------------------------------------------------------------
Step 4 "Deploying FusionMCPBridge add-in"
$addinTarget = Join-Path $env:APPDATA "Autodesk\Autodesk Fusion 360\API\AddIns\FusionMCPBridge"
if (-not (Test-Path (Split-Path $addinTarget -Parent))) {
    Fail "AddIns folder not found at $(Split-Path $addinTarget -Parent). Is Fusion 360 installed for this user?"
}
if (Test-Path $addinTarget) {
    Warn "Existing FusionMCPBridge folder found -- will overwrite contents"
}
robocopy $addinSource $addinTarget /E /NFL /NDL /NJH /NJS /NP | Out-Null
# robocopy exits 1 on success-with-copies, treat 0-7 as success
if ($LASTEXITCODE -ge 8) { Fail "robocopy failed (exit $LASTEXITCODE)" }
Ok "Add-in deployed to $addinTarget"

# -----------------------------------------------------------------
# 5. Compose mcpServers JSON entry and attempt merge
# -----------------------------------------------------------------
Step 5 "Configuring Claude MCP servers"

$serverArgs = @($serverSource)
$mcpEntry = @{
    command = $PythonExe
    args    = $serverArgs
}

# Snippet file that the user can paste manually if auto-merge declines
$snippetPath = Join-Path $PSScriptRoot "fusion-mcp-snippet.json"
$snippet = @{ mcpServers = @{ fusion360 = $mcpEntry } } | ConvertTo-Json -Depth 6
Set-Content -Path $snippetPath -Value $snippet -Encoding UTF8
Ok "Snippet written to $snippetPath (paste into your Claude config if auto-merge fails)"

# Try Claude Desktop config first (most relevant for Cowork mode)
$claudeDesktopCfg = Join-Path $env:APPDATA "Claude\claude_desktop_config.json"
$claudeCodeCfg    = Join-Path $env:USERPROFILE ".claude\settings.json"

function Merge-McpServer($cfgPath, $label) {
    if (-not (Test-Path $cfgPath)) {
        Warn "$label config not found at $cfgPath -- skipping"
        return
    }
    try {
        $existing = Get-Content $cfgPath -Raw | ConvertFrom-Json
    } catch {
        Warn "$label config at $cfgPath is not valid JSON -- skipping (paste snippet manually)"
        return
    }
    if (-not $existing.PSObject.Properties.Match("mcpServers").Count) {
        $existing | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue (@{})
    }
    $existing.mcpServers | Add-Member -NotePropertyName "fusion360" -NotePropertyValue $mcpEntry -Force
    # Backup before overwrite
    Copy-Item $cfgPath "$cfgPath.bak" -Force
    $existing | ConvertTo-Json -Depth 10 | Set-Content $cfgPath -Encoding UTF8
    Ok "$label config updated (backup at $cfgPath.bak)"
}

Merge-McpServer $claudeDesktopCfg "Claude Desktop"
Merge-McpServer $claudeCodeCfg    "Claude Code"

# -----------------------------------------------------------------
# 6. Done -- print remaining manual steps
# -----------------------------------------------------------------
Write-Host "`n========================================================" -ForegroundColor Magenta
Write-Host " Install complete. Two manual steps remain:" -ForegroundColor Magenta
Write-Host "========================================================" -ForegroundColor Magenta
Write-Host @"

  1. Restart Claude Desktop / Cowork (so it picks up the new
     MCP server entry).

  2. The Fusion add-in is set to runOnStartup=true, so it loads
     automatically next time you open Fusion 360. If Fusion is
     already running, either restart it OR open Tools -> Add-Ins
     (Shift+S), find FusionMCPBridge under My Add-Ins, click Run.

  After both: ask Claude to call fusion_execute or
  fusion_screenshot to verify.

"@ -ForegroundColor White
