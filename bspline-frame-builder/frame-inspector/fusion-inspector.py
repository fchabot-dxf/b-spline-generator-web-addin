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
_sel_handler = None
_last_sel_ids = ""
_latest_payload = ""

PALETTE_ID = 'FusionInspector_Palette'
CMD_ID = 'FusionInspector_Command'
PANEL_ID = 'bsplinePanel'

_current_dir = os.path.dirname(os.path.realpath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)
from fb_shared.entity_helpers import (
    get_fb_name, get_fb_bridge, get_fb_plan, format_point,
    get_fb_metadata, get_fb_metadata_fields, entity_fingerprint, get_entity_coord,
)
from fb_shared.expression_coords import get_entity_coord_expr

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
    except Exception: pass

# ---------------------------------------------------------------------------
# ATTRIBUTE READERS (Restored from Backup)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# HANDLERS
# ---------------------------------------------------------------------------

class _SelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    def notify(self, args):
        try: _push_selection_to_palette()
        except Exception: _log(traceback.format_exc())

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
            except Exception: pass

    if current_ids == _last_sel_ids and _last_sel_ids != "": return
    _last_sel_ids = current_ids

    # Build High-Density Payload
    p_data = {
        'count': count,
        'mainFeature': 'Select geometry...',
        'coord': '',
        'linked': [],
        'listLabel': 'Connections',
        'meta': {},
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
                    # Append metadata only to the raw-coord entry. The
                    # parametric expr_entry already labels its points
                    # with their FrameBuilder IDs (e.g. "arc_X:S",
                    # "arc_X:B", "arc_X:E", "arc_X:C"), so re-appending
                    # "StartID=... | EndID=... | Bulge=..." would just
                    # duplicate the same information.
                    entry += f" | {fb_meta_item}"
                p_data['linked'].append(entry)
                p_data['linked_expr'].append(expr_entry)

        bridge = get_fb_bridge(e)
        plan = get_fb_plan(e)
        p_data['meta'] = {
            'type': e.objectType.split('::')[-1],
            'bridge': bridge or '',
            'plan': plan or '',
            **get_fb_metadata_fields(e)
        }
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

def _send_build_info(pal):
    """Best-effort version stamp: read build-info.json (add-in ROOT) via fb_shared,
    compare to source HEAD, push to the header badge. Never breaks the palette.
    See fb_shared.build_info / VERSION-STAMP-DESIGN.md."""
    try:
        import os as _os, sys as _sys, json as _json
        _root = _os.path.dirname(_os.path.abspath(__file__))
        for _ in range(6):  # walk up to the dir holding fb_shared (= add-in root)
            if _os.path.isdir(_os.path.join(_root, 'fb_shared')):
                break
            _root = _os.path.dirname(_root)
        if _root not in _sys.path:
            _sys.path.insert(0, _root)
        from fb_shared import build_info as _bi
        info = _bi.read_build_info(_root)
        status, message = _bi.compare_to_source(info)
        if pal:
            pal.sendInfoToHTML('build_info', _json.dumps({
                'sha': info.get('sha'), 'built_at': info.get('built_at'),
                'dirty': info.get('dirty'), 'status': status, 'message': message,
            }))
    except Exception:
        pass


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
        # Piggyback the deployed version stamp on palette open (once).
        _send_build_info(palette)

# ---------------------------------------------------------------------------
# LIFECYCLE
# ---------------------------------------------------------------------------

def run(context):
    global _sel_handler
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
        # Add Inspector button to SketchTab and SolidTab.
        for target_id in ('SketchTab', 'SolidTab', 'MillingTab'):
            try:
                tab = ui.allToolbarTabs.itemById(target_id)
                if not tab:
                    for t in ui.allToolbarTabs:
                        if target_id in getattr(t, 'id', '') or target_id in getattr(t, 'name', ''):
                            tab = t
                            break
                if not tab:
                    _log(f"[Fusion Inspector] could not find tab {target_id}. Available tabs:")
                    for t in ui.allToolbarTabs:
                        _log(f"  {getattr(t, 'id', None)!r} / {getattr(t, 'name', None)!r}")
                    continue

                _log(f"[Fusion Inspector] using tab {target_id} (id={tab.id!r}, name={tab.name!r})")
                unique_panel_id = f"{PANEL_ID}_{tab.id}"
                panel = tab.toolbarPanels.itemById(unique_panel_id)
                if not panel:
                    panel = tab.toolbarPanels.add(unique_panel_id, 'B-Spline Builder', 'SelectPanel', False)
                    _log(f"[Fusion Inspector] created panel {unique_panel_id} on {tab.id!r}")
                if not panel.controls.itemById(CMD_ID):
                    ctrl = panel.controls.addCommand(cmd_def)
                    ctrl.isPromoted = True
                    ctrl.isPromotedByDefault = True
                    _log(f"[Fusion Inspector] added {CMD_ID} to {unique_panel_id} on {tab.id!r} as promoted")
            except Exception as e:
                _log(f"[Fusion Inspector] toolbar registration failed for {target_id}: {e}\n" + traceback.format_exc())
        # 3. Selection Monitor
        try:
            if _sel_handler:
                ui.activeSelectionChanged.remove(_sel_handler)   # self-heal after an unclean prior stop
        except Exception:
            pass
        _sel_handler = _SelectionChangedHandler()
        ui.activeSelectionChanged.add(_sel_handler)
        _handlers.append(_sel_handler)

        _log("Fusion Inspector Standalone Start (Proper Registration)")
    except Exception:
        _log(traceback.format_exc())

def stop(context):
    global _sel_handler
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        
        palette = ui.palettes.itemById(PALETTE_ID)
        if palette: palette.deleteMe()
        
        for tab in ui.allToolbarTabs:
            if tab is None:
                continue
            try:
                panels_to_check = []
                for p in tab.toolbarPanels:
                    if p.id.startswith(PANEL_ID):
                        panels_to_check.append(p)
                        
                for panel in panels_to_check:
                    ctrl = panel.controls.itemById(CMD_ID)
                    if ctrl:
                        try:
                            ctrl.deleteMe()
                        except Exception:
                            pass
                    if panel.controls.count == 0:
                        try:
                            panel.deleteMe()
                        except Exception:
                            pass
            except Exception:
                pass

        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def: cmd_def.deleteMe()

        try:
            if _sel_handler:
                ui.activeSelectionChanged.remove(_sel_handler)
        except Exception:
            pass

        _log("Fusion Inspector Standalone Stop")
    except Exception:
        _log(traceback.format_exc())
    finally:
        _handlers.clear()
        _sel_handler = None
