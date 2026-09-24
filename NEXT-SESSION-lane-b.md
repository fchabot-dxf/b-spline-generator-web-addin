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

## AMEND (Fred, 2026-09-24) — TWO switches per layer: SHOW and CARVE (supersedes "eye = visible = carved")
Fred's answers: a layer can be shown/exported without being carved, and carved while hidden. Declare it on the
editor layer (the SE5 tooling home):
- `visible` = SHOW: editor canvas, the 3D preview's vector overlay (seat A builds that next — read `visible`), and BOTH
  vector exports (Fusion sketch via `exportableStampLayers`/`hasShippableSvg`, and the SVG download).
- NEW `carve` (boolean, default true) = CARVE: mask generation and the heightfield. Repoint every "visible means
  carved" read to `carve !== false`: `main/stamp-mask-manager.js:52`, `core/engine/rebuild.js:211`, and the CARVING
  half of `main/export-flow.js:64` (`isCarvingLayer`) — `hasShippableSvg` keeps reading `visible`. Grep for any other
  `visible === false` used as "don't carve" and list each in WORK-LOG.
- Persist `carve` in `_PERSISTED_LAYER_FIELDS` (it must survive save/reopen). Migration as data: a `MIGRATIONS` entry
  `layer-carve-flag` that sets `carve = (visible !== false)` on every roster layer missing it — old documents carve
  exactly as before.
- Row: 👁 show toggle + ⛏ carve toggle (both 44 px on coarse pointers, both real buttons, `aria-pressed`), name, tool +
  depth; a not-carved row shows its tool summary dimmed.
- SVG download (`editorDownload`, `tools/action-tools.js:32`): export only SHOWN layers; if the modal has no button for
  it (`#editorDownload` count in the palette markup is reported below), add one "Download SVG" next to Apply Stencils'
  row — ONE line of markup in the header, tell the advisor where (seat A edits the toolbar row, not the header).
- Tests: carve false + visible true → no mask for that layer, still in `exportableStampLayers`; visible false + carve
  true → masked/carved, not exported, not in the SVG download; migration sets carve from visible once, idempotent.

## AMEND 2 (Fred) — a per-layer "3D" tag: drape this layer's colored vectors on the 3D mesh
- New editor-layer field `drape3d` (boolean, default false), persisted in `_PERSISTED_LAYER_FIELDS` (migration: none —
  missing = false). It is a TAG, toggled ONLY in the SVG editor's Layers panel (a small "3D" pill per row,
  `aria-pressed`, 44 px on coarse pointers). The SIDEBAR list shows it as a non-interactive "3D" badge — Fred does
  not want another sidebar toggle. So `renderLayerList(container, editor, { compact })` gets the pill only when not
  compact, the badge when compact.
- Seat A builds the actual drape (SE11) and will read `layer.drape3d && layer.visible !== false`. You only add the field,
  the pill, the badge, persistence, and a test (toggle in the editor list → field true → sidebar row shows the badge).

## AMEND 3 (Fred) — the 3D tag has THREE states: off / plain / color
`drape3d: 'off' | 'plain' | 'color'` (default 'off'; a stored boolean true from an earlier build reads as 'color').
Declare the states once (`DRAPE_MODES = ['off', 'plain', 'color']`); the editor pill cycles through them (labels: empty,
"3D", "3D■"); the sidebar badge shows "3D" / "3D■" or nothing. 'plain' = draped in one neutral line color, ignoring
element colors; 'color' = each element's own SE9 color. Seat A renders; you store/cycle/show.

## AMEND 4 (Fred) — supersedes amends 2 and 3: TWO real toggles, in BOTH lists (sidebar included)
- Fields: `drape3d` (boolean, default false) and `drapeColor` (boolean, default true). A stored string from amend 3
  migrates: 'off'→false, 'plain'→{true, drapeColor:false}, 'color'→{true, true}. No DRAPE_MODES tri-state, no badge.
- Row (the ONE shared `renderLayerList`, same in the sidebar and the editor's Layers panel — no compact-only badge):
  👁 show · ⛏ carve · 3D · ■ color — all four real toggles (`aria-pressed`, 44 px on coarse pointers). The ■ toggle is
  disabled (greyed, not hidden) while 3D is off.
- Seat A renders: drape3d && visible → draped; drapeColor ? element colors : one neutral line color.
