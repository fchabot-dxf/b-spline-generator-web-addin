# NEXT — CAM1 slice (a): merged CAM palette shell (two mode tabs) + one dispatcher; Studio's old palette still reachable

**Ball: worker (seat A) · epoch 1 · CAM1a.** Design BLESSED as written in `CAM1-CONSOLIDATION-DESIGN.md` with two
amendments below. Files: `bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html` (becomes the merged
shell), `bspline-frame-builder/CAM-builder/cam-builder.py`. One commit by path, predicted **2 files**.
`cam_studio_palette.html`, `_StudioHtmlEventHandler`, `_show_studio_palette` and the Studio toolbar command stay
UNTOUCHED this slice (the fallback).

## Amendments (advisor)
1. **Dock right on creation.** The inspector lesson (IN3): a floating Fusion palette renders its page zoomed and clips.
   Wherever the merged palette is created (`ui.palettes.add(...)` for `PALETTE_ID`), set
   `palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight` right after, as b-spline-gen and the
   inspector do. Size = the larger of today's two palettes.
2. **Prove the stock-preview echo question in the gate**, don't assume: grep `cam_studio_palette.html` for a listener on
   the `preview` echo (`action === 'preview'`); if one exists, keep it under the new name `preview_stock`; if none,
   say "no JS listener for the stock preview echo — none needed" in the WORK-LOG.

## Do (exactly design §5 slice (a))
1. `cam_builder_palette.html` → the merged shell: a top mode-tab bar (`B-SPLINE` / `GENERIC`), the existing Builder UI
   verbatim as tab 1, the existing Studio UI (copied from `cam_studio_palette.html`) verbatim as tab 2. ONE `send()`,
   ONE `window.fusionJavaScriptHandler.handle` covering the union of listeners (`build_info report preview_bodies
   templates_list template_assignments init_result axis_picked import_result`), ONE boot function that fires the active
   tab's boot actions (`list_cam_templates` + `get_template_assignments` for B-SPLINE; `init` for GENERIC) — and fires
   them again when the tab changes if the tab has not booted yet. Rename the two sends: `preview` → `preview_bodies`
   (Builder) and `preview` → `preview_stock` (Studio). Studio's hide/close `preview_clear` send stays.
2. `cam-builder.py`: add the unified `_CamHtmlEventHandler` exactly as design §2 (14 actions; Builder's dead `generate`
   alias dropped; `preview_bodies` → `_do_preview`, `preview_stock` → `_do_studio_preview`), wire it to `PALETTE_ID`'s
   palette in place of `_HtmlEventHandler`; keep `_HtmlEventHandler` and `_StudioHtmlEventHandler` classes in the file
   for slice (b) to delete (mark each with a one-line `# CAM1a: superseded by _CamHtmlEventHandler; deleted in slice (b)`).
   Amendment 1 here.
3. Nothing in `cam_engine/`. Nothing in the parent loader.

## Verify (headless)
- `py_compile` + `pyflakes` (no new warnings). Extract + `node --check` the merged palette's `<script>` blocks.
- Import smoke with the template-maker conftest adsk stub: `cam-builder.py` imports; `_CamHtmlEventHandler.notify`
  exists; its action table by grep equals the 14 names in design §4 exactly (paste the grep).
- Bridge sweep on the MERGED html: every `send('<action>'` string has a dispatcher branch (14/14); every
  `_send_to_html('<event>'`/`_send_to_studio_html('<event>'` in Python has a listener in the merged handler (8/8).
- `git show --stat HEAD` → 2 files. Live proof (open the merged palette, switch tabs, PREVIEW BODIES + PREVIEW STOCK
  each do their real thing; old CAM Studio button still opens the untouched palette) is the ADVISOR's.

## Do NOT
Delete anything Studio-side yet; touch `cam_engine/`; change the `selectEntity` deferral (`fireCustomEvent`) pattern;
change `_kick_off_toolpath_generation`.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "CAM1a: merged shell (2 tabs) + _CamHtmlEventHandler (14 actions), preview split into preview_bodies/preview_stock, docked right, Studio fallback intact — <sha>, 2 files; bridge sweep 14/14 + 8/8. Next: CAM1b."`
and stop.
