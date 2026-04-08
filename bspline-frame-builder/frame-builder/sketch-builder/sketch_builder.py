import adsk.core, adsk.fusion, traceback
import os, sys, importlib

# --- EARLY EXECUTION LOG & DIAGNOSTICS ---
# Add parent directory to sys.path so we can import from core folders (engine, utils, etc.)
current_dir = os.path.dirname(os.path.realpath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

try:
    from fb_utils import logger
    importlib.reload(logger)
    diag_logger = logger.DebugLogger(parent_dir)
    diag_logger.log("SKETCH BUILDER: Module Loaded & Logger Active")
except Exception:
    pass

# Modular logic import — INJECTED BY HUB
try:
    from sketches.template_1 import template_data_1
    from sketches.template_2 import template_data_2
    from sketches.template_3 import template_data_3
    from sketches.template_4 import template_data_4
except Exception as e:
    try: diag_logger.log(f"SKETCH STARTUP ERROR: {e}", "ERROR")
    except: pass

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
                is_selected = (r == "Template 1")
                drop_rule.listItems.add(r, is_selected, '', -1)
            sel_item = drop_rule.selectedItem
            sel_name = sel_item.name if sel_item else rules[0]

            # --- SKELETON UI ---
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

            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            up = design.userParameters
            
            p_w = up.itemByName('widthIn')
            p_h = up.itemByName('heightIn')
            w = p_w.value if p_w else 17.0
            h = p_h.value if p_h else 22.0

            templates = [template_data_1.TEMPLATE_1, template_data_2.TEMPLATE_2, template_data_3.TEMPLATE_3, template_data_4.TEMPLATE_4]
            current_template = next((t for t in templates if t["Name"] == sel_name), templates[0])
            all_params = current_template.get("Parameters", [])

            for key, label in drivers:
                t_param = next((p for p in all_params if p["Name"] == key), None)
                t_en    = next((p for p in all_params if p["Name"] == f'en_{key}'), None)

                p_en = up.itemByName(f'en_{key}')
                init_en_val = float(t_en["Val"]) if t_en else 0.0
                if not p_en:
                    try:
                        up.add(f'en_{key}', adsk.core.ValueInput.createByReal(init_en_val), '', 'UI toggle state')
                    except: pass
                else:
                    # DNA SYNC: Force toggles to template defaults on dialog open
                    # to prevent "preserved" 5/4 lock clutter
                    p_en.value = init_en_val
                
                p_val = up.itemByName(key)
                if not p_val:
                    try:
                        expr = str(t_param["Val"]) if t_param else ("widthIn * 0.8" if 'Span' in key else "heightIn * 0.15")
                        unit = t_param.get("Unit", "in") if t_param else "in"
                        up.add(key, adsk.core.ValueInput.createByString(expr), unit, 'UI proportion driver')
                    except: pass

                p_en = up.itemByName(f'en_{key}')
                init_en = p_en.value > 0.5 if p_en else True
                skel_inputs.addBoolValueInput(f'en_{key}', f'Lock {label}', True, '', init_en)
                
                p_val = up.itemByName(key)
                init_val = 50.0 
                if p_val:
                    total = w if 'Span' in key else h
                    if total > 0: init_val = (p_val.value / total) * 100.0
                
                skel_inputs.addFloatSliderCommandInput(f'val_{key}', 'Value (%)', '', 0.0, 100.0, False).valueOne = init_val

            try: diag_logger.log("SKETCH CMD: Created (UI Initializing)")
            except: pass

            # --- INITIAL STATUS SYNC ---
            en_ids = [f'en_{k}' for k, _ in drivers]
            lcnt = 0
            for bid in en_ids:
                box = inputs.itemById(bid)
                if box and box.value: lcnt += 1
            
            st = inputs.itemById('skel_status')
            if st:
                color = "green" if lcnt <= 4 else "red"
                status = "STABLE" if lcnt <= 4 else "OVER-CONSTRAINED"
                st.formattedText = f"<b>{lcnt}/4 Locked | <font color='{color}'>{status}</font></b>"
            cmd.isOKButtonEnabled = (lcnt <= 4)

            self.on_input_changed = CommandInputChangedHandler()
            cmd.inputChanged.add(self.on_input_changed)

            self.on_execute = CommandExecuteHandler(self.action_func)
            cmd.execute.add(self.on_execute)
        except:
            try: diag_logger.log_error(f"SketchCommandCreated CRASH:\n{traceback.format_exc()}")
            except: pass

class CommandInputChangedHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            ev = adsk.core.InputChangedEventArgs.cast(args)
            inputs = ev.firingEvent.sender.commandInputs
            en_ids = ['en_ShoulderSpan', 'en_WaistSpan', 'en_HipSpan', 'en_TopGap', 'en_BottomGap']
            active_locks = [bid for bid in en_ids if inputs.itemById(bid) and inputs.itemById(bid).value]
            lcnt = len(active_locks)

            for bid in en_ids:
                box = inputs.itemById(bid)
                if box:
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
            
            try: diag_logger.log("SKETCH CMD: OK Clicked (Starting Build)")
            except: pass

            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            up = design.userParameters
            sel_style = inputs.itemById('style_select').selectedItem
            keys = ['ShoulderSpan', 'WaistSpan', 'HipSpan', 'TopGap', 'BottomGap']
            h = up.itemByName('heightIn').value if up.itemByName('heightIn') else 22.0
            w = up.itemByName('widthIn').value if up.itemByName('widthIn') else 17.0

            for k in keys:
                en_box = inputs.itemById(f'en_{k}')
                if en_box:
                    en_val = 1.0 if en_box.value else 0.0
                    p_en = up.itemByName(f'en_{k}')
                    if p_en: p_en.value = en_val

                val_in = inputs.itemById(f'val_{k}')
                if val_in:
                    p_val = up.itemByName(k)
                    if p_val:
                        ui_pct = val_in.valueOne
                        total = w if 'Span' in k else h
                        real_val = (ui_pct / 100.0) * total
                        p_val.value = real_val

            if sel_style:
                self.action_func(sel_style.name, "joint", diag_logger)
            
            try: diag_logger.log("SKETCH CMD: Build Function Dispatched")
            except: pass
        except:
            try: diag_logger.log_error(f"SKETCH EXECUTE CRASH:\n{traceback.format_exc()}")
            except: pass
