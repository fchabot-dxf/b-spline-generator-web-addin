import adsk.core, adsk.fusion, adsk.cam, traceback
import os, json, importlib, sys
import datetime

# --- EARLY EXECUTION LOG & DIAGNOSTICS ---
addin_root = os.path.dirname(os.path.realpath(__file__))
if addin_root not in sys.path:
    sys.path.append(addin_root)

diag_logger = None
import_error = None

try:
    from utils import logger
    importlib.reload(logger)
    diag_logger = logger.DebugLogger(addin_root)
except Exception as e: 
    import_error = f"Logger/Utils import failed: {e}\n{traceback.format_exc()}"

if not import_error:
    try:
        from engine import frame_engine, solid_builder
        importlib.reload(frame_engine)
        importlib.reload(solid_builder)
    except Exception as e: 
        import_error = f"Core engine import failed: {e}\n{traceback.format_exc()}"

handlers = []

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        
        if import_error:
            ui.messageBox(f"Launch Failed (Import Error):\n\n{import_error}")
            return

        cmd_defs = ui.commandDefinitions
        commands = [
            {'id': 'FrameSketchCommand', 'name': 'Generate Sketch', 'logic': frame_engine.build_sketch_logic},
            {'id': 'FrameBuildCommand',  'name': 'Create Frame',   'logic': frame_engine.build_frame_logic}
        ]
        current_dir = os.path.dirname(os.path.realpath(__file__))
        for cmd_info in commands:
            cmd_id = cmd_info['id']
            try:
                existing = cmd_defs.itemById(cmd_id)
                if existing: existing.deleteMe()
            except: pass
            new_def = cmd_defs.addButtonDefinition(cmd_id, cmd_info['name'], '', os.path.join(current_dir, 'resources', cmd_id))
            on_created = CommandCreatedHandler(cmd_info['logic'], cmd_id)
            new_def.commandCreated.add(on_created)
            handlers.append(on_created)
        
        for tab_id in ['SolidTab', 'DesignTab', 'FusionSolidTab']:
            tab = ui.allToolbarTabs.itemById(tab_id)
            if tab:
                panel = tab.toolbarPanels.itemById('FrameBuilderPanel') or tab.toolbarPanels.add('FrameBuilderPanel', 'FRAME')
                for cmd_info in commands:
                    btn = panel.controls.itemById(cmd_info['id'])
                    if not btn:
                        btn = panel.controls.addCommand(ui.commandDefinitions.itemById(cmd_info['id']))
                    btn.isPromoted = True
                    btn.isPromotedByDefault = True
    except:
        if ui: ui.messageBox('Launch Failed:\n{}'.format(traceback.format_exc()))

def stop(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        for cmd_id in ['FrameSketchCommand', 'FrameBuildCommand']:
            bd = ui.commandDefinitions.itemById(cmd_id)
            if bd: bd.deleteMe()
        for tab_id in ['SolidTab', 'DesignTab']:
            tab = ui.allToolbarTabs.itemById(tab_id)
            if tab:
                panel = tab.toolbarPanels.itemById('FrameBuilderPanel')
                if panel: panel.deleteMe()
    except: pass

class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, action_func, cmd_id):
        super().__init__()
        self.action_func = action_func
        self.cmd_id = cmd_id
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            inputs = cmd.commandInputs
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            if not design: return
            root = design.rootComponent
            user_params = design.userParameters

            inputs.addDropDownCommandInput('style_select', 'Style', adsk.core.DropDownStyles.LabeledIconDropDownStyle).listItems.add("Signature (Template 2)", True)
            
            # --- SKELETON UI (Only for Sketch Command) ---
            if self.cmd_id == 'FrameSketchCommand':
                grp = inputs.addGroupCommandInput('grp_skeleton', 'Skeleton Variables')
                grp.isExpanded = True
                skel_inputs = grp.children
                skel_feedback = skel_inputs.addTextBoxCommandInput('skel_feedback', 'DRIVING (mm)', '---', 1, True)
                skel_feedback.isFullWidth = True

                w_val, h_val = 17.78, 22.86
                try:
                    p_w = design.allParameters.itemByName('widthIn')
                    p_h = design.allParameters.itemByName('heightIn')
                    if p_w: w_val = p_w.value
                    if p_h: h_val = p_h.value
                except:
                    pass

                skeletons = [
                    ('ShoulderSpan',   'Shoulder Span'), ('TopGap', 'Top Gap'),
                    ('WaistSpan',      'Waist Span'), ('VerticalOffset', 'Vertical Offset'),
                    ('BottomGap',      'Bottom Gap'), ('HipSpan', 'Hip Span'),
                ]
                
                safe_defaults = {'ShoulderSpan': True, 'TopGap': True, 'WaistSpan': True, 'HipSpan': True, 'BottomGap': False, 'VerticalOffset': True}
                anatomical_defaults = {
                    'ShoulderSpan': w_val * 0.8, 'WaistSpan': w_val * 0.95, 'HipSpan': w_val * 0.8,
                    'TopGap': h_val * 0.12, 'BottomGap': h_val * 0.15, 'VerticalOffset': 0.0
                }

                all_params = design.allParameters
                en_count = len([k for k, _ in skeletons if k != 'VerticalOffset' and bool(getattr(all_params.itemByName(f"en_{k}"), 'value', safe_defaults.get(k, True)))])

                locked_at_start = 0
                for k, label in skeletons:
                    is_piv = (k == 'VerticalOffset')
                    p_en = all_params.itemByName(f"en_{k}")
                    initial_en = bool(p_en.value) if p_en else safe_defaults.get(k, True)
                    
                    if not is_piv and initial_en:
                        locked_at_start += 1

                    en_inp = skel_inputs.addBoolValueInput(f"en_{k}", f"Lock {label}" if not is_piv else "CENTERED (Lock to Origin)", True, '', initial_en)
                    en_inp.isEnabled = (en_count < 4 or initial_en) if not is_piv else True
                    
                    p_val = all_params.itemByName(k)
                    cur_cm = p_val.value if p_val else anatomical_defaults.get(k, h_val/5.0)
                    basis = w_val if 'Span' in label else h_val
                    initial_pct = (cur_cm / basis) * 100.0 if basis != 0 else 0
                    
                    min_p, max_p = 5, 120
                    if 'Waist' in label: max_p = 160
                    if is_piv: min_p, max_p = -50, 50
                    
                    val_inp = skel_inputs.addFloatSliderCommandInput(f"val_{k}", f"{label} (%)", '', min_p, max_p, False)
                    val_inp.valueOne = initial_pct
                    if is_piv: 
                        val_inp.isEnabled = not initial_en
                        p_fix = all_params.itemByName("en_Fix_VerticalOffset")
                        initial_fix = bool(p_fix.value) if p_fix else False
                        fix_inp = skel_inputs.addBoolValueInput("en_Fix_VerticalOffset", "Lock Vertical Offset", True, '', initial_fix)
                        fix_inp.isVisible = not initial_en

                st = skel_inputs.addTextBoxCommandInput('skel_status', 'Status', f"<b>{locked_at_start}/4 Locked | STABLE</b>", 1, True)
                st.isFullWidth = True

            # --- FRAMING UI (Simplified to Target + Start Offset) ---
            grp_frame = inputs.addGroupCommandInput('grp_framing', 'Framing Options')
            grp_frame.isExpanded = True
            f_inputs = grp_frame.children
            
            sb = solid_builder.SolidBuilder(design, None)
            best_body = sb.discover_aesthetic_core()
            
            target_drop = f_inputs.addDropDownCommandInput('target_entity', 'Target Entity', adsk.core.DropDownStyles.LabeledIconDropDownStyle)
            target_drop.listItems.add("AUTO-DETECT", best_body is None, "")
            candidates = [root] + [occ.component for occ in root.allOccurrences]
            seen_tokens = set()
            
            for comp in candidates:
                if comp.entityToken in seen_tokens: continue
                seen_tokens.add(comp.entityToken)
                
                if comp.bRepBodies.count > 0:
                    name = "Root Component" if comp == root else comp.name
                    best_comp = None
                    if best_body:
                        # Safety: best_body can be a face or body
                        b_obj = best_body.body if isinstance(best_body, adsk.fusion.BRepFace) else best_body
                        best_comp = b_obj.parentComponent
                    
                    is_best = (best_comp == comp)
                    target_drop.listItems.add(name, is_best, "")

            # 2. Canvas Selection (Direct Override)
            sel_in = f_inputs.addSelectionInput('sel_target', 'Pick Target Face', 'Select a face to use as target')
            sel_in.addSelectionFilter('SolidFaces')
            sel_in.setSelectionLimits(0, 1)
            
            off_p = design.allParameters.itemByName('Skel_Start_Offset')
            off_val = off_p.value if off_p else -2.54
            off_in = f_inputs.addFloatSliderCommandInput('val_Skel_Start_Offset', 'Start Offset (Thickness)', 'cm', -10.0, 10.0, False)
            off_in.valueOne = off_val

            on_execute = CommandExecuteHandler(self.action_func, self.cmd_id)
            cmd.execute.add(on_execute)
            handlers.append(on_execute)
            on_input_changed = CommandInputChangedHandler(self.cmd_id)
            cmd.inputChanged.add(on_input_changed)
            handlers.append(on_input_changed)
        except:
            if diag_logger: diag_logger.log(f"CRASH in UI CommandCreated: {traceback.format_exc()}", "ERROR")
            traceback.print_exc()

class CommandInputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self, cmd_id):
        super().__init__()
        self.cmd_id = cmd_id
    def notify(self, args):
        try:
            ev = adsk.core.InputChangedEventArgs.cast(args)
            if self.cmd_id != 'FrameSketchCommand': return
            changed = ev.input
            if not changed: return
            inputs = ev.firingEvent.sender.commandInputs
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            all_p = design.allParameters

            if changed.id.startswith('en_'):
                key = changed.id[3:]
                is_on = changed.value
                v_inp = inputs.itemById(f"val_{key}")
                if v_inp and key == 'VerticalOffset':
                    v_inp.isEnabled = not is_on
                    fix_inp = inputs.itemById("en_Fix_VerticalOffset")
                    if fix_inp: fix_inp.isVisible = not is_on
                
                en_ids = ['en_ShoulderSpan', 'en_WaistSpan', 'en_HipSpan', 'en_TopGap', 'en_BottomGap']
                lcnt = len([bid for bid in en_ids if inputs.itemById(bid) and inputs.itemById(bid).value])
                for bid in en_ids:
                    b = inputs.itemById(bid)
                    if b: b.isEnabled = (lcnt < 4 or b.value)

            h_total = all_p.itemByName('heightIn').value if all_p.itemByName('heightIn') else 22.0
            w_total = all_p.itemByName('widthIn').value if all_p.itemByName('widthIn') else 17.0
            off_pct = (inputs.itemById('val_VerticalOffset').valueOne if inputs.itemById('val_VerticalOffset') else 0.0)
            off_cm = (off_pct / 100.0) * h_total
            
            for g_id, is_sh in [('val_TopGap', True), ('val_BottomGap', False)]:
                g_inp = inputs.itemById(g_id)
                if g_inp:
                    hr_cm = max(0.5, (h_total/2.0) + (off_cm if not is_sh else -off_cm) - 2.0)
                    hr_pct = (hr_cm / h_total) * 100.0
                    g_inp.maximumValue = hr_pct
                    if g_inp.valueOne > hr_pct: g_inp.valueOne = hr_pct

            st = inputs.itemById('skel_status')
            if st:
                en_ids = ['en_ShoulderSpan', 'en_WaistSpan', 'en_HipSpan', 'en_TopGap', 'en_BottomGap']
                lcnt = len([bid for bid in en_ids if inputs.itemById(bid) and inputs.itemById(bid).value])
                stability = "<font color='green'>STABLE</font>"
                msg = f"<b>{lcnt}/4 Locked | {stability}</b>"
                if st.formattedText != msg: st.formattedText = msg
                ev.firingEvent.sender.isOKButtonEnabled = (lcnt <= 4)
        except:
            if diag_logger: diag_logger.log(f"CRASH in UI InputChanged: {traceback.format_exc()}", "ERROR")

class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self, f, cmd_id):
        super().__init__()
        self.f = f
        self.cmd_id = cmd_id
    def notify(self, args):
        try:
            inputs = adsk.core.CommandEventArgs.cast(args).command.commandInputs
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            all_p = design.allParameters
            h = all_p.itemByName('heightIn').value if all_p.itemByName('heightIn') else 22.0
            w = all_p.itemByName('widthIn').value if all_p.itemByName('widthIn') else 17.0
            
            skeletons = ['ShoulderSpan', 'WaistSpan', 'HipSpan', 'TopGap', 'BottomGap', 'VerticalOffset']
            local_map = {}
            for k in skeletons:
                v_in = inputs.itemById(f"val_{k}")
                if v_in:
                    real = (v_in.valueOne / 100.0) * (w if 'Span' in k else h)
                    local_map[k] = real
                    p = all_p.itemByName(k)
                    if p: p.value = real
                
                e_in = inputs.itemById(f"en_{k}")
                if e_in:
                    ev = 1.0 if e_in.value else 0.0
                    local_map[f"en_{k}"] = ev
                    pe = all_p.itemByName(f"en_{k}")
                    if pe: pe.value = ev
            
            if self.cmd_id == 'FrameBuildCommand':
                v_off = inputs.itemById('val_Skel_Start_Offset')
                if v_off:
                    local_map['Skel_Start_Offset'] = v_off.valueOne
                    p = all_p.itemByName('Skel_Start_Offset')
                    if p: p.value = v_off.valueOne

            # Capture Target (Canvas Selection > Dropdown Selection > Auto)
            sel_in = inputs.itemById('sel_target')
            target_entity = sel_in.selection(0).entity if sel_in and sel_in.selectionCount > 0 else None
            
            target_in = inputs.itemById('target_entity')
            target_name = target_in.selectedItem.name if target_in and target_in.selectedItem else None
            
            if diag_logger:
                sel_str = f"Face ({target_entity.tempId})" if target_entity else "None"
                diag_logger.log(f"[UI] Executing with Canvas Selection: {sel_str}, Dropdown: {target_name}")

            style = inputs.itemById('style_select').selectedItem.name if inputs.itemById('style_select') else "Signature (Template 2)"
            self.f(style, "none", local_map, target_name, target_entity)
        except:
            if diag_logger: diag_logger.log(f"CRASH in UI CommandExecute: {traceback.format_exc()}", "ERROR")
