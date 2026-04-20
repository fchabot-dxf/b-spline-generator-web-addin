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
PANEL_ID = 'bsplinePanel'

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


def get_fb_connections(ent):
    """Return a list of short strings describing what's connected to this entity.

    Called for the single-selection ``Details & Connections`` panel. Previously
    this function was referenced from ``_push_selection_to_palette`` at line
    384 but never defined — every selection event raised ``NameError: name
    'get_fb_connections' is not defined`` and the traceback escaped into
    Fusion's event pump, which is why the addin refuses to re-RUN after one
    interaction (Fusion flags a handler that throws and won't restart it until
    the underlying code changes).

    Output is a flat list of human-readable strings. Each string is rendered
    as one ``<li>`` in ``inspector_palette.html``. Kept deliberately
    defensive — this is called synchronously inside a Fusion selection-change
    handler, so any unguarded attribute access on a stale proxy would crash
    the host process.
    """
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        out = []
        ent_type = getattr(ent, 'objectType', '') or ''

        # SketchPoint: list every entity that uses this point.
        if ent_type.endswith('SketchPoint'):
            connected = getattr(ent, 'connectedEntities', None)
            if connected is not None:
                count = getattr(connected, 'count', None)
                items = []
                if count is not None:
                    for i in range(count):
                        try:
                            items.append(connected.item(i))
                        except Exception:
                            continue
                else:
                    try:
                        items = list(connected)
                    except Exception:
                        items = []
                for c in items:
                    try:
                        name = get_fb_name(c)
                        if name:
                            out.append(f"Used by: {name}")
                    except Exception:
                        continue
            return out

        # Curves (line / arc / circle / spline): list the named endpoints
        # plus any curves that share those endpoints.
        for attr_name, label in (('startSketchPoint', 'Start'),
                                 ('endSketchPoint', 'End'),
                                 ('centerSketchPoint', 'Center')):
            try:
                pt = getattr(ent, attr_name, None)
            except Exception:
                pt = None
            if not pt:
                continue
            coord = format_point(pt)
            pt_name = get_fb_name(pt)
            if coord and pt_name and not pt_name.startswith('Sketch'):
                out.append(f"{label}: {pt_name} {coord}")
            elif coord:
                out.append(f"{label}: {coord}")

            # Any other curves sharing this point.
            try:
                connected = getattr(pt, 'connectedEntities', None)
                if connected is None:
                    continue
                count = getattr(connected, 'count', None)
                neighbours = []
                if count is not None:
                    for i in range(count):
                        try:
                            neighbours.append(connected.item(i))
                        except Exception:
                            continue
                for n in neighbours:
                    try:
                        # Skip the entity itself.
                        if n is ent:
                            continue
                        try:
                            if hasattr(n, 'nativeObject') and n.nativeObject is ent:
                                continue
                        except Exception:
                            pass
                        name = get_fb_name(n)
                        if name:
                            out.append(f"  ↳ {label} shared with: {name}")
                    except Exception:
                        continue
            except Exception:
                continue

        # Constraints / dimensions: list their target entities by name.
        if 'Constraint' in ent_type or 'Dimension' in ent_type:
            for prop_name in ('entityOne', 'entityTwo', 'lineOne', 'lineTwo',
                              'curveOne', 'curveTwo', 'circleOne', 'circleTwo',
                              'pointOne', 'pointTwo', 'centerPoint', 'cornerPoint',
                              'point', 'entity', 'line', 'curve',
                              'symmetryLine', 'ellipse', 'midPointCurve'):
                try:
                    target = getattr(ent, prop_name, None)
                    if not target:
                        continue
                    name = get_fb_name(target)
                    if name:
                        out.append(f"{prop_name}: {name}")
                except Exception:
                    continue

        return out
    except Exception:
        return []


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


def get_design_dimensions():
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        if not design:
            return None, None

        params = design.userParameters
        if not params:
            return None, None

        w_param = params.itemByName('widthIn') or params.itemByName('BSG_widthIn')
        h_param = params.itemByName('heightIn') or params.itemByName('BSG_heightIn')
        width = float(w_param.value) if w_param else None
        height = float(h_param.value) if h_param else None
        return width, height
    except:
        return None, None


def format_expr_component(value, symbol, scale):
    try:
        if scale is None or abs(scale) < 1e-9:
            return None
        if abs(value) < 1e-9:
            return '0'

        coeff = round(value / scale, 6)
        if abs(coeff) < 1e-6:
            return '0'

        abs_coeff = abs(coeff)
        if abs(abs_coeff - 1.0) < 1e-6:
            term = symbol
        else:
            term = f"{symbol} * {abs_coeff}"

        return f"-{term}" if coeff < 0 else term
    except:
        return None


def format_point_expr(pt, width, height):
    try:
        x_expr = format_expr_component(pt.geometry.x, 'widthIn', width)
        y_expr = format_expr_component(pt.geometry.y, 'heightIn', height)
        if x_expr is None or y_expr is None:
            return ''
        return f"({x_expr}, {y_expr})"
    except:
        return ''


def get_fb_attribute(ent, name):
    try:
        if hasattr(ent, 'attributes'):
            a = ent.attributes.itemByName('FrameBuilder', name)
            if a and a.value:
                return a.value
    except:
        pass
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
            point_name = get_fb_name(e)
            return f"{point_name}: ({round(e.geometry.x, 2)}, {round(e.geometry.y, 2)})"
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


def get_entity_coord_expr(e):
    try:
        width, height = get_design_dimensions()
        if e.objectType.endswith('SketchPoint'):
            point_name = get_fb_name(e)
            return f"{point_name}: {format_point_expr(e, width, height)}"
        if hasattr(e, 'startSketchPoint') and hasattr(e, 'endSketchPoint'):
            sp = e.startSketchPoint
            ep = e.endSketchPoint
            if hasattr(e, 'centerSketchPoint') and e.centerSketchPoint:
                cp = e.centerSketchPoint
                start_id = get_fb_attribute(e, 'StartID')
                end_id = get_fb_attribute(e, 'EndID')
                center_id = get_fb_attribute(e, 'CenterID')

                start_label = start_id or get_fb_name(sp)
                end_label = f"EndID={end_id}" if end_id else get_fb_name(ep)
                center_label = f"CenterID={center_id}" if center_id else get_fb_name(cp)
                arc_name = get_fb_name(e)
                bulge_label = f"{arc_name}:B" if cp else None

                start_expr = format_point_expr(sp, width, height)
                end_expr = format_point_expr(ep, width, height)
                center_expr = format_point_expr(cp, width, height)
                bulge_expr = format_point_expr(cp, width, height) if cp else ''

                if start_expr and end_expr and center_expr:
                    text = f"({start_label} : {start_expr}) -> ({end_label} : {end_expr}) -> ({center_label} : {center_expr})"
                    if bulge_label and bulge_expr:
                        text += f" --> (BulgeCenter= {bulge_label} : {bulge_expr})"
                    return text

                return f"{format_point_expr(sp, width, height)} -> {format_point_expr(cp, width, height)} -> {format_point_expr(ep, width, height)}"
            return f"{format_point_expr(sp, width, height)} -> {format_point_expr(ep, width, height)}"
        if hasattr(e, 'geometry') and hasattr(e.geometry, 'startPoint'):
            g = e.geometry
            sp = g.startPoint
            ep = g.endPoint
            return f"{format_point_expr(sp, width, height)} -> {format_point_expr(ep, width, height)}"
        if hasattr(e, 'boundingBox'):
            bb = e.boundingBox
            cx = (bb.minPoint.x + bb.maxPoint.x) / 2
            cy = (bb.minPoint.y + bb.maxPoint.y) / 2
            x_expr = format_expr_component(cx, 'widthIn', width)
            y_expr = format_expr_component(cy, 'heightIn', height)
            return f"Center: ({x_expr}, {y_expr})"
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
            p_data['coord_expr'] = get_entity_coord_expr(e)
            p_data['linked'] = get_fb_connections(e)
            p_data['listLabel'] = 'Details & Connections'
        
        # Batch Selection Case
        else:
            p_data['mainFeature'] = f"{count} Entities Selected"
            p_data['coord'] = "(Batch View)"
            p_data['coord_expr'] = "(Batch View)"
            p_data['listLabel'] = 'Selection List'
            p_data['linked_expr'] = []
            
            # List every item with its name, points/coordinates, and metadata
            for ent in entities:
                if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
                name = get_fb_name(ent)
                coord = get_entity_coord(ent)
                coord_expr = get_entity_coord_expr(ent) or coord
                fb_meta_item = get_fb_metadata(ent)
                entry = f"{name} | {coord}"
                expr_entry = f"{name} | {coord_expr}"
                if fb_meta_item:
                    entry += f" | {fb_meta_item}"
                    expr_entry += f" | {fb_meta_item}"
                p_data['linked'].append(entry)
                p_data['linked_expr'].append(expr_entry)

        bridge = get_fb_bridge(e)
        plan = get_fb_plan(e)
        fb_meta = get_fb_metadata(e)
        p_data['meta'] = f"{e.objectType.split('::')[-1]} | Bridge: {bridge or 'N/A'} | Plan: {plan or 'N/A'}"
        if fb_meta:
            p_data['meta'] += f" | {fb_meta}"
    _latest_payload = json.dumps(p_data)
    try:
        _log(f"[DEBUG_PUSH] palette valid={bool(palette and palette.isValid)} visible={bool(palette and palette.isVisible)}");
        palette.sendInfoToHTML('update', _latest_payload)
        _log("[DEBUG_PUSH] sendInfoToHTML called")
    except Exception as e:
        _log(f"[ERROR] sendInfoToHTML failed: {e}")

class _HTMLEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        html_args = adsk.core.HTMLEventArgs.cast(args)
        if html_args.action == 'poll':
            _log(f"[DEBUG_POLL] action=poll return_len={len(_latest_payload) if _latest_payload else 0}")
            html_args.returnData = _latest_payload
        elif html_args.action == 'copy':
            try:
                payload = html_args.data or ''
                _log(f"[DEBUG_COPY] received copy request len={len(payload)}")
                proc = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=False)
                proc.communicate(input=payload.encode('utf-8'))
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_COPY] {e}")
                html_args.returnData = 'error'
        elif html_args.action == 'response':
            _log('[DEBUG_HTML] ignore response event')
            html_args.returnData = ''
        else:
            _log(f"[DEBUG_HTML] unknown action={html_args.action}")
            html_args.returnData = ''

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
                for target_id in ('SketchTab', 'SolidTab'):
                    tab = ws.toolbarTabs.itemById(target_id)
                    if not tab:
                        for t in ws.toolbarTabs:
                            if target_id in t.id:
                                tab = t
                                break
                    if not tab:
                        continue

                    panel = tab.toolbarPanels.itemById(PANEL_ID)
                    if not panel:
                        panel = tab.toolbarPanels.add(PANEL_ID, 'B-Spline Builder', 'SelectPanel', False)
                    if not panel.controls.itemById(CMD_ID):
                        ctrl = panel.controls.addCommand(cmd_def)
                        ctrl.isPromoted = True
                        ctrl.isPromotedByDefault = True
            except Exception as e:
                _log(f"[ERROR] Failed to add Inspector to toolbar in workspace '{ws.id}': {e}")
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
