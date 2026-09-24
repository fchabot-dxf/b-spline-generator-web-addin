# LANE B — T13: SE5 design — one home for per-layer tooling (fixes SA-LAYER-1/2/3). PLAN ONLY, no code.

**Seat B · epoch 1 · T13.** Worktree, branch `lane-b` (merged with main). Deliverable: NEW `SE5-TOOLING-STORE-DESIGN.md`
at the worktree root (+ WORK-LOG-lane-b.md). One commit by path. Seat A is on SE8a (path layout / bake / undo in
`editor/`) — you only read.

## Why (your own audit, advisor-confirmed)
SA-LAYER-1: export reads each editor layer's tooling from `P.stampLayers[idx]` (`main/export-flow.js:30-36`), a fixed
3-entry list (`core/state.js:110`), with layers 2/3 defaulting `enabled:false` and layer 4+ reading `{}` — so a lattice
drawn on three layers (rails / ties / nodes, the way Fred works) exports only layer 1. SA-LAYER-2: `updateP`'s mirror
write is gated behind the same 3 entries — sliders are a placebo past layer 3. SA-LAYER-3: `isFilletActive` reads it
too. Meanwhile the editor layers ALREADY carry the same tooling (`editor/layers.js` TOOLING_DEFAULTS,
`_PERSISTED_LAYER_FIELDS` in `data-editor-layers`). Two stores for one fact — the SE4 lesson, second instance
(ROADMAP "SE5 — tooling double-persistence").

## Write the plan (same shape as SE4-MIRROR-RETIREMENT-DESIGN.md — reuse its section layout)
1. **Inventory** every reader and writer of tooling fields on `P.stampLayers[i]` and on `editor._layers[i]` (depth,
   profile, angle, blur, enabled, smoothing, suppression, edgeFilletRadius, filletPower, tx, ty, rotation, scale,
   mirrorX, mirrorY, name, id) — sidebar sliders (`core/state.js` updateP / layerSpecific), export-flow, rebuild /
   compositor, stamp-mask-manager, isFilletActive, project save/load, snapshot/undo, MIGRATIONS. Table with file:line,
   read/write, which store.
2. **Single-store proposal:** the editor layer is the home (it is saved inside the document and survives reopen);
   `P.stampLayers` stops holding tooling. How the sidebar edits the ACTIVE editor layer; what undo/redo does with a
   tooling change (the global undo is heightfield-only by ruling SE4c — decide where a slider change's undo lives and
   say why); what happens when the editor is not yet initialised at boot (the SE4a timing finding).
3. **Migration as data:** a second `MIGRATIONS` entry that moves legacy `P.stampLayers[i]` tooling into the document's
   `data-editor-layers` roster once; idempotent; multi-layer.
4. **Removal chain** — every link removed or kept with a named reason (incl. tests that assert the mirror).
5. **Slices** with predicted files and a verify line each; STOP conditions (hidden layers, reorder, delete-in-middle,
   cloud projects saved before the change, the web app vs the add-in).
6. One section answering: **does anything outside b-spline-gen read `P.stampLayers`** (Python side of the add-in,
   presets worker, cloud project JSON)? grep the whole repo.

## Verify
The doc exists, inventory row count matches a grep count you quote, each slice has a verify line.
`git show --stat HEAD` → the doc + WORK-LOG-lane-b.md.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T13: SE5 tooling-store design — N readers/writers, K slices, <sha>"`
and stop.
