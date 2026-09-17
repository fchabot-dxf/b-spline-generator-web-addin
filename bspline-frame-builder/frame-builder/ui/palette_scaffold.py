"""
palette_scaffold.py — DECLARED shape for a hidden-command Fusion palette (FB2).

Sketch Builder and Extrude Frame each wire an HTML palette to a hidden button
commandDefinition that Fusion lets fire OUTSIDE the HTML event handler's own
call stack — some Fusion API calls are unsafe to call directly from inside an
HTMLEventHandler, so both palettes defer the real work through a hidden
command's execute event instead. This module DECLARES that wiring once: a
PaletteSpec describes what is specific to one builder; make_palette(spec)
returns the generic run/stop surface bspline-frame-builder.py's
_teardown_submodules() reads (`handlers`, cleared via `.clear()`; a builder
that populates on_document_activated must re-export the returned
doc-activated handler under the module attribute `_doc_activated_handler`,
since that is the exact name the parent's `getattr` looks for).

See FB2-PALETTE-SCAFFOLD-DESIGN.md for the diff map and 3-slice migration
plan; this file implements slice (a)'s declaration (design doc §2/§3).
"""
import adsk.core, adsk.fusion, traceback
import os, json
import types

_current_dir = os.path.dirname(os.path.realpath(__file__))


class PaletteSpec:
    """Everything specific to ONE hidden-command palette.

    build_fn(data, ctx): the one thing every builder's actual work differs
    by. ctx carries the injected frame_engine (a builder may not use it —
    see the design doc's note on solid's currently-unused injected engine),
    the active diag_logger, the generic status/notify/close helpers, the
    live PaletteHTMLEventHandler instance (`ctx.active_handler`), and this
    spec itself.

    extra_commands: tuple of (cmd_id, cmd_name, execute_fn) triples for any
    hidden command besides the main build one (e.g. sketch's schema-push).
    execute_fn takes no arguments — a builder that needs to pass data
    through its OWN extra hidden command manages that data's storage itself
    (see sketch's _pending_schema_style), the same way it always has; only
    the MAIN build command's pending payload is scaffold-managed, via
    schedule_hidden_build(data) below.

    make_html_handler(diag_logger): returns this builder's own
    PaletteHTMLEventHandler instance. Kept caller-supplied rather than
    scaffold-owned — see the design doc §3 for why the two builders' HTML
    dispatch tables are genuinely different business logic, not a shared
    shape the scaffold should force.

    on_document_activated(ctx): called on app.documentActivated IF NOT None.
    on_ready(ctx): called once at the end of run_palette IF NOT None.
    Neither is a name check on which builder this is — a builder simply
    leaves the field None when it doesn't need the hook. Nothing in this
    module ever checks "is this the sketch builder" — every builder-specific
    behaviour is a field being populated or left None.
    """
    def __init__(self, palette_id, name, html_path, size, min_size,
                 build_cmd_id, build_fn, make_html_handler,
                 extra_commands=(), on_document_activated=None, on_ready=None):
        self.palette_id = palette_id
        self.name = name
        self.html_path = html_path
        self.size = size
        self.min_size = min_size
        self.build_cmd_id = build_cmd_id
        self.build_fn = build_fn
        self.make_html_handler = make_html_handler
        self.extra_commands = extra_commands
        self.on_document_activated = on_document_activated
        self.on_ready = on_ready


class _PaletteBridgeMixin:
    """The two PaletteHTMLEventHandler methods that were byte-identical
    between sketch_builder_ui.py and solid_builder_ui.py before this
    scaffold existed (design doc §3) — moved here verbatim. A builder's own
    PaletteHTMLEventHandler subclasses this alongside
    adsk.core.HTMLEventHandler and keeps its own bespoke action dispatch in
    notify(). Requires self.diag_logger to be set by the subclass."""

    def _send_palette_message(self, pal, action, payload):
        try:
            if not pal:
                return False
            pal.sendInfoToHTML(action, json.dumps(payload))
            return True
        except Exception as e:
            if self.diag_logger: self.diag_logger.log_error(f"Palette sendInfoToHTML failed ({action}): {e}")
            return False

    def _send_build_info(self, pal):
        """Best-effort version stamp: read build-info.json (add-in ROOT) via
        fb_shared, compare to source HEAD, push to the header badge. Fully
        wrapped — never breaks the palette. See fb_shared.build_info."""
        try:
            import os as _os, sys as _sys
            _root = _os.path.dirname(_os.path.abspath(__file__))
            for _ in range(6):  # walk up to the dir holding fb_shared (= add-in root)
                if _os.path.isdir(_os.path.join(_root, 'fb_shared')):
                    break
                _root = _os.path.dirname(_root)
            if _root not in _sys.path:
                _sys.path.insert(0, _root)
            from fb_shared import build_info as _bi
            info = _bi.read_build_info(_root)
            status, message = _bi.compare_to_source(info)
            if pal:
                pal.sendInfoToHTML('build_info', json.dumps({
                    'sha': info.get('sha'), 'built_at': info.get('built_at'),
                    'dirty': info.get('dirty'), 'status': status, 'message': message,
                }))
        except Exception:
            pass


def _make_hidden_command_pair(cmd_id, execute_fn, handlers, log_error):
    """Return a fresh CommandCreatedHandler bound to (cmd_id, execute_fn) via
    THIS CALL's OWN parameters — never a closure over an enclosing loop
    variable (advisor amendment 2 on the FB2 design). Each call defines
    brand-new nested classes, so two hidden commands registered in the same
    _ensure_hidden_commands() loop never share captured state; a shared
    class/closure across loop iterations would let the LAST-registered
    command's execute_fn silently win for every command (Python's classic
    late-binding-closure trap). Proven in the headless smoke in WORK-LOG."""

    class _ExecHandler(adsk.core.CommandEventHandler):
        def notify(self, args):
            try:
                execute_fn()
            except Exception:
                log_error(f"{cmd_id} execute CRASH:\n{traceback.format_exc()}")

    class _CreatedHandler(adsk.core.CommandCreatedEventHandler):
        def notify(self, args):
            try:
                cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
                h = _ExecHandler()
                cmd.execute.add(h)
                handlers.append(h)
            except Exception:
                log_error(f"{cmd_id} CommandCreated CRASH:\n{traceback.format_exc()}")

    return _CreatedHandler()


def _make_doc_activated_handler(on_activated, build_ctx):
    class _DocActivatedHandler(adsk.core.DocumentEventHandler):
        def notify(self, args):
            try:
                on_activated(build_ctx())
            except Exception:
                pass
    return _DocActivatedHandler()


def make_palette(spec):
    """Build the generic run/stop surface for one hidden-command palette
    from a declared PaletteSpec."""
    handlers = []
    _state = {'frame_engine': None, 'diag_logger': None,
              'active_handler': None, 'doc_activated_handler': None,
              'pending_build': None}

    def _log_error(msg):
        dl = _state['diag_logger']
        if dl:
            dl.log_error(msg)

    def set_status(msg):
        try:
            app = adsk.core.Application.get()
            if app:
                app.userInterface.statusBarMessage = msg
        except Exception:
            pass

    def notify_status(msg):
        try:
            pal = adsk.core.Application.get().userInterface.palettes.itemById(spec.palette_id)
            if pal:
                pal.sendInfoToHTML('status_update', json.dumps({'msg': msg}))
        except Exception:
            pass

    def close_palette():
        try:
            pal = adsk.core.Application.get().userInterface.palettes.itemById(spec.palette_id)
            if pal:
                pal.isVisible = False
        except Exception:
            pass

    def _build_ctx():
        return types.SimpleNamespace(
            frame_engine=_state['frame_engine'],
            diag_logger=_state['diag_logger'],
            set_status=set_status,
            notify_status=notify_status,
            close_palette=close_palette,
            active_handler=_state['active_handler'],
            spec=spec,
        )

    def _run_build_execute():
        data = _state['pending_build']
        _state['pending_build'] = None
        if data is None:
            return
        spec.build_fn(data, _build_ctx())

    def schedule_hidden_build(data):
        _state['pending_build'] = data
        dl = _state['diag_logger']
        if dl: dl.log(f"DISPATCH: queued build for '{spec.palette_id}'")
        try:
            app = adsk.core.Application.get()
            if not app:
                return
            cmd_def = app.userInterface.commandDefinitions.itemById(spec.build_cmd_id)
            if cmd_def:
                cmd_def.execute()
            else:
                _log_error(f"DISPATCH ABORT: '{spec.build_cmd_id}' not found")
        except Exception:
            _log_error(f"Build dispatch failed:\n{traceback.format_exc()}")

    def _ensure_hidden_commands(ui):
        """Delete-then-recreate each hidden command, in order, per entry —
        never batch all deletes before all creates (a Fusion command def
        must not be briefly double-registered under one id)."""
        try:
            cmd_defs = ui.commandDefinitions
            all_commands = [(spec.build_cmd_id, spec.name, _run_build_execute)]
            all_commands.extend(spec.extra_commands)
            for cmd_id, cmd_name, execute_fn in all_commands:
                existing = cmd_defs.itemById(cmd_id)
                if existing:
                    try:
                        existing.deleteMe()
                    except Exception:
                        pass
                if cmd_defs.itemById(cmd_id):
                    continue
                cmd_def = cmd_defs.addButtonDefinition(cmd_id, cmd_name, '', '')
                created_handler = _make_hidden_command_pair(cmd_id, execute_fn, handlers, _log_error)
                cmd_def.commandCreated.add(created_handler)
                handlers.append(created_handler)
        except Exception:
            _log_error(f"_ensure_hidden_commands FAILED:\n{traceback.format_exc()}")

    def run_palette(engine_instance, diag_logger=None):
        _state['frame_engine'] = engine_instance
        _state['diag_logger'] = diag_logger
        if diag_logger:
            diag_logger.log(f"{spec.palette_id} run_palette: engine injected = {engine_instance is not None}")

        try:
            app = adsk.core.Application.get()
            ui = app.userInterface

            # 1. Cleanup any old palette
            existing = ui.palettes.itemById(spec.palette_id)
            if existing:
                existing.deleteMe()

            # 2. Create
            html_path = os.path.join(_current_dir, spec.html_path).replace('\\', '/')
            w, h = spec.size
            mw, mh = spec.min_size
            pal = ui.palettes.add(spec.palette_id, spec.name, html_path, True, True, True, w, h)
            pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
            pal.setMinimumSize(mw, mh)

            # 3. Bridge — the caller supplies its own PaletteHTMLEventHandler
            # subclass instance; the scaffold just wires + tracks it.
            active_handler = spec.make_html_handler(diag_logger)
            pal.incomingFromHTML.add(active_handler)
            pal.handler_anchor = active_handler
            handlers.append(active_handler)
            _state['active_handler'] = active_handler

            # 3b. Doc-switch refresh — only if this builder asked for it.
            if spec.on_document_activated is not None:
                try:
                    old = _state['doc_activated_handler']
                    if old is not None:
                        app.documentActivated.remove(old)
                except Exception:
                    pass
                doc_handler = _make_doc_activated_handler(spec.on_document_activated, _build_ctx)
                app.documentActivated.add(doc_handler)
                handlers.append(doc_handler)
                _state['doc_activated_handler'] = doc_handler

            # 4. Show
            pal.isVisible = True

            # 5. Hidden commands
            _ensure_hidden_commands(ui)

            # 6. Optional post-open hook (template pre-select, initial schema
            # push, tilt-param-ensure — all sketch-only; solid leaves this None).
            if spec.on_ready is not None:
                spec.on_ready(_build_ctx())

        except Exception as e:
            if diag_logger:
                diag_logger.log_error(f"FAILURE IN {spec.palette_id} run_palette: {e}\n{traceback.format_exc()}")
            raise e

    return types.SimpleNamespace(
        run_palette=run_palette,
        handlers=handlers,
        set_status=set_status,
        notify_status=notify_status,
        close_palette=close_palette,
        schedule_hidden_build=schedule_hidden_build,
        get_doc_activated_handler=lambda: _state['doc_activated_handler'],
    )
