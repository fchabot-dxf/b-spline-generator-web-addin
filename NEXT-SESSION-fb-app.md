# NEXT (fb-app) — F23: HANDLE-REACH — frame Hip + Shoulder handles reach the TRUE limit (Generate keeps its band)

**Ball: worker (seat C) · epoch 2 · F23.** You're back on (Fred: "can't C pick up some?"); your own frame code. Spec: ROADMAP.md
"HANDLE-REACH" (Fred, iPad, Frame tab, Hourglass: "shouldn't the handle and geometry allow the handle to go further and make the
arc wider" -> "hip and shoulder" -> "we can keep the limit on generate, but allow me to tweak it"). Seat A does only a sidebar
stepper layout fix (HTML/CSS) right now; seat B works only in core/noise. NO FUSION unless a live parity check needs it (ask me).
PROGRESS automatic ("F23 item N: …"); shots -> shots\seatC\; push each item. Deploy rule: only from a clean worktree.

## Checklist
- [ ] [F23-item-1] MEASURE (numbers in the WORK-LOG): for T1 Shoulder + Hip (and T2's handles), which bound stops a manual drag:
      F5 feasibleParamRanges (tangency/validity), F13 FRAME_MIN_OPENING_IN, or your FRAME-GEN 0.1..0.9 band.
- [ ] [F23-item-2] Manual drags clamp ONLY to the REAL limits (simple + tangent outline, opening >= min, computed exactly, not
      conservatively); the band applies to Generate ONLY. If a REAL limit stops the arc widening, report what a wider arc would
      need (e.g. the waist arc re-solving with it) instead of forcing it.
- [ ] [F23-item-3] Tests: Hip + Shoulder reach the true limit; just beyond it the outline is invalid (proven); Generate stays banded;
      F5/F13 sweeps green; real-input drag repro (desktop + touch) showing the wider arc; seeds still reach Fusion (F11 parity
      holds at the new extremes: live check if the solve changed). Shots before/after.
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 2 — F23 — <shas>"`.
