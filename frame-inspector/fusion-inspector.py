"""
Fusion Inspector — Standalone Module.
Defines the palette and selection event handlers for Frame Builder metadata.
"""
import adsk.core, adsk.fusion, traceback, os, json, datetime, subprocess, sys

# ---------------------------------------------------------------------------
# GLOBAL STATE (PERSISTENT ACROSS RELOADS)
# ---------------------------------------------------------------------------
_handlers = []
_last_sel_ids = ""
_latest_payload = ""

PALETTE_ID = 'FusionInspector_Palette'
CMD_ID = 'FusionInspector_Command'
PANEL_ID = 'FusionInspector_Panel' 

_current_dir = os.path.dirname(os.path.realpath(__file__))
PALETTE_URL = os.path.join(_current_dir, 'inspector_palette.html').replace('\\', '/')

def get_log_path():
    # Try to load inspector root from frame-inspector/project_path.json
    try:
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'project_path.json')
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        inspector_root = os.path.abspath(os.path.join(os.path.dirname(__file__), config['inspector_root']))
        log_path = os.path.join(inspector_root, 'fusion-inspector-debug.log')
        return log_path
    except Exception:
        # Fallback: log in the current folder
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fusion-inspector-debug.log')

_log_path = get_log_path()

def _log(msg):
    try:
        ts = datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]
        with open(_log_path, 'a', encoding='utf-8') as f:
            f.write(f"[{ts}] {msg}\n")
    except: pass

# ---------------------------------------------------------------------------
# ATTRIBUTE READERS (Restored from Backup)
# ---------------------------------------------------------------------------

def get_fb_name(ent):
    try:
        if not ent: return "None"
        if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a: return a.value.split('\n')[0]
            
        # Point-specific fallback (Vertex of Curve)
        if ent.objectType.endswith('SketchPoint'):
            parents = []
            if hasattr(ent, 'connectedEntities'):
                for ce in ent.connectedEntities:
                    name = get_fb_name(ce)
                    if name and not name.startswith('Sketch'):
                        parents.append(name.split('.')[-1])
            if parents:
                return f"Vertex of {', '.join(parents)}"
        
        return ent.objectType.split('::')[-1]
    except: return "Entity"

def get_fb_bridge(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'name')
            if a:
                lines = a.value.split('\n')
                if len(lines) > 1: return lines[1]
    except: pass
    return ""

def get_fb_plan(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', 'plan')
            if a: return a.value
    except: pass
    return ""

def get_fb_connections(ent):
    linked = []
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
        # 1. Constraints
        if hasattr(ent, 'geometricConstraints'):
            for gc in ent.geometricConstraints:
                gn = gc.objectType.split('::')[-1].replace('GeometricConstraint', '')
                if gn not in linked: linked.append(gn)
        # 2. Neighbors
        if hasattr(ent, 'startSketchPoint'):
            for curve in ent.startSketchPoint.connectedEntities:
                if curve != ent:
                    name = get_fb_name(curve)
                    if name and name not in linked: linked.append(name)
        if hasattr(ent, 'endSketchPoint'):
            for curve in ent.endSketchPoint.connectedEntities:
                if curve != ent:
                    name = get_fb_name(curve)
                    if name and name not in linked: linked.append(name)
    except: pass
    return linked

def entity_fingerprint(ent):
    try:
        if hasattr(ent, 'entityToken') and ent.entityToken: return ent.entityToken
        if hasattr(ent, 'tempId'): return f"{ent.objectType}_{ent.tempId}"
        return f"{ent.objectType}_{id(ent)}"
    except: return str(id(ent))

def get_entity_coord(e):
    try:
        if e.objectType.endswith('SketchPoint'):
            return f"Point: ({round(e.geometry.x, 2)}, {round(e.geometry.y, 2)})"
        if hasattr(e, 'startSketchPoint') and hasattr(e, 'endSketchPoint'):
            sp = e.startSketchPoint.geometry
            ep = e.endSketchPoint.geometry
            return f"({round(sp.x,2)}, {round(sp.y,2)}) -> ({round(ep.x,2)}, {round(ep.y,2)})"
        if hasattr(e, 'geometry') and hasattr(e.geometry, 'startPoint'):
            g = e.geometry
            return f"({round(g.startPoint.x,2)}, {round(g.startPoint.y,2)}) -> ({round(g.endPoint.x,2)}, {round(g.endPoint.y,2)})"
        if hasattr(e, 'boundingBox'):
            bb = e.boundingBox
            cx = round((bb.minPoint.x + bb.maxPoint.x) / 2, 2)
            cy = round((bb.minPoint.y + bb.maxPoint.y) / 2, 2)
            return f"Center: ({cx}, {cy})"
    except: pass
    return ""

# ---------------------------------------------------------------------------
# HANDLERS
# ---------------------------------------------------------------------------

class _SelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    def notify(self, args):
        try: _push_selection_to_palette()
        except: _log(traceback.format_exc())

def _push_selection_to_palette():
    global _last_sel_ids, _latest_payload
    app = adsk.core.Application.get()
    ui = app.userInterface
    palette = ui.palettes.itemById(PALETTE_ID)
    if not palette or not palette.isValid or not palette.isVisible: return

    sels = ui.activeSelections
    count = sels.count if sels else 0
    
    current_ids = ""
    entities = []
    if count > 0:
        for i in range(count):
            try:
                ent = sels.item(i).entity
                if ent:
                    entities.append(ent)
                    current_ids += entity_fingerprint(ent) + "|"
            except: pass

    if current_ids == _last_sel_ids and _last_sel_ids != "": return
    _last_sel_ids = current_ids

    # Build High-Density Payload
    p_data = {
        'count': count,
        'mainFeature': 'Select geometry...',
        'coord': '',
        'linked': [],
        'listLabel': 'Connections',
        'meta': f"{count} Entities Selected",
        'type': 'Other'
    }

    if entities:
        e = entities[0]
        if hasattr(e, 'nativeObject') and e.nativeObject: e = e.nativeObject
        
        # Single Selection Case
        if count == 1:
            p_data['mainFeature'] = get_fb_name(e)
            p_data['coord'] = get_entity_coord(e)
            p_data['linked'] = get_fb_connections(e)
            p_data['listLabel'] = 'Details & Connections'
        
        # Batch Selection Case
        else:
            p_data['mainFeature'] = f"{count} Entities Selected"
            p_data['coord'] = "(Batch View)"
            p_data['listLabel'] = 'Selection List'
            
            # List every item with its name and points/coordinates
            for ent in entities:
                if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
                name = get_fb_name(ent)
                coord = get_entity_coord(ent)
                # Format: [Name] | (x,y) -> (x,y)
                p_data['linked'].append(f"{name} | {coord}")

        bridge = get_fb_bridge(e)
        plan = get_fb_plan(e)
        p_data['meta'] = f"{e.objectType.split('::')[-1]} | Bridge: {bridge or 'N/A'} | Plan: {plan or 'N/A'}"

    _latest_payload = json.dumps(p_data)
    palette.sendInfoToHTML('update', _latest_payload)

class _HTMLEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        html_args = adsk.core.HTMLEventArgs.cast(args)
        if html_args.action == 'poll':
            html_args.returnData = _latest_payload
        elif html_args.action == 'copy':
            try:
                proc = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=True)
                proc.communicate(input=html_args.data.encode('utf-8'))
                html_args.returnData = 'ok'
            except: html_args.returnData = 'error'

class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        app = adsk.core.Application.get()
        ui = app.userInterface
        palette = ui.palettes.itemById(PALETTE_ID)
        if not palette:
            palette = ui.palettes.add(PALETTE_ID, 'Fusion Inspector', PALETTE_URL, True, True, True, 320, 600)
            html_handler = _HTMLEventHandler()
            palette.incomingFromHTML.add(html_handler)
            _handlers.append(html_handler)
        palette.isVisible = True

# ---------------------------------------------------------------------------
# LIFECYCLE
# ---------------------------------------------------------------------------

def run(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        
        # Log all available workspaces and their tabs for debugging
        try:
            ws_ids = [ws.id for ws in ui.workspaces]
            _log(f"[DEBUG] Available workspaces: {ws_ids}")
            for ws in ui.workspaces:
                tab_ids = [tab.id for tab in ws.toolbarTabs]
                _log(f"[DEBUG] Workspace '{ws.id}' tabs: {tab_ids}")
        except Exception as e:
            _log(f"[DEBUG] Error listing workspaces/tabs: {e}")

        # 1. Command Definition
        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def: cmd_def.deleteMe()

        resources_path = os.path.join(_current_dir, 'resources', 'InspectorCommand')
        cmd_def = ui.commandDefinitions.addButtonDefinition(CMD_ID, 'Fusion Inspector', 'Visualizes Frame Builder Metadata', resources_path)
        
        handler = CommandCreatedHandler()
        cmd_def.commandCreated.add(handler)
        _handlers.append(handler)
        
        # 2. UI Button Insertion (Dynamic SketchTab Registration)
        # Add Inspector button to SketchTab in all workspaces that have it
        for ws in ui.workspaces:
            try:
                tab = ws.toolbarTabs.itemById('SketchTab')
                _log(f"[DEBUG] ws.toolbarTabs.itemById('SketchTab') in workspace '{ws.id}': {repr(tab)}")
                if not tab:
                    # Fallback: search for any tab containing 'SketchTab' in its id
                    for t in ws.toolbarTabs:
                        if 'SketchTab' in t.id:
                            tab = t
                            break
                if tab:
                    _log(f"[LOG] Found workspace: {ws.id}")
                    _log(f"[LOG] Found tab: {tab.id} in workspace: {ws.id}")
                    panel = tab.toolbarPanels.itemById(PANEL_ID)
                    if not panel:
                        panel = tab.toolbarPanels.add(PANEL_ID, 'INSPECTOR', '', False)
                        _log(f"[LOG] Created panel: {PANEL_ID} in tab: {tab.id}")
                    else:
                        _log(f"[LOG] Found existing panel: {PANEL_ID} in tab: {tab.id}")
                    if not panel.controls.itemById(CMD_ID):
                        ctrl = panel.controls.addCommand(cmd_def)
                        ctrl.isPromoted = True
                        ctrl.isPromotedByDefault = True
                        _log(f"[LOG] Added command button: {CMD_ID} to panel: {PANEL_ID} in tab: {tab.id}")
                    else:
                        _log(f"[LOG] Command button: {CMD_ID} already exists in panel: {PANEL_ID} in tab: {tab.id}")
                # else: do not log missing SketchTab for every workspace
            except Exception as e:
                _log(f"[ERROR] Failed to add Inspector to SketchTab in workspace '{ws.id}': {e}")
        # 3. Selection Monitor
        sel_handler = _SelectionChangedHandler()
        ui.activeSelectionChanged.add(sel_handler)
        _handlers.append(sel_handler)
        
        _log("Fusion Inspector Standalone Start (Proper Registration)")
    except:
        _log(traceback.format_exc())

def stop(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        
        palette = ui.palettes.itemById(PALETTE_ID)
        if palette: palette.deleteMe()
        
        # Cleanup panels in specific workspaces
        target_ws_ids = ['FusionSolidEnvironment', 'SolidEnvironment', 'SketchEnvironment']
        for ws_id in target_ws_ids:
            ws = ui.workspaces.itemById(ws_id)
            if ws:
                for tab in ws.toolbarTabs:
                    panel = tab.toolbarPanels.itemById(PANEL_ID)
                    if panel:
                        ctrl = panel.controls.itemById(CMD_ID)
                        if ctrl: ctrl.deleteMe()
                        if panel.controls.count == 0:
                            panel.deleteMe()

        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def: cmd_def.deleteMe()
            
        _log("Fusion Inspector Standalone Stop")
    except: pass
