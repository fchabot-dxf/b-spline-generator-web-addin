# First-Send drift: what moves the terrain (seat P, 2026-10-22) -- measured, nothing fixed

Question (advisor): in the seed live check, a Send's later STEP differed from the first one by ~0.001 in on the
terrain points although the seed was the same. Is a SAVED board changed by a Send?

## Answer: no. A Send writes only `boardId`. The drift was the Pull.

Headless real palette (stub `adsk`, Math.random seeded), Clean-STEP hash (4 header lines dropped):

| step | result |
|---|---|
| fresh board, Send, Send, Send (no other action) | same Clean hash x3 (`x1_repeat_sends.js`) |
| state before vs after the first Send | only `P.boardId` changes (null -> minted id). `frame`, `editorSvg`, `activeLayerIdx`, layers, terrain: identical |
| terrain built straight from `lastResult`, before Send vs after Send | identical (`x3a_save.js`) |
| save (session store), reload, terrain + Send again | identical to before the reload (`x3b_reload.js`) |

## What moved the terrain: Pull, not Send

`onSketchPulled` (main/pull-sketch.js) imports the pulled curves UNCONDITIONALLY, before the change-list dialog:
it adds the layer "Fusion Sketch" (a carving layer) and writes its paths. Measured (`x4_pull_cancel.js`):

- a Pull reply is delivered, the dialog is only OPEN: layers `["Layer 1","Fusion Sketch"]`, `editorSvg` changed
  (0 -> 7425 chars), one carving stamp layer, terrain hash changed;
- Cancel: nothing is undone -- the layer and the changed terrain stay;
- the extra "Stamped" variant that showed up in later Sends is that carving layer.

Apply's own rows do NOT move the terrain: the Send taken in the Cancelled state and the Send taken after Apply have the
same Clean and Stamped hashes (`x5_pull_apply.js`). On a board whose frame record has `params: {}`, Apply writes
`frame_thickness 0.75` and `boundingboxoffset 0.25` into it (shown as "(none) -> 0.75/0.25" rows); the frame record
changes, the terrain does not. Whether those two numbers equal the template defaults (a row that restates a default)
was not measured.

## So

- "Saved board changes because of a Send": NOT reproducible; no regression, no failing test.
- Seed: a seed-only Pull is not affected -- the Seed row reads and applies cleanly. But any Pull (seed or not) also
  leaves the "Fusion Sketch" carving layer, even on Cancel. That is step (a)'s documented "curves unconditional"
  behaviour, and it contradicts the dialog's "nothing changes until Apply". Not changed; a decision for Fred
  (import the layer only on Apply? import it with carving off? leave as is?).

Repro: `node tools/repro/first_send_drift/cdp.mjs start`, then `eval helpers.js`, then `eval x*.js`
(`reload` re-injects the stub; `x4`/`x5` embed a real Fusion Pull reply).
