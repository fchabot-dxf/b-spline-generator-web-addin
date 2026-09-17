# NEXT — FB3: Frame Builder shows which Fusion parameters a build will create (Fred's ruling)

**Ball: worker (seat A) · epoch 1 · FB3.** Files: `bspline-frame-builder/frame-builder/ui/sketch_builder_ui.py`,
`bspline-frame-builder/frame-builder/ui/html/sketch_builder_palette.html`. One commit by path, predicted **2 files**.

## Ground truth (advisor-verified)
- The palette already lists the template's parameters (schema push): each row is rendered by `_renderParam(p, …)`
  (`sketch_builder_palette.html:266-`) as `.cad-field-row` with `p.Label || p.Name` and a control. `p.Name` IS the
  Fusion user-parameter name the build creates/updates (`frame_thickness`, `boundingboxoffset`, `ck_*`, …); it is never
  shown. `_hydrate_params` (`sketch_builder_ui.py`, inside `_push_schema_direct`) looks each one up in
  `design.userParameters` (`fp = user_params.itemByName(p_name)`) to hydrate `Val` — so Python already knows whether the
  parameter EXISTS in the design or will be CREATED by the next build.
- Ruling: "show the parameters a build will create, before building".

## Do
1. `sketch_builder_ui.py` `_hydrate_params`: declare one more field per param — `p_live['Exists'] = bool(fp)` (False when
   there is no design or no such parameter). Nothing else changes in the payload.
2. `sketch_builder_palette.html` `_renderParam`: under (or right of) the label, a muted monospace line
   `<span class="param-fusion-name" title="Fusion user parameter (Modify → Change Parameters)">frame_thickness</span>`
   followed by a small chip `<span class="param-new">new</span>` when `p.Exists === false` (chip text `new` = "will be
   created by the next build"; no chip when it exists). Declare the two classes once in the palette `<style>`
   (10px, `--cad-text-muted`; the chip uses the existing accent token). ReadOnly params (`widthIn`, `heightIn`,
   `boundingboxoffset`) show the name but never the chip (they are owned by b-spline-gen).
3. One sentence at the top of the parameter section, only when at least one row is `new`:
   "Building creates the parameters marked new in this design." (a `<div class="param-note">`, hidden otherwise).

## Verify
- `py_compile` sketch_builder_ui.py; extract + `node --check` the palette script; `python -m pytest
  bspline-frame-builder/template-maker/tests -q` → 83 (sanity; fb_shared untouched).
- Greps: `'Exists'` → 1 in py; `param-fusion-name` → css + js; `param-new` → css + js + note.
- `git show --stat HEAD` → 2 files. Fusion look is the ADVISOR's (fresh design: every row shows its name + `new`;
  after one build: chips gone).

## Do NOT
Touch the build path, the scaffold, or fb_engine.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB3: Exists per param from _hydrate_params; rows show the Fusion name + 'new' chip; note when any is new — <sha>, 2 files. Next: CAM1 design."`
and stop.
