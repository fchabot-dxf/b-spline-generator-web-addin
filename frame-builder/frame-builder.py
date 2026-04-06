import adsk.core, adsk.fusion, adsk.cam, traceback
import os, json, importlib, sys
import datetime

# --- EARLY EXECUTION LOG & DIAGNOSTICS ---
addin_root = os.path.dirname(os.path.realpath(__file__))
if addin_root not in sys.path:
    sys.path.append(addin_root)

try:
    from utils import logger
    importlib.reload(logger)
    diag_logger = logger.DebugLogger(addin_root)
    diag_logger.log(f"STARTUP: Script file located at {__file__}")
except Exception as e:
    # Fallback to direct write if logger fails
    try:
        with open(os.path.join(addin_root, "frame-builder-debug.log"), "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now()}] [ERROR] Logger Init Failed: {e}\n")
    except: pass

# Modular logic import with detailed diagnostics
try:
    diag_logger.log("Attempting to import frame_engine...")
    from engine import frame_engine
    importlib.reload(frame_engine)
    diag_logger.log("SUCCESS: frame_engine imported and reloaded.")
except Exception as e:
    try: 
        diag_logger.log(f"IMPORT FAILURE: {e}", "ERROR")
        diag_logger.log(traceback.format_exc(), "ERROR")
    except: pass


# Global list of event handlers to keep them alive
handlers = []

def run(context):
    ui = None
    try:
        diag_logger.log("run(context) called by Fusion 360")
        app = adsk.core.Application.get()
        ui  = app.userInterface

        # --- Configuration: Active-Document Generative Framework ---
        commands = [
            {
                'id': 'FrameSketchCommand',
                'name': 'Generate Sketch',
                'tooltip': 'Auto-Fit Master Skeleton to the active model',
                'logic': frame_engine.build_sketch_logic
            },
            {
                'id': 'FrameBuildCommand',
                'name': 'Create Frame',
                'tooltip': 'Synthesize 4-body frame around active model',
                'logic': frame_engine.build_frame_logic
            }
        ]

        current_dir = os.path.dirname(os.path.realpath(__file__))
        cmd_defs = ui.commandDefinitions

        # --- 1. Register generative commands ---
        for cmd_info in commands:
            cmd_id = cmd_info['id']
            res_path = os.path.join(current_dir, 'resources', cmd_id)

            # Cleanup
            try:
                existing_def = cmd_defs.itemById(cmd_id)
                if existing_def: existing_def.deleteMe()
            except: pass

            new_def = cmd_defs.addButtonDefinition(cmd_id, cmd_info['name'], cmd_info['tooltip'], res_path)
            on_created = CommandCreatedHandler(cmd_info['logic'])
            new_def.commandCreated.add(on_created)
            handlers.append(on_created)

        # --- 2. Add all buttons to UI ---
        all_tabs = ui.allToolbarTabs
        target_tab_ids = ['SolidTab', 'DesignTab', 'FusionSolidTab']
        
        for tab in all_tabs:
            tid = tab.id
            if tid in target_tab_ids or 'Sketch' in tid:
                try:
                    # 1. Generative Commands (FRAME panel)
                    frame_panel = tab.toolbarPanels.itemById('FrameBuilderPanel')
                    if not frame_panel:
                        frame_panel = tab.toolbarPanels.add('FrameBuilderPanel', 'FRAME')
                    
                    for cmd_info in commands:
                        cid = cmd_info['id']
                        if not frame_panel.controls.itemById(cid):
                            frame_panel.controls.addCommand(ui.commandDefinitions.itemById(cid))

                    # 2. No inspector extension in this mode
                    # (keep only the frame builder UI commands)
                    pass
                except:
                    # ignore toolbar insertion errors for the core flow
                    pass

        # --- 4. No inspector listener to start (inspector removed) ---

    except:
        if ui: ui.messageBox('Frame Builder Failed:\n{}'.format(traceback.format_exc()))

def stop(context):
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        cmd_defs = ui.commandDefinitions

        # Remove command definitions
        for cmd_id in ['FrameSketchCommand', 'FrameBuildCommand']:
            try:
                cmd_def = cmd_defs.itemById(cmd_id)
                if cmd_def:
                    cmd_def.deleteMe()
            except: pass

        # Remove panels from all tabs
        for tab_id in ['SolidTab', 'SketchTab', 'DesignTab']:
            try:
                tab = ui.allToolbarTabs.itemById(tab_id)
                if tab:
                    panel = tab.toolbarPanels.itemById('FrameBuilderPanel')
                    if panel:
                        panel.deleteMe()
            except: pass
    except:
        pass

# --- Standard Handlers ---
class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, action_func):
        super().__init__()
        self.action_func = action_func
    def notify(self, args):
        try:
            event_args = adsk.core.CommandCreatedEventArgs.cast(args)
            cmd = event_args.command
            inputs = cmd.commandInputs

            # Synthesis rule dropdown for multi-template support
            rules = ["Signature (Template 1)", "Signature (Template 2)", "Signature (Template 3)"]
            drop_rule = inputs.addDropDownCommandInput('style_select', 'Synthesis Rule', adsk.core.DropDownStyles.LabeledIconDropDownStyle)
            for r in rules:
                is_selected = (r == "Signature (Template 1)")
                drop_rule.listItems.add(r, is_selected, '', -1)

            # Arc radius inputs (3 pairs — L/R share same value)
            # Each needs its own ValueInput (Fusion consumes the object)
            inputs.addValueInput('rad_shoulder', 'Shoulder Radius', 'in', adsk.core.ValueInput.createByString("1 in"))
            inputs.addValueInput('rad_waist', 'Waist Radius', 'in', adsk.core.ValueInput.createByString("1 in"))
            inputs.addValueInput('rad_hip', 'Hip Radius', 'in', adsk.core.ValueInput.createByString("1 in"))

            on_execute = CommandExecuteHandler(self.action_func)
            cmd.execute.add(on_execute)
            handlers.append(on_execute)
        except:
            try: diag_logger.log_error(f"CommandCreated CRASH:\n{traceback.format_exc()}")
            except: pass

class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self, action_func):
        super().__init__()
        self.action_func = action_func
    def notify(self, args):
        try:
            event_args = adsk.core.CommandEventArgs.cast(args)
            cmd = event_args.command
            inputs = cmd.commandInputs

            sel_style = inputs.itemById('style_select').selectedItem
            joint_prefix = "joint"

            # Read arc radius values (in cm — Fusion internal units)
            radii = {}
            for rid in ['rad_shoulder', 'rad_waist', 'rad_hip']:
                val_input = inputs.itemById(rid)
                if val_input:
                    radii[rid] = val_input.value  # value is in cm (internal)

            # Create/update user parameters for the radii
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            user_params = design.userParameters
            for name, val_cm in radii.items():
                existing = user_params.itemByName(name)
                if existing:
                    existing.value = val_cm
                else:
                    user_params.add(name, adsk.core.ValueInput.createByReal(val_cm), "cm", "")

            if sel_style:
                self.action_func(sel_style.name, joint_prefix)
        except:
            try: diag_logger.log_error(f"CommandExecute CRASH:\n{traceback.format_exc()}")
            except: pass
