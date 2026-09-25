# NEXT — MOB2: mobile pass on today's features (Fred: "make sure it's mobile friendly")

**Ball: worker (seat A) · epoch 2 · MOB2.** NO FUSION — browser proof only. SE7j reviewed (408c076, 659 green, pushed →
Cloudflare deploys main automatically). Seat B is on T40 (text outlines) in lane-b — stay out of editor-expand-* /
editor-outline-preview.js.

## Found by the advisor on LIVE pages.dev at 390x844 touch (screenshot: generate works, pinch works)
1. The floating undo/redo pill (T32, pointer:coarse) sits ON TOP of the editor's Layers panel header, covering
   "LAYERS" and its + button. Keep it floating bottom-left of the CANVAS, never over panels (anchor it to the canvas
   container, or lift/avoid the Layers panel).
2. Editor header overflows: Cancel is clipped and **Apply Stencils is off-screen** — the one commit action must always
   be visible on a phone (priority order / wrap / overflow menu for Download SVG + Clear).
3. The editor's Layers panel is squeezed into a thin strip between the canvas and the Pattern sheet — give it usable
   height (collapsible section, or share the bottom sheet with the Pattern panel as tabs).
4. Also check and fix on phone: the Pattern panel's Widths row (it already overflows on DESKTOP — the "Nodes" stepper
   is clipped at the right), the rail-end checkbox, the sidebar layer row (3D / palette toggles ≥ 32px touch target),
   the Fusion Geometry segmented control, and the connected-lattice drags with touch (touchStart/Move/End).
Declare breakpoints/touch sizes where they already live (INPUT_PROFILE / the existing pointer:coarse rules) — no new
parallel mechanism.

## Verify
- CDP at 390x844 (touch) and 768x1024: before/after screenshots of editor (lattice generated) and the sidebar Vector
  Stamping section; assert Apply Stencils is inside the viewport, the pill doesn't intersect the Layers panel rect,
  every toggle ≥ 32px; a touch drag of a rail stretches its tie.
- Desktop unchanged (one 1400x900 screenshot).
- `npx vitest run` green.

## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "MOB2: mobile pass — <sha>, vitest N, screenshots: <paths>"`
and stop.
