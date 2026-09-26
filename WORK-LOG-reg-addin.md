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
