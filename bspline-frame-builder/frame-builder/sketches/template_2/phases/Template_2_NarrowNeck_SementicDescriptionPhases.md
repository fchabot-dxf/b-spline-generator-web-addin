# Template 2 - Narrow Neck — 18-Step Linear Construction

The Frame Builder Template 2 - Narrow Neck uses a **Multi-Sketch Sequence** to ensure maximum stability and modularity. The build progresses through 18 global phases across three distinct Fusion 360 sketches.

---

## Sketch 1 — Foundations: Bounding Box
*Relationship: Defines the "Master Envelope" that all subsequent geometry projects from.*

### 🟡 Phase 1.1 — BB Layout (`p01_01_bb_layout.py`)
- **Action**: Creates the primary model rectangle centered on the origin.
- **Key IDs**: `BB_RECT`, `BB_top`, `BB_right`.
- **Drivers**: `widthIn`, `heightIn`.

### 🟡 Phase 1.2 — Safe Zone Offset (`p01_02_bb_offset.py`)
- **Action**: Offsets the Step 1 rectangle to create a internal safety boundary.
- **Key IDs**: `BB_corner_TL`, `BB_corner_TR`, `BB_corner_BL`, `BB_corner_BR`.
- **Relation**: Consumes `BB_top/right/bottom/left` from Step 1.
- **Driver**: `boundingboxoffset`.

---

## Sketch 2 — Silhouette: Shape Outline 
*Relationship: Builds the frame silhouette using an internal skeleton scaffold centered on the origin.*

### 🔴 Phase 2.1 — Projections (`p02_01_projs.py`)
- **Action**: Projects the four safe-zone corners and the offset top boundary line into sketch 2.
- **Key IDs**: `proj_off_corner_TL` (and TR, BL, BR) and `proj_off_BB_top`
- **Source**: `1_bounding-box:BB_corner_XX` and `1_bounding-box:offset_BB_top`.

### 🔴 Phase 2.2 — Anatomy (`p02_02_anatomy.py`)
- **Action**: Constructs the invisible horizontal skeleton scaffold (Hubs).
- **Key IDs**: `skel_shoulder_pin_R/L`, `skel_waist_pin_R/L`, `skel_hip_pin_R/L`.
- **Relation**: Start points (`:S`) are anchored to the **`Y_AXIS`** (Center Line). 
- **Vertical Control**: Anchored to **`ORIGIN`** or driven by **`WaistOffset`** vertical distance.
- **Drivers**: Defines the internal widths via `ShoulderSpan`, `WaistSpan`, and `HipSpan`.

### 🔴 Phase 2.3 — Silhouette Lines (`p02_03_lines.py`)
- **Action**: Places the straight horn and boundary line segments using the revised edge and horn seed locations.
- **Key IDs**: `horn_TR/TL`, `horn_BR/BL`, `top_edge`, `bottom_edge`.
- **Relation**: Snaps the 4 corner "horn starts" (`horn_XX:S`) to the **Step 3 Projections** (`proj_off_corner_XX`) while keeping the bottom-edge/horn bottoms shifted by a small `0.001` offset to avoid premature auto coincidence.
- **Topology**: Uses precise top/bottom seed offsets so the solver can establish the silhouette without unintended constraint collapse.

### 🔴 Phase 2.4 — Silhouette Arcs (`p02_04_arcs.py`)
- **Action**: Places the 4 key circular arc seeds for the silhouette outline.
- **Key IDs**: `arc_waist_R/L`, `arc_hip_R/L`.
- **Relation**: Uses midpoint/bulge seeding to place the waist and hip arcs relative to the silhouette lines.
- **Topology**: Uses shared parametric radii (`heightIn/16`) for the hip pair and the waist pair.

### 🔴 Phase 2.5 — Chain (`p02_05_chain.py`)
- **Action**: Establishes topological continuity across the silhouette.
- **Relation**: Connects adjacent arcs (e.g., `arc_waist_R:E` → `arc_hip_R:E`) into a unified clockwise chain, and also chains the horns to the arcs without issue.

### 🔴 Phase 2.6 — Horn Welds (`p02_06_horns.py`)
- **Action**: Attaches the straight horn segments to the waist/hip arcs.
- **Relation**: Welds `horn_TR:E` (tip) to `arc_waist_R:S`.

### 🔴 Phase 2.7 — Waist Pins (`p02_07_waist_pins.py`)
- **Action**: Centers the waist arcs against the skeleton for symmetry.
- **Relation**: `Coincident` constraint from `arc_waist_R :C` (center) to the Step 4 skeleton hub `skel_waist_pin_R :E`.

### 🔴 Phase 2.8 — Tangency (`p02_08_tangency.py`)
- **Action**: Smoothes the junctions between all circular arcs.
- **Constraint**: `Tangent` across all segment pairs in the loop.

### 🔴 Phase 2.9 — Horn Tangency (`p02_09_horn_tangency.py`)
- **Action**: Ensures the straight horns transition smoothly into the curved shoulders/hips.
- **Constraint**: `Tangent` between `horn_XX` and its neighboring `arc_XX`.

### 🔴 Phase 2.10 — Radius Removal (`p02_10_radius_removal.py`)
- **Action**: Deletes the Phase 5 seed dimensions to prepare for parameter injection.
- **Logic**: Releases the "training wheels" so the solver can settle into the final parametric state.

### 🔴 Phase 2.11 — Skeleton Welds (`p02_11_welds.py`)
- **Action**: Fixes the ends of the arcs to the skeletal pins in Vertical Pairs.
- **Relation**: Bottom half (Hips), then Top half (Shoulders), with an intermediate Pulse.

### 🔴 Phase 2.12 — Symmetry (`p02_12_symmetry.py`)
- **Action**: Finalizes the anatomy by forcing Left and Right hubs into equality.
- **Logic**: Independent build settling followed by a final symmetric "Snap."

### 🔴 Phase 2.13 — Parametric Drivers (`p02_13_drivers.py`)
- **Action**: Injects the final UI slider values.
- **Drivers**: `ShoulderRadius`, `WaistSpan`, `ShoulderSpan`, etc.
- **Logic**: Uses "Volatile Dimension" logic to avoid solver locking.

---

## Sketch 3 — Enclosure: Frame Wall
*Relationship: Projects the finalized Sketch 2 silhouette to generate the solid profile.*

### 🔵 Phase 3.1 — Enclosure Projections (`p03_01_encl_projs.py`)
- **Action**: Imports the finalized silhouette loop from Sketch 2.
- **Source**: `2_shape-outline:top_edge`, `horn_TR`, etc.
- **Anchors**: Also projects internal miter anchors (`proj_anchor_TL`).

### 🔵 Phase 3.2 — Enclosure Welds (`p03_02_encl_welds.py`)
- **Action**: Stabilizes the projected loop for the offset operation.

### 🔵 Phase 3.3 — Enclosure Offset (`p03_03_encl_offset.py`)
- **Action**: Generates the structural thickness of the frame.
- **Key IDs**: `inner_corner_TL`, `inner_corner_TR`, etc.
- **Driver**: `frame_thickness`.

### 🔵 Phase 3.4 — Enclosure Miters (`p03_04_encl_miters.py`)
- **Action**: Bridges the outer silhouette and inner enclosure.
- **Relation**: Connects `proj_anchor_TR` (Silhouette) to `inner_corner_TR` (Offset).

### 🔵 Phase 3.5 — Enclosure Surround Rectangle (`p03_05_encl_surround_rect.py`)
- **Action**: Adds the surround rectangle used to cap the frame wall and finalize the profile boundary.
- **Relation**: Anchors the surround rect center to the origin while preserving its offset from the silhouette.

---

### **Synthesis Sequence**
After Step 16, the engine locates the closed profile in **Sketch 3** and performs the solid extrusion (`frame_depth`) into the final 3D part.
