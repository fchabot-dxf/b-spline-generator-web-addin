<# : install-bspline-addin.cmd -- installs the bspline-frame-builder add-in for Autodesk Fusion (Windows)
@echo off
rem Double-click this file. No admin rights needed: it writes only to your own Fusion AddIns folder.
rem The first line is a batch label to cmd.exe and opens a comment to PowerShell, so the same text also runs as
rem     irm https://bspline-generator.pages.dev/install-bspline-addin.cmd ^| iex
rem pasted into PowerShell (that route shows no download warning).
rem Testing: set BSPLINE_ADDINS_DIR (or pass the folder as the first argument) to install somewhere else;
rem BSPLINE_ZIP_URL / BSPLINE_SHA256_URL override the download; BSPLINE_NO_PAUSE=1 skips the closing pause.
setlocal
if not "%~1"=="" set "BSPLINE_ADDINS_DIR=%~1"
set "BSPLINE_SELF=%~f0"
set "BSPLINE_FROM_CMD=1"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText($env:BSPLINE_SELF))"
set "BSPLINE_RC=%ERRORLEVEL%"
if not defined BSPLINE_NO_PAUSE pause
exit /b %BSPLINE_RC%
#>

# ---- PowerShell part. Keep these steps in step with fb_shared/updater.py and install-bspline-addin.command. ----
# Exit codes: 0 installed | 1 unexpected error | 2 download failed (offline?) | 3 Fusion AddIns folder not found
#             4 checksum mismatch | 5 not the add-in zip | 6 files in use (close Fusion)

function Install-BsplineAddin {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $Name = 'bspline-frame-builder'
    $ReleaseBase = 'https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/'
    $ZipUrl = if ($env:BSPLINE_ZIP_URL) { $env:BSPLINE_ZIP_URL } else { $ReleaseBase + "$Name.zip" }
    $ShaUrl = if ($env:BSPLINE_SHA256_URL) { $env:BSPLINE_SHA256_URL } else { $ZipUrl + '.sha256' }
    $Override = [bool]$env:BSPLINE_ADDINS_DIR
    $AddIns = if ($Override) { $env:BSPLINE_ADDINS_DIR } else { Join-Path $env:APPDATA 'Autodesk\Autodesk Fusion 360\API\AddIns' }

    function Say($text) { Write-Host $text }
    function Fail([int]$code, $text) { Write-Host ''; Write-Host "ERROR: $text" -ForegroundColor Red; return $code }

    Say "Installing the $Name add-in for Autodesk Fusion"
    Say "  into $AddIns"

    # 1. the Fusion AddIns folder (Fusion makes API\ on first start; AddIns\ inside it may still be missing)
    if (-not (Test-Path -LiteralPath $AddIns -PathType Container)) {
        $api = Split-Path -Parent $AddIns
        if ((-not $Override) -and (Test-Path -LiteralPath $api -PathType Container)) {
            New-Item -ItemType Directory -Path $AddIns | Out-Null
        } else {
            return (Fail 3 "The Fusion AddIns folder was not found: $AddIns`n       Install Autodesk Fusion and start it once, then run this again.")
        }
    }

    foreach ($u in @($ZipUrl, $ShaUrl)) {
        if (-not ($u.StartsWith('https://') -or $u.StartsWith('file:'))) { return (Fail 2 "Refusing a non-https download: $u") }
    }
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("bspline-install-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $staging = $null
    try {
        # 2. download the zip and its published checksum
        $zip = Join-Path $tmp "$Name.zip"
        $sha = Join-Path $tmp "$Name.zip.sha256"
        $wc = New-Object Net.WebClient
        $wc.Headers.Add('User-Agent', 'bspline-frame-builder-installer')
        $current = $ShaUrl
        try {
            Say "Downloading the checksum..."
            $wc.DownloadFile($ShaUrl, $sha)
            $current = $ZipUrl
            Say "Downloading the add-in (about 40 MB)..."
            $wc.DownloadFile($ZipUrl, $zip)
        } catch {
            $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
            return (Fail 2 "The download failed. Are you online?`n       $($e.Message)`n       ($current)")
        } finally { $wc.Dispose() }

        # 3. checksum
        $m = [regex]::Match([IO.File]::ReadAllText($sha), '\b[0-9a-fA-F]{64}\b')
        if (-not $m.Success) { return (Fail 4 "The published checksum file is not readable ($ShaUrl).") }
        $want = $m.Value.ToLower()
        $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
        if ($got -ne $want) { return (Fail 4 "The download does not match its published checksum (damaged download, or the release is being updated). Try again in a minute.") }
        Say "Checksum OK ($($got.Substring(0, 12))...)"

        # 4. is it the add-in? one top folder bspline-frame-builder/ with the .py + .manifest, nothing outside it
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        try { $za = [IO.Compression.ZipFile]::OpenRead($zip) } catch { return (Fail 5 "The download is not a zip file.") }
        try { $names = @($za.Entries | ForEach-Object { $_.FullName.Replace('\', '/') }) } finally { $za.Dispose() }
        foreach ($n in $names) {
            if ((-not $n.StartsWith("$Name/")) -or $n.Contains(':') -or (($n.Split('/')) -contains '..')) {
                return (Fail 5 "The zip has an unexpected entry: $n")
            }
        }
        foreach ($req in @("$Name/$Name.py", "$Name/$Name.manifest")) {
            if ($names -notcontains $req) { return (Fail 5 "The zip is missing $req.") }
        }

        # 5. extract next to the add-in (same drive, so the swap is a rename). A SHORT staging name: Windows
        #    PowerShell cannot write paths over 260 characters and the add-in's deepest file is ~115 below AddIns.
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $staging = Join-Path $AddIns 'bsfb-new'
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $staging)
        $staged = Join-Path $staging $Name

        # 6. run on startup (the manifest's own key), written back without a BOM
        $mf = Join-Path $staged "$Name.manifest"
        $text = [IO.File]::ReadAllText($mf)
        $re = [regex]'("runOnStartup"\s*:\s*)(true|false)'
        if ($re.IsMatch($text)) { $text = $re.Replace($text, '${1}true', 1) }
        else { $text = ([regex]'\{').Replace($text, "{`n    `"runOnStartup`": true,", 1) }
        [IO.File]::WriteAllText($mf, $text, (New-Object Text.UTF8Encoding $false))

        # 7. back up the old install, swap the new one in
        $live = Join-Path $AddIns $Name
        $backup = $null
        if (Test-Path -LiteralPath $live) {
            $lock = Join-Path $live '.addin-running.lock'
            if (Test-Path -LiteralPath $lock) { Copy-Item -LiteralPath $lock -Destination $staged }
            $backup = Join-Path $AddIns "$Name.bak-$stamp"
            $n = 1
            while (Test-Path -LiteralPath $backup) { $n++; $backup = Join-Path $AddIns "$Name.bak-$stamp-$n" }
            $moved = $false
            for ($i = 0; ($i -lt 3) -and (-not $moved); $i++) {
                try { [IO.Directory]::Move($live, $backup); $moved = $true } catch { Start-Sleep -Milliseconds 400 }
            }
            if (-not $moved) { return (Fail 6 "Windows says files in $live are in use. Close Fusion, then run this again.") }
            Say "Backed up the old version to $(Split-Path -Leaf $backup)"
        }
        try { [IO.Directory]::Move($staged, $live) } catch {
            if ($backup) { [IO.Directory]::Move($backup, $live) }
            return (Fail 6 "Could not move the new version into place; the old one is back. Close Fusion and try again.")
        }

        # 8. keep only the newest backup
        $baks = @(Get-ChildItem -LiteralPath $AddIns -Directory | Where-Object { $_.Name -like "$Name.bak-*" } | Sort-Object Name)
        $keep = if ($backup) { Split-Path -Leaf $backup } elseif ($baks.Count) { $baks[-1].Name } else { '' }
        foreach ($b in $baks) {
            if ($b.Name -ne $keep) {
                try { Remove-Item -LiteralPath $b.FullName -Recurse -Force -ErrorAction Stop }
                catch { Say "Note: could not remove the old backup $($b.Name); delete it by hand if you like." }
            }
        }

        $version = ''
        $bi = Join-Path $live 'build-info.json'
        if (Test-Path -LiteralPath $bi) {
            try { $j = Get-Content -LiteralPath $bi -Raw | ConvertFrom-Json; $version = " $($j.version) ($($j.sha))" } catch {}
        }
        Say ''
        Write-Host "Installed $Name$version." -ForegroundColor Green
        Say 'It is set to run each time Fusion starts.'
        Say 'Next: restart Fusion -- or, in Fusion, open Utilities > Add-Ins (Shift+S),'
        Say "      pick $Name on the Add-Ins tab and click Run."
        return 0
    } catch {
        return (Fail 1 "Unexpected problem: $($_.Exception.Message)")
    } finally {
        if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$bsplineRc = Install-BsplineAddin
if ($env:BSPLINE_FROM_CMD) { exit $bsplineRc }
