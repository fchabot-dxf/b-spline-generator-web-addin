"""
CAM Builder -- Manufacturing Model + Setup scaffolder.

Top-level sub-module entry point. Follows the same lifecycle pattern as
template-maker / fusion-inspector / fusion-exporter:

  * `run(context)` registers a button command in the shared bsplinePanel
    and wires the palette HTML <-> Python bridge.
  * `stop(context)` releases every event subscription, command def, and
    palette so a Stop -> Start cycle reloads from disk cleanly.

Pass 1 -- "prove the plumbing"
------------------------------
This iteration creates the 3 Manufacturing Models and 4 Setups WITHOUT
body filtering. All MMs hold the same bodies (the full design); we just
want to confirm the API calls land in Fusion's CAM browser correctly.
Body-filter logic (remove frame from B-spline MM, etc.) is Pass 2.

Preview action
--------------
Read-only dry run: enumerates Design bodies, runs the classifier, and
streams the report back to the palette so the user can sanity-check
classification before writing anything.
"""

import os, sys, json, traceback, importlib.util

import adsk.core
import adsk.fusion
import adsk.cam


# ---------------------------------------------------------------------------
# Constants -- match the bspline-frame-builder shared panel ID.
# ---------------------------------------------------------------------------

# ── B-spline CAM palette ───────────────────────────────────────────────────
CMD_ID            = 'CamBuilder_Command'
PALETTE_ID        = 'CamBuilder_Palette'
PANEL_ID          = 'bsplinePanel'    # shared with the rest of the suite
REFRESH_EVENT_ID  = 'CamBuilder_DeferredRefresh'
TPGEN_EVENT_ID    = 'CamBuilder_DeferredTPGen'

PALETTE_NAME      = 'B-spline CAM'
PALETTE_WIDTH     = 460
PALETTE_HEIGHT    = 620

_addin_dir = os.path.dirname(os.path.realpath(__file__))
PALETTE_URL = os.path.join(_addin_dir, 'ui', 'html', 'cam_builder_palette.html').replace('\\', '/')
RESOURCES_PATH = os.path.join(_addin_dir, 'resources', 'CamCommand')

# ── CAM Studio palette (generic, profile-driven) ───────────────────────────
STUDIO_CMD_ID         = 'CamStudio_Command'
STUDIO_PALETTE_ID     = 'CamStudio_Palette'
STUDIO_PALETTE_NAME   = 'CAM Studio'
STUDIO_PALETTE_WIDTH  = 460
STUDIO_PALETTE_HEIGHT = 700
STUDIO_PALETTE_URL    = os.path.join(_addin_dir, 'ui', 'html', 'cam_studio_palette.html').replace('\\', '/')
STUDIO_RESOURCES_PATH = os.path.join(_addin_dir, 'resources', 'CamStudioCommand')


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_handlers = []          # per-run handlers, cleared on stop
_refresh_handlers = []  # CustomEvent handlers, alive for full Fusion session
_html_handler        = None   # B-spline CAM palette
_studio_html_handler = None   # CAM Studio palette
_logger = None
_engine = None          # cam_engine.cam_coordinator after load

_refresh_event = None
_refresh_registered = False


# ---------------------------------------------------------------------------
# Submodule loader -- mirrors the pattern used by other sub-modules so each
# Stop -> Start reloads from disk.
# ---------------------------------------------------------------------------

def _wipe(names):
    for n in names:
        if n in sys.modules:
            try:
                del sys.modules[n]
            except Exception:
                pass
        for k in list(sys.modules.keys()):
            if k.startswith(n + '.'):
                try:
                    del sys.modules[k]
                except Exception:
                    pass


def _load_engine():
    """Load (or reload) cam_engine.* and cam_utils.* fresh from disk."""
    global _engine, _logger

    if _addin_dir not in sys.path:
        sys.path.insert(0, _addin_dir)

    _wipe(['cam_engine', 'cam_utils'])

    from cam_utils.cam_logger import make_logger
    _logger = make_logger(_addin_dir, category='cam')
    _logger.session_start("CAM Builder run")

    from cam_engine import cam_coordinator
    _engine = cam_coordinator


# ---------------------------------------------------------------------------
# Body classifier -- maps a BRepBody to one of 'frame', 'panel', 'unknown'.
# Anchors observed in real designs:
#   * "B-Spline Set" -- top-level component holding the panel solid one or
#     two occurrence levels deep (e.g. "B-Spline Set > Terrain - Clean
#     Solid > Body1"). Walk the ancestry, don't just check parentComponent.
#   * frame_<label> -- body name pattern from extrusion_engine.py:178.
#
# Note on stock: the user keeps a "stock" placeholder component in the
# design tree, but it is NOT a real body to be machined or kept in any
# MM. The Stock MM will *extrude its own stock body* during MM editing
# (Pass 2). Bodies under the stock placeholder fall through to
# 'unknown' here on purpose.
#
# The classifier is wired in cam-builder.py (not deep in cam_engine) so a
# user with a non-standard naming convention can override this single
# function without touching the engine.
# ---------------------------------------------------------------------------

def _occurrence_ancestor_names(body):
    """Yield lowercased component names from body.assemblyContext walked
    up to the root, plus the immediate parentComponent.

    Order: innermost -> outermost. Caller can `any('foo' in n for n in ...)`
    without caring about depth.
    """
    try:
        pc = body.parentComponent
        if pc and pc.name:
            yield pc.name.lower()
    except Exception:
        pass

    try:
        occ = body.assemblyContext
    except Exception:
        occ = None
    while occ is not None:
        try:
            comp = occ.component
            if comp and comp.name:
                yield comp.name.lower()
        except Exception:
            pass
        try:
            occ = occ.assemblyContext
        except Exception:
            break


def _classify_body(body):
    try:
        bname = (body.name or '').lower()
    except Exception:
        bname = ''

    # 1. Frame bodies: explicit name prefix from the extrusion engine.
    if bname.startswith('frame_'):
        return 'frame'

    # 2. Walk the occurrence ancestry -- panels live inside the
    # "B-Spline Set" component, often two levels deep.
    ancestors = list(_occurrence_ancestor_names(body))
    if any('b-spline set' in n or 'bspline set' in n for n in ancestors):
        return 'panel'

    # 3. Loose fallbacks for non-standard scenes.
    if 'panel' in bname or 'bspline' in bname or 'b-spline' in bname:
        return 'panel'
    if 'frame' in bname:
        return 'frame'

    return 'unknown'


def _enumerate_bodies(design):
    """Walk every component (root + occurrences) and yield BRepBody refs."""
    if not design:
        return
    try:
        for body in design.rootComponent.bRepBodies:
            yield body
    except Exception:
        pass

    try:
        for occ in design.rootComponent.allOccurrences:
            try:
                for body in occ.component.bRepBodies:
                    yield body
            except Exception:
                continue
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Palette handlers
# ---------------------------------------------------------------------------

class _CmdCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            _show_palette()
        except Exception:
            _log_error("CmdCreated\n" + traceback.format_exc())


class _HtmlEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        try:
            # IMPORTANT: cast args to HTMLEventArgs first. Without it,
            # `args.action` / `args.data` come back empty on some Fusion
            # builds, which causes data.get('action') to silently return
            # None and the dispatch falls into the 'unknown' branch.
            # Verified via live tracer 2026-05-15 — the boot pair
            # (list_cam_templates / get_template_assignments) hit this
            # exact path. Reading the first arg directly via ea.action is
            # the canonical way (mirrors step-editor.py); ea.data is
            # the second arg as a JSON string. We keep the JSON fallback
            # so callers that ONLY put the action inside data still work.
            ea = adsk.core.HTMLEventArgs.cast(args)
            data = json.loads(ea.data) if ea.data else {}
            action = ea.action or data.get('action')
            # 'generate' = legacy single-button; treat as alias for 'build'
            # so existing callers don't break. New palette uses 'build'
            # and 'apply_toolpaths' as separate actions.
            if action == 'generate' or action == 'build':
                _do_generate()
            elif action == 'apply_toolpaths':
                _do_apply_toolpaths()
            elif action == 'add_machine':
                _do_add_machine()
            elif action == 'sync_table_attach':
                _do_sync_table_attach()
            elif action == 'preview':
                _do_preview()
            elif action == 'list_cam_templates':
                _do_list_cam_templates()
            elif action == 'get_template_assignments':
                _do_get_template_assignments()
            elif action == 'set_template_assignments':
                _do_set_template_assignments(data)
            else:
                _log(f"unknown HTML action: {action!r}", "WARNING")
        except Exception:
            _log_error("HtmlEvent\n" + traceback.format_exc())


# ---------------------------------------------------------------------------
# Template browser handlers
# ---------------------------------------------------------------------------

def _do_list_cam_templates():
    """Send the cloud / local / system template inventory to JS."""
    try:
        import adsk.cam
        cam_mgr = adsk.cam.CAMManager.get()
        tpl_lib = cam_mgr.libraryManager.templateLibrary
        payload = {'cloud': [], 'local': [], 'system': []}
        for key, loc_enum in (
            ('cloud',  adsk.cam.LibraryLocations.CloudLibraryLocation),
            ('local',  adsk.cam.LibraryLocations.LocalLibraryLocation),
            ('system', adsk.cam.LibraryLocations.Fusion360LibraryLocation),
        ):
            try:
                root = tpl_lib.urlByLocation(loc_enum)
                if not root:
                    continue
                for asset in tpl_lib.childAssetURLs(root):
                    payload[key].append({
                        'leaf':    asset.leafName,
                        'url':     asset.toString(),
                    })
            except Exception:
                # Empty / unreachable libraries are normal — skip silently.
                continue
        _palette_send('templates_list', payload)
    except Exception:
        _log_error("list_cam_templates\n" + traceback.format_exc())


def _ensure_engine_path():
    """Put _addin_dir on sys.path so `from cam_engine import …` works
    BEFORE the user has ever clicked Generate. Without this the import
    silently fails — caught by the handler's try/except, but JS never
    sees a response and the palette counts stay at the HTML default 0.
    Idempotent (no-op when already present). Mirrors the sys.path
    setup in _load_engine without re-importing the engine itself."""
    if _addin_dir not in sys.path:
        sys.path.insert(0, _addin_dir)


def _do_get_template_assignments():
    """Send current per-setup template lists (overrides if any, otherwise
    the SETUP_SPECS defaults) to JS."""
    try:
        _ensure_engine_path()
        from cam_engine import setup_builder as _sb
        from cam_engine import template_assignments as _ta
        # Active design (may be None outside the Manufacture workspace).
        app = adsk.core.Application.get()
        design = None
        try:
            design = adsk.fusion.Design.cast(
                app.activeDocument.products.itemByProductType('DesignProductType'))
        except Exception:
            pass
        out = []
        for spec in _sb.SETUP_SPECS:
            name = spec['name']
            override = _ta.load_for_setup(design, name)
            default = spec.get('cloud_templates') or []
            out.append({
                'setup':       name,
                'templates':   override if override is not None else default,
                'is_override': override is not None,
                'default':     default,
            })
        _palette_send('template_assignments', {'setups': out})
    except Exception:
        _log_error("get_template_assignments\n" + traceback.format_exc())


def _do_set_template_assignments(data):
    """JS sends { setup, templates: [leafName,...] }; we persist as a
    Design attribute (via template_assignments). Pass templates: null to
    clear the override and fall back to defaults."""
    try:
        _ensure_engine_path()
        from cam_engine import template_assignments as _ta
        setup_name = data.get('setup')
        leaves     = data.get('templates')   # list, [] (== "no templates"), or None
        if not setup_name:
            return
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(
            app.activeDocument.products.itemByProductType('DesignProductType'))
        if leaves is None:
            _ta.clear_for_setup(design, setup_name)
        else:
            _ta.save_for_setup(design, setup_name, list(leaves))
        # Echo the new state so JS re-renders.
        _do_get_template_assignments()
    except Exception:
        _log_error("set_template_assignments\n" + traceback.format_exc())


def _palette_send(action, payload):
    """Tiny helper — send a typed message to the CAM Builder palette JS."""
    try:
        app = adsk.core.Application.get()
        pal = app.userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML(action, json.dumps(payload))
    except Exception:
        pass


def _show_palette():
    app = adsk.core.Application.get()
    ui = app.userInterface

    if not os.path.exists(PALETTE_URL):
        ui.messageBox(f"CAM Builder HTML not found at {PALETTE_URL}")
        _log_error(f"missing palette html: {PALETTE_URL}")
        return

    palette = ui.palettes.itemById(PALETTE_ID)
    if not palette:
        palette = ui.palettes.add(
            PALETTE_ID, PALETTE_NAME, PALETTE_URL,
            True,  # isVisible
            True,  # showCloseButton
            True,  # isResizable
            PALETTE_WIDTH, PALETTE_HEIGHT,
        )
        try:
            palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
            palette.setMinimumSize(360, 500)
        except Exception:
            pass
        global _html_handler
        _html_handler = _HtmlEventHandler()
        palette.incomingFromHTML.add(_html_handler)
        _handlers.append(_html_handler)
    palette.isVisible = True


# ---------------------------------------------------------------------------
# CAM Studio palette handlers + helpers
# ---------------------------------------------------------------------------

class _StudioCmdCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            _show_studio_palette()
        except Exception:
            _log_error("StudioCmdCreated\n" + traceback.format_exc())


class _StudioHtmlEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        try:
            # Same cast-first pattern as _HtmlEventHandler — see the long
            # comment there. Some Fusion builds return empty args.action/
            # args.data unless we cast through HTMLEventArgs first.
            ea = adsk.core.HTMLEventArgs.cast(args)
            data = json.loads(ea.data) if ea.data else {}
            action = ea.action or data.get('action')
            if   action == 'generate':      _do_studio_generate(data)
            elif action == 'init':          _do_studio_init()
            elif action == 'import_setup':  _do_import_setup(data)
            else:
                _log(f"Studio: unknown HTML action: {action!r}", "WARNING")
        except Exception:
            _log_error("StudioHtmlEvent\n" + traceback.format_exc())


def _show_studio_palette():
    app = adsk.core.Application.get()
    ui  = app.userInterface

    if not os.path.exists(STUDIO_PALETTE_URL):
        ui.messageBox(f"CAM Studio HTML not found at {STUDIO_PALETTE_URL}")
        _log_error(f"missing studio palette html: {STUDIO_PALETTE_URL}")
        return

    palette = ui.palettes.itemById(STUDIO_PALETTE_ID)
    if not palette:
        palette = ui.palettes.add(
            STUDIO_PALETTE_ID, STUDIO_PALETTE_NAME, STUDIO_PALETTE_URL,
            True, True, True,
            STUDIO_PALETTE_WIDTH, STUDIO_PALETTE_HEIGHT,
        )
        try:
            palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
            palette.setMinimumSize(360, 500)
        except Exception:
            pass
        global _studio_html_handler
        _studio_html_handler = _StudioHtmlEventHandler()
        palette.incomingFromHTML.add(_studio_html_handler)
        _handlers.append(_studio_html_handler)
    palette.isVisible = True


def _send_to_studio_html(action, payload):
    try:
        app = adsk.core.Application.get()
        if not app:
            return
        palette = app.userInterface.palettes.itemById(STUDIO_PALETTE_ID)
        if palette and palette.isVisible:
            palette.sendInfoToHTML(action, json.dumps(payload))
    except Exception:
        _log_error(f"_send_to_studio_html({action})\n" + traceback.format_exc())


def _do_studio_init():
    """On palette open: send design components + existing CAM setup names."""
    try:
        app = adsk.core.Application.get()
        doc = app.activeDocument

        components = []
        try:
            ds = doc.products.itemByProductType('DesignProductType')
            design = adsk.fusion.Design.cast(ds)
            if design:
                root = design.rootComponent
                for i in range(root.occurrences.count):
                    try:
                        components.append(root.occurrences.item(i).component.name)
                    except Exception:
                        pass
                # Fallback: a doc with loose bodies in the root component and
                # NO sub-component occurrences (a quick single-body part) has
                # nothing to SCAN. Offer the root component itself so the
                # generic build still runs — _collect_bodies pulls the root
                # bodies and the MM filter keeps everything (no siblings to
                # strip). Without this the component list comes back empty and
                # BUILD fails with "requires component_names".
                if not components and root.bRepBodies.count > 0:
                    components.append(root.name)
        except Exception:
            pass

        setups = []
        try:
            for i in range(doc.products.count):
                p = doc.products.item(i)
                if p.objectType == 'adsk::cam::CAM':
                    cam = adsk.cam.CAM.cast(p)
                    for j in range(cam.setups.count):
                        try:
                            setups.append(cam.setups.item(j).name)
                        except Exception:
                            pass
                    break
        except Exception:
            pass

        # Model bounding-box dimensions (mm), so the palette can pre-fill the
        # fixed-size stock inputs with the part size. Combine every body's box.
        model_dims = None
        try:
            ds = doc.products.itemByProductType('DesignProductType')
            design = adsk.fusion.Design.cast(ds)
            if design:
                root = design.rootComponent
                bb = None
                bodies = list(root.bRepBodies)
                for occ in root.allOccurrences:
                    try:
                        bodies.extend(list(occ.component.bRepBodies))
                    except Exception:
                        pass
                for b in bodies:
                    try:
                        box = b.boundingBox
                        if bb is None:
                            bb = adsk.core.BoundingBox3D.create(box.minPoint, box.maxPoint)
                        else:
                            bb.combine(box)
                    except Exception:
                        pass
                if bb:
                    model_dims = {
                        'x': round((bb.maxPoint.x - bb.minPoint.x) * 10.0, 2),
                        'y': round((bb.maxPoint.y - bb.minPoint.y) * 10.0, 2),
                        'z': round((bb.maxPoint.z - bb.minPoint.z) * 10.0, 2),
                    }
        except Exception:
            model_dims = None

        _send_to_studio_html('init_result', {
            'ok': True,
            'components': components,
            'setups': setups,
            'modelDims': model_dims,
        })
    except Exception:
        _log_error("_do_studio_init\n" + traceback.format_exc())
        _send_to_studio_html('init_result', {'ok': False, 'components': [], 'setups': []})


def _do_import_setup(data):
    """Extract a reusable CAM profile from a named setup in the active document."""
    setup_name = (data or {}).get('setup_name', '')
    try:
        app = adsk.core.Application.get()
        doc = app.activeDocument
        cam = None
        for i in range(doc.products.count):
            p = doc.products.item(i)
            if p.objectType == 'adsk::cam::CAM':
                cam = adsk.cam.CAM.cast(p)
                break
        if not cam:
            _send_to_studio_html('import_result', {'ok': False, 'msg': 'No CAM product found.'})
            return

        setup = None
        for i in range(cam.setups.count):
            s = cam.setups.item(i)
            if s.name == setup_name:
                setup = s
                break
        if not setup:
            _send_to_studio_html('import_result',
                                 {'ok': False, 'msg': f'Setup "{setup_name}" not found.'})
            return

        profile = _extract_profile_from_setup(setup)
        _send_to_studio_html('import_result', {
            'ok': True, 'profile': profile, 'setup': setup_name,
        })
    except Exception:
        _log_error("_do_import_setup\n" + traceback.format_exc())
        _send_to_studio_html('import_result', {'ok': False, 'msg': 'Import raised — see log.'})


def _extract_profile_from_setup(setup):
    """Pull stock mode, WCS, clearance/retract heights and all operation params
    from an existing Fusion CAM setup. Returns a profile dict ready to store."""
    import re

    sp = setup.parameters

    def pget(name):
        try:   return sp.itemByName(name)
        except: return None

    def pnum(name):
        """Numeric part of expression (preserves user units), fallback cm→mm."""
        p = pget(name)
        if p is None: return None
        try:
            m = re.search(r'([+-]?\d+\.?\d*)', p.expression)
            if m: return float(m.group(1))
        except Exception: pass
        try:   return round(p.value.value * 10, 4)
        except: return None

    def pchoice(name):
        p = pget(name)
        if p is None: return None
        try:   return p.value.value
        except: return None

    def pbool(name):
        p = pget(name)
        if p is None: return False
        try:   return p.expression.lower() in ('true', '1')
        except:
            try:   return bool(p.value.value)
            except: return False

    # ── Stock mode ──────────────────────────────────────────────────────────
    STOCK_MAP = {
        'relativebox': 'auto_bbox', 'relative': 'auto_bbox', 'auto': 'auto_bbox',
        'fixedbox': 'fixed_size',   'fixed': 'fixed_size',
        'fromsolid': 'from_solid',
        'previoussetup': 'from_prev_setup',
    }
    raw = (pchoice('job_stockMode') or 'auto_bbox').lower().replace('_', '').replace(' ', '')
    stock_mode = STOCK_MAP.get(raw, 'auto_bbox')

    # ── Box point ────────────────────────────────────────────────────────────
    BOX_MAP = {
        'top 1': 1, 'top1': 1, 'top_1': 1,
        'top 2': 2, 'top2': 2, 'top_2': 2,
        'top 3': 3, 'top3': 3,
        'center 1': 4, 'center1': 4, 'middle 1': 4,
        'center 2': 5, 'center2': 5, 'middle 2': 5,
        'center 3': 6, 'center3': 6,
        'bottom 1': 7, 'bottom1': 7,
        'bottom 2': 8, 'bottom2': 8,
        'bottom 3': 9, 'bottom3': 9,
    }
    box_raw = (pchoice('wcs_origin_boxPoint') or 'top 1').lower()
    box_pt = BOX_MAP.get(box_raw, 2)

    flip_y = pbool('wcs_orientation_flipY')

    # ── Clearance / retract heights ──────────────────────────────────────────
    # Try setup params first; fall through to first operation's params.
    clearance_h = None
    retract_h   = None
    for name in ('clearanceHeight_offset', 'job_clearanceHeight'):
        v = pnum(name)
        if v is not None: clearance_h = round(v, 3); break
    for name in ('retractHeight_offset', 'job_retractHeight'):
        v = pnum(name)
        if v is not None: retract_h = round(v, 3); break

    if (clearance_h is None or retract_h is None) and setup.operations.count > 0:
        op0p = setup.operations.item(0).parameters
        def op0num(name):
            try:
                p = op0p.itemByName(name)
                if p is None: return None
                m = re.search(r'([+-]?\d+\.?\d*)', p.expression)
                if m: return float(m.group(1))
            except Exception: pass
            return None
        if clearance_h is None:
            for n in ('clearanceHeight_offset', 'clearanceHeight'):
                v = op0num(n)
                if v is not None: clearance_h = round(v, 3); break
        if retract_h is None:
            for n in ('retractHeight_offset', 'retractHeight'):
                v = op0num(n)
                if v is not None: retract_h = round(v, 3); break

    if clearance_h is None: clearance_h = 5.0
    if retract_h   is None: retract_h   = 4.0

    # ── Operations ───────────────────────────────────────────────────────────
    STRATEGY_MAP = {
        'pocket_new':    'pocket_clearing',
        'pocket_clearing': 'pocket_clearing',
        'morphed_spiral':  'morphed_spiral',
        'adaptive':        'adaptive',
        '2d_contour':      'contour',
        'contour':         'contour',
    }
    operations = []
    for oi in range(setup.operations.count):
        op   = setup.operations.item(oi)
        opar = op.parameters

        def oget(name):
            try:   return opar.itemByName(name)
            except: return None

        def onum(name):
            p = oget(name)
            if p is None: return None
            try:
                m = re.search(r'([+-]?\d+\.?\d*)', p.expression)
                if m: return float(m.group(1))
            except Exception: pass
            try:   return round(p.value.value * 10, 4)
            except: return None

        def ochoice(name):
            p = oget(name)
            if p is None: return None
            try:   return p.value.value
            except: return None

        raw_s    = (ochoice('strategy') or '').lower()
        strategy = STRATEGY_MAP.get(raw_s, raw_s or 'pocket_clearing')
        tool_desc = ochoice('tool_description') or ochoice('tool_comment') or ''

        feed  = onum('tool_feedCutting')
        rpm   = onum('tool_spindleSpeed')
        step  = onum('tool_passDepth')
        leave = onum('stockToLeave')
        ramp  = ochoice('tool_rampType') or 'helix'

        stepover_pct = None
        p_rad = oget('tool_radialWidth')
        if p_rad:
            try:
                v = p_rad.value.value
                stepover_pct = round(v * 100 if v <= 1.0 else v, 1)
            except Exception:
                pass

        op_data = {'type': strategy, 'tool': tool_desc}
        if feed         is not None: op_data['feedrate']     = round(feed, 2)
        if rpm          is not None: op_data['spindleSpeed'] = round(rpm)
        if step         is not None: op_data['stepdown']     = round(step, 4)
        if stepover_pct is not None: op_data['stepover']     = stepover_pct
        if leave        is not None: op_data['stockLeave']   = round(leave, 4)
        op_data['rampType'] = ramp
        operations.append(op_data)

    # 'sides' is the indexed-machining list — N orientations per MM. An
    # import always reflects ONE existing Setup, so we emit a single
    # Side A @ 0°Z. The user can add more sides in the palette after
    # import if they want to extend it into an indexed workflow.
    return {
        'stockMode':       stock_mode,
        'clearanceHeight': clearance_h,
        'retractHeight':   retract_h,
        'boxPoint':        box_pt,
        'flipY':           flip_y,
        'sides':           [{'name': 'A', 'axis': 'Z', 'angleDeg': 0}],
        'operations':      operations,
    }


def _do_studio_generate(data=None):
    """Generic CAM Studio generate: one MM + Setup per selected component,
    applying the profile settings from the palette."""
    data            = data or {}
    component_names = data.get('components', [])
    profile         = data.get('profile', {})

    # Begin a clean log session for THIS generate, so the build and the
    # async toolpath generation that follows both land in one readable
    # session. (The deferred TPGEN handler used to truncate on entry, which
    # wiped the build's own MM/Setup/machine/rotation log lines before they
    # could be read.)
    try:
        for _lp in getattr(_logger, 'log_paths', []) or []:
            try:
                with open(_lp, 'w', encoding='utf-8') as _f:
                    _f.write('')
            except Exception:
                pass
    except Exception:
        pass
    _log("================ CAM STUDIO GENERATE ================")
    try:
        _sides = profile.get('sides') or []
        _summary = [(s.get('name'), s.get('axis'), s.get('angleDeg')) for s in _sides]
        _log(f"GENERATE: components={component_names} "
             f"assignMachine={profile.get('assignMachine')} "
             f"boxPoint={profile.get('boxPoint')} sides={_summary}")
    except Exception:
        pass

    try:
        _load_engine()
    except Exception:
        _log_error("Studio engine load failed\n" + traceback.format_exc())
        _send_to_studio_html('report', {
            'ok': False, 'mode': 'generic',
            'errors': ['Engine load failed — see log.']
        })
        return

    try:
        _log("CKPT STUDIO 1: about to call _engine.run(mode=generic)")
        report = _engine.run(
            classifier=_classify_body,
            logger=_logger,
            mode='generic',
            component_names=component_names,
            profile=profile,
        )
        _log(f"CKPT STUDIO 2: _engine.run returned (report.ok={report.get('ok')})")
    except Exception:
        _log_error("Studio engine.run failed\n" + traceback.format_exc())
        _send_to_studio_html('report', {
            'ok': False, 'mode': 'generic',
            'errors': ['Engine.run raised — see log.']
        })
        return

    # Kick off toolpath generation for every operation the engine just
    # stamped out. Same helper as B-spline mode; runs async in the
    # CAM workspace, so we don't block the palette response.
    if report.get('ok'):
        _log("CKPT STUDIO 3: calling _kick_off_toolpath_generation")
        _kick_off_toolpath_generation(report)
        _log("CKPT STUDIO 4: _kick_off_toolpath_generation returned")

    _log("CKPT STUDIO 5: sending report to HTML")
    _send_to_studio_html('report', report)
    _log("CKPT STUDIO 6: report sent")

    if report.get('ok'):
        try:
            ui      = adsk.core.Application.get().userInterface
            palette = ui.palettes.itemById(STUDIO_PALETTE_ID)
            if palette:
                palette.isVisible = False
        except Exception:
            pass


def _kick_off_toolpath_generation(report):
    """Fire ``cam.generateAllToolpaths(skipValid=True)`` so every operation
    the engine just stamped (template-applied ones land empty / invalid)
    gets a toolpath produced.

    ``skipValid=True`` is intentional: it tells Fusion to skip operations
    that are ALREADY up-to-date and only regenerate the invalid ones —
    which is exactly the new ones the template machinery just dropped in,
    plus any existing operations that have gone stale since their last
    edit. Operations the user is happy with don't get rebuilt.

    The call returns a ``GenerateToolpathFuture`` (async). We don't poll
    or block on it — Fusion shows its own progress dialog in the
    Manufacture workspace, so the user sees what's happening without the
    palette needing to babysit. Errors are logged but never raised:
    the setup-build report already succeeded; if toolpath generation
    later trips on, say, an unset tool, the user fixes that in the CAM
    workspace, not by us tearing down the setups."""
    try:
        _log("CKPT TPGEN A: firing deferred TPGen event (runs in main loop, not HTML handler context)")
        app = adsk.core.Application.get()
        if not app:
            _log("toolpath generation skipped — no app", "WARNING")
            return
        app.fireCustomEvent(TPGEN_EVENT_ID, '{}')
        _log("CKPT TPGEN A: event fired; handler will run on next Fusion tick")
    except Exception:
        _log_error("fire deferred TPGen failed\n" + traceback.format_exc())


def _send_to_html(action, payload):
    try:
        ui = adsk.core.Application.get().userInterface
        palette = ui.palettes.itemById(PALETTE_ID)
        if palette:
            palette.sendInfoToHTML(action, json.dumps(payload))
    except Exception:
        _log_error("send_to_html\n" + traceback.format_exc())


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def _do_preview():
    """Read-only dry run: classify every body and stream the result back."""
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    if not design:
        _send_to_html('preview', {
            'ok': False,
            'msg': 'No active Design product.'
        })
        return

    counts = {'frame': 0, 'panel': 0, 'unknown': 0}
    samples = {'frame': [], 'panel': [], 'unknown': []}
    for body in _enumerate_bodies(design):
        kind = _classify_body(body)
        counts[kind] = counts.get(kind, 0) + 1
        if len(samples[kind]) < 5:
            try:
                samples[kind].append(body.name or '<unnamed>')
            except Exception:
                samples[kind].append('<unnamed>')

    _log(f"PREVIEW: counts={counts}")
    _send_to_html('preview', {
        'ok': True,
        'counts': counts,
        'samples': samples,
    })


def _do_generate():
    """B-spline CAM: build the 3 MMs + 4 Setups for the active design.

    Always runs in 'bspline' mode (hardcoded pipeline). The CAM Studio
    palette handles generic mode through _do_studio_generate().

    Engine is reloaded on every generate so iterative edits to
    cam_engine.* pick up without an addin Stop/Start.
    """
    try:
        _load_engine()
    except Exception:
        _log_error("B-spline engine load failed\n" + traceback.format_exc())
        _send_to_html('report', {
            'ok': False, 'mode': 'bspline',
            'errors': ['Engine load failed — see log.'],
        })
        return

    # Phase: build only — no templates, no machine, no toolpath gen.
    # User attaches machine via ADD MACHINE button, picks origin via
    # SELECT ORIGIN, then runs APPLY TOOLPATHS to finish.
    try:
        _log("CKPT DOGEN 1: about to call _engine.run(mode=bspline, skip_templates=True, skip_machine=True)")
        report = _engine.run(
            classifier=_classify_body,
            logger=_logger,
            mode='bspline',
            skip_templates=True,
            skip_machine=True,
        )
        _log(f"CKPT DOGEN 2: _engine.run returned (report.ok={report.get('ok')})")
    except Exception:
        _log_error("B-spline engine.run failed\n" + traceback.format_exc())
        _send_to_html('report', {
            'ok': False, 'mode': 'bspline',
            'errors': ['Engine.run raised — see log.'],
        })
        return

    # NO toolpath generation here — that's now the APPLY TOOLPATHS button.
    # User pauses between BUILD and APPLY TOOLPATHS to click Origin in
    # the Part Position panel of one setup (the only manual step).

    # Friendly completion message for the palette status bar.
    n_mms = sum(1 for v in report.get('mms', {}).values() if v)
    n_setups = sum(1 for s in report.get('setups', []) if s.get('ok'))
    report['msg'] = f"BUILD complete — {n_mms} MM(s), {n_setups} setup(s) created."
    _log("CKPT DOGEN 5: sending build-phase report to HTML")
    _send_to_html('report', report)
    _log("CKPT DOGEN 6: report sent")

    # Don't auto-hide the palette — user still needs to click Origin
    # in Part Position, then click APPLY TOOLPATHS to finish.


def _do_add_machine():
    """Assign the default machine (Ultimate Bee 3 axis) to every Setup.

    Triggered by the ADD MACHINE button in the palette. Separated from
    BUILD so the user can build setups without a machine, then attach
    one explicitly when ready (or skip it for non-machine projects).
    """
    try:
        app = adsk.core.Application.get()
        doc = app.activeDocument
        if not doc:
            _send_to_html('report', {'ok': False, 'msg': 'No active document.'})
            return
        cam = doc.products.itemByProductType('CAMProductType')
        if not cam:
            _send_to_html('report', {'ok': False, 'msg': 'No CAM product — open Manufacture workspace.'})
            return
        if cam.setups.count == 0:
            _send_to_html('report', {'ok': False, 'msg': 'No setups — click BUILD SETUPS first.'})
            return

        from cam_engine import setup_builder as _sb
        _log(f"ADD MACHINE: assigning to {cam.setups.count} setups")
        n_ok = 0
        n_fail = 0
        for i in range(cam.setups.count):
            s = cam.setups.item(i)
            ok = _sb._assign_default_machine(s, s.name, _logger)
            if ok:
                n_ok += 1
            else:
                n_fail += 1
        _log(f"ADD MACHINE: done ok={n_ok} fail={n_fail} of {cam.setups.count}")
        _send_to_html('report', {
            'ok': n_ok > 0,
            'msg': f'Machine attached to {n_ok}/{cam.setups.count} setups.',
        })
    except Exception:
        _log_error("_do_add_machine\n" + traceback.format_exc())
        _send_to_html('report', {'ok': False, 'msg': 'Add machine raised — see log.'})


def _do_sync_table_attach():
    """Sync Table Attach Point from one setup to all others.
    
    Triggered by SYNC TABLE ATTACH in the palette after the user has manually
    configured the Table Attach Point on one Setup in Fusion's native UI.
    """
    try:
        app = adsk.core.Application.get()
        doc = app.activeDocument
        if not doc:
            _send_to_html('report', {'ok': False, 'msg': 'No active document.'})
            return
        cam = doc.products.itemByProductType('CAMProductType')
        if not cam:
            _send_to_html('report', {'ok': False, 'msg': 'No CAM product — open Manufacture workspace.'})
            return
        if cam.setups.count == 0:
            _send_to_html('report', {'ok': False, 'msg': 'No setups — click BUILD SETUPS first.'})
            return

        from cam_engine import setup_builder as _sb
        
        live_setups = []
        for i in range(cam.setups.count):
            live_setups.append(cam.setups.item(i))
            
        n_bound, src = _sb._propagate_part_position_pass(live_setups, _logger)
        
        if src:
            msg = f"Synced Table Attach from '{src}' to {n_bound} other setup(s)."
            _send_to_html('report', {'ok': True, 'msg': msg})
        else:
            msg = "No Table Attach Point found. Edit a Setup in Fusion and set one first."
            _send_to_html('report', {'ok': False, 'msg': msg})
    except Exception:
        _log_error("_do_sync_table_attach\n" + traceback.format_exc())
        _send_to_html('report', {'ok': False, 'msg': 'Sync table attach raised — see log.'})


def _do_apply_toolpaths():
    """Phase 2 of the split flow: apply templates + run toolpath gen.

    Triggered by the APPLY TOOLPATHS button. Assumes BUILD ran first
    and the user has clicked Origin in Part Position → Table Attach
    Point on one setup. This function:
      1. Applies cloud templates to all existing setups (per SETUP_SPECS)
      2. Fires the deferred TPGen event which:
         - Captures/replays the Table Attach Point token
         - Forces all tool numbers to 1
         - Runs cam.generateAllToolpaths(False)
    """
    try:
        _load_engine()
    except Exception:
        _log_error("B-spline engine load failed\n" + traceback.format_exc())
        _send_to_html('report', {'ok': False, 'msg': 'Engine load failed — see log.'})
        return

    app = adsk.core.Application.get()
    doc = app.activeDocument
    if not doc:
        _log("APPLY TOOLPATHS: no active doc", "WARNING")
        _send_to_html('report', {'ok': False, 'msg': 'No active document.'})
        return

    cam = doc.products.itemByProductType('CAMProductType')
    if not cam:
        _log("APPLY TOOLPATHS: no CAM product", "WARNING")
        _send_to_html('report', {'ok': False, 'msg': 'No CAM product.'})
        return

    if cam.setups.count == 0:
        _log("APPLY TOOLPATHS: no setups (click BUILD first)", "WARNING")
        _send_to_html('report', {
            'ok': False,
            'msg': 'No setups in this document — click BUILD first.',
        })
        return

    try:
        from cam_engine import setup_builder as _sb
        _log("APPLY TOOLPATHS: applying templates to existing setups")
        n = _sb.apply_templates_to_existing_setups(cam, logger=_logger)
        _log(f"APPLY TOOLPATHS: templates applied to {n} setup(s)")
    except Exception:
        _log_error("APPLY TOOLPATHS: template apply raised\n" + traceback.format_exc())
        _send_to_html('report', {'ok': False, 'msg': 'Template apply raised — see log.'})
        return

    # Kick off deferred toolpath generation (also handles Table Attach
    # token capture/replay + tool renumber via the existing handler).
    _log("APPLY TOOLPATHS: kicking off deferred toolpath generation")
    fake_report = {
        'ok': True,
        'mode': 'bspline',
        'setups': [{'name': cam.setups.item(i).name, 'ok': True}
                   for i in range(cam.setups.count)],
    }
    _kick_off_toolpath_generation(fake_report)

    _send_to_html('report', {
        'ok': True,
        'msg': f'Templates applied to {n} setup(s). Toolpath generation in progress.',
    })


# ---------------------------------------------------------------------------
# Refresh CustomEvent (hot-reload)
# ---------------------------------------------------------------------------

class _DeferredRefreshHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            stop(None)
            run(None)
        except Exception:
            _log_error("deferred refresh\n" + traceback.format_exc())


class _DeferredTPGenHandler(adsk.core.CustomEventHandler):
    """Run toolpath generation in Fusion's main event loop context.

    Calling cam.generateToolpath() from inside an HTML palette event handler
    crashes Fusion. Firing a CustomEvent first lets the HTML handler return
    cleanly; this notify() then runs in the same context as right-click ->
    Generate (which works), so per-op generation succeeds.

    Each future is awaited before the next op starts. Rest-machining ops
    depend on the previous op's toolpath being computed first; firing them
    all async in parallel gives the rest-machining ops nothing to subtract
    from and produces wrong / empty toolpaths. Sequential await fixes that.
    """
    def notify(self, args):
        import time, os as _os
        try:
            # NOTE: do NOT truncate the log here. This handler runs async
            # immediately after the Studio/bspline build, so truncating wiped
            # the build's own MM/Setup/machine/rotation log lines before they
            # could be read. The GENERATE entry point now owns the log-session
            # reset, so the build and this toolpath pass share one session.
            _log("DEFERRED TPGEN: handler notify() entered")
            app = adsk.core.Application.get()
            cam = app.activeDocument.products.itemByProductType('CAMProductType')
            if not cam:
                _log("DEFERRED TPGEN: no CAM product", "WARNING")
                return

            # WARMUP: Fusion's CAM calculator needs to be "awake" before the
            # first generateToolpath call. After fresh MM/Setup creation it
            # appears to be in a partial state — the first call crashes the
            # calculator subsystem. Workarounds that mimic what right-click
            # does:
            #   1. Switch to Manufacture workspace (matches what user does
            #      before right-clicking an op)
            #   2. Pump the event loop for a beat so any pending background
            #      work from the just-finished MM/Setup build can settle.
            try:
                ui = app.userInterface
                for k in range(ui.workspaces.count):
                    ws = ui.workspaces.item(k)
                    if ws.id == 'CAMEnvironment':
                        if ui.activeWorkspace.id != 'CAMEnvironment':
                            ws.activate()
                            _log("DEFERRED TPGEN: switched to Manufacture workspace for warmup")
                        break
            except Exception as e:
                _log(f"DEFERRED TPGEN: workspace switch failed (non-fatal): {e}", "WARNING")

            _log("DEFERRED TPGEN: warmup wait (settling CAM engine state)")
            t_warmup_end = time.time() + 1.5
            while time.time() < t_warmup_end:
                adsk.doEvents()
                time.sleep(0.05)
            _log("DEFERRED TPGEN: warmup done, starting generation loop")

            # POSITION DIAGNOSTICS — heavy logging of every relevant
            # coordinate so we can correlate .mch table_0 values with
            # where the workpiece actually lands. Runs unconditionally
            # (cheap; just reads + logs).
            try:
                from cam_engine import setup_builder as _sb
                _sb.log_position_diagnostics(cam, logger=_logger)
            except Exception as _e:
                _log(f"DEFERRED TPGEN: pos diag raised: {type(_e).__name__}: {_e}", "WARNING")

            # PART POSITION is now handled inline by setup_builder.py
            # via the Ultimate Bee Fence fixture + wcs_origin_point
            # binding (see CAM_BUILDER_CONTEXT.md "Fence-anchored WCS").
            # No deferred Table-Attach-Point binding pass is needed
            # here — every Setup already has its WCS anchored to the
            # fence corner before this handler runs.

            # Runtime overrides removed — templates now ship with correct
            # tool_number=1 and useRestMachining=false baked in. The
            # force_first_op_rest_machining_off helper has been deleted;
            # force_all_tool_numbers_to_one is kept in setup_builder.py
            # as a safety hook but no longer wired in. The op-level
            # tool_number override silently reverts via the API, so the
            # renumber helper was only useful for tool.tool_number — both
            # are now correct in the templates themselves.

            # PER-SETUP SEQUENTIAL GENERATION:
            # cam.generateToolpath(setup) lets Fusion manage IPV / stock-state
            # propagation between ops within the setup internally. The previous
            # per-op cam.generateToolpath(op) loop left rest-machining and
            # Morphed Spiral ops with stale IPV input and they fast-failed in
            # ~0.4s with hasToolpath=False. Empirically verified: per-setup
            # generation makes both B-spline Morphed Spirals succeed with
            # boundaryOffset at its template default (0). Each setup's future
            # is awaited fully before the next setup starts so cross-setup
            # IPV (B-spline Top inherits from B-spline Back) is correct.
            t_start = time.time()
            n_setups_total = cam.setups.count
            n_ops_total = sum(cam.setups.item(i).operations.count
                              for i in range(n_setups_total))

            # Diagnostic helper — dumps op state + key params in one line per
            # op. Called PRE-GEN (before cam.generateToolpath(setup)) and
            # POST-GEN (after the future completes). Compare PRE vs POST to
            # see what Fusion did to the op during gen. Compare working ops
            # vs failing ops (same setup or across setups) to find the
            # differentiating param. Failing-fast Morphed Spirals tend to
            # show identical PRE and POST except for hasToolpath staying
            # False.
            def _diag_op(op, phase):
                # Param names worth comparing for boundary / silhouette /
                # stock / surface failures. Each access is guarded — an op
                # type that lacks the param just gets skipped.
                keys = (
                    'boundaryMode', 'boundaryOffset', 'machiningBoundaryOffset',
                    'boundaryContainment', 'boundaryConfineTool',
                    'useSilhouetteAsMachiningBoundary', 'silhouetteAperture',
                    'minimumSilhouetteArea', 'machiningBoundarySel',
                    'useRestMachining', 'restMaterialSource',
                    'restMaterialFromJob', 'restMaterialPrevious',
                    'includeSetupModel', 'overrideModel', 'useCheckSurface',
                    'stockToLeave', 'verticalStockToLeave', 'useStockToLeave',
                    'tool_diameter', 'tolerance',
                    'surfaceXLow', 'surfaceXHigh',
                    'surfaceYLow', 'surfaceYHigh',
                    'surfaceZLow', 'surfaceZHigh',
                    'stockXLow', 'stockXHigh',
                    'stockYLow', 'stockYHigh',
                    'stockZLow', 'stockZHigh',
                )
                try:
                    head = (f"strategy={op.strategy} "
                            f"state={op.operationState} "
                            f"hasTP={op.hasToolpath}")
                except Exception as e:
                    head = f"<head read err: {e}>"
                parts = [head]
                for k in keys:
                    try:
                        p = op.parameters.itemByName(k)
                        if p is None:
                            continue
                        try:
                            raw = p.value
                            v = raw.value if hasattr(raw, 'value') else raw
                            # collapse opaque vector/proxy reprs
                            vs = str(v)
                            if len(vs) > 60 or 'Swig' in vs or 'BaseVector' in vs:
                                # try to summarize collection-like values
                                try:
                                    n = int(v.count) if hasattr(v, 'count') else None
                                    vs = f"<vec n={n}>" if n is not None else "<obj>"
                                except Exception:
                                    vs = "<obj>"
                        except Exception as ve:
                            vs = f"<val err:{ve}>"
                        try:
                            expr = p.expression
                        except Exception:
                            expr = "?"
                        parts.append(f"{k}={vs}|{expr!r}")
                    except Exception:
                        pass
                _log(f"OP DIAG [{phase}] '{op.name}': " + " || ".join(parts), "DEBUG")

            def _diag_future(f, setup_name):
                # Probe whatever properties the future exposes — we don't
                # know all the API surface, so dump everything non-callable.
                try:
                    for fattr in dir(f):
                        if fattr.startswith('_') or fattr in ('thisown',):
                            continue
                        try:
                            fv = getattr(f, fattr)
                            if callable(fv):
                                continue
                            _log(f"FUTURE DIAG '{setup_name}' future.{fattr} = {fv}", "DEBUG")
                        except Exception:
                            pass
                except Exception:
                    pass

            # COLLECTION-OF-OPERATIONS SINGLE-CALL GENERATION:
            # Per Autodesk's CAM API docs, cam.generateToolpath() accepts
            # an ObjectCollection of Operations and returns ONE future for
            # the whole batch. Fusion's batch scheduler then handles BOTH
            # dependency chains in one shot:
            #   - intra-setup IPV (rest machining within a setup)
            #   - inter-setup stock-from-preceding-setup propagation
            # Ordering of the collection is the natural template-applied
            # order (Pocket -> Morphed Spiral within each setup; setups
            # in cam.setups order). This is what the per-op and per-setup
            # loops couldn't deliver: Fusion never saw the full dependency
            # graph in one call, so IPV state didn't propagate.
            t_start = time.time()
            op_collection = adsk.core.ObjectCollection.create()
            ordered_op_log = []
            for i in range(cam.setups.count):
                setup = cam.setups.item(i)
                for j in range(setup.operations.count):
                    op = setup.operations.item(j)
                    op_collection.add(op)
                    ordered_op_log.append(f"{setup.name}/{op.name}")
            n_ops_total = op_collection.count
            _log(f"DEFERRED TPGEN: starting COLLECTION gen of {n_ops_total} ops in template order:")
            for entry in ordered_op_log:
                _log(f"DEFERRED TPGEN:   - {entry}")

            # PRE-GEN: dump every op's state + params right before the
            # single generateToolpath call. Compare PRE vs POST per op
            # to see what Fusion did.
            for i in range(cam.setups.count):
                for j in range(cam.setups.item(i).operations.count):
                    _diag_op(cam.setups.item(i).operations.item(j), 'PRE-GEN')

            try:
                f = cam.generateToolpath(op_collection)
            except Exception as e:
                _log(f"DEFERRED TPGEN: collection generateToolpath raised: "
                     f"{type(e).__name__}: {e}", "WARNING")
                _log_error(traceback.format_exc())
                f = None

            if f is not None:
                bulk_timeout = 1800.0
                last_progress_log = 0
                last_watch_log = 0

                # --- WATCH helpers (per-op state + transition tracking) ---
                # Per-op state tuple: (hasToolpath, isToolpathValid,
                # operationState, hasError, hasWarning). Compact tag
                # encodes the first three for inline log readability:
                #   V = hasTP & isToolpathValid  (green check)
                #   S = hasTP & !isToolpathValid (out-of-date)
                #   N = no toolpath
                def _op_state(oo):
                    try:
                        return (
                            bool(oo.hasToolpath),
                            bool(oo.isToolpathValid),
                            int(oo.operationState),
                            bool(oo.hasError),
                            bool(oo.hasWarning),
                        )
                    except Exception:
                        return None

                def _op_tag(st):
                    if st is None: return '?'
                    hasTP, valid, _, _, _ = st
                    if not hasTP: return 'N'
                    return 'V' if valid else 'S'

                def _op_label(oo, st):
                    if st is None:
                        return f"{oo.name}=?"
                    _, _, opstate, herr, hwarn = st
                    extras = ''
                    if herr: extras += 'E'
                    if hwarn: extras += 'W'
                    return f"{oo.name}={_op_tag(st)}/{opstate}{('!'+extras) if extras else ''}"

                # Setup-level stock-state snapshot — capture per-setup
                # stock so we can correlate IPV-consumption events with
                # Pocket back's invalidation.
                def _setup_state(ss):
                    try:
                        sm = ss.stockMode if hasattr(ss, 'stockMode') else None
                        sm_s = str(sm) if sm is not None else 'n/a'
                    except Exception:
                        sm_s = 'err'
                    try:
                        stock_obj = ss.stock if hasattr(ss, 'stock') else None
                        stock_s = type(stock_obj).__name__ if stock_obj else 'None'
                    except Exception:
                        stock_s = 'err'
                    return f"{ss.name}[stockMode={sm_s} stock={stock_s}]"

                # Track previous per-op state so we log only TRANSITIONS
                # (not the full snapshot every poll — too noisy).
                prev_states = {}  # op_id -> state tuple
                op_keys = []      # (setup_name, op, op_id) preserves order

                def _collect_ops():
                    op_keys.clear()
                    for ii in range(cam.setups.count):
                        ss = cam.setups.item(ii)
                        for jj in range(ss.operations.count):
                            oo = ss.operations.item(jj)
                            op_keys.append((ss.name, oo, f"{ss.name}/{oo.name}"))
                _collect_ops()

                def _full_snapshot(elapsed, label='WATCH'):
                    parts = [_op_label(oo, _op_state(oo))
                             for _, oo, _ in op_keys]
                    _log(f"{label} t={elapsed:.1f}s | " + " ".join(parts), "DEBUG")
                    # Also log setup-level state for IPV correlation
                    setup_parts = [_setup_state(cam.setups.item(ii))
                                   for ii in range(cam.setups.count)]
                    _log(f"{label} t={elapsed:.1f}s SETUPS | "
                         + " ".join(setup_parts), "DEBUG")

                def _scan_transitions(elapsed):
                    for setup_name, oo, op_id in op_keys:
                        cur = _op_state(oo)
                        prev = prev_states.get(op_id)
                        if cur != prev:
                            _log(f"TRANSITION t={elapsed:.1f}s "
                                 f"'{op_id}' {_op_tag(prev)}/{prev[2] if prev else '?'} "
                                 f"-> {_op_tag(cur)}/{cur[2] if cur else '?'}"
                                 + (f" (err={cur[3]} warn={cur[4]})"
                                    if cur and (cur[3] or cur[4]) else ''),
                                 "DEBUG")
                            prev_states[op_id] = cur

                # --- ironjob file dump (Fusion writes per-op job specs
                # to %TEMP%\Fusion360CAM\<pid>\operation*.ironjob). The
                # contents include the input model/stock hashes and op
                # parameters as Fusion saw them at gen time. Differences
                # between Pocket back's ironjob and a working op's
                # ironjob may reveal the trigger.
                import os as _os
                import glob as _glob
                def _ironjob_dir():
                    base = _os.path.join(_os.environ.get('LOCALAPPDATA', ''),
                                         'Temp', 'Fusion360CAM')
                    if not _os.path.isdir(base):
                        base = _os.path.join(_os.environ.get('TEMP', ''),
                                             'Fusion360CAM')
                    if _os.path.isdir(base):
                        # Find the most recently modified subdir
                        subs = [_os.path.join(base, d) for d in _os.listdir(base)
                                if _os.path.isdir(_os.path.join(base, d))]
                        if subs:
                            return max(subs, key=_os.path.getmtime)
                    return None

                def _dump_ironjobs(label):
                    d = _ironjob_dir()
                    if not d:
                        _log(f"{label}: no Fusion360CAM temp dir found", "DEBUG")
                        return
                    files = sorted(_glob.glob(_os.path.join(d, 'operation*.ironjob')),
                                   key=_os.path.getmtime)
                    _log(f"{label}: {len(files)} ironjob file(s) in {d}", "DEBUG")
                    for fp in files[-10:]:  # last 10 by mtime
                        try:
                            sz = _os.path.getsize(fp)
                            mt = _os.path.getmtime(fp)
                            _log(f"{label}:   {_os.path.basename(fp)} size={sz} mtime={mt:.1f}",
                                 "DEBUG")
                        except Exception as e:
                            _log(f"{label}:   {fp} stat err: {e}", "DEBUG")

                # --- camkernel.exe process tracking ---
                import subprocess as _sub
                def _camkernels_running():
                    try:
                        r = _sub.run(
                            ['tasklist', '/FI', 'IMAGENAME eq camkernel.exe', '/FO', 'CSV', '/NH'],
                            capture_output=True, text=True, timeout=2)
                        out = (r.stdout or '').strip()
                        if not out or 'INFO:' in out:
                            return 0
                        return len([l for l in out.splitlines() if 'camkernel.exe' in l.lower()])
                    except Exception:
                        return -1

                # === PRE-batch baseline ===
                _full_snapshot(0.0, label='BASELINE')
                _dump_ironjobs('IRONJOB-PRE')
                _log(f"CAMKERNEL-PRE: {_camkernels_running()} camkernel.exe running", "DEBUG")
                # Seed prev_states with baseline so TRANSITION fires on first change
                for setup_name, oo, op_id in op_keys:
                    prev_states[op_id] = _op_state(oo)

                while not f.isGenerationCompleted:
                    adsk.doEvents()
                    time.sleep(0.2)
                    elapsed = time.time() - t_start
                    # Transition scan every poll — catches sub-second changes
                    _scan_transitions(elapsed)
                    if elapsed - last_progress_log > 5.0:
                        try:
                            done = getattr(f, 'numberOfCompleted', '?')
                            total = getattr(f, 'numberOfOperations', '?')
                            tasks_done = getattr(f, 'numberOfCompletedTasks', '?')
                            tasks_total = getattr(f, 'numberOfTasks', '?')
                            ck = _camkernels_running()
                            _log(f"DEFERRED TPGEN: collection progress "
                                 f"ops={done}/{total} tasks={tasks_done}/{tasks_total} "
                                 f"camkernel={ck} ({elapsed:.0f}s)")
                        except Exception:
                            _log(f"DEFERRED TPGEN: collection still running ({elapsed:.0f}s)")
                        last_progress_log = elapsed
                    # Full snapshot every 5s as a periodic ground truth
                    if elapsed - last_watch_log > 5.0:
                        _full_snapshot(elapsed)
                        last_watch_log = elapsed
                    if elapsed > bulk_timeout:
                        _log(f"DEFERRED TPGEN: collection timed out after "
                             f"{bulk_timeout:.0f}s", "WARNING")
                        break
                # === POST-batch final state ===
                _scan_transitions(time.time() - t_start)
                _full_snapshot(time.time() - t_start, label='FINAL')
                _dump_ironjobs('IRONJOB-POST')
                _log(f"CAMKERNEL-POST: {_camkernels_running()} camkernel.exe running", "DEBUG")
                _log(f"DEFERRED TPGEN: collection gen done in "
                     f"{time.time()-t_start:.1f}s")
                _diag_future(f, 'collection')

            # POST-GEN: dump every op's state again. Failing ops will
            # show hasTP=False / state=3; compare PRE param values to
            # see what Fusion changed during the batch run.
            for i in range(cam.setups.count):
                for j in range(cam.setups.item(i).operations.count):
                    _diag_op(cam.setups.item(i).operations.item(j), 'POST-GEN')

            # POST-GEN EXTENDED: per-op deep diagnostics for any op that
            # came back with state != 0 (Valid). These probe Fusion's
            # internal messageLog, generatedDataCollection, toolpath
            # stats, and stock-vs-surface overlap — surfaces that the
            # public hasError/hasWarning fields don't expose. Only runs
            # for non-Valid ops to keep the log focused.
            def _diag_op_extended(op, setup):
                _log(f"OP EXT [{setup.name}/{op.name}]: ===", "DEBUG")
                # 1. isToolpathValid — often diverges from hasToolpath
                try:
                    _log(f"OP EXT   isToolpathValid={op.isToolpathValid} "
                         f"hasToolpath={op.hasToolpath} "
                         f"hasError={op.hasError} hasWarning={op.hasWarning} "
                         f"state={op.operationState}", "DEBUG")
                except Exception as e:
                    _log(f"OP EXT   state read err: {e}", "DEBUG")
                # 2. error/warning string fields (often empty but check)
                try:
                    err = (op.error or '').strip()
                    warn = (op.warning or '').strip()
                    if err:
                        _log(f"OP EXT   error: {err!r}", "DEBUG")
                    if warn:
                        _log(f"OP EXT   warning: {warn!r}", "DEBUG")
                except Exception as e:
                    _log(f"OP EXT   error/warning read err: {e}", "DEBUG")
                # 3. messageLog tail — last ~2500 chars usually contains
                # the actual failure reason Fusion logs internally
                try:
                    ml = op.messageLog or ''
                    tail = ml[-2500:] if len(ml) > 2500 else ml
                    # Replace embedded \r\n / \n with explicit markers for one-line readability
                    for line in tail.split('\n'):
                        line = line.rstrip('\r')
                        if line.strip():
                            _log(f"OP EXT   msglog: {line}", "DEBUG")
                except Exception as e:
                    _log(f"OP EXT   messageLog read err: {e}", "DEBUG")
                # 4. generatedDataCollection — per-generation artifacts
                try:
                    gdc = op.generatedDataCollection
                    n = gdc.count
                    _log(f"OP EXT   generatedDataCollection.count={n}", "DEBUG")
                    for k in range(n):
                        gd = gdc.item(k)
                        # Probe what's on each gen-data entry
                        try:
                            _log(f"OP EXT   genData[{k}]: {gd!r}", "DEBUG")
                            for a in ('name', 'description', 'type', 'category',
                                      'isValid', 'severity', 'message', 'text'):
                                try:
                                    v = getattr(gd, a, None)
                                    if v is not None and not callable(v):
                                        _log(f"OP EXT     genData[{k}].{a} = {v}", "DEBUG")
                                except Exception:
                                    pass
                        except Exception as e:
                            _log(f"OP EXT   genData[{k}] err: {e}", "DEBUG")
                except Exception as e:
                    _log(f"OP EXT   generatedDataCollection err: {e}", "DEBUG")
                # 5. Toolpath stats — segments, length. Empty toolpath
                # often explains state=1 with hasToolpath=True.
                try:
                    tp = op.toolpath if hasattr(op, 'toolpath') else None
                    if tp is None:
                        _log(f"OP EXT   op.toolpath: None", "DEBUG")
                    else:
                        for a in ('numberOfMoves', 'numberOfSegments',
                                  'totalLength', 'rapidLength', 'cuttingLength',
                                  'cuttingTime', 'rapidTime', 'totalTime',
                                  'isValid', 'isGenerated'):
                            try:
                                v = getattr(tp, a, None)
                                if v is not None and not callable(v):
                                    _log(f"OP EXT   toolpath.{a} = {v}", "DEBUG")
                            except Exception:
                                pass
                except Exception as e:
                    _log(f"OP EXT   toolpath probe err: {e}", "DEBUG")
                # 6. Stock vs surface bbox overlap — empty intersection
                # produces empty toolpath without raising an error.
                try:
                    sx_lo = op.parameters.itemByName('surfaceXLow').value.value
                    sx_hi = op.parameters.itemByName('surfaceXHigh').value.value
                    sy_lo = op.parameters.itemByName('surfaceYLow').value.value
                    sy_hi = op.parameters.itemByName('surfaceYHigh').value.value
                    sz_lo = op.parameters.itemByName('surfaceZLow').value.value
                    sz_hi = op.parameters.itemByName('surfaceZHigh').value.value
                    tx_lo = op.parameters.itemByName('stockXLow').value.value
                    tx_hi = op.parameters.itemByName('stockXHigh').value.value
                    ty_lo = op.parameters.itemByName('stockYLow').value.value
                    ty_hi = op.parameters.itemByName('stockYHigh').value.value
                    tz_lo = op.parameters.itemByName('stockZLow').value.value
                    tz_hi = op.parameters.itemByName('stockZHigh').value.value
                    overlap_x = max(0, min(sx_hi, tx_hi) - max(sx_lo, tx_lo))
                    overlap_y = max(0, min(sy_hi, ty_hi) - max(sy_lo, ty_lo))
                    overlap_z = max(0, min(sz_hi, tz_hi) - max(sz_lo, tz_lo))
                    _log(f"OP EXT   surface bbox=[{sx_lo:.2f},{sx_hi:.2f}] x "
                         f"[{sy_lo:.2f},{sy_hi:.2f}] x [{sz_lo:.2f},{sz_hi:.2f}] (cm)", "DEBUG")
                    _log(f"OP EXT   stock   bbox=[{tx_lo:.2f},{tx_hi:.2f}] x "
                         f"[{ty_lo:.2f},{ty_hi:.2f}] x [{tz_lo:.2f},{tz_hi:.2f}] (cm)", "DEBUG")
                    _log(f"OP EXT   overlap (cm): X={overlap_x:.2f} Y={overlap_y:.2f} Z={overlap_z:.2f} "
                         f"=> {'NONEMPTY' if (overlap_x*overlap_y*overlap_z>0) else 'EMPTY'}", "DEBUG")
                except Exception as e:
                    _log(f"OP EXT   bbox overlap probe err: {e}", "DEBUG")
                _log(f"OP EXT [{setup.name}/{op.name}]: ===END===", "DEBUG")

            for i in range(cam.setups.count):
                s = cam.setups.item(i)
                for j in range(s.operations.count):
                    op = s.operations.item(j)
                    try:
                        if op.operationState != 0:
                            _diag_op_extended(op, s)
                    except Exception as _e:
                        _log(f"OP EXT dispatch err on '{s.name}/{op.name}': {_e}", "WARNING")

            # Post-state audit: walk every op and report which ones got
            # a toolpath vs which didn't. This tells us which (if any)
            # individual ops the bulk call rejected.
            dispatched = 0
            errors = 0
            for i in range(cam.setups.count):
                setup = cam.setups.item(i)
                for j in range(setup.operations.count):
                    op = setup.operations.item(j)
                    try:
                        if getattr(op, 'hasToolpath', False):
                            dispatched += 1
                            _log(f"DEFERRED TPGEN AUDIT: ✓ '{op.name}' in '{setup.name}' has toolpath", "DEBUG")
                        else:
                            errors += 1
                            _log(f"DEFERRED TPGEN AUDIT: ✗ '{op.name}' in '{setup.name}' MISSING toolpath", "WARNING")
                    except Exception as e:
                        _log(f"DEFERRED TPGEN AUDIT: '{op.name}' check failed: {e}", "WARNING")
            _log(f"DEFERRED TPGEN: post-audit ok={dispatched} missing={errors}")

            # Final completion notification to the palette
            try:
                _send_to_html('report', {
                    'ok': errors == 0,
                    'msg': f"TOOLPATHS complete — {dispatched} ops ok"
                           + (f", {errors} missing" if errors else ""),
                })
            except Exception:
                pass
        except Exception:
            _log_error("deferred TPGen\n" + traceback.format_exc())


def _register_refresh_event():
    """Register the deferred-refresh CustomEvent. Always unregisters any
    pre-existing event by the same id first so a previous addin lifecycle
    leaving a stale handler around doesn't double-fire. Idempotent: safe
    to call repeatedly across run/stop cycles."""
    global _refresh_event, _refresh_registered, _refresh_handlers
    try:
        app = adsk.core.Application.get()
        if not app:
            return
        try:
            app.unregisterCustomEvent(REFRESH_EVENT_ID)
        except Exception:
            pass
        _refresh_handlers = []  # let GC the old ones
        _refresh_event = app.registerCustomEvent(REFRESH_EVENT_ID)
        h = _DeferredRefreshHandler()
        _refresh_event.add(h)
        _refresh_handlers.append(h)

        # Also register the deferred toolpath-gen event. Same lifecycle as
        # the refresh event; handler runs in main loop context so per-op
        # generateToolpath() doesn't crash the way it does from HTML
        # palette event handlers.
        try:
            app.unregisterCustomEvent(TPGEN_EVENT_ID)
        except Exception:
            pass
        _tpgen_event = app.registerCustomEvent(TPGEN_EVENT_ID)
        h_tp = _DeferredTPGenHandler()
        _tpgen_event.add(h_tp)
        _refresh_handlers.append(h_tp)

        _refresh_registered = True
    except Exception:
        _refresh_registered = False
        _refresh_event = None
        _log_error("_register_refresh_event\n" + traceback.format_exc())


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

def run(context):
    """Add-in entry point. Defensive: every step is wrapped so a partial
    Fusion state (orphan command def, leftover panel control, missing
    resource folder, etc.) doesn't poison the rest of the boot. If
    something fails mid-run we call stop() to wind back down rather than
    leaving half-registered handlers and orphaned UI elements behind.
    """
    booted_ok = False
    try:
        # 1. Best-effort: clean any leftover state from a prior crash/reload.
        # stop() is idempotent and tolerant of missing pieces, so it's safe
        # to invoke even on a fresh boot.
        try:
            stop(None)
        except Exception:
            # stop() should not raise (it has its own try/excepts), but
            # if it does we still want to attempt run() — log and continue.
            _log_error("pre-run stop() raised\n" + traceback.format_exc())

        # 2. Refresh event + engine load. Engine load failure is fatal for
        # the addin (no point registering a button that won't work), so
        # we re-raise to land in the outer handler.
        _register_refresh_event()
        _load_engine()

        app = adsk.core.Application.get()
        if not app:
            _log_error("run(): Application.get() returned None")
            return
        ui = app.userInterface
        if not ui:
            _log_error("run(): no userInterface")
            return
        cmd_defs = ui.commandDefinitions

        # 3. Purge prior versions of our commands. Best-effort per id.
        for cid in (CMD_ID, STUDIO_CMD_ID):
            try:
                ex = cmd_defs.itemById(cid)
                if ex:
                    ex.deleteMe()
            except Exception:
                pass

        # 4a. Register B-spline CAM button.
        try:
            icon_dir = RESOURCES_PATH if os.path.isdir(RESOURCES_PATH) else ''
            cmd_def = cmd_defs.addButtonDefinition(
                CMD_ID, 'B-spline CAM',
                'Build the 3 Manufacturing Models + 4 Setups for the B-spline frame.',
                icon_dir,
            )
        except Exception:
            _log_error("run(): B-spline addButtonDefinition failed\n" + traceback.format_exc())
            return

        try:
            on_created = _CmdCreatedHandler()
            cmd_def.commandCreated.add(on_created)
            _handlers.append(on_created)
        except Exception:
            _log_error("run(): B-spline commandCreated.add failed\n" + traceback.format_exc())
            return

        # 4b. Register CAM Studio button.
        try:
            studio_icon_dir = STUDIO_RESOURCES_PATH if os.path.isdir(STUDIO_RESOURCES_PATH) else ''
            studio_cmd_def = cmd_defs.addButtonDefinition(
                STUDIO_CMD_ID, 'CAM Studio',
                'Generic profile-driven CAM setup — one MM + Setup per component.',
                studio_icon_dir,
            )
        except Exception:
            _log_error("run(): Studio addButtonDefinition failed\n" + traceback.format_exc())
            return

        try:
            on_studio_created = _StudioCmdCreatedHandler()
            studio_cmd_def.commandCreated.add(on_studio_created)
            _handlers.append(on_studio_created)
        except Exception:
            _log_error("run(): Studio commandCreated.add failed\n" + traceback.format_exc())
            return

        # 5. Drop both buttons into the shared bsplinePanel on every tab.
        added_any = False
        try:
            for tab in ui.allToolbarTabs:
                try:
                    for panel in tab.toolbarPanels:
                        try:
                            if not panel.id.startswith(PANEL_ID):
                                continue
                            for cid, cdef in ((CMD_ID, cmd_def), (STUDIO_CMD_ID, studio_cmd_def)):
                                ctrl = panel.controls.itemById(cid)
                                if not ctrl:
                                    ctrl = panel.controls.addCommand(cdef)
                                    added_any = True
                                    _log(f"{cid} button added to {panel.id} on tab {tab.id}")
                                try:
                                    ctrl.isPromoted = True
                                    ctrl.isPromotedByDefault = True
                                except Exception:
                                    pass
                        except Exception:
                            continue
                except Exception:
                    continue
        except Exception:
            _log_error("run(): toolbar walk failed\n" + traceback.format_exc())

        if not added_any:
            _log("run(): no bsplinePanel found yet; buttons will not appear "
                 "until the host addin registers the panel.", "WARNING")

        booted_ok = True
        _log("CAM-builder run() complete")
    except Exception:
        _log_error("run() failed\n" + traceback.format_exc())
    finally:
        if not booted_ok:
            # Partial boot — wind back down so we don't leave orphaned
            # state for the next start.
            try:
                stop(None)
            except Exception:
                _log_error("post-failure stop() raised\n" + traceback.format_exc())


def stop(context):
    """Tear down everything the addin registered. Idempotent: safe to call
    multiple times, safe to call on a partially-booted state, safe to call
    when Fusion is mid-shutdown (Application.get() may return None).
    """
    global _html_handler, _studio_html_handler, _engine, _logger
    global _refresh_event, _refresh_registered

    app = None
    ui = None
    try:
        app = adsk.core.Application.get()
    except Exception:
        app = None
    if app is not None:
        try:
            ui = app.userInterface
        except Exception:
            ui = None

    # 1. Palettes: hide + delete + drop handler references.
    if ui is not None:
        for pid in (PALETTE_ID, STUDIO_PALETTE_ID):
            try:
                palette = ui.palettes.itemById(pid)
                if palette:
                    try: palette.isVisible = False
                    except Exception: pass
                    try: palette.deleteMe()
                    except Exception: pass
            except Exception:
                pass
    _html_handler        = None
    _studio_html_handler = None

    # 2. Remove button controls from any panel they ended up in.
    if ui is not None:
        try:
            for tab in ui.allToolbarTabs:
                try:
                    for panel in tab.toolbarPanels:
                        try:
                            if not panel.id.startswith(PANEL_ID):
                                continue
                            for cid in (CMD_ID, STUDIO_CMD_ID):
                                ctrl = panel.controls.itemById(cid)
                                if ctrl:
                                    try: ctrl.deleteMe()
                                    except Exception: pass
                        except Exception:
                            continue
                except Exception:
                    continue
        except Exception:
            pass

    # 3. Remove command definitions.
    if ui is not None:
        try:
            cmd_defs = ui.commandDefinitions
            for cid in (CMD_ID, STUDIO_CMD_ID):
                try:
                    cd = cmd_defs.itemById(cid)
                    if cd:
                        cd.deleteMe()
                except Exception:
                    pass
        except Exception:
            pass

    # 4. Unregister the deferred-refresh CustomEvent and drop its handlers.
    if app is not None:
        try:
            app.unregisterCustomEvent(REFRESH_EVENT_ID)
        except Exception:
            pass
    _refresh_event = None
    _refresh_registered = False
    _refresh_handlers.clear()

    # 5. Clear per-run handlers (CommandCreated etc).
    _handlers.clear()

    # 6. Drop engine + logger references so a subsequent run() starts fresh.
    # Don't destroy the logger — it just owns a file handle and Python GC
    # will close it.
    _engine = None
    _logger = None


# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------

def _log(msg, level="INFO"):
    if _logger:
        try:
            _logger.log(msg, level)
        except Exception:
            pass


def _log_error(msg):
    _log("ERROR: " + msg, "ERROR")

