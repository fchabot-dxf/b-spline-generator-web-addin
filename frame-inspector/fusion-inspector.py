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
_MAX_LOG_LINES = 12000
_KEEP_LOG_LINES = 9000
_PURGE_CHECK_EVERY = 120
_log_write_count = 0


def _purge_log_if_needed(path):
    try:
        if not os.path.exists(path):
            return
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        if len(lines) <= _MAX_LOG_LINES:
            return
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(lines[-_KEEP_LOG_LINES:])
    except Exception:
        pass

def _log(msg):
    global _log_write_count
    try:
        ts = datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]
        with open(_log_path, 'a', encoding='utf-8') as f:
            f.write(f"[{ts}] {msg}\n")
        _log_write_count += 1
        if _log_write_count % _PURGE_CHECK_EVERY == 0:
            _purge_log_if_needed(_log_path)
    except: pass


def _entity_attr(ent, group, name):
    """Best-effort attribute lookup across proxy/native forms of the same entity."""
    try:
        if not ent:
            return None
        candidates = [ent]
        try:
            if hasattr(ent, 'nativeObject') and ent.nativeObject:
                candidates.append(ent.nativeObject)
        except Exception:
            pass
        for cand in candidates:
            try:
                if hasattr(cand, 'attributes'):
                    a = cand.attributes.itemByName(group, name)
                    if a:
                        return a.value
            except Exception:
                pass
    except Exception:
        pass
    return None

# ---------------------------------------------------------------------------
# ATTRIBUTE READERS (Restored from Backup)
# ---------------------------------------------------------------------------

def get_fb_name(ent):
    try:
        if not ent: return "None"
        
        # 1. Primary Look-up: New Modular Engine (ParametricEngine:ID)
        name = _entity_attr(ent, 'ParametricEngine', 'ID')
        if name: return name
        
        # 2. Secondary Look-up: Legacy Engine (FrameBuilder:name)
        raw = _entity_attr(ent, 'FrameBuilder', 'name')
        if raw:
            return raw.split('\n')[0]

        # 3. Native Property Fallback (SketchLines/Curves)
        try:
            nm = getattr(ent, 'name', None)
            if nm and not str(nm).startswith('Sketch'):
                return str(nm)
        except Exception:
            pass
            
        # Point-specific fallback (Vertex of Curve)
        if ent.objectType.endswith('SketchPoint'):
            parents = []
            if hasattr(ent, 'connectedEntities'):
                for ce in ent.connectedEntities:
                    name = get_fb_name(ce)
                    if name and not name.startswith('Sketch'):
                        parents.append(name.split('.')[-1])
            # If no connected entities resolve, try parent curve endpoints.
            if not parents and hasattr(ent, 'parentSketch') and ent.parentSketch:
                try:
                    for ln in ent.parentSketch.sketchCurves.sketchLines:
                        if ln.startSketchPoint == ent or ln.endSketchPoint == ent:
                            pname = get_fb_name(ln)
                            if pname and not pname.startswith('Sketch'):
                                parents.append(pname.split('.')[-1])
                except Exception:
                    pass
            if parents:
                return f"Vertex of {', '.join(parents)}"
        
        return ent.objectType.split('::')[-1]
    except: return "Entity"

def get_fb_bridge(ent):
    try:
        raw = _entity_attr(ent, 'FrameBuilder', 'name')
        if raw:
            lines = raw.split('\n')
            if len(lines) > 1:
                return lines[1]
    except: pass
    return ""

def get_fb_plan(ent):
    try:
        raw = _entity_attr(ent, 'FrameBuilder', 'plan')
        if raw:
            return raw
    except: pass
    return ""

def get_sketch_name(ent):
    try:
        if not ent:
            return ""
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        parent_sketch = getattr(ent, 'parentSketch', None)
        if parent_sketch and getattr(parent_sketch, 'name', None):
            return str(parent_sketch.name)
    except:
        pass
    return ""

def get_fb_connections(ent):
    linked = []
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject

        is_point = ent.objectType.endswith('SketchPoint')

        # SketchPoint: enumerate curves attached to this point
        if is_point and hasattr(ent, 'connectedEntities'):
            for curve in ent.connectedEntities:
                name = get_fb_name(curve)
                if name and name not in linked:
                    linked.append(name)

        # Curves: show neighboring curves via start/end share
        if hasattr(ent, 'startSketchPoint'):
            for curve in ent.startSketchPoint.connectedEntities:
                if curve != ent:
                    name = get_fb_name(curve)
                    if name and name not in linked:
                        linked.append(name)
        if hasattr(ent, 'endSketchPoint'):
            for curve in ent.endSketchPoint.connectedEntities:
                if curve != ent:
                    name = get_fb_name(curve)
                    if name and name not in linked:
                        linked.append(name)

        # Constraints: resolve the other side's entity ID
        this_token = entity_fingerprint(ent)
        if hasattr(ent, 'geometricConstraints'):
            for gc in ent.geometricConstraints:
                gtype = gc.objectType.split('::')[-1].replace('GeometricConstraint', '')
                other_name = None
                try:
                    # Fusion constraint attribute names vary by type:
                    # CoincidentConstraint: .point, .entity
                    # TangentConstraint, EqualConstraint: .curveOne, .curveTwo
                    # ParallelConstraint, PerpendicularConstraint: .lineOne, .lineTwo
                    for attr in ('point', 'entity', 'pointOne', 'pointTwo',
                                 'lineOne', 'lineTwo', 'curveOne', 'curveTwo',
                                 'entityOne', 'entityTwo'):
                        val = getattr(gc, attr, None)
                        if val is None:
                            continue
                        try:
                            if entity_fingerprint(val) == this_token:
                                continue  # skip self
                        except Exception:
                            pass
                        name = get_fb_name(val)
                        if name:
                            other_name = name
                            break
                except Exception:
                    pass
                entry = f"{gtype} -> {other_name}" if other_name else gtype
                if entry not in linked:
                    linked.append(entry)
    except:
        pass
    return linked

def get_entity_point_details(ent):
    details = []
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject

        # For arcs only: show center point (not shown in coord string)
        if hasattr(ent, 'centerSketchPoint') and ent.centerSketchPoint and hasattr(ent.centerSketchPoint, 'geometry'):
            cp = ent.centerSketchPoint.geometry
            cp_name = get_fb_name(ent.centerSketchPoint)
            details.append(f"Center: {cp_name} | Point: ({round(cp.x, 2)}, {round(cp.y, 2)})")
    except:
        pass
    return details

def get_entity_selection_lines(ent):
    lines = []
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        name = get_fb_name(ent)
        coord = get_entity_coord(ent)
        lines.append(f"{name} | {coord}")
        for detail in get_entity_point_details(ent):
            lines.append(f"  {detail}")
    except:
        pass
    return lines


def is_linear_dimension(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        ot = getattr(ent, 'objectType', '') or ''
        if 'SketchLinearDimension' in ot:
            return True
        if 'SketchDistanceDimension' in ot:
            return True
        return False
    except Exception:
        return False


def get_dimension_summary(ent):
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject
        p = getattr(ent, 'parameter', None)
        if p:
            expr = str(getattr(p, 'expression', '')).strip()
            try:
                val = float(getattr(p, 'value', 0.0))
                if expr:
                    return f"Expr: {expr} | Value(cm): {round(val, 3)}"
                return f"Value(cm): {round(val, 3)}"
            except Exception:
                if expr:
                    return f"Expr: {expr}"
        return "Linear Dimension"
    except Exception:
        return "Linear Dimension"


def get_dimension_associated_entities(ent):
    out = []
    seen = set()
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject

        keys = (
            'entityOne', 'entityTwo', 'lineOne', 'lineTwo', 'curveOne', 'curveTwo',
            'pointOne', 'pointTwo', 'point', 'entity', 'firstEntity', 'secondEntity'
        )
        for k in keys:
            val = getattr(ent, k, None)
            if not val:
                continue
            tok = entity_fingerprint(val)
            if tok in seen:
                continue
            seen.add(tok)
            out.append(val)
    except Exception:
        pass
    return out


def get_dimension_selection_lines(ent):
    lines = []
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            ent = ent.nativeObject

        lines.append(f"Dimension: {get_fb_name(ent)} | {get_dimension_summary(ent)}")
        assoc = get_dimension_associated_entities(ent)
        if not assoc:
            lines.append("  Assoc: <none resolved>")
            return lines

        for a in assoc:
            lines.append(f"  Assoc: {get_fb_name(a)} | {get_entity_coord(a)}")
            for detail in get_entity_point_details(a):
                lines.append(f"    {detail}")
    except Exception:
        pass
    return lines

def entity_fingerprint(ent):
    try:
        if hasattr(ent, 'entityToken') and ent.entityToken: return ent.entityToken
        if hasattr(ent, 'tempId'): return f"{ent.objectType}_{ent.tempId}"
        return f"{ent.objectType}_{id(ent)}"
    except: return str(id(ent))

def get_entity_coord(e):
    try:
        if is_linear_dimension(e):
            return get_dimension_summary(e)
        if e.objectType.endswith('SketchPoint'):
            return f"Point: ({round(e.geometry.x, 2)}, {round(e.geometry.y, 2)})"
        if hasattr(e, 'startSketchPoint') and hasattr(e, 'endSketchPoint'):
            sp = e.startSketchPoint.geometry
            ep = e.endSketchPoint.geometry
            s_name = get_fb_name(e.startSketchPoint)
            e_name = get_fb_name(e.endSketchPoint)
            return (
                f"{s_name}: ({round(sp.x,2)}, {round(sp.y,2)}) -> "
                f"{e_name}: ({round(ep.x,2)}, {round(ep.y,2)})"
            )
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


def _dump_selected_entity_attrs():
    app = adsk.core.Application.get()
    ui = app.userInterface
    sels = ui.activeSelections
    count = sels.count if sels else 0
    _log(f"[DUMP] begin selected_count={count}")
    if not sels or count == 0:
        _log("[DUMP] no active selection")
        return "ok:no-selection"

    for i in range(count):
        try:
            ent = sels.item(i).entity
            if not ent:
                _log(f"[DUMP] sel[{i}] null entity")
                continue

            candidates = [ent]
            try:
                if hasattr(ent, 'nativeObject') and ent.nativeObject:
                    candidates.append(ent.nativeObject)
            except Exception:
                pass

            for j, cand in enumerate(candidates):
                label = "native" if j == 1 else "proxy"
                try:
                    is_ref = bool(getattr(cand, 'isReference', False)) if hasattr(cand, 'isReference') else False
                except Exception:
                    is_ref = False
                try:
                    is_const = bool(getattr(cand, 'isConstruction', False)) if hasattr(cand, 'isConstruction') else False
                except Exception:
                    is_const = False

                _log(
                    f"[DUMP] sel[{i}] {label} type={cand.objectType.split('::')[-1]} "
                    f"token={entity_fingerprint(cand)} isReference={is_ref} isConstruction={is_const}"
                )

                try:
                    pe_id = _entity_attr(cand, 'ParametricEngine', 'ID')
                    fb_name = _entity_attr(cand, 'FrameBuilder', 'name')
                    fb_plan = _entity_attr(cand, 'FrameBuilder', 'plan')
                    _log(f"[DUMP] sel[{i}] {label} PE_ID={pe_id if pe_id else '<none>'}")
                    _log(f"[DUMP] sel[{i}] {label} FB_Name={fb_name if fb_name else '<none>'}")
                    _log(f"[DUMP] sel[{i}] {label} FB_Plan={fb_plan if fb_plan else '<none>'}")
                except Exception:
                    pass

                try:
                    if cand.objectType.endswith('SketchPoint') and hasattr(cand, 'geometry') and cand.geometry:
                        _log(
                            f"[DUMP] sel[{i}] {label} point=({cand.geometry.x:.4f}, {cand.geometry.y:.4f})"
                        )
                except Exception:
                    pass

                try:
                    nm = getattr(cand, 'name', None)
                    if nm:
                        _log(f"[DUMP] sel[{i}] {label} name={nm}")
                except Exception:
                    pass

                try:
                    if hasattr(cand, 'attributes'):
                        attrs = cand.attributes
                        _log(f"[DUMP] sel[{i}] {label} attr_count={attrs.count}")
                        for k in range(attrs.count):
                            a = attrs.item(k)
                            _log(f"[DUMP] sel[{i}] {label} attr[{k}] {a.groupName}/{a.name}={a.value}")
                except Exception as ex:
                    _log(f"[DUMP] sel[{i}] {label} attr-read-fail={ex}")

                # For projected points, connected entities often carry usable IDs.
                try:
                    if cand.objectType.endswith('SketchPoint') and hasattr(cand, 'connectedEntities'):
                        conns = cand.connectedEntities
                        _log(f"[DUMP] sel[{i}] {label} connected_count={conns.count}")
                        for m in range(conns.count):
                            ce = conns.item(m)
                            ce_type = ce.objectType.split('::')[-1]
                            ce_tok = entity_fingerprint(ce)
                            ce_name = _entity_attr(ce, 'FrameBuilder', 'name')
                            try:
                                ce_ref = bool(getattr(ce, 'isReference', False)) if hasattr(ce, 'isReference') else False
                            except Exception:
                                ce_ref = False
                            _log(
                                f"[DUMP] sel[{i}] {label} conn[{m}] type={ce_type} token={ce_tok} "
                                f"isReference={ce_ref} fb_name={ce_name if ce_name else '<none>'}"
                            )
                except Exception as ex:
                    _log(f"[DUMP] sel[{i}] {label} connected-read-fail={ex}")

        except Exception as ex:
            _log(f"[DUMP] sel[{i}] fail={ex}")

    _log("[DUMP] end")
    return "ok"

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
            sketch_name = get_sketch_name(e)
            feature_name = get_fb_name(e)
            p_data['mainFeature'] = f"{sketch_name} | {feature_name}" if sketch_name else feature_name
            p_data['coord'] = get_entity_coord(e)
            if is_linear_dimension(e):
                p_data['linked'] = get_dimension_selection_lines(e)
                p_data['listLabel'] = 'Linear Dimension Links'
            else:
                point_details = get_entity_point_details(e)
                p_data['linked'] = point_details + get_fb_connections(e)
                p_data['listLabel'] = 'Points & Connections'
        
        # Batch Selection Case
        else:
            p_data['mainFeature'] = f"{count} Entities Selected"
            p_data['coord'] = "(Batch View)"
            p_data['listLabel'] = 'Selection By Sketch'

            grouped = {}
            for ent in entities:
                if hasattr(ent, 'nativeObject') and ent.nativeObject: ent = ent.nativeObject
                sketch_name = get_sketch_name(ent) or '[No Sketch]'
                if is_linear_dimension(ent):
                    grouped.setdefault(sketch_name, []).extend(get_dimension_selection_lines(ent))
                else:
                    grouped.setdefault(sketch_name, []).extend(get_entity_selection_lines(ent))

            for sketch_name in sorted(grouped.keys()):
                p_data['linked'].append(f"Sketch: {sketch_name}")
                for line in grouped[sketch_name]:
                    p_data['linked'].append(f"  {line}" if not line.startswith('  ') else f"    {line.strip()}" )

        bridge = get_fb_bridge(e)
        plan = get_fb_plan(e)
        p_data['meta'] = f"{e.objectType.split('::')[-1]} | Bridge: {bridge or 'N/A'} | Plan: {plan or 'N/A'}"

        # Debug trace: verify projected/reference entities and resolved FrameBuilder ID.
        try:
            is_ref = bool(getattr(e, 'isReference', False)) if hasattr(e, 'isReference') else False
        except Exception:
            is_ref = False
        try:
            is_const = bool(getattr(e, 'isConstruction', False)) if hasattr(e, 'isConstruction') else False
        except Exception:
            is_const = False
        _log(
            f"[SEL] count={count} type={e.objectType.split('::')[-1]} name={p_data['mainFeature']} "
            f"isReference={is_ref} isConstruction={is_const} token={entity_fingerprint(e)}"
        )
        try:
            raw_name = _entity_attr(e, 'FrameBuilder', 'name')
            _log(f"[SEL] fb_name={raw_name if raw_name else '<none>'}")
        except Exception:
            pass

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
        elif html_args.action == 'dumpAttrs':
            try:
                html_args.returnData = _dump_selected_entity_attrs()
            except Exception as e:
                _log(f"[DUMP] handler-fail={e}")
                html_args.returnData = 'error'

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

        resources_path = os.path.join(_current_dir, 'resources', 'InspectorCommand').replace('\\', '/')
        cmd_def = ui.commandDefinitions.addButtonDefinition(CMD_ID, 'Fusion Inspector', 'Visualizes Frame Builder Metadata', resources_path)
        
        handler = CommandCreatedHandler()
        cmd_def.commandCreated.add(handler)
        _handlers.append(handler)
        
        # 2. UI Button Insertion
        # Add Inspector button to SketchTab and Solid main tabs.
        for ws in ui.workspaces:
            try:
                candidate_tabs = []

                # A. Sketch Tab Discovery
                sk_tab = ws.toolbarTabs.itemById('SketchTab')
                if not sk_tab:
                    try:
                        for t in ws.toolbarTabs:
                            if 'SketchTab' in t.id:
                                sk_tab = t
                                break
                    except: pass
                if sk_tab: candidate_tabs.append(sk_tab)

                # B. Solid/Design Tab Discovery
                st = None
                for solid_id in ('SolidTab', 'DesignTab', 'FusionSolidTab', 'SimSolidTab', 'GenSolidTab'):
                    try:
                        st = ws.toolbarTabs.itemById(solid_id)
                        if st: break
                    except: pass
                
                if not st:
                    try:
                        for t in ws.toolbarTabs:
                            if 'SolidTab' in t.id or 'DesignTab' in t.id:
                                st = t
                                break
                    except: pass
                
                if st and all(existing.id != st.id for existing in candidate_tabs):
                    candidate_tabs.append(st)

                # C. Aggressive Process Candidate Tabs
                for tab in candidate_tabs:
                    # 1. Ensure our CUSTOM panel exists
                    panel = tab.toolbarPanels.itemById(PANEL_ID)
                    if not panel:
                        panel = tab.toolbarPanels.add(PANEL_ID, 'INSPECTOR', '', False)
                    
                    # Force recreate button in custom panel
                    try:
                        old_ctrl = panel.controls.itemById(CMD_ID)
                        if old_ctrl: old_ctrl.deleteMe()
                    except: pass
                    
                    ctrl = panel.controls.addCommand(cmd_def)
                    ctrl.isPromoted = True
                    ctrl.isPromotedByDefault = True
                    _log(f"[LOG] Force-recreated button in custom panel: {PANEL_ID} in tab: {tab.id} of {ws.id}")

                    # 2. Fallback: also inject into standard 'Inspect' panel if it exists (for maximum visibility)
                    try:
                        for native_id in ['InspectPanel', 'InspectPanel_Design']:
                            native_panel = tab.toolbarPanels.itemById(native_id)
                            if native_panel:
                                try:
                                    old_native = native_panel.controls.itemById(CMD_ID)
                                    if old_native: old_native.deleteMe()
                                except: pass
                                n_ctrl = native_panel.controls.addCommand(cmd_def)
                                n_ctrl.isPromoted = True
                                n_ctrl.isPromotedByDefault = True
                                _log(f"[LOG] Fallback injected into native panel {native_id} in tab: {tab.id}")
                    except Exception as ex:
                        _log(f"[DEBUG] Native panel injection failed in tab {tab.id}: {ex}")

            except Exception as e:
                # Silence common workspace-initialization errors
                if "No product type" not in str(e):
                    _log(f"[ERROR] Failed to add Inspector to workspace '{ws.id}': {e}")
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
        
        # Cleanup panels in ALL workspaces
        for ws in ui.workspaces:
            try:
                for tab in ws.toolbarTabs:
                    panel = tab.toolbarPanels.itemById(PANEL_ID)
                    if panel:
                        ctrl = panel.controls.itemById(CMD_ID)
                        if ctrl: ctrl.deleteMe()
                        if panel.controls.count == 0:
                            panel.deleteMe()
            except: pass

        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def: cmd_def.deleteMe()
            
        _log("Fusion Inspector Standalone Stop")
    except: pass
