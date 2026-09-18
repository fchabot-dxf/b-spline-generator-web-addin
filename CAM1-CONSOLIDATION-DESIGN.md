# CAM1 — Consolidate CAM Builder and CAM Studio into one palette

**Status: IMPLEMENTED** — slice (a) `d714591`, slice (b) `de63098`, slice (c) (this commit).
**Amendments:** dock-right (amendment 1) was already true in `_show_palette` before slice (a) even
started — confirmed via `git diff` against the pre-turn commit, nothing to add; the stock-preview echo
(amendment 2) has no JS listener anywhere in `cam_studio_palette.html`, so `_do_studio_preview`'s
outgoing send needed no rename — "none needed," exactly the amendment's own fallback wording.
**Fixes found during implementation that this design didn't anticipate:** `_do_preview`'s two outgoing
sends had to be renamed to `preview_bodies` to match the renamed JS listener, or the body-classification
counts would have silently stopped reaching the palette; `_send_to_studio_html` had to broadcast to both
palette ids in slice (a), or the merged GENERIC tab would send every action correctly but never receive a
response; slice (b) added an `if action == 'response': return` guard for Fusion's own `sendInfoToHTML`
acknowledgement, which the merged dispatcher (unlike the old separate ones) was logging as a spurious
warning; slice (b) also fixed a live `STUDIO_PALETTE_ID` NameError in `_do_studio_generate`'s
success-hide path — a reference to a constant that same slice deleted, which would have crashed on every
successful GENERIC-tab generate.

Design only for this file. No product code changed by this section. File:line references below are
against the tree at the time of the DESIGN turn (`cam-builder.py` 2324 lines, `cam_builder_palette.html`
685 lines, `cam_studio_palette.html` 1028 lines, all under `bspline-frame-builder/CAM-builder/`) — read
them as historical evidence for the plan, not as the current file state.

Fred's ruling: "CAM Builder vs CAM Studio → consolidate" — two toolbar entries with an overlapping
`preview` action are confusing. This design maps both palettes' real behavior with evidence, proposes one
merged palette with one dispatcher, and lays out a 3-slice migration that never leaves either workflow
broken.

## 1. What each palette actually does today

### CAM Builder ("B-spline CAM") — a fixed, phased pipeline for the hardcoded bspline pipeline

Bridge: `cam_builder_palette.html` → `_HtmlEventHandler.notify` dispatcher (`cam-builder.py:230-272`).
JS send helper: `send(action, payload)` (`html:388-392`), one `window.fusionJavaScriptHandler.handle`
(`html:438`) listening for `build_info` / `report` / `preview` / `templates_list` /
`template_assignments` (`html:443,467,486,497,500`).

| Step (user sees) | UI trigger | Action sent | Handler | What it does |
|---|---|---|---|---|
| 1. PREVIEW | `preview-btn` (`html:243`), `runPreview()` (`html:412`) | `preview` | `_do_preview` (`py:1214-1241`) | Read-only dry run: `_enumerate_bodies` + `_classify_body` (`py:172,197`) over every Design body, streams `{counts, samples}` back. No viewport side effect. |
| 2. Per-setup templates | 4 collapsible sections (`html:272-344`, `toggleTpl`), one per `SETUP_KEYS = ['stock','bspline_back','bspline_top','frame']` (`html:386`) | boot: `list_cam_templates` + `get_template_assignments` (`html:665-666`, polled until `window.adsk` exists — `html:659-679`); on edit: `set_template_assignments` | `_do_list_cam_templates` (`py:279-305`) enumerates the CAM template library (cloud/local/system); `_do_get_template_assignments` (`py:319-347`) reads per-setup overrides (or `setup_builder.SETUP_SPECS` defaults) via `cam_engine.template_assignments`; `_do_set_template_assignments` (`py:350-371`) persists an override as a Design attribute and echoes back. | 
| 3. BUILD SETUPS | `build-btn` (`html:355`), `runBuild()` → `send('build', {mode:'bspline'})` | `build` (dispatcher also aliases legacy `generate` → same handler, `py:249`) | `_do_generate` (`py:1244-1297`) | `_engine.run(mode='bspline', skip_templates=True, skip_machine=True)` — creates the 3 Manufacturing Models + 4 Setups. No machine, no templates, no toolpaths yet. |
| 4. ADD MACHINE | `add-machine-btn` (`html:362`) | `add_machine` | `_do_add_machine` (`py:1300-1339`) | Attaches the default machine (Ultimate Bee 3-axis) to every Setup via `cam_engine.setup_builder._assign_default_machine`. |
| 5. *(manual, not in the bridge)* | — | — | — | User clicks **Origin** in Fusion's native Part Position panel on one Setup — this add-in never sees it. |
| 6. SYNC TABLE ATTACH | `sync-attach-btn` (`html:363`) | `sync_table_attach` | `_do_sync_table_attach` (`py:1342-1378`) | Propagates the Table Attach Point from the one manually-configured setup to every other setup (`setup_builder._propagate_part_position_pass`). |
| 7. APPLY TOOLPATHS | `apply-toolpaths-btn` (`html:370`) | `apply_toolpaths` | `_do_apply_toolpaths` (`py:1381-`) | Applies cloud templates per `SETUP_SPECS`/overrides, then fires `_kick_off_toolpath_generation` (`py:1147`, **shared with Studio**) → `cam.generateAllToolpaths(skipValid=True)`, async. |

State: none of Builder's own (it's stateless between steps — everything lives in the live CAM setups
Fusion already tracks). Mode is hardcoded `'bspline'`. No cloud-profile persistence, no axis picks, no
custom-graphics preview.

### CAM Studio ("CAM Studio") — one-shot, profile-driven, generic pipeline

Bridge: `cam_studio_palette.html` → `_StudioHtmlEventHandler.notify` dispatcher (`py:427-453`). Same JS
send-helper shape, byte-identical (`html:384-388` vs Builder's `html:388-392`). One
`window.fusionJavaScriptHandler.handle` (`html:870`) listening for `build_info` / `init_result` /
`axis_picked` / `import_result` / `report` (`html:875,898,917,935,952`).

| Step (user sees) | UI trigger | Action sent | Handler | What it does |
|---|---|---|---|---|
| 0. Boot scan | none (auto, polled like Builder's boot — `html:1007-1015`, comment literally says "the same boot pattern the CAM Builder palette uses") | `init` | `_do_studio_init` (`py:769-854`) | Scans active-doc components + existing CAM setup names + combined model bounding box (mm) → `init_result`; palette pre-fills stock dims + dropdowns. |
| 1. Profile: LOAD / SAVE / DEL | `profile-select` + buttons (`html:186-190,205-207`) | *(none — direct `fetch` to a Cloudflare Worker, not `fusionSendData`)* | *(none — cloud, not the bridge)* | `WORKER = 'https://projects-dansemur.dansemur.workers.dev'` (`html:352`) — a **separate cloud store from Builder's CAM-template library**, used to persist/recall named generic profiles. |
| 1b. Profile: IMPORT | `setup-select` + IMPORT (`html:194-198`), `importFromSetup()` | `import_setup` | `_do_import_setup` (`py:857-890`) → `_extract_profile_from_setup` (`py:893-`) | Pulls stock/WCS/clearance/retract/all-op params from an **existing** CAM setup in the active doc, by name — works on any setup regardless of which add-in built it (see "feeds into" below). |
| 2. EDIT SETTINGS | `edit-toggle-btn` (`html:211`), collapsible form (`html:216-335`) | (local only until Generate/Preview) | — | Stock mode+dims, Clearance/Retract, WCS box-point+flips+"Assign machine", Rotary mode+centerline, WCS axis picks, Faces (non-rotary) or Sides (rotary), Operations. |
| 2b. WCS axis pick | `btn-pick-x`/`btn-pick-y` (`html:282,290`), `pickAxis(axis)` (`html:404`) | `select_x_axis` / `select_y_axis` | dispatcher fires `AXISPICK_EVENT_ID` (`py:447,449`) → `_AxisPickHandler.notify` (`py:714-754`) | Runs **`ui.selectEntity(...)`, a blocking modal viewport pick**, deferred via `fireCustomEvent` so the HTML handler itself returns immediately; stores the token in module-global `_picked_axis_tokens[axis]` (`py:80`), echoes `axis_picked`. See Risk §6. |
| 2c. Live preview | debounced on any settings change, `sendPreview()` (`html:393-`) | `preview` | `_do_studio_preview` (`py:582-711`) | Draws a translucent stock-ghost box + a WCS-oriented axis triad as **custom graphics** in the viewport (uses `_picked_axis_tokens` + flips). Stateful — tracks `_studio_preview_group` (`py:508`) so it can clear/redraw in place. Cleared on palette hide (`html:994`, `send('preview_clear')`) or close (`_StudioPaletteClosedHandler`, `py:496-502`). |
| 3. GENERATE | header button (`html:161`), `runGenerate()` | `generate` | `_do_studio_generate` (`py:1066-1144`) | `_engine.run(mode='generic', component_names=..., profile=...)` — one MM + one Setup per (component × side), **in one step** (no separate Add Machine / Sync Attach / Apply Toolpaths phases). On success, also fires `_kick_off_toolpath_generation` (same shared helper as Builder) then hides the palette. |

State: `_picked_axis_tokens` (module global, Studio-only), `_studio_preview_group` (Studio-only),
cloud-backed named profiles (Studio-only, separate cloud store from Builder's), plus JS-side
`selectedComponents` / `loadedProfile` / `modelDims` (`html:362-365`).

### The overlap Fred flagged: two `preview` actions, genuinely different things

- Builder's `preview` (`py:257` dispatcher → `_do_preview`, `py:1214`): **stateless data report** — body
  counts by classification, no viewport mutation.
- Studio's `preview` (`py:444` dispatcher → `_do_studio_preview`, `py:582`): **stateful 3D graphics** — a
  redrawable stock ghost + axis triad, tracked for cleanup.

These are not "the same thing implemented twice" — they are unrelated operations that happen to share a
name. A naive merge that keeps one `preview` branch in a unified dispatcher would silently drop one of
them. **Resolution: rename both** so the merged table has no ambiguity — `preview_bodies` (Builder's
dry-run report) and `preview_stock` (Studio's live ghost).

### A second, undispatched collision found while reading: `generate`

Builder's dispatcher aliases legacy action `generate` to the same handler as `build` (`py:246-250`,
comment: *"'generate' = legacy single-button; treat as alias for 'build' so existing callers don't
break"*). Studio's dispatcher has its own, real, current `generate` → `_do_studio_generate` (`py:436`).
**Checked whether Builder's current HTML ever sends `'generate'`: it does not** — `cam_builder_palette.html`
grep for `send('generate'` → 0 hits; `runBuild()` only ever sends `'build'` (`html:420`). Builder's
`generate` branch is dead code from the current tree's perspective — a legacy compatibility shim for a
caller that no longer exists in this repo. **Resolution: drop Builder's dead `generate` alias in the
merge; Studio's real `generate` action is unaffected.**

### Where one feeds the other

No direct code coupling. Studio's `import_setup` (`py:857`) reads any CAM setup in the active document by
name via Fusion's own `cam.setups` collection — it can pick up a setup Builder just built, but only
incidentally (it works identically on a setup from either palette, or one the user built by hand in
Fusion's native CAM UI). There is no private handoff, shared payload shape, or ordering dependency
between the two palettes' Python.

### `cam_engine/` — checked for palette-identity assumptions, found none

`cam_coordinator.run(classifier, app, logger, mode='bspline'|'generic', component_names, profile,
skip_templates, skip_machine)` (`cam_engine/cam_coordinator.py:99`) is parameterized by `mode`, never by
which palette called it. `_kick_off_toolpath_generation` (`py:1147`) is already **one shared function**
called from both `_do_apply_toolpaths` (Builder) and `_do_studio_generate` (Studio) — not duplicated.
`cam_engine/` (4588 lines across `setup_builder.py`, `mm_builder.py`, `cam_coordinator.py`,
`cam_workspace.py`, `parameter_introspect.py`, `template_assignments.py`) needs **no changes** for this
merge.

## 2. One palette, declared as tabs

Given the evidence above, forcing both workflows into one linear step sequence (e.g. "Setup → Templates →
Toolpaths → Generate") would misrepresent them: Builder is a fixed, hardcoded, multi-phase pipeline with a
required manual pause (step 5); Studio is a profile-driven, single-shot generate with live 3D feedback.
They already share a mode concept at the engine boundary (`mode='bspline'|'generic'`) — the palette should
mirror that split, not paper over it.

**Proposed: one palette, `CamBuilder_Palette`, with a top-level mode tab — "B-SPLINE" / "GENERIC" —
each tab showing its own step sequence in its own true working order**, backed by **one dispatcher
table**, **one send() helper**, and **one `window.fusionJavaScriptHandler.handle`**. The B-SPLINE tab is
today's Builder UI verbatim (renumbered `preview` → `preview_bodies`); the GENERIC tab is today's Studio
UI verbatim (renumbered `preview` → `preview_stock`). Nothing about either tab's internal step order
changes — only the container and the dispatch plumbing merge.

### The dispatcher after merge — one table, one class

```
class _CamHtmlEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        ea = adsk.core.HTMLEventArgs.cast(args)
        data = json.loads(ea.data) if ea.data else {}
        action = ea.action or data.get('action')
        if   action == 'preview_bodies':          _do_preview()
        elif action == 'build':                   _do_generate()
        elif action == 'add_machine':              _do_add_machine()
        elif action == 'sync_table_attach':         _do_sync_table_attach()
        elif action == 'apply_toolpaths':           _do_apply_toolpaths()
        elif action == 'list_cam_templates':        _do_list_cam_templates(); ...build_info piggyback...
        elif action == 'get_template_assignments':  _do_get_template_assignments()
        elif action == 'set_template_assignments':  _do_set_template_assignments(data)
        elif action == 'init':                      _do_studio_init(); ...build_info piggyback...
        elif action == 'import_setup':               _do_import_setup(data)
        elif action == 'preview_stock':              _do_studio_preview(data)
        elif action == 'preview_clear':              _clear_studio_preview()
        elif action == 'generate':                   _do_studio_generate(data)
        elif action == 'select_x_axis':  adsk.core.Application.get().fireCustomEvent(AXISPICK_EVENT_ID, 'x')
        elif action == 'select_y_axis':  adsk.core.Application.get().fireCustomEvent(AXISPICK_EVENT_ID, 'y')
        else: _log(f"unknown HTML action: {action!r}", "WARNING")
```

14 actions total (was 8 Builder + 7 Studio = 15, minus the dead `generate` alias, minus the two `preview`s
merged into two distinct names = net 14). No two branches mean different things.

### One send helper, one receive handler (JS)

Both palettes already declare a byte-identical `send(action, payload)` (`cam_builder_palette.html:388-392`
== `cam_studio_palette.html:384-388`) — this collapses into one shared function trivially, no behavior
change. The two `window.fusionJavaScriptHandler.handle` functions merge into one `if/else` chain over the
union of both action lists (`build_info`, `report`, `preview_bodies`→renders the Builder counts,
`templates_list`, `template_assignments`, `init_result`, `axis_picked`, `import_result`,
`preview_stock`→(no JS listener needed — it's fire-and-forget from JS's side today; confirm no HTML
listens for a `preview` echo before dropping it)). The boot-poll pattern (`bootTemplateBrowser` /
`bootStudioInit`, already textually near-identical — both poll for `window.adsk` then fire once) collapses
into one shared boot function that fires whichever boot action(s) the active tab needs.

### Functions that move, and where

| Function | Today | After merge |
|---|---|---|
| `_do_preview` | `cam-builder.py` (Builder section) | same file, renamed call site only (`preview_bodies`) — function body untouched |
| `_do_studio_preview` | `cam-builder.py` (Studio section) | same file, renamed call site only (`preview_stock`) — function body untouched |
| `_palette_send` | `cam-builder.py:374-382`, used only twice (`py:303,345`) | **deleted** — its two call sites switch to `_send_to_html` (see below), removing the duplicate send helper the dispatch asks to eliminate |
| `_send_to_html` | `cam-builder.py:1200-1207`, the Builder send helper (dozens of call sites) | becomes the ONE Python-side send helper; `_send_to_studio_html`'s call sites (`py:442,737,750,846,854,870,880,885,890,1101,1119,1134`) are repointed to it once both palettes write to the same `PALETTE_ID` |
| `_send_to_studio_html` | `cam-builder.py:757-766` | **deleted** once its callers are repointed |
| Everything else (`_do_generate`, `_do_add_machine`, `_do_sync_table_attach`, `_do_apply_toolpaths`, `_do_list_cam_templates`, `_do_get_template_assignments`, `_do_set_template_assignments`, `_do_studio_init`, `_do_import_setup`, `_extract_profile_from_setup`, `_do_studio_generate`, `_kick_off_toolpath_generation`, `_AxisPickHandler`, `_clear_studio_preview`, `_StudioPaletteClosedHandler`) | `cam-builder.py` | **unchanged**, only their call sites move under the one dispatcher |

Two duplicate send helpers found and removed as part of this merge (`_palette_send` vs `_send_to_html` —
this was already a pre-existing duplication *within* the Builder palette alone, not something the Studio
merge introduces; worth fixing here since we're touching this exact area).

## 3. Toolbar

One command, `CamBuilder_Command` "CAM" (rename from "B-spline CAM" — the mode tabs inside now cover
what "CAM Studio" used to name separately). `CamStudio_Command` retires.

Parent lines to change in `run()`/`stop()` (`cam-builder.py`):
- `run()` `for cid in (CMD_ID, STUDIO_CMD_ID):` (`py:2118`) → `for cid in (CMD_ID,):` (purge-prior-versions loop)
- `run()` step 4b, the entire "Register CAM Studio button" block (`py:2146-2164`) → **deleted**
- `run()` step 5's toolbar-add loop, `for cid, cdef in ((CMD_ID, cmd_def), (STUDIO_CMD_ID, studio_cmd_def)):` (`py:2175`) → `for cid, cdef in ((CMD_ID, cmd_def),):`
- `stop()` step 1, `for pid in (PALETTE_ID, STUDIO_PALETTE_ID):` (`py:2233`) → `for pid in (PALETTE_ID,):`
- `stop()` step 2, `for cid in (CMD_ID, STUDIO_CMD_ID):` (`py:2255`) → `for cid in (CMD_ID,):`
- `stop()` step 3, `for cid in (CMD_ID, STUDIO_CMD_ID):` (`py:2271`) → `for cid in (CMD_ID,):`
- `stop()` step 4, `app.unregisterCustomEvent(AXISPICK_EVENT_ID)` (`py:2292`) stays — the axis-pick event is still used inside the merged palette's GENERIC tab
- Module constants: `STUDIO_CMD_ID`, `STUDIO_PALETTE_ID`, `STUDIO_PALETTE_NAME`, `STUDIO_PALETTE_WIDTH/HEIGHT`, `STUDIO_PALETTE_URL`, `STUDIO_RESOURCES_PATH` (`py:54-60`) → **deleted**; `_studio_html_handler`, `_studio_closed_handler` globals (`py:70,81`) → **deleted**

## 4. Bridge contract sweep after merge

| HTML sends (`send(...)`) | Python handles (unified dispatcher) | |
|---|---|---|
| `preview_bodies` (renamed, was `preview`) | `_do_preview` | ✓ |
| `build` | `_do_generate` | ✓ |
| `add_machine` | `_do_add_machine` | ✓ |
| `sync_table_attach` | `_do_sync_table_attach` | ✓ |
| `apply_toolpaths` | `_do_apply_toolpaths` | ✓ |
| `list_cam_templates` | `_do_list_cam_templates` | ✓ |
| `get_template_assignments` | `_do_get_template_assignments` | ✓ |
| `set_template_assignments` | `_do_set_template_assignments` | ✓ |
| `init` | `_do_studio_init` | ✓ |
| `import_setup` | `_do_import_setup` | ✓ |
| `preview_stock` (renamed, was `preview`) | `_do_studio_preview` | ✓ |
| `preview_clear` | `_clear_studio_preview` | ✓ |
| `generate` | `_do_studio_generate` | ✓ |
| `select_x_axis` | fires `AXISPICK_EVENT_ID('x')` | ✓ |
| `select_y_axis` | fires `AXISPICK_EVENT_ID('y')` | ✓ |
| *(Builder's legacy)* `generate` | *(dropped — 0 current callers, confirmed by grep)* | **removed by design, not a new gap** |

| Python sends (`_send_to_html`, unified) | JS listens (`window.fusionJavaScriptHandler.handle`) | |
|---|---|---|
| `build_info` | ✓ (both palettes' handlers already do the same badge-paint; merge to one) | ✓ |
| `report` | ✓ (both palettes already listen; Builder's reads `payload.msg`/`ok`, Studio's does the same shape) | ✓ |
| `preview` → renamed `preview_bodies` on the JS listener side too | ✓ (Builder's `preview` listener, `html:486`) | ✓ |
| `templates_list` | ✓ (`html:497`) | ✓ |
| `template_assignments` | ✓ (`html:500`) | ✓ |
| `init_result` | ✓ (Studio's `html:898`) | ✓ |
| `axis_picked` | ✓ (Studio's `html:917`) | ✓ |
| `import_result` | ✓ (Studio's `html:935`) | ✓ |

**Clean both directions after the merge** — every door has a room and every room has a door, once the
one dead `generate` alias is dropped and the two `preview`s are renamed apart. No new gaps introduced by
consolidating.

## 5. Migration plan — three slices, each leaves a working palette

### Slice (a) — merged HTML shell + dispatcher union, Studio's palette still reachable
- Add the mode-tab shell to `cam_builder_palette.html` (or a new merged file — naming TBD at
  implementation time); embed both existing UIs as the two tab bodies verbatim, renaming only the two
  `preview` sends (`preview_bodies` / `preview_stock`) and merging the two `send()`/boot-poll functions.
- Add the union dispatcher in `cam-builder.py` as a NEW handler class, wired to `PALETTE_ID` only. Leave
  `_StudioHtmlEventHandler`, `_show_studio_palette`, and the Studio toolbar command **untouched** —
  Studio's old palette/button still works standalone during this slice, giving a fallback if the merged
  shell has a layout bug.
- Gate: `py_compile` cam-builder.py; extract + `node --check` the merged palette's script; both old
  actions' handlers still reachable from their original palette AND from the new merged one.
- Advisor verifies live: open the merged palette, switch tabs, run PREVIEW BODIES on the B-SPLINE tab and
  PREVIEW STOCK on the GENERIC tab, confirm both still do their real (different) things; old CAM Studio
  button still opens the untouched original palette.

### Slice (b) — retire the Studio command/palette + parent lines
- Delete `_StudioCmdCreatedHandler`, `_show_studio_palette`, the Studio toolbar registration block, and
  the parent `run()`/`stop()` loop lines listed in §3.
- Delete the now-orphaned `_StudioHtmlEventHandler` (superseded by the unified dispatcher from slice a) —
  confirm nothing else calls it first (grep `_StudioHtmlEventHandler`).
- Repoint `_send_to_studio_html`'s call sites to `_send_to_html`; delete `_send_to_studio_html` and
  `_palette_send`.
- Gate: `py_compile`; the toolbar sweep — only one `CAM` button registers; `stop()` → `run()` cycle
  leaves no orphaned command def or palette (both ids checked via `ui.commandDefinitions.itemById` /
  `ui.palettes.itemById` returning `None`).
- Advisor verifies live: fresh Fusion session, only one CAM button in the panel; both tabs' full
  workflows run end to end (Builder's phased BUILD→ADD MACHINE→SYNC ATTACH→APPLY TOOLPATHS; Studio's
  profile load/import→edit→axis pick→generate).

### Slice (c) — honesty sweep
- `cam-builder.py`'s module docstring and comments that still describe "two palettes" (e.g. the docstring
  at `py:1-24`, any comment naming "CAM Studio" as a separate registered command) — update to describe
  the one merged palette with two tabs.
- Re-run the bridge contract table in §4 against the final tree as an acceptance check, same as FB2's
  slice (c) did.
- Gate: `grep -c "STUDIO_CMD_ID\|STUDIO_PALETTE_ID\|_show_studio_palette\|_StudioHtmlEventHandler\|_StudioCmdCreatedHandler\|_send_to_studio_html\|_palette_send"` → 0.

## 6. Risks / STOP conditions

- **Modal `selectEntity` axis picks block the bridge.** `_AxisPickHandler.notify` (`py:723-754`) calls
  `ui.selectEntity(...)`, which blocks until the user picks or cancels in the viewport. It's already
  deferred off the HTML-handler's own call stack via `fireCustomEvent` (so the *HTML event itself*
  returns immediately — the palette doesn't visibly freeze), but the custom-event handler thread itself
  is blocked for the whole pick. **The advisor learned this live already** — flagging here so slice (a)/(b)
  don't change this deferral pattern while merging the dispatcher; any refactor that accidentally calls
  `selectEntity` synchronously from the HTML handler itself (not via the deferred custom event) would
  freeze the palette's message loop. Test explicitly: pick X, wait, pick Y, cancel one — palette must stay
  responsive throughout.
- **Long-running `generate` / toolpath generation.** `_kick_off_toolpath_generation` (`py:1147-1174`)
  fires `cam.generateAllToolpaths(skipValid=True)` as a genuinely async, unawaited call — Fusion shows its
  own progress dialog, the palette doesn't poll or block. This is already correct and shared by both
  paths; nothing to change, but a merge that accidentally made one path `await`/poll it would introduce a
  new freeze risk that doesn't exist today.
- **The `AXISPICK_EVENT_ID` / `TPGEN_EVENT_ID` / `REFRESH_EVENT_ID` custom events** are registered/torn
  down in `run()`/`stop()` independently of which palette is open (`py:2041,2054,2066` /
  `py:2284,2288,2292`). The merge doesn't touch this lifecycle — confirmed `AXISPICK_EVENT_ID` must stay
  registered even after Studio's *command* retires, since the GENERIC tab of the merged palette still uses
  it.
- **`cam_engine` assuming which palette called it: checked, found nothing** (§1) — `mode` is the only
  branch point, never a palette id. Re-verify this holds after the merge by grepping `cam_engine/*.py` for
  `PALETTE_ID`, `STUDIO_PALETTE_ID`, `'Builder'`, `'Studio'` → expect 0 before AND after.
- **Two send helpers already existed for Builder alone** (`_palette_send` vs `_send_to_html`, §2) — this
  predates the Studio merge; fixing it here is in scope because slice (b) already touches this exact
  area, not a new risk this design introduces.
- **The dead `generate` alias** (§1) — confirmed 0 current callers before proposing its removal; if a
  deployed build somewhere still relies on it (outside this repo's HTML), dropping it would silently break
  that caller. Flagging as a low-probability risk rather than a certainty, since it can only be confirmed
  against source actually in this repo.
