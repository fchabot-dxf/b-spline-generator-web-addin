# LANE B — T26: SE10 — a real layer browser in the sidebar, sharing ONE list component with the editor

**Seat B · epoch 2 · T26.** T24 (f979d7b) ACCEPTED — held on lane-b until seat A passes SE9 (colors: editor modal
toolbar region of the palette, `editor/editor.js`, `editor/properties-shape.js`); advisor verified it live (canvas keeps
its space, sheet + readable Regenerate, pinch 1→4→16). Fred's ask (screenshot): the VECTOR STAMPING sidebar's "Active
Layer" dropdown (`#stampActiveLayer`, palette :624) + "On" checkbox (`#stampLayerEnabled`, :629) → "a more developed
layer browser, with visibility setting". Files: the palette's VECTOR STAMPING region (:590–:660), `editor/layers.js`,
`main/stamp/layer.js`, `styles/editor.css` (or base.css if the sidebar styles live there), tests (+ WORK-LOG-lane-b.md).
Stay out of the editor modal's toolbar region and `editor/editor.js` / `properties-shape.js` (seat A). One commit by path.

## Build — declare ONE layer list, render it twice
- Extract the row rendering from `renderLayersPanel(editor)` (`editor/layers.js:303`) into
  `renderLayerList(container, editor, { compact })` — same rows, same handlers (select → `setActiveLayer`, eye →
  `setLayerVisible`, add, rename, delete, reorder as the editor already does) — and call it for BOTH
  `#editorLayersList` and a new `#stampLayersList` in the sidebar. No second implementation.
- Sidebar row: eye (visible = carved — SE5 made `visible` the only switch), active marker, name, and a short tooling
  summary read from the editor layer (`V .25"`, `ball .12"` — profile + depth), "+" to add. Tapping a row makes it
  active; the existing Plunge Depth / Tool Profile / V-Bit Angle controls keep editing the ACTIVE layer. 44 px rows on
  coarse pointers, no hover-only affordances (delete visible on touch — T16's rule).
- Remove `#stampActiveLayer` + `#stampLayerEnabled` and their wiring (removal chain: markup → `main/stamp/layer.js`
  handlers → any `syncFromLayer` readers → tests). If the editor isn't initialised yet at boot, the list renders once it
  is (hook the same point the sidebar currently refreshes from).
- Both lists refresh on the same layer-change event (declare one `onLayersChanged` notify if none exists) so the
  sidebar and the editor never disagree.
## Verify
Tests: renderLayerList renders one row per layer with the right visibility/active state; toggling the eye in one list
updates the other. Smoke (serve from the REPO ROOT): desktop + mobile screenshots of the sidebar list after Generate
(4 layers). `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T26: SE10 sidebar layer browser, shared renderLayerList — <sha>, vitest N, screenshots: <paths>"`
and stop.
