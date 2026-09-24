# NEXT — SE11b: the drape does not appear in Fusion's palette — find out why, fix it, prove it THERE

**Ball: worker (seat A) · epoch 2 · SE11b.** SE11 (8d66076) is deployed to the add-in (build fdc9a18). Seat B is on T27
(layer row: `visible`/`carve`/`showColor` + helpers `isCarved`/`isExported`/`showsColor` in `editor/layers.js`) — not yours.
One commit by path.

## Advisor's live test in Fusion (bridge up) — evidence in `smoke-out/se11-4.png`, `smoke-out/se11-crop.png` (git-ignored)
Picked the red swatch, drew an L (horizontal stroke + vertical stroke, top-left of the board), Apply. Result in the
palette's 3D view: the L is CARVED correctly (groove along the back-left — orientation right) but **no red on the
mesh** (12 red-ish pixels sampled in the whole 3D view, i.e. none). The add-in log (`bspline-frame-builder/b-spline-gen/
b_spline_gen_log.txt`, fusLog) shows the stamp raster of both red paths and the mesh preview send — and NOTHING from
the drape (it logs nothing, so ran / skipped / failed is indistinguishable).
Your headless 'drape' smoke reported red/yellow in `renderedFrameColors` but its screenshots are black — a headless
WebGL capture artefact, so the browser run never visibly proved the drape either.
## Do
1. Instrument `refreshDrape` (`main/app-init.js:250`) with `fusLog('[DRAPE] …')`: called? qualifying layers/elements
   count, svg length, texture w×h, `setDrapeTexture` reached, material that received the map (type + whether it uses
   `map`), any caught error. Deploy (stop add-in → `python release.py --local` → run; the ritual is in ROADMAP /
   earlier WORK-LOG turns — `m.stop(None)` / `m.run(None)` via `fusion_execute`), repeat the advisor's L test, read the
   log.
2. Likely suspects to check, in order: the preview mesh's material ignores `map` (vertex colors / custom shader /
   MeshStandard without `map` re-set after `update()` rebuilds geometry); the texture is applied but `needsUpdate`/
   `colorSpace` wrong; `buildDrapeTexture`'s image load (blob:/data: SVG into an Image) is blocked or silently fails in
   Fusion's embedded browser; `refreshDrape` never fires on the Apply path in the palette.
3. Fix the real cause; keep the logs behind a `DRAPE` debug category (off by default) once it works.
4. Prove it IN FUSION: screenshot of the palette's 3D view with the red L visible on the relief (PowerShell window
   capture — see `scratchpad`-style `shot.ps1` usage in earlier WORK-LOG turns, or `fusion_screenshot` if it captures
   the palette). Put the path in the pass note.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE11b: drape visible in Fusion — cause: <…> — <sha>, screenshot: <path>"`
and stop.
