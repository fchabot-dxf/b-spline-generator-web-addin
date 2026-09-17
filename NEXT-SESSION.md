# LANE B (audit seat) — A3: audit `template-maker/` (~8.2k lines). READ-ONLY.

**Seat B · epoch 1 · A3.** Same rules as A1/A2. Append an **"A3 — template-maker"** section to `AUDIT-2026-09.md`.

**A2 review (advisor):** accepted. A2-1 (params created inside Execute beyond the tilt) is being verified live by the
advisor; A2-3 (deferred-compute window with no `finally`) goes to seat A as a declared context manager; A2-2/A2-5 fold
into that task; A2-4 (duplicated hidden-command machinery) is queued design-first. Good catch on the design doc's scope.

## A3 scope — `bspline-frame-builder/template-maker/`
1. `template-maker.py` (entry, lifecycle: what `run()` registers vs `stop()` releases; the `_PROJECT_MODULES` /
   `_reload_all_project_modules` dynamic-import machinery that bit C4-S4b — is it still needed now that fb_shared is
   canonical? enumerate what it wipes and whether each name still exists).
2. `core/` — `template_generator.py`, `template_payload_builder.py`, `template_payload.py`, `coincidence_clusters.py`,
   `relation_hints.py`, `ownership_gate.py`, `detection_log.py`, `check_addin_sync.py`. Look for: hand-rolled
   tables that should be declarations; N² loops over entities (real sketches have hundreds); repeated Fusion API
   calls inside loops (each `.geometry`/`.attributes` call crosses the COM boundary — count re-reads of the same
   entity); logic duplicated with `fb_shared`; `check_addin_sync.py` — is it live or dead?
3. `ui/template_maker_palette.html` — declared vs hand-rolled rendering; doorless handlers.
4. `tests/` — it HAS a suite (83 green today). Which of the above modules does it actually cover, and which findings
   land in untested code?

Do NOT run Fusion. Static read + grep + `pytest template-maker/tests -q` (read-only run is fine).

## When done
Append lane-b WORK-LOG, commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A3 template-maker audit: <n> findings (<H/M/L>), <m> reconciled, <sha>. Next: A4 stamp-editor."`
and stop.
