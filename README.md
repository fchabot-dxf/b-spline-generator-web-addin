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

## 🛠️ Installation

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
