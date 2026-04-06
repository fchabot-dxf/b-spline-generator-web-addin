# Development Log and Workspace Link System

## Purpose
This file documents the development logging strategy for this project, including:
- How and where development logs are written
- The workspace link file system for portable logging
- Best practices for agent and developer access to logs

## Dev Log File Usage
- All development logs should be written to a file in the project root (this folder), named for example `symmetric_b_spline_gen_log.txt`.
- This ensures logs are always accessible to agents, scripts, and developers during local development.
- Do not write logs to the deployed AddIn folder or protected system locations.

## Workspace Link File System
- During deployment, a `workspace_link.json` file is written to the deployed AddIn folder.
- This file contains the absolute path to your project folder (the workspace).
- At runtime, the add-in reads this file to determine where to write logs.
- If the file is missing or invalid, the add-in falls back to writing logs in a temp directory.

## Steps
1. **Deployment Script Update**
   - Modify your deployment script (e.g., deploy_hybrid.py) to write `workspace_link.json` into the deployed AddIn folder.
   - Example content: `{ "workspace_root": "C:/Users/yourname/APPS/b-spline-generator-web-addin" }`
2. **Add-In Runtime Logic**
   - On startup, the add-in looks for `workspace_link.json` in its directory.
   - If found and valid, logs are written to the specified workspace path.
   - If not, logs go to a temp directory.

## Best Practices
- Never hardcode user-specific paths in code.
- Always use the workspace link file for portable logging.
- Agents and dev tools should look for logs in the project root.
- If the workspace is moved, redeploy to update the link file.

## Verification Checklist
- [ ] Deploy the add-in using the updated script.
- [ ] Confirm `workspace_link.json` is present in the AddIn folder and points to the correct workspace.
- [ ] Run the add-in in Fusion and verify logs are written to the workspace.
- [ ] Move the workspace, redeploy, and confirm the link updates and logging still works.

## 2026-03-30 - Sculpt Interaction Fixes (active)
- Fixed sculpt flow: `setSculptMode` now remains set after mode selection and is used by `_bindOrbit` raycast.
- Added states and knockdowns for `activeSculptLayer` + `sculptTopMode`/`sculptBotMode` including visual `.active` button class updates.
- `onSculptDelta` now writes back `preDelta`/`postDelta` to state with `setPreDelta`/`setPostDelta`.
- `scheduleRebuild` upgraded to persist the rebuild callback and accept both `function + delay` and `delay-only` calls.
- Added detailed debug logs in `sculpt-interaction.js` and `engine.js` for `delta-sample`, `scheduleRebuild`, and `rebuild` stats.

## 2026-03-29 - Multi-Export Pipeline Bugfix & Documentation

### Problem
Two bugs combined to silently break multi-part STEP import into Fusion 360.

**Bug 1 — `lastResult.thickenData` always nullified (`main.js`)**
Inside `rebuild()`, after the `if (P.thickenEnabled) { ... } else { ... }` block, two
duplicate lines (`lastResult.thickenData = null` and `hideThickenNotice()`) were sitting
*outside* the if/else and running unconditionally on every rebuild. This meant thicken
data was calculated correctly, then immediately wiped before `sendFusionPreview()` could
read it. Result: `isSolid` was always `false`, every import was a flat surface, and the
multi-body solid path (`generateThickenedStep`) was never reached.

**Bug 2 — Python handler blind to `stepVariants` payload (`symmetric-b-spline-gen.py`)**
`executeExport()` in JS (OK button / wizard) sends `{ stepVariants: [...] }` — a list
of body variants. Python's `_handle_generate()` only looked for `stepText` (the single-
body live-preview key). With `stepVariants`, `stepText` was always empty, so the multi-
variant import silently aborted every time.

### Fixes
- **`main.js`**: Removed the two rogue unconditional lines; the `else` block is now
  properly scoped so thicken data survives into the export path.
- **`symmetric-b-spline-gen.py` → `_handle_generate()`**: Refactored into two explicit
  paths: `[MULTI-VARIANT]` (iterates `stepVariants`, imports each body separately) and
  `[SINGLE-STEP]` (legacy `stepText` live-preview path, unchanged). Smart Visibility and
  SVG stamping work correctly on both paths.

### Documentation & Discoverability
Added detailed JSDoc / docstring banners to all five multi-export functions so agents
can identify them without reading every line:
- `generateStep()`          — `stepWriter.js`  — single surface export
- `generateThickenedStep()` — `stepWriter.js`  — multi-body solid/surface STEP generator
- `sendFusionPreview()`     — `main.js`        — single-STEP live preview sender
- `processExport()`         — `main.js`        — wizard entry point for multi-export
- `executeExport()`         — `main.js`        — multi-export core (builds stepVariants)
- `_handle_generate()`      — `.py`            — Python bridge receiver (both paths)

### How the Multi-Export Pipeline Works (end to end)
1. User clicks OK or confirms wizard → `processExport()` / `btnApply.onclick`
2. `executeExport(opts)` generates each selected body via `generateStep()` or
   `generateThickenedStep()` and bundles them into `stepVariants`
3. `sendFusionPayloadChunked()` streams the JSON payload to Python in 256 KB chunks
4. Python reassembles chunks on `generate_finish` and calls `_handle_generate()`
5. `_handle_generate()` detects `stepVariants`, loops over each, writes temp `.step`
   files, and calls `importToTarget()` once per variant
6. Smart Visibility dims all but the highest-priority body; SVG stamp layers are applied
   to that primary body

## 2026-03-29 - Variable-Driven Parametric Sync (V41)
- **User Parameter Integration**: The add-in now automatically synchronizes the model's key dimensions to Fusion 360's **User Parameters**.
- **Sync Mapping**: Generator state `widthIn` and `heightIn` are pushed as `widthIn` and `heightIn` variables (Inches) upon final import ("OK" click).
- **Purpose**: Enables perfectly matched imported frames and enclosures. Users can reference these variables in downstream CAD designs to ensure automated alignment between the frame and the generative art.

## 2026-03-25 - Dynamic log path fix
- Replaced hardcoded `LOG_FILE` path with `get_log_path()` in `symmetric-b-spline-gen.py`.
- `get_log_path()` reads `workspace_link.json` from script folder; falls back to `tempfile.gettempdir()`.
- Ensured portable deployment across user machines without path-specific failures.

## 2026-03-27 - Terrain Stamp & CAD Interaction Refinements (V29)

### 1. Professional CAD Interaction Engine
- **Hybrid Drawing Tools**: Implemented both "Click-Drag-Release" and "Two-Click" drawing for **Line**, **Rect**, and **Circle**.
- **Magnetic Snapping**: Added 0.25" magnetic snapping to the Line tool for perfect horizontal/vertical alignment.
- **60FPS Drag Sync**: Refactored selection movement to use `dmove()` (translation sync) instead of re-cloning, eliminating "ghosting".
- **Non-Destructive Highlights**: Blue "halo" highlights now render behind objects, and high-contrast nodes appear on selection for precise editing.

### 2. High-Fidelity Vector Processing
- **RDP-Optimized Bézier Smoothing**: Freehand strokes now use the **Ramer-Douglas-Peucker** algorithm to generate low-density, high-fidelity Cubic Splines.
- **Expand Stroke (Slot Generator)**: Converts open strokes into closed ribbon polygons, essentially for CNC pockets.
- **Click-to-Dot**: Supports single-click creation of circular "drill holes".

### 3. Terrain & Mesh Fidelity
- **G1 Fillet Continuity**: Fixed the "cliff/step" artifact at SVG stamp boundaries. The fillet curve now anchors to the bit's true depth.
- **Tapered Feature Blending**: Eliminated "ridges" near stamps with a 1-inch tapered suppression mask in `stamp.js`.
- **Open Path Rasterization**: Removed forced path closure ("Z") in `stamp.js` to allow open splines to render accurately in 3D.
- **Ambient Occlusion & Shading**: Sharpened lighting and increased mesh specularity (Shininess 60) for better feature visibility.

## 2026-03-26 - UI Cleanup (Minimap Removal)
- **Unified Orientation**: Removed the sidebar minimap from the main screen to provide a cleaner 3D workspace. Camera orientation is now handled exclusively by the high-fidelity ViewCube.
- **SVG Editor**: Preserved the "True Top-View" rendering exclusively for the SVG Editor background.

## 2026-03-26 - Debugging Philosophy Update
- **Speed through Breadcrumbs**: Adopted a new debugging standard: when providing a fix for a complex system (SVG Editor, Bridge), always include **fresh diagnostic logs** alongside the code changes. This avoids multiple round-trips when a fix exposes the next layer of an issue.

## 2026-03-26 - SVG Stamping & Preview Sync Fixes
- **Stamp Slider Restoration**: Fixed `stamp.js` to correctly apply `scale`, `xOffset`, and `yOffset` during SVG rasterization. Sliders are now fully functional.
- **Minimap Orientation Fix**: Flipped the Y- SVG Stamp Stability: Implemented "Reset to Reality" 1:1 scale policy. Set `fabric.DPI=1` and `devicePixelRatio=1`. Enforced explicit `width`/`height` in `toSVG` and stripped `transformMatrix` on load. Result: SVG units map 1:1 to model inches.
- Unified Clearing: Linked Editor "Clear" buttons directly to the main application's `stampSvgText` and `stampMask`, triggering a 3D rebuild immediately.
- 3D Visibility: Enhanced mesh material specularity (Shininess 8->60) and sharpened lighting to make subtle relief catches the eye.
- Sheet Bounds: Added visual red dashed border to SVG Editor to prevent off-canvas drawing.
- Fix-and-Log Philosophy: Formalized project-wide Breadcrumb strategy to minimize debugging round-trips.
  - Web engine should run in native Y-down mode.
  - CNC model coordinates are flipped manually in `modelToCanvas` / `canvasToModel`.
  - Negative viewport scale is a deprecated "mirror world" hack and should be removed over time.
- Kept workaround flags in code for compatibility (`skipOffscreenCheck`, `objectCaching`, `strokeUniform`) while final migration completes.
- Added a permanent project "Source of Truth" block describing the positive viewport + manual transform strategy.

## 2026-03-26 - SVG Editor Migration & Relief Shading
- **SVG.js Migration**: Full refactor from Fabric.js to SVG.js to eliminate coordinate drift. Established a 1:1 "Native Inch" system where 1 SVG unit = 1 inch on the CNC model.
- **2D Relief Shading**: Implemented slope-based directional shading (top-left light source) in `preview.updateTopView` to visualize 3D features on the 2D editor background.
- **Minimap Synchronization**: Redesigned the sidebar minimap as a "Composite SVG" (shaded background + user sketches) with correct aspect ratio and orientation logic.
- **Reference Error Fix**: Corrected a silent crash in `editor.js:open()` (svgText vs svgString) that was preventing persistence of user drawings.
- **Synced Controls**: Extended the "Relief" intensity slider to both the sidebar and the editor modal, ensuring real-time visual parity.

## 2026-03-26 - High-Fidelity "X-Ray" Wireframe (V28)
- **Either-Or Visibility**: In `preview.js`, the shaded surface (`_mesh`) now hides automatically when "Show Wireframe" is active, providing a clear "X-ray" view of the underlying mathematical grid.
- **Actual Resolution Representation**: Grid lines now draw `nx-1` by `nz-1` lines, accurately representing every row and column of the B-Spline surface. Optimized to 30 segments per curve for performance.
- **Strict Default Enforcement**: Toggle is now OFF by default on every open. `main.js` explicitly resets the checkbox and skips restoring the `showMesh` state from `localStorage` to ensure a clean startup.
- **UI Renaming**: "Show Mesh" toggle label renamed to "Show Wireframe" for clarity.

## 2026-03-26 - Parameter Expansion (V22)
- Expanded slider ranges for `carveZ`, `thickness`, `stampScale`, `sculptTopRadius`, `sculptBotRadius`, `smoothRadius`, and `bottomSmoothRadius` from 5.0 to **20.0**.
- This enables larger scale sculptures and stamps for more dramatic terrain features.

## 2026-03-26 - Logging System Enhancement
- **Full Datestamps**: Updated `_log(msg)` in `symmetric-b-spline-gen.py` to use `%Y-%m-%d %H:%M:%S` format.
- This ensures logs are traceable across multiple days of development.


## 2026-03-25 - Preview Styling Update
- Updated `symmetric-b-spline-gen.py` preview mesh to use `CustomGraphicsPhongMaterial` with:
  - `ambient=0.00`, `diffuse=0.30`, `specular=1.00`, `roughness=2.0`
  - `Color.create(0, 102, 204, 43)` for semi-transparent overlay
- Added `mesh` effect path calibration and normalized `addMesh` input form.
- Goal: strong highlight + shaded surface with subtle/less intrusive hover overlay.

---

## Outstanding Issues & Technical Debt (Pending)
1. Dynamic "Baking" Timeout
   - Status: Done
   - Issue: Fixed 180s hard timeout in `main.js` may fail for ultra dense spacing (0.05"/0.03").
   - Fix: polling timeout is now 300 ticks (600s) for small spacing (<0.05"), 90 ticks (180s) otherwise.
2. Design Tree Organization (Component Grouping)
   - Status: Done
   - Issue: Imports in root component clutter tree.
   - Fix: A dedicated component (`Terrain Generation YYYYMMDD_HHMMSS`) is created as import target; fallback to root.
3. Redundant Bridge Binding
   - Status: Done
   - Issue: `main.js` re-binds `fusionNotify` despite existing global handshake in `index.html`.
   - Fix: removed manual rebind from `applyFusionMode()`.
4. Adaptive Thickness Precision UI
   - Status: Done
   - Issue: Max safe thickness hint is not prominent and lacks correction tools.
   - Fix: thicken notice displayed in panel, with throttled 'Use Max Safe' button and heatmap/hotspot overlay already handled by existing preview update.
5. Session State Persistence
   - Status: Done
   - Issue: Closing add-in resets parameters and model state.
   - Fix: Save `P` + sculpt deltas in `localStorage` on param changes; restore on load.
6. Dimension Validation
   - Status: Done
   - Issue: width/height can be set to 0/negative, causing grid issues.
   - Fix: `applyParam()` now clamps width/height to minimum 0.1.
7. Chunk Buffer Cleanup (Python)
   - Status: Done
   - Issue: Re-opening palette can reuse stale `chunk_buffer`, causing corrupt STEP import.
   - Fix: Python `reset_ui` action clears `chunk_buffer` and `importing_done` state.

---

## Symmetric B-Spline Generator — Critical Info

- **Purpose:** Procedural terrain and solid modeling add-in for Fusion 360, with a web-based palette UI and robust STEP export.
- **Key Features:**
  - Chunked STEP transfer to bypass Fusion’s bridge limits.
  - Multi-body and manifold solid export.
  - Procedural noise, sculpting, stamping, and 3D preview.
  - Wizard polling loop for responsive UI during long operations.
- **Architecture:**
  - Palette (HTML/JS): Handles UI, noise, sculpt, stamp, preview.
  - stepWriter.js: Generates STEP files in-browser, chunked for bridge.
  - fusion-hybrid.py: Receives data, logs activity, imports STEP into Fusion.
- **Usage:**  
  - Found in the Solid tab, “Symmetric B-Spline Generator” panel.
  - Design, thicken, export via the wizard.
- **Debugging:**  
  - Python logs: symmetric_b_spline_gen_log.txt in the project root.
  - JS logs: Sent to Python log via fusLog().
  - Common issues: Blank preview (JS crash), bridge/file size (fixed), add-in missing (clear __pycache__, bump manifest version).
- **Deployment:**  
  - Run python deploy_hybrid.py from the root folder to sync to Fusion Add-ins.

---

## Architecture & Data Flow

### 1. Palette (UI/Logic)
- `index.html` / `main.js`: Core application state and UI.
- `terrain.js` / `noise.js`: Procedural heightmap generation (Simplex/Perlin noise).
- `thicken.js`: Curvature-aware offset logic for safe thickness mapping.
- `sculpt.js`: Z-only soft-body deformation for top/bottom surfaces.
- `stamp.js`: SVG rasterization for terrain displacement.
- `preview.js`: Three.js WebGL preview in the palette window.

### 2. Multi-Tier Height Tracking
- Tracks three Z-states for complex multi-body exports:
  1. Base: Raw noise heightmap
  2. Clean: Base + Top Sculpting
  3. Stamped: Clean + SVG Stamp displacement

### 3. STEP Generation (`stepWriter.js`)
- Generates AP214 STEP files in-browser.
- Chunked transfer (100KB chunks) to bypass Fusion 360 bridge limits.
- Multi-body support: Stamped/Clean solids and surfaces as STEP assembly hierarchy.

### 4. Bridge (`fusion-hybrid.py`)
- Palette sends heights/normals for real-time 3D feedback.
- Wizard polling loop (`check_import_status`) ensures UI closes only after design is ready.
- Chunked STEP data is reassembled and imported into Fusion.

---

## Fusion 360 "Baking" Bug & Bridge Guide (Historical Details)

### The Problem: Bridge Congestion
- Large STEP payloads sent from JS to Python can cause IPC delays and signal loss.
- UI may lock up if the "success" signal is dropped.

### Multi-Layer Reliability (Historical Fixes)
1. **Chunked Transmission:**
   - JS splits payload into 256KB segments; Python reassembles on `generate_finish`.
2. **Polling Handshake:**
   - Switched from push to pull model; JS polls `check_import_status`, Python replies with `import_ready`.
3. **fusionNotify Re-Binding:**
   - JS re-binds `fusionNotify` on every poll tick to handle bridge resets.
4. **Hard Safety Timeout:**
   - 180s ceiling to prevent infinite "Baking..." state; UI closes after timeout.
5. **Recursive Feedback Loop Prevention:**
   - Python only responds to explicit `check_import_status`, not generic "response" ACKs.
6. **Signature & Payload Alignment:**
   - Fixed mismatches in function signatures and payload formats between JS and Python.
7. **Multi-Body Labeling & Timeout Extension:**
   - Explicit labeling for multi-body exports; increased timeout for large imports; improved variable safety in Python.

---

## Bug Log (Chronological, Most Recent First)

### 2026-03-25

#### 🛑 1. The "Baking" Stall (0-Character STEP)
**Resolved**: v1.0.2 | 2026-03-25
**Issue**: When exporting a **Surface** (Thicken = OFF), the generator would return an empty string. The Python backend would then receive a 0-character payload, causing the "Baking..." button to stay active forever as no valid import would trigger a completion signal.
**Root Cause**: An aggressive input guard in `stepWriter.js` checks for `!offsetPts`. Since surface exports have no offset points, it returned `""` prematurely.
**Resolution**: 
- Modified `stepWriter.js` to allow `generateThickenedStep` to proceed for surface-only exports.
- Added a "Heartbeat Safety" in Python that signals `import_ready` even if file generation fails, ensuring the UI state is always cleared.

#### ✅ 9. SVG Editor clear/orientation fix
**Resolved**: v1.0.3 | 2026-03-25
**Issue**: SVG editor zoom reset/pan could drift into minuscule scale, and clear did not fully sync 2D/3D stamp state consistently.
**Root Cause**: Fabric.js `viewportTransform` can flip Y-scale on wheel zoom and clear was only editor-only.
**Resolution**:
- `editor.js` `mouse:wheel` enforces viewport: `vpt[1]=0; vpt[2]=0; vpt[3]=-Math.abs(vpt[0]);`
- `setModelMetrics()` now resets `this.zoom = 1` and sets viewport transform to Y-up.
- `clear()` now resets `this.zoom`, clears canvas and minimap, discards active object, and clears global `stampSvgText/stampMask`.

#### 🏗️ 6. Multi-Body Renaming
**Resolved**: 2026-03-25
**Issue**: Importing multiple bodies (e.g., Clean + Stamped) resulted in generic names like "Part 1" in the design tree.
**Resolution**: Updated `stepWriter.js` to assign explicit product names (e.g., "Terrain - Stamped Solid") in the STEP assembly header.

#### ⚠️ Non-Productive Hardship
**Date**: 2026-03-24 — 2026-03-25
**Impact**: Brief period of reduced development velocity due to a team personal hardship; several planned enhancements were delayed while attention focused on critical fixes and maintenance.
**Actions Taken**: Prioritized stabilization and essential bug fixes (SVG editor orientation/clear, preview reliability); postponed non-essential feature work and updated backlog/priorities.
**Next Steps**: Schedule a short catch-up sprint, redistribute outstanding tasks, and notify stakeholders of adjusted timelines.

## SVG Scaling Best Practice
- Always keep SVG path data and viewBox in workspace-native units (inches).
- Do NOT apply pixel-based transforms (e.g., matrix(96,0,0,96,...)) in the SVG markup.
- Only apply scaling (e.g., 96x for inches-to-pixels) at the rasterization or rendering stage (e.g., in the canvas or image export pipeline).
- This prevents double-scaling, drifting, and ensures correct alignment across import/export and preview.

## 2026-03-28 - Coordinate Drift Elimination & 1:1 Web-to-CAD Parity
- Implemented strict 1:1 physical inch ViewBox (0,0,W,H) in SVG export and minimap for CNC-grade accuracy.
- All SVG output now uses width/height in inches and 96 DPI for perfect CAD scaling.
- updateMinimap() ensures minimap is always visible, correct aspect, and never pushed out of view.
- Integrated Visual Viewport API in main.js to dynamically resize modal and minimap for mobile keyboard, ensuring shop-floor usability.
- Eliminated all coordinate drift and scaling bugs between web editor and CAD import.
- Skill: "1:1 Web-to-CAD Parity Engineering" — ability to bridge web vector math with physical CNC toolpathing.

## 🧠 Architecture Note: The "Interval vs. ViewBox" Conflict

**Date:** March 28, 2026
**Component:** SVG Export (`editor.js`) & Rasterization (`stamp.js`)

### The Core Conflict
In a CNC web application, we are constantly translating between two different realities that have microscopically different aspect ratios:
1. **The Physical Reality (The ViewBox):** Our vector drawing space, mapped to physical inches (e.g., `0 0 7 9`). Aspect Ratio = `0.7777`.
2. **The Digital Reality (The Grid):** The 3D B-Spline control points used to generate the mesh (e.g., `141x181` intervals). Aspect Ratio = `0.7790`.

### The Danger of Default SVG Rendering (`xMidYMid meet`)
By default, SVG rendering engines (like web browsers and `canvg`) act to protect the visual proportions of a graphic. If handed a `7x9` ViewBox and told to stretch it onto a `141x181` grid, the engine applies the default `xMidYMid meet` rule:
1. It scales the 7x9 drawing until the sides touch the edges of the grid.
2. Because the aspect ratios don't match perfectly, it pads the leftover vertical space with empty transparent pixels (Letterboxing).
3. **The CNC Result:** A 1-pixel gap is added to the top of the canvas. In our scale, 1 pixel = ~0.05". This shifts the `(0,0)` origin down, causing the physical CNC machine to drift and plunge the bit into the wrong location.

### The Permanent Solution (`preserveAspectRatio="none"`)
To guarantee absolute physical precision, we must bypass the graphic engine's aspect ratio protection. 

By forcing `preserveAspectRatio="none"` on the `<svg>` export, we tell the renderer:
* Lock the SVG `(0,0)` coordinate exactly to the `[0,0]` index of the grid.
* Lock the SVG `(W,H)` coordinate exactly to the `[Max_X, Max_Y]` index of the grid.

The engine mathematically distorts (squishes) the drawing by ~0.0013 to make it fit perfectly. While the distortion is visually imperceptible to the human eye, it completely eliminates letterboxing padding, ensuring our 1:1 inch-native coordinates remain mathematically flawless for the machine.

## 2026-03-28 - Late Session - SVG Transmission & Projection Finalization
- **XML Sanitization**: Implemented aggressive cleaning in `editor.js:save()` to strip all `svgjs:*` attributes. This prevents Fusion 360's `importManager` from failing due to unknown namespaces.
- **Auto-Calibration Scaling Engine**: Resolved the persistent **96 DPI** scaling bug. Instead of guessing the DPI, the system now includes a 'Calibration Anchor' in the SVG. The Python backend measures this anchor at runtime and mathematically derives the perfect scale factor (typically ~95.0), ensuring 1:1 physical parity on any system.
- **Manual Matrix Rotation-Flip**: Resolved the `Invalid Transform` error by switching to raw `setCell` matrix construction. To satisfy Fusion's requirement for positive determinants, we use a 180-degree rotation around the X-axis (encoded as positive X and negative Y/Z scaling). This achieves the vertical flip while remaining a mathematically 'valid' uniform transform in the CAD engine.
- **Orientation-Aware Projection**: Fixed the "Edge Projection" bug where artwork would land on the sides of the board. The face-finding logic now dynamically searches for the maximum coordinate on the correct axis based on the session's orientation (`y-up` vs `z-up`).

## 2026-03-29 - The "Golden Standard" for SVG-to-CAD Bridge (Final Stability)

We have collectively broken and repaired the SVG orientation multiple times. To prevent future regressions, we have standardized on the **Pre-Baked Coordinate Strategy**:

### 1. The Strategy: "Bake it in Python"
Instead of importing a "clean" SVG and attempting to move it with a complex `Matrix3D` in Fusion (which often fails silently or with `Invalid Transform`), we transform the raw XML/SVG string in a pre-processing step (`_prescale_svg`).

### 2. The Coordinate Mapping (7x9" Board Example)
*   **Scaling (The 96 DPI Fix)**: Fusion's `importManager` for SVG treats 1 user-unit as 1 pixel (1/96 inch). We multiply all coordinates by **96** so that 1 inch in the editor becomes 1 "unit" (1/96 inch) in Fusion, resulting in a perfect 1.0 scale import.
*   **Centering**: To align with our terrain's world origin `(0,0)`, we subtract half of the pixel-width/height during the scaling step.
    *   `new_x = (x_in * 96) - (width_in * 96 / 2)`
*   **Y-Axis Flip (The Longside Fix)**: SVG's Y-Down is mapped to Fusion's Y-Up in this same step to ensure text and drawings are right-side-up.
    *   `new_y = (y_in * 96) - (height_in * 96 / 2)`
    *   *Note: Previously we used `half_h - y_px`, but the current un-mirrored standard for this board orientation is `y_px - half_h`.*

### 3. The Visibility Fix (Offset Projection Plane)
To prevent the artwork from being hidden "under" the 3D geometry (at Y=0):
1.  Python detects the **Peak Height** of the terrain