# LANE B (audit seat) — A2: audit `frame-builder/` (the parametric frame engine + its two palettes). READ-ONLY.

**Seat B · epoch 1 · A2.** Same rules as A1 (edit ONLY `AUDIT-2026-09.md` + lane-b `WORK-LOG.md`, commit by path on
`lane-b`, evidence or UNVERIFIED, lens = ROADMAP principles + north-star gate, declared row format, per-add-in
"Inefficiencies" subsection, "What's GOOD", "What I could not verify"). Append an **"A2 — frame-builder"** section
to the existing doc; do not rewrite A1.

**A1 review (advisor):** accepted as written. Answer to one of your open items: the AddIns inspector folder is clean
because the advisor deleted `payload_builder.py`/`selection_items.py` there by hand after E7a — the overlay gap (A1-6)
is real and still unguarded.

## A2 scope (this turn only) — `bspline-frame-builder/frame-builder/` (~9.5k lines)
1. `fb_engine/` — the parametric engine (`parametric_engine.py`, `build_context.py`, `parameter_schema.py`,
   `diagnostics.py`, …). Look hardest at: the phase pipeline and `isComputeDeferred` windows (a sketch left
   deferred = silent wrong geometry); `create_or_update_param` / user-parameter lifecycle (E8 just moved
   `frame_tilt_deg` creation to palette-open — is any OTHER param still created inside a command Execute?);
   `_get_tilt_plane` reuse-by-name; any attribute stamping that can go stale on rebuild.
2. `ui/sketch_builder_ui.py` + `ui/solid_builder_ui.py` + their `html/` palettes — lifecycle symmetry (what
   `run_palette` registers vs what the parent's `_teardown_submodules` releases: handlers, `DocumentActivated`
   subscription, palettes), duplicated logic between the two builders that should be ONE declaration, the
   `frame_engine` injection contract (`if frame_engine:` guards — can it be None in practice?).
3. **Honesty sweep** for this folder: comments/docstrings that describe a state that is no longer true (E8 removed the
   undo-transaction wrappers; C4 moved shared modules) — quote each.
4. **Tests:** what covers this folder? (`tests/`, `template-maker/tests` conftest stubs) — name the gap concretely.

Do NOT run Fusion or mutate any design; `fusion_execute` is off-limits in this lane. Static read + grep + py_compile.

## When done
Append lane-b WORK-LOG, commit by path, then FROM THIS FOLDER:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "A2 frame-builder audit: <n> findings (<H/M/L>), <m> reconciled, <sha>. Next: A3 template-maker."`
and stop.
