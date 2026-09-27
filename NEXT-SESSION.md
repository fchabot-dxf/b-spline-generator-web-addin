# NEXT — seat A, regular add-in — H6: CONTEXT-MENU (tap-and-hold / right-click, a declared action registry)

**Ball: worker (seat A) · epoch 3 · H6.** H5 MULTI-SELECT ACCEPTED (aaf13ef; desktop + mobile CDP, 15 checks). NO FUSION.
Spec: ROADMAP.md "CONTEXT-MENU" (incl. Move to layer: PLAIN elements only, HIDDEN for lattice pieces). Reuse H5's
declared timings (MULTISELECT_HOLD_MS etc.) and gesture module; plain HOLD (single press, still) = menu, double-tap-and-
hold stays multi-select, a move = drag. The SE16 cut tool is MERGED (a626e8f): register its exposed cutAt/join commands
as menu entries (✂ Cut here / Join), don't reimplement. PROGRESS automatic ("H6 item N: …"); push each item; shots.

## Checklist
- [ ] [H6-item-1] ONE declared registry {id, label, icon, appliesTo(kind|'empty'), when(state), run(editor, target)}; the menu shows
      the matching entries for the held element (or empty canvas); tap-and-hold on touch, right-click on desktop; the
      browser's own contextmenu suppressed on the canvas only.
- [ ] [H6-item-2] Entries (each = the EXISTING command, one undo step, acts on the whole selection when the held piece is in it):
      Colour… · ✂ Cut here (lines) · Join (on a joint) · Duplicate · Select all <kind> · ⇄ Move to layer ▸ (layers + New
      layer…; plain elements only) · Delete; empty canvas: Paste (when clipboard has content) · Select all · Fit view.
- [ ] [H6-item-3] Tests (registry filtering per kind/empty/multi, each action == its command, undo, hold vs double-tap-hold vs drag,
      Move-to-layer hidden for lattice pieces) + desktop + mobile CDP repro + shots of the menu on a rail, a plain line,
      and empty canvas.
Commit by path, `git pull --rebase`, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 3 — H6 — <shas>"`.
