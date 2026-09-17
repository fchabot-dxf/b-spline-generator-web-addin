# LANE B (audit seat) — A6: audit `CAM-builder/` (~8.9k lines, confirmed LIVE in A1). READ-ONLY.

**Seat B · epoch 1 · A6.** Same rules. Append an **"A6 — CAM-builder"** section.

**A5b review (advisor):** accepted. B6 closed on your evidence. A5b-1 (import progress dead sends) becomes a seat-A
task (wire the listener to the palette's existing status affordance). A5b-5's label: advisor traced history.
Named P1 exception (`window.fusionJavaScriptHandler` inline) will be documented in ROADMAP as such.

## A6 scope — `bspline-frame-builder/CAM-builder/`
1. **B10 (BUGS_OPEN):** `stop()` unregisters 1 of 3 CustomEvents — still true? Name each event registered in `run()`
   (file:line) and whether `stop()` releases it. Lifecycle symmetry overall (handlers, palette, panels, events).
2. Entry + engine (`cam-builder.py`, `cam_engine`, `cam_utils` — the names the parent wipes at
   `bspline-frame-builder.py` `_bootstrap`): duplication with `fb_shared` or with frame-builder's engine (toolpath /
   geometry helpers reimplemented?); hand-rolled tables (tool libraries, feeds/speeds, post-processor strings) that
   should be declarations; dead functions (0 callers); honesty (comments describing a pre-consolidation standalone
   add-in).
3. Palette HTML/JS: doorless handlers both directions (`fusionSendData` actions vs the Python dispatcher;
   `sendInfoToHTML` events vs JS listeners) — the sweep that found A5a-5/A5b-1.
4. **Cross-sub bare-name collisions** — the question that decides the parent's `_shared_project_names` fate: does
   CAM-builder import any bare module name that ALSO exists under another sub-add-in (template-maker/core, frame-builder,
   stamp-editor)? List collisions (name → both paths). None = the parent list can be retired; some = it must stay/derive.
5. Inefficiencies: toolpath generation loops (O(n²) over points?), repeated Fusion COM reads in loops.
6. Tests: any? (A1 saw none for CAM-builder.)

Do NOT run Fusion. Static read + grep + py_compile.

## When done
Append lane-b WORK-LOG, commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A6 CAM-builder: <n> findings (<H/M/L>), B10 <status>, bare-name collisions <k>, <sha>. Next: A7 cloud workers."`
and stop.
