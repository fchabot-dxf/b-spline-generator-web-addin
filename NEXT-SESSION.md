# LANE B (audit seat) — A5a: audit `b-spline-gen/html/core/` + `main/` (the app's state, engine and managers). READ-ONLY.

**Seat B · epoch 1 · A5a.** Same rules as A1-A4. Append an **"A5a — b-spline-gen core+main"** section. b-spline-gen is
23k lines, so it is split: A5a = `core/` + `main/` (+ `b-spline-gen.py`); A5b (next turn) = `editor/` + the palette
HTML + `index.html`. The `node_modules` gap in this worktree is known — static only, do not `npm install` here.

**A4 review (advisor):** accepted. Drift check done from the main checkout (result recorded in ROADMAP). Your
stampLayers map is the C5 input; the "strip .mask ×3" observation is in scope THIS turn (below).

## A5a scope — `bspline-frame-builder/b-spline-gen/html/core/`, `main/`, `b-spline-gen.py`
1. **P1 (one frontend, two hosts):** host-specific branches must live ONLY in `core/fusion-bridge.js`. Grep `main/` and
   `core/` for `isFusion`, `adsk`, `window.fusion`, `fusionSendData`, `location.host` outside that file — every hit is a
   P1 violation; list them.
2. **Declared vs hand-rolled:** the three "strip `.mask` before persisting" loops (`main/cloud-preset-manager.js:23-24`,
   `main/cloud-project-manager.js:64-65,669`, `main/preset-manager.js:54-55`) — confirm they are the same shape and name
   the one declared serializer they should become. Then look for the same class elsewhere: parallel if/else ladders
   encoding a table, duplicated literals (ids, storage keys, API paths) that should be one declaration.
3. **Dead code:** `main/preset-manager.js` and `main/cloud-preset-manager.js` — the Project Manager's own header says it
   "replaces both". Are they still imported/loaded (grep `main.js`, `app-init.js`, the palette HTML `<script type=module>`
   graph)? If not, they are two dead modules + a dead localStorage migration. Also: exported functions with 0 importers
   across `html/` (list them with file:line).
4. **State + undo:** `core/state.js` (the `P` object) and `core/history.js` — what gets snapshotted, what does not (a
   field that changes but is not in the snapshot = undo silently skips it). B1/B3 in BUGS_OPEN.md concern undo; reconcile.
5. **B6 (hidden-layer data loss, `core/state.js:253-254`)** — still present? state it plainly with the line.
6. **`b-spline-gen.py`** — lifecycle symmetry, dispatcher vs JS actions both directions (the palette HTML is A5b, but the
   `sendToPython`/`fusionSendData` action strings in `main/` are yours).
7. **Inefficiencies:** rebuild cost — does every slider tick rebuild the whole mesh (`core/engine/rebuild.js`)? Any
   O(n²) over points/layers? Repeated JSON clone of `P` per keystroke?
8. **Tests:** the 4 vitest files import `core/state.js`, `editor/editor-coords.js`, `main/stamp/_shared.js`,
   `main/app-init.js`, `main/stamp/svg-source.js` — which findings above land in tested vs untested code.

## When done
Append lane-b WORK-LOG, commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A5a b-spline-gen core+main: <n> findings (<H/M/L>), P1 violations <k>, dead modules <list>, B1/B3/B6 status, <sha>. Next: A5b editor+palette."`
and stop.
