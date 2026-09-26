# FB-APP — Frame Builder inside the main app (design, F1)

**Status:** design only. No code has changed. Seat C, epoch 1, branch `fb-app`, 2026-09-26.
**Asks:** Fred wants to "decide the shape of the frame first and then the drawing on it", see the frame
previewed in the app (2D and 3D), and have ONE Send to Fusion build body → frame → inlay, with the
frame's features staying genuinely parametric (ROADMAP.md "Idea — FB-APP").

Paths are relative to `bspline-frame-builder/`. `FB` = `frame-builder/` and `APP` = `b-spline-gen/html/`.
Anything not yet confirmed live is marked **UNVERIFIED**. Items measured live in F2 (turn 2, a scratch document built
with a copy of a real Send panel, 7×11 in) are marked **MEASURED** and give the numbers.

```
 TODAY                                         FB-APP
 ─────                                         ──────
 app ── Send ──► body + inlay                  app: pick frame ─► 2D guide + 3D preview ─► draw inlay
                 (Frame_N absent)                          │
 Fusion: open Sketch Builder palette                       ▼ ONE Send
   ─► pick template ─► Build (sketches)         Fusion: board params ─► body ─► frame ─► inlay
   ─► open Extrude Frame palette                              (fb_engine, unchanged, called in-process)
   ─► PICK A FACE by hand ─► Extrude
   ─► FB-ORDER reorders frame before inlay
```

---

## 1. Inventory: what a frame is, as data (F1 item 1)

### 1.1 The templates are already data

Each template is `FB/sketches/template_N/`. Its `template_data.py` gives the name and parameters. Its three
`sketch_N_*.py` files are discovered by filename, and each lists **phase blocks**: `phases/pNN_MM_*.py`,
where `get_block()` returns a plain dict. `TemplateLoader` (`FB/template_loader.py`) imports no `adsk`.

**Measured this turn:** `get_template_logic()` for both templates runs in plain Python outside Fusion,
and `json.dumps` succeeds: T1 is 15,884 bytes, T2 is 11,455 bytes. The export in §2 therefore
serializes the real source; it does not re-encode it.

```
Template (T1 "Hourglass" | T2 "Narrow Neck")
 ├─ Sketch 1  1_bounding_box      p01_01 BB Layout (Rectangle widthIn×heightIn @ origin)
 │                                 p01_02 Safe Zone Offset (Offset BB by boundingboxoffset)
 ├─ Sketch 2  2_shape_outline     p02_01 projs  (projects the 4 safe-zone corners from sketch 1)
 │                                 p02_02.. anatomy / loop / chain / horns / pins / tangency / welds / symmetry
 │                                 (T1: 11 blocks, T2: 6), making the 12-curve closed silhouette
 └─ Sketch 3  3_frame_enclosure   p03_01 encl_projs (projects the silhouette)
                                   p03_02 encl_offset (Offset silhouette by frame_thickness -> inner_*)
                                   p03_03 inner_corner_resolve (ResolveInnerCorners, merged-offset regime)
                                   p03_04 encl_miters (4 lines outer corner -> inner corner)
                                   p03_05 surround_rect (RectangleCenter widthIn*1.25 × heightIn*1.25)
```

Block vocabulary, measured over both specs:

- Keys: `Geometry`, `BuildSequence`, `Steps`, `Projections`, `Constraints`, `Dimensions`, `Miters`,
  `PhaseFile`.
- Item `Type`s: `Line`, `Arc3Point`, `Rectangle`, `RectangleCenter`, `Offset`, `ResolveInnerCorners`,
  `Coincident`, `Tangent`, `Horizontal`, `Vertical`, `Equal`, `Radius`, `DeleteDimension`, `Pulse`
  (`DeleteDimension` and `Pulse` appear in T1 only).
- Coordinates are **expression strings** in `widthIn` / `heightIn` (for example `'widthIn * 0.34996'`).

⚠ **Seeds are not solved geometry.** Sketch 2 places seeds 0.001 off-target and then lets Fusion's
solver pull them onto the projected corners, make them tangent, and delete the seed radii (`p02_09`).
Evaluating the seed expressions does not reproduce the frame. This is why §3 keeps the app's own
closed-form solver and adds a parity test.

### 1.2 Parameters

| Name | Unit | Default | Declared in | Written by | Read by | Status |
|---|---|---|---|---|---|---|
| `widthIn`, `heightIn` | in | 5.51 / 1.97 (template display) | template S1 (`ReadOnly`) | **Send only**, tagged `Bspline.owner=1` (`b-spline-gen.py:661-674`) | every expression | owned by board; `ParameterSchema.BOARD_OWNED_PARAMS` (`FB/fb_engine/parameter_schema.py:37`) |
| `boundingboxoffset` | in | 0.25 | template S1 (`ReadOnly`) **and** `get_base_frame_requirements` | `frame_engine._create_skeletal_parameters` | p01_02, template_factory | two declarations → **fixed in S0 (F2)**: template only |
| `frame_thickness` | in | 0.75 (0.25–1.5) | template S3 (`Expose`) **and** base requirements (`-1.905` cm) | frame_engine, **twice per build** | p03_02, p03_03 | two writers → **fixed in S0 (F2)**: template only |
| `ck_arc_shoulder_weld`, `ck_arc_hip_weld`, `ck_skel_shoulder_equal`, `ck_skel_waist_equal` | '' | 1.0 | T1 S2 only | frame_engine | T1 p02_10 / p02_11 | live (T1), none in T2 |
| `frame_height_offset` | in | palette "Start Offset", default `'-1 in'` (`FB/ui/solid_builder_ui.py:159`) | nowhere (created ad hoc) | `solid_coordinator._sync_offset_param` | BAR extrude start | undeclared |
| `Skel_Frame_Taper` | deg | 0 | base requirements only (`FB/fb_engine/fb_value_resolver.py:34`) | frame_engine | **nothing**: extrude hard-codes `"0 deg"` (`FB/fb_engine/extrusion_engine.py:154`) | **DEAD → removed in S0 (F2)** (Fred) |
| `Skel_Slot_Tolerance` | in | 0.25 | base requirements only (`fb_value_resolver.py:32`) | frame_engine | **nothing** (grep: its only occurrence) | **DEAD → removed in S0 (F2)** |

### 1.3 Features, their order and their dependencies

```
Send to Fusion (b-spline-gen.py:951 _handle_generate)
  1 _sync_user_parameters: widthIn/heightIn                  (L602-657)
  2 _remove_last_import, new "B-Spline Set" comp            (L1017-1020)
  3 STEP-import variants                                     (L1027-1107)
  4 consolidate -> "Clean" comp, body "panel"                (L1230-1354)   <- the "aesthetic core"
  5 inlay: per layer "Plane for L…" + "Source - L…" sketch   (L1369-1531)
                         │
 Frame Builder (separate palettes, run by hand later)
  6 _require_board_params (raises if widthIn/heightIn missing)   frame_engine.py:55
  7 _create_skeletal_parameters (base reqs + template params)    frame_engine.py:270
  8 new Frame_N component, tagged FrameBuilder.ComponentType=Frame
  9 sketches 1 -> 2 -> 3 (projection chain: each projects from the previous one)
 10 [full synthesis only] assembly joints core <-> Frame_N
 11 FB-ORDER: move Frame_N block before the first inlay item      timeline_order.py
 12 Extrude Frame palette: user PICKS the core's UNDERSIDE face (MEASURED, see §3.3), then per profile of sketch 3:
      BAR       NewBody, start = frame_height_offset, to_face (+0), taper 0   -> bodies frame_top/bottom/left/right
      SURROUND  Cut, start z=0, ThroughAll                                    -> trims the panel outside the frame
      VOID      skipped (the centred inner region = the inlay area)
      then appearance restore + finish (preset or captured paint)
```

The dependencies that matter:

- **The frame needs the body.** Steps 6–12 need step 4. Discovery finds the core by attribute, then an
  `AESTHETIC_CORE` occurrence, then a name hint, then the first root body
  (`FB/fb_engine/document_discovery.py:109`). The BAR extrude's `to_face` is a face **of that body**.
- **The inlay wants to see the frame.** Step 5 should come after 9, which is FB-ORDER's whole reason
  to exist.
- **The sketches depend on each other in order:** sketch 3 projects sketch 2, which projects sketch 1.

### 1.4 Inferred where it should be declared (Fred's "declare over infer")

- **Profile roles.** The extruder guesses BAR / SURROUND / VOID from each profile's **bounding box**:
  a centred profile over 90% of `widthIn` is SURROUND, a centred smaller one is VOID, and anything
  off-centre is BAR (`extrusion_engine.py:203-234`). Bar labels (TOP/BOTTOM/LEFT/RIGHT) come from the
  aspect ratio. The template already knows which regions are which (outline, `inner_*`, miters,
  surround), but it never says so.
- **The target face** is picked by hand. It isn't declared.
- **The core body** is found by guessing names. The name hint says `"clean solid"`
  (`document_discovery.py:46`), but Send now names the component `"Clean"` (`b-spline-gen.py:419`), so
  that rung of the ladder can no longer match. The attribute rung would work, except Send never writes it.
  **MEASURED:** with Send's real structure (B-Spline Set → Clean → panel), `find_aesthetic_core_body()`
  returns `None`, so full synthesis builds no assembly joints.

### 1.5 Drift and dead items to clear before porting (S0 done in F2 except where noted)

- `Skel_Frame_Taper`, `Skel_Slot_Tolerance`: dead (§1.2). Also remove the `'Taper'` unit rule in
  `ParameterSchema.name_based_unit`. **Done (F2):** both params and the `'Taper'` rule are removed.
  Both were created live, so documents built earlier still carry them as user params. They are left
  alone: no cleanup exists, and Fred's documents are not touched.
- `frame_thickness` is written twice per build: the base requirement (`existing.value = -1.905`) and
  then the template's Phase 2 expression. `boundingboxoffset` is declared twice. **Done (F2):**
  `get_base_frame_requirements` and its loop are removed, so the template is the one declaration.
  A test guards that every template declares both params.
- `FB/fb_engine/template_catalog.py` lists Template 3 and 4, but no such folders exist. It also
  describes T1/T2 as "Metric Unified", while `template_data.py` says "Inches Unified". **Not done,
  it's a gate.** A repo-wide grep found **no consumer** of the module (`TEMPLATE_CATALOG`,
  `get_display_name`, `get_entry`, its `get_available_templates`), so the whole module is dead.
  Deleting it is for the advisor to decide.
- `Template_1_Hourglass_SementicDescriptionPhases.md` still describes the retired 18-step build with
  `p14_drivers` and span/radius sliders; T2's copy is stale the same way (`p02_13_drivers`). **Done
  (F2):** both carry a STALE banner pointing at the phase files as the source of truth; neither doc
  was rewritten.

---

## 2. Data contract: one exported frame definition (F1 item 2)

**Proposal:** the phase files stay the **single source**. A generator serializes them into one JSON
file that the app ships. The Python build keeps reading the Python it already reads, so both sides
read the same source. JSON is a derived artifact with a freshness gate. Nobody hand-copies it, and
the Python never parses its own export back.

```
  FB/sketches/template_*/        ──►  tools/gen_frame_defs.py  ──►  APP/data/frame-defs.json  (checked in)
   (phases + template_data)            (plain Python, no adsk)        │
            │                                                         ├─► app: Frame panel, guide layer, 3D
            └───────────── fb_engine (unchanged) ─────────────────────┘   (reads JSON)
                                                    Fusion build reads the Python directly
```

The file has to be checked in: the app is static on Cloudflare Pages and cannot call Python at runtime.

### 2.1 Shape (candidate, to iterate)

```json
{
  "frameDefsVersion": 1,
  "sourceHash": "sha256 of every phase + template_data file, in sorted order",
  "units": "in",
  "templates": [{
    "id": "T1", "styleId": "Template 1", "name": "Template 1 - Hourglass",
    "silhouettePreset": "hourglass",
    "params": [
      {"name": "frame_thickness", "unit": "in", "default": 0.75, "min": 0.25, "max": 1.5,
       "owner": "frame", "expose": true},
      {"name": "boundingboxoffset", "unit": "in", "default": 0.25, "owner": "frame"},
      {"name": "widthIn", "unit": "in", "owner": "board", "readOnly": true}
    ],
    "sketches": [ "…the get_template_logic() Sketches/Blocks verbatim…" ],
    "regions": {
      "outline":  ["proj_top_edge", "proj_horn_TR", "…12 ids"],
      "inner":    ["inner_proj_top_edge", "…"],
      "miters":   ["proj_top_edge:S", "proj_horn_TR:S", "proj_bottom_edge:S", "proj_horn_BL:S"],
      "surround": "surround_rect"
    },
    "features": [
      {"id": "bars", "op": "newBody", "region": "outline-minus-inner", "splitBy": "miters",
       "start": "frame_height_offset", "extent": {"toFace": "core.underside", "offset": "0 in"},
       "bodyNames": ["frame_top", "frame_right", "frame_bottom", "frame_left"]},
      {"id": "trim", "op": "cut", "region": "surround-minus-outline", "start": "0 in",
       "extent": "throughAll"}
    ],
    "extraParams": [
      {"name": "frame_height_offset", "unit": "in", "default": -1.0, "owner": "frame",
       "meaning": "z position of the frame bottom relative to the sketch plane (not a length)",
       "label": "Frame bottom (z)"}
    ]
  }],
  "defaultTemplate": null,
  "appearance": {
    "default": "3D Ash - Unfinished",
    "options": ["3D Ash - Unfinished", "3D Mahogany - Unfinished", "3D Pine - Unfinished",
                "3D Cherry - Unfinished", "3D Maple - Unfinished"]
  }
}
```

- `sketches` is verbatim. Everything else (`regions`, `features`, `extraParams`, `silhouettePreset`,
  `owner`) is **new declared data**. It is added once, in Python, next to each template's existing
  `SKETCH_N_PARAMETERS`, as `FRAME_REGIONS` and `FRAME_FEATURES` in `template_data.py`.
- The extruder can then read `features` instead of guessing profile roles from bounding boxes. That
  is §1.4 fixed by declaration: the bounding-box classifier survives only as a fallback for
  templates that declare nothing, and reads as a fallback.
- `region: "outline-minus-inner"`: the frame bars lie **inside** the silhouette, between it and
  `inner_*`. **MEASURED** (T1, 7×11 in board):
  - The outline sits at x = ±8.26 cm (3.5 in − 0.25 in `boundingboxoffset`) and the inner edge at
    ±6.35 cm, 0.75 in (`frame_thickness`) further in.
  - Sketch 3 has 6 profiles: 4 bars between those two edges, the surround (profile 2, 22.2 × 34.9 cm
    = 1.25 × the board) and the centred void (profile 4).
- Templates come from `template_resolver`'s own discovery (`_discover_template_entries`), not a
  hand-kept list. A new template-maker template then appears in the app without a JS edit.
- `PhaseFile` is a bare filename, measured as `p01_01_bb_layout.py`, so it is deterministic and can stay.
- **`defaultTemplate: null`, so there is no frame by default** (Fred, Q2). The app starts with no
  frame and the user adds one. A board sent with no frame behaves exactly as today.
- **`appearance` is declared once** (Fred, Q4): default `3D Ash - Unfinished`, plus the 5 woods from
  today's palette (`FB/ui/html/solid_builder_palette.html:116-120`). There are three divergent lists
  today, and this declaration replaces all of them:
  - the palette HTML, which has the 5 woods;
  - `APPEARANCE_PRESETS` (`FB/fb_engine/appearance_manager.py:8`), which has Ash / Maple / Pine plus
    Enamel White / Aluminum / Brass, and no Mahogany or Cherry;
  - the Python fallback `'Polished Chrome'` (`FB/ui/solid_builder_ui.py:160`), which neither list
    contains.

  The palette `<select>`, the app's dropdown and the Python fallback all read this one declaration.
  It lives in Python, next to `APPEARANCE_PRESETS`, which becomes that declaration or is derived
  from it, and is serialized into `frame-defs.json`.
- **`frame_height_offset` is a Z position, not a length** (Fred, Q3). It keeps its name and its
  negative value (−1 in) with no migration. The app labels it "Frame bottom (z)".

### 2.2 Versioning and tests

- **Versioning:** `frameDefsVersion` bumps only when the JSON **shape** changes; the app refuses a
  major version it doesn't know. `sourceHash` detects content drift.
- **Python freshness test** (`FB/test_frame_defs_fresh.py`): regenerate the file in memory and
  compare it byte-for-byte with the checked-in one. Stale means red, with the message "run
  tools/gen_frame_defs.py".
- **Mutation proof:** edit one literal in a phase file and the test must go red. This follows the
  project's non-vacuous-test rule.
- **Python declaration test:** every `regions` / `features` ID must exist as an `ID` / `TargetIDs` /
  `LineIDs` in that template's blocks. A renamed curve then breaks the build before Fusion ever runs.
- **JS schema test** (`tests/frame-defs.test.js`): the file loads, the version is supported, every
  param has unit, default and owner, and every `silhouettePreset` exists in the app's `PRESETS`.

This is the first **Python→JS** generated file in the repo. The existing generated artifact goes the
other way: `editor-sketch-manifest.js` → `sketch_manifest_builder.py`, tested by
`tests/parity-app-manifest.test.js`. That is the precedent to copy for layout and naming.

---

## 3. App side (F1 item 3)

```
┌ Palette ─────────────────────────────┐   ┌ Editor (SVG) ─────────────────────┐   ┌ 3D view ───────────┐
│ ▸ Board   W [7] H [9] carve [1.5]    │   │  ┌──────── surround (dim) ──────┐ │   │  terrain / panel   │
│ ▾ Frame   ● none ○ T1 Hourglass      │   │  │ ╭─╮ outline ────────── ╭─╮  │ │   │  + extruded bars   │
│           ○ T2 Narrow Neck           │   │  │ │ ╲ inner  (inlay area) ╱ │  │ │   │    (straight, 0°)  │
│   thickness  [0.75 in] 0.25–1.5      │   │  │ │  ╲___  miters   ___╱  │  │ │   │  trim shown as the │
│   frame bottom (z) [-1 in]           │   │  │ ╰─╯                    ╰─╯  │ │   │  panel cut to the  │
│   appearance [3D Ash ▾]  (defs.json) │   │  └─ 🔒 Frame guide layer ─────┘ │   │  outline           │
└──────────────────────────────────────┘   └───────────────────────────────────┘   └────────────────────┘
```

### 3.1 Frame section

A new palette section, laid out like the existing Board section.

- The template choice lists `frame-defs.json` templates plus **none**, and **none is the default**
  (Fred, Q2).
- Controls come from `params` where `expose: true`, with min/max/unit from the file, plus
  `frame_height_offset` shown as "Frame bottom (z)" (default −1 in), plus an **Appearance** dropdown
  filled from `appearance.options` (default `3D Ash - Unfinished`). Nothing is typed in by hand.
- The state holds `frame: {templateId: null, params, appearance}`, next to `widthIn` / `heightIn` in
  `core/state.js`.
- The board size **drives** the frame, since the template expressions are in `widthIn` / `heightIn`.
  Picking a frame never changes the board.

### 3.2 2D guide layer

**Declare a layer role, not three new booleans.** `APP/editor/layers.js` has only `visible`, `carve`
and `showColor`. It has no "locked" and no "visible but not exported". Add `layer.role`, backed by one
declared registry:

```js
const LAYER_ROLES = {
  art:        { exported: true,  carved: true,  editable: true,  hittable: true  },  // today's default
  frameGuide: { exported: false, carved: false, editable: false, hittable: false },
};
```

Wiring:

- `isExported` / `isCarved` (`layers.js:137-141`) consult the role. That single gate already covers
  the SVG download (`editor-io.js:58-67`), the Fusion payload (`export-flow.js:76-98, :183`) and the
  carve mask (`stamp-mask-manager.js:56`, `rebuild.js:215`).
- `isEditableByLayer` (`:195`) and `isOnVisibleLayer` (`:213`, used by `editor-hit.js` /
  `editor-marquee.js`) consult `editable` / `hittable`.
- The guide keeps `visible`, so the eye icon still hides it.
- The guide layer is generated. It is rebuilt whenever the board size, frame template or frame params
  change, and it is never user-edited. It draws four sets: outline, `inner_*`, miters, and the
  surround (dimmed).

**Geometry reuse:**

- **Outline:** the app's existing closed-form `generateSilhouette(region, shape)`
  (`APP/editor/editor-shape-lattice-generator.js:517`, presets `hourglass` / `bottle` at `:103`),
  given the **safe-zone** region, i.e. the board inset by `boundingboxoffset`. These solvers were
  hand-ported from the same T1/T2 phases (the file header says so, `:8-30`), and they solve the
  tangencies exactly. That is what the seed data cannot do (§1.1).
- **Inner edge:** offset the outline by `frame_thickness` with the app's existing path inset
  (`insetGeneratedPresetPathDToPrimitives`, `APP/editor/editor-lattice-boundary.js`).
- **Miters and surround:** trivial from the declared `regions` (corner points and `widthIn*1.25` ×
  `heightIn*1.25`).
- The mapping from JSON template to JS preset is `silhouettePreset`, which is declared, not matched
  by name.

⚠ **Known approximation.** The JS solver makes the shoulders symmetric, whereas T1's seeds keep a
deliberate L/R difference (0.34996 vs 0.350521). Whether the *solved* Fusion geometry keeps any of
that difference is **UNVERIFIED**; F2 did not dump the sketch-2 curves, so this stays with the S4 parity fixture.
The parity test (§5.2) is what answers "close enough", not argument.

**No interaction with the artwork (Fred, Q5).** The inlay artwork and the frame are unrelated: no
clipping, and no lattice or boundary linking to the frame. The guide layer is purely visual (locked,
not exported). An earlier "bonus reuse" idea here, a Shape Lattice filling the frame's inner edge, is
**dropped**.

### 3.3 3D preview

- `APP/core/preview/index.js` (`TerrainPreview`) builds only heightfield meshes. It has no
  extrude-from-path code.
- The app loads three.js **r128 full** (`bspline_gen_palette.html:15`), which includes `THREE.Shape`
  and `THREE.ExtrudeGeometry`.
- Add `core/preview/frame-mesh.js`: one `THREE.Group` holding one `ExtrudeGeometry` per bar, from
  `outline − inner` split at the miters, depth = bar height, bevel off, taper 0.
- It is owned by `TerrainPreview` but kept **outside** the part that `_dispose()` / `update()` clears.
  Terrain rebuilds must not flicker the frame, and it is rebuilt only when frame inputs change.
- The trim is previewed by clipping the drape or panel outline to the silhouette. That is optional
  for the first cut.
- *Optional:* tint the bars by the chosen wood appearance.
- **Bar height, MEASURED.** Each bar starts at z = `frame_height_offset` below the frame sketch
  plane (world XY, z = 0): −1 in gives z = −2.54 cm. It rises to the **panel's underside**, which
  is sculpted, not flat: bar tops are 0.99–1.65 cm on a panel spanning z = −0.113 to 2.204 cm. So
  there is no single "bar height" and no `carveZ` mapping. The 3D preview caps each bar with the
  terrain's **bottom surface**; `buildSolidMesh` already builds that bottom grid from `offsetPts`
  (`core/preview/terrain-mesh.js:131`).
- **Which face, MEASURED (Fred's input confirmed).** All 6 faces of a Send panel are NURBS (none is
  planar), so the face is identified by its normal:
  - The **underside** has normal n.z = −0.99. Extruding to it, the bars stop at the panel and do not
    overlap it: the panel's volume stays 187.5 cm³ after the trim.
  - Extruding to the **top** face (n.z = +0.99) instead makes each long bar 21 cm³ bigger
    (211.7 vs 190.3 cm³), and those extra 21 cm³ run through the panel's edge.
  - The declared name is therefore `core.underside`.
  - Screenshots: `~/.bspline-status/shots/seatC/1644_F2_bottomface-bars.png` and
    `1646_F2_resend-rebuild-timeline.png`.

---

## 4. Send order and parameter ownership (F1 item 4)

```
 one Send (b-spline-gen.py _handle_generate)
  1 board params   widthIn, heightIn                        owner: board  (Bspline.owner=1)
  2 body           B-Spline Set -> Clean/panel               + NEW: stamp FrameBuilder.ComponentType=AestheticCore
  3 frame          if payload.frame:                          owner: frame  (NEW: FrameBuilder.owner=1)
                     frame_engine.build_frame_logic(styleId, data={ui_data: payload.frame.params})
                     solid_coordinator.build_solid_logic_v3(to_face=<declared core.underside>, start=frame_height_offset)
  4 inlay          planes + sketches (unchanged), now AFTER Frame_N  -> FB-ORDER finds "already in order"
```

- **One process, no new plumbing.** Both halves already live in one add-in: `bspline-frame-builder.py`
  bootstraps `fb_engine` onto `sys.path` and loads `frame_engine.py` as `frame_engine_core`. Also,
  `b-spline-gen/sketch_manifest_builder.py` already imports `fb_engine.*`. Send calls the same
  entry points the palettes call (`build_frame_logic`, `build_solid_logic_v3`), so there is no second
  frame implementation.
- **The payload** grows one optional key:
  `frame: {styleId, params: {frame_thickness, frame_height_offset, …}, appearance}`. It is absent when the frame
  is "none", and then Send behaves exactly as today.
- **The target face is declared.** `features[].extent.toFace = "core.underside"` resolves to the
  Clean panel's face whose normal at `pointOnFace` has n.z ≈ −1. It can't be "the lowest planar
  face": every face of a Send panel is NURBS (MEASURED). Fusion-side, that is a small resolver next to
  `DocumentDiscovery.find_aesthetic_core_body`. It replaces the hand pick for Send only; the
  standalone palette keeps its picker.
- **The core is declared.** Send stamps the `AestheticCore` attribute that discovery's first rung
  already looks for. This fixes the dead `"clean solid"` name hint by declaration rather than by
  renaming a string.
- **Pass a logger.** MEASURED: `FrameBuilder()` with no `external_logger` crashes before creating
  anything. `frame_engine.py:124` calls `logger.DebugLogger(...)`, but the module-level `logger` is
  already a `DebugLogger` instance. The palettes always pass one, which is why this was never hit.
  Send must pass one too, or S5 fixes that line.
- **FB-ORDER covers only the sketches.** MEASURED: it runs at the end of the sketch build, so the 4
  BAR extrudes and the `TRIM_CUT` from the separate solid build land **after** the inlay. Send's own
  order (§4 box) avoids this. For standalone frames, FB-ORDER should also run after
  `build_solid_logic_v3` (S6).

**Parameter ownership, one declared registry:**

```
PARAM_OWNERS (generated into frame-defs.json from ParameterSchema + template params)
  board: widthIn, heightIn                      writer: Send only      tag Bspline.owner=1   (exists)
  frame: frame_thickness, boundingboxoffset,    writer: frame_engine   tag FrameBuilder.owner=1 (new)
         frame_height_offset, ck_*
```

- **Send never writes a frame param directly.** It passes values in `ui_data`, and `frame_engine`
  stays the only writer, as today. One writer per param.
- **Cleanup rule:** a future stale-param cleanup may delete only params carrying **its own** owner
  tag that nothing references. Frame params carry the frame tag, so a board cleanup can never touch
  them. No cleanup exists yet, and the `deleteMe` calls in Send act on occurrences only (verified).
- **FB-ORDER stays** as the safety net for standalone frames (palette-built after an inlay). After
  FB-APP, Send's own ordering makes it a no-op.

---

## 5. Stages, parity tests, risks, open questions (F1 item 5)

### 5.1 Stages (each one ships alone, and main stays green)

| Stage | What | Fusion? | Done when |
|---|---|---|---|
| **S0** | Clean-up: drop `Skel_Frame_Taper` / `Skel_Slot_Tolerance` / the `Taper` unit rule; one declaration of `frame_thickness` / `boundingboxoffset`; catalog T3/T4 + "Metric" text; stale semantic doc | no (pytest) | `test_board_params_ownership` + template tests green; mutation check for each removal |
| **S1** | `FRAME_REGIONS` / `FRAME_FEATURES` in `template_data.py`; ONE appearance declaration (the palette `<select>` + Python fallback read it); `tools/gen_frame_defs.py`; `frame-defs.json`; freshness + declaration + schema tests | no | tests red on a stale or renamed ID, green after regenerating |
| **S2** | Layer `role` registry; Frame section; 2D guide layer | no (vitest + screenshots) | guide absent from SVG / payload / carve (test each path); not hittable |
| **S3** | 3D frame mesh | no (screenshot) | bars visible, unchanged across a terrain rebuild |
| **S4** | Record the parity fixture (§5.2); tune the JS preview to it | **yes** (record once) | parity tests green |
| **S5** | Send integration: payload key, declared `core.underside`, `AestheticCore` stamp, owner tags, logger, call order | **yes** | one Send builds body → Frame_N → inlay; timeline order measured, not assumed |
| **S6** | Extruder reads declared `features`; bounding-box classifier kept only as a fallback; FB-ORDER also runs after the solid build | yes | same 4 bars + trim as today on T1/T2; standalone extrudes land before the inlay |
| **S7** | Re-Send = delete the previous frame (the `FrameBuilder.ComponentType=Frame` occurrence, found by attribute, not by name), then rebuild (Q1 answered) | yes | two Sends leave exactly one `Frame_1`, all features healthy |

### 5.2 Parity tests: app preview vs Fusion build, per feature

Record once, live: a `fusion_execute` script builds T1 and T2 at three board sizes (for example
7×9, 5.51×1.97, 12×6) and dumps the **solved** geometry to `tests/fixtures/frame-parity/<T>_<w>x<h>.json`:

- sketch-2 curve endpoints and arc midpoints
- sketch-3 `inner_*` endpoints and the miter lines
- each BAR body's bounding box and volume
- the trim cut's profile area

These files are goldens and are re-recorded only on purpose. Vitest then compares the app's preview
to each golden:

| Feature | App side | Assertion |
|---|---|---|
| Silhouette outline | `generateSilhouette(safeZone, preset)` | every sampled point within tol (proposed 0.01 in) of the golden curve |
| Inner offset | inset by `frame_thickness` | same tolerance; also direction (inside vs outside) as a hard assert |
| Miters | declared corners | endpoints within tol |
| Bars | `frame-mesh.js` | count 4, labels TOP/RIGHT/BOTTOM/LEFT, bbox within tol |
| Trim | surround − outline | area within 1% |

Each test is proven non-vacuous: shift the preset's waist by one tolerance and it must go red. The
fixture script is kept next to `tools/repro/` so it can be re-run.

### 5.3 Risks

1. **Re-Send breaks the extrude (MEASURED), and deleting and rebuilding fixes it (MEASURED).**
   - Deleting the body, as `_remove_last_import()` does, leaves all 4 BAR extrudes in warning state
     ("Face 1 missing … using cached geometry"), makes `TRIM_CUT` disappear, and does **not** rebind
     them to the new body. The frame also ends up before the new body in the timeline.
   - Deleting the `Frame_1` occurrence then removes its sketches and features cleanly. The frame params
     persist and are reused.
   - The rebuild is named `Frame_1` again (the lowest free name), so nothing accumulates. Its bar
     volumes are identical to the first build (190.28 / 92.40 / 81.14 / 189.69 cm³) and every feature
     is healthy. S7 does exactly that (Fred, Q1).
2. **The JS solver drifts from Fusion's solve.** It was hand-ported, and its symmetric shoulders
   differ from T1's seeds. The only guard is the parity goldens (§5.2).
3. **Template-maker templates.** A new maker template shows up in `frame-defs.json` automatically
   (§2.1), but the app only has closed-form solvers for `hourglass` / `bottle`. A template without a
   `silhouettePreset` would need either a new JS solver or a guide showing only the bounding box and
   the surround.
4. **FB-ORDER's Fusion glue (MEASURED, works for the sketches).** It moved `Frame_1` and its 3
   sketches before `Plane for L1` as one unit. It does not cover the solid build (see §4, "FB-ORDER
   covers only the sketches").
5. **Bar height mapping, resolved (MEASURED, §3.3).** Bars run from `frame_height_offset` up to the
   sculpted underside. The preview uses the terrain's bottom surface, not `carveZ`.
6. **A single failed feature is hidden.** The extruder logs and swallows per-profile failures
   (`extrusion_engine.py:169-171`). A Send that "succeeds" with 3 bars instead of 4 would look fine.
   S5 should report the bar count back to the palette in `import_success`.

### 5.4 Open questions for Fred

1. ~~**Re-Send.** Update in place, or delete and rebuild?~~ **ANSWERED (Fred, 2026-09-26):** Send is
   a one-shot handoff ("I'll tweak in Fusion directly, no need for update in place"), so re-Send
   deletes the previous frame and rebuilds it cleanly. No `Frame_N` accumulates and nothing is updated
   in place (S7).
2. ~~**Frame "none".**~~ **ANSWERED (Fred):** the app starts with **no** frame (it is optional and
   the user adds it), and a board sent with no frame behaves exactly as today. That is declared as
   `defaultTemplate: null` (§2.1).
3. ~~**Start offset.**~~ **ANSWERED (Fred): it's a position, not a value.** `frame_height_offset`
   (−1 in) is the Z of the frame's bottom relative to the sketch plane. It keeps its name and its
   negative value, and the app labels it "Frame bottom (z)". Its purpose: the extrude goes up to the
   carved underside, so without the offset some part of a bar could have zero height.
   **MEASURED:** all 4 bars' bottoms sit at exactly z = −2.54 cm = −1 in, and their tops meet the
   underside. The sample panel does not start exactly at z = 0: its lowest point is −0.113 cm.
4. ~~**Appearance.**~~ **ANSWERED (Fred), and a correction.** The Extrude palette's default is
   `3D Ash - Unfinished`, its first of 5 woods. `'Polished Chrome'` is only the Python fallback when
   nothing is sent (`solid_builder_ui.py:160`); the earlier version of this doc was wrong about that.
   Decision: the default is `3D Ash - Unfinished`, and the app's Frame section offers the same 5 woods.
   The list is declared once (§2.1) and read by the palette, the app and the Python fallback.
5. ~~**Drawing area.**~~ **ANSWERED (Fred):** the inlay artwork and the frame are unrelated. There is
   no clipping and no interaction; the frame in the editor is a purely visual guide (locked, not
   exported). No stage or risk depends on clipping.
6. **Standalone palettes.** Do the Sketch Builder / Extrude Frame palettes stay after FB-APP, or does
   FB-APP replace them? The design keeps them, which is why FB-ORDER stays.
