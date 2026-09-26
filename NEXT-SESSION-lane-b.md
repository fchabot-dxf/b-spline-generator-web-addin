# NEXT (lane-b) — T75: LAT-SIZE + OVR-FUSION + hide "Rail ends" while the contour is shown

**Ball: worker (seat B) · epoch 4 · T75.** NO FUSION. T74 accepted (merge + live test by the advisor). Specs: ROADMAP.md on
main — "LAT-SIZE" and "OVR-FUSION" entries. PROGRESS is automatic: start each work-commit subject with the item's tag
words (e.g. "T75 item 2: …"), one tag per item.

## Checklist
- [ ] [T75-item-1] LAT-SIZE app: "Size" row (width × height) in BOTH lattice panels, default board − 1 in, centred; the value
      is the OUTSIDE size (T74 AMEND 2 rule); contour + lattice regenerate at that size; saved patterns without size
      read the default.
- [ ] [T75-item-2] LAT-SIZE Fusion: the Size values → contour_width / contour_height param VALUES (dims unchanged:
      size − stroke_width); box Lattice fill area = the Size (decide whether it exports size dims; log it).
- [ ] [T75-item-3] OVR-FUSION: seat A's UI4 writes per-piece data-override-color / data-override-width (on main soon —
      pull/merge main first; if not there yet, build against the declared attribute names). Manifest: an overridden
      width → that slot's width dim is a HARDCODED value (no param, no stroke_width expr); colour → per-piece colour.
- [ ] [T75-item-4] Shape Lattice: hide the "Rail ends (contour off only)" row while the Contour checkbox is ON; show it
      when OFF (derived from the checkbox, not a second flag).
- [ ] [T75-item-5] Tests: parity + sweep cover a non-default Size; override width → hardcoded dim; rail-ends visibility.
Pass back: `cd <lane-b worktree> && python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 4 — T75 — <shas>"`.
