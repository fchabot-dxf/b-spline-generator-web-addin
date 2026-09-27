# NEXT — seat A — H16: unsaved-changes shown ON the Save (disk) button, not a lone dot

**Ball: worker (seat A) · epoch 3 · H16.** H15 ACCEPTED (c185d7e). NO FUSION. Fred (phone, pointing at "‹ •" in the header): "what is the
point [dot] for?" -> "it should be signalled by the save (disk) button". The "‹" is the apploader's launcher button (fred-host.js,
injected: not ours, leave it). The "•" is #dirty-dot (main/cloud-project-manager.js ~l.177). PROGRESS: commit subjects "H16 item N: …".

## Checklist
- [ ] [H16-item-1] (Fred: "no, just a colour vs grey") The Save (disk) icon is in its normal COLOUR when there are unsaved changes and
      GREYED (like disabled Redo) when saved; still clickable; title "Save" / "Saved". One source of truth: the dirty flag
      cloud-project-manager already tracks. No badge dot.
- [ ] [H16-item-2] REMOVE #dirty-dot from the header (a removal: no orphan CSS/ids/tests; rewrite any test that checked it to check the Save
      badge instead). Keep #fmCurrentFileLabel as is.
- [ ] [H16-item-3] Tests (dirty -> badge on, save -> off, load -> off) + shots at 390 + 1366 (dirty and clean).
- [ ] [H16-item-4] SEED OFFSET back in the SKELETON section (Fred: 'the seed offset could be surfaced in skeleton if it was removed'): Offset X / Offset Y (screens) as the H14 side-by-side SLIDER pair (value readout), bound to the SAME P keys seedOffsetX / seedOffsetY that H15 kept (no new params; saved projects unchanged). Place it next to Peak Shape / Density (which H15 moved there). Rotation stays removed unless Fred asks. Test: moving it pans the terrain like before; a saved project's offsets show in the sliders. Shots at 390 + 834.
- [ ] [H16-item-5] REGION SCALE back, in the FILTER section with the seed offset (Fred: yes): a 'Map' group at the top of Filter: Region Scale (slider + value, bound to the EXISTING P key macroScale that H15 kept) above the Offset X / Offset Y slider pair (H16 item 4, which Fred moved to FILTER, not Skeleton). No new params; saved projects unchanged. Test: Region Scale zooms the underlying map as before; saved values show. Shots at 390 + 834.
- [ ] [H17-item-1] MAP ZOOM: a NEW slider in Filter's 'Map' group (keep Region Scale untouched). Fred: 'add it in filters, not replace region'. A drawing-style zoom of the whole generated terrain: bigger value = bigger features; scales EVERYTHING the noise draws (coarse shapes, fine texture, detail/cluster masks) together, about the BOARD CENTRE, so the map looks like the same drawing enlarged. Implement once, at the (u,v) entry of the terrain sampler (u' = 0.5 + (u-0.5)/zoom, same for v) so every layer inherits it; seed Offset X/Y stays 'screens' at the zoomed size. Does NOT scale user stamps/sculpt, frame, edge fade or the board. New app P key (e.g. mapZoom, default 1 = today's terrain exactly, range ~0.25..4, slider + value); no new Fusion params. Tests: zoom=1 heightmap identical to before; zoom=2 centre sample equals zoom=1 centre; a feature at u=0.75 at zoom 1 appears at u=1.0 at zoom 2 (with symmetry off). Shots: same seed at zoom 0.5 / 1 / 2 (390) to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H17 item 1: ...'.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H16 — <shas>"`.
