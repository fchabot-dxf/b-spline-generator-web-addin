# Inset Window — design note (T82 item 2)

STEP 1 of T82 item 2 (Fred, from his painting "Entry": "a second small frame set into the piece";
"always open"). No code in this commit — this note is for advisor/Fred review before anything is built.
Spec assembled from the dispatch + three amendments (no clamping; the subframe hides behind the panel;
the subframe's inner contour is the one declared trim profile; same `panel_lip` offset as the outer frame).

## 1. What it is

A second, small, RECTANGULAR mitred frame (4 bars, bar width = `frame_thickness`, the SAME value the main
frame uses) sitting inside the main frame's own opening. It cuts a literal hole through the carved panel —
not a stamp, not a recess: the panel stops at the window's own outer edge and there is nothing there. The
subframe itself is never seen from the front: it sits BEHIND the panel (mounted from the back, like a shadow
box backing), and the panel's own material overlaps its inner edge by `panel_lip` — the exact relationship
the panel already has with the MAIN frame, just facing the opposite way (inward instead of outward). From the
front you see a clean rectangular hole with no visible frame member.

It is a per-record, per-template-agnostic FRAME-LEVEL option (declared once, every template gets it for free),
the same architectural slot `appearance` / `frameBottomZ` / `panelLip` already occupy
(`frame_definition.py:76-95`, `EXTRUSION_SETTINGS`) — not a new per-template feature, and not template-specific
code anywhere.

## 2. Data shape

One new field on the frame record, `b-spline-gen/html/core/frame-record.js`:

```js
record.insetWindow = {
  enabled: false,                 // the sidebar toggle; OFF by default
  x1: 2.0, y1: 2.0,               // outer rectangle, board-local inches, origin top-left, y down
  x2: 5.0, y2: 4.5,               // (the SAME coordinate convention frameCutProfile's own board already uses)
};
```

Two opposite corners, not centre+size: a corner-drag moves exactly one point, a body-drag shifts all four
numbers by the same delta, and nothing else needs renormalizing on every edit. `normalizeFrameRecord()`
sorts them (`x1<x2`, `y1<y2`) on read/write so a drag that crosses the opposite edge never produces an
inverted rectangle — that is bookkeeping, not a size/position LIMIT (see §3).

Derived, never stored (so there is exactly one place each is computed, matching how `frameCutProfile` already
derives `region` from `boundingboxoffset` rather than storing it twice):
- **Outer rectangle**: `(x1,y1)-(x2,y2)` directly — this is what the panel/terrain stop at, and what Fusion's
  bars are built from.
- **Inner rectangle** (the subframe's own inner edge, the mitred opening): the outer rectangle offset inward
  by `frame_thickness` on all four sides — same "inward offset by the frame's own thickness" relationship
  `frameInnerProfile` already uses for the main frame (`outline-offset.js`'s own `offsetOutlineInward`,
  reused verbatim, not reimplemented, since a plain rectangle is a degenerate case of the same general
  outline-offset code every template's own inner edge already runs through).
- **Hole/trim profile** (what actually gets cut through the board): the inner rectangle offset inward ONE
  MORE TIME, by `panel_lip` (the ONE existing `panelLip` record field — no second lip setting). This is the
  profile every consumer below reads. Deliberately the SAME two-step relationship
  (`outer -> thickness -> lip`) the main frame already has, just both offsets pointed inward instead of one
  in and one out, because the window is a hole (material recedes toward its own centre) where the main frame
  is a perimeter (material recedes toward the board's own edge).

`framePayload()` (`frame-record.js:99-106`) carries `insetWindow` to Fusion exactly like every other record
field already does — no new transport mechanism.

## 3. Deliberately NOT validated (Fred: "then it's my responsibility to not let it intersect")

No clamping against the frame's own opening, the board edge, or anything else — Fred places it, the app does
not stop him overlapping the main frame or running it off the board. The ONLY two guards, both pure geometry
validity (not placement policy), mirroring the main frame's own `frameFit()` rule
(`editor-frame-profile.js:58-62`, `2*frame_thickness < min(W,H) - 2*bbo`) at the window's own smaller scale:

- **Window bars > 0**: `(x2-x1) > 2*frame_thickness` AND `(y2-y1) > 2*frame_thickness` (each bar needs a
  positive-length run along its own side).
- **Opening > 0**: the inner rectangle (outer minus thickness) has positive width and height — implied by the
  bars check above, stated separately because it is the one Fred named explicitly.

Below that floor: no window feature is built (Fusion) and no hole is cut/drawn (app) — the toggle stays on in
the record, but produces nothing, the same "declared but inert below its own floor" behaviour
`shoulderLedgeWidth`'s own range floor already established for Template 7 this session. Nothing is clamped
INTO validity; it simply does not render until the numbers are valid, and the UI should say so (a short
inline warning in the Frame panel, not a blocked drag).

## 4. Every consumer

| Consumer | Today | With `insetWindow.enabled` |
|---|---|---|
| Terrain carving (`core/engine.js`/`core/terrain.js`) | builds the full rectangular grid; doesn't know about the frame at all (confirmed: no "frame"/"trim"/"clip" hit in either file) | unchanged at build time — still builds the full grid |
| 3D preview clip (`core/preview/frame-mesh.js`) | `clipPanelToOutline()` (268-328) keeps triangles INSIDE the frame's own panel/lip loop | a SECOND pass, same function, REMOVES triangles inside the hole/trim profile (§2) — same primitive (triangle-vs-closed-polygon), called twice, not a new clip algorithm |
| Stamps (`main/stamp-mask-manager.js`) | not frame-aware at all today | the rasterized mask is zeroed inside the hole/trim profile before being applied — a stamp cannot carve material that is not there |
| Shape Lattice / pattern (`editor/contour-from-frame.js`) | opt-in per pattern (`pattern.contour.fromFrame`); `frameContourSilhouette()` returns ONE offset silhouette | when the owning pattern already reads `fromFrame`, the window's own hole/trim profile is carried alongside as a second, EXCLUDED region — a pattern generator that already walks "inside this silhouette" treats the hole as an island to skip, the same way an inner (reflex) boundary would be skipped; patterns that don't opt into `fromFrame` are unaffected, same as today |
| 3D preview bars | `applyFrameToPanel()` builds a bar ring from the main frame's own inner profile (`ringArrays()`, line 519) | the window's own bars are NEVER added to the 3D scene — only the hole (an absence of panel mesh, from the clip pass above) is visible. Per Fred's own "hide the subframe": nothing new to draw, only something new to NOT draw |
| Editor 2D (Frame tab) | draws the frame's own band/miters, clips the grid/snapping to the outline | draws the window's own outer+inner rectangle (same band-drawing primitive the main frame's own `_drawFrameProfile` already uses, rectangular case), with its own drag handles (§6) |
| Fusion sketch/solid build | 4 (or N) bar bodies + 1 trim cut, see `extrusion_engine.py`/`panel_lip.py` | 4 MORE bar bodies (new component) + 1 MORE cut feature (the hole) — both via the SAME declared-profile machinery, see §5 |
| CAM (`mm_builder.py`) | classifies `frame*`-named bodies into the 'frame' manufacturing model, lays out `frame_*` bodies in a row | the window's own 4 bars are named to match the SAME convention (§5) — picked up automatically, zero CAM code changes |

## 5. Fusion build steps

All four pieces below reuse EXISTING, already-proven machinery (`extrusion_engine.py`, `declared_profiles.py`,
`panel_lip.py`'s own offset-and-append pattern) — nothing here is a new kind of Fusion operation, only a new
INPUT to each one.

1. **Sketch geometry**: a new sketch (or a new region in the existing frame-enclosure sketch — implementation
   detail to settle against the real sketch-phase structure, not this note) draws the window's own outer
   rectangle, inner rectangle (thickness offset), and hole/trim rectangle (lip offset) — three nested
   rectangles, all AXIS-ALIGNED (no arcs, no corner-radius concept at all: a rectangle's own 4 corners are
   always 90 deg miters, bisected 45/45, the SAME generic miter rule every other corner in this engine already
   uses — no special case).
2. **Miters**: 4, one per corner of the OUTER-to-inner pair (outer vertex -> inner vertex, same
   `ResolveInnerCorners`/miter-line mechanism `ResolveInnerCorners`+`p03_04`-style phases already use for
   every template) — direction `(±1,±1)` per corner, the plain axis-aligned case, no T7-style derivation
   needed.
3. **Bars**: 4 new bodies via `ExtrusionEngine._extrude_one_profile()` (`extrusion_engine.py:137-198`), one
   per side of the outer/inner rectangle pair, `NewBodyFeatureOperation` (never merges with the panel or the
   main frame's own bars). Named `frame_window_top` / `frame_window_bottom` / `frame_window_left` /
   `frame_window_right` — starting with `frame` (so `_classify_occurrence()`, `mm_builder.py:1058-1059`,
   still classifies them into the 'frame' manufacturing model) but NOT matching the 4 classic names, so
   `_populate_frame_geometry()` (`mm_builder.py:693-931`) automatically routes them into the EXISTING generic
   N-bar layout path (`_populate_n_bar_frame_geometry`) alongside the main frame's own bars — no CAM code
   change, a naming choice only.
   **Z placement** (Fred: "the way the frame sits relative to the panel lip," behind/under the panel): SAME
   start/extent rule the main frame's own bars already use — start `toFace: core.underside` (the panel's own
   underside, wherever the carve put it, `send_frame.py`'s own `underside_face()`), extent driven by the SAME
   `frame_height_offset` parameter the main frame already reads (`_sync_offset_param`,
   `extrusion_engine.py:169-177`) — no new Z parameter. Because the bars start AT the underside (not at the
   sketch/top plane the main frame's own bars start at), they are physically behind the panel by
   construction, never visible from the front — this is the one geometric difference between a main-frame bar
   and a window bar, and it is entirely in WHICH face `start` is computed from, not a new mechanism.
4. **The hole cut**: one new feature, modeled on the `"trim"` entry in `COMMON_FRAME_FEATURES`
   (`frame_definition.py:106-107`) but inverted — a POCKET through the panel/core body instead of a trim
   around the stock's own edge:
   `{"id": "window_cut", "op": "cut", "region": "<the hole/trim rectangle, §2>", "start": "<the frame sketch
   plane, same as the main TRIM_CUT>", "extent": "throughAll", "participants": "<panel/core body only>"}`.
   Same `CutFeatureOperation` / `ThroughAllExtentDefinition` the main TRIM_CUT already uses
   (`extrusion_engine.py:157-185`); the only real difference is the REGION (a fixed small rectangle instead
   of "surround minus outline") and that it must NOT also cut the window's own 4 new bars (set participants
   explicitly, the same way the main TRIM_CUT's own `isParticipantsAutomated` already has to reason about
   which bodies are "the stock" vs "the frame").
5. **`declared_profiles.classify()`** (`declared_profiles.py:78-108`) needs one more case: a sketch region
   bounded by the window's own curve IDs maps to the `window_cut` feature above, the same way it already maps
   the panel-lip ring and the frame's own opening to their own (or no) feature — no new MECHANISM, one more
   declared mapping.

## 6. Editor interaction (Frame tab)

A new drag mode, sibling to the existing frame-handle drag (`main/frame-panel.js`'s own handle-drag path) and
the rectangle body/corner drag already used elsewhere in the editor for boundary/extent editing — reuse
whichever of those the implementer finds closest at build time; this note fixes the BEHAVIOUR, not the exact
file to copy from:
- **Body drag** (inside the window, not on a corner): translates `(x1,y1,x2,y2)` by the same delta — moves the
  window without resizing it.
- **Corner drag**: moves exactly the dragged corner's own `(xi,yi)` pair — resizes, and can flip which corner
  is logically "x1" vs "x2" (handled by the normalize-on-write step in §2, not by the drag code itself).
- Toggle: a single checkbox/switch in the FRAME sidebar panel, OFF by default, labeled "Inset window" per the
  dispatch's own wording.
- No board-based initial default beyond "roughly centred, roughly a third of the opening" — exact seed values
  are an implementation choice, not a design constraint.

## 7. What stays byte-identical when off

`insetWindow.enabled: false` is the default, and every consumer in §4 is additive and gated on it, mirroring
the established precedent in this codebase (`panelLip: 0` already makes `panelTrimPrimitives()` return `null`
with zero effect, `topDipDepth: 0` already makes T5's own dip a no-op, `hipFlare: 0` already makes T7's own
flare a no-op today) — same shape, new field:
- App: terrain build, stamp rasterization, lattice generation, the 3D preview clip, and the 2D Frame-tab
  drawing all take an early, no-op path when `!record.insetWindow?.enabled` — IDENTICAL output to today,
  not just "visually similar."
- Fusion: no new sketch region, no new bar bodies, no new cut feature, no new `declared_profiles.classify()`
  branch fires.
- CAM: sees no `frame_window_*` bodies, behaves exactly as today.
- The A/B byte-identical scripts (`tools/repro/ab/`) gain `insetWindow` left absent/false in every existing
  case they already run — if any of those hashes change once this is built, that is a real regression, not
  an accepted diff (same discipline the T7 `shoulderLedgeWidth`/`hipFlare` keys were held to this session).

## 8. Test plan (once built — this note is design only, nothing to run yet)

- **A/B**: every existing `tools/repro/ab/` script, `insetWindow` absent — byte-identical to pre-feature HEAD,
  for every template.
- **Geometry, enabled, valid placement**: the app's own clipped mesh has a real hole (triangles missing in the
  expected region, sampled the same way the T7 board-bounds regression sampled `prof.polygon`); a stamp drawn
  straddling the window shows zero depth inside it; a `fromFrame` lattice pattern has no rails/ties inside it;
  Fusion build produces exactly 4 new `frame_window_*` bodies + 1 new cut feature; CAM lists those 4 bodies
  alongside the main frame's own.
- **Hole size**: MEASURED, not assumed — the actual cut boundary equals the inner rectangle offset inward by
  `panelLip` exactly (a direct coordinate check, the same style used to confirm T7's hip-flare cap numerically
  rather than by eye).
- **Z placement**: the window's own bars' top face coincides with the panel's own underside at that location
  (not the sketch plane), confirmed in Fusion, not assumed from the parameter wiring alone.
- **Below the validity floor** (window bars/opening <= 0): no crash, no feature built, UI shows the inline
  warning from §3 — mutation-test this guard the same way every other floor in this codebase gets mutation
  tested (temporarily remove the guard, confirm the degenerate case now DOES build/crash, restore).
- **Drag gestures**: body drag translates all four coordinates by an equal delta and leaves the window's own
  size unchanged; corner drag changes exactly one corner and leaves the opposite one fixed; both normalize
  correctly if dragged past the opposite edge. Mirrors the existing handle-drag test pattern in
  `tests/frame-template-*.test.js`.
- **Overlap with the main frame** (Fred: not validated, not prevented): one explicit test that an overlapping
  window still builds SOMETHING well-defined (even if visually poor) rather than throwing — "ugly but not
  broken" is the bar, matching §3's own ruling.
