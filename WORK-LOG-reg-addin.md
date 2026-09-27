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

## 2026-09-26 — turn 12 — R6: RAIL-SPACING engine (data + generator only; panel UI is R7)

**Two confirming amendments from Fred landed mid-turn, both incorporated before their affected code was
committed** (all three below are folded into the ONE commit, since nothing had been committed yet when they
arrived):
1. Off-grid confirmed with NO rounding (I never built a rounding option, so this was a no-op for the code —
   just dropped it from my own doc-comment's "considered" list); but ties MUST land EXACTLY on the off-grid
   rail coordinate. I already had this half-built (see item 2 below); added the explicit sweep test the
   amendment asked for by name (anchors × sizes × orientations × board/rect + boundary).
2. Center anchor + an EVEN `spacingCount`: rails straddle the centre symmetrically, NO rail on the centre line
   (odd keeps one on it). New-pattern defaults: `anchor:'center'`, `spacing:1in`. Both required a real code
   change (not just tests) — see item 2 below.

### item 1 — SURVEY (facts, file:line)

- **Rail placement today, three call sites, one shared engine.** `computePattern` (editor-lattice-pattern.js
  :1343+) resolves `railRows` from `rails.mode`: `'every'` → `_railRows`/`_isRailRow` (:635-648, `(j-offset) %
  every === 0`, grid-ROW modulo); `'count'` (current real default) → `_railRowsByCount` (:713-737, a seeded pick
  within `[min,max]`, evenly spread, rounded to INTEGER rows). Both are grid-index-based by construction. ONE
  shared function serves BOTH the box Lattice tool (board/rect extent) and the Shape Lattice tool (boundary
  extent, `_resolveExtent`'s 'boundary' branch, bbox of the silhouette) — confirmed by reading `_resolveExtent`
  (:1848-1872 after this turn's insert) itself: it returns `{iMin,jMin,iMax,jMax}` for EITHER mode, and
  everything downstream (rail emission, `_occupiedHas`, ties, nodes) is extent-shape-agnostic. **This means the
  new engine, declared once, reaches both panels for free** — no separate Shape Lattice code path exists to
  duplicate it into.
- **How ties find rails today — the actual survey ruling 6 asked for.** TWO structurally different
  consumers, and only ONE of them was already coordinate-system-agnostic:
  - `_tieSlotsByCount`'s `span.mode:'rails'` branch (T67 AMEND #4's default, `ties.mode:'count'`,
    PATTERN_DEFAULTS.ties: `span:{mode:'rails',rails:1}` — **the actual default tie behavior since T67**) is
    ALREADY pure ARRAY-INDEX arithmetic (`numGaps = railRows.length-1`, `railRows[startIdx]`/`railRows[s+g]` —
    never a coordinate subtraction). **This path needed NO fix at all** — it was accidentally already correct
    for off-grid rails, for an unrelated reason (T67's "bridge exactly ONE pair of ADJACENT rails" is naturally
    an index concept, not a distance one).
  - `_tieSpanForColumn`'s `anchor==='rails'` branch (:916-930 pre-fix; only reached via the OLDER
    `ties.mode:'density'`, not the current default) measured the gap as `railRows[k] - jStart` — a raw
    COORDINATE difference — compared against `spanMin`/`spanMax`, small declared INTEGERS meaning "how many
    grid cells." **This is the one that breaks off-grid**: with `rails.spacing=0.3in` against the default
    0.25in grid step, the real gap between adjacent rails is 1.2 lattice rows — never an integer — so
    `spanMin<=d<=spanMax` (both small integers) matches NOTHING, and every column silently produces zero ties.
    Reproduced and confirmed exactly this (a live failing assertion before the fix, restored after — see the
    mutation-check note below).
  - `_applyRailSnap`'s free-anchor "snap toward a nearby rail" bonus (used by BOTH `_tieSpanForColumn`'s
    'free' branch and `_tieSlotsByCount`'s 'cells' span mode) is coordinate-distance-based too, but it's a
    best-effort SNAP on top of an already-valid free span, not a hard attachment requirement — **deliberately
    left unfixed this turn**, named explicitly rather than silently skipped (see "not built" below).
  - Nodes: rail-end nodes read `railRows` directly (unaffected by fractional values — plain coordinates);
    crossing nodes go through `latticeCrossings` (editor-lattice.js), which does real-number range
    intersection, not grid-index matching — traced, not independently unit-tested from scratch, but covered
    indirectly by this turn's own "nodes still form on off-grid rails" test.
  - `_occupiedHas`'s dedup key is a template-string `${i},${j},${kind}` (:1175-1177) — works unmodified for a
    fractional `j` (same float, same string, every time it's read back within one `computePattern` call).
- **Where `PATTERN.spacing` is read** (`P.spacing` inside `computePattern`, :1344): the lattice's own GRID STEP
  — used for `halfRail`, `_scalePrimitiveToLattice`, `_enforceTieMinSpacing`'s cm-conversion, `toLattice`, etc.
  **Deliberately NOT touched this turn** (see the scoping decision below) — ruling 4's "grid step comes from
  the editor grid" is a PANEL-level concern (removing the Spacing select, wiring the toolbar grid into a new
  pattern at creation time), not an engine one; `computePattern` itself doesn't care WHERE `P.spacing` came
  from, only that it's a number. Flagged for the advisor to confirm this scoping is right, rather than silently
  assumed.
- **TIE-GAP is on a different axis entirely.** `_enforceTieMinSpacing` (:984-993) filters by `slot.i` (the
  COLUMN axis) — completely independent of `rails.spacing`/`anchor` (the ROW axis). Confirmed unaffected by
  reading it, then by a dedicated test (`ties.minSpacing` still thins an off-grid pattern) and by rerunning the
  seat-B TIE-GAP test files verbatim (168 tests, unchanged, all green).

### item 2 — Declared `rails.anchor`/`spacing`/`spacingCount` + the generator

**Naming decision, stated rather than guessed:** the dispatch's own wording says "optional `rails.count`," but
`rails.count` ALREADY exists — a `[min,max]` SEEDED RANGE read only by `rails.mode:'count'`. Reusing that key
for a completely different shape (a single optional integer) under `rails.mode:'spacing'` would make one field
mean two different types depending on a sibling field — exactly what this file's own "declare it, don't infer
it" convention exists to prevent. Declared **`rails.spacingCount`** instead. (Flagging the deviation, per the
project's own "tell the other seat if you deviate" convention — there's no other seat on this file this turn,
so it's logged here for the advisor/R7.)

`_railRowsBySpacing(jMin, jMax, rails, gridSpacing)` (editor-lattice-pattern.js, new, next to
`_railRowsByCount`): unseeded (Fred: "on generate it is evenly spaced" — anchor + a fixed step fully determine
every row, so it's deterministic without needing a draw). `anchor:'start'|'end'` walk outward from that edge;
`'center'` interleaves from the midpoint. **The even/odd center distinction (Fred's second amendment):** an
explicit EVEN `spacingCount` uses a HALF-STEP lattice (`c ± 0.5·step, ±1.5·step, …` — no position ever exactly
on centre); an ODD count, or no count at all (fill), uses the INTEGER lattice (`c ± 0·step, ±1·step, …` — centre
always included). Wired into `computePattern`'s `railRows` resolution as a THIRD branch alongside `'every'`/
`'count'` — purely additive, an old pattern's `rails.mode` (defaulting to `'every'` via the EXISTING `mode:
PATTERN.rails.mode || 'every'` fallback, :1360-1362, unchanged) never reaches the new branch, which is exactly
ruling 5's migration guarantee — **no separate migration code was needed**; the existing fallback already
provides it, confirmed by a dedicated regression test (an old-style `{every,offset}` object with no `mode` key
at all still resolves through `_railRows`, byte-identical math).

**The tie-attachment fix (ruling 6):** `_tieSpanForColumn` gained one new parameter, `railsMode` (= `rails.mode`,
passed from its one call site) — when it's `'spacing'`, the rails-anchor branch measures the gap as an
ARRAY-INDEX distance (`k - startIdx`) instead of a coordinate difference; every other `railsMode` keeps the
ORIGINAL coordinate check byte-for-byte. This is the "fix at the declaration, not per-case" ruling 6 asked
for — one conditional, at the one place the mismatch could occur, gated on the SAME `rails.mode` that already
discriminates everything else about rail generation.

### item 3 — Tests (`tests/editor-lattice-pattern-rail-spacing.test.js`, new, 23 tests)

Every generated gap identical (all three anchors); first rail exactly on the anchor (start edge, end edge,
centre line); off-grid spacing honoured with NO rounding (0.3in against a 0.25in grid — genuinely non-integer,
asserted directly); rails outside the boundary dropped; `spacingCount` limits correctly for all three anchors,
including the even/odd centre distinction; degenerate extent/zero spacing never throws; unseeded (two different
seeds, byte-identical rails); both orientations (a dedicated helper accounts for `orient()`'s i/j swap on the
way out — caught a real test bug here: my first attempt compared vertical output against the WRONG extent size,
fixed by computing the equivalent horizontal run over the swapped extent, not the original); old
`rails.mode`/`'count'` behavior completely unaffected (regression tests) plus the FULL pre-existing
`editor-lattice-pattern-*.test.js` + `tie-gap*` suites rerun verbatim (168 tests, all green, zero changes).
**The amendment's own explicit ask** (tie endpoints == rail coordinate, tolerance 1e-9, across anchors × sizes ×
orientations × board/rect + boundary/Shape-Lattice): its own dedicated describe block, sweeping 3 anchors × 3
sizes × 2 orientations in board mode, the same 3×3 in boundary mode (a rectangle boundary primitive, proving
the Shape Lattice code path specifically, not just board/rect), plus the older `ties.mode:'density'` path.
**Mutation-checked:** reverting the index-distance fix fails exactly the "OLDER ties.mode:'density'" test (and
only that one); reverting the even/odd straddle branch fails exactly the "EVEN count" test (and only that one);
reverting `spacingCount` truncation fails exactly the 3 tests that exercise it.

### item 4 — Fred's case, proven live

`tools/repro/rail_spacing_shot.mjs` (new): opens the SVG editor, switches to the Lattice tool, writes
`layer.pattern.rails = {mode:'spacing', anchor:'start', spacing:1}` DIRECTLY onto the active layer (R6 is
engine+data only — no panel field exists yet to drive this from the UI, per the dispatch's own instruction to
drive the pattern record directly), calls `generatePattern`, and reads back the rendered `<line data-lattice=
"rail">` elements. Result on the real running app: **9 rails, first at y=0.5 (exactly the boundary's own
auto-inset top edge), every gap exactly 1.000in** — screenshot at
`C:\Users\danse\.bspline-status\shots\reg-addin\r6_fred_rail-on-boundary.png`. Desktop only, per the dispatch
(mobile wasn't asked for here; a quick attempt hit an unrelated eval-serialization issue in the mobile layout
and wasn't worth chasing for a one-off verification script when desktop already proves the point).

**Gate:** `npx vitest run`: **85/86 files, 1588/1589 tests** passed. The ONE failure
(`tests/frame-3d-sweep.test.js`) is **pre-existing, unrelated to this turn** — confirmed by stashing every R6
change and rerunning it in isolation: identical failure on a clean tree. Not touched, not investigated further
(out of scope — a frame-builder 3D sweep, nothing to do with lattice patterns). `select_drag_shape.mjs` rerun
against the LOCAL build (not the deployed URL): **ALL CHECKS PASSED**, both lattice types — confirms the new
`'spacing'` rail mode (opt-in, off by default) doesn't disturb the default `'count'`-mode drag-and-persist
behavior the interactive tool actually ships with today.

**Not built this turn, named rather than silently skipped:**
- `_applyRailSnap`'s free-anchor snap-to-rail bonus stays coordinate-distance-based — a graceful-degradation
  case (a free tie still gets a valid span either way; it just may snap onto a rail less precisely off-grid),
  not the hard "ties must attach" requirement ruling 6 was actually worried about (that's the rails-anchor
  path, fixed above). Flagged as a possible follow-up if Fred notices it in practice.
- `PATTERN.spacing`/the editor-grid wiring (ruling 4) — a panel/UI-creation-time concern, scoped to R7. Flagged
  explicitly for the advisor to confirm rather than assumed.
- No panel UI changes anywhere (`properties-lattice.js`/`properties-shape-lattice.js` untouched this turn, per
  the dispatch's own scope split) — Boundary-first ordering, Anchor/Spacing/Count fields, and the "Draw
  boundary" toggle removal are all R7.

**Hands off, respected:** `fb-app`, `editor-shape-lattice-generator.js`, frame files,
`core/preview/frame-mesh.js`, both panel files, and lane 2's own files (`sketch_manifest_builder.py` et al. —
its own BOUNDARY-GUIDE work) were not touched.

## 2026-09-26 — turn 14 — R7 item 0: three LIVE Fusion bugs from R4/T76, found by the home advisor

Lane2's L1 BOUNDARY-GUIDE merged before this turn started (confirmed in the R7 dispatch header), so
`sketch_manifest_builder.py` is fair game again — this item was explicitly assigned there by the amendment.

**(a) Every stale-params cleanup pass silently failed, every Send.** R4's own `_LogAdapter` (then just
`types.SimpleNamespace(log=_log)`) passed `_log` (ONE positional arg, `b-spline-gen.py:134`, this file's
established convention — bake any level into the message text) directly as `.log`, but
`param_ownership.compute_stale_params` calls `logger.log(msg, level)` — a TWO-arg shape — on almost every
branch that has anything to report. Fixed with a tiny declared adapter, `_LogAdapter`, folding `level` into
the message the SAME way this file's own direct `_log(f"...")` calls already do (`[LEVEL] message`), rather
than inventing a second logging convention. **Should have been caught in R4:** I explicitly flagged in that
turn's own WORK-LOG that the `_handle_generate` wiring itself had no dedicated test ("felt like scope creep");
this is exactly the gap that flag predicted, now real. R7 item 0 fixes it with an actual test this time.

**(b) Every lattice parameter looked out-of-payload, on every Send.** `b-spline-gen.py`'s own payload-names
loop read `layer.get('manifest')` — a key that has NEVER existed in a real payload. The app sends
`layer['sketchManifest']` (`export-flow.js:472,484`; the ALREADY-correct reader,
`_svg_layer_import_plan`, reads exactly that key). This is a plain copy-paste/naming slip from R4 — I never
cross-checked the payload-names loop's key against the reader RIGHT NEXT TO IT in the same file. Declared ONE
shared accessor, `_layer_manifest(layer)`, used by BOTH readers now, so the two literal-string copies that
diverged once can never diverge again.

**(c) SE17 cross-kind projections failed on every real Fusion build, proven live on Ranchy by the home
advisor.** `build_constrained_sketch` called `_apply_projections` INSIDE the `sketch.isComputeDeferred = True`
window (~sketch_manifest_builder.py:979-990) — a real Fusion API quirk: `sketch.project()` returns an EMPTY
collection while the TARGET sketch has `isComputeDeferred=True`. `_apply_projections` itself already had a
correct "project() returned nothing → skip + log" path (unchanged) — it was firing on EVERY projection live,
not because of a genuine miss, but because of this ordering. **Fix:** moved the `_apply_projections` call to
BEFORE the deferred window opens — it only ever needs the ALREADY-BUILT source sketches (`kind_to_sketch`,
an earlier kind in the same manifest group), never this sketch's own not-yet-created entities, so there was
no correctness reason it needed to be inside the window. Geometry + constraints stay in the SAME one deferred
window as before; a constraint targeting a projected curve resolves through the exact same
`ctx.resolve_entity`/`ctx.entity_map` path regardless of when the projection ran, since entity_map is
populated before the window even opens.

**The shim never modeled this, so the existing SE17 test passed even with the live bug.**
`test_sketch_manifest_builder.py`'s own `FakeSketch.project()` always returned a valid projected copy,
regardless of `isComputeDeferred` — the EXACT gap the amendment named. Added the missing behavior (`if
self.isComputeDeferred: return FakeObjectCollection()`) to the shim itself, which makes the ALREADY-EXISTING
test (`test_shared_ctx_lets_a_later_kind_project_an_earlier_kinds_entity_and_constrain_against_it`,
written back in T76/SE17) a real regression guard for the first time. **Mutation-checked the fix directly:**
reverting the reorder (moving `_apply_projections` back inside the deferred window) makes that exact test
fail with `CONSTRAINT MISS: proj_rail0_S not found in Ties` — reproducing the live symptom byte-for-byte, not
a synthetic stand-in. Restored after confirming.

**New tests:** `test_b_spline_gen_stale_params_wiring.py` (7 tests) — drives the REAL `_layer_manifest` and
`_LogAdapter` (not stand-ins), including a payload fixture shaped from `export-flow.js`'s own
`sketchManifest` attachment (multiple layers, one with no manifest at all — a hand-drawn layer) proving every
lattice param name is collected and the wrong `'manifest'` key is never read even when present. Needed the
SAME minimal-adsk-stub-before-import idiom `frame-builder/fb_engine/test_board_params_ownership.py` already
uses (b-spline-gen.py subclasses 4 `adsk.core.*` handler classes at class-definition time, so the stub needs
those 4 as plain placeholder bases) — loaded by file path via `importlib.util.spec_from_file_location`
since `b-spline-gen.py` isn't a valid Python module name. **Mutation-checked:** reverting `_LogAdapter.log`
back to the buggy direct-pass-through fails exactly the 3 tests that exercise it (a bare `.log(msg, level)`
call, the folding behavior itself, and the end-to-end `compute_stale_params` drive), restored after.

**Gate:** `python -m pytest -q` in `bspline-frame-builder/`: **302/302 passed** (was 284 in R4; +7 this
file, +11 from R7 item 1's own carry-over work already on main). Full `npx vitest run`: **88 files / 1630
passed**. No Fusion (per the standing rule) — the home advisor's own live Fusion run is what surfaced these
three bugs in the first place, and remains the one that will confirm the fix live.

**Hands off, respected:** touched exactly the three files these bugs live in
(`b-spline-gen.py`, `sketch_manifest_builder.py`, `test_sketch_manifest_builder.py`) plus one new test file
— no panel/UI files, no frame files, nothing outside the scope the amendment named.

## 2026-09-26 — turn 14 — R7 items 1-4: lattice panel restructure (LAST task before hand-back)

Confirmed per the checklist's own item 4 note: the "Draw boundary" toggle is already gone (lane2's own L1
survey) — grepped both the markup and every editor JS file; the only hits are historical comments describing
its REMOVAL, no live checkbox/id anywhere. Nothing built for this — confirmed, not silently skipped.

### item 2 + 3 — Box Lattice + Shape Lattice panels: new section order + fields

Both panels share the identical restructure (same PATTERN.rails shape, same computePattern engine, same
`readFieldsIntoPattern`/`syncFieldsFromPattern` idiom) — every change below was made ONCE in
`properties-lattice.js`, then mirrored line-for-line into `properties-shape-lattice.js`, never re-derived.

- **Section order, real markup, confirmed by a test that parses the actual `bspline_gen_palette.html`** (not
  just the JS): Box Lattice — Boundary → Rails → Ties → Nodes (then Colors/Widths/Add, unordered by the
  ruling — placed after Nodes; Add specifically moved to the very end, right before the footer, since it's a
  manual DRAWING tool, not a generated-pattern setting the ruling's own list names). Shape Lattice — Shape →
  Segments (untouched, seat C's own SHAPE-PARAMS territory, confirmed still FIRST) → Boundary → Contour →
  Rails → Ties → Nodes → Colors → Widths.
- **Boundary = Size W×H only.** Confirmed by a test that walks the real Boundary section's own DOM subtree and
  asserts its ONLY two `<input>` elements are Size Width/Height — nothing else lives there.
- **Contour moved as ONE block** (the checkbox, its stroke-width field, and the End-Rule sub-row that depends
  on it) from its old position (near the very end of the Shape Lattice panel, right before Fill seed) to
  right after Boundary — no ids/wiring changed, purely a DOM-position move; `properties-shape-lattice.js`
  reads every one of them by id exactly as before.
- **Rails section** (both panels): Orientation (moved here from the old "Grid & rails"), then **Anchor**
  ([Top|Center|Bottom] for horizontal, [Left|Center|Right] for vertical — `_updateAnchorLabels`, called from
  both `syncFieldsFromPattern` and the Orientation click handler, so the labels never drift from the
  orientation actually in effect), **Spacing** (in, rail-to-rail — `rails.spacing`), optional **Count**
  (placeholder "fill" — `rails.spacingCount`). Anchor/Spacing/Count are deferred to Generate, same "settings
  field, not an immediate re-projection" behavior the OLD rails-mode toggle already had (Orientation/Size stay
  immediate, unchanged).
- **`readFieldsIntoPattern` now ALWAYS writes `rails.mode:'spacing'`** — there is no 'every'/'count' UI left
  to express a different mode from. An OLD saved pattern's own stored `every`/`offset`/`count` are left
  completely alone until the layer's OWN Generate is clicked from THIS panel (loading/viewing never rewrites
  them — proven by a dedicated test); clicking Generate adopts the CURRENT panel's semantics, same as every
  past UI iteration of this panel has always done (T56's own 'count' switch would equally have overwritten an
  old pattern's mode the first time ITS OWN Generate ran under the T56-era UI — this isn't a new kind of
  migration risk, just the same one, again).
- **Seed hidden, not deleted.** Both panels: the field/id/wiring are completely untouched (Generate still
  writes a fresh value into it every time); only the SECTION is hidden (`data-no-collapse` + `display:none`,
  so editor-drawer.js's collapsible-section sweep — which only ever looks at VISIBLE sections — never even
  sees it). Proven live: clicking Generate re-rolls the (invisible) Seed field in both panels, confirmed by a
  DOM test reading its `.value` before/after.
- **The OLD grid-step Spacing `<select>` + Every/Offset + seeded count-range rail fields are REMOVED from the
  markup entirely, in both panels** — not hidden, gone (a dedicated test asserts `getElementById` returns
  `null` for all of them, both prefixes). An old saved pattern's own stored values for these are unaffected —
  nothing writes them any more, and `computePattern`'s own pre-existing fallback-to-current-value shape
  (unchanged, R6 already relied on it) preserves them exactly.
- **Formula fields (R5) re-attached to the new fields**, both panels — `latticeScope`'s own declared `spacing`
  name is REPOINTED from the retired grid-step concept to `rails.spacing` (rail-to-rail), per the checklist's
  own instruction; `railcountmin`/`railcountmax`/`railevery`/`railoffset` (R5's own names for fields that no
  longer exist) are removed from the scope — dangling names would offer a dropdown entry for nothing. `stroke`/
  `railwidth`/`tiewidth`/`nodewidth`/`minspacing`/`tiecountmin`/`tiecountmax`/`tiedensity` are unchanged.

**A real, deliberate design call, stated rather than silently picked:** the checklist's own R6 carry-over 2
("one grid — the lattice grid step comes from the editor grid") is implemented at `freshPattern`
(editor-lattice-pattern.js, landed in item 1 below) — this turn's panel wiring does NOT read or write
`pattern.spacing` (the grid step) anywhere any more; it is purely a creation-time concern, already handled.

### item 1 — R6 carry-overs (engine + defaults)

1. **`PATTERN_DEFAULTS.rails.mode` changed from `'count'` to `'spacing'`** — the ONLY place this default is
   ever read is a brand-new layer with NO `.rails` object at all (`computePattern`'s own
   `PATTERN.rails ? {...} : {...PATTERN_DEFAULTS.rails}` branch, unchanged) — an old pattern's own `rails.mode`
   (explicit, or the `|| 'every'` fallback for a pre-T56 object) is read back byte-identically regardless,
   confirmed by 4 dedicated regression tests (explicit `'count'`, explicit `'every'`, no `mode` key at all,
   and the brand-new-pattern case now resolving to `'spacing'` instead).
2. **`freshPattern(editor)`** (new, `editor-lattice-pattern.js`) — the ONE place a brand-new pattern is cloned
   from `PATTERN_DEFAULTS` (confirmed by grepping every `JSON.parse(JSON.stringify(PATTERN_DEFAULTS))` call
   site in the codebase: exactly the two panels' own lazy-creation points, both now routed through this
   function). Stamps `.spacing` from the LIVE `editor._grid.spacing` (the toolbar grid, `editor-grid.js`) when
   available, falling back to `PATTERN_DEFAULTS.spacing` otherwise — never throws, tested with no grid, an
   empty grid object, and a real one. An EXISTING pattern never calls this at all (it already has its own
   `.spacing`, read back unchanged by `computePattern`'s own merge) — so "a saved pattern's own spacing is
   still read as its grid step" needed no new migration code, just this one creation-time hook.

**A real ripple I found and fixed, not asked for in the checklist:** changing `PATTERN_DEFAULTS.rails.mode`
broke the AMBIENT default THREE other test files silently relied on (`editor-lattice-pattern-density-count
.test.js`, `editor-lattice-pattern-tie-spread.test.js`, `editor-sketch-manifest.test.js` +
`parity-app-manifest.test.js`'s own SE14c/T73-AMEND-3 fixtures) — none of them are ABOUT rails.mode itself,
they scaffold ties/manifests ON TOP of whatever the ambient default happens to produce. Fixed each by making
`rails.mode:'count'` EXPLICIT in their own fixtures (a declared `PATTERN_COUNT_MODE` constant, same shape in
both density-count and tie-spread files) rather than leaving them silently broken or, worse, "fixed" by
loosening their own assertions. One test's own INTENT changed for real (the "brand-new pattern" test in
density-count.test.js, which used to assert the T56 default and now asserts the R7 one) — rewritten to test
that fact directly, not just patched to pass.

### item 4 — Tests + real-browser proof

**New: `tests/lattice-panel-restructure.test.js`** — parses the REAL `bspline_gen_palette.html` (not a
fixture) to prove section order in both panels, Boundary's own field set, the old fields' removal, the new
fields' existence, Seed's hidden-but-present state, and the "Draw boundary" toggle's absence, all directly
against the shipped markup (a wrong DOM edit fails this test, not just a JS-level assumption). Plus DOM-driven
wiring tests (both panels): Anchor click + Spacing/Count → `pattern.rails` on Generate; empty Count → `null`
(fill); Seed re-rolls despite being hidden; an old `{every,offset}`-shaped pattern loads without crashing and
keeps its own values until Generate is clicked.

**Real-browser proof** (`tools/repro/r7_panel_shots.mjs`, new), desktop + mobile, against the LOCAL build:
screenshots both panels in their new order (box: Boundary/Rails/Ties/Nodes/Colors/Widths visible in that
order in the live app; shape: Shape/Segments untouched and first, then Boundary/Contour/Rails/Ties visible) —
and Fred's own original case, driven THROUGH THE UI THIS TIME (not the pattern record directly, unlike R6):
clicked Anchor "Top", typed Spacing "1", clicked Generate — **9 rails, first exactly on the boundary's top
edge (y=0.5), every gap exactly 1.000in**, screenshot at
`C:\Users\danse\.bspline-status\shots\reg-addin\r7_desktop_box-anchor-top.png`. `select_drag_shape.mjs` rerun
against the local build: **ALL CHECKS PASSED**, both lattice types — confirms the restructured panels never
disturbed the default `'count'`-mode drag-and-persist behavior the interactive tool still ships with (Anchor/
Spacing/Count are opt-in via Generate; nothing about the box/Shape Lattice's own drag mechanics changed).

**Gate:** `npx vitest run`: **89 files / 1645 passed**. `python -m pytest -q`: **302/302 passed**. No Fusion.
`frame-3d-sweep.test.js` (noted as possibly flaky at 5s on this machine, per the dispatch) did NOT time out
this run.

**Hands off, respected:** `fb-app`, `editor-shape-lattice-generator.js`, frame files,
`core/preview/frame-mesh.js` were not touched. Within the two panel files, only the Fill section (Boundary/
Contour/Rails/Ties/Nodes/Colors/Widths/Seed) was touched — Shape Lattice's own Shape/Segments block (seat C's
SHAPE-PARAMS territory) was read (to confirm its own section titles for the order test) but not edited at
all, confirmed by a clean diff review before committing.

### Finishing this hand-back

This is the last reg-addin task before handing the regular add-in back to the home advisor
(`HANDOFF-REG-ADDIN.md` §5). Nothing left mid-flight: all four items done, gate green, screenshots taken,
`select_drag_shape.mjs` passing on the local build. `proc_health.py watch` clean before the final pass.
