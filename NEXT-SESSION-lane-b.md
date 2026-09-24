# LANE B — T15: build SE5 slice (b) — export-flow + cloud-project-manager on editor layers (fixes "only layer 1 carves")

**Seat B · epoch 1 · T15.** Worktree, branch `lane-b` (merged with main). T14 / SE5a (527ade1) reviewed and ACCEPTED,
but it is **held on lane-b, not merged**: on its own it regresses Browse-into-layer-2/3 export (the auto-enable now
writes `visible`, export still reads `P.stampLayers[idx].enabled` — your own note). Slices (a)+(b) merge to main
together. Files: `main/export-flow.js`, `main/cloud-project-manager.js`, `tests/export-flow.test.js` (+ WORK-LOG).
Seat A is on SE8a in `editor/` — do not touch `editor/`. One commit by path.

## Do slice (b) exactly as your design §5(b) + Risks says
- `_stampExportCandidates` / `isCarvingLayer` / `hasShippableSvg`: every tooling field (enabled→`visible !== false`,
  depth, profile, …) from `editor._layers[idx]`; content as today (`_mask`, `getLayerSvg`). No `P.stampLayers` read.
- `cloud-project-manager.js`: the `.enabled` read your inventory found → editor layer `visible`.
- `tests/export-flow.test.js`: rewrite the WHOLE file's fixtures to the single-store shape in this commit (your own
  STOP condition — no partial rewrite). Must include: a 4-layer editor with layer 4 visible + content → exported;
  layer 2 drawn directly (no Browse, no `P.stampLayers` entry touched) → exported; a hidden layer → not exported;
  reorder then export → tooling follows the layer object, not the index.
- Browse-into-layer-2 end to end: import → `visible` true → counts as exportable (the regression SE5a opened).

## Verify
`npx vitest run` green (count); greps: `stampLayers` in `main/export-flow.js` → 0; `.enabled` in
cloud-project-manager.js → 0 (or a named survivor with its reason). `git show --stat HEAD` → ≤ 4 files + log.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T15: SE5b — export-flow + cloud PM on editor layers — <sha>, N files, vitest N"`
and stop.
