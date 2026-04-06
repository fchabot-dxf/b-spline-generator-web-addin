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
    from sketches.template_1 import template_data_1
    from sketches.template_2 import template_data_2
    from sketches.template_3 import template_data_3
    from sketches.template_4 import template_data_4
    importlib.reload(template_data_1)
    importlib.reload(template_data_2)
    importlib.reload(template_data_3)
    importlib.reload(template_data_4)
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

            # --- UI: Window Optimization ---
            cmd.setDialogInitialSize(600, 400)

            # --- STYLE SELECTION ---
            rules = ["Template 1", "Template 2", "Template 3", "Template 4"]
            drop_rule = inputs.addDropDownCommandInput('style_select', 'Synthesis Rule', adsk.core.DropDownStyles.LabeledIconDropDownStyle)
            for r in rules:
                is_selected = (r == "Template 1") # Defaulting to Template 1
                drop_rule.listItems.add(r, is_selected, '', -1)
            sel_item = drop_rule.selectedItem
            sel_name = sel_item.name if sel_item else rules[0]

            # --- SKELETON UI (Stability Guarded) ---
            grp_skel = inputs.addGroupCommandInput('grp_skel', 'Skeleton & Proportions')
            grp_skel.isExpanded = True
            skel_inputs = grp_skel.children
            skel_inputs.addTextBoxCommandInput('skel_status', 'Status', '<b>0/4 Locked | STABLE</b>', 1, True)

            drivers = [
                ('ShoulderSpan', 'Shoulder Width'),
                ('WaistSpan',    'Waist Width'),
                ('HipSpan',      'Hip Width'),
                ('TopGap',       'Top Aperture'),
                ('BottomGap',    'Bottom Aperture')
            ]

            # Fetch existing parameter state to initialize the UI
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            up = design.userParameters
            
            # Get current bounding box for reverse % calculation
            p_w = up.itemByName('widthIn')
            p_h = up.itemByName('heightIn')
            w = p_w.value if p_w else 17.0
            h = p_h.value if p_h else 22.0

            # Fetch the selected template by name (matches style_select items)
            templates = [template_data_1.TEMPLATE_1, template_data_2.TEMPLATE_2, template_data_3.TEMPLATE_3, template_data_4.TEMPLATE_4]
            current_template = next((t for t in templates if t["Name"] == sel_name), templates[0])
            all_params = current_template.get("Parameters", [])

            for key, label in drivers:
                # 0. Sync Template Parameters (Locked & Value)
                # Find the matching entry in the template's parameter list
                t_param = next((p for p in all_params if p["Name"] == key), None)
                t_en    = next((p for p in all_params if p["Name"] == f'en_{key}'), None)

                # EARLY-BIND: Ensure the parameters exist in the model
                p_en = up.itemByName(f'en_{key}')
                if not p_en:
                    try:
                        init_en = float(t_en["Val"]) if t_en else (0.0 if 'Waist' in key else 1.0)
                        up.add(f'en_{key}', adsk.core.ValueInput.createByReal(init_en), '', 'UI toggle state')
                    except: pass
                
                p_val = up.itemByName(key)
                if not p_val:
                    try:
                        # Use the expression string from the template if available
                        expr = str(t_param["Val"]) if t_param else ("widthIn * 0.8" if 'Span' in key else "heightIn * 0.15")
                        unit = t_param.get("Unit", "in") if t_param else "in"
                        up.add(key, adsk.core.ValueInput.createByString(expr), unit, 'UI proportion driver')
                    except: pass

                # 1. State-Aware Checkbox (Lock)
                p_en = up.itemByName(f'en_{key}')
                init_en = p_en.value > 0.5 if p_en else True
                skel_inputs.addBoolValueInput(f'en_{key}', f'Lock {label}', init_en, '', True)
                
                # 2. State-Aware Slider (Value)
                p_val = up.itemByName(key) # The parameter name is e.g. 'ShoulderSpan'
                init_val = 50.0 
                if p_val:
                    # Reverse calculate the percentage from the real cm value
                    total = w if 'Span' in key else h
                    if total > 0: init_val = (p_val.value / total) * 100.0
                
                skel_inputs.addFloatSliderCommandInput(f'val_{key}', 'Value (%)', '', 0.0, 100.0, False).valueOne = init_val

            on_input_changed = CommandInputChangedHandler()
            cmd.inputChanged.add(on_input_changed)
            handlers.append(on_input_changed)

            on_execute = CommandExecuteHandler(self.action_func)
            cmd.execute.add(on_execute)
            handlers.append(on_execute)
        except:
            try: diag_logger.log_error(f"CommandCreated CRASH:\n{traceback.format_exc()}")
            except: pass

class CommandInputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            ev = adsk.core.InputChangedEventArgs.cast(args)
            inputs = ev.firingEvent.sender.commandInputs
            en_ids = ['en_ShoulderSpan', 'en_WaistSpan', 'en_HipSpan', 'en_TopGap', 'en_BottomGap']

            # 3. LOCK COUNT & STATUS (Universal 4-Lock Guard)
            active_locks = [bid for bid in en_ids if inputs.itemById(bid) and inputs.itemById(bid).value]
            lcnt = len(active_locks)

            # Gray out unchecked boxes if we hit the limit (Standard 4-Lock Guard)
            for bid in en_ids:
                box = inputs.itemById(bid)
                if box and box.isEnabled:
                    box.isEnabled = (lcnt < 4 or box.value)

            st = inputs.itemById('skel_status')
            if st:
                color = "green" if lcnt <= 4 else "red"
                status = "STABLE" if lcnt <= 4 else "OVER-CONSTRAINED"
                st.formattedText = f"<b>{lcnt}/4 Locked | <font color='{color}'>{status}</font></b>"
            ev.firingEvent.sender.isOKButtonEnabled = (lcnt <= 4)
        except: pass

class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self, action_func):
        super().__init__()
        self.action_func = action_func
    def notify(self, args):
        try:
            ev = adsk.core.CommandEventArgs.cast(args)
            inputs = ev.command.commandInputs
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            up = design.userParameters
            sel_style = inputs.itemById('style_select').selectedItem

            keys = ['ShoulderSpan', 'WaistSpan', 'HipSpan', 'TopGap', 'BottomGap']
            
            # Fetch current bounding box totals
            h = up.itemByName('heightIn').value if up.itemByName('heightIn') else 22.0
            w = up.itemByName('widthIn').value if up.itemByName('widthIn') else 17.0

            for k in keys:
                en_box = inputs.itemById(f'en_{k}')
                if en_box:
                    en_val = 1.0 if en_box.value else 0.0
                    p_en = up.itemByName(f'en_{k}')
                    if p_en:
                        p_en.value = en_val
                        diag_logger.log(f"UI SYNC: {p_en.name} = {en_val}")

                val_in = inputs.itemById(f'val_{k}')
                if val_in:
                    p_val = up.itemByName(k)
                    if p_val:
                        ui_pct = val_in.valueOne
                        total = w if 'Span' in k else h
                        real_val = (ui_pct / 100.0) * total
                        p_val.value = real_val 
                        diag_logger.log(f"UI SYNC: {p_val.name} = {real_val:.3f} cm ({ui_pct:.1f}%)")

            if sel_style:
                self.action_func(sel_style.name, "joint")
        except:
            try: diag_logger.log_error(f"CommandExecute CRASH:\n{traceback.format_exc()}")
            except: pass
