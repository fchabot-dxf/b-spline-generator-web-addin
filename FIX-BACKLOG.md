# FIX-BACKLOG — b-spline-generator-web-addin

> **Planning only** (T4). Synthesizes T2 bugs (`BUGS_OPEN.md` B1–B11) + T3 standards
> (`STANDARDS-AUDIT.md` dims 1–6) into a ranked, sequenced fix plan. This BECOMES
> the fix-phase ROADMAP — but the fix loop is a **separate, human-blessed cycle**;
> nothing here is actioned yet. Each item has a **verifiable success criterion** and
> its **source** (B# / audit dim). Ordered so foundational fixes land first.

## ⛔ Decision required before sequencing — editor dedup vs. fix-twice

B1, B3, and **B6 (data-loss)** all live in `…/editor/`, which is **forked** into
`b-spline-gen/html/editor/` and `stamp-editor/html/editor/` (B8 / audit §1a: 33
files, 11 already drifted). The bug-bearing files (`editor-io.js`, `editor.js`,
`editor-interaction.js`, `layers.js`, `editor-expand-shape.js`) are currently
**byte-identical** across both trees. So any editor fix must be resolved one way:

```
 A · DEDUP FIRST                        B · FIX FIRST  (recommended)
 collapse to one editor tree, then      patch B6 into BOTH copies now (identical
 every future editor fix lands once     files → same patch), dedup as its own project
 ─ large, risky refactor: must first    ─ data-loss fix (B6) ships immediately
   reconcile 11 DRIFTED files BEFORE    ─ "apply twice" cost is trivial while the
   the urgent B6 data-loss fix            files are still identical
 ─ delays B6 behind the refactor        ─ dedup debt persists until F7 lands
```

**Recommendation: B (fix first).** The fix-twice cost *today* is trivial (the bug
files are byte-identical — literally the same patch), whereas dedup (F7) is a large
refactor that must reconcile 11 drifted files first; sequencing it ahead parks an
urgent data-loss fix behind a risky refactor. Dedup still happens — as F7, not as a
gate. **Advisor/human: confirm A or B before the fix loop starts.** The phases below
assume **B**; under **A**, F7 moves ahead of F2/F5 and they each become one-copy edits.

## Ranked backlog (effort × impact)

| ID | Fix | Source | Impact | Effort | Phase |
|----|-----|--------|--------|--------|-------|
| **F1** | Wire or remove `import_svg_sketches` "Send to Fusion" | B4 | High (dead user feature + false success log) | S–M | P0 |
| **F2** | Stop hidden-layer geometry loss on save | B6 | High (silent data loss) | M | P0 |
| **F3** | Detach fusion-inspector `activeSelectionChanged` in stop() | B5 | High (leak compounds per reload) | S | P0 |
| **F4** | Add `selection_items` to `_force_wipe` list | B7 | Med (stale hot-reload) | XS (1 line) | P0 |
| **F5** | Confirm B1/B3 in the Fusion host (draw/undo/expand-line) | B1,B3 | Med (verify "likely-fixed") | S | P0 |
| **F6** | Route host calls through `fusion-bridge.js` (+ its own leaf `fusLog`) | B9,B11 | Med (seam integrity) | S–M | P1 |
| **F7** | **De-fork the editor tree** (one canonical `editor/`) | B8, §1a | High (kills fix-twice tax) | L | P1 |
| **F8** | De-duplicate the 2 drifted Python modules | §1b | Med | M | P1 |
| **F9** | Narrow bare `except:` → typed + log (non-cleanup paths) | §4 | Med (unmask failures) | L (incremental) | P2 |
| **F10** | Symmetric CAM-builder CustomEvent teardown | B10 | Low | S | P2 |
| **F11** | Test harness + CI (pytest.ini + workflow; vitest for `core/`) | §2 | High (regression net) | M | P2 |
| **F12** | Repo hygiene: rm+ignore 6 cruft files; README doc-drift | §3 | Med | S | P2 |
| **F13** | Deploy: retire/align `deploy_worker.py` orphan; de-hardcode paths | §5 | Med (repro) | M | P2 |
| **F14** | Deps: drop orphaned `opentype.js`+`clipper-lib`; add CDN SRI | §6 | Low–Med (supply chain) | S | P2 |
| **F15** | Optional: git history rewrite for the 36 MB zip bloat | §3 | Low | M | P3 |
| **F16** | Decide fate of unbuilt cloud pieces (step-editor worker/pages) | §3,§5 | Low | — (decision) | P3 |

## Sequenced phases — with success criteria

### P0 — Correctness (data-loss / misleading behaviour) — do first, mostly small
- **F1 · `import_svg_sketches`** (B4). Either add a `PaletteHTMLEventHandler`
  branch in `b-spline-gen.py` that builds sketches from the payload, **or** remove
  the `editorSendToFusion` button + its false `[SendToFusion] sent N` log.
  ✅ *Success:* clicking "Send to Fusion" in Fusion either creates the sketches, or
  the button no longer exists — and no success log fires when nothing was received.
- **F2 · hidden-layer data-loss** (B6). Split the concerns conflated on the
  `visible` flag in `editor-io.js:_visibleContent`: the hidden-layer **drop** must
  apply only to the stamp-to-Fusion geometry path, **not** to persisted `save()`.
  ✅ *Success:* hide a layer → save → reopen → toggle it visible → the geometry
  returns. *(Depends on the fork decision — under B, patch both editor copies.)*
- **F3 · inspector leak** (B5). In `frame-inspector/fusion-inspector.py:stop()`
  add `ui.activeSelectionChanged.remove(sel_handler)` + `_handlers.clear()`.
  ✅ *Success:* after 3 Stop→Start cycles, exactly one `_push_selection_to_palette`
  fires per selection change (verify by log count).
- **F4 · `selection_items` wipe** (B7). Add `'selection_items'` to
  `_shared_project_names` (`bspline-frame-builder.py:243-250`).
  ✅ *Success:* edit `selection_items.py`, Stop→Start, the edit takes effect with no
  Fusion restart. *(One-line; do alongside F3.)*
- **F5 · confirm B1/B3** (runtime). Draw 4 discrete strokes → 4 Ctrl+Z should undo
  one each; draw a `<line>` → Expand should thicken it.
  ✅ *Success:* both behave per spec in the Fusion CEF host (or a fresh bug is filed).

### P1 — Structural (unblocks cheap future work) — gated by the fork decision
- **F6 · seam integrity** (B9, B11). Add `getDesignParams()` / `sendSvgSketches()`
  senders to `fusion-bridge.js` and call them from `main.js`/`app-init.js`; extract
  `fusLog` into a leaf module (`core/fus-log.js`) imported by bridge + `coords.js` +
  `state.js` (breaks the current circular-import block).
  ✅ *Success:* `grep 'adsk\.' html --include=*.js` shows hits **only** in
  `fusion-bridge.js`; `fusLog` defined once. *(F6's bridge sender also completes F1's
  JS side.)*
- **F7 · de-fork editor** (B8). Collapse `stamp-editor/html/editor/` onto
  `b-spline-gen/html/editor/` — reconcile the 11 drifted files first, then one
  canonical tree (shared import or copy-at-build, mirroring the `dist/` model).
  ✅ *Success:* only one `editor/` source tree exists; `diff -rq` finds no second
  copy; both palettes load from it. *(Large — see the fork; under A this leads P1.)*
- **F8 · de-dup Python modules** (§1b). Reconcile the two drifted copies of
  `expression_coords.py` / `entity_helpers.py` into one shared package both
  frame-inspector and template-maker import (retires part of the `_force_wipe` need).
  ✅ *Success:* one copy of each module; both palettes green on their tests.

### P2 — Standards / hygiene (broad, lower per-item risk)
- **F9 · error handling** (§4). Convert bare `except:` → `except Exception:` and
  `log` instead of `pass` on **non-cleanup** paths, worst offenders first
  (`exporter.py` 36, `fusion-inspector.py` 18). Leave idiomatic teardown `except`s.
  ✅ *Success:* bare-`except:` count in business-logic files → 0; failures now leave
  a log line. *(Incremental — one file per PR.)*
- **F10 · CAM teardown** (B10). Unregister `TPGEN`+`AXISPICK` CustomEvents in
  `cam-builder.py:stop()` too. ✅ *Success:* all 3 unregistered symmetrically.
- **F11 · tests + CI** (§2). Add `pytest.ini`, a CI workflow running the 16 existing
  tests, and a vitest suite for pure `core/` logic (`stepWriter`, `bspline-math`,
  `coords`, noise). ✅ *Success:* CI runs green on push and fails on a seeded regression.
- **F12 · repo hygiene** (§3). `git rm` + gitignore the 6 tracked cruft files
  (`diff_*.txt`, `*.err`, `sync_stamp_bundle.py.tmp`, `*.old`, `index.js.bak`); fix
  `b-spline-gen/README.md` doc-drift (`fusion-hybrid.py`/`deploy_hybrid.py`,
  100 KB→256 KB). ✅ *Success:* `git ls-files` shows no log/diff/tmp/bak; README
  matches source.
- **F13 · deploy repro** (§5). Delete or realign `deploy_worker.py` (the
  `bspline-presets` orphan + KV under-bind); replace the 5 hardcoded `C:\Users\danse`
  paths with env/`__file__`/config. ✅ *Success:* one worker deploy path that matches
  `wrangler.toml`; no absolute machine paths in the scripts.
- **F14 · deps/secrets** (§6). Drop `opentype.js` + `clipper-lib` from
  `package.json` (both orphaned); add SRI hashes to the cdnjs `<script>` tags;
  keep `.env` ignored (rotate the live Cloudflare/GitHub tokens only if this tree
  was ever shared). ✅ *Success:* every `package.json` dep is imported somewhere;
  pinned CDN scripts carry `integrity=`.

### P3 — Optional / decisions
- **F15 · zip history bloat** (§3, corrected). Optional `git filter-repo`/BFG to
  purge the 14 historical 20–36 MB zip blobs. LOW urgency (already ignored going
  forward). ✅ *Success:* repo pack shrinks; zip absent from history.
- **F16 · unbuilt cloud** (§3,§5). Decide: build out or delete
  `cloud/step-editor-worker` (placeholder KV) + `cloud/step-editor-pages`
  (README-only). ✅ *Success:* each is either provisioned+deployed or removed.

## Cross-reference

T2 bugs → fixes: B1/B3→F5 · B2→(resolved, real path is B6)→F2 · B4→F1 · B5→F3 ·
B6→F2 · B7→F4 · B8→F7 · B9→F6 · B10→F10 · B11→F6.
T3 dims → fixes: §1a→F7 · §1b→F8 · §2→F11 · §3→F12/F15/F16 · §4→F9 · §5→F13 · §6→F14.
