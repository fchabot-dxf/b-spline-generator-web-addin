# Symmetric B-Spline Generator

## Update Log

- **2026-03-25**: **Resolved "Baking" Stall (Definitive Fix)** — Implemented **Chunked STEP Transfer** to bypass the 2MB bridge limit. Added **Wizard Polling Loop** for responsive UI during long bakes. restored **Manifold Solid 3D Preview** for thickened terrains.
- **2026-03-25**: **Sculpting Performance & Logic Fix (Phase 2)** — Optimized the undo system (snapshots on `mouseup`) and fixed safety scaling math.
- **2026-03-25**: Restored **Sculpting Functionality** in web mode — fixed missing UI controls and CSS layering.
- **2026-03-25**: Resolved **Multi-Body Export bug** — surface bodies are now reliably exported as separate components.
- **2026-03-25**: Optimized **Export Wizard** with white flag (🏳️) icons and intuitive body selection.
- **2024-03-24**: Rebranded project to **Symmetric B-Spline Gen** and added header download button.

## Architecture & Data Flow

### 1. Palette (UI/Logic)
- **`index.html` / `main.js`**: The core application state.
- **`terrain.js` / `noise.js`**: Procedural heightmap generation using Simplex/Perlin noise.
- **`thicken.js`**: Curvature-aware offset logic. Computes a "safe thickness" map to prevent self-intersections.
- **`sculpt.js`**: Z-only soft-body deformation for top and bottom surfaces.
- **`stamp.js`**: SVG rasterization into an alpha mask for terrain displacement.
- **`preview.js`**: Three.js WebGL preview within the palette window.

### 2. Multi-Tier Height Tracking
The system tracks three distinct Z-states to allow for complex multi-body exports:
1. **Base**: Raw noise heightmap.
2. **Clean**: Base + Top Sculpting.
3. **Stamped**: Clean + SVG Stamp displacement.

### 3. STEP Generation (`stepWriter.js`)
Generates AP214 STEP files directly in the browser. 
- **Chunked Transfer**: Large STEP payloads are automatically split into 100KB chunks to bypass Fusion 360's bridge limits.
- **Multi-Body Support**: Orchestrates Stamped/Clean Solids and Surfaces into a single STEP assembly hierarchy (Product/Component).

### 4. Bridge (`fusion-hybrid.py`)
- **Preview**: Palette sends `heights` + `normals`. Python draws a `CustomGraphicsMesh` with a `SolidColorEffect` manifold for real-time 3D feedback.
- **Generation Polling**: The Wizard uses a heartbeat loop (`check_import_status`) to detect when Fusion completes the STEP bake, ensuring the UI closes only after the design is ready.
- **Final**: Palette sends the chunked STEP data. Python reassembles the pieces, saves to a temp file, and imports into the design.

## Usage
- **Location**: Found in the **Solid** tab, far right end, in the **"Symmetric B-Spline Generator"** panel.
- **Workflow**: Open palette → Design pattern → Toggle "Thicken" if solid is needed → Click **OK** → Select bodies in Export Wizard.

## Debugging

### Logs
- **Python/Backend**: All Python activity and bridge communications are logged to:
  `C:\Users\<User>\APPS\b-spline-generator-web-addin\b_spline_gen_log.txt`
- **JavaScript/Frontend**: Diagnostic messages from JS are tunneled to the Python log via the `fusLog()` function.

### Common Issues
- **Blank Preview**: Usually caused by a JS crash during initialization (check missing UI elements or import errors).
- **Bridge Limit**: (Fixed) High-resolution bakes no longer fail due to file size. If you see a timeout, ensure you are in a "New Design" and check the Python logs.
- **Add-in Missing**: If the add-in doesn't appear in Shift+S after a crash, clear the `__pycache__` and bump the version in `.manifest`.

## Deployment
Run `python deploy_hybrid.py` from the root folder to sync changes to the Fusion 360 Add-ins directory.
