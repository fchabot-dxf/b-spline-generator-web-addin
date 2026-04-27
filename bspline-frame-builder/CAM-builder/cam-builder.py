"""
CAM Builder -- Manufacturing Model + Setup scaffolder.

Top-level sub-module entry point. Follows the same lifecycle pattern as
template-maker / fusion-inspector / fusion-exporter:

  * `run(context)` registers a button command in the shared bsplinePanel
    and wires the palette HTML <-> Python bridge.
  * `stop(context)` releases every event subscription, command def, and
    palette so a Stop -> Start cycle reloads from disk cleanly.

Pass 1 -- "prove the plumbing"
------------------------------
This iteration creates the 3 Manufacturing Models and 4 Setups WITHOUT
body filtering. All MMs hold the same bodies (the full design); we just
want to confirm the API calls land in Fusion's CAM browser correctly.
Body-filter logic (remove frame from B-spline MM, etc.) is Pass 2.

Preview action
--------------
Read-only dry run: enumerates Design bodies, runs the classifier, and
streams the report back to the palette so the user can sanity-check
classification before writing anything.
"""

import os, sys, json, traceback, importlib.util

import adsk.core
import adsk.fusion
import adsk.cam


# ---------------------------------------------------------------------------
# Constants -- match the bspline-frame-builder shared panel ID.
# ---------------------------------------------------------------------------

CMD_ID            = 'CamBuilder_Command'
RELOAD_CMD_ID     = 'CamBuilder_ReloadCommand'
PALETTE_ID        = 'CamBuilder_Palette'
PANEL_ID          = 'bsplinePanel'    # shared with the rest of the suite
REFRESH_EVENT_ID  = 'CamBuilder_DeferredRefresh'

PALETTE_NAME      = 'CAM Builder'
PALETTE_WIDTH     = 460
PALETTE_HEIGHT    = 620

_addin_dir = os.path.dirname(os.path.realpath(__file__))
PALETTE_URL = os.path.join(_addin_dir, 'ui', 'html', 'cam_builder_palette.html').replace('\\', '/')
RESOURCES_PATH = os.path.join(_addin_dir, 'resources', 'CamCommand')


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_handlers = []          # per-run handlers, cleared on stop
_refresh_handlers = []  # CustomEvent handlers, alive for full Fusion session
_html_handler = None
_logger = None
_engine = None          # cam_engine.cam_coordinator after load

_refresh_event = None
_refresh_registered = False


# ---------------------------------------------------------------------------
# Submodule loader -- mirrors the pattern used by other sub-modules so each
# Stop -> Start reloads from disk.
# ---------------------------------------------------------------------------

def _wipe(names):
    for n in names:
        if n in sys.modules:
            try:
                del sys.modules[n]
            except Exception:
                pass
        for k in list(sys.modules.keys()):
            if k.startswith(n + '.'):
                try:
                    del sys.modules[k]
                except Exception:
                    pass


def _load_engine():
    """Load (or reload) cam_engine.* and cam_utils.* fresh from disk."""
    global _engine, _logger

    if _addin_dir not in sys.path:
        sys.path.insert(0, _addin_dir)

    _wipe(['cam_engine', 'cam_utils'])

    from cam_utils.cam_logger import make_logger
    _logger = make_logger(_addin_dir, category='cam')
    _logger.session_start("CAM Builder run")

    from cam_engine import cam_coordinator
    _engine = cam_coordinator


# ---------------------------------------------------------------------------
# Body classifier -- maps a BRepBody to one of 'frame', 'panel', 'unknown'.
# Anchors observed in real designs:
#   * "B-Spline Set" -- top-level component holding the panel solid one or
#     two occurrence levels deep (e.g. "B-Spline Set > Terrain - Clean
#     Solid > Body1"). Walk the ancestry, don't just check parentComponent.
#   * frame_<label> -- body name pattern from extrusion_engine.py:178.
#
# Note on stock: the user keeps a "stock" placeholder component in the
# design tree, but it is NOT a real body to be machined or kept in any
# MM. The Stock MM will *extrude its own stock body* during MM editing
# (Pass 2). Bodies under the stock placeholder fall through to
# 'unknown' here on purpose.
#
# The classifier is wired in cam-builder.py (not deep in cam_engine) so a
# user with a non-standard naming convention can override this single
# function without touching the engine.
# ---------------------------------------------------------------------------

def _occurrence_ancestor_names(body):
    """Yield lowercased component names from body.assemblyContext walked
    up to the root, plus the immediate parentComponent.

    Order: innermost -> outermost. Caller can `any('foo' in n for n in ...)`
    without caring about depth.
    """
    try:
        pc = body.parentComponent
        if pc and pc.name:
            yield pc.name.lower()
    except Exception:
        pass

    try:
        occ = body.assemblyContext
    except Exception:
        occ = None
    while occ is not None:
        try:
            comp = occ.component
            if comp and comp.name:
                yield comp.name.lower()
        except Exception:
            pass
        try:
            occ = occ.assemblyContext
        except Exception:
            break


def _classify_body(body):
    try:
        bname = (body.name or '').lower()
    except Exception:
        bname = ''

    # 1. Frame bodies: explicit name prefix from the extrusion engine.
    if bname.startswith('frame_'):
        return 'frame'

    # 2. Walk the occurrence ancestry -- panels live inside the
    # "B-Spline Set" component, often two levels deep.
    ancestors = list(_occurrence_ancestor_names(body))
    if any('b-spline set' in n or 'bspline set' in n for n in ancestors):
        return 'panel'

    # 3. Loose fallbacks for non-standard scenes.
    if 'panel' in bname or 'bspline' in bname or 'b-spline' in bname:
        return 'panel'
    if 'frame' in bname:
        return 'frame'

    return 'unknown'


def _enumerate_bodies(design):
    """Walk every component (root + occurrences) and yield BRepBody refs."""
    if not design:
        return
    try:
        for body in design.rootComponent.bRepBodies:
            yield body
    except Exception:
        pass

    try:
        for occ in design.rootComponent.allOccurrences:
            try:
                for body in occ.component.bRepBodies:
                    yield body
            except Exception:
                continue
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Palette handlers
# ---------------------------------------------------------------------------

class _CmdCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            _show_palette()
        except Exception:
            _log_error("CmdCreated\n" + traceback.format_exc())


class _HtmlEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        try:
            data = json.loads(args.data) if args.data else {}
            action = data.get('action')
            if action == 'generate':
                _do_generate()
            elif action == 'preview':
                _do_preview()
            else:
                _log(f"unknown HTML action: {action!r}", "WARNING")
        except Exception:
            _log_error("HtmlEvent\n" + traceback.format_exc())


def _show_palette():
    app = adsk.core.Application.get()
    ui = app.userInterface

    if not os.path.exists(PALETTE_URL):
        ui.messageBox(f"CAM Builder HTML not found at {PALETTE_URL}")
        _log_error(f"missing palette html: {PALETTE_URL}")
        return

    palette = ui.palettes.itemById(PALETTE_ID)
    if not palette:
        palette = ui.palettes.add(
            PALETTE_ID, PALETTE_NAME, PALETTE_URL,
            True,  # isVisible
            True,  # showCloseButton
            True,  # isResizable
            PALETTE_WIDTH, PALETTE_HEIGHT,
        )
        try:
            palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
            palette.setMinimumSize(360, 500)
        except Exception:
            pass
        global _html_handler
        _html_handler = _HtmlEventHandler()
        palette.incomingFromHTML.add(_html_handler)
        _handlers.append(_html_handler)
    palette.isVisible = True


def _send_to_html(action, payload):
    try:
        ui = adsk.core.Application.get().userInterface
        palette = ui.palettes.itemById(PALETTE_ID)
        if palette:
            palette.sendInfoToHTML(action, json.dumps(payload))
    except Exception:
        _log_error("send_to_html\n" + traceback.format_exc())


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def _do_preview():
    """Read-only dry run: classify every body and stream the result back."""
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    if not design:
        _send_to_html('preview', {
            'ok': False,
            'msg': 'No active Design product.'
        })
        return

    counts = {'frame': 0, 'panel': 0, 'unknown': 0}
    samples = {'frame': [], 'panel': [], 'unknown': []}
    for body in _enumerate_bodies(design):
        kind = _classify_body(body)
        counts[kind] = counts.get(kind, 0) + 1
        if len(samples[kind]) < 5:
            try:
                samples[kind].append(body.name or '<unnamed>')
            except Exception:
                samples[kind].append('<unnamed>')

    _log(f"PREVIEW: counts={counts}")
    _send_to_html('preview', {
        'ok': True,
        'counts': counts,
        'samples': samples,
    })


def _do_generate():
    """Pass 1: build 3 MMs (no body filter) + 4 Setups."""
    # Always reload the engine on each generate so iterative edits to
    # cam_engine.* (mm_builder, setup_builder, etc.) pick up without an
    # addin Stop/Start. The cost is a handful of imports, negligible
    # compared to the actual MM/Setup build time.
    try:
        _load_engine()
    except Exception:
        _log_error("engine load failed\n" + traceback.format_exc())
        _send_to_html('report', {
            'ok': False,
            'errors': ['Engine load failed -- see log.']
        })
        return

    try:
        report = _engine.run(classifier=_classify_body, logger=_logger)
    except Exception:
        _log_error("engine.run failed\n" + traceback.format_exc())
        _send_to_html('report', {
            'ok': False,
            'errors': ['Engine.run raised -- see log.']
        })
        return

    _send_to_html('report', report)

    # Auto-close on success: the user clicked Generate, the run
    # completed cleanly, and at this point they're sitting in the
    # Manufacture workspace where the new Setups + MMs already show
    # in Fusion's CAM browser. Keeping the palette open just covers
    # the result. On failure we leave it open so the error list is
    # still visible. We hide rather than delete so the palette can be
    # re-opened from the toolbar without re-registering handlers.
    if report.get('ok'):
        try:
            ui = adsk.core.Application.get().userInterface
            palette = ui.palettes.itemById(PALETTE_ID)
            if palette:
                palette.isVisible = False
                _log("CAM Builder: auto-closed palette on successful generate")
        except Exception:
            _log_error("auto-close on success failed\n" + traceback.format_exc())


# ---------------------------------------------------------------------------
# Refresh CustomEvent (hot-reload)
# ---------------------------------------------------------------------------

class _DeferredRefreshHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            stop(None)
            run(None)
        except Exception:
            _log_error("deferred refresh\n" + traceback.format_exc())


def _register_refresh_event():
    """Register the deferred-refresh CustomEvent. Always unregisters any
    pre-existing event by the same id first so a previous addin lifecycle
    leaving a stale handler around doesn't double-fire. Idempotent: safe
    to call repeatedly across run/stop cycles."""
    global _refresh_event, _refresh_registered, _refresh_handlers
    try:
        app = adsk.core.Application.get()
        if not app:
            return
        try:
            app.unregisterCustomEvent(REFRESH_EVENT_ID)
        except Exception:
            pass
        _refresh_handlers = []  # let GC the old ones
        _refresh_event = app.registerCustomEvent(REFRESH_EVENT_ID)
        h = _DeferredRefreshHandler()
        _refresh_event.add(h)
        _refresh_handlers.append(h)
        _refresh_registered = True
    except Exception:
        _refresh_registered = False
        _refresh_event = None
        _log_error("_register_refresh_event\n" + traceback.format_exc())


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def run(context):
    """Add-in entry point. Defensive: every step is wrapped so a partial
    Fusion state (orphan command def, leftover panel control, missing
    resource folder, etc.) doesn't poison the rest of the boot. If
    something fails mid-run we call stop() to wind back down rather than
    leaving half-registered handlers and orphaned UI elements behind.
    """
    booted_ok = False
    try:
        # 1. Best-effort: clean any leftover state from a prior crash/reload.
        # stop() is idempotent and tolerant of missing pieces, so it's safe
        # to invoke even on a fresh boot.
        try:
            stop(None)
        except Exception:
            # stop() should not raise (it has its own try/excepts), but
            # if it does we still want to attempt run() — log and continue.
            _log_error("pre-run stop() raised\n" + traceback.format_exc())

        # 2. Refresh event + engine load. Engine load failure is fatal for
        # the addin (no point registering a button that won't work), so
        # we re-raise to land in the outer handler.
        _register_refresh_event()
        _load_engine()

        app = adsk.core.Application.get()
        if not app:
            _log_error("run(): Application.get() returned None")
            return
        ui = app.userInterface
        if not ui:
            _log_error("run(): no userInterface")
            return
        cmd_defs = ui.commandDefinitions

        # 3. Purge prior versions of our commands. Best-effort per id.
        for cid in (CMD_ID, RELOAD_CMD_ID):
            try:
                ex = cmd_defs.itemById(cid)
                if ex:
                    ex.deleteMe()
            except Exception:
                pass

        # 4. Register the visible button. Tolerate missing resources path
        # by passing '' (Fusion shows a default icon).
        try:
            icon_dir = RESOURCES_PATH if os.path.isdir(RESOURCES_PATH) else ''
            cmd_def = cmd_defs.addButtonDefinition(
                CMD_ID, 'CAM Builder',
                'Build the 3 Manufacturing Models + 4 Setups for the Ultimate Bee CNC.',
                icon_dir,
            )
        except Exception:
            _log_error("run(): addButtonDefinition failed\n" + traceback.format_exc())
            return  # outer try will run finally cleanup if booted_ok stays False

        try:
            on_created = _CmdCreatedHandler()
            cmd_def.commandCreated.add(on_created)
            _handlers.append(on_created)
        except Exception:
            _log_error("run(): commandCreated.add failed\n" + traceback.format_exc())
            return

        # 5. Drop the button into the shared bsplinePanel on every tab
        # where the unified addin set one up (Solid, Sketch, Milling).
        # Per-tab/per-panel failures don't abort the whole boot.
        added_any = False
        try:
            for tab in ui.allToolbarTabs:
                try:
                    for panel in tab.toolbarPanels:
                        try:
                            if not panel.id.startswith(PANEL_ID):
                                continue
                            ctrl = panel.controls.itemById(CMD_ID)
                            if not ctrl:
                                ctrl = panel.controls.addCommand(cmd_def)
                                added_any = True
                                _log(f"button added to {panel.id} on tab {tab.id}")
                            try:
                                ctrl.isPromoted = True
                                ctrl.isPromotedByDefault = True
                            except Exception:
                                pass
                        except Exception:
                            continue
                except Exception:
                    continue
        except Exception:
            _log_error("run(): toolbar walk failed\n" + traceback.format_exc())

        if not added_any:
            # The addin still works (the command def exists), but the user
            # has no button to click. Likely the bsplinePanel hasn't been
            # set up yet (other addin loaded later). Log + carry on.
            _log("run(): no bsplinePanel found yet; button will not appear "
                 "until the host addin registers the panel.", "WARNING")

        booted_ok = True
        _log("CAM-builder run() complete")
    except Exception:
        _log_error("run() failed\n" + traceback.format_exc())
    finally:
        if not booted_ok:
            # Partial boot — wind back down so we don't leave orphaned
            # state for the next start.
            try:
                stop(None)
            except Exception:
                _log_error("post-failure stop() raised\n" + traceback.format_exc())


def stop(context):
    """Tear down everything the addin registered. Idempotent: safe to call
    multiple times, safe to call on a partially-booted state, safe to call
    when Fusion is mid-shutdown (Application.get() may return None).
    """
    global _html_handler, _engine, _logger
    global _refresh_event, _refresh_registered

    app = None
    ui = None
    try:
        app = adsk.core.Application.get()
    except Exception:
        app = None
    if app is not None:
        try:
            ui = app.userInterface
        except Exception:
            ui = None

    # 1. Palette: hide + delete + drop the html handler reference.
    if ui is not None:
        try:
            palette = ui.palettes.itemById(PALETTE_ID)
            if palette:
                try: palette.isVisible = False
                except Exception: pass
                try: palette.deleteMe()
                except Exception: pass
        except Exception:
            pass
    _html_handler = None  # lose the reference even if Fusion is gone

    # 2. Remove button controls from any panel they ended up in.
    if ui is not None:
        try:
            for tab in ui.allToolbarTabs:
                try:
                    for panel in tab.toolbarPanels:
                        try:
                            if not panel.id.startswith(PANEL_ID):
                                continue
                            ctrl = panel.controls.itemById(CMD_ID)
                            if ctrl:
                                try: ctrl.deleteMe()
                                except Exception: pass
                        except Exception:
                            continue
                except Exception:
                    continue
        except Exception:
            pass

    # 3. Remove command definitions.
    if ui is not None:
        try:
            cmd_defs = ui.commandDefinitions
            for cid in (CMD_ID, RELOAD_CMD_ID):
                try:
                    cd = cmd_defs.itemById(cid)
                    if cd:
                        cd.deleteMe()
                except Exception:
                    pass
        except Exception:
            pass

    # 4. Unregister the deferred-refresh CustomEvent and drop its handlers.
    if app is not None:
        try:
            app.unregisterCustomEvent(REFRESH_EVENT_ID)
        except Exception:
            pass
    _refresh_event = None
    _refresh_registered = False
    _refresh_handlers.clear()

    # 5. Clear per-run handlers (CommandCreated etc).
    _handlers.clear()

    # 6. Drop engine + logger references so a subsequent run() starts fresh.
    # Don't destroy the logger — it just owns a file handle and Python GC
    # will close it.
    _engine = None
    _logger = None


# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

def _log(msg, level="INFO"):
    if _logger:
        try:
            _logger.log(msg, level)
        except Exception:
            pass


def _log_error(msg):
    _log("ERROR: " + msg, "ERROR")
