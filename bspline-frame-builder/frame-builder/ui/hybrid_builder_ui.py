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

_active_handler = None

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

if diag_logger:
    diag_logger.log("HYBRID UI MODULE: Loaded & Active (Nuclear Trace On)")

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
                pal.isVisible = True
            else:
                if diag_logger: diag_logger.log("PALETTE ALREADY EXISTS - MAKING VISIBLE")
                pal.isVisible = True

            # Add the event handler to the palette
            global _active_handler
            _active_handler = PaletteHTMLEventHandler()
            pal.incomingFromHTML.add(_active_handler)
            handlers.append(_active_handler)
            
            if diag_logger: diag_logger.log(f"EVENT HANDLER ATTACHED (Global Anchor): {_active_handler}")

        except:
            if diag_logger: diag_logger.log_error(f"HybridCommandCreated CRASH:\n{traceback.format_exc()}")

class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    def __init__(self):
        super().__init__()
        self.selected_face = None
        self.style_id = "Template 1"
        if diag_logger:
            diag_logger.log(f"HTMLEventHandler INSTANCE CREATED: {self}")

    def notify(self, args):
        if diag_logger:
            diag_logger.log(">>> HTMLEventHandler.notify() ENTERED")
        try:
            html_args = adsk.core.HTMLEventArgs.cast(args)
            action = html_args.action
            data = json.loads(html_args.data) if html_args.data else {}

            if diag_logger:
                diag_logger.log(f">>> UI EVENT: {action} | DATA: {json.dumps(data)}")

            app = adsk.core.Application.get()
            ui = app.userInterface
            design = adsk.fusion.Design.cast(app.activeProduct)

            if action == 'update_param':
                # FIX: UI sends 'id', not 'name'
                p_id = data.get('id') or data.get('name')
                self._update_fusion_param(design, p_id, data['value'])
            
            elif action == 'update_lock':
                # FIX: UI sends 'id', not 'name'
                p_id = data.get('id') or data.get('name')
                lock_name = f"en_{p_id}"
                lock_val = 1.0 if data.get('locked', False) else 0.0
                self._update_fusion_param(design, lock_name, lock_val)

            elif action == 'change_template':
                self.style_id = data.get('template', "Template 1")
                if diag_logger: diag_logger.log(f"STYLE SYNC: {self.style_id}")

            elif action == 'pick_face':
                self._handle_face_selection(ui)

            elif action == 'run_build':
                build_type = data.get('type')
                if diag_logger: diag_logger.log(f"RUN_BUILD TYPE: {build_type}")
                if build_type == 'sketch':
                    self._run_sketch_build(data)
                elif build_type == 'solid':
                    self._run_solid_build(data)

        except Exception as e:
            if diag_logger: diag_logger.log_error(f"PaletteHTMLEvent ERROR:\n{traceback.format_exc()}")

    def _update_fusion_param(self, design, name, value):
        try:
            if diag_logger:
                diag_logger.log(f"PARAM SYNC: {name} = {value}")
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

    def _start_undo_transaction(self, name):
        try:
            app = adsk.core.Application.get()
            if app and hasattr(app, 'startTransaction'):
                return app.startTransaction(name)
        except:
            pass
        return None

    def _commit_undo_transaction(self, transaction):
        try:
            if not transaction:
                return
            if hasattr(transaction, 'commit'):
                transaction.commit()
            elif hasattr(transaction, 'end'):
                transaction.end()
        except:
            pass

    def _abort_undo_transaction(self, transaction):
        try:
            if not transaction:
                return
            if hasattr(transaction, 'abort'):
                transaction.abort()
            elif hasattr(transaction, 'rollback'):
                transaction.rollback()
        except:
            pass

    def _run_sketch_build(self, data):
        transaction = self._start_undo_transaction('Build Skeleton')
        try:
            if diag_logger: diag_logger.log(f"RUN SKETCH BUILD triggered. Style: {self.style_id}")
            
            # Trigger the engine
            if frame_engine:
                # Use the style_id stored in the handler (synced from UI)
                style_id = self.style_id
                if diag_logger: diag_logger.log(f"Calling engine with style_id: {style_id}")
                
                frame_engine.build_sketch_logic_v3(style_id=style_id, external_logger=diag_logger)
                self._commit_undo_transaction(transaction)
                self._notify_status("Sketch Build Complete")
            else:
                if diag_logger: diag_logger.log_error("CRITICAL: frame_engine is NOT INJECTED (None)")
                ui = adsk.core.Application.get().userInterface
                ui.messageBox("Internal Error: Frame Engine not loaded.")
                self._abort_undo_transaction(transaction)

        except Exception as e:
            if diag_logger: diag_logger.log_error(f"Sketch Build Logic Failed:\n{traceback.format_exc()}")
            self._abort_undo_transaction(transaction)
            ui = adsk.core.Application.get().userInterface
            ui.messageBox(f"Sketch Build Failed:\n{e}")

    def _run_solid_build(self, data):
        transaction = self._start_undo_transaction('Build Solid Frame')
        try:
            if diag_logger: diag_logger.log("RUN SOLID BUILD triggered")

            if not self.selected_face:
                if diag_logger: diag_logger.log("Solid build aborted: No face selected")
                ui = adsk.core.Application.get().userInterface
                ui.messageBox("Please select a target face first.")
                self._abort_undo_transaction(transaction)
                return

            if diag_logger: diag_logger.log(f"Calling solid coordinator with face: {self.selected_face.tempId}")
            
            solid_coordinator.build_solid_logic_v3(
                to_face = self.selected_face,
                start_offset_expr = data.get('offset', '-1 in'),
                appearance_name = data.get('appearance', 'Polished Chrome'),
                external_logger = diag_logger
            )
            self._commit_undo_transaction(transaction)
            self._notify_status("Solid Build Complete")
        except Exception as e:
            if diag_logger: diag_logger.log_error(f"Solid Build Logic Failed:\n{traceback.format_exc()}")
            self._abort_undo_transaction(transaction)
            ui = adsk.core.Application.get().userInterface
            ui.messageBox(f"Solid Build Failed:\n{e}")

    def _notify_status(self, msg):
        try:
            pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
            if pal:
                pal.sendInfoToHTML('status_update', json.dumps({'msg': msg}))
        except: pass
