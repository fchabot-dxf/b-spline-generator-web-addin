# NEXT — seat A — H11: HANDLE-REACH — frame Hip + Shoulder handles reach the TRUE limit (Generate keeps its band)

**Ball: worker (seat A) · epoch 3 · H11.** H10 ACCEPTED (45d1f07). Spec: ROADMAP.md "HANDLE-REACH" (Fred: "shouldn't the handle and
geometry allow the handle to go further and make the arc wider" -> "hip and shoulder" -> "we can keep the limit on generate, but
allow me to tweak it"). These are seat C's frame files (frame-handles.js, feasibleParamRanges in editor-shape-lattice-generator.js,
FRAME_MIN_OPENING_IN, FRAME-GEN's band); seat C is stood down, so they're yours for this task. Seat B works only in core/noise.
NO FUSION needed unless a live parity check is required (then ask me for a window). PROGRESS automatic ("H11 item N: …").

## Checklist
- [ ] [H11-item-1] MEASURE (state the numbers in the WORK-LOG): for T1 Shoulder and Hip (and T2's handles), which bound stops a manual
      drag today: F5 feasibleParamRanges (tangency/validity), F13 FRAME_MIN_OPENING_IN, or FRAME-GEN's 0.1..0.9 band.
- [ ] [H11-item-2] Manual drags clamp ONLY to the REAL limits (simple + tangent outline, opening >= the minimum, computed exactly, not
      conservatively); the 0.1..0.9 band applies to Generate ONLY. If a REAL limit is what stops the arc widening, report what a
      wider arc would need (e.g. the waist arc re-solving along with it) instead of forcing it.
- [ ] [H11-item-3] Tests: Hip + Shoulder reach the true limit; just beyond it the outline is invalid (proven); Generate stays banded;
      the F5/F13 sweeps stay green; a real-input drag repro (desktop + touch) showing the wider arc. Shots before/after.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H11 — <shas>"`.
