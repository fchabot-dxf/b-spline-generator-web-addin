# User-Drawn Fixed Templates — Plan (T85 item 1)

PLAN ONLY, no code touched to produce this. Scope per the dispatch: data format, generic
builder mapped onto T14-T17, editor UX, a proof plan (Flask as data), validity rules, and the
Template Maker + Frame Inspector retirement sweep.

## 0. The ask, restated

Fred wants to hand-draw a NEW frame shape directly in the app — no AI tokens (Template Maker's
own selection-driven code-preview flow), no handles/sliders (a FIXED shape is fine). The keystone
is **one generic Fusion-side builder** that can build ANY declared-data template with this week's
proven recipe (T14 Sand Timer, T15 Flask, T16 Arched Funnel, T17 Tulip), so adding a new fixed
template never again means writing a `sketches/template_N/phases/*.py` package by hand.

I read T15 Flask's own current implementation in full (its 11 phase files + `template_data.py`)
as the concrete reference for everything below, since the dispatch asks to prove the generic
builder against it specifically.

## 1. The data format

**Reuse, don't reinvent.** Every template already carries a declarative `FRAME_REGIONS` dict
(`outline`, `inner`, `miters`, `surround`, `bars`) that `declared_profiles.py`, `frame_definition.py`
and the app's own frame-defs consumers already read as pure data — T15's `template_data.py` is a
clean example. That shape is correct and stays; what's hand-written today, and what the generic
builder removes, is the Python code that *produces* it (the literal `Points` lists in
`p02_02_loop.py`, the per-corner dispatch in `p03_03_inner_corner_resolve.py`, the mechanical
Source/Target table in `p03_04_encl_miters.py`).

**New declaration, one level up:** a template becomes

```
{
  "id": "user_<uuid>", "name": "<Fred's name>",
  "primitives": [                         // the outer loop, in order, CW (matches every
    { "type": "line", "from": [x, y], "to": [x, y] },      // existing template's convention)
    { "type": "arc",  "from": [x, y], "to": [x, y], "bulge": f },
    ...
  ],
  "joints": ["miter", "smooth", ...]      // one per vertex, cyclic: joints[i] sits between
}                                          // primitives[i] and primitives[i+1 mod n]
```

- Every point is a **fraction of the board's own half-width/half-height** (`hw`/`hh`), the SAME
  basis every existing handle already declares (`"basis": "hw"` / `"h"`). This is what lets one
  drawn template scale to 6x9/7x9/9x12 without re-deriving anything — multiply by the actual
  board's `hw`/`hh` at build time, exactly like `topWidthFrac * hw` already works everywhere.
- `bulge` is the arc's sagitta as a fraction of its own chord half-length, signed by which side the
  material bulges to — the same signed-fraction convention `domeFullnessFrac`/`archRiseFrac`
  already use. This alone determines the arc's centre and radius in closed form (`sagitta_circle`,
  already shared code, `fb_engine/closed_form_arc.py`).
- `joints[i] = "miter"` means a bar boundary (a physical saw cut) at that vertex; `"smooth"` means
  the two neighbouring primitives are ONE continuous piece of wood there (no cut) — this directly
  maps to Fred's own UI language ("mark each joint as MITER or SMOOTH").

Because the shape is FIXED (never re-seeded by a drag), there is **no `FRAME_HANDLES`, no
`seedMap`, no named Fusion parameter chain** — a huge simplification versus every handle-driven
template. The points are baked literals (scaled by `hw`/`hh` inline in the generated
`BuildSequence`), not variables threaded through `SKETCH_2_PARAMETERS`.

Everything downstream — `outline`, `inner`, `miters`, `surround`, `bars` — is **derived** by the
generic builder from `primitives` + `joints`, never stored twice:
- **bars**: consecutive primitives are grouped into one bar until a `"miter"` joint splits them (a
  `"smooth"` joint merges neighbours into the same bar — T10's shoulder/waist/hip chain is the
  existing precedent for a multi-primitive bar).
- **corner-resolve type per miter joint**: derived from the two meeting primitives' own types —
  line+line, line+arc, or arc+arc (see §2).

## 2. The generic builder, mapped onto what T14-T17 already do

Walking T15's own 11-phase structure, phase by phase, against what becomes GENERATED vs stays
BOILERPLATE:

| Phase | Today (T15, hand-written) | Generic builder |
|---|---|---|
| `p01_01`/`p01_02` bounding box | Identical across every template already | **Boilerplate, unchanged** — one shared module |
| `p02_01` projections | Template-agnostic project step | **Boilerplate, unchanged** |
| `p02_02` loop | Literal `Line`/`Arc3Point` `BuildSequence`, one entry per primitive, points as named Fusion-expression strings | **Generated**: one entry per `primitives[i]`, points as literal `hw`/`hh`-scaled expressions (no named parameter chain needed — fixed shape) |
| `p02_03` welds | `Coincident` between every consecutive pair | **Generated**: mechanical, one `Coincident` per vertex |
| `p03_01`/`p03_02` enclosure proj + offset | Same `isTopologyMatched=False` offset boilerplate every template already uses | **Boilerplate** (confirm byte-for-byte reuse across T14-T17 during the build turn — not yet verified for these two files specifically, everything else below WAS read directly) |
| `p03_03` inner corner resolve | A hand-typed per-corner dict dispatching to `ResolveInnerCorners` / `ResolveLineCircleCorner` (confirmed in T15's own file) | **Generated**: for each `"miter"` joint, dispatch on the two meeting primitives' types — line+line → `ResolveInnerCorners` (Direction = the outward bisector of the two line directions); line+arc → `ResolveLineCircleCorner` (Concave from the arc's own bulge sign + which side is material); arc+arc → `ResolveCircleCircleCorner` (not exercised by T14-T17, needed for generality — T1's hourglass is the existing precedent for this corner type) |
| `p03_04` enclosure miters | A hand-typed Source/Target list, one row per corner (confirmed in T15's own file — literally just echoes p03_03's own id choices) | **Generated**: one `Miter` per `"miter"` joint, Source/Target read straight from the SAME per-corner table p03_03 just built — can never drift apart (today this is two separately hand-typed files kept in sync by hand; the generic builder makes them one source) |
| `p03_05` surround rect | **Confirmed byte-identical already** (read T13's own copy — literally the same code) | **Boilerplate, unchanged** |
| Extrusion | `declared_profiles.py` + `frame_definition.py`'s `frame_features()`, reading `FRAME_REGIONS`/`FRAME_BARS` | **Unchanged** — reads the SAME derived regions dict, doesn't care whether a human or the generic builder produced it |

**Smooth joints** (not exercised by T14-T17, needed for generality — e.g. a drawn curve made of two
tangent arc segments the user wants as one piece): no `Resolve*`/`Miter` step at that vertex;
instead the generic builder emits the SAME "exact seed + weld + `Tangent` lock" sequence T10's own
`p02_03_loop.py` already uses for its shoulder→waist→hip chain. Since the points are baked exactly
(traced from the user's own drawn geometry, not approximated), this is the fusion360-quirks skill's
own "exact seed" case — the one case that reliably works — not the "rough seed" case that needs a
temporary seed-radius dimension.

**Net result**: a brand-new fixed template needs **zero new Python files** — one JSON declaration,
read by one generic builder module (replacing ~9 of T15's 11 phase files; `p01_01/02` and `p03_05`
already ARE the shared boilerplate, so in a sense the generic builder already exists for those two).

## 3. Editor UX

New "New template" mode in the Frame tab, next to today's template picker.

```
┌─ Frame tab ──────────────────────────────────────┐
│  Template: [ T1 Classic Rect ▾ ]  [+ New Template]│
└────────────────────────────────────────────────────┘
          │ click
          ▼
┌─ Draw mode (existing SVG line/arc/kink tools) ────┐
│                                                      │
│        ╭───────╮                                    │
│       ╱         ╲         ← drawing the outer        │
│      │           │           outline only            │
│       ╲         ╱            (no inner profile —      │
│        ╰───┬───╯              frame_thickness is      │
│            │                  global, same as every    │
│   start ●──┘                  other template)           │
│                                                      │
│  [Line] [Arc] [Kink]                 [Close loop]   │
└────────────────────────────────────────────────────┘
          │ snap-to-start closes the loop
          ▼
┌─ Joint-tagging mode ───────────────────────────────┐
│   every vertex starts MITER (✂) by default —         │
│   tap a vertex to toggle:                            │
│                                                      │
│        ╭───○───╮      ○ = smooth (tap to flip)       │
│       ╱         ╲     ✂ = miter  (the safe default)  │
│      ✂           ✂                                   │
│       ╲         ╱                                    │
│        ╰───✂───╯                                     │
│                                                      │
│   live validity banner here if the current draft     │
│   breaks a guard (see §5) — same red-outline pattern  │
│   the drag-stop already uses elsewhere                │
│                                                      │
│                          [Back]      [Name & Save]   │
└────────────────────────────────────────────────────┘
          │
          ▼
┌─ Save ─────────────────────────────────────────────┐
│   Name: [___________________]                       │
│                                      [Cancel] [Save] │
└──────────────────────────────────────────────────────┘
          │
          ▼
   Template picker now lists it; selecting it builds
   through the SAME frame-defs path every built-in
   template already uses.
```

**Where saved** (the dispatch's own open question): a **per-user local file**, not the shipped
`frame-defs.js`/`.json` — those are deployed/shared assets, and a hand-drawn template is a
per-installation thing (no redeploy needed to use it, no leaking one user's shapes into another's
install). Proposed: one JSON file per user-drawn template, in a per-user data directory the add-in's
own Python process already has filesystem access to (parallel to how `gen_frame_defs` already
round-trips data between the Python side and `frame-defs.json`); the web app reads the same file(s)
through the EXISTING JS↔Python bridge the palette already uses, merging them into its in-memory
template list at load time, never baked into the shipped file. **This is a genuine design decision,
not yet confirmed with Fred/the advisor — flagging it, not asserting it.**

## 4. Proof plan: Flask as data

1. **Convert**: hand-transcribe T15's own existing closed-form output (`fb_engine/t15_flask_geometry.py`,
   at one reference board size, 7x9) into the new `primitives`/`joints` schema. This is a one-off,
   throwaway conversion script — below the abstraction floor, not a product feature, so it doesn't
   get the generic builder's own machinery; it exists once, to produce `flask_as_data.json`, and is
   discarded.
2. **Build A** (today): run T15's existing hand-written phases in a scratch Fusion document, 7x9 —
   exactly the synthetic-panel harness `item61_full_matrix_sweep.py` already uses.
3. **Build B** (generic): run the generic builder against `flask_as_data.json` in a second scratch
   document, same board size.
4. **Compare**: reuse `item61_full_matrix_sweep.py`'s own `bars_report()` verbatim against both
   documents — bar count, each bar's own name + volume (4-decimal precision, the sweep's own
   existing tolerance), 0 overlaps, healthy timeline, 0 NOT BUILT / MITER MISS / REFLEX ARC lines.
   **Acceptance bar: byte-identical bar volumes**, matching the project's own existing convention
   for every other flag-gated equivalence check (e.g. T82 item 6's "window off = byte-identical").
5. **Stretch, not required for this proof**: repeat at 6x9 and 9x12 to catch any `hw`/`hh`-scaling
   bug a single board size could hide. Flag as a fast follow-up, not a blocker.

## 5. Validity rules for a drawn outline

Reuse every existing guard — **no new guards invented**, since these are exactly the predicates
the drag-stop (`_frameRecordBreaksNoHookRule`) already enforces for every handle-driven template:

- **Closed loop**: last primitive's own endpoint coincides with the first primitive's own start
  (within the editor's existing snap tolerance).
- **No self-intersection**: `frameCutProfile(...).defects` — the same check every template's own
  drag-stop already runs.
- **No undercut**: `outlineHasUndercut` — the existing ≥180° arc-sweep guard.
- **Every piece ≥ frame_thickness**: the same `_primLength >= t` floor Generate's own validity gate
  already enforces.
- **No hooked tip**: the existing item-39 `MIN_MITER_MARGIN_T_FRAC` guard.
- **No colliding miters**: `mitersCollide` — the SAME guard this session's own T84 item 9 is
  re-measuring right now (its floor will already be corrected by the time this feature is built).

**One genuinely NEW rule**, not a reuse — flagged on its own: a `"smooth"` joint needs the two
meeting primitives to actually be tangent there (within some angular tolerance), or Fusion's own
`Tangent` constraint will silently lock onto whatever the user's imprecise hand-drawn kink happened
to be (fusion360-quirks: "Tangent locks the seed, it does not solve for the shape"). Two options,
to decide during the build turn, not here: (a) refuse "smooth" and show why, until the user's own
drawn kink is within tolerance, or (b) auto-snap the kink to the nearest exact-tangent configuration
when the user marks it smooth. Effort for this one piece is called out separately below since it's
the only truly new logic in the whole feature.

**Feedback to the user**: reuse the existing inline-banner / red-outline pattern (the same one the
drag-stop and T82 item 7's "ugly but not broken" degrade already use) — not a new UI affordance.

## 6. Retirement sweep: Template Maker + Frame Inspector

Both are self-contained "former-standalone add-ins" consolidated into the single
`bspline-frame-builder.py` entry point. **Ownership-vs-sharing check done up front, not deferred**:
`bspline-frame-builder.py`'s own comment confirms `expression_coords.py`/`entity_helpers.py` — the
only things either tool used to share — were ALREADY extracted into the canonical `fb_shared/`
package (C4/F8 S5). Neither tool's own remaining code is imported by anything else. **This is a
clean leaf deletion, no extraction step needed first.**

Concrete locations found (read directly, not guessed):
- **`bspline-frame-builder/bspline-frame-builder.py`**: the `_tm`/`_fi` module-load slots and their
  `_load_submodule(...)` calls (~L254-271), the `template-maker/core` entry in the
  `_shared_project_names` wipe-list (~L242), and two registration tuples —
  `('template-maker', _tm)` appears at L353 and L652 (confirm each one's own exact role — stop-loop
  vs run-loop — during the sweep, not assumed here); the matching `_fi`/frame-inspector entries
  alongside each.
- **`bspline-frame-builder/DEPLOY_bspline-frame-builder.py`**: `deploy_template_maker()` (~L141) and
  its frame-inspector equivalent (~L157), their own `verify_files` lists, a drift-check comment/list
  at ~L199-206 naming both files, the "legacy targets" CLI branch at ~L802-823 (a standalone-install
  warning path — decide whether that capability is retired too, or kept as an escape hatch; flag for
  the advisor, don't assume).
- **`bspline-frame-builder/template-maker/`** and **`bspline-frame-builder/frame-inspector/`**: the
  entire directories — own manifests, own palette HTML, own `core/` modules, own `tests/`, own
  `docs/` (template-maker alone carries 4 doc files under `template-maker/docs/`).
- **`skills/frame-inspector/SKILL.md`**: confirmed exists, retires with the tool.
  **`skills/frame-builder/SKILL.md`**: no dedicated `skills/template-maker/` directory was found —
  check whether template-maker's own usage notes live inside this file instead before assuming
  there's nothing to touch there.
- **Docs**: `ARCHITECTURE.md` (drop the live-tool claim — a stale architecture map is worse than
  none), `ROADMAP.md`, `BUGS_OPEN.md`, `FIX-BACKLOG.md` if either tool is named as a live concern
  anywhere in them. Historical docs (`WORK-LOG*.md`, `AUDIT-2026-09.md`) are **left alone** — they're
  a record of what happened, not a live claim.
- **Final check**: grep the repo for `template-maker`, `template_maker`, `TemplateMaker`,
  `frame-inspector`, `fusion-inspector`, `FrameInspector` — zero hits outside WORK-LOG/history and
  this plan document itself.

## Effort per step

| Step | Size | Why |
|---|---|---|
| Data format (schema + one derivation pass: primitives+joints → regions) | S | Shape is already proven by every existing `FRAME_REGIONS`; only the *production* of it is new |
| Generic Fusion-side builder | M–L | The one genuinely new module; must correctly dispatch all 3 corner-resolve types + smooth-joint tangent chains + bar-grouping — the biggest single piece of real work |
| Editor UX (draw + tag joints + save) | M | Reuses existing line/arc/kink draw tools and the existing banner pattern; the new work is the joint-tagging mode and the save/registration wiring |
| Live proof (Flask as data) | S | Reuses `item61_full_matrix_sweep.py`'s own `bars_report()` unchanged; one throwaway conversion script |
| Validity rules | S (+ one M item) | Near-total reuse of existing guards; the smooth-joint tangent-tolerance rule is the one new piece, sized on its own |
| Retirement sweep | S–M | Mechanical, and every location is already found above — the only open question is the "legacy targets" CLI branch's own fate |

No code was written to produce this plan.
