# NEXT — CAM1 slice (b): retire the Studio command/palette; one send helper; stop warning on Fusion's own 'response' echo

**Ball: worker (seat A) · epoch 1 · CAM1b.** Files: `bspline-frame-builder/CAM-builder/cam-builder.py`,
`bspline-frame-builder/CAM-builder/ui/html/cam_studio_palette.html` (git rm), and the parent
`bspline-frame-builder/bspline-frame-builder.py` ONLY if it names `CamStudio_Command`/`CamStudio_Palette` (grep first;
the design §3 says the loops live in cam-builder.py itself). One commit by path, predicted **2-3 files**.

## Live proof of slice (a) (advisor, deployed 73dfa77)
Merged palette docks right; B-SPLINE tab lists the setups/templates; a real click on GENERIC booted it (`init` →
`init_result`, status "0 components · 0 setups found"). Both toolbar commands still registered (fallback intact).
**One defect to fix here:** the unified dispatcher logs `WARNING unknown HTML action: 'response'` five times per
palette open — `'response'` is Fusion's own acknowledgement of every `sendInfoToHTML`, not a page action; the old
dispatchers ignored it silently.

## Do (design §5 slice (b) + the fix)
1. `cam-builder.py`: delete `_StudioCmdCreatedHandler`, `_show_studio_palette`, the Studio toolbar registration block
   (`run()` step 4b), `_StudioHtmlEventHandler`, `_HtmlEventHandler` (both marked "superseded" in slice (a)),
   `_StudioPaletteClosedHandler` ONLY if the merged palette has its own closed handler doing the `preview_clear`
   (read `:496-502` and the merged palette's close path first; if the merged palette relies on it, keep it and rename it
   `_CamPaletteClosedHandler`). Edit the `run()`/`stop()` loops exactly as design §3 lists (`for cid in (CMD_ID,)`,
   `for pid in (PALETTE_ID,)`, …). Delete the `STUDIO_*` constants and `_studio_html_handler`/`_studio_closed_handler`
   globals. `AXISPICK_EVENT_ID` registration/unregistration stays.
2. Repoint every `_send_to_studio_html(...)` call to `_send_to_html(...)`; delete `_send_to_studio_html` and
   `_palette_send` (its two callers → `_send_to_html`). One Python send helper remains.
3. In `_CamHtmlEventHandler.notify`: `if action == 'response': return` before the table (one-line comment: Fusion's
   ack of sendInfoToHTML; not a page action).
4. `git rm ui/html/cam_studio_palette.html` (its UI now lives in the merged shell). If your classifier refuses the
   deletion, do everything else and say so — the advisor deletes.
5. Toolbar label: `CMD_ID`'s button name "B-spline CAM" → "CAM" (design §3).

## Verify (headless)
- `py_compile` + `pyflakes` (no new warnings). Extract + `node --check` the merged palette's scripts (unchanged).
- Greps → 0: `STUDIO_CMD_ID|STUDIO_PALETTE_ID|_show_studio_palette|_StudioHtmlEventHandler|_StudioCmdCreatedHandler|
  _send_to_studio_html|_palette_send|class _HtmlEventHandler|cam_studio_palette`. `_send_to_html(` → the one helper.
- adsk-stub import smoke: module imports; `run`/`stop` exist; `_CamHtmlEventHandler` action table still 15.
- `git show --stat HEAD` → 2-3 files. Live proof (only ONE CAM button; both tabs boot; Stop→Start leaves no
  `CamStudio_*` command/palette; no 'response' warnings in the log) is the ADVISOR's.

## Do NOT
Touch `cam_engine/`, the axis-pick deferral, `_kick_off_toolpath_generation`, or the merged HTML's tab bodies.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "CAM1b: Studio command/palette/handlers retired, one send helper, 'response' ignored, button renamed CAM, cam_studio_palette.html removed — <sha>, <n> files; greps 0; action table 15. Next: CAM1c."`
and stop.
