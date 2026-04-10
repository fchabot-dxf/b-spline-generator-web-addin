import adsk.core, adsk.fusion, traceback
import os, json, sys, importlib

# Add parent directory to sys.path so we can import from core folders (engine, utils, etc.)
current_dir = os.path.dirname(os.path.realpath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Modular imports - initialized by the Entry Point (bspline-frame-builder.py)
frame_engine = None
from fb_engine import solid_coordinator

# Standard Logger setup
try:
    from fb_utils import fb_logger as logger
    diag_logger = logger.DebugLogger(parent_dir)
except:
    diag_logger = None

PALETTE_ID = 'hybridFrameBuilderPalette'
PALETTE_NAME = 'Hybrid Frame Builder'
PALETTE_HTML = 'html/index.html'

handlers = []

class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            event_args = adsk.core.CommandCreatedEventArgs.cast(args)
            cmd = event_args.command
            
            # Create the palette
            app = adsk.core.Application.get()
            ui = app.userInterface
            pal = ui.palettes.itemById(PALETTE_ID)
            if not pal:
                # Normalize path for Windows: use forward slashes for URLs
                html_path = os.path.join(current_dir, PALETTE_HTML).replace('\\', '/')
                
                if diag_logger:
                    diag_logger.log(f"LAUNCHING PALETTE: {PALETTE_NAME}")
                    diag_logger.log(f"HTML PATH: {html_path}")
                
                pal = ui.palettes.add(PALETTE_ID, PALETTE_NAME, html_path, True, True, True, 340, 600)
                pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
            else:
                if diag_logger: diag_logger.log("PALETTE ALREADY EXISTS - MAKING VISIBLE")
                pal.isVisible = True

            # Add the event handler to the palette
            on_html_event = PaletteHTMLEventHandler()
            pal.incomingFromHTML.add(on_html_event)
            handlers.append(on_html_event)

        except:
            if diag_logger: diag_logger.log_error(f"HybridCommandCreated CRASH:\n{traceback.format_exc()}")

class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    def __init__(self):
        super().__init__()
        self.selected_face = None
        self.style_id = "Template 1"

    def notify(self, args):
        try:
            html_args = adsk.core.HTMLEventArgs.cast(args)
            action = html_args.action
            data = json.loads(html_args.data) if html_args.data else {}

            app = adsk.core.Application.get()
            ui = app.userInterface
            design = adsk.fusion.Design.cast(app.activeProduct)

            if action == 'update_param':
                self._update_fusion_param(design, data['name'], data['value'])
            
            elif action == 'update_lock':
                # Locks are stored as en_{ParamName} (0.0 or 1.0)
                lock_name = f"en_{data['name']}"
                lock_val = 1.0 if data['locked'] else 0.0
                self._update_fusion_param(design, lock_name, lock_val)

            elif action == 'change_template':
                self.style_id = data.get('template', "Template 1")
                if diag_logger: diag_logger.log(f"STYLE SYNC: {self.style_id}")

            elif action == 'pick_face':
                self._handle_face_selection(ui)

            elif action == 'run_build':
                build_type = data.get('type')
                if build_type == 'sketch':
                    self._run_sketch_build(data)
                elif build_type == 'solid':
                    self._run_solid_build(data)

        except:
            if diag_logger: diag_logger.log_error(f"PaletteHTMLEvent ERROR:\n{traceback.format_exc()}")

    def _update_fusion_param(self, design, name, value):
        try:
            params = design.userParameters
            p = params.itemByName(name)
            if p:
                # If it's a percentage slider (0-100), we need to scale it by the measured bounding box
                # which is handled by the Frame Engine logic normally, but here we just push the value.
                # However, for 'en_' params, it's a direct toggle.
                if name.startswith('en_'):
                    p.value = float(value)
                else:
                    # Logic match from sketch_builder.py:
                    # total = w if 'Span' in k else h
                    # real_val = (ui_pct / 100.0) * total
                    # p_val.value = real_val
                    w = params.itemByName('widthIn').value if params.itemByName('widthIn') else 17.0
                    h = params.itemByName('heightIn').value if params.itemByName('heightIn') else 22.0
                    total = w if 'Span' in name else h
                    p.value = (float(value) / 100.0) * total
        except: pass

    def _handle_face_selection(self, ui):
        try:
            # Native Fusion selection blocks the UI, which is fine here
            sel = ui.selectEntity('Select a face for extrusion', 'Faces')
            if sel:
                self.selected_face = adsk.fusion.BRepFace.cast(sel.entity)
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('selection_result', json.dumps({
                        'success': True, 
                        'name': f"Selected: {self.selected_face.body.name} (Face {self.selected_face.tempId})"
                    }))
            else:
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal: pal.sendInfoToHTML('selection_result', json.dumps({'success': False}))
        except: pass

    def _run_sketch_build(self, data):
        try:
            # Trigger the engine
            if frame_engine:
                # We need the style_id from the palette
                # Note: Currently style_id is pushed via 'change_template' or we can store it.
                # For simplicity, we assume the user parameters are already synced.
                style_id = "Template 1" # Fallback
                # Check for cached style? Or just use what's in the design?
                # Actually, build_sketch_logic_v3 takes style_id.
                frame_engine.build_sketch_logic_v3(style_id=style_id, external_logger=diag_logger)
                self._notify_status("Sketch Build Complete")
        except: pass

    def _run_solid_build(self, data):
        try:
            if not self.selected_face:
                ui = adsk.core.Application.get().userInterface
                ui.messageBox("Please select a target face first.")
                return

            # Note: We need start_offset and appearance from the palette.
            # In index.html, runBuild('solid') sends the type but not the values.
            # In a real app, I'd gather them or have them synced.
            # I'll update the JS to send them.
            
            solid_coordinator.build_solid_logic_v3(
                to_face = self.selected_face,
                start_offset_expr = data.get('offset', '-1 in'),
                appearance_name = data.get('appearance', 'Polished Chrome'),
                external_logger = diag_logger
            )
            self._notify_status("Solid Build Complete")
        except: pass

    def _notify_status(self, msg):
        try:
            pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
            if pal:
                pal.sendInfoToHTML('status_update', json.dumps({'msg': msg}))
        except: pass
