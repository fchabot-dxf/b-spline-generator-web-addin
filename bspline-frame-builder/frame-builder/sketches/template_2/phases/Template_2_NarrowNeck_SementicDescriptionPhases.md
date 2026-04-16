# Template 2 - Narrow Neck — 18-Step Linear Construction

The Frame Builder Template 2 - Narrow Neck uses a **Multi-Sketch Sequence** to ensure maximum stability and modularity. The build progresses through 18 global phases across three distinct Fusion 360 sketches.

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
- **Action**: Projects the four safe-zone corners and the offset top boundary line into sketch 2.
- **Key IDs**: `proj_off_corner_TL` (and TR, BL, BR) and `proj_off_BB_top`
- **Source**: `1_bounding-box:BB_corner_XX` and `1_bounding-box:offset_BB_top`.

### Step 4 — Anatomy (`p4_anatomy.py`)
- **Action**: Constructs the invisible horizontal skeleton scaffold (Hubs).
- **Key IDs**: `skel_shoulder_pin_R/L`, `skel_waist_pin_R/L`, `skel_hip_pin_R/L`.
- **Relation**: Start points (`:S`) are anchored to the **`Y_AXIS`** (Center Line). 
- **Vertical Control**: Anchored to **`ORIGIN`** or driven by **`WaistOffset`** vertical distance.
- **Drivers**: Defines the internal widths via `ShoulderSpan`, `WaistSpan`, and `HipSpan`.

### Step 5 — Silhouette Lines (`p05_lines.py`)
- **Action**: Places the straight horn and boundary line segments using the revised edge and horn seed locations.
- **Key IDs**: `horn_TR/TL`, `horn_BR/BL`, `top_edge`, `bottom_edge`.
- **Relation**: Snaps the 4 corner "horn starts" (`horn_XX:S`) to the **Step 3 Projections** (`proj_off_corner_XX`) while keeping the bottom-edge/horn bottoms shifted by a small `0.001` offset to avoid premature auto coincidence.
- **Topology**: Uses precise top/bottom seed offsets so the solver can establish the silhouette without unintended constraint collapse.

### Step 6 — Silhouette Arcs (`p06_arcs.py`)
- **Action**: Places the 4 key circular arc seeds for the silhouette outline.
- **Key IDs**: `arc_waist_R/L`, `arc_hip_R/L`.
- **Relation**: Uses midpoint/bulge seeding to place the waist and hip arcs relative to the silhouette lines.
- **Topology**: Uses shared parametric radii (`heightIn/16`) for the hip pair and the waist pair.

4 Entities Selected
arc_hip_R | (arc_hip_R:S : (widthIn * 0.465238, heightIn * 0.135216)) -> (EndID=arc_hip_R:E : (widthIn * 0.38488, heightIn * 0.197716)) -> (CenterID=arc_hip_R:C : (widthIn * 0.38488, heightIn * 0.135216)) --> (BulgeCenter= arc_hip_R:B : (widthIn * 0.38488, heightIn * 0.135216)) | StartID=arc_hip_R:S | EndID=arc_hip_R:E | CenterID=arc_hip_R:C | BulgeCenter=(6.84,3.09)
arc_waist_R | (arc_waist_R:S : (widthIn * 0.297624, heightIn * 0.261211)) -> (EndID=arc_waist_R:E : (widthIn * 0.377981, heightIn * 0.198711)) -> (CenterID=arc_waist_R:C : (widthIn * 0.377981, heightIn * 0.261211)) --> (BulgeCenter= arc_waist_R:B : (widthIn * 0.377981, heightIn * 0.261211)) | StartID=arc_waist_R:S | EndID=arc_waist_R:E | CenterID=arc_waist_R:C | BulgeCenter=(6.72,5.97)
arc_waist_L | (arc_waist_L:S : (-widthIn * 0.37796, heightIn * 0.202858)) -> (EndID=arc_waist_L:E : (-widthIn * 0.297603, heightIn * 0.265358)) -> (CenterID=arc_waist_L:C : (-widthIn * 0.37796, heightIn * 0.265358)) --> (BulgeCenter= arc_waist_L:B : (-widthIn * 0.37796, heightIn * 0.265358)) | StartID=arc_waist_L:S | EndID=arc_waist_L:E | CenterID=arc_waist_L:C | BulgeCenter=(-6.72,6.07)
arc_hip_L | (arc_hip_L:S : (-widthIn * 0.383255, heightIn * 0.202523)) -> (EndID=arc_hip_L:E : (-widthIn * 0.463612, heightIn * 0.140023)) -> (CenterID=arc_hip_L:C : (-widthIn * 0.383255, heightIn * 0.140023)) --> (BulgeCenter= arc_hip_L:B : (-widthIn * 0.383255, heightIn * 0.140023)) | StartID=arc_hip_L:S | EndID=arc_hip_L:E | CenterID=arc_hip_L:C | BulgeCenter=(-6.81,3.2)




### Step 7 — Chain (`p07_chain.py`)
- **Action**: Establishes topological continuity across the silhouette.
- **Relation**: Connects adjacent arcs (e.g., `arc_waist_R:E` → `arc_hip_R:E`) into a unified clockwise chain.

### Step 8 — Horn Welds (`p08_horns.py`)
- **Action**: Attaches the straight horn segments to the waist/hip arcs.
- **Relation**: Welds `horn_TR:E` (tip) to `arc_waist_R:S`.

### Step 9 — Waist Pins (`p09_waist_pins.py`)
- **Action**: Centers the waist arcs against the skeleton for symmetry.
- **Relation**: `Coincident` constraint from `arc_waist_R :C` (center) to the Step 4 skeleton hub `skel_waist_pin_R :E`.

### Step 10 — Tangency (`p10_tangency.py`)
- **Action**: Smoothes the junctions between all circular arcs.
- **Constraint**: `Tangent` across all segment pairs in the loop.

### Step 11 — Horn Tangency (`p11_horn_tangency.py`)
- **Action**: Ensures the straight horns transition smoothly into the curved shoulders/hips.
- **Constraint**: `Tangent` between `horn_XX` and its neighboring `arc_XX`.

### Step 12 — Radius Removal (`p12_radius_removal.py`)
- **Action**: Deletes the Phase 5 seed dimensions to prepare for parameter injection.
- **Logic**: Releases the "training wheels" so the solver can settle into the final parametric state.

### Step 13 — Skeleton Welds (`p13_welds.py`)
- **Action**: Fixes the ends of the arcs to the skeletal pins in Vertical Pairs.
- **Relation**: Bottom half (Hips), then Top half (Shoulders), with an intermediate Pulse.

### Step 14 — Symmetry (`p14_symmetry.py`)
- **Action**: Finalizes the anatomy by forcing Left and Right hubs into equality.
- **Logic**: Independent build settling followed by a final symmetric "Snap."

### Step 15 — Parametric Drivers (`p15_drivers.py`)
- **Action**: Injects the final UI slider values.
- **Drivers**: `ShoulderRadius`, `WaistSpan`, `ShoulderSpan`, etc.
- **Logic**: Uses "Volatile Dimension" logic to avoid solver locking.

---

## Sketch 3 — Enclosure: Frame Wall
*Relationship: Projects the finalized Sketch 2 silhouette to generate the solid profile.*

### Step 16 — Enclosure Projections (`p16_encl_projs.py`)
- **Action**: Imports the finalized silhouette loop from Sketch 2.
- **Source**: `2_shape-outline:top_edge`, `horn_TR`, etc.
- **Anchors**: Also projects internal miter anchors (`proj_anchor_TL`).

### Step 17 — Enclosure Welds (`p17_encl_welds.py`)
- **Action**: Stabilizes the projected loop for the offset operation.

### Step 18 — Enclosure Offset (`p18_encl_offset.py`)
- **Action**: Generates the structural thickness of the frame.
- **Key IDs**: `inner_corner_TL`, `inner_corner_TR`, etc.
- **Driver**: `frame_thickness`.

### Step 19 — Enclosure Miters (`p19_encl_miters.py`)
- **Action**: Bridges the outer silhouette and inner enclosure.
- **Relation**: Connects `proj_anchor_TR` (Silhouette) to `inner_corner_TR` (Offset).

### Step 20 — Enclosure Surround Rectangle (`p20_encl_surround_rect.py`)
- **Action**: Adds the surround rectangle used to cap the frame wall and finalize the profile boundary.
- **Relation**: Anchors the surround rect center to the origin while preserving its offset from the silhouette.

---

### **Synthesis Sequence**
After Step 16, the engine locates the closed profile in **Sketch 3** and performs the solid extrusion (`frame_depth`) into the final 3D part.
