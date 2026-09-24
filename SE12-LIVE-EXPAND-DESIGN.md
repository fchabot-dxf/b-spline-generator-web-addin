# SE12 — Live Expand design (T33, plan only — no code touched this turn)

The idea (Fred, approved: "that's the ideal solution"): lines and lattice pieces stay real
`<line>`/`<path>` elements — nodes stay draggable, length/stroke-width/Regenerate-all keep working — while
a per-layer "outline" setting derives the stroke-offset outline on the fly for display, carve, and Fusion
export. The document stores only the lines (single store, SE4 lesson). The existing destructive Expand
button is untouched and stays for freezing a shape by hand.

## The finding that reshapes item 1: Fred's arcs-stay-arcs hard requirement

While drafting this, `ROADMAP.md` picked up a same-day entry (`9f3c670`, Fred, 2026-09-24), and a mid-turn
`handoff.py` amendment restated and sharpened it further. Both fold into this design and change the shape
of the answer below:

> straight lines stay straight lines, arcs stay TRUE arcs (export + live expand) ... **Live expand must be
> ANALYTIC (line → 2 lines + 2 arcs), not the raster-trace Expand.**

> [Amendment] The design must produce EXACT geometry, never traced/polygonized: a line's outline = 2
> straight segments + 2 true semicircle arcs (round caps; square/butt caps = 4 lines); an arc's outline =
> 2 concentric arcs + caps; a circle node = a circle. ... how lattice crossings join (union of capsules or
> kept separate) ... SE8a converts every `A` arc and every circle to cubic Béziers before the bake
> (`editor/path-layout.js` `arcToCubics`/`normalizeForBake`) ... the carve matrix is a SIMILARITY (uniform
> scale + translate), under which arcs stay arcs — the bake should keep `A` commands ... falling back to
> cubics only for non-uniform/skew. Include that as its own slice, first, with a test.

That rules out literally reusing `editor-expand-shape.js`'s `expandGeometric` as the live-expand engine —
that function is exactly the "raster-trace" approach Fred is now excluding: it samples the path at 0.02"
steps via `getPointAtLength()`, builds a point-cloud polygon, and hands it to `editor-expand-union.js`'s
`unionSelfIntersecting` (a polygon-clipping library, CDN-loaded from `esm.sh`). That's an *approximation*
of a stroke's true offset shape, with error bounded by the sample step. The dispatch (item 1) asked to
"reuse the existing Expand pipeline as a pure function" — this design deliberately does **not**, and says
so here rather than silently following the newer instruction without flagging the divergence.

It also surfaces a **second, pre-existing** conflict with the same principle, unrelated to live-expand
itself: today's *static* bake pipeline (used by every carve and every Fusion export, live-expand or not)
already throws away arc/circle exactness unconditionally — covered as its own first slice below.

The good news on the live-expand side: a straight line's true offset outline has a closed form, so going
analytic isn't extra work — it's *less* work than what the sampling pipeline does today.

## 1. Where the outline comes from

**A new, small, pure function per primitive kind** — not a reuse of `expandGeometric`. The amendment asks
this to cover more than lattice lines alone, so the full coverage the offsetter needs is:

- **Line**, round cap (confirmed: every lattice rail/tie is drawn with `linecap: 'round'` —
  `editor-lattice.js:167`) → 2 straight banks + 2 semicircular arc caps (below).
- **Line**, square or butt cap (not used by the lattice today, but a `<line>`/open `<path>` elsewhere in
  the document could carry either) → 4 straight segments, no arcs at all: butt caps stop the banks exactly
  at the endpoints; square caps extend each bank by `sw/2` past the endpoint along the line's own
  direction before closing the corner. Read the element's own `stroke-linecap` (attribute or inherited
  CSS) to pick the branch — a lookup, not a sample.
- **Arc segment** (an `A` command inside an open path) → 2 concentric arcs (radius `r ± sw/2`, same center,
  same angular span) + the same cap logic as a line at each open end (round/square/butt, by the path's own
  `stroke-linecap`).
- **Circle node** → today's lattice nodes are *filled*, not stroked (confirmed this session: 12/12 nodes in
  a test pattern are fill-only) — a fill already *is* its own solid representation, so there is nothing to
  offset and the toggle is simply not-applicable to them (see STOP conditions). If a stroked circle ever
  needs one anyway, its offset is the trivial closed form "a circle" the amendment names: two concentric
  circles at `r ± sw/2`, same center — no caps, no direction to reason about.

For a line with round caps — the lattice's own case, and the one with real bench numbers below — the exact
offset outline is:

```
        arc (r=sw/2)
       .-------.
      /         \
(x1,y1)----------(x2,y2)     <- the two straight "banks", offset ± sw/2 along the normal
      \         /
       '-------'
        arc (r=sw/2)
```

expressed directly as an SVG path: `M` to one bank-start point, `L` the far end, `A sw/2 sw/2 0 1 1 ...`
for one end cap (a true semicircle, sweep computed from the line's own angle), `L` back along the other
bank, `A ... ` for the other cap, `Z`. Two `L` + two `A`, zero sampling, zero polygon-clipping, zero
network dependency. No union step is needed for a single non-self-crossing line — union only becomes a
question at all once two elements' outlines might overlap (see the crossing-rails STOP condition below).

**Cost.** This is closed-form trig — sub-microsecond per element, no async anything. To put a number on
what the *old* sampling+union approach would have cost (useful as a conservative upper bound, since the
analytic design skips this machinery entirely): I fed the real, unmodified `unionSelfIntersecting()` a
22-point polygon shaped to match `expandGeometric`'s own cap-sampling density (`Math.PI/8` step), for
each of a freshly-generated Lattice pattern's real elements (17 rails + 5 ties). Measured in headless
Chrome via CDP:

| step | cost |
|---|---|
| polygon-clipping module load, cold (first ever call, includes the `esm.sh` fetch) | 7ms (one run saw 273ms — CDN-latency-dependent) |
| polygon-clipping module load, warm (cached) | ~0ms |
| `unionSelfIntersecting()` per element, warm | 0.1–1.1ms |
| 22 elements, warm, total | ≈3ms |

Even this pessimistic (union-based, never-actually-needed-for-v1) number is comfortably inside a
per-commit budget. The analytic engine needs none of it — no cold-load spike, no CDN dependency, no
`unionSelfIntersecting` call at all for the common case.

**Disclosure — what I could not get a live number for.** `expandGeometric`'s own sampling loop calls
`SVGGeometryElement.getTotalLength()`/`getPointAtLength()`. In this headless-Chrome environment, those
throw `"This element is non-rendered element."` for every one of these real, DOM-attached, visually-
present lattice lines — a genuine headless-only limitation (`Page.bringToFront` before navigation and a
double-`requestAnimationFrame` wait before sampling both failed to clear it). That blocked getting a real
timing number for the sampling approach specifically. It's moot for the design that follows (analytic
needs neither API for a straight line), but is why the table above uses a synthesized-but-real polygon
fed straight into the union step rather than a full end-to-end `performExpand()` timing.

`textGlyphPathD` (`editor-expand-text.js`) is the one existing precedent for "pure function, element →
outline `d`, reused by a second consumer" (already reused by `editor-io.js`'s carve-bake path) — same
shape this design's new function should follow, just for lines instead of glyphs. Text itself stays out
of live-expand's scope (see STOP conditions).

## 2. Caching + invalidation

Given the analytic cost above (sub-microsecond, synchronous, no I/O), **v1 needs no cache** — recomputing
on every commit costs less than hashing a cache key would. Building invalidation machinery for a
not-yet-measured-as-necessary case would be exactly the kind of speculative engine to avoid.

What *is* worth declaring now, cheaply, since it costs nothing to write down: the natural cache key, if
profiling on a much larger document ever shows a need — `elementId + x1 + y1 + x2 + y2 + strokeWidth`
(a plain tuple/string, not stored on the SVG element itself, matching item 2's own framing). That's a
one-line addition to drop in later; no registry or invalidation logic to build today.

**Recompute timing** mirrors `refreshDrape`'s existing commit-only pattern (`app-init.js`) — `'live'` (the
rAF-throttled per-drag-frame step in `CHANGE_PIPELINE`) never touches outlines; `'commit'` recomputes them,
same as drape. A dragged node shows its raw line moving in real time; the faint outline preview and any
carve/export-relevant state settle once, on commit, not on every intermediate frame.

## 3. The toggle

New layer field, following the exact existing pattern for `carve`/`showColor` (`editor/layers.js`):

- `TOOLING_DEFAULTS.outline = false` (default off — nothing changes for existing documents until a user
  opts in).
- A new compound gate alongside `isCarved`/`isExported`/`showsColor`:
  ```js
  export function showsOutline(l) {
    return !!l && l.visible !== false && l.outline !== false;
  }
  ```
  (master-`visible`-gated, same as the other three — a hidden layer never shows/carves/exports an outline
  regardless of the stored flag, and turning `visible` back on restores exactly what was there.)
- Row placement: `layers.js`'s row-assembly currently does
  `row.appendChild(vis); row.appendChild(carveBtn); row.appendChild(colorBtn); row.appendChild(name);`
  (confirmed at `layers.js:653-657`) — the new outline button inserts between `colorBtn` and `name`, built
  via the same `_makeToggleButton` factory `carveBtn` already uses (glyph-button, `.active` +
  `aria-pressed`). Exact glyph is a cosmetic detail for whoever implements Slice 2, not load-bearing here.

**No migration entry needed** — unlike `carve` (which needed `layer-carve-flag` because a flat `true`
default would have *changed* old documents' behavior: pre-SE10, `visible:false` alone meant "don't carve",
so the migration had to backfill the correct historical value before `applyToolingDefaults`'s flat default
could apply). `outline` has no such prior semantic to preserve — every existing document was built before
live-expand existed, so "not outlined" (the flat `false` default) is simply correct for all of them.
`applyToolingDefaults` alone (already called on every layer-creation and restore path) is sufficient.

**Open question for Fred — outline/centerline/both, as a data choice.** When a layer's outline is on,
what should Fusion export receive: the outline only (for pocket/cut passes), the centerline only (for
V-bit engraving, today's behavior), or both? Proposed as one more per-layer field —
`fusionGeometry: 'outline' | 'centerline' | 'both'` (default `'centerline'`, meaningless while
`outline:false`) — read once at export time inside the swap point in item 6. This keeps it a data value,
not a second code path: `getLayerSvg` branches on the field's value, it never forks into
outline-vs-centerline *logic* duplicated at each call site.

**Second open question for Fred, already flagged in `ROADMAP.md`'s same entry and folded in here**: does
Fusion's SVG import actually keep an `A` (arc) command as a true arc in the resulting sketch, or does it
convert/approximate it on import? This is a Fusion-side fact this design can't establish from the browser
— worth Fred confirming directly (import a small hand-written SVG with one `A` command, check the
resulting sketch curve's type) before the export side of Slice 4 is built, since it decides whether
"outline" export is genuinely precise or still needs a cubic-bezier fallback on the Fusion side.

## 4. Carve — does the raster carve change at all?

**Theoretical answer: no, or if anything it gets *more* accurate, and here's why rather than an assertion.**
`stamp-mask-manager.js` rasterizes via `rasterizeSvg` → `renderSvgNative` — real native browser SVG
rendering (canvg only as a fallback). A round-capped stroke of width `sw` and a filled path that is
*exactly* that stroke's offset-by-`sw/2` outline are, by definition, the same set of covered pixels — a
round-cap stroke's rendering rule *is* the Minkowski sum this design's analytic function computes directly.
Today's raster carve already rasterizes the stroke; swapping in the exact analytic outline for the same
element should be pixel-identical (modulo the same anti-aliasing any raster op has). No new machinery is
needed in `stamp-mask-manager.js` at all — it stays exactly what it is today, a consumer of
`getLayerSvg`'s output.

**Empirical attempt — disclosed as inconclusive, not proven.** I tried to confirm this by rasterizing a
real rail's stroke vs. its expand-derived outline (via the actual `performExpand()`, since the analytic
function doesn't exist yet to test against) and diffing opaque-pixel counts. One run succeeded and showed
a 65% mismatch (1184 vs. 407 opaque pixels) — surprising enough that it needs to be stated plainly rather
than buried. A second, confirming run was blocked by CDP/Chrome environment flakiness in this session (a
backlog of 12 orphaned `chrome.exe` processes from failed launches piled up and starved the debug port;
cleared via `taskkill`, but re-runs after that still failed to open a CDP connection before this turn's
time budget ran out). My leading hypothesis, **not verified**: the quick bench harness built its own
manual `viewBox` straight from the line's raw `x1/y1/x2/y2` attributes, but `commitExpandedPath`
(confirmed this session to compose transforms when it commits an expanded path) may place the outline's
`d` coordinates in a different space than those raw attributes — which would make a hand-rolled bench
viewBox clip or mis-locate the outline while leaving the stroke correctly placed, exactly the kind of
harness bug that produces a "smaller, not just shifted" opaque-pixel count like the one observed. This is
a theory, not a finding — I'm disclosing it as attempted-but-inconclusive rather than asserting equivalence
as proven.

**Consequence for the plan**: Slice 1 (below) must include a real empirical carve-equivalence check —
rasterize a line's stroke and its new analytic-function outline through the actual `rasterizeSvg` path (not
a hand-built viewBox) and diff them — as part of landing the analytic function, before anything downstream
(carve, export) is wired to consume it.

## 5. Display

A new non-interactive layer in the editor SVG DOM — e.g. `<g id="outlinePreview">`, inserted once
(not per-element) and repopulated on every `'commit'` pipeline run, same timing as item 2. Properties:

- `pointer-events: none` — never intercepts drag/click; the real `<line>`/`<path>` stays what the user
  actually grabs.
- Drawn faintly (low-opacity fill or a thin preview stroke — exact visual treatment is a Slice 3
  implementation detail).
- **Never serialized or persisted** — regenerated from the live document on each commit, same as the
  cache-key discussion in item 2. It carries no independent state.
- **Interaction with `showColor`**: the preview for an element mirrors that element's *own layer's*
  `showsColor(layer)` state — the same CSS-class override mechanism the sketch layer already uses for its
  neutral-color display mode, applied to the preview element too. An outline preview never shows a color
  its source layer itself wouldn't show.
- **Visibility**: gated by `showsOutline(layer)` (item 3) — off entirely unless the owning layer's toggle
  (and its master `visible`) are both on.

## 6. Export — exact swap point

`editor-io.js`'s `getLayerSvg()` (`editor-io.js:151`) — confirmed this session, by grep, to be the single
common ancestor of both consumers: `stamp-mask-manager.js:57` (carve) and `export-flow.js:83` (Fusion
export), exactly 2 call sites in the whole codebase. Outline-awareness belongs inside `getLayerSvg` itself,
not duplicated into either consumer:

- For each element belonging to a layer where `showsOutline(layer)` is true, `getLayerSvg` serializes the
  analytic outline `<path>` in place of the raw `<line>`/`<path>`, per the `fusionGeometry` data choice
  from item 3 (`'centerline'` → unchanged, emit the line as today; `'outline'` → emit only the derived
  path; `'both'` → emit both elements).
- Because both carve and export already flow through this one function, item 4's carve path and any
  Fusion-bound `bakeSvgForCarving`/export-flow step downstream of it inherit the swap automatically — no
  separate edit needed in either consumer file.

## 7. Slices

**Slice 0 comes first and is not really about live-expand at all** — it's a pre-existing correctness gap
the amendment surfaced: the *static* bake pipeline (used by every carve and every Fusion export today,
whether or not live-expand ever ships) unconditionally throws away arc/circle exactness, which is the same
principle live-expand is being held to. Fixing it first means Slices 1-4 build on a bake path that's
already honest about arcs, instead of layering a new analytic feature on top of a lossy one.

**Slice 0 mechanics.** Traced the exact two spots this session (`editor-transform-handles.js`):
- `_bakeMatrixIntoPath` (line 667) unconditionally calls `normalizeForBake`, which unconditionally runs
  every `A` through `arcToCubics` — *regardless* of what the bake matrix `m` actually is.
- `bakeMatrixIntoElement`'s `circle`/`ellipse` branch (line 614) unconditionally promotes to a path via
  `_primitiveToPathData` before baking — same unconditional cubic-ization, one step earlier.
- The carve matrix itself (`carveMatrix`, `editor-coords.js:64`) is `{a:dpi, b:0, c:0, d:dpi, e:…, f:…}` —
  pure uniform scale + translate, confirmed this session, always a similarity on its own. But
  `bakeSvgForCarving`'s actual per-element matrix is `carve.multiply(ch.matrix())`
  (`editor-io.js`/`_carveChildren`) — the element's *own* transform is folded in, and that transform is
  **not always uniform**: `editor-transform-handles.js`'s own comments confirm a *side* handle drag scales
  one axis only by default (*shift* is what locks it to uniform, corner handles are uniform without
  shift) — non-uniform scale is a default, easily-reached user action, not a rare edge case. So the
  similarity check has to run on the **combined** per-element matrix at bake time, not be assumed globally.

**The fix**: before calling `normalizeForBake`/promoting to cubics, test whether the combined matrix `m`
is a similarity — columns `(a,b)` and `(c,d)` perpendicular (`a·c + b·d ≈ 0`) and equal length
(`a²+b² ≈ c²+d²`). If it passes, keep the segment analytic: transform the arc's endpoints through `m`
directly (same `transformPoint` already used for every other point-bearing command), scale `rx`/`ry` by
the uniform factor `√(a²+b²)`, add the matrix's own rotation angle to `xRotDeg`, and flip the `sweep` flag
if `det(m) = ad-bc < 0` (a reflection reverses angular direction; `largeArc` is unaffected since it's about
arc span, not direction). Circles/ellipses bake the same way: transform the center, scale `rx`/`ry`, stay a
native `<circle>`/`<ellipse>` instead of promoting to a path. Only fall back to today's behavior
(cubics / path-promotion) when the similarity test fails — i.e., exactly the non-uniform/skew case the
amendment names.

| # | Slice | Files | Verify |
|---|---|---|---|
| 0 | Bake pipeline: keep `A`/circle exact under a similarity matrix, cubics only as a non-similarity fallback | `editor/editor-transform-handles.js` (`_bakeMatrixIntoPath`, `bakeMatrixIntoElement`'s circle/ellipse branch) | new test: a path with one `A` baked through a pure-scale (dpi) matrix comes back with an `A` command, `rx`/`ry` scaled by `dpi`, endpoints matching `transformPoint`; the SAME path baked through a known non-uniform matrix still comes back as cubics (today's behavior, unchanged) — proves the branch, not just the happy path |
| 1 | Live-expand analytic engine — pure function `line → outline d`, round-cap only (the lattice's actual case) | new `editor/editor-expand-analytic.js` | CDP smoke: rasterize a real rail's stroke vs. the function's output through the real `rasterizeSvg` path; opaque-pixel diff must be near-zero (resolves item 4's open empirical question before anything depends on it) |
| 2 | Layer field + gate + row toggle | `editor/layers.js` | new layer defaults to `outline:false`; toggle flips `showsOutline()`; no migration needed (reasoned in item 3) |
| 3 | Display preview layer, commit-only | `editor/editor.js` or `main/app-init.js` (wherever `refreshDrape`'s commit step is wired) | drag a node live → preview does not move mid-drag; release → preview appears/updates once; toggle off → preview `<g>` empties |
| 4 | Export swap + `fusionGeometry` data field | `editor/editor-io.js` (`getLayerSvg`) | with outline on + `fusionGeometry:'outline'`, `getLayerSvg`'s returned SVG contains the derived `<path>`, not the original `<line>`; with it off, output is byte-identical to today |

Line/arc/circle offsetter coverage beyond the lattice's round-cap-line case (square/butt caps, arc
segments, stroked circles) is deliberately **not** its own slice above — nothing in the current document
exercises those paths yet (lattice lines are round-cap only; no stroked circles exist). Recorded as the
"general offsetter" shape in item 1 so the function is designed to extend cleanly, without building the
extra branches before anything calls them.

## STOP conditions (scope boundaries for this design, not promises of a later slice)

- **Text**: out of scope. Text's "live editability" story (editing content, font, glyph layout) is
  fundamentally different from dragging a line's endpoints — it stays on the existing destructive
  Expand→unexpand flow.
- **Circles-as-lattice-nodes**: confirmed this session — nodes are drawn *filled*, not stroked (12 nodes
  in a test pattern, all fill-only). A fill already *is* its own solid representation; there's nothing to
  offset. The outline toggle is simply not applicable to nodes — they're untouched either way. (If nodes
  ever became stroked-only circles, the analytic case is trivial to add later: an annulus of two concentric
  circles, still closed-form, no union needed — but that's speculative and not needed now.)
- **Open vs. closed paths**: v1 covers open strokes only (plain `<line>` rails/ties), matching Fred's own
  "line → 2 lines + 2 arcs" formula exactly. Closed shapes (`editor-expand-shape.js`'s `CLOSED_SHAPES`
  list) need inner+outer ring math, not just the line formula, and stay on the destructive Expand flow
  until a later slice explicitly extends this design to them.
- **Crossing rails/ties — union of capsules, or kept separate?** (the amendment's own framing — each
  line's offset outline is a "capsule": 2 banks + 2 round caps). Split, because carve and export have
  different needs:
  - **Raster carve needs no union.** Rasterization is a coverage operation — two overlapping filled
    capsules rasterize identically whether or not they were polygon-unioned first. Stays per-element,
    separate, for v1.
  - **Fusion export (pocket/cut path specifically) may want a per-layer union** of the capsules for clean
    CAM toolpaths — proposed as an explicit *later* slice, not required to ship v1, and relevant only to
    the `'outline'`/`'both'` `fusionGeometry` choice (never `'centerline'`, which was never unioned before
    this design either). Note this reintroduces the same polygon-clipping library live-expand's core
    engine otherwise avoids entirely — scoped to export-time only, not the display/carve path, if it's
    ever built.

## Open questions for Fred (collected)

1. Fusion geometry choice — outline / centerline / both, as the per-layer `fusionGeometry` field proposed
   in item 3. Confirm the three-way split (and the `'centerline'` default) makes sense.
2. Does Fusion's SVG import preserve `A` (arc) commands as true arcs, or convert/approximate them? Already
   flagged in `ROADMAP.md` (2026-09-24) and repeated in the amendment — blocks knowing whether
   `'outline'`/`'both'` export (and Slice 0's own bake fix) is worth Fusion actually seeing as arcs, or
   whether it gets flattened back to a spline on import regardless. This is a Fusion-side fact this design
   can't establish from the browser (no Fusion, per the hard rule). **Proposed 1-minute check for Fred**:
   save a tiny test file —
   `<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 A 10 10 0 0 1 20 0" stroke="black" fill="none"/></svg>`
   — import it the same way the add-in's own SVG import path does, select the resulting sketch curve, and
   check its reported type (Fusion distinguishes an Arc/Circle sketch curve from a Spline/Fitted-spline in
   its selection info and right-click Properties). "Arc" or "Circle" → the importer preserves it, Slice 0
   is worth shipping as designed. "Spline"/"Fitted spline" → it's flattened on import regardless, and
   Slice 0's value shifts from "Fusion sees true arcs" to "the bake stays numerically exact until the
   moment Fusion's own importer approximates it" — still worth having, but the export-side motivation
   changes.

## Process note

Live checks this turn used headless Chrome via CDP, browser-only, per Fred's no-Fusion hard rule — no
`fusion_execute`/`fusion_screenshot`/`release.py --local`/add-in stop-run calls were made. All `chrome.exe`
processes from this turn's bench runs are confirmed stopped (`tasklist` clean after a `taskkill` cleared a
backlog of 12 orphaned processes from failed CDP launches mid-session). The repo-root `python -m http.server
8771` used for live verification is stopped as of this turn's close.
