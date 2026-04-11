import adsk.core, adsk.fusion, traceback
import os, sys, importlib

# --- EARLY EXECUTION LOG & DIAGNOSTICS ---
current_dir = os.path.dirname(os.path.realpath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

try:
    from fb_utils import fb_logger as logger
    diag_logger = logger.DebugLogger(parent_dir, category='extrude')
    diag_logger.log("SOLID BUILDER: Module Loaded & Logger Active")
except Exception:
    pass

# Nuclear Reload: Force eviction of stale engine modules from memory
for mod_name in ['fb_engine.solid_coordinator', 'solid_coordinator']:
    if mod_name in sys.modules:
        del sys.modules[mod_name]

try:
    from fb_engine import solid_coordinator
    importlib.reload(solid_coordinator) # Double-tap
except Exception as e:
    try: diag_logger.log(f"SOLID STARTUP ERROR: {e}", "ERROR")
    except: pass

class SolidCommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, action_func=None):
        super().__init__()
    def notify(self, args):
        try:
            event_args = adsk.core.CommandCreatedEventArgs.cast(args)
            cmd    = event_args.command
            inputs = cmd.commandInputs
            cmd.setDialogInitialSize(520, 380)

            # --- UI: Terminus face (canvas select) ---
            sel_face = inputs.addSelectionInput(
                'solid_face', 'Extent To Face',
                'Click a face on the body to extrude up to')
            sel_face.addSelectionFilter('Faces')
            sel_face.setSelectionLimits(1, 1)

            # --- UI: Start offset ---
            inputs.addStringValueInput('solid_start_offset', 'Start offset', '-1 in')

            # --- UI: Appearance dropdown ---
            drop_app = inputs.addDropDownCommandInput(
                'solid_appearance', 'Appearance',
                adsk.core.DropDownStyles.LabeledIconDropDownStyle)
            
            for i, ap in enumerate(solid_coordinator.APPEARANCE_PRESETS):
                drop_app.listItems.add(ap, i == 0, '', -1)

            try: diag_logger.log("SOLID CMD: Created (UI Initializing)")
            except: pass

            self.on_execute = SolidCommandExecuteHandler()
            cmd.execute.add(self.on_execute)
        except Exception:
            try: diag_logger.log_error(f"SolidCommandCreated CRASH:\n{traceback.format_exc()}")
            except: pass

class SolidCommandExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            ev     = adsk.core.CommandEventArgs.cast(args)
            inputs = ev.command.commandInputs

            try: diag_logger.log("SOLID CMD: OK Clicked (Starting Build)")
            except: pass

            sel_face_input = inputs.itemById('solid_face')
            to_face = None
            if sel_face_input and sel_face_input.selectionCount > 0:
                to_face = adsk.fusion.BRepFace.cast(sel_face_input.selection(0).entity)

            if not to_face: return

            start_offset = inputs.itemById('solid_start_offset').value
            sel_app    = inputs.itemById('solid_appearance').selectedItem
            appearance = sel_app.name if sel_app else solid_coordinator.APPEARANCE_PRESETS[0]

            try: diag_logger.log(f"SOLID CMD: Calling build_solid_logic_v3 (coordinator: {solid_coordinator.__file__})")
            except: pass

            solid_coordinator.build_solid_logic_v3(
                comp_name         = None, # handled by scavenge logic in engine
                to_face           = to_face,
                start_offset_expr = start_offset,
                appearance_name   = appearance,
                external_logger   = diag_logger
            )

            try: diag_logger.log("SOLID CMD: Build Function Dispatched")
            except: pass
        except Exception:
            try: diag_logger.log_error(f"SOLID EXECUTE CRASH:\n{traceback.format_exc()}")
            except: pass
