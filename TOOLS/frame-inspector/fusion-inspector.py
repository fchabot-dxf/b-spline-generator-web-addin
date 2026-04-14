"""
Fusion Inspector — Standalone Module.
Defines the palette and selection event handlers for Frame Builder metadata.
"""
import adsk.core, adsk.fusion, traceback, os, json, datetime, subprocess, sys, math

# ---------------------------------------------------------------------------
# GLOBAL STATE (PERSISTENT ACROSS RELOADS)
# ---------------------------------------------------------------------------
_handlers = []
_html_handler = None
_last_sel_ids = ""
_latest_payload = ""

PALETTE_ID = 'FusionInspector_Palette'
CMD_ID = 'FusionInspector_Command'
PANEL_ID = 'FusionInspector_Panel' 

_current_dir = os.path.dirname(os.path.realpath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)
from expression_coords import get_design_params
from entity_helpers import entity_fingerprint
from payload_builder import build_payload

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


def _get_entity_key(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        if hasattr(ent, 'entityToken') and ent.entityToken:
            return ('token', ent.entityToken)
        if hasattr(ent, 'tempId'):
            return ('tempId', ent.tempId)
        return ('id', id(ent))
    except:
        return ('id', id(ent))


def format_point(pt):
    try:
        return f"({round(pt.geometry.x,2)},{round(pt.geometry.y,2)})"
    except:
        return ''


def _get_arc_midpoint(ent):
    try:
        if not hasattr(ent, 'startSketchPoint') or not hasattr(ent, 'endSketchPoint'):
            return None

        sp = ent.startSketchPoint.geometry
        ep = ent.endSketchPoint.geometry
        cp = None
        if hasattr(ent, 'centerSketchPoint') and ent.centerSketchPoint:
            cp = ent.centerSketchPoint.geometry
        elif hasattr(ent, 'geometry') and hasattr(ent.geometry, 'center'):
            cp = ent.geometry.center
        if not cp:
            return None

        dx1 = sp.x - cp.x
        dy1 = sp.y - cp.y
        dx2 = ep.x - cp.x
        dy2 = ep.y - cp.y
        r1 = math.hypot(dx1, dy1)
        r2 = math.hypot(dx2, dy2)
        if r1 == 0 or r2 == 0:
            return None

        angle1 = math.atan2(dy1, dx1)
        angle2 = math.atan2(dy2, dx2)
        cross = dx1 * dy2 - dy1 * dx2
        delta = angle2 - angle1
        if cross < 0 and delta > 0:
            delta -= 2 * math.pi
        elif cross > 0 and delta < 0:
            delta += 2 * math.pi

        mid_angle = angle1 + delta / 2.0
        mid_x = cp.x + r1 * math.cos(mid_angle)
        mid_y = cp.y + r1 * math.sin(mid_angle)
        return (mid_x, mid_y)
    except:
        return None


def get_fb_metadata(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
        if not hasattr(ent, 'attributes'):
            return ''

        info = []
        for name in ('StartID', 'EndID', 'CenterID'):
            a = ent.attributes.itemByName('FrameBuilder', name)
            if a and a.value:
                info.append(f"{name}={a.value}")

        if hasattr(ent, 'centerSketchPoint') and ent.centerSketchPoint:
            center_coord = format_point(ent.centerSketchPoint)
            if center_coord:
                info.append(f"BulgeCenter={center_coord}")

        return ' | '.join(info)
    except:
        return ''


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
            cp = None
            if hasattr(e, 'centerSketchPoint') and e.centerSketchPoint:
                cp = e.centerSketchPoint.geometry
            elif hasattr(e, 'geometry') and hasattr(e.geometry, 'center'):
                cp = e.geometry.center
            if cp:
                mid = _get_arc_midpoint(e)
                coord_str = f"({round(sp.x,2)}, {round(sp.y,2)}) -> ({round(cp.x,2)}, {round(cp.y,2)}) -> ({round(ep.x,2)}, {round(ep.y,2)})"
                if mid:
                    coord_str += f" -> ({round(mid[0],2)}, {round(mid[1],2)})"
                return coord_str
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
    p_data = build_payload(entities)
    _latest_payload = json.dumps(p_data)
    try:
        palette.sendInfoToHTML('update', _latest_payload)
    except Exception as e:
        _log(f"[ERROR] sendInfoToHTML failed: {e}")

class _HTMLEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        html_args = adsk.core.HTMLEventArgs.cast(args)
        if html_args.action == 'poll':
            html_args.returnData = _latest_payload
        elif html_args.action == 'copy':
            try:
                _log(f"[DEBUG_COPY] received copy request len={len(html_args.data) if html_args.data else 0}")
                proc = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=True)
                proc.communicate(input=html_args.data.encode('utf-8'))
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_COPY] {e}")
                html_args.returnData = 'error'

class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        global _html_handler
        app = adsk.core.Application.get()
        ui = app.userInterface
        palette = ui.palettes.itemById(PALETTE_ID)
        if not palette:
            palette = ui.palettes.add(PALETTE_ID, 'Fusion Inspector', PALETTE_URL, True, True, True, 320, 600)
        if not _html_handler:
            _html_handler = _HTMLEventHandler()
            try:
                palette.incomingFromHTML.add(_html_handler)
                _handlers.append(_html_handler)
            except Exception as e:
                _log(f"[ERROR] Failed to add HTML event handler: {e}")
        palette.isVisible = True

# ---------------------------------------------------------------------------
# LIFECYCLE
# ---------------------------------------------------------------------------

def run(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        
        # Log all available workspaces and their tabs for debugging
        # Workspace enumeration is only used for diagnostics during development.
        # Remove verbose startup debug logs in normal operation.
        pass

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
