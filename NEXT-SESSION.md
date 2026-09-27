# NEXT — seat A, regular add-in — H7: context-menu polish (small)

**Ball: worker (seat A) · epoch 3 · H7.** H6 CONTEXT-MENU ACCEPTED (168d59e; advisor re-ran context_menu_shots.mjs desktop +
mobile: ALL CHECKS PASSED; full suite 1899). NO FUSION. Your H6 shots never reached shots\seatA\ (the advisor ran the
script with outPrefix = C:\Users\danse\.bspline-status\shots\seatA\h6_ctxmenu_*): always save there. PROGRESS automatic
("H7 item N: …").

## Checklist
- [ ] [H7-item-1] "Cut here" shows TWO scissors (the entry icon + a ✂ inside the label): the label is text only; one icon per entry.
- [ ] [H7-item-2] Labels don't line up (icons of different widths): a fixed-width icon column so every label starts at the same x
      (desktop + mobile).
- [ ] [H7-item-3] Re-run context_menu_shots.mjs into shots\seatA\ (desktop + mobile); tests unchanged/green.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H7 — <shas>"`.
