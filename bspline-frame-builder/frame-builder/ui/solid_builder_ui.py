"""
Extrude Frame palette — focused on face selection and frame extrusion.
Auto-closes after a successful extrude.

Runs on the shared palette scaffold (FB2 slice b) — see palette_scaffold.py
and FB2-PALETTE-SCAFFOLD-DESIGN.md. Everything left in this file is
genuinely solid-specific: face-pick selection state and the extrude call.
"""
import adsk.core, adsk.fusion, traceback
import os, json, sys

# Add parent directory to sys.path so we can import from core folders (engine, utils, etc.)
current_dir = os.path.dirname(os.path.realpath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)
# palette_scaffold.py lives alongside this file, in ui/ itself (not a
# package) — that directory is never otherwise on sys.path (only its
# PARENT is, for `from fb_engine import ...`), so add it here (FB2).
if current_dir not in sys.path:
    sys.path.append(current_dir)

from palette_scaffold import PaletteSpec, _PaletteBridgeMixin, make_palette

# Modular imports - initialized by the Entry Point (bspline-frame-builder.py)
frame_engine = None
from fb_engine import solid_coordinator

# Standard Logger setup
try:
    from fb_utils import fb_logger as logger
    diag_logger = logger.DebugLogger(parent_dir)
except Exception:
    diag_logger = None

PALETTE_ID = 'frameSolidBuilderPalette'
PALETTE_NAME = 'Extrude Frame'
PALETTE_HTML = 'html/solid_builder_palette.html'

BUILD_SOLID_CMD_ID = 'frameSolidBuildCommand'


if diag_logger:
    diag_logger.log("SOLID BUILDER UI MODULE: Loaded")


class PaletteHTMLEventHandler(_PaletteBridgeMixin, adsk.core.HTMLEventHandler):
    def __init__(self, diag_logger=None):
        super().__init__()
        self.diag_logger = diag_logger
        self.selected_face = None

    def notify(self, args):
        try:
            event_args = adsk.core.HTMLEventArgs.cast(args)
            if not event_args: return

            action = event_args.action
            data_str = event_args.data

            if self.diag_logger:
                self.diag_logger.log(f">>> SOLID UI EVENT: {action} | DATA: {data_str[:100]}...")

            try:
                data = json.loads(data_str)
            except Exception:
                data = {}

            app = adsk.core.Application.get()
            ui = app.userInterface

            if action == 'pick_face':
                self._handle_face_selection(ui)

            elif action == 'run_build':
                self._run_solid_build(data)

            elif action == 'ping':
                self._send_palette_message(ui.palettes.itemById(PALETTE_ID), 'response', {'data': 'PONG'})
                # Piggyback the deployed version stamp on the ping/pong handshake.
                self._send_build_info(ui.palettes.itemById(PALETTE_ID))

        except Exception:
            if self.diag_logger: self.diag_logger.log_error(f"SolidPaletteHTMLEvent ERROR:\n{traceback.format_exc()}")

    def _handle_face_selection(self, ui):
        pal = ui.palettes.itemById(PALETTE_ID)
        try:
            if self.diag_logger: self.diag_logger.log("FACE SELECTION TRIGGERED")
            self._send_palette_message(pal, 'status_update', {'msg': 'Awaiting face selection in Fusion...'})

            try:
                if hasattr(ui, 'activeSelections') and ui.activeSelections.count > 0:
                    ui.activeSelections.clear()
            except Exception:
                pass

            # selectEntity raises RuntimeError on user-cancel (Escape) on
            # some Fusion builds instead of returning None. Treat any
            # exception here as cancel and bail out cleanly — retrying
            # selectEntity while Fusion is mid-teardown of its prior
            # selection prompt yields
            # 'InternalValidationError: selections.size() > 0' and can
            # leave the UI in a state where downstream addins (e.g.
            # STEP Editor) fail to boot because their workspace product
            # binding hasn't settled yet.
            sel = None
            try:
                sel = ui.selectEntity('Select a face for extrusion', 'Faces')
            except Exception as e1:
                if self.diag_logger:
                    self.diag_logger.log(f"Face selection cancelled or failed (treated as cancel): {e1}")
                sel = None

            if sel:
                self.selected_face = adsk.fusion.BRepFace.cast(sel.entity)
                if self.diag_logger:
                    self.diag_logger.log(f"FACE SELECTED: {self.selected_face.tempId} on body {self.selected_face.body.name}")
                payload = {
                    'success': True,
                    'name': f"1 Face Selected: {self.selected_face.body.name}",
                    'body_name': self.selected_face.body.name,
                    'face_id': self.selected_face.tempId,
                    'count': 1
                }
                self._send_palette_message(pal, 'status_update', {'msg': 'Face selected successfully.'})
                self._send_palette_message(pal, 'selection_result', payload)
            else:
                self._send_palette_message(pal, 'status_update', {'msg': 'Face selection cancelled.'})
                self._send_palette_message(pal, 'selection_result', {'success': False})
        except Exception as e:
            if self.diag_logger:
                self.diag_logger.log_error(f"Face selection CRITICAL ERROR:\n{traceback.format_exc()}")
            self._send_palette_message(pal, 'status_update', {'msg': f'Selection Error: {str(e)}'})
            self._send_palette_message(pal, 'selection_result', {'success': False})

    def _run_solid_build(self, data):
        if not self.selected_face:
            if self.diag_logger: self.diag_logger.log("Solid build aborted: No face selected")
            ui = adsk.core.Application.get().userInterface
            ui.messageBox("Please select a target face first.")
            return

        if self.diag_logger: self.diag_logger.log(f"Scheduling solid build with face: {self.selected_face.tempId}")
        request_data = dict(data)
        request_data['to_face'] = self.selected_face
        _palette.schedule_hidden_build(request_data)


def _build_fn(data, ctx):
    """PaletteSpec.build_fn: runs the actual solid extrude from the hidden command's queued request."""
    try:
        if ctx.diag_logger: ctx.diag_logger.log("RUN SOLID BUILD (hidden command) triggered")

        ctx.set_status("Building solid frame…")

        solid_coordinator.build_solid_logic_v3(
            to_face=data.get('to_face'),
            start_offset_expr=data.get('offset', '-1 in'),
            appearance_name=data.get('appearance', 'Polished Chrome'),
            external_logger=ctx.diag_logger
        )
        ctx.set_status("Solid frame complete")
        ctx.notify_status("Solid Build Complete")
        # Auto-close on success
        ctx.close_palette()
    except Exception as e:
        short = str(e).split('\n')[0][:120]
        ctx.set_status(f"Solid build failed: {short} — see log")
        if ctx.diag_logger: ctx.diag_logger.log_error(f"Solid Build Logic Failed:\n{traceback.format_exc()}")


def _make_html_handler(diag_logger):
    return PaletteHTMLEventHandler(diag_logger=diag_logger)


_spec = PaletteSpec(
    palette_id=PALETTE_ID,
    name=PALETTE_NAME,
    html_path=PALETTE_HTML,
    size=(380, 460),
    min_size=(320, 360),
    build_cmd_id=BUILD_SOLID_CMD_ID,
    build_fn=_build_fn,
    make_html_handler=_make_html_handler,
    extra_commands=(),
    on_document_activated=None,
    on_ready=None,
)

_palette = make_palette(_spec)
handlers = _palette.handlers


def run_palette(engine_instance, diag_logger=None):
    """Central runner to launch the Extrude Frame palette."""
    global frame_engine
    frame_engine = engine_instance
    _palette.run_palette(engine_instance, diag_logger=diag_logger)


class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            run_palette(frame_engine, diag_logger=diag_logger)
        except Exception as e:
            if diag_logger:
                diag_logger.log_error(f"SolidBuilder CommandCreatedHandler CRASH:\n{traceback.format_exc()}")
            adsk.core.Application.get().userInterface.messageBox(f"Palette Launch Failed:\n{e}")
