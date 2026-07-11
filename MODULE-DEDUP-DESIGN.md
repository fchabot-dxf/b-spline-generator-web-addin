# Module de-dup design (C4 / F8) — MAP + PROPOSE

Design doc only. **No code, no Fusion** this turn — implementation waits for a human
Fusion Stop→Start (the collision + hot-reload behaviour only manifests inside Fusion).
Prepared by the worker (turn 63); for advisor review.

## 1. Confirmed dup surface

Two modules ship as **drifted copies under the same bare name** in two sibling palettes:

| module | copy A | copy B | drift |
|---|---|---|---|
| `expression_coords.py` | `frame-inspector/` (308 ln) | `template-maker/core/` (325 ln) | 426 diff lines |
| `entity_helpers.py`    | `frame-inspector/` (231 ln) | `template-maker/core/` (203 ln) | 291 diff lines |

(`frame-inspector/payload_builder.py` vs `template-maker/core/template_payload_builder.py`
are **differently named** → no bare-name collision; not part of this de-dup. The other 18
names in `_shared_project_names` are template-maker-only or frame-inspector-only — see §5.)

### Why it hurts (the machinery it feeds)
`bspline-frame-builder.py:_bootstrap()` loads every sub-add-in with a bare-name import
resolved via `sys.path.insert(0, <own folder>)`. Python caches by **bare name**
(`sys.modules['entity_helpers']`), so loading frame-inspector then template-maker would bind
the second to the **first's** cached copy. The current workaround
(`bspline-frame-builder.py:243-266`) is to `_force_wipe(_shared_project_names)` — **20 names,
3× per bootstrap** (before fusion-exporter, fusion-inspector, template-maker) — so each sub
re-imports its own copy fresh. That dance is the tax this de-dup retires.

## 2. Drift analysis — the copies have GENUINELY diverged (not cosmetic)

`expression_coords` — **template-maker's is the richer API superset**, but not a strict one:
- template-maker threads a `params` arg everywhere (`_infer_coord_expr(coord, axis, params)`,
  `_format_point_expr(pt, params)`, `get_entity_coord_expr(ent, params=None)`), plus
  `_spline_fit_points`, `_format_scalar_expr`, `_get_point_name`, `_get_scope` (template-gen
  features). `get_entity_coord_expr(ent, params=None)` is **backward-compatible** with
  frame-inspector's `get_entity_coord_expr(ent)`.
- frame-inspector-ONLY functions that template-maker lacks: `get_entity_name`,
  `format_design_params`, `_get_design`, `_get_design_parameter`, and a LOCAL
  `_get_arc_midpoint` (angle-bisector).

`entity_helpers` — **frame-inspector's is the richer/correct superset**:
- frame-inspector has `_get_arc_midpoint_via_evaluator` (the RELIABLE method) + a
  `_get_arc_midpoint_legacy` (angle-bisector) + an `_get_arc_midpoint` dispatcher, plus
  `get_fb_bridge`, `get_fb_plan`, `entity_fingerprint`, `_get_entity_key`.
- template-maker's is a 6-function subset (`_get_native`, `get_fb_name`, `get_fb_metadata`,
  `format_point`, `get_entity_coord`, `_get_arc_midpoint`) and template-maker's
  `expression_coords` imports `_get_arc_midpoint` FROM it.

**Semantic conflict flagged (the key risk):** the arc-midpoint. frame-inspector migrated to the
evaluator method (correct for semicircles — cross-product-0 ambiguity); template-maker's
`entity_helpers._get_arc_midpoint` is the older angle-bisector. The 3-4 truly shared functions
(`get_fb_name`, `get_entity_coord`, `get_fb_metadata`, `get_design_params`) also differ in body
(that's most of the 700 diff lines) and need a **function-by-function semantic review** before
merge — this is where implementation must GATE, not guess.

### Canonical + reconciliation (proposed)
Not "pick one file" — **union at the function level into ONE canonical of each**:
- `entity_helpers` canonical ⟵ **frame-inspector** base (keep the evaluator arc-midpoint +
  legacy fallback + bridge/plan/fingerprint). Reconcile `get_fb_name`/`get_entity_coord`/
  `get_fb_metadata` against template-maker's bodies (diff-review; prefer the frame-inspector
  behaviour unless template-maker fixed a bug — flag each).
- `expression_coords` canonical ⟵ **template-maker** base (keep the `params`-threaded API +
  spline/scalar features; the `params=None` defaults keep frame-inspector callers working) +
  **add** frame-inspector's `get_entity_name` / `format_design_params` / `_get_design*`.
  Point its `_get_arc_midpoint` import at the canonical `entity_helpers`.
- Acceptance for the merge: template-maker's `tests/` (test_circle_ellipse_spline,
  test_dimension_hint, test_offset_hint, test_mixed_entities_and_rename,
  test_sketchpoint_expression_bug, test_template_generator) must still pass — they import
  `expression_coords` directly, so they're a ready-made regression harness for the canonical.

## 3. Proposed shape — ONE shared package, qualified imports

```
bspline-frame-builder/
  fb_shared/                     ← NEW package (single source of truth)
    __init__.py
    expression_coords.py         ← canonical (merged)
    entity_helpers.py            ← canonical (merged)
  frame-inspector/               ← copies DELETED
    fusion-inspector.py   from fb_shared.expression_coords import get_design_params
    selection_items.py    from fb_shared.expression_coords import get_entity_coord_expr
    payload_builder.py    from fb_shared.entity_helpers import get_fb_name, ...
  template-maker/core/           ← copies DELETED
    *.py                  from fb_shared.entity_helpers import ...
    tests/*.py            import fb_shared.expression_coords  (or via a conftest path shim)
```

Because both palettes import the **package-qualified** name (`fb_shared.entity_helpers`), the
`sys.modules` key is `fb_shared.entity_helpers` — the SAME object for both, no bare-name
collision. Neither palette needs its own copy.

### Import / sys.path changes
- `_bootstrap()` adds `_addin_root` to `sys.path` **once** (so `import fb_shared.*` resolves).
  Each sub still inserts its own folder for its own private modules.
- Rewrite the imports (bare → qualified) in the ~10 call sites (§1 grep list):
  `from entity_helpers import X` → `from fb_shared.entity_helpers import X`, etc.
- template-maker's `expression_coords` internal `from entity_helpers import _get_arc_midpoint`
  → `from fb_shared.entity_helpers import _get_arc_midpoint`.
- Tests: template-maker/core/tests import bare `expression_coords`; either update to
  `fb_shared.expression_coords` or add a `conftest.py` that puts `fb_shared`'s parent on
  `sys.path` (they already have a `conftest.py`). Keep them green as the merge's regression gate.

## 4. The `_force_wipe(_shared_project_names)` delta this retires

- `expression_coords` + `entity_helpers` LEAVE `_shared_project_names` (no longer bare-name
  collision-prone — they're `fb_shared.*` now).
- Add a single `_force_wipe(['fb_shared'])` near the top of `_bootstrap()` (it cascades to
  `fb_shared.expression_coords` / `.entity_helpers`) so hot-reload still re-reads them from disk
  on each Start.
- The 3× `_force_wipe(_shared_project_names)` calls (`:252/:259/:266`) shrink to whatever names
  genuinely remain duplicated (ideally empty for these two → the calls can eventually go once
  §5 finishes). Net: fewer wipes, and the collision that motivated them is gone.

## 5. Scope note (this slice vs the rest)
This design covers the two CONFIRMED drifted dups (`expression_coords`, `entity_helpers`). The
remaining 18 `_shared_project_names` entries are (per the import grep) template-maker-only or
frame-inspector-only — defensively wiped but not actually colliding. Folding them into
`fb_shared` is a **follow-up**; doing the two named modules first proves the pattern with the
smallest blast radius.

## 6. Sliced, Fusion-gated build plan (implementation — later, human Stop→Start each)

Every slice edits import wiring / the hot-reload path, whose behaviour only shows up inside
Fusion. So each slice ends with a **human Fusion Stop→Start + smoke test**, and the risky merge
is gated behind a reviewed diff.

- **S1 — create `fb_shared` + merge `entity_helpers`** (canonical from frame-inspector base;
  reconcile the shared-function bodies vs template-maker, GATE on the arc-midpoint + any
  behaviour conflict). No callers switched yet. Verify: `py_compile`; template-maker tests still
  green against the OLD copies (unchanged).
- **S2 — merge `expression_coords`** into `fb_shared` (template-maker base + frame-inspector
  extras; import arc-midpoint from `fb_shared.entity_helpers`). Verify: point template-maker's
  `tests/` at `fb_shared.expression_coords` → **all green** (the acceptance bar).
- **S3 — switch frame-inspector imports** to `fb_shared.*`, delete `frame-inspector/
  expression_coords.py` + `entity_helpers.py`, drop those 2 names from `_shared_project_names`,
  add `_addin_root` to sys.path + `_force_wipe(['fb_shared'])`. **Human Fusion Stop→Start:**
  Inspector palette loads, selection → payload renders, expressions correct.
- **S4 — switch template-maker imports** to `fb_shared.*`, delete its 2 copies. **Human Fusion
  Stop→Start:** template-maker generates a template, expressions/arc-midpoints correct; confirm
  frame-inspector still fine (co-load ordering — the original collision scenario).
- **S5 — cleanup:** shrink/remove the now-dead `_force_wipe(_shared_project_names)` calls for
  these names; update this doc + the fresh-clone note. (§5 follow-up separate.)

### Open questions to resolve at implementation (GATE points)
1. Arc-midpoint: confirm the evaluator method is correct for ALL template-maker cases before
   template-maker inherits it (its tests are the check).
2. Any `get_fb_name`/`get_entity_coord`/`get_fb_metadata` body that template-maker **fixed** and
   frame-inspector didn't (or vice-versa) — reconcile per-function, don't blanket-pick.
3. Test import strategy (rewrite vs conftest path-shim) — advisor preference.
