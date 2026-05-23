@echo off
setlocal EnableDelayedExpansion

REM ---------------------------------------------------------------------------
REM Dynamic wrangler shim.
REM
REM This used to hardcode:
REM   "C:\nvm4w\nodejs\node.exe" "C:\Users\danse\AppData\Roaming\npm\node_modules\wrangler\bin\wrangler.js"
REM which silently broke any time NVM switched Node versions or the npm
REM global prefix moved. Now we resolve both paths at run-time.
REM ---------------------------------------------------------------------------

REM 1) Find node. If `node` is not on PATH, NVM is probably not active —
REM    bail out with a clear message instead of cryptic CMD errors.
where node >nul 2>nul
if errorlevel 1 (
    echo [wrangler.cmd] node.exe is not on PATH.
    echo                If you use NVM for Windows, run: nvm use ^<version^>
    exit /b 1
)

REM 2) Prefer a wrangler.cmd that npm already put on PATH (i.e. the global
REM    install for the currently-active Node). If found, hand off to it.
for /f "delims=" %%W in ('where wrangler.cmd 2^>nul') do (
    if /i not "%%~fW"=="%~f0" (
        "%%~fW" %*
        exit /b !errorlevel!
    )
)

REM 3) Otherwise, ask npm where its global prefix is and run wrangler.js
REM    from there with the current node.
for /f "delims=" %%P in ('npm prefix -g 2^>nul') do set "NPM_PREFIX=%%P"

if not defined NPM_PREFIX (
    echo [wrangler.cmd] Could not determine npm global prefix. Is npm on PATH?
    exit /b 1
)

set "WRANGLER_JS=%NPM_PREFIX%\node_modules\wrangler\bin\wrangler.js"

if not exist "%WRANGLER_JS%" (
    echo [wrangler.cmd] wrangler not installed under: %NPM_PREFIX%
    echo                Install it with: npm install -g wrangler
    exit /b 1
)

node "%WRANGLER_JS%" %*
exit /b %errorlevel%
