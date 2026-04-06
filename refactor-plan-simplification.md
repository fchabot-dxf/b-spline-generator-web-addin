---
# Code Simplification & Refactoring Plan

This board tracks structural changes aimed purely at reducing code volume, eliminating repetition (WET code), and making the architecture easier to read, debug, and maintain **without altering the end-user experience**.

---

## In Progress

### DRY out `sculpt.js` Brush Loops
- **Problem:**
	- `applyStroke`, `safePreStrokeScale`, and `safePostStrokeScale` all repeat the exact same 15+ lines of boundary checking, grid math, and distance/falloff calculations.
- **Solution:**
	- Extract the shared logic into a single `forEachPointInBrush(nx, nz, ci, cj, width, height, radius, callback)` helper function.
- **Impact:**
	- Deletes ~50 lines of duplicate math.
	- Makes future brush modifications (like adding a square or custom-alpha brush) require changing only one place.

---

## To Do

### Cure Parameter Creep in `preview.update()`
- **Problem:**
	- The `update` function signature has ballooned to 16 individual arguments, making it extremely fragile and hard to read in `main.js`.
- **Solution:**
	- Refactor the signature to use object destructuring: `update(data, config)`.
- **Impact:**
	- `preview.update({ heights, offsetPts }, { nx, nz, flatShading })` becomes completely self-documenting and order-independent.

### Decouple `_bindOrbit` God-Function (`preview.js`)
- **Problem:**
	- `_bindOrbit()` handles camera rotation, panning, touch gestures, wheel zooming, and sculpt tool raycasting/stroke emissions all in one massive block.
- **Solution:**
	- Split this block into two distinct methods: `_bindCameraEvents()` and `_bindSculptTools()`.
- **Impact:**
	- Simplifies the event listener logic.
	- Separates Three.js viewport math from application tool state.

### Modularize UI Event Binding (`main.js`)
- **Problem:**
	- `main.js` contains a monolithic, hundreds-of-lines-long section dedicated to mapping DOM IDs to variables and attaching `addEventListener` calls.
- **Solution:**
	- Group UI bindings into smaller, panel-specific initializer functions (e.g., `initTerrainPanel()`, `initStampPanel()`) and pass a centralized `onStateChange` callback to them.
- **Impact:**
	- Massive reduction in vertical scrolling.
	- Prevents namespace collisions and makes it easier to track down broken UI elements.

### Extract SVG Editor Tools (`editor.js`)
- **Problem:**
	- The mouse event handlers (`onPointerDown`, `onPointerMove`) inside the SVG Editor contain giant switch/case statements handling the logic for every single tool (Select, Line, Rect, Pen, Text).
- **Solution:**
	- Adopt the **Strategy Pattern**. Create a `tools` object where each tool has its own `onDown`, `onMove`, and `onUp` methods. The main event listener just passes the event to `tools[currentMode]`.
- **Impact:**
	- Flattens the deep nesting in `editor.js`.
	- Isolates tool logic.
	- Makes adding a new SVG tool incredibly clean and isolated.