# WORK-LOG — reg-addin (Asus) — worker, APPEND ONLY

## 2026-09-26 — turn 3 — R2: lockfile + FORMULA-FIELDS stage 2 (range + non-lattice fields)

**Lockfile sha (item 0, landed FIRST as the amend asked): `809f870`** — `package-lock.json` only, regenerated with
`npm install` (adds `@emnapi/core` + `@emnapi/runtime` 1.11.3). `npm ci` now exits 0 (verified before commit).
Pushed on its own ahead of items 1-3, per the advisor's amend; I'd already pushed it before the amend landed and
told the advisor the sha directly (SendMessage) since it crossed with my own R1 pass-back.

**Landed (items 1-3), on top of R1:**
- `html/core/formula-field.js` (item 1 — RANGE): a committed formula result is **clamped**, not rejected, to the
  field's declared `min`/`max` attributes (`declaredRange`/`clampToField`, new exports). Clamp was chosen over
  reject because it's what the field already does for a plain typed out-of-range number in two other paths —
  `applyParam`'s stock-dimension clamp and the ± steppers (both read the same `min`/`max` attributes) — so one
  rule now covers every way of putting a value in the field. While typing, the preview shows the clamp inline
  (`= 270 → 170 (max)`); after commit a short note appears then fades (`270 clamped to 170 (max)`), matching how
  the bad-formula note behaves. Plain typed numbers are untouched (unclamped) here, same as before R2 — that
  existing clamp lives in `applyParam` for the stock fields and doesn't exist for others, unchanged.
- `html/main/formula-fields.js` (item 2), REWRITTEN as `FORMULA_SECTIONS`: one entry per sidebar section
  (`{section, ids, names}`), each auto-extended with `STOCK_SCOPE` (width/height/depth — useful everywhere) plus
  its own declared names. `FORMULA_FIELDS` (field id -> scope) is now *derived* from the sections (`flatMap`), so
  there's still one place to add a field: a name in a section's `names` list. `STOCK_SCOPE` / `attachFormulaFields`
  keep their R1 shape (no seat-C breakage expected, but nobody else imports this file yet).
  **Added, by section:** STOCK DIMENSIONS (width, height, + `carveZ`/depth, no longer wired separately),
  SEED (region/offsetx/offsety/rotation — macroScale, seedOffsetX/Y, seedRotation), SKELETON (peak, density,
  clustering, symx, symy, border, smoothing, smoothradius), FILTER (finescale, coverage, detail), VECTOR STAMPING
  (plunge, angle, blur, smoothing, suppression, fillet, sharpness), SCULPT TOP (brush, noise), THICKEN (thickness),
  SCULPT BOTTOM (brush, noise).
  **Deliberately NOT declared** (named + why, as asked):
  - `seed` (SEED panel's Seed field) — it's an integer ID users pick, not a quantity anyone would formula against;
    also its own `seedType` select changes meaning per algorithm.
  - `frameBottomZ` (FRAME section) — seat C's file territory (fb-app), out of bounds this turn.
  - Stamp layer transform `stampTx/Ty/Rotation/Scale` — these are NOT in `P`; they're written straight to the
    active layer object by `bindLayerOnlyNumber` (main/stamp/_dom-binders.js), a separate binder from
    `bind()`/`applyParam`. Wiring them needs their own scope-per-layer plumbing; flagged for R3, not built here to
    avoid guessing at a second binder's contract under this turn's scope.
  - `sculptTopHardness` / `sculptBotHardness` — not in `P` either (I couldn't find their write path in the time
    box; flagged rather than guessed).
  - Everything under lattice/shape-lattice/editor/skeleton-editor panels (`lattice*`, `shapeLattice*`, `skel*`,
    `editor*` ids) — R3, after the home advisor confirms UI5 merged (frozen this turn per the dispatch).
  - `undo-limit`, `thickenYellowOffset`, `editorStrokeWidth/FontSize/ExpandDetail` — app/editor settings, not
    per-layer creative quantities; no clear "formula against what" use case, left alone.
- `tools/repro/formula_field_shots.mjs` (item 3, extended): now also drives **Vector Stamping > V-Bit Angle**
  (`#stampVBitAngle`, declared range [10,170]) after the Stock Width checks — expands the collapsed Vector
  Stamping panel, types `angle*3` (angle=90 -> 270), and checks the REAL committed value clamps to 170. This is
  the same real-gesture proof pattern as R1's Width/Height, now covering a second, non-stock section AND the R2
  range clamp end-to-end (not just the preview text).
- `tests/formula.test.js` extended:
  - `describe('range: ...')` — declaredRange/clampToField unit behaviour + the binder's live preview and commit
    clamp (above max, below min, negative-range fields, in-range unchanged, unbounded unchanged, and confirming
    PLAIN typed numbers are NOT clamped by the binder).
  - `describe('declared formula fields (R1 item 5 + R2 item 2)')` — parses the real `bspline_gen_palette.html`
    (stripping `<link>`/`<script>` so happy-dom doesn't try to fetch the stylesheets) and asserts, for every
    declared field: it exists, is `type="number"`, resolves to a `P` key, and sits under the panel whose header
    text contains its declared section name (catches a copy-paste into the wrong section). A second test asserts
    the excluded ids are never declared and there are no duplicate ids. A third checks every section's scope has
    unique names and every name's `get()` returns a finite number against the app's real defaults (`P`). 46/46
    total (was 36 after R1).
  - Fixed 2 stray U+0008 BACKSPACE bytes that landed in the new regex literals via a Python heredoc edit
    (`\b` word-boundary got interpreted before the file was written) — vitest ran fine either way since the regex
    still matched, but `grep`/diffs would have shown mojibake; caught it before commit, not left for the advisor.

**Mutation-checked:** removing the `> max` clamp branch in `clampToField` fails exactly 1 range test (and no
others) — confirms the range tests bite. (R1's own hold-back mutation check from last turn still applies.)

**Verified (real surface):** `node tools/repro/formula_field_shots.mjs <prefix> <url> desktop|mobile` — `ok:true`
on BOTH modes, including the new `angleClamped` check (P.stampVBitAngle === 170 after committing `angle*3`), zero
console exceptions. Screenshots: `C:\Users\danse\.bspline-status\shots\reg-addin\r2_{desktop,mobile}_{dropdown,
committed,angle}.png` (r2_check_* is a throwaway extra run, same content as r2_desktop_*).

**Gate:** `npx vitest run tests/formula.test.js` 46/46. Full smoke `npx vitest run`: **79 files / 1504 passed**
(was 77/1471 before this turn — the 2 new files are this turn's other-machine merges, all green). No Fusion.

**Hands off, respected:** no edits to `editor-lattice-pattern.js`, `editor-ui.js`, `editor.js`,
`editor-piece-override.js`, `tools/repro/select_drag_shape.mjs`, `properties-lattice.js`,
`properties-shape-lattice.js`, `core/frame-record.js`, `editor/editor-frame-profile.js`,
`core/preview/frame-mesh.js`, `editor-shape-lattice-generator.js`, `frame-builder/`, `FB-APP-DESIGN.md`, or the
FRAME sidebar section / editor tabs. `bspline_gen_palette.html` was NOT edited (the new fields reuse existing
inputs already in the markup — nothing added or moved there).

## 2026-09-26 — turn 5 — R3: STALE-PARAMS design (design only, no product code)

**Landed:** `STALE-PARAMS-DESIGN.md` (repo root) + one new ROADMAP.md queue entry pointing at it (inserted
before the SE16 entry, no existing entries rewritten).

**Survey (item 1), the headline finding:** three independent writers create user parameters today, and only
ONE of them stamps ownership. Board params (`b-spline-gen.py:602-676`, `widthIn`/`heightIn`) already carry
`Bspline.owner=1`, written on every create AND update. The other two are unstamped: (b) the constrained-sketch
/ Shape Lattice family (`sketch_manifest_builder.py:704-752` — `stroke_width`, `rail_width`, `tie_width`,
`node_diameter`, `half_width`, `contour_width`, `contour_height`, an OPEN-ENDED list since names come from the
JS side, not a fixed map), and (c) the frame family (`parametric_engine.py:257-315` for the declared
per-template params + `solid_coordinator.py:72-99` for the ad-hoc `frame_height_offset`, confirmed still
undeclared in `template_data.py`/`frame-defs.json` by dumping the generated JSON this turn). This asymmetry —
one stamped family, two unstamped — is the actual gap R4 has to close; without it, "created by us" can only be
guessed by name, which the checklist explicitly ruled out for good reason (name collisions with Fred's own
parameters, e.g. `boundingboxoffset`'s documented two-declaration history in `FB-APP-DESIGN.md` §1.2).

**Cross-check against FB-APP-DESIGN.md (read via `git show origin/fb-app:FB-APP-DESIGN.md`, never checked
out):** its §4 already sketches almost exactly this design — a `PARAM_OWNERS` registry, `Bspline.owner=1`
(exists) for board, `FrameBuilder.owner=1` (new) for frame, and the one-line cleanup rule "a future stale-param
cleanup may delete only params carrying its own owner tag that nothing references." I adopted its tag names
rather than inventing new ones. **One gap flagged for the home advisor** (§2a of the design doc): that registry
has NO entry for the lattice family (b) at all — I proposed it share the board's `Bspline.owner=1` tag (same
Send surface, one Send = one tag), but this needs fb-app/Fred sign-off since it extends a plan-of-record
document I can't edit from here.

**Design decisions (2b-2d), the WHY:**
- **Stamp, not name, decides ownership** — the only rule survivable against the lattice family's open-ended
  names, and the only one that's collision-safe against Fred's own parameters. "Matches a known name but has
  no stamp" = explicitly kept, explicitly logged (`kept_unstamped` in the proposed `last_send.json` section),
  never silently deleted OR silently treated as ours.
- **Delete AFTER the new geometry/params exist, not before** — so the reference guard sees the new payload's
  params already in place (a rename mid-flight doesn't false-positive "nothing references the old name").
- **Reference guard has two layers:** a Python text-scan of every OTHER user parameter's `.expression` for a
  whole-word name match (Fusion doesn't offer a parameter-to-parameter dependency query), PLUS Fusion's own
  `Parameter.dependentParameters` for feature/sketch dimensions — flagged explicitly as "verify live in R4",
  since this design turn has no Fusion access (NO FUSION is the standing rule) and I won't claim I tested an
  API surface I only read about.
- **No new undo machinery.** Every existing destructive call (`occ.deleteMe()` etc.) already runs inside the
  one Fusion command-execute a Send already is; `param.deleteMe()` slotting into the same execute keeps "one
  Send = one undo step" for free. Flagged so R4 doesn't build a redundant transaction wrapper.
- **`last_send.json` gets a `stale_params` key**, always present (empty when nothing's stale), four buckets:
  `deleted` / `kept_referenced` (with the reason) / `kept_unstamped` / `failed`.

**Open questions logged for Fred (§2f of the design doc), each with a recommended default:** (1) ship a
dry-run/log-only period before the real `deleteMe()` calls are live — recommended YES, since this is
irreversible on his real designs and reg-addin has no live-Fusion loop; (2) touch-stamp vs. create-only-stamp
for the two NEW groups — recommended: match the existing board precedent (stamp on every touch); (3) does the
lattice family share the board tag — recommended default yes, flagged to the advisor above; (4) cross-Send
scope (does a frame cleanup ever touch board-tagged params or vice versa) — recommended NO, per
FB-APP-DESIGN's own line.

**Not built this turn (by design):** no `ParamOwnership` module, no stamping code, no delete pass, no tests.
R4 (whichever seat/turn gets the green light) implements exactly what's blessed here.

**Gate:** docs only — `git diff --stat` shows `ROADMAP.md` (11 lines added) + the new `.md` file. No test run,
no Fusion, per the dispatch.

**Hands off, respected:** read-only into `frame-builder/`, `fb_engine/*.py`, `template_data.py` (both
templates), `frame-defs.json` (via `python -c` dump, no write), and `FB-APP-DESIGN.md` on `origin/fb-app` (read
via `git show`, never checked out, never edited). No product code touched anywhere in the repo this turn.

## 2026-09-26 — turn 7 — R4: STALE-PARAMS implementation (Bspline group, board + lattice)

**Landed, item by item (each committed + pushed separately per the dispatch):**
- **item 1** (`90deee2` -> rebased to `be1f25b`): `ParameterSchema.LATTICE_OWNED_PARAMS` (the 7 names) +
  `is_lattice_owned()` beside `BOARD_OWNED_PARAMS`/`is_board_owned()` in
  `frame-builder/fb_engine/parameter_schema.py` — the ONLY change in `frame-builder/` this turn, per ruling 2.
  6 new tests (`fb_engine/test_lattice_owned_params.py`), no adsk stub needed (pure Python).
- **item 2** (`1d74777`, then revised in `9c5fbe4` after AMEND 2 — see below): `_stamp_bspline_owner(ctx, param,
  name)` in `sketch_manifest_builder.py`, called from BOTH the create and update branches of
  `_sync_manifest_parameters` — idempotent (checks the tag before adding, exactly like the board's own
  `_ensure_bspline_param_tag`). 3 tests added to `test_sketch_manifest_builder.py`.
- **item 3** (`57cd575`): new `b-spline-gen/param_ownership.py`, `compute_stale_params(user_params,
  payload_names, logger=None)` — pure, no `adsk` import, takes a plain iterable (`for p in
  design.userParameters`, the pattern already used in `CAM-builder/cam_engine/mm_builder.py:284` and
  `fusion-exporter/exporter.py:226-228`). Returns `{deleted, kept_referenced, adopted, failed}`, every key
  always present. 13 tests (`test_param_ownership.py`), all four buckets plus the mixed-batch/crosstalk case.
- **item 4** (this commit): one call in `b-spline-gen.py`'s `_handle_generate`, in the Finalise block
  (non-preview path, right after `_import_all_svg_layers` returns — so `des.userParameters` reflects THIS
  Send's own just-synced params, per ruling 7/2d's ordering). `payload_names` = `set(params.keys())` (covers
  whichever board names this Send's payload actually carried) unioned with every
  `manifest['parameters'][*].name` read straight out of `stamp_data['layers']` — the exact same source
  `_import_all_svg_layers` already reads, so no new plumbing/return-value threading was needed to collect the
  lattice names this Send touched. New `_merge_last_send_key(key, value)` helper (next to `_dump_last_send`)
  merges `stale_params` into the ALREADY-written `last_send.json` (that file is written early, right after the
  param sync, before geometry — item 4's call happens much later, so it can only ever ADD a key, never
  overwrite the payload snapshot). The whole block is one guarded try/except that only logs on failure —
  Send itself is never at risk.

**Two mid-flight amendments from Fred, both incorporated before their affected item was committed:**
1. **"Just apply it" — delete ON, not log-only** (landed while item 1 was in flight; item 1 was unaffected by
   it, so it committed as originally written; NEXT-SESSION-reg-addin.md rule 1 + item 3's wording were updated
   by the advisor to match).
2. **"Take over existing params"** (landed after item 2's first commit `1d74777`): reverses the original
   create-only stamping rule. I revised item 2 in a SECOND commit (`9c5fbe4`) rather than silently folding the
   change into a rewritten item 1 commit, so the git history shows the actual amendment as it happened —
   `_stamp_bspline_owner_on_create` (create-only) became `_stamp_bspline_owner` (every touch, idempotent), and
   the two tests asserting create-only behaviour were rewritten to assert the opposite (adoption on update).
   `param_ownership.py` (item 3, written after this amendment) was designed against the FINAL rule from the
   start — registry membership by name is the whole ownership test; the stamp is written for the audit trail
   (`adopted` in the output) but never gates the delete decision. **Process note:** I hadn't polled amendments
   before item 1's own commit (a miss against the "poll before commit" rule) — it happened to not matter since
   item 1 was untouched by the amendment, but I'm naming it rather than letting it pass quietly.

**Real consequence I found and fixed, not asked for in the checklist:** adding `LATTICE_OWNED_PARAMS` to
`parameter_schema.py` changed that file's hash, which `tools/gen_frame_defs.py` hashes as one of
`frame-defs.json`'s own source files — this immediately made the checked-in `frame-defs.json`/`.js` STALE
(`test_frame_defs.py::test_checked_in_file_is_fresh` failed in the full suite run). Regenerated both
(`python tools/gen_frame_defs.py`) — the diff is exactly one line, `sourceHash`, nothing else. Ran the FULL
vitest suite afterward (not just the fast tier) specifically because a generated file both sides read
changed, not because a rule required it: 80 files / 1515 passed.

**Mutation-checked:** item 2's stamp-write line (both new tests catch its removal); item 3's three gates
(registered-name check, payload-membership check, dependents>0 check) each fail a distinct, correct subset of
tests when removed — logged live in the transcript, not re-summarized here since nothing needed fixing.

**Not built this turn (deliberately, per the rulings):** no `fb_engine/param_ownership.py` (ruling 2: logic
lives in `b-spline-gen/` only); no touch to `parametric_engine.py`/`solid_coordinator.py` (ruling 6, seat C's
territory); no hand-rolled expression-text reference scan (ruling 4 dropped it in favour of
`dependentParameters` alone — genuinely unverified against live Fusion, flagged again below); no dedicated
pytest for the `_handle_generate` wiring itself (that method has no existing test file at all — it's
Fusion-integration-shaped, not unit-tested anywhere today — adding one felt like scope creep against "keep it
that small," ruling 7; flagging this choice rather than silently making it).

**STALE-PARAMS-DESIGN.md updated** with a new "R4 rulings" section at the top (the living, current version)
and short supersession notes on 2a-2d pointing at exactly which ruling overrides which paragraph — the
original survey/design text was left AS WRITTEN (not rewritten in place) so the R3-to-R4 amendment history
stays legible to whoever reads it later. `ROADMAP.md`'s STALE-PARAMS entry updated from "Queued" to "Shipped"
with the amended rule summarized.

### Live-check recipe for Fred (NO FUSION this loop — this needs a real Fusion session)

1. Open a document with an existing Shape Lattice (or build one). Send B-spline once, normally.
2. Look at `~/.bspline-frame-builder/last_send.json` — it now has a `stale_params` key, e.g.
   `{"deleted": [], "kept_referenced": [], "adopted": [], "failed": []}` on a totally ordinary Send (nothing
   stale the first time).
3. **Prove a real deletion:** in the Fusion Parameters table, arrange for one lattice piece's parameter (e.g.
   `rail_width`) to no longer be part of this Send's manifest (simplest: hide/delete that rail's layer content
   so the manifest no longer emits `rail_width`, then Send). Expect: `rail_width` disappears from the
   Parameters table, and `last_send.json`'s `stale_params.deleted` lists it.
4. **Prove "take over existing":** by hand, in the Parameters table, create a parameter literally named
   `half_width` (a registered lattice name) with any value, unreferenced by anything, and not part of this
   Send's current lattice. Send. Expect: it gets DELETED, and `stale_params.adopted` names it (it had no
   `Bspline` stamp before this Send touched it).
5. **Prove the reference guard:** create a parameter with a registered name that's currently unused by this
   Send, and have another parameter's expression (or a sketch dimension) reference it by name. Send. Expect:
   it survives, and `stale_params.kept_referenced` names it with a reason mentioning `dependentParameters`.
6. Report back whether `Parameter.dependentParameters` behaved as expected in steps 4-5 — this is the one API
   surface the whole feature leans on that nobody has run against live Fusion yet. Anything surprising goes to
   BUGS_OPEN.md or straight to the advisor.

**Gate:** `python -m pytest -q` in `bspline-frame-builder/`: **284/284 passed** (was 282, plus the 2 now-fixed
freshness failures). Full `npx vitest run`: **80 files / 1515 passed**. No Fusion.

**Hands off, respected:** `fb-app`, `editor-shape-lattice-generator.js`, `core/frame-record.js`,
`editor-frame-profile.js`, `frame-mesh.js`, `main/frame-panel.js`, `parametric_engine.py`,
`solid_coordinator.py`, and every seat-A file, were not touched.

## 2026-09-26 — turn 10 — R5: FORMULA-FIELDS stage 3 (Lattice + Shape Lattice panels)

**Cross-session note first:** mid-turn, another session (b1) also started as "worker" against this SAME main
checkout (Fred started it, apparently meaning it for a different lane). It found my uncommitted R5 files,
correctly held off touching them, and messaged me. Confirmed ownership, it stood down and moved to its own
worktree (`b-spline-generator-web-addin-lane2`) with its own HANDOFF.md. Its `wait` had consumed turn 10 (the
correction-only re-pass, harmless) and re-registered `.proc/worker.pid` to its own PID — reclaimed with
`proc_health.py register --role worker` afterward. Nothing of mine was lost (nothing had been committed yet).

### item 1 — SURVEY (facts, file:line)

Both panels share ONE structure (properties-lattice.js for the box Lattice tool, properties-shape-lattice.js
for the Shape Lattice tool — near-identical field sets, Shape Lattice adds Boundary/Contour):
- **Immediate-effect fields** have their OWN `on(el, 'change', …)` listener that re-projects right away:
  Size Width/Height (`sizeWidthEl`/`sizeHeightEl` -> `updateSize` -> `readFieldsIntoPattern()` ->
  `generatePattern` -> ONE `pushState`, properties-lattice.js:496-516), the width steppers
  (`wireWidthStepper`/`wireLinkedWidthStepper`, :428-445), and (Shape Lattice only) Contour Width
  (`contourWidthEl`, properties-shape-lattice.js:1122-1130).
- **Deferred fields** (rails count/every/offset, ties count/density/span/anchor/rail-snap/one-ended/min-
  spacing) have NO individual listener at all — they're read ONLY inside `readFieldsIntoPattern()`
  (properties-lattice.js:267-395), itself called from three places: Orientation flip, Size change, and the
  Generate button click (:547-558). A formula typed into one of these and left uncommitted is exactly as
  invisible to the pattern as a plain typed number is today — nothing reads `.value` until one of those three
  triggers fires. **Verified this is safe, not a gap:** the browser commits a formula on BLUR (native
  `change`), and blur already fires before a button's own `click` handler runs (standard DOM focus-change
  order) — so clicking Generate right after typing a formula, with no explicit Enter, still commits first.
  Covered by a dedicated test (`lattice-formula-fields.test.js`, "a formula in a DEFERRED field... commits...
  but waits for Generate, same as typing").
- **Per-layer, not global:** every field reads/writes the ACTIVE layer's own `.pattern`
  (properties-lattice.js's private `_currentPattern`, exported as `currentPatternLattice`; properties-shape-
  lattice.js's own exported `currentPattern`) — `attachFormula`'s scope-as-thunk contract (already in
  core/formula-field.js since R1) is exactly what this needs: no new live-sync plumbing, the thunk just calls
  the panel's own accessor at evaluation time, so switching the active layer or Regenerating is picked up for
  free.
- **The per-piece override width field** (UI5, now merged) lives in `lattice-piece-panel.js`, built via
  runtime DOM creation (`mountSelectedPiecePanel`, shared by both panels — ONE `<input class="lattice-piece-
  width">` per host panel, reused across different selected pieces via `refresh()`, never recreated) — a
  natural single attach point.
- **A real gotcha found and avoided:** `latticeTiesDensity`/`shapeLatticeTiesDensity` is `type="range"` (a
  slider), not a number field — attaching a formula binder there would have been meaningless (a slider can't
  display arbitrary typed text). Excluded, named explicitly in both panels' own comments, not silently skipped.

### item 2 — DECLARED scope (`editor/lattice-formula-fields.js`, new)

One shared scope function `latticeScope(editor, currentPattern, extra=[])`, called by BOTH panels with their
own live accessor — one module, not two forked copies (same "shared, not forked" shape `lattice-piece-panel.js`
already established for UI5). Names, ALL reading live off the pattern (never a snapshot):
`width`/`height` (the REAL resolved boundary size — `sizedBoardRegion(boardRegion(editor), pattern.size)`,
the SAME pure resolver the engine and the Shape Lattice panel already use, so it's never null even when the
Size fields are unset/auto), `stroke`/`railwidth`/`tiewidth`/`nodewidth`, `spacing`/`minspacing`,
`railcountmin`/`railcountmax`/`tiecountmin`/`tiecountmax`, `tiedensity`, `railevery`/`railoffset`.
**Board vs. lattice names are unambiguous by construction:** this scope has NO `boardw`/`boardh` at all — the
STOCK panel's own `main/formula-fields.js` scope (R1/R2) is a completely separate declaration on a completely
separate binder call; a lattice field's formula can only ever see the lattice names above, never `width`/
`height` in R1/R2's stock sense, and vice versa (confirmed by `tests/formula.test.js` continuing to pass
unchanged).
**Excluded, with the reason** (same discipline as R2's stock scope):
- Seed (`latticeSeed`/`shapeLatticeSeed`) — an integer id the user rerolls, not a quantity, same reasoning as
  R2's excluded SEED-panel Seed.
- Node ends/crossings/rail-ends, all mode/anchor/end-rule controls — checkboxes/selects, not number inputs.
- Ties Density (both panels) — a `type="range"` slider, see item 1's gotcha above.
- Contour Width's own CURRENT value has no name (e.g. no `contourstroke`) — its declared default is `null`
  ("auto"), and there's no single obvious fallback number to expose as a name without inventing a resolution
  rule I couldn't verify; the field itself is still formula-capable over the base scope, just doesn't
  contribute its OWN name back into it. Flagged rather than guessed.

### item 3 — Fred's case: "a rail exactly on the boundary"

**No field today expresses this, and a formula doesn't change that** — traced the actual math, not just the
field's own units:
- Rails have exactly two placement modes: `every`/`offset` (grid-ROW indices — `_isRailRow`/`_railRows`,
  editor-lattice-pattern.js:635-648, `(row - offset) % every === 0`) or `count` (a seeded pick within a
  [min,max] range, auto-distributed). Neither takes an absolute inch position for a single rail.
- `_resolveExtent` (editor-lattice-pattern.js:1848-1872) computes `jMin`/`jMax` for the 'board' mode as
  `toLattice(region.{y, y+h}, spacing)` — i.e. grid indices derived from the RESOLVED region (which depends on
  the raw board size `editor._mW`/`_mH`, NOT exposed as a formula name) divided by `spacing`. So even knowing
  `height` (the resolved boundary height, which IS exposed), computing the exact `offset` that lands a rail on
  `jMax` requires the RAW board size too, plus reproducing `_resolveExtent`'s own floor/ceil rounding — not
  something "I just math it out" can reasonably mean.
- Conclusion, stated rather than built (per the dispatch's own permission): this is genuinely
  RAIL-SPACING's job (ROADMAP.md "Queued — RAIL-SPACING... Rails: Anchor [Top|Center|Bottom] + Spacing...
  laid out from the boundary") — the fact that Rails has no Anchor control at all today (unlike Ties, which
  already has one) is itself evidence nobody built absolute-position placement for Rails yet. Formula support
  makes every OTHER field in this panel more expressive; it doesn't retroactively give Rails a placement mode
  that doesn't exist.

### item 4 — Tests + real-browser proof

- `tests/lattice-formula-fields.test.js` (new, 14 tests): `latticeScope`'s own live-read behaviour (including
  the never-null width/height resolution and the `extra` list); the box Lattice panel (immediate field = one
  pushState + existing handler runs; a deferred field commits to a plain number but waits for Generate; range
  clamp holds on a lattice field; a bad formula keeps the old value; the SAME scope thunk re-reads FRESH values
  after the pattern changes underneath it — no stale snapshot; still works after switching the active layer,
  SE7i); the Shape Lattice panel (Size Width over the same scope shape; Contour Width formula-capable); the
  per-piece override width field (formula-capable when a scope is supplied; mounting with no scope, the old
  call shape, never crashes and leaves it a plain number field — backward compatible).
- `tools/repro/formula_field_shots.mjs` extended with a THIRD section: opens the SVG editor
  (`#btnStampEdit`), switches to the Lattice tool, types `width*2` into Size Width, screenshots the live
  preview (`= 16`), commits, and reads the value back from `window.svgEditor`'s own active-layer
  `pattern.size.width` — `ok:true` on BOTH desktop and mobile, zero console errors.
- `node tools/repro/select_drag_shape.mjs` rerun against the LOCAL build (not the deployed URL, so it actually
  exercises this turn's edits) — **ALL CHECKS PASSED**, both lattice types: snap-to-spacing, ties-follow-rail,
  end-stretch, the T73 contour clamp, and item 5's contour-anchored tie-end/node coincidence. Confirms
  switching `type="number"` -> `type="text"` on the sidebar fields never touched canvas drag behaviour (the
  two are unrelated code paths; verified rather than assumed — grepped for `.valueAsNumber`, which would have
  broken on a text input, zero uses in this codebase).

**Gate:** `npx vitest run`: **81 files / 1529 passed** (was 80/1515 before this turn). No Fusion.

**Hands off, respected:** no edits to `editor-shape-lattice-interaction.js` (imported `boardRegion` from it,
read-only) or `frame-builder/`; `properties-shape-lattice.js`'s own edit is exactly two additive blocks (an
import line + the attach call at the end of `initShapeLatticeProperties`), no restructuring, matching the
dispatch's "keep it small" instruction for that file.
