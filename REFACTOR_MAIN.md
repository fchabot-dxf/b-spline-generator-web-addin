# main.js Modular Refactoring & Project Cleanup Plan

This document outlines the strategy for decomposing the nearly 3,000-line `main.js` into modular, single-responsibility ES modules and reorganizing the project for professional maintainability.

---

## 1. Project Directory Reorganization
To "clean up" the project, the following directory structure is proposed:

### Web Assets (`symmetric-b-spline-gen/html/`)
- **`/js/`**: All JavaScript modules.
  - **`/core/`**: State, history, and the rebuild engine.
  - **`/features/`**: Feature-specific logic (sculpting, stamping).
  - **`/integration/`**: Fusion 360 bridge and export services.
- **`/styles/`**: CSS stylesheet organization.
- **`/assets/`**: Icons, textures, and static resources.

### Root Directory Cleanup
The following "stray" files currently in the root should be moved or deleted:
- `Source.dxf` → Move to `backups/reference-dxf/`
- `bounding-box.dxf` → Move to `backups/reference-dxf/`
- `stamp_7x9 (2).svg` → Move to `/html/assets/stamps/`
- `symmetric_b_spline_gen_log.txt` → Move to `logs/`
- `tmp_test_thicken.mjs` → Move to `test/scripts/`

---

## 2. Module Decomposition for main.js

`main.js` will be split into the following focus areas, all located in `/html/js/`:

### Core State & History
1. **`state.js`**: 
   - Manages parameters (`P`), default settings, and session persistence (local storage).
   - Exports the primary state object and change-notifiers.
2. **`history.js`**: 
   - Manages unified undo/redo stacks and state snapshots.
   - Decouples logic for "top" vs "bottom" surface snapshots.

### Logic & Features
3. **`ui-utils.js`**: 
   - Generic UI-DOM bindings (`bind`, `syncPair`).
   - UI-specific sync logic like `updateSpacingLabels`.
4. **`sculpt-logic.js`**: 
   - High-level sculpture interaction (drag strokes, symmetry mirroring, safety clamping).
5. **`stamp-logic.js`**: 
   - Async rasterization management and multi-layer SVG extraction.
6. **`engine.js`**: 
   - The core `rebuild()` loop and update coordination.
   - Syncs the 3D preview with the 2D editor background.

### Integration & Export
7. **`fusion-bridge.js`**: 
   - All `adsk` Python bridge communication and polling mechanisms.
   - Real-time mesh preview streaming.
8. **`export-service.js`**: 
   - Handles the Export Wizard UI and bundling for STEP/ZIP formats.

---

## 3. Entry Point Strategy
The new `main.js` will be a slim entry point that:
- Imports the required modules.
- Initializes the state and UI bindings.
- Coordinates the startup sequence between the 3D preview, SVG editor, and Fusion 360 bridge.

---

## 4. Verification & Testing Plan
- **Browser Validation**: Check for "Type Module" support and console errors.
- **Feature Parity**: Verify that sculpting, stamping, and thickness analysis still work exactly as before.
- **Bridge Continuity**: Ensure the Python-side handshake remains stable.
