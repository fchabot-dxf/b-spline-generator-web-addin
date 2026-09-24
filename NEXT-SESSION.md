# NEXT — SE11e: the drape shows TRUE colors (black included) — overlay, not emissive

**Ball: worker (seat A) · epoch 2 · SE11e.** SE11d (5b58a4a) removed the skip but, as you flagged, black is still invisible:
the drape is an emissiveMap, which ADDS light — black adds zero. Fred asked for black lines on the mesh. Seat B is on
T28 (color mosaic: `editor/properties-shape.js`, palette toolbar COLOR group, `styles/editor.css`) — not yours.
One commit by path.
## Build
Render the drape as its own layer that shows the texture's real color with alpha: a second mesh sharing the terrain
geometry (same position/uv buffers — no copy) with `MeshBasicMaterial({ map: drapeTexture, transparent: true,
depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })`, added with the terrain and
rebuilt/disposed wherever the terrain mesh is (follow `update()`). The canvas texture must keep transparency where
nothing is drawn (clear to transparent, not white). Remove the emissiveMap path (one mechanism only). Keep flipY = true
and the SE11c uv guard test green. Lighting: basic material = unlit, so colors read exactly as picked (Fred's "for
simulation" intent).
## Verify
Tests: drape texture is transparent where empty; the overlay mesh shares the terrain geometry. Live in Fusion (bridge up):
a BLACK L and a RED L side by side — both visible, exactly on their carved grooves; screenshot path in the pass note.
`npx vitest run` green.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE11e: drape as unlit alpha overlay — black visible — <sha>, vitest N, screenshot: <path>"`
and stop.
