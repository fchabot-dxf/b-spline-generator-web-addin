# LANE B — T27: the layer row, FINAL (Fred settled it) — one consolidated spec replacing amends 6–8

**Seat B · epoch 2 · T27.** T26 (1606e49 + 400fe05) ACCEPTED as a checkpoint — thank you for stopping; eight redesigns
of one row inside a turn was the advisor's pacing failure, not yours. Fred has now confirmed the row ("makes sense",
"looks great"). This is the WHOLE target — build from here, ignore amends 2–8 as history.
Seat A is on SE11 (drape) in `core/preview/*` + a new drape module and READS your fields `visible`, `carve`,
`showColor` with the rule below — keep those three names. One commit by path.

## The row: 👁 · 3D · palette   (three toggles, all real buttons, aria-pressed, 44 px on coarse pointers)
| field | toggle | default | meaning |
|---|---|---|---|
| `visible` | 👁 | true | MASTER. Off → the layer is off everywhere: hidden in the editor, not carved, not draped, not exported. `carve`/`showColor` keep their values. |
| `carve` | "3D" | true | Carved into the relief (= its presence in the 3D model). There is NO separate `drape3d` — drop that field, its toggle and its migration step (keep the `layer-carve-flag` migration). |
| `showColor` | palette icon (inline SVG paint palette, same style as the row's other icons — not a square) | true | Element colors shown in the editor canvas (display-only; off = neutral) and, with 3D, painted on the mesh (seat A). Never disabled. |
Effective rules — rewire every gate to these, one helper each, declared once (e.g. in `editor/layers.js`):
`isCarved(l) = l.visible !== false && l.carve !== false` → masks (`stamp-mask-manager.js`), heightfield (`rebuild.js`),
`isCarvingLayer` (`export-flow.js`); `isExported(l) = l.visible !== false` → Fusion sketch (`hasShippableSvg`) + SVG
download; `showsColor(l) = l.visible !== false && l.showColor !== false` → editor canvas coloring. (Seat A's drape uses
`isCarved(l) && l.showColor !== false`.) Replace the per-site conditions with these helpers so the rule lives in one
place.
## Verify
Truth-table test over the three fields for isCarved / isExported / showsColor; hidden layer with 3D on → no mask;
toggling 👁 back on restores carve/showColor unchanged; old doc migration unchanged. Smoke (repo-root serve): sidebar +
editor lists, desktop + mobile. `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T27: layer row final — 👁 master, 3D=carve, palette showColor, isCarved/isExported/showsColor helpers — <sha>, vitest N"`
and stop.
