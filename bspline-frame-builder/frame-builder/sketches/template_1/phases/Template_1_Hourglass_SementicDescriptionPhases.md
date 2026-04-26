# Template 1 - Hourglass — 18-Step Linear Construction

The Frame Builder Template 1 - Hourglass uses a **Multi-Sketch Sequence** to ensure maximum stability and modularity. The build progresses through 18 global phases across three distinct Fusion 360 sketches.

---

## Sketch 1 — Foundations: Bounding Box
*Relationship: Defines the "Master Envelope" that all subsequent geometry projects from.*

### Step 1 — BB Layout (`p1_bb_layout.py`)
- **Action**: Creates the primary model rectangle centered on the origin.
- **Key IDs**: `BB_RECT`, `BB_top`, `BB_right`.
- **Drivers**: `widthIn`, `heightIn`.

### Step 2 — Safe Zone Offset (`p2_bb_offset.py`)
- **Action**: Offsets the Step 1 rectangle to create a internal safety boundary.
- **Key IDs**: `BB_corner_TL`, `BB_corner_TR`, `BB_corner_BL`, `BB_corner_BR`.
- **Relation**: Consumes `BB_top/right/bottom/left` from Step 1.
- **Driver**: `boundingboxoffset`.

---

## Sketch 2 — Silhouette: Shape Outline
*Relationship: Builds the frame silhouette using an internal skeleton scaffold centered on the origin.*

### Step 3 — Projections (`p3_projs.py`)
- **Action**: Grabs the four safe-zone corners from Sketch 1.
- **Key IDs**: `proj_off_corner_TL` (and TR, BL, BR).
- **Source**: `1_bounding-box:BB_corner_XX`.

### Step 4 — Anatomy (`p4_anatomy.py`)
- **Action**: Constructs the invisible horizontal skeleton scaffold (Hubs).
- **Key IDs**: `skel_shoulder_pin_R/L`, `skel_waist_pin_R/L`, `skel_hip_pin_R/L`.
- **Relation**: Start points (`:S`) are anchored to the **`Y_AXIS`** (Center Line). 
- **Vertical Control**: Anchored to **`ORIGIN`** or driven by **`WaistOffset`** vertical distance.
- **Drivers**: Defines the internal widths via `ShoulderSpan`, `WaistSpan`, and `HipSpan`.

### Step 5 — Silhouette Loop (`p5_loop.py`)
- **Action**: Places the 12 circular arcs and straight horn segments.
- **Key IDs**: `arc_shoulder_R/L`, `arc_waist_R/L`, `horn_TR/TL`.
- **Relation**: Snaps the 4 corner "horn starts" (`horn_XX:S`) to the **Step 3 Projections** (`proj_off_corner_XX`).
- **Topology**: Seeds all junctions with a 0.001 "snap offset" to ensure reliable solver registration.

### Step 6 — Chain (`p6_chain.py`)
- **Action**: Establishes topological continuity across the silhouette.
- **Relation**: Connects adjacent arcs (e.g., `arc_waist_R:S` → `arc_shoulder_R:S`) into a unified clockwise chain.

### Step 7 — Horn Welds (`p7_horns.py`)
- **Action**: Attaches the straight horn segments to the shoulder/hip arcs.
- **Relation**: Welds `horn_TR:E` (tip) to `arc_shoulder_R:E`.

### Step 8 — Waist Pins (`p8_waist_pins.py`)
- **Action**: Centers the waist arcs against the skeleton for symmetry.
- **Relation**: `Coincident` constraint from `arc_waist_R :C` (center) to the Step 4 skeleton hub `skel_waist_pin_R :E`.

### Step 9 — Tangency (`p9_tangency.py`)
- **Action**: Smoothes the junctions between all circular arcs.
- **Constraint**: `Tangent` across all segment pairs in the loop.

### Step 10 — Horn Tangency (`p10_horn_tangency.py`)
- **Action**: Ensures the straight horns transition smoothly into the curved shoulders/hips.
- **Constraint**: `Tangent` between `horn_XX` and its neighboring `arc_XX`.

### Step 11 — Radius Removal (`p11_radius_removal.py`)
- **Action**: Deletes the Phase 5 seed dimensions to prepare for parameter injection.
- **Logic**: Releases the "training wheels" so the solver can settle into the final parametric state.

### Step 12 — Skeleton Welds (`p12_welds.py`)
- **Action**: Fixes the ends of the arcs to the skeletal pins in Vertical Pairs.
- **Relation**: Bottom half (Hips), then Top half (Shoulders), with an intermediate Pulse.

### Step 13 — Symmetry (`p13_symmetry.py`)
- **Action**: Finalizes the anatomy by forcing Left and Right hubs into equality.
- **Logic**: Independent build settling followed by a final symmetric "Snap."

### Step 14 — Parametric Drivers (`p14_drivers.py`)
- **Action**: Injects the final UI slider values.
- **Drivers**: `ShoulderRadius`, `WaistSpan`, `ShoulderSpan`, etc.
- **Logic**: Uses "Volatile Dimension" logic to avoid solver locking.

---

## Sketch 3 — Enclosure: Frame Wall
*Relationship: Projects the finalized Sketch 2 silhouette to generate the solid profile.*

### Step 15 — Enclosure Projections (`p03_01_encl_projs.py`)
- **Action**: Imports the finalized silhouette loop from Sketch 2.
- **Source**: `2_shape_outline:top_edge`, `horn_TR`, etc. (12 projected curves total).
- **Note**: Separate `proj_anchor_*` SketchPoints used to be projected here for the miter sources, but were removed — projection already creates curve endpoint vertices at each corner, so the miter sources `proj_top_edge:S` / `proj_horn_TR:S` / etc. directly.

### Step 16 — Enclosure Welds (`p16_encl_welds.py`)
- **Action**: Stabilizes the projected loop for the offset operation.

### Step 17 — Enclosure Offset (`p17_encl_offset.py`)
- **Action**: Generates the structural thickness of the frame.
- **Key IDs**: `inner_corner_TL`, `inner_corner_TR`, etc.
- **Driver**: `frame_thickness`.

### Step 17.5 — Inner Corner Resolve (`p03_03_inner_corner_resolve.py`)
- **Action**: Locates the 4 inner-enclosure corner SketchPoints by computed position and registers them under the names the miter phase expects.
- **Why**: At high `frame_thickness`, Fusion's offset merges colliding side arcs and the resulting curves' attribute API is locked, so naming inner corners via offset-curve endpoints fails. The corners themselves still exist (formed by intersection of straight-line offsets that never collapse) — this phase computes each expected position from the outer projection + frame_thickness and tags the nearest SketchPoint.

### Step 18 — Enclosure Miters (`p03_04_encl_miters.py`)
- **Action**: Bridges the outer silhouette and inner enclosure.
- **Relation**: Connects parent-curve endpoints under the "start of next curve" convention — `proj_horn_TR:S` (outer TR) to `inner_proj_horn_TR:S` (inner TR), and the equivalent at TL/BR/BL.

---

### **Synthesis Sequence**
After Step 16, the engine locates the closed profile in **Sketch 3** and performs the solid extrusion (`frame_depth`) into the final 3D part.
