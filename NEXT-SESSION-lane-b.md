# NEXT (lane-b) — T58: SE14 Slice 3 — the Shape Lattice TOOL (its own full turn)

**Ball: worker (seat B) · epoch 2 · T58.** NO FUSION. T57 part 1 merged (ties spread — render viewed, good).

## Mobile layout ruling (Fred, final): NO control tiers
"The UI can be below the preview still, scrollable, and the preview can have a drag handle." → the Shape Lattice
panel lives in the existing MOB3 drawer/panel below the canvas: ALL controls present, the panel scrolls, the splitter
sets the split. Use collapsible sections like the box Lattice (seat A's MOB3b). Ignore the earlier CONTROL_TIERS
amend. Per-segment style: tapping a segment on the canvas opens a small floating straight|curve|kink bar (the list can
stay in the panel too).

## Build SE14 §10 Slice 3 per the design + recorded decisions
Own rail icon + TOOL_PANELS entry; Shape section: preset [Hourglass | Bottle] + 🎲 + the preset's sliders;
per-side-segment style; AXIS-LOCKED PARAMETRIC HANDLES on canvas for the preset's independent params ("Slice 3 editing
model"); Fill section = the box Lattice's controls (T56 counts, T57 spread, Widths, Colors, Ending, Border) reused, not
retyped; Generate. The box # Lattice loses its Boundary row; old boundary layers are handed to Shape Lattice (settings
kept). Detach on hand node-edit (recompute-and-compare). Output = ordinary path + fill.
Verify live (CDP): pick Hourglass → Generate → screenshot desktop + 390x844; drag the waist handle → still tangent
(sampled tangent-continuity on the live path) → screenshot; tap a segment → kink → screenshot; switch to Bottle →
screenshot; hand node-edit → detached; Outline export → no new decline kinds. VIEW every screenshot.
If the whole slice can't land cleanly, split at a coherent line (e.g. tool + presets + fill first, handles next) and
say so.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T58: Shape Lattice tool — <sha>, vitest N, screenshots"`
and stop.
