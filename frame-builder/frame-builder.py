import adsk.core, adsk.fusion, adsk.cam, traceback
import os, json, importlib, sys
import datetime

# --- EARLY EXECUTION LOG & DIAGNOSTICS ---
addin_root = os.path.dirname(os.path.realpath(__file__))
if addin_root not in sys.path:
    sys.path.append(addin_root)

handlers = []

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        
        # 1. Immediate Engine Refresh
        try:
            from engine import frame_engine
            importlib.reload(frame_engine)
        except: pass

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
            # --- INTERACTION-LEVEL HOT RELOAD ---
            # This ensures that even opening the dialog refreshes the engine
            from engine import frame_engine
            importlib.reload(frame_engine)
            # Use the refreshed logic function
            refreshed_logic = frame_engine.build_sketch_logic if self.cmd_id == 'FrameSketchCommand' else frame_engine.build_frame_logic
            
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            cmd.setDialogMinimumSize(800, 400)
            cmd.setDialogInitialSize(800, 600)
            inputs = cmd.commandInputs
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            
            inputs.addDropDownCommandInput('style_select', 'Style', adsk.core.DropDownStyles.LabeledIconDropDownStyle).listItems.add("Signature (Template 2)", True)
            
            if self.cmd_id == 'FrameSketchCommand':
                grp = inputs.addGroupCommandInput('grp_skeleton', 'Skeleton Variables')
                grp.isExpanded = True
                skel_inputs = grp.children
                
                # Logic continues... scaled defaults etc.
                w_val = 17.78 
                h_val = 22.86
                all_p = design.allParameters
                try:
                    p_w = all_p.itemByName('widthIn')
                    p_h = all_p.itemByName('heightIn')
                    if p_w: w_val = p_w.value
                    if p_h: h_val = p_h.value
                except: pass

                skeletons = [
                    ('ShoulderSpan', 'Shoulder Span'),
                    ('TopGap', 'Top Gap'),
                    ('WaistSpan', 'Waist Span'),
                    ('VerticalOffset', 'Vertical Offset'),
                    ('BottomGap', 'Bottom Gap'),
                    ('HipSpan', 'Hip Span'),
                ]

                anatomical_defaults = {
                    'ShoulderSpan': w_val * 0.8,
                    'WaistSpan': w_val * 0.95,
                    'HipSpan': w_val * 0.8,
                    'TopGap': h_val * 0.15,
                    'BottomGap': h_val * 0.15,
                    'VerticalOffset': 0.0
                }

                # Locks that are ON by default at dialog open.
                # Must not exceed MAX_ACTIVE_LOCKS or the sketch will over-constrain on first run.
                LOCK_DEFAULT_ON = {'ShoulderSpan', 'TopGap', 'WaistSpan', 'HipSpan'}

                for k, label in skeletons:
                    is_piv = (k == 'VerticalOffset')
                    p_val = all_p.itemByName(k)
                    cur_cm = p_val.value if p_val else anatomical_defaults.get(k, h_val/5.0)
                    basis = w_val if 'Span' in label else h_val
                    initial_pct = (cur_cm / basis) * 100.0 if basis != 0 else 0

                    if is_piv:
                        # Origin Lock — hard-pins waist to origin via Coincident.
                        # Defaults OFF so it doesn't count toward initial lock total.
                        skel_inputs.addBoolValueInput('en_OriginLock', 'Origin Lock', True, '', False)
                        # Soft-seed toggle + slider — hidden when Origin Lock is ON.
                        # Also defaults OFF to stay within MAX_ACTIVE_LOCKS on open.
                        en_vo  = skel_inputs.addBoolValueInput('en_VerticalOffset', 'Lock Vertical Offset', True, '', False)
                        val_vo = skel_inputs.addFloatSliderCommandInput('val_VerticalOffset', 'Vertical Offset (%)', '', -50.0, 50.0, False)
                        val_vo.valueOne = initial_pct
                        en_vo.isVisible  = True
                        val_vo.isVisible = True
                    else:
                        default_on = k in LOCK_DEFAULT_ON
                        skel_inputs.addBoolValueInput(f"en_{k}", f"Lock {label}", True, '', default_on)
                        val_inp = skel_inputs.addFloatSliderCommandInput(f"val_{k}", f"{label} (%)", '', 5, 160, False)
                        val_inp.valueOne = initial_pct

            # Bind refreshed execution handler
            on_execute = CommandExecuteHandler(refreshed_logic, self.cmd_id)
            cmd.execute.add(on_execute)
            handlers.append(on_execute)

            # Bind input-changed handler for live toggle gating
            if self.cmd_id == 'FrameSketchCommand':
                on_changed = CommandInputChangedHandler()
                cmd.inputChanged.add(on_changed)
                handlers.append(on_changed)
                # Apply gates based on initial state (restored from last session)
                _apply_toggle_gates(inputs)
            
        except: pass

# ---------------------------------------------------------------------------
# Toggle gate: cap the number of skeleton locks that can be ON at once.
# Once MAX_ACTIVE_LOCKS are ON, every remaining OFF toggle (and its slider)
# is greyed out until the user turns one OFF.
# Tune this number if the solver handles more (or fewer) constraints cleanly.
# ---------------------------------------------------------------------------
MAX_ACTIVE_LOCKS = 4
# Keys whose en_* toggles count toward the max lock cap.
# en_OriginLock uses a bare key (no 'en_' prefix stored here) — handled explicitly.
LOCK_KEYS = ['ShoulderSpan', 'TopGap', 'WaistSpan', 'VerticalOffset', 'BottomGap', 'HipSpan']
LOCK_KEY_IDS = [f'en_{k}' for k in LOCK_KEYS] + ['en_OriginLock']

def _apply_toggle_gates(inputs):
    """
    1. Hide/show VerticalOffset soft-seed controls based on Origin Lock state.
    2. Grey out OFF-toggles once MAX_ACTIVE_LOCKS are already ON.
    """
    # --- Step 1: Origin Lock visibility gate ---
    origin_lock = inputs.itemById('en_OriginLock')
    en_vo  = inputs.itemById('en_VerticalOffset')
    val_vo = inputs.itemById('val_VerticalOffset')
    origin_on = origin_lock.value if origin_lock else False
    if en_vo:
        en_vo.isVisible = not origin_on
        if origin_on:
            try: en_vo.value = False   # force dim lock OFF when origin is hard-locked
            except: pass
    if val_vo:
        val_vo.isVisible = not origin_on

    # --- Step 2: Max active locks cap ---
    active = sum(
        1 for tid in LOCK_KEY_IDS
        if (t := inputs.itemById(tid)) and t.value
    )
    at_max = active >= MAX_ACTIVE_LOCKS

    for tid in LOCK_KEY_IDS:
        toggle_inp = inputs.itemById(tid)
        # Derive matching slider id: en_Foo → val_Foo, en_OriginLock → no slider
        slider_id  = tid.replace('en_', 'val_', 1)
        slider_inp = inputs.itemById(slider_id)
        if toggle_inp:
            is_on   = toggle_inp.value
            enabled = is_on or not at_max
            toggle_inp.isEnabled = enabled
            if slider_inp:
                slider_inp.isEnabled = enabled


class CommandInputChangedHandler(adsk.core.InputChangedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            inputs = adsk.core.InputChangedEventArgs.cast(args).inputs
            _apply_toggle_gates(inputs)
        except: pass


class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self, f, cmd_id):
        super().__init__()
        self.f = f
        self.cmd_id = cmd_id
        
    def notify(self, args):
        try:
            # --- LAST SECOND NUCLEAR RELOAD ---
            from engine import frame_engine
            importlib.reload(frame_engine)
            
            inputs = adsk.core.CommandEventArgs.cast(args).command.commandInputs
            design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
            all_p = design.allParameters
            h = all_p.itemByName('heightIn').value if all_p.itemByName('heightIn') else 22.0
            w = all_p.itemByName('widthIn').value if all_p.itemByName('widthIn') else 17.0
            
            skeletons = ['ShoulderSpan', 'WaistSpan', 'HipSpan', 'TopGap', 'BottomGap', 'VerticalOffset']
            local_map = {}
            for k in skeletons:
                v_in = inputs.itemById(f"val_{k}")
                en_in = inputs.itemById(f"en_{k}")
                if v_in:
                    real = (v_in.valueOne / 100.0) * (w if 'Span' in k else h)
                    local_map[k] = real
                if en_in:
                    local_map[f"en_{k}"] = 1.0 if en_in.value else 0.0
            # Origin Lock is a separate toggle (not in skeletons loop above)
            ol_in = inputs.itemById('en_OriginLock')
            if ol_in:
                local_map['en_OriginLock'] = 1.0 if ol_in.value else 0.0
            
            # Execute with high-fidelity refresh
            self.f("Signature (Template 2)", "none", local_map)
        except: pass
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   