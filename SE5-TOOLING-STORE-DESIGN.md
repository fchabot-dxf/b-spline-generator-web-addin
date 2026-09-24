# SE5 — One home for per-layer tooling (retire `P.stampLayers` as a tooling store)

Design only. No product code changed in this turn. File:line references are against lane-b HEAD `fa62c4b`
(post-T12), under `bspline-frame-builder/b-spline-gen/html/`. Same section layout as
`SE4-MIRROR-RETIREMENT-DESIGN.md`, reused per the dispatch — SE4 retired the **content** mirror (`.svg`/`.mask`)
and explicitly flagged the **tooling** fields as "a second mirror worth its own retirement... out of scope for
SE4" (SE4 doc §2). This is that follow-through.

## Why now, restated with evidence

T12's audit (`AUDIT-SVG-EDITOR.md`, SA-LAYER-1/2/3) found three live consequences of keeping tooling on
`P.stampLayers[idx]`, all confirmed directly against current code while writing this doc, plus **one root cause
found today that SA-LAYER-1 didn't have**:

1. **`P.stampLayers` is a fixed 3-entry array** (`core/state.js:110-117`); a 4th+ editor layer's tooling read
   (`P.stampLayers?.[idx] || {}`, `main/export-flow.js:61`) is unconditionally `{}` — `enabled`/`depth`/`profile`
   all `undefined` — so that layer is silently excluded from export/carve regardless of visibility or content.
2. **`.enabled` is a fossil the UI stopped writing to once the editor loads — it isn't a deliberate second flag,
   it's a dead code path with a live-looking checkbox on top of it.** Read `main/stamp/layer.js:91-102` and
   `:153-184` directly: the one "Enabled" checkbox in the Vector Stamping panel (`#stampLayerEnabled`) has its
   OWN comment stating this outright — *"For editor layers, this maps to `visible`... For legacy stamp layers (no
   editor coverage), keeps the old `setStampLayerEnabled` path."* Once `window.svgEditor._layers` exists (true for
   the entire life of a normal session), the checkbox reads `layer.visible` (`:97`) and writes exclusively through
   `setLayerVisible()` (`:169`) — `setStampLayerEnabled`/`P.stampLayers[idx].enabled` is provably dead in that
   path. Its only two remaining live writers are Browse-import success (`svg-source.js:69`, sets `true`) and
   sidebar Clear (`svg-source.js:109`, sets `false`) — narrower, accidental paths, not the checkbox a user actually
   sees. This is the exact mechanism behind SA-LAYER-1 finding #2 ("content drawn directly never gets
   `.enabled=true`") — not a sync bug to fix, but a leftover flag to delete, because the thing it was meant to
   track (`visible`) already exists on the object export-flow should have been reading from `editor._layers` all
   along.
3. **`updateP`'s tooling mirror-write is gated behind the very array it's trying to keep in sync**
   (`core/state.js:356-369`) — `if (layerSpecific[key] && P.stampLayers && P.stampLayers[P.activeLayerIdx])`
   wraps BOTH the `P.stampLayers` write AND the `editor._layers[P.activeLayerIdx]` write, so past layer 3 the
   slider write never reaches the editor layer either — the depth/profile/angle/blur/smoothing/suppression/
   edgeFilletRadius/filletPower sliders are a placebo. **Contrast, found today:** the *other* per-layer binder,
   `bindLayerOnlyNumber`/`bindLayerOnlyCheckbox` (`main/stamp/_dom-binders.js:52-104`, used for
   tx/ty/rotation/scale/mirrorX/mirrorY), writes `editor._layers[P.activeLayerIdx]` **unconditionally**, no
   `P.stampLayers` gate at all — it works at any layer count today. The bug isn't "no code writes the editor
   layer correctly," it's that two binder helpers in the same feature apply the pattern inconsistently, and the
   one that doesn't happens to also carry the dead legacy write.
4. **`isFilletActive()` reads `P.stampLayers` unconditionally, without even trying the editor first**
   (`main/stamp/_shared.js:44-47`) — the one reader in this whole inventory that doesn't already have an
   editor-preferring fallback pattern sitting right next to it in the same file (`activeLayer()`, three lines
   above, already does exactly that).

**One thing noticed but not a live bug, flagged for the slice that implements this:** a freshly-added editor
layer gets `TOOLING_DEFAULTS` (`editor/layers.js:37-52` — depth 0.25/vbit/smoothing 15/suppression 0.15, i.e.
layer-0's historical shape) regardless of which position it lands in, whereas `DEFAULT.stampLayers[1]`/`[2]`
(`core/state.js:113-116`) have always carried distinct per-index defaults (depth -0.5/ballnose/smoothing 10;
depth 0.75/flat/smoothing 5). Today this only shows up for a NEW layer created past index 0 via the editor's own
"add layer" — it's a pre-existing cosmetic default-values gap, not something this migration introduces or need
fix; noted so nobody mistakes single-store adoption for a defaults regression if a freshly-added Layer 2 looks
different from what the old fixed 3-slot panel used to hand it.

## 1. Inventory — every reader/writer of tooling fields on `P.stampLayers[i]` / `editor._layers[i]`

Fields: `depth, profile, angle, blur, enabled, smoothing, suppression, edgeFilletRadius, filletPower, tx, ty,
rotation, scale, mirrorX, mirrorY, name, id` (17; `enabled` has no editor-layer counterpart — see finding #2,
its closest analog is `visible`). Grepped `stampLayers` under `core/main/editor` (**41** hits) and `tests/`
(**48** hits) — **89 total**, appendix has the full file list.

| File:line | R/W | Field(s) | What it needs it for | Verdict |
|---|---|---|---|---|
| `core/state.js:110-117` `DEFAULT.stampLayers` | declares | all 17 | default shape for the 3 built-in layers | **dies** — tooling fields removed from the shape; only used by callers below, all retired |
| `core/state.js:215-219` `setStampLayerEnabled` | W | `enabled` | the one setter for the fossil flag (finding #2) | **dies** |
| `core/state.js:356-369` `updateP`'s `layerSpecific` block | R+W | depth/profile/angle/blur/smoothing/suppression/edgeFilletRadius/filletPower | sidebar sliders' write path, mirrors into `editor._layers` too (gated — SA-LAYER-2) | **rewrite** — drop the `P.stampLayers` write and its gating check entirely; keep only the unconditional `editor._layers[P.activeLayerIdx][field] = value` write, matching `bindLayerOnlyNumber`'s already-correct pattern |
| `core/history.js:33` `takeSnapshot`'s `layerConfigs` | R (via `persistableP()`) | all 17, incidentally | undo/redo history entries capture whole-layer tooling | **dies as a P.stampLayers capture** — `layerConfigs` stops carrying anything once the shape is empty; see §5's open question (mirrors SE4c's undo/redo question, this time for tooling) |
| `main/app-init.js:56-113` `MIGRATIONS['legacy-stamp-svg']` | R (`toolingFields` list, `:90-94`) | depth/profile/angle/tx/ty/rotation/scale/mirrorX/mirrorY/blur/smoothing/suppression/edgeFilletRadius/filletPower (14; no `enabled`) | already copies legacy `P.stampLayers[i]` tooling into the synthesized `data-editor-layers` roster for pre-SE4 saves | **extend** — this migration already does exactly what SE5 needs for the ONE remaining gap (a legacy save's tooling that never made it to an editor layer); add `enabled→visible` to its copied-field list (currently omitted) so a legacy layer's enabled state survives as `visible` too |
| `main/cloud-project-manager.js:676` | R | `enabled` | project-tile "has stamps" badge | **rewrite** — read `editor._layers.some(l => l.visible !== false)` (mirrors what the checkbox has actually meant since the editor shipped) |
| `main/export-flow.js:34-39,56-70` `_stampExportCandidates` | R | enabled/depth/profile | wizard option availability + export payload (**SA-LAYER-1**) | **rewrite — the riskiest single change**, matches SE4a's own precedent of isolating this exact function into its own slice; read `depth`/`profile` from `editor._layers[idx]` directly (already carried, `TOOLING_DEFAULTS`-guaranteed non-null), and `enabled` becomes `layer.visible !== false` |
| `main/snapshot-manager.js:41-58` `applySnapshot` | R (comment references depth/profile/blur restoring "as part of P.stampLayers") | depth/profile/blur/etc. | describes today's (soon-to-be-wrong) assumption that snapshot restore reaches tooling via whole-object `P.stampLayers` replacement | **rewrite comment + behavior** — once tooling isn't part of the snapshotted shape, this restore path needs the same undo/redo-scope decision as `layerConfigs` above (§5) |
| `main/stamp/layer.js:44-51` `populateDropdown` | R (fallback) | `name` | dropdown option labels before the editor has loaded | **kept, narrowed** — this fallback window (editor not yet initialized) is real and short-lived; leave as-is, it's reading `name` only, which stays declared on `P.stampLayers`'s STOP-scoped remnant (see §2) |
| `main/stamp/layer.js:91-102` `syncEnabledCheckbox` | R | `visible` (editor) / `enabled` (P fallback) | the checkbox's displayed state (**finding #2**) | **narrow** — drop the `.enabled` fallback branch once `P.stampLayers` no longer carries it; the editor-loaded branch is already correct and already dominant |
| `main/stamp/layer.js:126-132` | R (fallback) | `profile` | show/hide the V-bit angle control before the editor has loaded | **kept, narrowed** — same short fallback window as `populateDropdown` |
| `main/stamp/layer.js:158-184` `enabledCb` change handler | W | `visible` (editor) / `enabled` (P fallback) | checkbox → state (**finding #2**) | **narrow** — drop the `setStampLayerEnabled` fallback branch |
| `main/stamp/svg-source.js:69,109` | W | `enabled` | Browse-import success (`true`) / sidebar Clear (`false`) | **rewrite** — call `setLayerVisible(editor, layer.id, true/false)` instead, so this finally agrees with what the checkbox and export both read |
| `main/stamp/_shared.js:38-42` `activeLayer()` | R (fallback) | whole legacy tooling shape | pre-editor-load fallback, used by `bindLayerOnlyNumber`/`Checkbox` and others | **kept, narrowed** — same short fallback window; the shape it returns loses `enabled` (dies) but keeps the 14 real tooling fields + name/id |
| `main/stamp/_shared.js:44-47` `isFilletActive()` | R | `edgeFilletRadius`, `enabled` | gates immediate vs. debounced remask timing (**SA-LAYER-3**) | **rewrite** — loop `editor._layers` (mirroring `activeLayer()`'s own editor-preferring pattern three lines above it in the same file) with `visible !== false` in place of `enabled !== false`; fall back to `P.stampLayers` only inside the same short pre-load window |
| `main/stamp/_dom-binders.js:52-104` `bindLayerOnlyNumber`/`bindLayerOnlyCheckbox` | W | tx/ty/rotation/scale/mirrorX/mirrorY | transform sliders — **already correct today** | **simplify only** — once `activeLayer()`'s fallback shape and `editor._layers` converge on the same object post-migration, the redundant double-write (`layer[field]` then `eLayer[field]`, same object once the editor is loaded) collapses to one write; not a bug fix, a cleanup riding along |
| `main/stamp-mask-manager.js:68-72` | R (fallback, `eLayer ?? lLayer`) | tooling fields generally | resolve tooling: editor wins, `P.stampLayers[idx]` only if the editor field is nullish | **dies** — already dead in practice (`TOOLING_DEFAULTS` guarantees the editor field is never nullish), confirmed by T12's audit; drop the `?? lLayer` half once `P.stampLayers` has nothing left to fall back to |
| `core/engine/rebuild.js:203-234` `_collectStampPasses` | R | depth/profile/suppression/smoothing/edgeFilletRadius/filletPower | the actual rebuild | **unaffected** — already reads `editor._layers` exclusively, confirmed in T12's audit; no `P.stampLayers` involvement to remove |
| `editor/layers.js:37-52` `TOOLING_DEFAULTS` | declares | 14 fields (no `enabled`/`id`/`name`) | defaults for a fresh editor layer | **unaffected**, already the correct single declaration |
| `editor/editor-io.js:55-61` `_PERSISTED_LAYER_FIELDS` | R (serialize) | id/name/visible + 14 tooling | round-trips the full spec through `data-editor-layers` on save | **unaffected**, already complete — confirms `editor._layers` already persists everything `P.stampLayers` does except the fossil `enabled` |

**Tests that guard tooling on `P.stampLayers` today**, per the dispatch's explicit ask:
- `tests/persistable-p.test.js:21-44` — deep-equals `out.stampLayers[0]`/`[1]` against full tooling shapes.
  **Rewrite once the shape empties** — depends on §5's undo/redo-scope decision (does `persistableP` still need
  to touch `stampLayers` at all once it carries no content AND no tooling?).
- `tests/history-snapshot.test.js:28-44` — its own title is *"captures an independent copy of stampLayers
  tooling in both P and layerConfigs"* — this test's entire premise is the thing being retired. **Full rewrite**,
  gated on the same undo/redo-scope decision (is a tooling-slider change ever meant to be undoable via the
  global Ctrl+Z, or only via the editor's own undo stack the way content already works post-SE4c?).
- `tests/migrations.test.js:41-79` — asserts `P.stampLayers[0].depth`/`.enabled` post-migration. **Rewrite**
  once the migration's target changes from "populate P.stampLayers tooling" (already true today, untouched by
  this design) to also asserting the new `enabled→visible` copy step lands correctly on the synthesized roster.
- `tests/export-flow.test.js` — **the riskiest test to reconcile**: every single test case in this file
  constructs `P.stampLayers` objects carrying `.enabled`/`.depth`/`.profile` (`:39,57,67,77,85`), and its own
  file header explicitly frames the mirror as the thing being read around (`:6,11`). This is the SAME test T11
  (this worker, two turns ago) verified as B13's guard — it guards the *content* fix (SE4a/c) using tooling
  fields as incidental test fixture data, not because tooling itself was the subject. Every fixture needs its
  `.enabled`/`.depth`/`.profile` moved onto the fake editor layer object instead once `_stampExportCandidates`
  stops reading `P.stampLayers` — a fixture-shape change, not a behavior change, but touches every test case in
  the file. Flagged as its own STOP-condition-adjacent risk in §6.
- `tests/stamp-mask-clear.test.js`, `tests/editor-reopen.test.js`, `tests/b6-hidden-layer-save.test.js` —
  grepped, no tooling-field assertions beyond what SE4 already resolved. **Unaffected.**

## 2. Classification — what (if anything) stays on `P.stampLayers`

**Nothing needs to stay for correctness.** Every tooling field editor layers carry is already a strict superset
of what `P.stampLayers` offers, per `_PERSISTED_LAYER_FIELDS` (id/name/visible + all 14 real tooling fields) —
the only field `P.stampLayers` has that `editor._layers` doesn't is `enabled`, and finding #2 establishes that's
a fossil the UI itself stopped consulting once the editor loads, not a distinct concept worth preserving.

**What SE5 should still leave in place, narrowly, and why it's not a mirror:** the short pre-editor-load fallback
window (`activeLayer()`, `populateDropdown`, the V-bit-angle-container check, `isFilletActive`'s pre-load branch)
reads `P.stampLayers` only because `window.svgEditor` genuinely doesn't exist yet at that point in boot — there
is no editor layer to prefer. This is NOT the same shape of problem SE4/SE5 are retiring (two live stores drifting
against each other); it's "nothing loaded yet, so read the static bootstrap defaults." **Recommendation: keep
`DEFAULT.stampLayers` as a *read-only bootstrap default* (rename mentally, not necessarily in code, to "what to
show before the editor exists"), stop writing to it from any user action, and stop it from ever being confused
for a live store again by removing `setStampLayerSvg`/`setStampLayerMask`'s already-dead-since-SE4c siblings —
oh wait, those are already gone; the equivalent step here is removing `setStampLayerEnabled` (the one live writer
left) and `updateP`'s tooling-field write into it.** Concretely: `P.stampLayers` keeps existing as a **static
array of defaults**, consulted only in the pre-load window; every WRITE path currently touching it goes away.

## 3. Single-store proposal

- **`editor._layers[i]` is the tooling home**, for exactly the reason SE4 gave for content: it's saved inside
  the document (`data-editor-layers`, `_PERSISTED_LAYER_FIELDS`) and survives reopen; `P.stampLayers` was never
  the save format for tooling either, the JSON `persistableP()` blob was — and cloud-project round-tripping
  already goes through `editor._layers` for everything else.
- **`updateP`'s `layerSpecific` block drops its `P.stampLayers` write and the gate around it** — becomes an
  unconditional `editor._layers[P.activeLayerIdx][layerSpecific[key]] = P[key]`, matching
  `bindLayerOnlyNumber`'s already-correct pattern exactly (§1's contrast). `P[key]` (the global scratch value,
  e.g. `P.stampDepth`) stays — it's what drives the currently-shown slider value, a UI-state field, not a
  per-layer one, out of scope here.
- **`enabled` retires in favor of `visible`.** Every reader (`export-flow.js`, `cloud-project-manager.js`,
  `isFilletActive`) switches to `editor._layers[idx].visible !== false`. Every writer
  (`svg-source.js`'s Browse-import/Clear) switches to `setLayerVisible(editor, layer.id, true/false)` — the
  SAME function the checkbox and the layers-panel eye icon already call, so all three surfaces finally agree.
- **The pre-load fallback narrows but survives**, scoped explicitly to "editor not yet constructed," reading the
  static `DEFAULT`-shaped `P.stampLayers` for `name`/`profile`/tooling display only — never written to by a user
  action once the rewrite above lands.
- **Undo/redo scope — this design does not assume an answer, same as SE4c left open for content.** Today,
  `takeSnapshot`'s `layerConfigs` captures whole-`P.stampLayers` tooling, and `history-snapshot.test.js` asserts
  exactly that. Once tooling lives only on `editor._layers`, either (a) a tooling-slider edit becomes undoable
  only through the editor's own separate undo stack (`editor.undo()`/`.redo()`, already how content edits work
  post-SE4c) and the global Ctrl+Z stops touching it entirely — consistent with SE4c's own ruling that "global
  undo = heightfield only" — or (b) `takeSnapshot`/`applySnapshot` are extended to snapshot/restore
  `editor._layers`' tooling fields directly (a NEW capability, not a relocation of the existing one, since
  today's `layerConfigs` capture is really just "the JSON side-effect of persistableP() touching `P.stampLayers`,"
  not a deliberate design). **Recommendation: (a), for consistency with the ROADMAP-recorded SE4c ruling** — but
  this is a product decision, flagged for Fred/advisor sign-off before the slice that touches
  `history.js`/`snapshot-manager.js` starts, same as SE4c flagged its equivalent question.

## 4. Migration as data

**No new migration function is needed — the existing one gets one field added.** `MIGRATIONS['legacy-stamp-svg']`
(`main/app-init.js:56-113`) already runs once at boot, already gates on `!p.editorSvg && ... some(l => l.svg)`
(a save from before `P.editorSvg` existed at all), and already copies a `toolingFields` list
(`:90-94`) onto the synthesized roster. That `when` condition is a superset of "this save predates
`editor._layers` having any tooling" — if a save is old enough to lack `editorSvg` entirely, its tooling has
never lived anywhere but `P.stampLayers` either. **Change:** add `'enabled'` to the copied-field list (currently
14 fields, omits it) and map it onto the roster entry as `visible: layer.enabled !== false` (`:97`'s existing
`entry.id`/`entry.name` pattern, one more line). Idempotent for the same reason the existing migration already
is — `when` stops matching once `p.editorSvg` is set, which this migration itself sets on first run.
**No second migration entry is needed for saves made AFTER SE4c but BEFORE this change** — those already have
`editorSvg` populated (so `legacy-stamp-svg`'s `when` won't fire), and their `editor._layers` roster already
carries every tooling field via `_PERSISTED_LAYER_FIELDS` from the moment they were saved; the *only* thing such
a save's `P.stampLayers` might carry that its `editor._layers` roster doesn't is `enabled`, which we're deleting
the meaning of, not preserving.

## 5. Removal chain

| Link | Fate |
|---|---|
| `core/state.js`: `DEFAULT.stampLayers[i]`'s 14 tooling fields + `enabled` | **narrowed to a read-only bootstrap default** (kept — see §2 — but every write path below removed) |
| `setStampLayerEnabled` | deleted; its 2 callers (`svg-source.js:69,109`) repointed to `setLayerVisible` |
| `updateP`'s `layerSpecific` → `P.stampLayers[P.activeLayerIdx][...]` write + its gating check | deleted; the `editor._layers[...]` write becomes unconditional |
| `core/history.js`'s `layerConfigs` capture of `P.stampLayers` tooling | removed or repointed to `editor._layers`, per §3's undo/redo decision |
| `main/snapshot-manager.js`'s tooling-restore comment/assumption (`:55,58`) | rewritten to match whichever of §3's (a)/(b) is chosen |
| `main/cloud-project-manager.js:676`'s `.enabled` read | rewritten to `editor._layers.some(l => l.visible !== false)` |
| `main/export-flow.js`'s `_stampExportCandidates` | rewritten against `editor._layers` for `depth`/`profile`/`visible` — no `P.stampLayers` read left at all (the riskiest change, own slice, matches SE4a's precedent) |
| `main/stamp/layer.js`'s `enabled`-fallback branches (`syncEnabledCheckbox`, the change handler) | narrowed to the pre-load window only |
| `main/stamp/_shared.js`'s `isFilletActive()` | rewritten to loop `editor._layers` with `activeLayer()`'s own already-correct editor-preferring pattern |
| `main/stamp/_dom-binders.js`'s double-write in `bindLayerOnlyNumber`/`Checkbox` | simplified to one write once `layer`/`eLayer` provably converge (cleanup, not a fix) |
| `main/stamp-mask-manager.js`'s `?? lLayer` tooling fallback | deleted — already dead in practice |
| `main/app-init.js`'s `MIGRATIONS['legacy-stamp-svg']` | extended by one field (`enabled` → `visible`), not replaced |
| `tests/persistable-p.test.js` | tooling-shape assertions rewritten/removed per §3's decision |
| `tests/history-snapshot.test.js` | fully rewritten per §3's decision |
| `tests/migrations.test.js` | extended to assert the new `enabled`→`visible` copy |
| `tests/export-flow.test.js` | every fixture's `.enabled`/`.depth`/`.profile` moved from the fake `P.stampLayers` onto the fake editor-layer object — mechanical, but touches the whole file |
| `tests/stamp-mask-clear.test.js`, `tests/editor-reopen.test.js`, `tests/b6-hidden-layer-save.test.js` | untouched |
| `core/engine/rebuild.js`, `editor/layers.js`'s `TOOLING_DEFAULTS`, `editor/editor-io.js`'s `_PERSISTED_LAYER_FIELDS` | untouched — already correct |

## 6. Does anything outside `b-spline-gen` read `P.stampLayers`?

Grepped the whole repo for `stampLayers` outside `b-spline-gen/html`: **zero hits** in any `.py` file
(`fusion-exporter/`, `frame-builder/`, `fb_shared/` — none reference it) and no dedicated presets-worker
directory exists in this repo to check. The only non-`html` hits are the 6 vitest spec files under `tests/`
(already covered in §1/§5). `main/cloud-project-manager.js` sends `persistableP()`'s JSON blob to cloud storage
opaquely (grepped: the cloud-side storage is a KV blob, no field-level schema awareness found in this repo) — so
a cloud-saved project's `stampLayers` tooling is just inert JSON until `runMigrations()`/the editor reads it back
on load, already covered by §4's migration. **No cross-language or backend contract exists for this field —
the whole change is contained to `b-spline-gen/html` + its tests.**

## Slices

### Slice (a) — `updateP` + `isFilletActive` unconditional editor writes; `enabled`→`visible` at the two live writers
- `core/state.js`: `updateP`'s `layerSpecific` block loses its `P.stampLayers` write and gate; keeps only the
  unconditional `editor._layers[P.activeLayerIdx][field] = value` write.
- `main/stamp/_shared.js`: `isFilletActive()` rewritten to loop `editor._layers` (`visible !== false`), matching
  `activeLayer()`'s existing pattern 3 lines above it.
- `main/stamp/svg-source.js:69,109`: `setStampLayerEnabled` calls → `setLayerVisible(editor, layer.id, ...)`.
- Predicted files: `core/state.js`, `main/stamp/_shared.js`, `main/stamp/svg-source.js` (3 files). Verify:
  `npx vitest run` green; a new/extended test asserting a depth-slider edit on layer 4 (no `P.stampLayers[3]`)
  actually reaches `editor._layers[3].depth`; live proof (4-layer session, edit layer 4's depth slider, confirm
  the carve changes) is the advisor's.

### Slice (b) — `export-flow.js` rewrite + `cloud-project-manager.js`
- `main/export-flow.js`'s `_stampExportCandidates` reads `depth`/`profile`/`visible` from `editor._layers[idx]`
  directly, no `P.stampLayers` read at all — isolated to its own slice per SE4a's own precedent ("no existing
  dual-path to fall back on" applies here too, same function).
- `main/cloud-project-manager.js:676`'s `.enabled` read → `editor._layers.some(l => l.visible !== false)`.
- `tests/export-flow.test.js`: every fixture's `.enabled`/`.depth`/`.profile` moves onto the fake editor-layer
  object (mechanical rewrite of the whole file, not a new assertion).
- Predicted files: `main/export-flow.js`, `main/cloud-project-manager.js`, `tests/export-flow.test.js` (3 files).
  Verify: `npx vitest run` green; the existing "counts a layer with real editor content even when its
  P.stampLayers mirror is null" test class extended with a 4th-layer case; live proof (add a 4th layer, draw on
  it directly, export — it's now included) is the advisor's, and is the direct regression test for SA-LAYER-1's
  original failure scenario.

### Slice (c) — `setStampLayerEnabled` deletion, migration extension, `P.stampLayers` narrowed to read-only default, remaining tests, undo/redo decision
- **Open question this slice must resolve, not assume** (mirrors SE4c's own undo/redo question, restated for
  tooling): should a tooling-slider change be restorable via the global Ctrl+Z at all? §3 recommends "no — editor
  undo owns it, consistent with the SE4c heightfield-only ruling" but this is Fred/advisor's call, not an
  implementation detail — flag before this slice starts, same as SE4c flagged its equivalent.
- `setStampLayerEnabled` deleted from `core/state.js`. `MIGRATIONS['legacy-stamp-svg']` extended with the
  `enabled`→`visible` copy. `core/history.js`'s `layerConfigs` capture and `main/snapshot-manager.js`'s
  restore comment/behavior rewritten per the resolved undo/redo question. `main/stamp/layer.js`'s two
  `.enabled`-fallback branches narrowed to the pre-load-only window. `main/stamp-mask-manager.js`'s dead
  `?? lLayer` fallback deleted. `main/stamp/_dom-binders.js`'s redundant double-write simplified.
- Predicted files: `core/state.js`, `main/app-init.js`, `core/history.js`, `main/snapshot-manager.js`,
  `main/stamp/layer.js`, `main/stamp-mask-manager.js`, `main/stamp/_dom-binders.js`, plus
  `tests/persistable-p.test.js`, `tests/history-snapshot.test.js`, `tests/migrations.test.js` (10 files, several
  test-only). Verify: `npx vitest run` green; grep `setStampLayerEnabled` → 0 hits repo-wide; grep
  `P\.stampLayers\[.*\]\.(depth|profile|angle|blur|enabled|smoothing|suppression|edgeFilletRadius|filletPower|tx|ty|rotation|scale|mirrorX|mirrorY)\s*=`
  → 0 hits (no more WRITES to tooling fields on `P.stampLayers`, reads from the narrowed pre-load fallback are
  expected and fine); a migration test loading an old-shaped save with `stampLayers[0].enabled=false` and
  asserting the synthesized roster's `visible` comes back `false`; live proof (opening a project saved before
  this slice still shows the right enabled/disabled layers) is the advisor's.

## Risks / STOP conditions

- **`export-flow.js`'s rewrite (slice b) is again the one change with no existing dual-path to fall back on** —
  SE4a flagged this exact function for the exact same reason; ship it alone, verify it alone, exactly as SE4a
  did, before touching cloud-project-manager or the tests in the same slice.
- **`tests/export-flow.test.js` is simultaneously a guard for SA-LAYER-1's own fix and the file most disrupted
  by it.** Every fixture in the file needs its shape changed in the same commit that changes what
  `_stampExportCandidates` reads — a partial rewrite (some fixtures updated, some not) would produce green tests
  that no longer test the real code path. Rewrite the whole file in slice (b), not incrementally.
- **The undo/redo scope decision (§3, §5c) blocks slice (c) from starting** — same STOP shape as SE4c's own open
  question, and for the same reason: guessing wrong here means re-touching `history.js`/`snapshot-manager.js` a
  second time.
- **Multi-layer legacy projects.** The `legacy-stamp-svg` migration's `enabled`→`visible` extension (§4) inherits
  SE4's own already-flagged limitation (`editorRestoreSvg`'s single-legacy-layer assumption) — not made worse by
  this change, but not fixed by it either; re-run whatever multi-layer migration test SE4c's slice (c) adds
  (per that doc's own STOP list) after this migration extension lands, not just a single-layer case.
- **Reorder/delete-in-middle** (SA-LAYER-1 finding #3) is **not fixed by this design** — moving tooling off
  `P.stampLayers` removes the POSITION-MISMATCH failure mode entirely (there's only one array left, indexed by
  the editor's own layer objects, not two arrays that can drift apart), so this STOP condition is actually
  resolved as a side effect of single-storing, not something the slices need to separately guard — but re-run
  a reorder-then-export test after slice (b) to confirm that's true in practice, not just in theory.

## Appendix — grep count for the verify step

`grep -rn "stampLayers" bspline-frame-builder/b-spline-gen/html/{core,main,editor} --include=*.js` → **41** hits,
plus the same under `tests/` → **48** hits — **89 total**, across `core/state.js`, `core/history.js`,
`core/engine/rebuild.js` (comment only), `editor/layers.js` (comments only), `main/app-init.js`,
`main/cloud-project-manager.js`, `main/export-flow.js`, `main/snapshot-manager.js`, `main/stamp/layer.js`,
`main/stamp/_shared.js`, `main/stamp/svg-source.js`, `main/stamp-mask-manager.js`, `tests/editor-reopen.test.js`,
`tests/export-flow.test.js`, `tests/history-snapshot.test.js`, `tests/migrations.test.js`,
`tests/persistable-p.test.js`, `tests/stamp-mask-clear.test.js`. Every row in §1's table traces back to one or
more of these hits; comment-only / already-unaffected hits (`rebuild.js`, `editor/layers.js`,
`editor-io.js`'s `_PERSISTED_LAYER_FIELDS`, which doesn't itself mention "stampLayers" by name) are addressed
collectively in §1/§3 rather than tabled one by one.
