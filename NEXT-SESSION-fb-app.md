# NEXT (fb-app) — F7: S3 — the 3D preview trims the panel to the frame + bars in wood

**Ball: worker (seat C) · epoch 1 · F7.** F6 ACCEPTED (9173fbd, 197f8d8), being merged to main. NO FUSION. Fred owns
the regular add-in (main, other machine): keep palette/editor edits small and additive, push often. Spec: FB-APP-DESIGN.md
§3.4 + §3.5 + stage row S3. PROGRESS automatic ("F7 item N: …"). Shots → shots\seatC\.

## Checklist
- [ ] [F7-item-1] 3D preview: with a frame chosen, the panel is TRIMMED to the frame's cut profile (the SAME outline
      source as F6's editor profile and the Fusion build), live on param change; "none" = today's untrimmed panel.
- [ ] [F7-item-2] The frame bars as a straight-extruded solid (no taper) from "Frame bottom (z)" up to the panel
      underside, in the chosen wood (declared list -> material/colour), live on wood change.
- [ ] [F7-item-3] F6 leftovers: grid / snap / fit-to-view follow the frame outline in the editor (AMEND 1).
- [ ] [F7-item-4] Tests (outline shared by editor + 3D + build: one source; trimmed mesh inside the outline; no frame =
      unchanged) + §3.5 shots: 3D trimmed panel + bars, T1 + T2, desktop + mobile; live-update proof (frame_thickness,
      wood) without a reload.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F7 — <shas>"`.
