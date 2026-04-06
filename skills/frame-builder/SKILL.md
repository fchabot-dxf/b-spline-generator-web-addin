# Frame Builder Skill

## Purpose
Expert guidance for the **Frame Builder** add-in. This add-in synthesizes parametric, assembly-ready frames around 3D bodies in Fusion 360 using a data-driven "DNA" approach.

## Analysis of Technical Properties

### 1. Phase-Orchestrated Synthesis (8-Phase Loop)
To ensure stability in complex parametric sketches, the engine executes geometry and constraint application in a strictly sequenced order. This prevents the Fusion 360 solver from "fighting" inconsistent states.

| Phase | Category | Description |
| :--- | :--- | :--- |
| **0** | Projections | Projects external geometry (origin, axes, core points) into the sketch. |
| **1** | Pre-Geometry | Creates construction lines or "seed" geometry needed for constraints. |
| **2** | Snap-to-Seed | Soft-snaps main geometry to its approximate positions (Soft Dimensions). |
| **3** | Pre-Constraints | Applies basic relationships (Horizontal, Vertical, Equality). |
| **4** | Main Geometry | Draws the Final model curves and anchors them. |
| **5** | Shaping & Pulse | Applies complex shaping (Tangency). Features a "Phase Pulse" to settle anchors first. |
| **6** | Final Dimensions | Hard-codes user parameters to lock the geometry scale. |
| **7** | Offsets / Steps | Generates parallel loops (Frame offsets) and profile steps. |
| **8** | Miters | Final split lines for body partitioning during extrusion. |

### 2. Universal Attribute Tagging (`FrameBuilder:ID`)
The engine uses the **Fusion 360 Attribute System** to embed persistent identity into every sketch entity. 
- **Persistent Search**: Use `entity_map` to find entities by ID across different sketches.
- **Source of Truth**: The ID persists even if the geometry is modified, allowing the "Dynamic Inspector" to reliably track entities.
- **Inspector Support**: Entities are tagged with `FrameBuilder:ID` for technical discovery.

### 3. Spatial Intelligence Engine
To solve the "flipped coordinates" problem common in standard Fusion scripting, the engine classifies entities by their **physical spatial position** rather than API return order:
- **Centroid-Based Line Mapping**: Automatically identifies `BB_top`, `BB_bottom`, etc., by finding the highest/lowest X/Y centroids.
- **Quadrant-Based Vertex Mapping**: Identifies corners (TL, TR, BL, BR) by classifying points into quadrants relative to the sketch center.
- **Result**: Semantic names (like `BB_V_TL`) always match the physical Top-Left, making the system immune to orientation flips.

### 4. 4-Lock Stability Guard (UI-Level)
The add-in enforces a "Stability Guard" in the command dialog:
- **Max 4 Locks**: Prevents the user from locking more than 4 skeleton parameters at once.
- **Solver Safety**: Limits the complexity of the initial sketch solve to prevent Fusion 360 crashes.
- **Dynamic Feedback**: Groups turn red and the "OK" button disables if the limit is exceeded.

### 5. DNA Scaling Anchor
All proportions are dynamically driven by **Live Measurement Parameters**:
- `widthIn` & `heightIn`: Measured from the target body bounding box.
- **Proportional DNA**: Parameters like `WaistSpan` or `ShoulderSpan` are synced as absolute values in the document but presented as relative percentages in the UI.

### 6. Target Body Discovery
The engine uses a tiered search to find the "AESTHETIC_CORE":
1.  Occurrence named exactly `AESTHETIC_CORE`.
2.  Occurrences containing `b-spline set` or `terrain`.
3.  Child occurrences containing `clean solid`.
4.  Fallback to the first body in the root component.

### 7. Non-Destructive Coincidence (Seeding)
To avoid Fusion 360's aggressive "Auto-Constraint" feature (which can merge points prematurely and cause solver loops):
- **Nudge the Seed**: Initial geometry points should be placed **close to** but **never exactly on** their intended targets.
- **Manual Attachment**: All coincident relationships must be added explicitly via the `constraints` phase in the template.
- **Example**: If a line starts at `[0,0]`, seed it at `[0.05, 0.05]` before applying the `Coincident` constraint to the origin.

### 8. Center-Point Rectangle Enforcement
The Bounding Box (**Sketch 1**) must always be defined using a **Center-Point Rectangle**. This ensures:
- **Bi-Symmetric Scaling**: Adjusting `widthIn` or `heightIn` expands the box equally from the origin.
- **Parametric Stability**: Avoids the "floating rectangle" issues common with two-point definitions.
- **Anchor Point Availability**: Automatically generates a `[geo_id]:C` (Center Point) for origin anchoring.

## Naming Conventions (The "Standard")

### Sketches
`[PREFIX]_1_bounding-box`, `[PREFIX]_2_shape-outline`, `[PREFIX]_3_frame`

### Semantic IDs
- **Lines**: `BB_top`, `BB_right`, `BB_bottom`, `BB_left`
- **Vertices**: `[geo_id]_V_TL`, `[geo_id]_V_TR`, `[geo_id]_V_BL`, `[geo_id]_V_BR`
- **Suffixes**: `:S` (Start), `:E` (End), `:C` (Center/Control)

## Template Blueprint (Python Example)
Templates are defined as functions returning property dicts (see `sketches/template_1/`):
```python
{
    "ID": "main_bounding_rectangle",
    "Type": "RectangleCenter", # Explicitly Center-Point
    "Center": [0, 0],
    "Size": ["widthIn", "heightIn"],
    "LineIDs": ["BB_top", "BB_right", "BB_bottom", "BB_left"]
}
```

## Troubleshooting & Debugging
1. **Inspector Dump**: Use the Frame Inspector to verify that `FrameBuilder:ID` attributes match the expected semantic names.
2. **Log Audit**: Check `frame-builder-debug.log` for "PHASE PULSE" logs to see where constraint solves might be failing.
3. **Ghost Entities**: Use the "Clear Sketches" command if zombie attributes persist after a crash.
