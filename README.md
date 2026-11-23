# B-Spline Generator & Frame Builder (Fusion 360 Add-in)

A professional suite of Fusion 360 add-ins for procedural surface generation, interactive B-Spline sculpting, and automated frame construction.

## 🚀 Overview

This repository contains a unified dashboard and engine for advanced 3D modeling workflows in Autodesk Fusion 360. It bridges high-performance web-based interfaces with Fusion 360's parametric engine to allow for real-time sculpting and procedural geometry generation.

### Key Components:
- **`b-spline-gen`**: Web-based interactive editor for generating symmetric surfaces and B-Spline curves.
- **`frame-builder`**: Automated parametric frame synthesis from skeletal geometry.
- **`frame-inspector`**: Diagnostic and visualization tools for inspecting complex miter joints and span parameters.

---

## ✨ Features

- **Interactive Sculpting**: Real-time 2D-to-3D preview for B-Spline curve manipulation.
- **Symmetric Generation**: Automated mirroring and manifold closure for complex hulls and surfaces.
- **Modular Parametric Engine**: Decoupled geometry resolver for stable, non-destructive modeling.
- **Fusion 360 Integration**: Seamless Python-to-JavaScript bridge for direct canvas manipulation.
- **Export Formats**: Support for DXF, STEP, and SVG export.

---

## Install the Fusion add-in

The website (https://bspline-generator.pages.dev) has an **Add-in** button in its header. It saves the one-click
installer for your computer; **Settings > Fusion add-in** lists both installers, a paste-in line for each, and the
plain ZIP. No admin rights are needed: the installer writes only to your own Fusion AddIns folder.

**Windows**
- Easiest (no security prompt): open **PowerShell** (Start menu, type `PowerShell`, Enter) and paste
  `irm https://bspline-generator.pages.dev/install-bspline-addin.cmd | iex`
- Or double-click the downloaded `install-bspline-addin.cmd`. Windows may say "Windows protected your PC" (the script
  is not code-signed): click **More info > Run anyway**.

**macOS**
- Open **Terminal** (Spotlight, type `Terminal`, Return) and paste
  `curl -fsSL https://bspline-generator.pages.dev/install-bspline-addin.command | bash`
- Or, after downloading it: `bash ~/Downloads/install-bspline-addin.command` (a downloaded `.command` file can't be
  double-clicked: the browser drops its run permission and Gatekeeper blocks unsigned scripts).

What the installer does: downloads `bspline-frame-builder.zip` from the GitHub `latest` release, checks it is the add-in
(one top folder `bspline-frame-builder/` with the `.py` and `.manifest`), moves an existing install aside to `bspline-frame-builder.bak-<date-time>` (only the newest
backup is kept), unpacks the new one, and turns on `runOnStartup` in its manifest. Nothing else in AddIns is touched.
Then: **restart Fusion**, or in Fusion open **Utilities > Add-Ins** (Shift+S), pick `bspline-frame-builder` and
click **Run**.

Exit codes (for support): 0 installed, 1 unexpected error, 2 download failed (offline?), 3 Fusion AddIns folder not
found (install Fusion and start it once), 5 not the add-in zip, 6 files in use (close Fusion and run it again).

**Updating.** In Fusion, the **B-Spline Builder** panel's dropdown has **Update to latest**. It asks Yes/No, then does
what the installer does (downloads the release zip, checks it, backs up the old folder, copies the new one in with
`runOnStartup` on), closes the add-in's windows and tells you to restart Fusion (or Stop, then Run, the add-in). There is
no version check: it always installs the current release. It replaces the folder the add-in runs from, whatever that
folder is called (a source checkout included: use git there instead).

**Releasing (maintainer).** `python release.py --addin` builds `release-out/bspline-frame-builder.zip` (with a
`build-info.json` stamp inside, which the palette badges show) and uploads it to the `latest` release. The installers
live in `installer/`; the Pages build
(`deploy_cloudflare.py --build-only`) serves them at the site root. Testing an installer elsewhere:
`BSPLINE_ADDINS_DIR=<folder>` (or the folder as the first argument) installs there instead of Fusion's AddIns folder;
`BSPLINE_ZIP_URL` overrides the download; `BSPLINE_NO_PAUSE=1` skips the .cmd's closing pause.

## 🛠️ Installation (developers)

1. Clone this repository into your Fusion 360 Add-ins folder:
   - **Windows**: `%AppData%\Autodesk\Autodesk Fusion 360\API\AddIns`
   - **macOS**: `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns`
2. Run Fusion 360.
3. Open the **Scripts and Add-ins** dialog (`Alt+S`).
4. Select `frame-builder` (or other components) and click **Run**.

### Fresh-clone bootstrap — generate the stamp-editor bundle

`b-spline-gen` is the single source of truth for the shared **editor** + **stamp** modules;
the `stamp-editor` add-in ships its own generated copy of them. Those generated files are
**NOT committed** (they'd otherwise double every edit + churn line-endings). After cloning —
and after any edit to the shared b-spline-gen modules — regenerate them:

```bash
python bspline-frame-builder/sync_stamp_bundle.py
```

This writes `stamp-editor/html/{editor/, core/stamp/, core/{coords,svg-utils,debug,gaussian}.js}`
from b-spline-gen. The stamp-editor's own files (`core/engine.js`, `core/runtime.js`, `main/`,
`index.html`, `styles/`) are hand-written and stay in git. (`frame-builder` deploy scripts call
`sync_stamp_bundle` automatically.)

---

## 🏗️ Tech Stack

- **Frontend**: Vanilla JavaScript (ES Modules), HTML5, CSS3.
- **Backend**: Python (Fusion 360 API).
- **Libraries**: `opentype.js`, `clipper-lib`.
- **Packaging**: Node.js / npm for dependency management.

---

## 🧪 Testing

Run the JS unit suite (vitest + happy-dom) with **`npm test`** — it locks in the editor SVG-serialization fixes (base64 snapshot encoding, `serializeEditor`, `getLayerSvg`); tests live in `tests/`.

---

## 📄 License
MIT
