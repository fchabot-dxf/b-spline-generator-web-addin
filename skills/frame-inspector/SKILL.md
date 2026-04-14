# Frame Inspector Skill

## Purpose
Expert guidance for the Frame Inspector add-in. Use when modifying the selection-driven metadata palette, the interactive attributes display, or the geometry connection visualizer.

## Repository Overview
- Provides a real-time "HUD" for inspecting Frame Builder attributes in Fusion 360.
- `fusion-inspector.py`: Manages the Selection Changed event loop and Python-to-HTML bridge.
- `inspector_palette.html`: The web interface that renders high-density JSON payloads from Python.

## Core Patterns

### 1. High-Density Payload Bridge
The inspector relies on a "shout-across-the-bridge" pattern for real-time performance.
- When selection changes in Fusion, Python builds a single JSON object (the "Payload") describing everything about the selected entity.
- The palette receives this `update` and re-renders components immediately.

### 2. Attribute Reading ('FrameBuilder' Namespace)
The inspector is the primary tool for visualizing the "Hidden Metadata" added by the Frame Builder.
- It specifically looks for attributes in the `FrameBuilder` namespace (e.g., `name`, `bridge`, `plan`).
- This allows for "Semantic Geometry" (e.g., distinguishing a "Left Hip Joint" from a generic SketchLine).

### 3. Dynamic Connectivity Mapping
Provides a visual list of "Who is connected to what":
- **Geometric Neighbors**: Points connected to lines, lines connected to arcs.
- **Constraints**: Lists the type of constraints (Coincident, Horizontal, etc.) applied to the entity.

## Key Techniques
* **Entity Fingerprinting**: Uses `entityToken` as a "fingerprint" to avoid redundant UI updates if the same object is re-selected.
* **Semantic Batching**: If multiple entities are selected, the inspector shifts into a "Batch Summary" mode instead of individual details.
* **Palette Stays-on-Top**: Configured as an adsk.core.Palette for persistent visibility during modeling sessions.

## Troubleshooting Checklist
- [ ] **Palette Blank**: Ensure `inspector_palette.html` is in the same folder as `fusion-inspector.py`.
- [ ] **Selection Lag**: Check the `_last_sel_ids` guard in Python; it prevents redundant payload generation if the selection hasn't actually changed.
- [ ] **Missing Attributes**: If 'FrameBuilder' attributes aren't appearing, ensure the Frame Builder add-in was used to create that specific geometry.
- [ ] **Broken Links**: In Batch mode, verify the coordinate formatting `(x,y) -> (x,y)` isn't causing JSON parsing errors.

### Commit/Push Note
- For this repo on Windows, use `git add -A; git commit -m "<message>"` rather than `&&` in PowerShell.
- `git push` is the standard publish step after a successful local commit.
- If you need to avoid shell quoting problems, run git commands from the VS Code source control UI or the provided workspace tasks.
