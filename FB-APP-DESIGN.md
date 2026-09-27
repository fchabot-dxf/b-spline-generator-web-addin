# FB-APP — Frame Builder inside the main app (design, F1)

**Status:** design, plus S0 / S1 / S4-goldens / FB-ORDER fix landed on `fb-app` (F2–F3). Seat C,
epoch 1, 2026-09-26.
**Asks:** Fred wants to "decide the shape of the frame first and then the drawing on it", see the frame
previewed in the app (2D and 3D), and send it to Fusion with its features staying genuinely
parametric (ROADMAP.md "Idea — FB-APP"). Since F3 AMEND 7b this means **two buttons**, `[Send B-spline]`
and `[Send frame]` (§4). The frame always lands before the inlay.

Paths are relative to `bspline-frame-builder/`. `FB` = `frame-builder/` and `APP` = `b-spline-gen/html/`.
Anything not yet confirmed live is marked **UNVERIFIED**. Items measured live are marked **MEASURED** and
give the numbers: F2 used a scratch document built with a copy of a real Send panel, 7×11 in; F3 used
scratch documents plus the S4 goldens.

```
 TODAY                                         FB-APP
 ─────                                         ──────
 app ── Send ──► body + inlay                  app: pick frame ─► cut profile + 3D preview ─► draw inlay
                 (Frame_N absent)                          │                       │
 Fusion: open Sketch Builder palette           [Send B-spline]            [Send frame] (re-sendable)
   ─► pick template ─► Build (sketches)         board + body + inlay      frame sketches + extrude + trim
   ─► open Extrude Frame palette                (unchanged)               ─► FB-ORDER: before the inlay
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
            │                                                         ├─► app: frame record, cut profile, 3D 
            └───────────── fb_engine (unchanged) ─────────────────────┘   (reads JSON)
                                                    Fusion build reads the Python directly
```

The file has to be checked in: the app is static on Cloudflare Pages and cannot call Python at runtime.

### 2.1 Shape: BUILT in S1 (F3)

**Files:**
- The generated file is `APP/data/frame-defs.json`, about 73 KB and checked in.
- It is regenerated by `python tools/gen_frame_defs.py`; `--check` exits 1 when the file is stale.

**Where each declaration lives:**

| Declaration | Where | What |
|---|---|---|
| Common to every frame | `FB/fb_engine/frame_definition.py` (pure, no `adsk`) | `DEFAULT_TEMPLATE = None`, `APPEARANCE_OPTIONS` / `DEFAULT_APPEARANCE`, `FRAME_BOTTOM_PARAM` / `DEFAULT_FRAME_BOTTOM_EXPR`, `EXTRUSION_SETTINGS`, `COMMON_FRAME_FEATURES`, `build_frame_defs()` |
| Per template | `sketches/template_N/template_data.py` | `FRAME_SILHOUETTE_PRESET`, `FRAME_REGIONS`, `FRAME_FEATURES`, returned in the spec as a `"Frame"` key next to `"Sketches"` |
| Template list | `template_resolver` folder discovery | no hand-kept list; the dead `template_catalog.py` was deleted in F3 |

Top-level shape, abridged from the real file:

```json
{
  "frameDefsVersion": 1,
  "sourceHash": "<sha256 over frame_definition.py, parameter_schema.py and sketches/**/*.py, CRLF-normalized>",
  "units": "in",
  "defaultTemplate": null,
  "appearance": {"default": "3D Ash - Unfinished",
                 "options": ["3D Ash - Unfinished", "3D Mahogany - Unfinished", "3D Pine - Unfinished",
                             "3D Cherry - Unfinished", "3D Maple - Unfinished"]},
  "extrusion": [
    {"key": "frameBottomZ", "param": "frame_height_offset", "unit": "in", "default": -1.0,
     "label": "Frame bottom (z)", "ui": true, "owner": "frame",
     "meaning": "z position of the frame bottom relative to the frame sketch plane (negative = below); a position, not a length"},
    {"key": "appearance", "label": "Wood", "ui": true, "default": "3D Ash - Unfinished", "options": "appearance"},
    {"key": "endOffset", "unit": "in", "default": 0.0, "ui": false, "meaning": "fixed literal today ('0 in', flush fit)"},
    {"key": "toFace", "value": "core.underside", "ui": false, "meaning": "face with n.z ~ -1 (MEASURED F2)"}
  ],
  "templates": [{
    "id": "template_1", "name": "Template 1 - Hourglass", "prefix": "T1", "silhouettePreset": "hourglass",
    "params": [{"name": "frame_thickness", "unit": "in", "default": 0.75, "min": 0.25, "max": 1.5,
                "owner": "frame", "expose": true, "label": "Frame thickness", "category": "Frame Spec"}, "…"],
    "regions": {"outline": ["proj_top_edge", "…12 ids"], "inner": ["inner_proj_top_edge", "…"],
                "miters": [["proj_top_edge:S", "inner_proj_top_edge:S"], "…4 pairs"], "surround": "surround_rect"},
    "features": [{"id": "bars", "op": "newBody", "region": "outline-minus-inner", "splitBy": "miters",
                  "start": "frame_height_offset", "extent": {"toFace": "core.underside", "offset": "0 in"},
                  "taper": "0 deg", "bodyNames": ["frame_top", "frame_right", "frame_bottom", "frame_left"]},
                 {"id": "trim", "op": "cut", "region": "surround-minus-outline", "start": "0 in",
                  "extent": "throughAll", "taper": "0 deg"}],
    "sketches": ["…get_template_logic() Sketches/Blocks, verbatim…"]
  }, {"id": "template_2", "silhouettePreset": "bottle", "…": "…"}]
}
```

- **`sketches` is verbatim.** Everything else is declared data. Region IDs are copied from each
  template's own `p03_*` phases, and a test proves each one exists in the blocks (§2.2).
- **The extruder reads `features` from S6 on.** Until then it still classifies profiles by bounding
  box; the declaration exists before its consumer.
- **The bars lie inside the silhouette.** `region: "outline-minus-inner"` places them between the
  outline and `inner_*`. **MEASURED** (T1, 7×11 in board):
  - The outline sits at x = ±8.26 cm (3.5 in − 0.25 in `boundingboxoffset`) and the inner edge at
    ±6.35 cm, 0.75 in (`frame_thickness`) further in.
  - Sketch 3 has 6 profiles: 4 bars between those two edges, the surround (profile 2, 22.2 × 34.9 cm
    = 1.25 × the board) and the centred void (profile 4).
- **No frame by default.** `defaultTemplate: null` means the app starts with none and the user adds
  one (Fred, Q2).
- **Appearance is declared once** (Fred, Q4).
  - Before, there were three lists that disagreed:
    - the palette's 5 woods;
    - `APPEARANCE_PRESETS`, which had Ash / Maple / Pine plus Enamel / Aluminum / Brass, was imported
      and never read, and is now `list(APPEARANCE_OPTIONS)`;
    - the `'Polished Chrome'` fallback in `solid_builder_ui.py`, which now reads `DEFAULT_APPEARANCE`.
  - The palette's own `<select>` is still static HTML, but a test fails if it drifts from the
    declaration.
- **`frame_height_offset` is a Z position, not a length** (Fred, Q3). It keeps its name and its
  negative value (−1 in) with no migration, and is labelled "Frame bottom (z)". The UI fallback
  `'-1 in'` now reads `DEFAULT_FRAME_BOTTOM_EXPR`.

### 2.2 Versioning and tests: BUILT in S1 (F3)

**Versioning:**
- `frameDefsVersion` bumps only when the JSON **shape** changes, and the app refuses a version it
  doesn't know.
- `sourceHash` normalizes CRLF, so a checkout's line endings never make the file look stale.

`FB/test_frame_defs.py` has 10 tests, all plain Python:

| Test | Guards | Mutation proof |
|---|---|---|
| `test_checked_in_file_is_fresh` | the file == `render()` now | a one-literal edit in T1's `p02_03_loop.py` → red |
| `test_top_level_schema`, `test_frame_bottom_is_declared_as_a_z_position`, `test_every_template_entry_is_complete` | the shape the app reads; template ids == discovery | — |
| `test_every_declared_region_id_exists_in_the_blocks[T]` | every region id is created by that template's blocks | T2's `Frame` key removed → red (plus freshness) |
| `test_a_renamed_id_goes_red` | the checker itself catches a renamed id | built-in |
| `test_extrude_palette_woods_match_the_declaration`, `…default_offset…` | the palette HTML can't drift from the declaration | a wood renamed in the palette → red |
| `test_every_silhouette_preset_exists_in_the_app` | `silhouettePreset` ∈ the app's `PRESETS` keys | — |

A JS-side schema test (`tests/frame-defs.test.js`) comes with S2, when the app first reads the file.
This is the first **Python→JS** generated file in the repo. The existing generated artifact runs the
other way (`editor-sketch-manifest.js` → `sketch_manifest_builder.py`, with
`tests/parity-app-manifest.test.js`).

---

## 3. App side: "two doors, one room" (UI approved by Fred, F3)

### 3.0 Headline requirement (Fred: "that's the whole point, make it good")

Once a frame is chosen, the board **is** the frame's cut profile:

- **The editor draws the board as the cut profile.** The board's shape is the silhouette outline,
  i.e. what the SURROUND trim leaves, not a rectangle with a thin guide. Outside the profile is
  clearly shaded as cut away. Grid, snapping and fit-to-view follow the new outline.
- **The artwork is never modified** (Q5: no clipping, no interaction).
- **The 3D preview matches.** It trims the carved panel to the same profile and shows the 4 bars in
  the chosen wood.
- **Everything updates live** on any template, parameter or shape-handle change.
- **One outline source:** the generated frame definition, the same one Fusion builds from, guarded
  by the S4 parity goldens.

```
 before (no frame)                     after (T1 Hourglass chosen)
 ┌──────────────────────┐              ░░░░░░░░░░░░░░░░░░░░░░░░   ░ = cut away (shaded)
 │                      │              ░┌────────────────────┐░
 │   artwork …          │              ░│╲                  ╱│░   board = cut profile
 │                      │     ──►      ░░ )   artwork …    ( ░░   (the silhouette outline)
 │                      │              ░│╱                  ╲│░   grid / snap / fit follow it
 └──────────────────────┘              ░└────────────────────┘░
   board = W×H rectangle               ░░░░░░░░░░░░░░░░░░░░░░░░   artwork itself: untouched
```

### 3.1 The two doors

**Door 1: the main sidebar's FRAME section.** It sits **second**, directly after 📐 STOCK DIMENSIONS
(`bspline_gen_palette.html:361`) and before SEED / SKELETON / FILTER / VECTOR STAMPING. It is
collapsible like the others, and with template "none" it collapses to a one-line summary (Fred,
F3 AMEND 6). It holds the **solid-extrusion settings**: how the frame is extruded.
These are exactly the Extrude Frame palette's inputs today (inventoried in `frame-defs.json`
`extrusion`, the `ui: true` entries), plus the template choice and the door into the shape editor:

```
┌ 🖼 FRAME ─────────────────────────────┐
│ Template   [ none ▾ ]  none|Hourglass|Bottle   ← defaultTemplate: null
│ Frame bottom (z)  [ -1 in ]      ← frame_height_offset (a Z position; negative = below plane)
│ Wood       [ 3D Ash - Unfinished ▾ ]   ← appearance.options (5 woods)
│ [ Edit frame shape ✎ ]           ← opens the editor on the Frame tab
└──────────────────────────────────────┘
```

- The palette's face pick is not a control here: it is declared (`toFace: core.underside`).
- The end offset stays a fixed `0 in` literal (`ui: false`).

**Door 2: the full-screen SVG editor gains top-level mode tabs `[ Frame | Artwork ]`.**

- **Frame tab: the SHAPE**, i.e. what the Sketch Builder does today, seen from above. The canvas is
  the board with on-canvas **drag handles** for the frame shape (waist / corner / neck, the same
  handle family as the Shape Lattice). The right column holds the shape parameters (for example
  `frame_thickness`, plus the shape's own parameters) and the wood.
- **Artwork tab:** today's editor, unchanged, except that the board is drawn as the frame's **cut
  profile** with the outside shaded (§3.0).
- **Opening it:** "Edit frame shape" opens the editor on the Frame tab; "Open SVG Editor 🎨"
  (`bspline_gen_palette.html:600`) opens it on the Artwork tab.
- **Tabs switch any time.** There is one project and one frame record: the sidebar and the Frame tab
  edit the same record, and the 3D preview always shows the trimmed panel plus the bars.

```
┌ SVG editor ─────────────────────────────────────────────────────────────┐
│  [ Frame ]  [ Artwork ]                                                  │
├──────────────────────────────────────────────┬──────────────────────────┤
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │ Template  [Hourglass ▾]   │
│   ░┌──────────────────────────────┐░         │ Frame thickness [0.75 in] │
│   ░│╲            ●               ╱│░  ● = drag handle                    │
│   ░░ )●       (waist)          ●( ░░         │ Waist reach    [0.55]     │
│   ░│╱            ●               ╲│░         │ Corner radius  [0.22]     │
│   ░└──────────────────────────────┘░         │ Waist centre Y [0.00]     │
│   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░       │ Wood [3D Ash ▾]           │
│   Frame tab: outline + inner edge + miters   │ [ Reset shape ]           │
└──────────────────────────────────────────────┴──────────────────────────┘
```

### 3.2 Data model: the persisted frame record (AMEND 3)

The frame is part of the **project** state: saved and loaded with the project, and re-editable any
number of times (Frame → Artwork → Frame …). It is one declared record, in `core/state.js` next to
`widthIn` / `heightIn`:

```js
frame: {
  recordVersion: 1,
  templateId: null,            // null = no frame (defaultTemplate); else a frame-defs.json template id
  params: {                    // template params the user changed (defaults come from frame-defs.json)
    frame_thickness: 0.75,
  },
  shape: {                     // on-canvas handle edits (see ⚠ gate below)
    waistReach: 0.55, cornerRadius: 0.22, waistCenterY: 0,   // hourglass; bottle: neckWidth, skeletonX, neckLength
  },
  extrusion: { frameBottomZ: -1.0, appearance: '3D Ash - Unfinished' },
}
```

- **Only overrides are stored.** Anything missing falls back to `frame-defs.json`. A regenerated file
  never has to migrate a saved project unless `recordVersion` bumps.
- **Once sent to Fusion it is one-shot** (Q1). Fusion-side edits stay in Fusion and never flow back.

**Frame vs Shape Lattice.** They are **separate records sharing ONE silhouette engine**:
`generateSilhouette` and the `PRESETS` in `editor-shape-lattice-generator.js`. The frame never
duplicates that math, and the frame's handles call the same solver the lattice's handles call.

**Ownership table:**

| Part | Owns | Reads | Never |
|---|---|---|---|
| Frame (sidebar + Frame tab) | the frame record | `frame-defs.json` | touches artwork |
| Editor, Artwork tab | layers + artwork | the **cut profile** derived from the frame record | edits the frame |
| 3D preview | nothing (renders only) | the frame record + terrain | — |
| Fusion (Send) | the built frame (one-shot) | the frame record in the payload | writes back to the app |

⚠ **GATE: shape handles vs a parametric Fusion build.** This one needs Fred.

The Fusion templates have **no shape parameters**. The span and radius drivers were retired, and the
seeds are hard-coded `widthIn` / `heightIn` fractions (`template_data.py`, `SKETCH_2_PARAMETERS`
comment). So a waist dragged in the app **cannot reach Fusion parametrically** today. The options:

- **(a) Recommended: give the templates declared shape parameters again.** The app's preset params
  (`waistReach`, `cornerRadius`, `waistCenterY` / `neckWidth`, `skeletonX`, `neckLength`) become
  Fusion user params. The phase seeds reference them instead of literals, Send passes them, and the
  shape stays parametric in Fusion. This needs the seed-expression mapping and parity per preset.
- **(b) Send the app-solved outline as fixed geometry.** Fusion's outline would no longer be
  parametric in shape; only the board size and thickness would drive it.
- **(c) No shape handles in v1.** Template + `frame_thickness` only; handles later with (a).

One option is safe whatever Fred picks: (c) ships first and (a) follows it.

#### 3.2.1 Frame shape handles: the binding table (F9, BUILT)

Fred ruled that every handle ships, and **frames never get new Fusion params**. Each handle's
binding is declared in **one table**: `FRAME_HANDLES` in each `sketches/template_N/template_data.py`,
generated into frame-defs `templates[].handles`. The app (`editor/frame-handles.js`) and later S5
read only that table. This section names the source and does not copy it; `test_frame_defs.py`
checks every entry. Snapshot at F9:

| template | handle key (app shape param) | label | basis | binding |
|---|---|---|---|---|
| template_1 (hourglass) | `waistReach` | Waist reach | hw | seeded |
| template_1 | `cornerRadius` | Corner radius | hw | seeded |
| template_1 | `waistCenterY` | Waist position | hh | seeded |
| template_2 (bottle) | `neckWidth` | Neck width | hw | seeded |
| template_2 | `skeletonX` | S-curve tightness | hw | seeded |
| template_2 | `neckLength` | Shoulder height | h | seeded |

- **seeded** (every handle today): no existing template param controls these features. The shape
  comes from the literal seeds in `phases/p02_*` (e.g. `p02_02_anatomy.py`, the
  `seed_rad_*` dimensions in `p02_09_radius_removal.py`).
  - The dragged value (a fraction of `basis`) lives in the frame record's `seeds`.
  - `framePayload()` (core/frame-record.js) carries it under `seeds`, never as a param.
  - S5's [Send frame] must write it into the sketch as a plain seed value or position. **The
    mapping from each key to its Fusion seed is S5 work and is UNVERIFIED:** it needs Fusion.
- **`{ "param": name }`**: an EXISTING frame-owned template param. The handle writes
  `params[name]` in inches (fraction × basis), and the payload carries it as that param. A handle
  moves from seeded to param-bound only once per-value goldens prove the match (the preview at 2-3
  values equals the Fusion outline at those values, the S4 tolerance).
  - **No candidate param exists today**, so there is no recording step list for Fred yet. The day a
    template gains a matching param, the steps are the S4 recorder (`tools/repro/record_frame_parity.py`)
    run at 2-3 values of that param.
- A template change resets the seeds (`setFrameRecord`). The gate (`normalizeFrameRecord`) keeps only
  that template's declared seeded keys.

### 3.3 Geometry: one engine, one outline

- **Outline:** `generateSilhouette(region, shape)` (`APP/editor/editor-shape-lattice-generator.js:517`,
  `PRESETS` at `:103`). It is given the **safe-zone** region (the board inset by `boundingboxoffset`),
  and `shape` comes from the frame record, with the preset from `silhouettePreset`.
  - These solvers were hand-ported from the same T1/T2 phases (`:8-30`), and they solve the
    tangencies exactly, which the seed data cannot do (§1.1).
- **Inner edge:** offset by `frame_thickness` with `insetGeneratedPresetPathDToPrimitives`
  (`APP/editor/editor-lattice-boundary.js:262`).
- **Miters and surround:** from the declared `regions` (4 corner pairs; `widthIn*1.25` × `heightIn*1.25`).
- **Cut profile** = the outline. The editor's board clip-path and shading and the 3D trim both use it.

⚠ **Known approximation.** The JS solver makes the shoulders symmetric, whereas T1's seeds keep a
deliberate L/R difference (0.34996 vs 0.350521). Whether the *solved* Fusion geometry keeps any of
**MEASURED (F3 goldens):** the solved T1 is exactly L/R mirror-symmetric, so the symmetric JS
solver matches Fusion (§5.2).

### 3.4 3D preview (S3 headline: the trimmed panel + bars)

- `APP/core/preview/index.js` (`TerrainPreview`) builds only heightfield meshes. The app loads
  three.js **r128 full** (`bspline_gen_palette.html:15`), which includes `THREE.Shape` and
  `THREE.ExtrudeGeometry`.
- **Trimmed panel.** Clip the carved panel to the cut profile. The heightfield keeps its grid, and
  cells outside the outline are dropped or cut along it. This is the S3 headline, **not optional**.
- **Bars.** Add `core/preview/frame-mesh.js`: one `THREE.Group` with one `ExtrudeGeometry` per bar
  (`outline − inner`, split at the miters), tinted by the chosen wood. It is kept **outside** what
  `_dispose()` / `update()` clears, and rebuilt only when frame inputs change.
- **Bar height, MEASURED.** Each bar starts at z = `frame_height_offset` below the frame sketch
  plane (world XY, z = 0): −1 in gives z = −2.54 cm. It rises to the **panel's underside**, which
  is sculpted, not flat: bar tops are 0.99–1.65 cm on a panel spanning z = −0.113 to 2.204 cm. So
  there is no single bar height and no `carveZ` mapping; each bar's top is the terrain's **bottom
  surface** (`buildSolidMesh`'s `offsetPts` grid, `core/preview/terrain-mesh.js:131`).
- **Which face, MEASURED (Fred's input confirmed).** All 6 faces of a Send panel are NURBS, so the
  face is identified by its normal:
  - **Underside** (n.z = −0.99): the bars stop at the panel, and its volume stays 187.5 cm³ after
    the trim.
  - **Top** (n.z = +0.99): each long bar is +21 cm³ bigger (211.7 vs 190.3), and the extra runs
    through the panel's edge.
  - Declared name: `core.underside`. Screenshots: `~/.bspline-status/shots/seatC/1644_F2_bottomface-bars.png`,
    `1646_F2_resend-rebuild-timeline.png`.

### 3.5 Acceptance for S2 / S3 (screenshots, before merge)

- **Matrix:** T1 and T2, each on **desktop and mobile**, 8 shots in all:
  1. the sidebar FRAME section;
  2. the Frame tab with its handles;
  3. the Artwork tab with the board as the cut profile and the outside shaded;
  4. 3D with the panel trimmed and the bars in wood.
- **Plus live-update proof:** change `frame_thickness`, one handle and the wood, and all three views
  update without a reload.
- **Plus a round trip:** Frame → Artwork → Frame → save → reload, with the record intact.
- **Serving:** from the `bspline-frame-builder/` folder, so the CSS loads:
  `python -m http.server 8784 --directory …/bspline-frame-builder` →
  `/b-spline-gen/html/bspline_gen_palette.html`.

---

## 4. Send order and parameter ownership: TWO buttons (Fred, F3 AMEND 7b)

Fred's concern: the Frame Builder's **waist arcs sometimes invert** on themselves. Automating the
frame into the one Send is therefore risky, so the frame gets its **own** button and can be redone
alone. There are exactly two buttons, no "Send all", and no separate "Send art":

```
 [ Send B-spline ]   = today's Send, UNCHANGED
    1 board params   widthIn, heightIn                         owner: board (Bspline.owner=1)
    2 body           B-Spline Set -> Clean/panel               + NEW: stamp FrameBuilder.ComponentType=AestheticCore
    3 inlay          per-layer planes + sketches ("Plane for L…" / "Source - L…")

 [ Send frame ]      = the frame on its own; re-sendable (Q1: delete the previous frame + rebuild)
    0 requires a B-spline body in the document; the button is disabled with a hint otherwise
      (the bar extrude goes TO the body's underside)
    1 delete the previous Frame_N (found by the FrameBuilder.ComponentType=Frame attribute)
    2 frame_engine.build_frame_logic(styleId, data={ui_data: payload.frame.params})   owner: frame (NEW FrameBuilder.owner=1)
    3 solid_coordinator.build_solid_logic_v3(to_face=<declared core.underside>, start=frame_height_offset)
    4 FB-ORDER ensure_frame_before_inlay (fixed in F3): the frame block lands before the inlay,
      whichever button was pressed first
    5 inversion check on the SOLVED outline (§5.1 S8): a broken frame warns, and is not silently kept
```

- **Order no longer depends on which button came first.** "Send frame" after "Send B-spline"
  relies on FB-ORDER (verified live F3). "Send B-spline" after a frame leaves the frame in place,
  and the next "Send frame" rebuilds it cleanly. Re-Sending the B-spline deletes the body, which
  breaks the frame's extrude references (MEASURED F2), so the app should say "frame needs re-send"
  after a B-spline re-send.
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
  "Send frame" must pass one too, or S5 fixes that line.
- **FB-ORDER covers the whole block: FIXED in F3, verified live.**
  - Before: it ran only after the sketch build, so the solid build's 4 BAR extrudes and the
    `TRIM_CUT` landed after the inlay.
  - Now: every frame build step ends with the one call `timeline_order.ensure_frame_before_inlay`
    (both sketch entry points and `SolidCoordinator.run`).
  - Two more live findings, both fixed:
    - **The `TRIM_CUT` lives in `Clean`**, the component of the body it cuts, so component
      ownership can't find it. Every extruded feature now carries the declared
      `FrameBuilder.FrameComponent` attribute, and FB-ORDER reads that first.
    - **`TimelineObject.canReorder` is a METHOD** `canReorder(beforeIndex)`. The algorithm read it
      as a property, a bound method that is always truthy, so the any-refusal-moves-nothing safety
      net could never fire on real Fusion. It now calls `canReorder(<earliest inlay index>)`, and
      the test fake mirrors the method.
  - Live result: `Frame_1` → 3 sketches → 4 extrudes → `TRIM_CUT` → `Plane for L1` →
    `Source - L1`, every feature healthy, bar volumes unchanged.

### 4.1 [Send frame]: as built (F10, S5) and Fred's live check

**As built.**
- **Button:** sidebar FRAME, `#btnSendFrame`. `frameSendState()` in main/frame-panel.js decides
  whether it is enabled and what hint it shows.
- **Payload:** `framePayload()`, core/frame-record.js. It carries the template, every frame param
  (incl. `boundingboxoffset`), `frameBottomZ`, the wood and the seeds.
- **Transport:** palette action `send_frame` → b-spline-gen.py `_handle_send_frame` (additions only)
  → `fb_engine/send_frame.py`. The reply is the palette action `frame_result`, and the send is also
  saved in `last_send.json` under the key `frame`.
- **Steps in send_frame.py:**
  1. Refuse, with a clear message and nothing touched, when there is no B-spline body
     (B-Spline Set / Clean / panel), no template, an unknown template, or no downward face.
  2. Delete the previous frame **by attribute**: the `ComponentType=Frame` occurrences, and the
     features it put in other components (the TRIM_CUT in Clean), found by `FrameComponent`.
  3. `build_sketch_logic_v3` (full build). `ui_data` = the payload params, filtered to the
     template's own declared params, because every `ui_data` key becomes a user parameter.
  4. `build_solid_logic_v3` to `core.underside` (the face whose normal at `pointOnFace` has
     n.z ≤ −0.9), starting at `frameBottomZ`, in the chosen wood.
  5. FB-ORDER: both builds already end with it.
- **Why not `build_frame_logic`:** it calls a `_create_assembly_joints` method that doesn't exist.

**UNVERIFIED until Fred's run** (none of these can be measured without Fusion):
- The build runs directly inside the palette's HTML event handler, as Send B-spline does. The Frame
  Builder palettes run theirs through a hidden command instead.
- Deleting a Frame_N occurrence together with its tagged TRIM_CUT leaves the Clean body healthy.
- The Clean occurrence's proxy body gives world-space face normals.
- AestheticCore is **not** stamped. The body is passed directly, and the file fence keeps
  `_handle_generate` unchanged.

**Seeds: GATE (not applied in Fusion).** The template phases have no dimension that can receive a
seeded handle value: T1's `seed_rad_*` radius dims are deleted in `p02_09`, and T2 has none. The
shape comes from literal seed points in an under-constrained sketch. So the handler reports
`seeds.applied = false`, and the button's hint and the status line say so.
- **(A)** Add plain driving dimensions to the phases, used only when a seed is present. For T1:
  keep `seed_rad_shoulder_*` / `seed_rad_hip_*` at the seeded radius, and add dims for the waist
  centre height and depth; the same for T2's neck. Each handle is proven by goldens recorded at 2-3
  seeded values (the S4 recorder, S4 tolerance). No user params are created.
- **(B)** Move only the literal seed points. It's cheap, but the solver can land anywhere nearby,
  so parity can't be proven.
- **(C)** Leave it as now: seeds shape the app preview only.
- **Recommended:** (A), T1 first.

**Fred's live step list** (Fusion, his machine):
0. **Deploy and reload.** Deploy fb-app, then restart Fusion. If the web palette shows the old UI,
   delete the palette first (the reload gotcha).
1. **Order 1, B-spline then frame.** New design → open the app from the add-in → Stock 7x9 → **Send
   to Fusion** (Send B-spline) and wait for "Imported". Then FRAME: Template Hourglass,
   Trim offset 0.5, Wood Cherry → **Send frame**.
   - Pass:
     - the status line reads "Frame built in Fusion: Frame_1";
     - the browser shows one `Frame_1`;
     - the timeline reads B-Spline Set, Clean, the body feature, then `Frame_1`, its 3 sketches,
       4 bar extrudes and `…TRIM_CUT`, then `Plane for L…` / `Source - L…` (the inlay last);
     - Modify → Change Parameters shows `boundingboxoffset` 0.5 in, `frame_thickness` 0.75 in and
       `frame_height_offset` −1 in, and no user parameter named `waistReach` or `cornerRadius`
       (or any other handle key);
     - the bars are cherry, and their tops meet the panel's underside.
2. **Re-send.** Edit frame shape → Frame tab → thickness 0.5 → **Send frame** again.
   - Pass: exactly one `Frame_1`, exactly one TRIM_CUT, thinner bars, and every feature healthy
     (no red or yellow).
3. **Other order.** Send to Fusion again with a new layer (append) or re-send the B-spline, then
   **Send frame**.
   - Pass: the frame block sits before every inlay item. A B-spline re-send without append deletes
     the body, which breaks the frame (known, §4); pressing Send frame then rebuilds it.
4. **No body.** New empty design → pick a template → **Send frame**.
   - Pass: the status line says "No B-spline body in this document: press Send B-spline first…",
     and nothing appears in the browser or the timeline.
5. **Seeds.** Frame tab → drag a handle → the hint says the change isn't sent → **Send frame**.
   - Pass: the status line ends "(1 handle change(s) not applied)", and Fusion builds the
     template's own shape.
- **If any step fails, send back:**
  - `~/.bspline-frame-builder/last_send.json` (its `frame` key holds the payload and the result);
  - `frame-builder-debug.log` (next to the Frame Builder add-in);
  - `b_spline_gen_log.txt` (the `SEND FRAME` lines);
  - a screenshot of the browser tree and the timeline.

**Parameter ownership, one declared registry:**

```
PARAM_OWNERS (generated into frame-defs.json from ParameterSchema + template params)
  board: widthIn, heightIn                      writer: Send only      tag Bspline.owner=1   (exists)
  frame: frame_thickness, boundingboxoffset,    writer: frame_engine   tag FrameBuilder.owner=1 (new)
         frame_height_offset, ck_*
  lattice: stroke_width, rail_width, tie_width,  writer: Send (b-spline-gen sketch_manifest_builder
         node_diameter, half_width,              _sync_manifest_parameters)   tag Bspline.owner=1
         contour_width, contour_height           (R4: ParameterSchema _LATTICE_OWNED_PARAMS / is_lattice_owned)
```
(F9: `boundingboxoffset` is a normal template param now, gate A. The build writes the sent value on
every build; it was a ReadOnly master that was created once and never updated.)

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
| **S1 ✅ F3** | `FRAME_REGIONS` / `FRAME_FEATURES` in `template_data.py`; ONE appearance declaration (the palette `<select>` + Python fallback read it); `tools/gen_frame_defs.py`; `frame-defs.json`; freshness + declaration + schema tests | no | tests red on a stale or renamed ID, green after regenerating |
| **S2** | **Headline: the editor shows the board as the frame's CUT PROFILE** (§3.0). Sidebar FRAME section (extrusion settings, §3.1); editor `[Frame \| Artwork]` tabs; Frame tab with shape params + handles (per the §3.2 gate); the persisted frame record (§3.2); `tests/frame-defs.test.js` | no (vitest + screenshots) | §3.5: T1+T2 × desktop+mobile shots; live update; Frame→Artwork→Frame→save→reload round trip; artwork untouched |
| **S3** | **Headline: 3D panel trimmed to the cut profile + 4 bars in the chosen wood** (§3.4) | no (screenshot) | §3.5 3D shots; bars + trim unchanged across a terrain rebuild; live on param change |
| **S4** | Record the parity goldens (**✅ recorded F3**, §5.2); tune the JS preview to them (with S2/S3) | recorded | app parity tests green against the goldens |
| **S5** | `[Send frame]` button (§4): payload key, declared `core.underside`, `AestheticCore` stamp, owner tags, logger, delete + rebuild; disabled without a B-spline body | **yes** | both button orders give body → Frame_N block → inlay; re-send leaves one `Frame_1`; timeline order measured, not assumed |
| **S6** | Extruder reads declared `features`; bounding-box classifier kept only as a fallback. (FB-ORDER after the solid build: **done in F3**) | yes | same 4 bars + trim as today on T1/T2 |
| **S7** | Re-Send = delete the previous frame (the `FrameBuilder.ComponentType=Frame` occurrence, found by attribute, not by name), then rebuild (Q1 answered) | yes | two Sends leave exactly one `Frame_1`, all features healthy |
| **S8** | **Waist-inversion** (Fred, F3 AMEND 7): (a) a declared sanity check on the frame outline, run in the app preview **and** on the solved Fusion outline: each waist arc's midpoint lies *inside* its ends (the pinch), no self-intersection, arc sweep consistent; warn and don't send / keep a broken frame. (b) Reproduce an inverted build (params + screenshot), turn it into a failing golden, and fix it in the templates' solve | yes (reproduce + fix) | the check is red on the reproduction and green on all 6 goldens; the fix turns the reproduction green |

### 5.2 Parity tests: app preview vs Fusion build, per feature

**RECORDED (F3).** `tools/repro/record_frame_parity.py` runs inside Fusion and writes
`tests/fixtures/frame-parity/<template>_<w>x<h>.json`: T1 and T2 at 7×9, 5.51×1.97 and 12×6. Each
case uses its own scratch doc, never saved.

- **Core:** a *declared* flat box (W × H × 0.75 in, underside z = 0), so the goldens reproduce at
  any size. A real Send panel is sculpted; F2 measured that separately.
- **Parameters:** the template defaults (`frame_thickness` 0.75 in, `frame_height_offset` −1 in).
- **Units:** in, in², in³.
- **Contents, keyed by `FrameBuilder.ID`:**
  - every sketch-2 curve's start / end (arcs also get midpoint, centre and radius);
  - the same for sketch 3;
  - every sketch-3 profile's area and bbox;
  - each bar body's bbox and volume;
  - the panel after the trim;
  - `timelineHealthy`.

Measured results:
- **4 of the 6 cases are healthy 4-bar frames.** Each bar runs from z = −1 in up to the core's
  underside, and its volume = profile area × 1 in.
- **Both 5.51×1.97 cases give 0 bars.** That's the geometry: the safe-zone height
  1.97 − 2 × 0.25 = 1.47 in is less than 2 × `frame_thickness` = 1.5 in, so the inner offset
  collapses. That gives a declared validity rule for the app: a frame is valid only if
  2 × `frame_thickness` < the safe-zone height and width (the hourglass waist may be stricter; the
  app should grey the frame out and say why).
- **T1 is solved exactly left/right mirror-symmetric** (Δx = Δr = 0 to 5 decimals at 7×9 and 12×6).
  The seeds' deliberate asymmetry is solved away, so the app's symmetric solver is right. Top and
  bottom differ slightly (shoulder r = 0.624 in, hip r = 0.628 in at 7×9), which is within the
  0.01 in tolerance.
- **Guard:** `FB/test_frame_parity_goldens.py` (9 tests) checks that all six exist, each is
  consistent (meta vs filename, healthy, 4 or 0 bars, bar z from −1 to 0) and that T1 is symmetric.
  Mutation: breaking one mirrored arc or dropping a bar turns it red.

These files are goldens and are re-recorded only on purpose. Vitest then compares the app's preview
to each golden:

| Feature | App side | Assertion |
|---|---|---|
| Silhouette outline | `generateSilhouette(safeZone, preset)` | every sampled point within tol (proposed 0.01 in) of the golden curve |
| Inner offset | inset by `frame_thickness` | same tolerance; also direction (inside vs outside) as a hard assert |
| Miters | declared corners | endpoints within tol |
| Bars | `frame-mesh.js` | count 4, labels TOP/RIGHT/BOTTOM/LEFT, bbox within tol |
| Trim | surround − outline | area within 1% |

Each app-side test (with S2/S3) must be proven non-vacuous: shift the preset's waist by one
tolerance and it must go red.

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
4. **FB-ORDER: FIXED in F3, verified live.** The whole block, occurrence through `TRIM_CUT`, now
   lands before the inlay. The declared member attribute finds the trim cut, which lives in `Clean`,
   and `canReorder(beforeIndex)` is now called as the method it is (see §4).
5. **Bar height mapping, resolved (MEASURED, §3.3).** Bars run from `frame_height_offset` up to the
   sculpted underside. The preview uses the terrain's bottom surface, not `carveZ`.
6. **A single failed feature is hidden.** The extruder logs and swallows per-profile failures
   (`extrusion_engine.py:169-171`). A Send that "succeeds" with 3 bars instead of 4 would look fine.
   S5 should report the bar count back to the palette in `import_success`.
7. **A unit-suffixed UI value silently zeroes the frame (MEASURED F3).** `BuildContext.resolve_val`
   (`FB/fb_engine/build_context.py:58`) does `float(ui_data[name])` before evaluating any expression.
   So `frame_thickness: '0.75 in'` raises, is logged as `FAIL RESOLVE` and becomes 0 cm, and the
   enclosure offset then "created no geometry": no bars, with no error surfaced. A bare number is
   taken as **cm**, not inches.
   **FIXED in code (F4, verified with fakes; live check is F4 item 4).**
   - There is now ONE declared unit table and resolver: `ParameterSchema.UNIT_TO_CM` / `to_cm`.
     The UI shadow values are parsed with the param's declared unit, so `'0.75 in'` → 1.905 cm and a
     bare `0.75` → inches.
   - A failed resolve raises `ResolveError`, logged `FAIL RESOLVE`. `offset_step` re-raises it, so
     `build_template` reports `CRASH in Sketch`. It is never a silent 0.
8. **The offset is often not parametric (MEASURED F3).**
   - `addOffset2` fails with "argument 2 of type std::vector<SketchCurve>" (`p01_02` and `p03_02`)
     in most builds, and the engine falls back to a non-parametric offset.
   - In those builds `frame_thickness` / `boundingboxoffset` may not drive the offset live in
     Fusion, which undercuts "features genuinely parametric".
   - **FIXED in code (F4; live check is F4 item 4):**
     - `createOffsetInput` now gets a Python **list** of `SketchCurve` (the `std::vector` it names)
       instead of an `ObjectCollection`.
     - A declared `OFFSET_SIDE = "inward"` check flips the driving expression to
       `-(frame_thickness)` if Fusion put the curves outside. Which sign Fusion picks is
       **UNVERIFIED** until live.
     - The fallback is now a logged WARNING ("FALLING BACK to a NON-parametric offset"), not DEBUG.
10. **Board too small for the frame (MEASURED F3, rule declared F4).** `frame_definition.FRAME_FIT`
    (in `frame-defs.json` as `fit`) says `2·frame_thickness < min(W, H) − 2·boundingboxoffset`.
    - `FrameBuilder._check_frame_fit` warns `FRAME FIT: Board too small …` and returns the result
      from `build_frame_logic` / `build_sketch_logic_v3`.
    - The rule predicts all 6 live goldens (0 bars ⇔ too small).
    - The hourglass waist can be stricter than this bounding-box rule; that is a known gap.
9. **Waist arcs can invert (Fred, F3 AMEND 7), NOT reproduced yet.** All 12 waist arcs in the six F3
   goldens pinch correctly (midpoint inside the ends, e.g. T1 7×9: 2.211 vs 2.754 in). The
   parameters that trigger it are unknown. S8 declares the check and hunts for the reproduction.
   Until then `[Send frame]` being re-sendable is the mitigation.

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
   no clipping and no interaction. In the Artwork tab the frame appears as the board's cut profile
   with the outside shaded (§3.0, F3 AMEND 1). It is not an editable or exported layer, and the
   artwork is never modified. No stage or risk depends on clipping.
6. ~~**Standalone palettes.**~~ **ANSWERED (Fred):** keep the Sketch Builder / Extrude Frame palettes
   for now; retiring them isn't a priority. FB-ORDER stays as their safety net.

**All 6 open questions are answered.** The new decision for Fred is the §3.2 gate: shape handles vs
a parametric Fusion build (options a / b / c).