# LANE B — T29: sidebar layer list — move it up, show full names (Fred approved the mockup)

**Seat B · epoch 2 · T29.** Small layout turn. Seat A is on SE11f in `core/preview/drape-svg.js` only. Files: the palette's
VECTOR STAMPING region, `styles/editor.css` (compact row styles), `editor/layers.js` ONLY for the compact row markup if
needed (renderLayerList stays the one shared function). One commit by path.
## Target (approved)
```
 ▼ VECTOR STAMPING
   [ Open SVG Editor 🎨 ]
   LAYERS                         +
   👁 3D 🎨  Layer 1        V .25"   ← selected
   👁 3D 🎨  Rails          V .15"
   ─────────────────────────────────
   Plunge Depth / Tool Profile / V-Bit Angle   (for the selected layer)
```
- Layers block right under "Open SVG Editor", ABOVE the tool settings (they apply to the selected layer — say so in a
  one-line hint under the divider if it fits).
- Full layer names: name gets the flexible width (`min-width:0; flex:1`, ellipsis only as a last resort), tool summary
  right-aligned; at narrow widths (≤ 360 px sidebar or coarse pointer) the tool summary wraps to a second line instead
  of truncating the name.
- The editor's list is unchanged (compact:false).
## Verify
Smoke (repo-root serve): sidebar screenshot desktop + mobile with 4 layers after Generate — names fully readable.
`npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T29: sidebar layers moved up, full names — <sha>, screenshots: <paths>"`
and stop.
