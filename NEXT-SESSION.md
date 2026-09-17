# NEXT — HY4: doors with no rooms — the sketch palette's dead debug sends, one dead editor function, five over-exports

**Ball: worker (seat A) · epoch 1 · HY4.** Files: `bspline-frame-builder/frame-builder/ui/html/sketch_builder_palette.html`,
`bspline-frame-builder/b-spline-gen/html/editor/dom.js`, `editor/editor-ui.js`, `editor/editor-text-session.js`,
`editor/layers.js`. One commit by path, predicted **5 files**. No behaviour changes — every item removes something
nothing consumes, or narrows an export nothing imports.

## Ground truth (advisor-verified, current tree)
- `sketch_builder_palette.html`: 10 `notifyFusion(...)` sends with NO Python receiver (the dispatcher in
  `sketch_builder_ui.py` has no branch for any of them; audit A5b §4 + FB2 design §4): `update_phase` (`:382`) and
  nine `debug_*` sends (`:517`, `:533`, `:548-550`, `:553`, `:576`, `:596`, `:606`) — the latter belong to one
  dev-instrumentation block that installs mutation/resize/focus observers and a periodic watcher on the template
  `<select>` (roughly `:505-607`; read the enclosing function to find its exact start/end). Nothing else reads what
  it produces.
- `b-spline-gen/html/editor/dom.js:45` `createButton` — 0 references anywhere (not even inside dom.js).
- Five functions exported but used only inside their own file: `dismissExpandCallout` (`editor-ui.js`),
  `initTextSession` (`editor-text-session.js`), `removeLayer`, `renameLayer`, `reorderLayer` (`layers.js`). 0 external
  importers each (grep across `html/`, dist excluded).

## Do
1. `sketch_builder_palette.html`: delete the entire debug-instrumentation block (all nine `debug_*` sends, their
   observers, the periodic timer, and the `installed…` notice) and the `update_phase` send at `:382` (keep the local
   `_phaseCurrent` state it was reporting). If a helper exists only to serve that block, delete it too (retiree's own
   machinery). Sweep: `grep -c "notifyFusion('debug_\|notifyFusion('update_phase'"` → 0; the remaining sends must be
   exactly `update_param update_lock change_template request_template_list run_build` (5).
2. `dom.js`: delete `createButton`.
3. The five over-exports: drop the `export` keyword (keep the functions). Grep each name across `html/` afterwards →
   only its own file.

## Verify
- Extract the palette's `<script>` (as E7c did) and `node --check` it; `node --check` the four editor files.
- `npx vitest run` → 29.
- `git show --stat HEAD` → 5 files, deletions only (plus the five `export` removals).
- Fusion look is the ADVISOR's (open Sketch Builder, change template, build once — the dispatcher's five live actions).

## Do NOT
Touch `sketch_builder_ui.py` (its `ping`/`get_templates` branches are harmless doors; leave them), the scaffold, or any
other palette.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "HY4: sketch palette debug block + update_phase removed (<n> lines), createButton deleted, 5 exports narrowed — <sha>, 5 files; sends = 5 live; vitest 29. Next: advisor's call (decision sheet)."`
and stop.
