# LANE B — T10: show the shortcut letter on each tool button — derived from `data-key`, CSS only

**Seat B · epoch 1 · T10.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b`. Files:
`bspline-frame-builder/styles/editor.css` (where `.tool-btn` lives — confirm with grep; if it is in base.css, use that)
(+ WORK-LOG-lane-b.md). Predicted **1 file** + log. Seat A is in `main/` + `core/engine/` — no overlap.

## Why
SE1 declared the shortcut on the button (`data-key="v"` …, 9 buttons in the modal rail). The tooltip shows it only on
hover. A small key badge on the button makes the shortcuts discoverable, and the declaration already carries the
text — no JS, no second list.

## Build
- One rule set, no markup change:
  `.tool-btn[data-key] { position: relative; }`
  `.tool-btn[data-key]::after { content: attr(data-key); position: absolute; right: 2px; bottom: 1px;
   font: 600 8px/1 system-ui, sans-serif; text-transform: uppercase; color: currentColor; opacity: .55;
   pointer-events: none; }`
  `.tool-btn.active[data-key]::after { opacity: .9; }`
- Check the rail width (44 px, buttons ~32 px) so the badge does not collide with the icon: if it does, drop the
  badge to `font-size: 7px` rather than moving it.
- `data-key="0"` (Fit) shows "0" — fine.

## Verify
- Grep: `attr(data-key)` → 1. No other file changes. Look is the ADVISOR's (deploy + capture).

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T10: data-key badge via CSS attr() — <sha>, 1 file"`
and stop.
