# NEXT — IN2: finish the inspector de-dup for real — delete its 10 inline duplicates, import from fb_shared

**Ball: worker (seat A) · epoch 1 · IN2.** File: ONLY `bspline-frame-builder/frame-inspector/fusion-inspector.py`.
One commit by path, predicted **1 file, ~−250 lines, +3 import lines**. Do NOT edit `fb_shared/` this turn.

## Ground truth (advisor-verified by AST diff, 2026-09-17)
C4-S3 (`2483753`) "switched frame-inspector to fb_shared" — it changed ONE import line and deleted two sibling files.
`fusion-inspector.py` still defines **10 functions that also exist in `fb_shared`**, 8 of them DIVERGENT (stale
pre-merge copies; `fb_shared` is the S1/S2 canonical merge that the tests validate). The inspector's live selection
readout runs on the LOCAL copies. Two sources of truth = the defect class this project keeps paying for.

| local def (line) | shared home | status | note |
|---|---|---|---|
| `get_fb_name` :53 | `fb_shared.entity_helpers` | divergent | shared also honours the `ID` attribute + first-line split |
| `get_fb_bridge` :75 · `get_fb_plan` :86 | entity_helpers | divergent | only the `_get_native` refactor |
| `_get_entity_key` :216 · `format_point` :229 | entity_helpers | identical | |
| `_get_arc_midpoint` :236 | entity_helpers | divergent | shared = evaluator + legacy fallback (superset) |
| `get_fb_metadata` :332 | entity_helpers | divergent | shared derives from `get_fb_metadata_fields` (E7b) |
| `entity_fingerprint` :358 | entity_helpers | divergent | `_get_native` only |
| `get_entity_coord` :365 | entity_helpers | divergent | shared handles circle/ellipse/spline; returns `Point: (x, y)` — local returns `<name>: (x, y)` |
| `get_entity_coord_expr` :397 | `fb_shared.expression_coords` | divergent | shared = `_build_entity_coord_expr_string` (S2, test-validated); signature `(ent, params=None)` |

**Advisor ruling on the one visible change:** the point line drops its `<name>: ` prefix and reads `Point: (x, y)`.
Accepted — the name is already the section title (`mainFeature`) and the first token of every list entry.

## Do
1. Replace the import at :23 with the full set:
   `from fb_shared.entity_helpers import get_fb_name, get_fb_bridge, get_fb_plan, _get_entity_key, format_point, _get_arc_midpoint, get_fb_metadata, get_fb_metadata_fields, entity_fingerprint, get_entity_coord`
   `from fb_shared.expression_coords import get_design_params, get_entity_coord_expr`
   (drop any name from that list that turns out to have 0 call sites after step 2 — e.g. `_get_entity_key` has 0 today).
2. Delete the 10 local definitions listed above (whole functions incl. their docstrings/comments).
3. **Retiree's own machinery dies with it:** `get_design_dimensions` :269, `format_expr_component` :289,
   `format_point_expr` :311, `get_fb_attribute` :322 exist to serve the local `get_entity_coord_expr`. After step 2,
   grep each: **0 surviving callers → delete it; ≥1 (e.g. from `get_fb_connections`) → keep it and say so** in the
   commit message ("kept: used by get_fb_connections"). `get_fb_connections` :96 has no shared equivalent — it STAYS.
4. Call sites keep working unchanged (`get_entity_coord(e)`, `get_entity_coord_expr(e)` both match the shared
   signatures). Do not rename anything else.
5. **STOP condition:** if a shared function lacks a behaviour the inspector's `_push_selection_to_palette` needs (e.g. a
   key it reads that the shared version never emits), do not patch it locally and do not edit `fb_shared` — stop, pass
   back with the exact gap, and the advisor decides.

## Verify (fast tier)
- `python -m py_compile bspline-frame-builder/frame-inspector/fusion-inspector.py`.
- Duplicate sweep (must print NO `DUP` lines) — run from `bspline-frame-builder/`:
  ```
  python - <<'EOF'
  import ast
  def names(p): return {n.name for n in ast.parse(open(p,encoding='utf-8').read()).body if isinstance(n, ast.FunctionDef)}
  a = names('frame-inspector/fusion-inspector.py'); s = names('fb_shared/entity_helpers.py') | names('fb_shared/expression_coords.py')
  print("DUP", sorted(a & s)) if a & s else print("clean")
  EOF
  ```
- `grep -c "^def " fusion-inspector.py` → 21 today; report the new count.
- `python -m pytest bspline-frame-builder/template-maker/tests -q` → 83 (fb_shared untouched, so unchanged).
- `git show --stat HEAD` → 1 file.
- Fusion look is the ADVISOR's (deploy + screenshot after the human stops the add-in).

## Do NOT
Edit `fb_shared/`, the palette HTML, `frame-builder/`, or the exporter. Don't add wrappers/aliases "for safety".

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "IN2: inspector inline duplicates retired — <n> defs deleted (<kept: list or none>), imports from fb_shared; dup sweep clean; def count 21→<k>; pytest 83. <sha>, 1 file. Next: E7c."`
and stop.
