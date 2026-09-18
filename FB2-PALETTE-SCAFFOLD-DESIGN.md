# FB2 — One declared hidden-command palette scaffold for the two frame builders

**Status: IMPLEMENTED** — slice (a) `b7cd92e` + fix `27bfd7c`, slice (b) `dbfed18`, slice (c) (this commit).
**Amendments folded in:** the parent's derived wipe list also covers `frame-builder/ui/`; the hidden-command loop binds `cmd_id`/`execute_fn` per call, never a loop-variable closure.
**Measured, not a bug:** Fusion fires `documentActivated` twice per activation, so two schema pushes per document switch is expected.

Design only. No product code changed in this turn. File-line references are against the current tree
(`sketch_builder_ui.py` 594 lines, `solid_builder_ui.py` 351 lines, both under
`bspline-frame-builder/frame-builder/ui/`).

## 1. Diff map — the eleven shared names

The dispatch's ground truth frames the difference as "module constants + the one build call." Reading
both files line by line, that undersells it: six of the eleven names carry real logic differences, not
just swapped constants. Getting this right up front matters, because the scaffold has to be designed
around the six, not just the three trivial ones.

| Name | Category | Evidence |
|---|---|---|
| `_set_status` | **Identical** | `sketch:437-443` / `solid:267-273` — byte-identical bodies. |
| `_notify_status` | **Identical** | `sketch:446-452` / `solid:276-282` — byte-identical bodies. |
| `_close_palette` | **Identical** | `sketch:455-461` / `solid:285-291` — byte-identical bodies, differ only in which module-level `PALETTE_ID` they close (a free variable, not a code difference). |
| `CommandCreatedHandler` | **Constant-only** | Both `notify()` bodies are `run_palette(frame_engine, diag_logger=diag_logger)` in a try/except; only the log-message string differs (`sketch:226` "SketchBuilder..." vs `solid:96` "SolidBuilder..."). |
| `HiddenBuildCommandCreatedHandler` | **Constant-only** | Both create a `HiddenBuildCommandExecuteHandler`, `cmd.execute.add(h)`, `handlers.append(h)`; only the log string differs (`sketch:393` vs `solid:248`). |
| `_create_hidden_command` | **Logic-differs** | Sketch's signature takes a `handler_class` parameter (`sketch:39`) because it registers two different hidden commands with two different handler classes. Solid's signature has no such parameter (`solid:37`) — it hardcodes `HiddenBuildCommandCreatedHandler()` inline because it only ever has one. Not a constant swap; the parameter count differs. |
| `_ensure_hidden_commands` | **Logic-differs** | Sketch iterates a `targets` tuple of `(cmd_id, name, handler_cls)` pairs (`sketch:55-66`, 2 entries: build + schema-push). Solid handles exactly one command inline with no loop (`solid:51-59`). |
| `_schedule_hidden_build` | **Logic-differs** | Sketch's signature is `(data, style_id="Template 1")` and the pending-request dict carries `{'data':…, 'style_id':…}` (`sketch:72-74`). Solid's signature is `(data)` only, pending dict is `{'data':…}` (`solid:65-67`). |
| `PaletteHTMLEventHandler` | **Logic-differs (the real one)** | Completely different `__init__` state (`self.style_id`/`self.active_vars` vs `self.selected_face`) and completely different action-dispatch tables (§4). `_send_palette_message` and `_send_build_info` — two methods *inside* this class — ARE byte-identical between the two (`sketch:340-372` / `solid:139-171`); everything else in the class is bespoke. |
| `HiddenBuildCommandExecuteHandler` | **Logic-differs** | Sketch pulls `style_id` out of the pending request and calls `_run_sketch_build_direct(data, style_id)` (`sketch:407-409`); solid has no style concept and calls `_run_solid_build_direct(data)` directly (`solid:261-262`). |
| `run_palette` | **Logic-differs** | Shared skeleton (cleanup old palette → create → bridge → show → ensure hidden commands) is the same *shape*, but sketch has four extra steps solid doesn't: tilt-param-ensure (`sketch:538`), `documentActivated` wiring (`sketch:557-569`), first-template pre-selection (`sketch:577-586`), and an initial schema push (`sketch:589`). Window/min-size constants also differ (450×700/320×500 vs 380×460/320×360, `sketch:547-549` / `solid:332-334`). |

**Count: 3 identical, 2 constant-only, 6 logic-differing.** The scaffold's job is to make the 3+2 fully
shared and turn the 6 into "shared skeleton + declared extension points," not to pretend they're already
the same shape.

## 2. The declaration — `frame-builder/ui/palette_scaffold.py`

### Load-path detail neither file solves today (must be decided, not assumed)
`ui/` is **not a package** (`ls frame-builder/ui/*.py` → no `__init__.py`). Both UI modules currently
work around this by adding only their *parent* (`frame-builder/`) to `sys.path`
(`sketch:9-12` / `solid:9-12`), which is what makes `from fb_engine import …` resolve — `fb_engine` **is**
a package (`frame-builder/fb_engine/__init__.py` exists). `ui/` itself is never put on `sys.path`, so a
plain `from palette_scaffold import PaletteSpec, make_palette` inside either UI module would fail today.
**Decision: add one line to each UI module's existing sys.path block** — `if current_dir not in
sys.path: sys.path.append(current_dir)` — right next to the existing `parent_dir` append. This is the
smallest, most consistent-with-existing-style fix; it does not require `ui/` to become a package and does
not touch how the parent loader (`_load_submodule`) works.

### `PaletteSpec`
```python
class PaletteSpec:
    def __init__(self, palette_id, name, html, size, min_size,
                 build_cmd_id, build_fn,
                 extra_commands=(), on_document_activated=None, on_ready=None):
        self.palette_id = palette_id
        self.name = name
        self.html = html                        # relative path, e.g. 'html/sketch_builder_palette.html'
        self.size = size                         # (w, h)
        self.min_size = min_size                 # (mw, mh)
        self.build_cmd_id = build_cmd_id
        self.build_fn = build_fn                 # (data, ctx) -> None — the ONE thing that differs per builder
        self.extra_commands = extra_commands     # tuple of (cmd_id, cmd_name, created_handler_factory)
        self.on_document_activated = on_document_activated  # (style_ref, ctx) -> None, or None
        self.on_ready = on_ready                 # (ctx) -> None, called once after the palette is shown, or None
```

`build_fn`'s signature is `(data, ctx)`, not `(data)` — `ctx` is the one thing every "logic-differs" row
above actually needed and the ground truth's framing missed: sketch's build path (and its schema-push,
and its template list) reads the **injected `frame_engine`** pervasively throughout the module; solid's
`_run_solid_build_direct` calls `solid_coordinator.build_solid_logic_v3` directly
(`solid:16,300`) and **never uses its own injected `frame_engine` at all** — the parameter is accepted in
`run_palette` (`solid:318-319`) and then dead for the rest of the file. `ctx` exposes `frame_engine`
(possibly unused, matching solid's existing behaviour), `diag_logger`, `set_status`, `notify_status`,
`close_palette`, and the palette id — so `build_fn` bodies can be genuinely bespoke without the scaffold
having to know what's inside them.

### `make_palette(spec)` — what it owns, generically, with zero `if`-branching on identity
- **`handlers` list** — same list object every consumer of the parent's teardown contract expects
  (`bspline-frame-builder.py:288-289,296-297` reads `<module>.handlers` via `hasattr`/`.clear()`).
- **`_create_hidden_command` / `_ensure_hidden_commands`, genericized**: loop over
  `[(spec.build_cmd_id, 'Build …', build_created_handler_factory)] + list(spec.extra_commands)`. This
  single loop is what sketch's 2-entry `targets` tuple already does (`sketch:55-66`) — solid's 1-entry
  case is just that same loop with `extra_commands=()`. No branch needed; the DATA (how many entries)
  already encodes the difference.
- **`_schedule_hidden_build`, genericized to `(data)`**: the `style_id` sketch threads through today
  becomes something the CALLER puts inside `data` before scheduling (e.g. `data['style_id'] = style_id`);
  the scaffold's pending-request envelope is just `{'data': data}` always. Solid's `build_fn` simply never
  reads a `style_id` key. This removes the signature difference without a flag.
- **`CommandCreatedHandler`, `HiddenBuildCommandCreatedHandler`, `HiddenBuildCommandExecuteHandler`** —
  fully generic now that they're driven by `spec.build_fn` and a shared `run_palette` reference instead of
  a hand-rolled per-builder body. This is where the actual line-count reduction happens (these three
  classes account for ~60 of solid's 351 lines and ~75 of sketch's 594, almost all boilerplate).
- **`_set_status`, `_notify_status`, `_close_palette`** — copied in verbatim (they're already identical);
  no reason to touch what isn't broken.
- **`run_palette(engine_instance, diag_logger=None)`** — the shared skeleton (steps 1–5: cleanup old
  palette, create with `spec.size`/`spec.min_size`, wire the bridge handler, show, ensure hidden commands
  via the generic loop above) plus, **only if the field is populated**: wire `spec.on_document_activated`
  onto `app.documentActivated` (this is what keeps the module-level `_doc_activated_handler` attribute the
  parent's teardown reads — see §3), and call `spec.on_ready(ctx)` once at the end. Solid's spec passes
  `on_document_activated=None, on_ready=None`; the scaffold's `if spec.on_document_activated is not None:`
  check is a check on **data the spec declares**, not an identity flag the scaffold has to know the name
  of ("sketch" vs "solid" never appears inside `palette_scaffold.py`).

### What each UI module becomes
`solid_builder_ui.py` (351 → roughly 40 lines): the four module constants, the
`solid_coordinator` import, a `_build(data, ctx)` function wrapping today's
`_run_solid_build_direct` body, its OWN `PaletteHTMLEventHandler` subclass (face-picking is genuinely
bespoke — see §3 on why this class stays per-builder), and one `PaletteSpec(...)` + `make_palette(spec)`
call whose result is re-exported as this module's `run_palette`/`handlers`.

`sketch_builder_ui.py` (594 → roughly 40 lines of *scaffold wiring*, PLUS the sketch-only material named
in §3, which does not shrink — it was never boilerplate). The file stays bigger than solid's because
schema-push, parameter hydration, and the tilt-param invariant are real sketch-specific logic, not
duplication. What TM2/E7-style "declare once" fixes here is only the ~490 lines of the 594 that were
copy-pasted scaffolding; the genuinely sketch-only ~150-200 lines (schema push, `_update_fusion_param`,
`DocumentActivatedHandler`, tilt-param) stay, because they have no solid-side twin to share with.

## 3. What stays sketch-only, and how it plugs in without a flag

**Stays:** `_schedule_schema_push` / `_push_schema_direct` + `HiddenSchemaPushCommandCreatedHandler` /
`HiddenSchemaPushExecuteHandler`, `DocumentActivatedHandler`, `_ensure_tilt_param_safe`,
`PaletteHTMLEventHandler`'s sketch-specific action handlers (`_send_template_list`,
`_update_fusion_param`, `_run_sketch_build`).

**How each plugs in:**
- The **schema-push hidden command** is just a second entry in `spec.extra_commands` — the generic
  command-registration loop in §2 already handles N commands, so this needs no scaffold awareness beyond
  "a list can have more than one item."
- **`DocumentActivatedHandler`** becomes `spec.on_document_activated = sketch_on_doc_activated`, where
  `sketch_on_doc_activated(style_ref, ctx)` does exactly what `DocumentActivatedHandler.notify` does today
  (`sketch:494-507`): call `_ensure_tilt_param_safe()`, then re-push schema if the palette is visible.
  Solid's spec passes `None`; the scaffold's `run_palette` skips the whole
  `app.documentActivated.add(...)` block when the field is `None` — which also means it correctly skips
  ever setting a module-level `_doc_activated_handler` for solid, matching solid's *actual current
  behaviour* (it has never had one) rather than inventing a no-op handler solid would have to carry.
- **Tilt-param-ensure at open + first-template pre-select + initial schema push** — sketch's three extra
  `run_palette` steps beyond the generic skeleton — become the body of `spec.on_ready(ctx)`. Solid's spec
  passes `None`, and the scaffold's `if spec.on_ready:` is, again, a check on declared data, not an
  identity flag.
- **`PaletteHTMLEventHandler` stays a per-builder subclass, not something the scaffold owns.** The
  temptation would be to make the scaffold own a generic "action dispatch table," but sketch's actions
  (`update_param`, `update_lock`, `change_template`, `request_template_list`) and solid's
  (`pick_face`) are not variations on a theme — they are different applications' worth of business logic
  operating on different state (`active_vars` vs `selected_face`). Declaring a fake shared shape for them
  would be exactly the kind of premature abstraction #2 (Simplicity First) warns against — "no
  abstractions for single-use code" applies here even though there are two call sites, because the two
  call sites don't actually share behaviour, only a very shallow class *shape* (an `HTMLEventHandler`
  subclass with a `notify` method). What the scaffold DOES own is the two genuinely-identical helper
  methods (`_send_palette_message`, `_send_build_info`) as a small mixin
  (`class _PaletteBridgeMixin: def _send_palette_message(self, …): … ; def _send_build_info(self, …): …`)
  that each builder's own handler class inherits from — this captures the real 100%-duplicate code (33
  lines × 2) without forcing the genuinely-different 60%+ of each class into a one-size-fits-all shape.

No `if is_sketch:` (or any equivalent name check) appears anywhere in `palette_scaffold.py` in this
design. Every sketch-only behaviour is expressed as "a field on this builder's `PaletteSpec` is populated"
or "this builder passes an extra tuple entry" — data the scaffold reacts to generically, never a name it
special-cases.

## 4. Bridge contract check — both directions, both palettes

### Solid (`solid_builder_palette.html` ↔ `solid_builder_ui.py`)
| HTML sends (`notifyFusion(...)`) | Python handles (`PaletteHTMLEventHandler.notify`) |
|---|---|
| `run_build` (`html:234`) | `run_build` (`solid:128`) ✓ |
| `pick_face` (`html:243`) | `pick_face` (`solid:125`) ✓ |
| `ping` (`html:277,284`) | `ping` (`solid:131`) ✓ |

**Clean both directions** — every door has a room and every room has a door. Nothing to preserve or fix;
the scaffold just needs to not break this.

### Sketch (`sketch_builder_palette.html` ↔ `sketch_builder_ui.py`)
| HTML sends | Python handles | |
|---|---|---|
| `update_param` (`html:428`) | `update_param` (`sketch:257`) | ✓ |
| `update_lock` (`html:399,406`) | `update_lock` (`sketch:263`) | ✓ |
| `change_template` (`html:462`) | `change_template` (`sketch:271`) | ✓ |
| `request_template_list` (`html:488,497`) | `request_template_list` / `get_templates` (`sketch:277`) | ✓ |
| `run_build` (`html:473`) | `run_build` (`sketch:280`) | ✓ |
| `update_phase` (`html:382`) | *(none)* | **room, no door** — falls through the if/elif chain silently. |
| `debug_tx`, `debug_resize`, `debug_click`, `debug_focus`×2, `debug_mut`, `debug_optmut`, `debug_periodic`, `debug_observer` (`html:517-606`, 9 sends) | *(none)* | **rooms, no doors** — all fall through silently. Read as intentional dev instrumentation (names literally say "debug"; no error results, just a logged-and-ignored event) rather than a bug, but confirmed here rather than assumed. |
| *(none — sketch HTML never sends `'ping'` or `'get_templates'`)* | `ping` (`sketch:283`), `get_templates` (`sketch:277`, aliased with `request_template_list`) | **doors, no rooms** — dead branches, harmless, likely copy-pasted from a shared template or kept for manual console testing. |

**Sweep result: sketch has 10 doorless rooms (1 real action + 9 debug pings) and 2 roomless doors. This is
pre-existing behaviour, not something FB2 introduces or is asked to fix** — the design's job is to make
sure the scaffold's genericization doesn't accidentally close any of these paths (e.g. by making
`update_phase` suddenly do something, or by dropping the harmless `ping`/`get_templates` branches). Slice
(a) and (b) below both re-run this exact table as an acceptance check.

## 5. Migration plan — three slices, each leaves both palettes working

### Slice (a) — add the scaffold module, switch sketch onto it
- **Files:** `frame-builder/ui/palette_scaffold.py` (new), `frame-builder/ui/sketch_builder_ui.py`
  (rewritten to build a `PaletteSpec` and delegate). `solid_builder_ui.py` **untouched** — proves the
  scaffold and the old-style module can coexist mid-migration.
- **Predicted shape:** 2 files (1 new, 1 modified). Sketch should land close to its target ~40-line
  wiring size plus the sketch-only material (§3) — expect the file to shrink from 594 lines to roughly
  200-250 (the boilerplate leaves; the schema/tilt/doc-activated logic doesn't).
- **Headless gate:** `py_compile` + `pyflakes` on both files (no new warnings). Import-time smoke:
  install the template-maker conftest's minimal `adsk` stub pattern
  (`template-maker/tests/conftest.py:26-40` — a bare `types.ModuleType('adsk')` with
  `adsk.core.Application.get() -> None`) in a throwaway script, then `importlib.util.spec_from_file_location`
  + `exec_module` on `palette_scaffold.py` and the new `sketch_builder_ui.py`, asserting: (1) it imports
  without raising; (2) `sketch_builder_ui.handlers` exists and is a list; (3) `sketch_builder_ui.run_palette`
  exists and is callable; (4) `sketch_builder_ui.PaletteHTMLEventHandler`'s class still defines `notify`.
  Re-run the sketch half of the §4 action table against the new `PaletteHTMLEventHandler.notify` source
  (grep for each action string) to confirm nothing was silently dropped.
- **Advisor verifies live:** open the Sketch Builder palette through the bridge, confirm it still shows,
  builds one frame successfully, auto-closes on success (unchanged behaviour), then Stop→Start the add-in
  and confirm no duplicate `documentActivated` handler (switch documents once, watch for a single schema
  push, not N).

### Slice (b) — switch solid onto the scaffold
- **Files:** `frame-builder/ui/solid_builder_ui.py` only (the scaffold module is already in place from
  slice a).
- **Predicted shape:** 1 file. Expect ~40 lines replacing 351.
- **Headless gate:** same shape as slice (a)'s gate, applied to `solid_builder_ui.py`: `py_compile` +
  `pyflakes`, import-time smoke with the adsk stub, `handlers`/`run_palette` presence checks, and the §4
  solid action table re-verified against the new file (confirm `run_build`/`pick_face`/`ping` all still
  wired — solid's table is the "must stay perfectly clean" one since it started with zero orphans).
- **Advisor verifies live:** open Extrude Frame through the bridge, pick a face, build, confirm auto-close,
  Stop→Start, confirm the palette re-opens cleanly a second time (this is the case most likely to regress
  if the generic hidden-command loop mishandles the single-entry case differently than solid's original
  hand-written version).

### Slice (c) — delete the duplicates, honesty sweep
- **Files:** both UI modules (comment/dead-code cleanup only — no behaviour change), possibly
  `bspline-frame-builder.py` **only if** a comment there references something the migration changed (read
  first; the teardown contract itself — `handlers`/`_doc_activated_handler` — does not change, so this
  file most likely needs zero edits).
- **Predicted shape:** 2-3 files, comment/whitespace-scale diffs only.
- **Headless gate:** `py_compile` + `pyflakes` on every touched file; grep for any leftover reference to a
  function name that slice (a)/(b) moved into the scaffold (e.g. confirm neither UI module still defines
  its own `_create_hidden_command`/`_ensure_hidden_commands`/etc. — the sweep-the-chain check this
  project's other turns have been doing all session).
- **Advisor verifies live:** one more Stop→Start of the whole add-in (both palettes), since this slice
  touches comments in the file the loader reads even if the loader's own code doesn't change.

## 6. Risks / STOP conditions

- **Handler lifetime via the generic hidden-command loop.** The parent's teardown
  (`bspline-frame-builder.py:293-299`) clears `_fb_solid.handlers` wholesale on every Stop, and
  `run_palette` re-creates fresh handler instances on every Start (`_ensure_hidden_commands` deletes+
  recreates the command def each time — `sketch:60-66`, `solid:53-58`). If the scaffold's generic loop
  accidentally shares ONE handler instance across what should be N independent hidden commands (e.g. a
  closure bug capturing the loop variable by reference instead of by value — the classic Python
  late-binding-closure trap), sketch's build command and schema-push command could end up firing the
  same handler. **STOP and flag if the generic loop needs a closure to bind `cmd_id`/`build_fn` per
  iteration** — this is exactly the kind of subtle bug a "looks equivalent" refactor can introduce
  invisibly, and it would only surface as "the wrong command runs" in live Fusion, not in any headless
  gate.
- **Palette re-open on document switch.** Sketch's `DocumentActivatedHandler` re-pushes schema only `if
  pal and pal.isVisible` (`sketch:503`) — the scaffold's generic `on_document_activated` wiring must
  preserve that visibility check inside the CALLBACK (which it does, since the callback body is copied
  verbatim per §3), not accidentally have the scaffold itself decide when to fire independent of
  visibility.
- **Hidden-command purge order in `run_palette`.** Both current implementations delete an existing
  command def before recreating it, INSIDE the same call that also appends a fresh handler to `handlers`
  (`sketch:59-66`, `solid:53-59`) — order matters: delete-then-recreate, never the reverse, or Fusion could
  briefly have two commands registered under one id. The generic loop must preserve this exact
  delete-then-recreate ordering per entry, not batch all deletes before all creates (which would still be
  "equivalent" for N=1 solid but could behave differently for N=2 sketch if command creation has any
  cross-command side effect via `cmd_defs`).
- **`build_fn`'s access to `ctx.frame_engine` for solid is currently unused, not currently absent.** If a
  future change makes solid's build path actually need the injected engine, the scaffold's `ctx` design
  already supports it (§2) — flagging this only so slice (b) doesn't have to redesign `ctx` later; no
  action needed now.
- **Do NOT** add an `if is_sketch:`/`if is_solid:` branch anywhere in `palette_scaffold.py` at any point
  during implementation, even as a "temporary" bridge during slice (a) (when only sketch has migrated).
  If slice (a) finds itself needing one, that's a signal the `PaletteSpec` is missing a field, not that
  the scaffold needs a special case — STOP and revise the spec shape instead.

---

Awaiting advisor blessing before any implementation slice begins.
