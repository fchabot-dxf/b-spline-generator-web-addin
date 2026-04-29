# install-fusion-mcp-extension.ps1
# -----------------------------------------------------------------
# Stage the DXT manifest into the bridge clone so Cowork can install
# it as an Unpacked Extension.
#
# After running this, in Cowork:
#   Settings -> Extensions -> Install Unpacked Extension
#   -> select  C:\Users\danse\APPS\fusion360-mcp-bridge
#
# The folder already contains the MCP server code; this script just
# adds the manifest.json that Cowork's extension loader expects.
# -----------------------------------------------------------------

param(
    [string]$BridgePath = "$env:USERPROFILE\APPS\fusion360-mcp-bridge",
    [string]$ManifestSource = "$PSScriptRoot\fusion-mcp-manifest.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BridgePath)) {
    Write-Host "[FAIL] Bridge clone not found at $BridgePath" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $ManifestSource)) {
    Write-Host "[FAIL] Manifest source not found at $ManifestSource" -ForegroundColor Red
    exit 1
}

$manifestTarget = Join-Path $BridgePath "manifest.json"
Copy-Item $ManifestSource $manifestTarget -Force
Write-Host "[OK] manifest.json staged at $manifestTarget" -ForegroundColor Green

Write-Host @"

========================================================
 Next step (one click):
========================================================

  In Cowork (Claude Desktop):
    Settings -> Extensions -> Install Unpacked Extension
    Select folder: $BridgePath

  After install, the fusion_execute and fusion_screenshot
  tools should appear. Make sure the FusionMCPBridge
  add-in is also running inside Fusion 360.

"@ -ForegroundColor White
