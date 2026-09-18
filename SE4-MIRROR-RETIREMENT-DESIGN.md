# SE4 — Retire the P.stampLayers content mirror (C5 / EDM4)

Design only. No product code changed in this turn. File:line references are against the tree at
`f46561a` (SE3a) + lane-b's T4/T5/T6, under `bspline-frame-builder/b-spline-gen/html/`.

## Why now, restated with evidence

SE3a fixed Cancel and the empty-layer mask leak, but its own diff documents the tangle: the compositor
reads `layer._mask || P.stampLayers[idx].mask` (`core/engine/rebuild.js:214`), so every mask write and
every clear has to hit both stores; `onChange` writes `P.editorSvg` and mirrors it into
`P.stampLayers[active].svg` (`main/app-init.js`); `updateStampMasks`'s legacy fallback resurrects a mirror
whenever no editor layer covers an index. Two content stores is the root; SE3a's mask invariant is the
last patch that tangle should force us to write.

**Two more concrete problems surfaced while building this inventory, not previously documented:**

1. **`takeSnapshot`'s `stampSvgText` parameter is always `null`.** `core/history.js:24` —
   `takeSnapshot(label = "Action", stampSvgText = null)` — and every one of its 3 current callers
   (`core/sculpt-interaction.js:104,146`, `main/app-init.js:67`) passes only `label`, never a second
   argument. So `snapshot.stampSvgText` is always `null`, never `undefined`. `applySnapshot`
   (`main/snapshot-manager.js:41`) checks `if (snap.stampSvgText !== undefined && ...)` — `null !==
   undefined` is `true` — so **every undo/redo unconditionally sets `P.stampLayers[0].svg = null`**,
   regardless of what was actually being undone. This is silent today only because most readers already
   prefer `editor._layers`/`P.editorSvg` over this field — but it directly breaks the one reader that
   doesn't (#2 below) on every single undo/redo.
2. **`main/export-flow.js`'s `isCarvingLayer`/`hasShippableSvg` (`:40-41`) read `P.stampLayers[i].svg`/
   `.mask`/`.enabled`/`.depth` with NO editor-layer fallback at all** — the one place in this codebase
   that doesn't already prefer `editor._layers`. Combined with finding #1: after ANY undo/redo, `Send to
   Fusion` / `Export STEP`'s SVG-inclusion feature (`activeStampLayers()`/`exportableStampLayers()`,
   `:43-44`, driving wizard option availability at `:76,96,113,135` and the actual export payload at
   `:187`) sees a `null` `.svg` on layer 0 and silently drops it from the export — a real, live bug this
   migration must fix as part of moving that reader onto the single store, not just an architecture
   cleanup.
3. **The sidebar's Clear button (`btnStampClear`, `main/stamp/svg-source.js:73-82`) never touches the
   editor's actual content.** It calls `setStampLayerSvg`/`setStampLayerMask`/`setStampLayerEnabled` on
   the mirror only — `editor._sketchLayer`'s real drawn content for that layer is left completely intact.
   This is a different button from the editor modal's own Clear (`editorClear`, `editor/tools/action-
   tools.js`, which DOES call `editor._sketchLayer.clear()`) — two buttons named "Clear" with two
   different, inconsistent effects. Noted here as a desync this migration should resolve, not something
   to fix in this design-only turn.

## 1. Inventory — every reader/writer of `P.stampLayers[i].svg` / `.mask`

Grepped `stampLayers` under `core/`, `main/`, `editor/`, and `tests/` (67 total hits across 15 files,
listed in the appendix at the bottom of this doc for the grep-count check). This table lists only the
hits that touch `.svg` or `.mask` specifically — tooling-only hits are addressed in §2.

| File:line | R/W | Field | What it needs it for | Verdict |
|---|---|---|---|---|
| `core/state.js:108-113` (DEFAULT) | declares | `.svg`/`.mask` | default shape for a fresh stamp layer | **dies** — removed from the shape |
| `core/state.js:211-219` `setStampLayerSvg` | W | `.svg` (+ auto-enables) | the one mirror-svg setter | **dies** |
| `core/state.js:220-225` `setStampLayerMask` | W | `.mask` | the one mirror-mask setter | **dies** |
| `core/state.js:242` `persistableP` | W (strips) | `.mask` | masks don't survive JSON | **dies** — nothing left to strip once `.mask` isn't in the shape |
| `core/history.js:34` `takeSnapshot` | R (via persistableP) | `.svg` (accidentally, via the whole layer) | undo/redo history entries | **dies** — `layerConfigs` stops carrying content once `.svg` leaves the shape; the tooling capture itself survives |
| `core/history.js:24` `takeSnapshot`'s `stampSvgText` param | — | — | **dead parameter, always null (finding #1)** | **dies** — remove the parameter; fix or remove the `applySnapshot` branch that reads it |
| `main/snapshot-manager.js:41-43` `applySnapshot` | R+W | `snap.stampSvgText` → `.svg` | (attempted) content restore on undo/redo | **dies** — see finding #1; replace with a real decision on whether undo/redo should touch `P.editorSvg` at all (open question, §5) |
| `main/snapshot-manager.js:55` `applySnapshot` | R | `.svg`, `.enabled` | gates whether to regenerate masks after a snapshot restore | **rewrite** — check `P.editorSvg`/editor-layer content instead |
| `main/app-init.js` `editorRestoreSvg()` (`:28-30`) | R | `.svg` (fallback) | one-time migration aid for pre-`editorSvg` saves | **kept, explicitly**, folded into the declared migration path (§3) rather than left as an ad-hoc fallback |
| `main/app-init.js:56` `initApp` | R | `.svg` (`.some`) | decide full-remask-refresh vs plain rebuild at boot | **rewrite** — check `P.editorSvg`/editor layers |
| `main/app-init.js:90` `onChange` | W | `.svg` (mirror) | "any code path still consulting it" | **dies** |
| `main/app-init.js:109` Apply branch | W | `.svg` (mirror) | same | **dies** |
| `main/app-init.js:127` Cancel branch (SE3a, this session's own turn 191 code) | W | `.svg` (mirror) | keep the mirror consistent with `onChange` | **dies** — the newest write to the very thing being retired |
| `main/stamp/svg-source.js:65` Browse fallback | W | `.svg` | legacy path when editor isn't loaded yet | **dies** once `_importSvgIntoEditor` (below) is the only path |
| `main/stamp/svg-source.js:130-169` `_importSvgIntoEditor` (private) | — | — | **already the unified-model import path** — appends parsed children into `editor._sketchLayer` with `data-layer` set, then fires `onChange`/`pushState` | **survives**, promoted to the dispatch's proposed `importSvgIntoLayer` (export it; no new function needs writing) |
| `main/stamp/svg-source.js:75-77` `btnClear` | W | `.svg`/`.mask`/`.enabled` | sidebar Clear | **rewrite** — see finding #3; must clear the editor's actual content for that layer, not just the mirror |
| `main/stamp/svg-source.js:113` `syncFromLayer` | R | `.svg` | legacy `fileNameSpan` display fallback | **rewrite** — use `getLayerSvg`/editor-layer content check |
| `main/stamp/layer.js:144` | R | `.svg` (fallback) | `fileNameSpan` display when editor not loaded | **dies** — no content is possible before the editor loads anyway |
| `main/stamp/_shared.js:36-40` `activeLayer()` | R | whole legacy layer (incl. `.svg`/`.mask`) as fallback shape | **the root cause of RO1/SE3a's dual-shape bug** — sometimes returns an editor layer (no `.svg`), sometimes a legacy stamp layer (has `.svg`/`.mask`) | **narrow** — the fallback shape must stop offering `.svg`/`.mask` once neither model has them, closing the ambiguity for good |
| `main/stamp-mask-manager.js` legacy fallback (`:80-96`) | R+W | `.svg`/`.mask`/`.enabled` | resurrect a stamp pass when no editor layer covers an index | **dies** entirely (slice b) |
| `main/stamp-mask-manager.js:37-38` `clearEmptyLayerMasks` (this session's own SE3a code) | W | `.mask` mirror | keep `_collectStampPasses`'s `||` fallback from resurrecting a stale mask | **dies** — simplifies to just `layer._mask = null`, no mirror write, once the `||` fallback (next row) is gone |
| `core/engine/rebuild.js:214` `_collectStampPasses` | R | `layer._mask \|\| P.stampLayers[idx].mask \|\| null` | the exact fallback SE3a had to defend against | **dies** — becomes `layer._mask` alone |
| `core/engine/rebuild.js:236-242` `_collectStampPasses` legacy pass-building | R | `.svg`/`.mask`/`.enabled` | uncovered-index fallback passes | **dies** entirely (slice b) |
| `main/export-flow.js:40-44` `isCarvingLayer`/`hasShippableSvg`/`activeStampLayers`/`exportableStampLayers` | R | `.svg`/`.mask`/`.enabled`/`.depth` | wizard option availability + export payload | **rewrite — the riskiest single change** (finding #2); must read `editor._layers` (mask via `_mask`, content-existence via `getLayerSvg`) with no legacy path left to fall back on |
| `main/export-flow.js:187` `layersToExport` | R (downstream) | `.svg` (via the above) | export payload assembly | **follows from the rewrite above** — re-verify at implementation time, not fully traced here |
| `main/cloud-project-manager.js:676` | R | `.enabled` only | project-tile "has stamps" badge | **unaffected** — tooling/visibility field, not content |

**Tests that guard the mirror today**, per the dispatch's explicit ask:
- `tests/editor-reopen.test.js` — 2 of 3 tests are about `ctx.activeLayer()`/`editorRestoreSvg`'s
  `P.editorSvg`-first behavior and **survive unchanged**; the third (`'editorRestoreSvg: P.editorSvg >
  legacy stamp svg > null'`, `:71-81`) directly exercises the `.svg` legacy fallback inside
  `editorRestoreSvg` — **dies** once that fallback is folded into the declared migration (§3) instead of
  staying a live per-call fallback.
- `tests/history-snapshot.test.js` — exercises `P.stampLayers[0].mask` directly (persistableP's
  mask-stripping via `takeSnapshot`) — **needs rewriting** once `.mask` leaves the stampLayers shape;
  what (if anything) it should assert instead depends on the undo/redo open question in §5.
- `tests/persistable-p.test.js` — tests `persistableP`'s `.mask`-stripping (`:36-37,56-58`) directly on
  `stampLayers[i].mask` — **those specific assertions die**; other tooling-focused assertions in the same
  file (`:42,46`) **survive**.
- `tests/stamp-mask-clear.test.js` (this session's own SE3a test) — its dual-clear assertions
  (`P.stampLayers[idx].mask` alongside `editorLayers[idx]._mask`) **simplify** once the mirror-half of the
  clear is removed; the underlying invariant ("empty visible layer → no mask", "hidden layer → mask kept")
  **survives** against `editorLayers[idx]._mask` alone.
- `tests/b6-hidden-layer-save.test.js` — tests `save()`'s hidden-layer serialization, unrelated to
  `.svg`/`.mask` mirror — **unaffected**.

## 2. Classification — what stays on `P.stampLayers`

The per-layer **tooling** — `depth`, `profile`, `angle`, `blur`, `enabled`, `smoothing`, `suppression`,
`edgeFilletRadius`, `filletPower`, `tx`, `ty`, `rotation`, `scale`, `mirrorX`, `mirrorY`, plus `id`/`name`
— is legitimately `P`'s: it's what the Vector Stamping sidebar's sliders read/write
(`core/state.js:357-374`'s `layerSpecific` sync), and it's what `persistableP` needs to survive a save in
JSON form. **Only `.svg` and `.mask` are the duplicate**, per the dispatch's own framing, and this design
keeps to that scope.

**One thing noticed but explicitly left alone, flagged for whoever picks it up next:** the tooling fields
ALSO appear to be persisted twice today. `editor-io.js`'s `_PERSISTED_LAYER_FIELDS` (id, name, visible,
depth, profile, angle, tx, ty, rotation, scale, mirrorX, mirrorY, …) are written straight into the saved
SVG's `data-editor-layers` attribute — which is itself `P.editorSvg`'s content — while the SAME fields
also live in `P.stampLayers[i]` and get JSON-serialized separately via `persistableP`. Whether that's a
second mirror worth its own retirement, or a deliberate belt-and-suspenders (editor layers are the
runtime/save format, `P.stampLayers` is the sidebar's live-editing buffer, kept in sync by the
`layerSpecific` mirror), is a real open question — **out of scope for SE4**, which the dispatch scoped to
content only, but worth a line in ROADMAP so it isn't lost.

## 3. Single-store proposal

- **`P.editorSvg` is the document.** Already true today for the primary write path (`onChange`, Apply,
  SE3a's Cancel) — this design just removes the mirror writes alongside it, not the document write
  itself.
- **`editor._layers[i]` (with `_mask`) is the runtime view.** Already true for tooling (`editor/
  layers.js`'s `TOOLING_DEFAULTS`) and for masks (`_mask` is already the primary read in
  `_collectStampPasses`, `.mask` is only ever a fallback). This design removes the fallback, not the
  primary.
- **`_collectStampPasses` reads only `layer._mask`.** `core/engine/rebuild.js:214` drops the `||
  (P.stampLayers?.[idx]?.mask)` half; `:236-242`'s legacy pass-building block is deleted outright.
- **`updateStampMasks` drops its legacy branch** (`main/stamp-mask-manager.js:80-96`) and
  `clearEmptyLayerMasks` drops its mirror-clear half (`:37-38`).
- **Browse imports into the editor via one declared, exported entry.** `_importSvgIntoEditor`
  (`svg-source.js:130-169`) already does this — export it as `importSvgIntoLayer(editor, svgText)` (or
  keep the name; it's already the "one declared entry" the dispatch asks for) and delete the legacy-
  fallback branch that calls `setStampLayerSvg` when the editor isn't loaded. That fallback exists for a
  narrow window (editor not yet initialized) — slice (a) should confirm that window is actually
  unreachable from the Browse button (the button lives inside the same modal/panel the editor mounts
  into) before deleting it outright.
- **Sidebar Clear (finding #3) is rewritten to clear the editor's real content for the active layer** —
  removing that layer's `data-layer="<id>"` children from `editor._sketchLayer`, mirroring what
  `editorClear` already does but scoped to one layer instead of the whole sketch — rather than only
  touching the (retired) mirror.
- **Migration, declared as data, not an ad-hoc branch.** A `MIGRATIONS` list run once at load
  (`main/app-init.js`'s `initApp`, right after `loadLastSession()`): for a session/project whose
  `P.editorSvg` is empty but whose `P.stampLayers` still carries a legacy `.svg` (old saves, pre-
  unification), synthesize a minimal editor document from it — one layer, that SVG's content wrapped with
  `data-layer` set — and assign it to `P.editorSvg` once. `editorRestoreSvg()`'s existing fallback
  (`app-init.js:28-30`) already contains the exact same lookup; this migration step replaces it with a
  ONE-TIME write instead of a per-call fallback that has to run forever. After migration, `P.stampLayers[i]
  .svg`/`.mask` can be deleted from the default shape and from every save/load path with nothing left
  depending on them.

## 4. Removal chain

| Link | Fate |
|---|---|
| `core/state.js`: `DEFAULT.stampLayers[i].svg`/`.mask` | removed from the default shape |
| `setStampLayerSvg`, `setStampLayerMask` | deleted; every caller repointed (Browse → `importSvgIntoLayer`, onChange/Apply/Cancel mirror writes → deleted outright, Clear → the new editor-content clear) |
| `setStampLayerEnabled` | **kept** — tooling/visibility, not content |
| `persistableP`'s `.map(L => ({...L, mask: null}))` | removed — nothing left to strip |
| `core/history.js`'s `stampSvgText` parameter + `layerConfigs`'s incidental `.svg` capture | parameter removed; `layerConfigs` naturally stops carrying content once the shape does |
| `applySnapshot`'s `stampSvgText` branch (`snapshot-manager.js:41-43`) | removed; replaced per the undo/redo decision in §5 |
| `applySnapshot`'s `hasStampSvg` gate (`:55`) | rewritten against `P.editorSvg`/editor-layer content |
| `editorRestoreSvg()`'s legacy fallback | folded into the one-time `MIGRATIONS` step (§3), then the fallback itself can be dropped from the hot path |
| `initApp`'s `.svg`-based remask-refresh gate | rewritten against `P.editorSvg`/editor-layer content |
| Browse's legacy-fallback write | deleted once `_importSvgIntoEditor`/`importSvgIntoLayer` is confirmed reachable unconditionally |
| `_importSvgIntoEditor` | kept, exported, renamed if desired |
| sidebar Clear's mirror-only write | rewritten to clear real editor content for the layer |
| `syncFromLayer`'s `.svg` display fallback (svg-source.js, layer.js) | rewritten against `getLayerSvg`/editor-layer content |
| `_shared.js`'s `activeLayer()` fallback shape | narrowed to drop `.svg`/`.mask` from what it can return |
| `stamp-mask-manager.js`'s legacy work-list branch | deleted entirely |
| `clearEmptyLayerMasks`'s mirror-clear half | deleted — becomes `layer._mask = null` alone |
| `rebuild.js`'s `||` fallback + legacy pass-building | deleted entirely |
| `export-flow.js`'s `isCarvingLayer`/`hasShippableSvg`/`activeStampLayers`/`exportableStampLayers` | rewritten against `editor._layers` — the riskiest single change, see §5 |
| `cloud-project-manager.js:676` | untouched — reads `.enabled` only |
| `tests/editor-reopen.test.js`'s legacy-fallback test | removed |
| `tests/history-snapshot.test.js`, `tests/persistable-p.test.js` | mask-related assertions rewritten/removed per §5's undo/redo decision |
| `tests/stamp-mask-clear.test.js` | simplified to single-store assertions |
| `tests/b6-hidden-layer-save.test.js` | untouched |

## 5. Slices

### Slice (a) — compositor reads one store; Browse imports into the editor; export-flow rewritten
- Export `importSvgIntoLayer` from `_importSvgIntoEditor`; delete Browse's legacy-fallback write (after
  confirming the editor is always loaded by the time Browse is clickable).
- Rewrite `main/export-flow.js`'s `isCarvingLayer`/`hasShippableSvg` against `editor._layers` (`_mask`
  existence + `getLayerSvg` for content) — the riskiest change in this whole plan, isolated to its own
  slice so a regression here doesn't block the rest.
- `_collectStampPasses` drops the `||` fallback (keep the legacy pass-building block for now — slice (b)).
- Predicted files: `main/stamp/svg-source.js`, `main/export-flow.js`, `core/engine/rebuild.js` (2-3
  files). Verify: `npx vitest run` green; a new/extended export-flow test asserting a layer with content
  but no mirror `.svg` still counts as carving/exportable; live proof (Send to Fusion after an undo, the
  exact finding-#2 regression) is the advisor's.

### Slice (b) — drop the legacy branch + mirror writes
- Delete `updateStampMasks`'s legacy fallback and `clearEmptyLayerMasks`'s mirror-clear half;
  `rebuild.js`'s remaining legacy pass-building block; `onChange`/Apply/Cancel's `setStampLayerSvg` mirror
  writes in `app-init.js`; sidebar Clear rewritten to clear real editor content; `setStampLayerSvg`/
  `setStampLayerMask` deleted from `core/state.js`.
- Predicted files: `main/stamp-mask-manager.js`, `core/engine/rebuild.js`, `main/app-init.js`,
  `main/stamp/svg-source.js`, `core/state.js` (5 files). Verify: `npx vitest run` green (with
  `tests/stamp-mask-clear.test.js` already simplified); greps `setStampLayerSvg\|setStampLayerMask` → 0;
  live proof (Clear on the sidebar actually clears the carve; the two "Clear" buttons behave
  consistently) is the advisor's.

### Slice (c) — migration + persistence cleanup + remaining test updates
- `DEFAULT.stampLayers[i]` drops `.svg`/`.mask`; `persistableP` drops its mask-stripping map; the
  `MIGRATIONS` one-time step added to `initApp`; `editorRestoreSvg`'s fallback folded into it;
  `core/history.js`'s `stampSvgText` parameter removed; `applySnapshot` rewritten per the undo/redo
  decision below; `main/stamp/layer.js`/`_shared.js`'s remaining `.svg` fallbacks narrowed.
- **Open question this slice must resolve, not assume:** should undo/redo restore the drawn content at
  all? Today it doesn't meaningfully (finding #1 means it's been silently no-op-ing on content since
  `stampSvgText` was introduced) — sculpt/Clear snapshots are for the HEIGHTFIELD, not the vector artwork.
  If that's intentional (undo/redo scope = terrain sculpting, not drawing — the editor has its own
  separate undo stack per `editor.undo()`/`.redo()`), then `applySnapshot` should simply stop touching
  stamp content at all rather than being "fixed" to restore it. If it's not intentional, restoring
  `P.editorSvg` from the snapshot is the real fix. **This is a product decision, not an implementation
  detail** — flag for Fred/the advisor before slice (c) starts.
- Predicted files: `core/state.js`, `core/history.js`, `main/app-init.js`, `main/snapshot-manager.js`,
  `main/stamp/layer.js`, `main/stamp/_shared.js`, plus `tests/editor-reopen.test.js`,
  `tests/history-snapshot.test.js`, `tests/persistable-p.test.js` (9 files, several are test-only edits).
  Verify: `npx vitest run` green; greps `\.stampLayers\[.*\]\.svg\|\.stampLayers\[.*\]\.mask` → 0 anywhere
  under `html/`; a migration test loading an old-shaped save (`stampLayers[0].svg` set, `editorSvg` null)
  and asserting `editorSvg` gets populated once; live proof (opening a project saved before this slice
  still shows its drawing) is the advisor's.

## Risks / STOP conditions

- **Hidden layers.** SE3a's whole "empty vs hidden" distinction (`stamp-mask-clear.test.js`) must survive
  every slice unchanged — none of these edits touch layer visibility, but slice (b)'s `rebuild.js` edit
  sits right next to that logic and should re-run the exact test after each slice, not just at the end.
- **Reopen (RO1).** `_shared.js`'s `activeLayer()` fallback narrowing (slice c) is exactly the kind of
  change that caused RO1 in the first place — a fallback shape quietly missing a field a caller assumes
  exists. Re-run `tests/editor-reopen.test.js` (post-simplification) after every slice, not just slice (c).
- **Multi-layer projects from the cloud.** The migration step (slice c) is written and tested against a
  single legacy layer (`stampLayers[0]`) — a saved project with MULTIPLE legacy `.svg`-carrying layers
  (`editorRestoreSvg`'s `.find()` only ever picks the first) needs its own test before slice (c) ships;
  flagging here since the current `.find()` fallback already has this exact limitation and this design
  doesn't fix it, only relocates it into the one-time migration.
- **`export-flow.js`'s rewrite (slice a) is the one change with no existing dual-path to fall back on** —
  unlike every other reader in this inventory, there is no "prefer editor, fall back to legacy" pattern
  already proven here. Ship it alone, verify it alone, before touching anything else.

## Appendix — grep count for the verify step

`grep -rn "stampLayers" bspline-frame-builder/b-spline-gen/html/{core,main,editor} --include=*.js` → **54**
hits, plus the same under `tests/` → **30** hits — **84 total**, across `core/state.js`,
`core/history.js`, `core/engine/rebuild.js`, `editor/layers.js`, `main/app-init.js`,
`main/cloud-project-manager.js`, `main/export-flow.js`, `main/snapshot-manager.js`, `main/stamp/layer.js`,
`main/stamp/_shared.js`, `main/stamp/svg-source.js`, `main/stamp-mask-manager.js`,
`tests/editor-reopen.test.js`, `tests/history-snapshot.test.js`, `tests/persistable-p.test.js`,
`tests/stamp-mask-clear.test.js`. Every row in §1's table traces back to one or more of these hits;
comment-only / tooling-only hits (e.g. `layerSpecific` tooling sync, `.enabled`-only reads) are the
remainder, addressed collectively in §2 rather than tabled one by one.
