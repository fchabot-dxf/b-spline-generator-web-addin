# stamp-editor.py
# Stamp Editor — surface deformation via SVG / text / freehand motifs,
# using b-spline-gen's rasterize → SDF → modulate-control-points
# pipeline. Sibling add-in to step-editor; loaded as a sub-module of
# the unified bspline-frame-builder.py entry point.
#
# Architecture mirrors step-editor.py and b-spline-gen.py:
#   - HTML/JS owns the UI (palette under html/index.html).
#   - Python tunnels log messages, opens/closes the palette, drives
#     Fusion-side workflows the JS can't do (face picking, importing
#     STEP back into the active design).
#
# v1 SCAFFOLD: this file wires the toolbar button + palette + the
# basic log/ping/reset_ui round-trip. Face-pick capture and STEP
# emission land in subsequent passes.

import adsk.core, adsk.fusion, traceback
import os, json, shutil, datetime

handlers = []
ui  = None
app = adsk.core.Application.get()
if app:
    ui = app.userInterface

# ── Log file ──────────────────────────────────────────────────────────────────
def get_log_path():
    """Mirror of step-editor's log-path strategy: prefer the workspace
    source folder (so the log is visible in the dev tree), fall back to
    the deployed add-in folder."""
    addin_dir = os.path.dirname(os.path.realpath(__file__))
    link_file = os.path.join(addin_dir, 'workspace_link.json')
    try:
        if os.path.isfile(link_file):
            with open(link_file, 'r', encoding='utf-8') as f:
                link = json.load(f)
            workspace_root = link.get('workspace_root', '').replace('/', os.sep)
            if workspace_root and os.path.isdir(workspace_root):
                return os.path.join(workspace_root, 'stamp_editor_log.txt')
    except Exception:
        pass
    return os.path.join(addin_dir, 'stamp_editor_log.txt')


LOG_FILE = get_log_path()


# ── Log severity ──────────────────────────────────────────────────────────────
# `_log_level` gates which lines actually hit disk. Default: INFO.
# Bump to 'DEBUG' from a Python console or by tweaking the constant
# below when you need verbose tracing.
LOG_LEVELS = {'DEBUG': 10, 'INFO': 20, 'WARN': 30, 'ERROR': 40}
_log_level = 'INFO'


def _log_at(level, msg):
    """Severity-aware logger. Drops anything below `_log_level`,
    timestamps + tags everything else, rotates the file at 512 KB."""
    if LOG_LEVELS.get(level, 100) < LOG_LEVELS.get(_log_level, 20):
        return
    try:
        ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f'[{ts}] [{level:5s}] {msg}\n')
        if os.path.getsize(LOG_FILE) > 1024 * 512:
            os.replace(LOG_FILE, LOG_FILE + '.old')
    except Exception:
        pass


def _log_debug(msg): _log_at('DEBUG', msg)
def _log_info (msg): _log_at('INFO',  msg)
def _log_warn (msg): _log_at('WARN',  msg)
def _log_error(msg): _log_at('ERROR', msg)


def _log(msg):
    """Legacy alias — older code uses _log() directly. Treated as INFO."""
    _log_at('INFO', msg)


def set_log_level(level):
    """Runtime knob — call from a Python console / debugger to bump
    verbosity without redeploying:
        import stamp_editor_mod as s; s.set_log_level('DEBUG')
    """
    global _log_level
    if level in LOG_LEVELS:
        _log_level = level
        _log_at('INFO', f'log level → {level}')


# ── Palette / command constants ───────────────────────────────────────────────
PALETTE_ID      = 'stampEditorPalette'
PALETTE_NAME    = 'Stamp Editor'
PALETTE_HTML    = 'html/index.html'

COMMAND_ID      = 'stampEditorCommand'
COMMAND_NAME    = 'Stamp Editor'
COMMAND_TOOLTIP = (
    'Pick a face on any body and stamp a motif onto its surface. '
    'Supports V-bit, flat, and ballnose tool profiles.'
)

# Internal companion command — invoked from inside the palette when the
# user clicks "Pick a face…". Owns the SelectionCommandInput that lets
# the user click a face in Fusion's main canvas; on execute, captures
# the face's metadata and ships it back to the palette JS via the
# `face_picked` route.
PICK_COMMAND_ID    = 'stampEditorPickFaceCmd'
PICK_COMMAND_NAME  = 'Pick face for Stamp'
PICK_COMMAND_TIP   = 'Click a face on a body to use as the stamp target.'

# Where the toolbar button lives — same panel as STEP Editor and the
# other unified add-ins. IDs MUST match step-editor / fusion-inspector
# / template-maker (all use `bsplinePanel` + MillingTab) — otherwise
# Fusion treats this as a separate panel that just happens to share
# the display name, and we end up with two "B-Spline Builder" entries
# in the toolbar.
TARGET_TAB_IDS    = ('SolidTab', 'SketchTab', 'MillingTab')
SHARED_PANEL_ID   = 'bsplinePanel'
SHARED_PANEL_NAME = 'B-Spline Builder'

# Legacy panel id from earlier builds that created its own separate
# "B-Spline Builder" panel. Cleaned up on every run() so the user
# doesn't end up with two side-by-side panels after upgrading.
LEGACY_PANEL_PREFIX = 'BsplineFrameBuilderPanel_'


# ── Palette HTML event handler ────────────────────────────────────────────────
class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    """Routes messages from the palette JS back into Python. Same wire
    shape as step-editor's bridge: each message is { action, data }."""

    def notify(self, args):
        try:
            htmlArgs = adsk.core.HTMLEventArgs.cast(args)
            action   = htmlArgs.action
            data_str = htmlArgs.data or ''

            if action == 'log':
                try:
                    data = json.loads(data_str) if data_str else {}
                    _log(f'[JS LOG] {data.get("msg", "")}')
                except Exception as e:
                    _log(f'[JS LOG ERROR] {e}')
                return

            if action == 'ping':
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('pong', '{}')
                return

            if action == 'reset_ui':
                _log('reset_ui received')
                return

            if action == 'cancel':
                _log('cancel: hiding palette')
                _clear_cg()
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.isVisible = False
                return

            if action == 'pick_face':
                _log('pick_face: capturing current canvas selection')
                _capture_selected_faces()
                return

            if action == 'request_face_grid':
                try:
                    d = json.loads(data_str) if data_str else {}
                except Exception:
                    d = {}
                fi = int(d.get('faceIndex', 0))
                nx = int(d.get('nx', 64))
                nz = int(d.get('nz', 64))
                _log_info(f'request_face_grid: idx={fi} nx={nx} nz={nz}')
                _send_face_grid(fi, nx, nz)
                return

            if action == 'preview_mesh':
                try:
                    d = json.loads(data_str) if data_str else {}
                except Exception:
                    _log_error('preview_mesh: bad JSON')
                    return
                verts   = d.get('verts',   [])
                indices = d.get('indices', [])
                normals = d.get('normals')
                _log_info(f'preview_mesh: {len(verts)//3} verts, {len(indices)//3} tris')
                if not verts or not indices:
                    _clear_cg()
                    return
                _draw_cg_mesh(verts, indices, normals)
                return

            if action == 'preview_clear':
                _clear_cg()
                return

            if action == 'commit':
                try:
                    d = json.loads(data_str) if data_str else {}
                except Exception:
                    _log_error('commit: bad JSON')
                    return
                grids = d.get('grids') or []
                _log_info(f'commit: {len(grids)} face grid(s)')
                _commit_stamp_to_fusion(grids)
                return

            _log(f'Unknown action: {action!r}  data: {data_str[:80]}')

        except Exception:
            tb = traceback.format_exc()
            _log(f'PaletteHTMLEventHandler EXCEPTION:\n{tb}')
            if ui:
                ui.messageBox(f'Stamp Editor palette event failed:\n{tb}')


# ── Palette Closed handler ────────────────────────────────────────────────────
class PaletteClosedHandler(adsk.core.UserInterfaceGeneralEventHandler):
    def notify(self, args):
        try:
            _log('Palette closed event received')
            _disable_live_face_count()
            # Drop the CustomGraphics preview ghost so a leftover stamp
            # doesn't hover over the design after the palette is gone.
            _clear_cg()
        except Exception:
            _log(f'PaletteClosedHandler error:\n{traceback.format_exc()}')


# Module-level handle to the live-count selection handler so we can
# add/remove it cleanly across palette open/close cycles.
_active_sel_handler = None

def _enable_live_face_count():
    """Subscribe to ui.activeSelectionChanged so the palette gets a
    live count of how many BRepFaces are currently selected in the
    Fusion canvas. Idempotent: subscribing twice would double-fire."""
    global _active_sel_handler
    if _active_sel_handler is not None:
        return
    try:
        h = ActiveSelectionChangedHandler()
        ui.activeSelectionChanged.add(h)
        _active_sel_handler = h
        handlers.append(h)
        _log('live face-count: subscribed to activeSelectionChanged')
        # Send an initial 0-count so the UI starts in a sane state.
        _send_to_palette('face_count_update', { 'count': len(_faces_from_active_selection()) })
    except Exception:
        _log(f'_enable_live_face_count:\n{traceback.format_exc()}')

def _disable_live_face_count():
    global _active_sel_handler
    if _active_sel_handler is None:
        return
    try:
        ui.activeSelectionChanged.remove(_active_sel_handler)
    except Exception:
        pass
    try:
        if _active_sel_handler in handlers:
            handlers.remove(_active_sel_handler)
    except Exception:
        pass
    _active_sel_handler = None
    _log('live face-count: unsubscribed')


# ── Face-pick: invoked from the palette via the `pick_face` action ───────────
#
# Pattern: register a separate command definition the first time the
# palette asks for face-pick (lazy because it doesn't need to live in
# the toolbar). On command-execute we read the SelectionInput's entity
# (a BRepFace) and ship its captured metadata back to the palette via
# `sendInfoToHTML('face_picked', …)`. The palette JS routes that into
# showFaceState in main.js.

# Server-side cache of the BRepFace objects the user just captured.
# Keyed by their position in the captured list so JS can refer back
# to "face #2" when asking us to re-evaluate or commit. Cleared on
# every fresh capture.
_captured_faces = []


def _faces_from_active_selection():
    """Walk ui.activeSelections, pull out every BRepFace, return as a
    plain list. Used by both the live count event and the capture
    action."""
    out = []
    try:
        for sel in ui.activeSelections:
            face = adsk.fusion.BRepFace.cast(sel.entity)
            if face:
                out.append(face)
    except Exception:
        _log(f'_faces_from_active_selection:\n{traceback.format_exc()}')
    return out


def _eval_face_grid(face, nx, nz):
    """Sample a BRepFace at a regular nx × nz UV grid. Returns
    {positions: [x,y,z, ...] mm, normals: [nx,ny,nz, ...], nx, nz}
    or None on failure. Positions are converted from Fusion's internal
    cm to mm so the JS side can work in user-facing units.

    Two paths:
      - Bulk: getPointsAtParameters / getNormalsAtParameters in a
        single call (fast on big grids but some Fusion builds reject
        the input list).
      - Per-point fallback: loop over the grid and call the single-
        parameter variants. Slower but more compatible.
    """
    try:
        ev = face.evaluator
        rng = _evaluator_param_range(ev)
        if rng is None:
            _log_warn('_eval_face_grid: no parametric range')
            return None
        u0, u1, v0, v1 = rng
        _log_debug(f'_eval_face_grid: UV [{u0:.3f}..{u1:.3f}] × [{v0:.3f}..{v1:.3f}], grid {nx}×{nz}')

        # V is iterated TOP-DOWN (j=0 → v_max, j=nz-1 → v_min) so the
        # SVG editor's Y-down convention matches the face's "top" in
        # 3D. Drawing at the top of the editor canvas then lands at
        # v_max on the face. This keeps the outline backdrop, live
        # preview, and commit consistent.
        params = []
        for j in range(nz):
            v = v1 - (v1 - v0) * (j / max(1, nz - 1))
            for i in range(nx):
                u = u0 + (u1 - u0) * (i / max(1, nx - 1))
                params.append(adsk.core.Point2D.create(u, v))

        positions, normals = None, None

        # --- Bulk path (robust to both API return shapes) ---
        pts = _evaluator_points_bulk(ev, params)
        nrm = _evaluator_normals_bulk(ev, params)
        if pts and nrm and len(pts) == len(params) and len(nrm) == len(params):
            positions = []
            normals   = []
            for p in pts:
                positions.extend([p.x * 10.0, p.y * 10.0, p.z * 10.0])
            for n in nrm:
                normals.extend([n.x, n.y, n.z])
            _log_debug(f'_eval_face_grid: bulk eval ok ({len(pts)} pts)')
        else:
            _log_warn(f'_eval_face_grid: bulk eval failed '
                      f'(pts={pts and len(pts)} nrm={nrm and len(nrm)}) — falling back')

        # --- Per-point fallback ---
        if positions is None or normals is None:
            positions = []
            normals   = []
            ok_count = 0
            for pt2 in params:
                pp = _evaluator_point (ev, pt2)
                nn = _evaluator_normal(ev, pt2)
                if pp is None or nn is None:
                    positions.extend([0.0, 0.0, 0.0])
                    normals.extend([0.0, 0.0, 1.0])
                    continue
                positions.extend([pp.x * 10.0, pp.y * 10.0, pp.z * 10.0])
                normals.extend([nn.x, nn.y, nn.z])
                ok_count += 1
            _log_info(f'_eval_face_grid: per-point fallback evaluated {ok_count}/{len(params)} pts ok')
            if ok_count == 0:
                return None

        return {
            'positions': positions,
            'normals':   normals,
            'nx':        nx,
            'nz':        nz,
        }
    except Exception:
        _log_error(f'_eval_face_grid:\n{traceback.format_exc()}')
        return None


class ActiveSelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    """Pushes a live face-count update to the palette every time the
    user picks / deselects something in the canvas. Subscribed while
    the palette is open; removed on close so we don't leak across
    palette sessions."""
    def notify(self, args):
        try:
            faces = _faces_from_active_selection()
            _send_to_palette('face_count_update', { 'count': len(faces) })
        except Exception:
            _log(f'ActiveSelectionChangedHandler:\n{traceback.format_exc()}')


def _capture_selected_faces():
    """Snapshot every face currently in ui.activeSelections. Stores
    the BRepFace refs in _captured_faces (server-side cache) and ships
    JSON-serialisable metadata to the palette via `faces_picked`."""
    global _captured_faces
    try:
        faces = _faces_from_active_selection()
        _captured_faces = list(faces)
        if not faces:
            _log('capture: nothing selected')
            _send_to_palette('faces_picked', { 'faces': [], 'count': 0 })
            return
        captured = []
        for idx, f in enumerate(faces):
            d = _capture_face_data(f)
            if d:
                d['faceIndex'] = idx
                captured.append(d)
        _log(f'capture: {len(captured)} face(s) snapshot ok')
        _send_to_palette('faces_picked', {
            'faces': captured,
            'count': len(captured),
        })
    except Exception:
        _log(f'_capture_selected_faces:\n{traceback.format_exc()}')


def _send_face_grid(face_index, nx, nz):
    """Evaluate the cached face at index `face_index` on an nx × nz UV
    grid and ship the result to the palette as `face_grid`. The JS
    side caches these so the stamp engine can re-modulate without a
    Python round-trip on every input change."""
    try:
        if face_index < 0 or face_index >= len(_captured_faces):
            _log(f'face_grid: bad index {face_index} (have {len(_captured_faces)})')
            return
        grid = _eval_face_grid(_captured_faces[face_index], nx, nz)
        if grid is None:
            _send_to_palette('face_grid', {
                'faceIndex': face_index,
                'ok':        False,
                'msg':       'evaluator returned no data',
            })
            return
        grid['faceIndex'] = face_index
        grid['ok']        = True
        _send_to_palette('face_grid', grid)
    except Exception:
        _log(f'_send_face_grid:\n{traceback.format_exc()}')


def _evaluator_param_range(evaluator):
    """Fusion's `evaluator.parametricRange()` returns different shapes
    across versions: some return a BoundingBox2D directly, others
    return `[success, BoundingBox2D]` (as a Python list — NOT a tuple
    despite the docs). Normalise to (uMin, uMax, vMin, vMax) tuple,
    or None on failure."""
    try:
        r = evaluator.parametricRange()
    except Exception:
        return None
    # List/tuple form: [success, bbox]
    if isinstance(r, (list, tuple)) and len(r) >= 2:
        ok, bbox = r[0], r[1]
        if not ok or bbox is None:
            return None
    else:
        bbox = r
    try:
        return (bbox.minPoint.x, bbox.maxPoint.x,
                bbox.minPoint.y, bbox.maxPoint.y)
    except Exception:
        return None


def _evaluator_point(evaluator, p2):
    """Same shape-robustness for getPointAtParameter. Fusion returns
    `[success, Point3D]` as a Python list here."""
    try:
        r = evaluator.getPointAtParameter(p2)
    except Exception:
        return None
    if isinstance(r, (list, tuple)) and len(r) >= 2:
        ok, pt = r[0], r[1]
        return pt if ok else None
    return r


def _evaluator_normal(evaluator, p2):
    """Same shape-robustness for getNormalAtParameter."""
    try:
        r = evaluator.getNormalAtParameter(p2)
    except Exception:
        return None
    if isinstance(r, (list, tuple)) and len(r) >= 2:
        ok, n = r[0], r[1]
        return n if ok else None
    return r


def _evaluator_points_bulk(evaluator, params):
    """Robust wrapper for getPointsAtParameters. Fusion returns
    `[success, Point3DVector]` as a Python list; the Point3DVector
    is iterable so we can list() it. Returns a Python list of Point3D
    or None if the call failed / isn't supported."""
    try:
        r = evaluator.getPointsAtParameters(params)
    except Exception:
        return None
    if isinstance(r, (list, tuple)) and len(r) >= 2:
        ok, pts = r[0], r[1]
        if not ok or pts is None:
            return None
        try:
            return [pts.item(i) for i in range(pts.count)]
        except Exception:
            try:
                return list(pts)
            except Exception:
                return None
    try:
        return list(r) if r else None
    except Exception:
        return None


def _evaluator_normals_bulk(evaluator, params):
    """Same for getNormalsAtParameters."""
    try:
        r = evaluator.getNormalsAtParameters(params)
    except Exception:
        return None
    if isinstance(r, (list, tuple)) and len(r) >= 2:
        ok, nrm = r[0], r[1]
        if not ok or nrm is None:
            return None
        try:
            return [nrm.item(i) for i in range(nrm.count)]
        except Exception:
            try:
                return list(nrm)
            except Exception:
                return None
    try:
        return list(r) if r else None
    except Exception:
        return None


def _capture_face_data(face):
    """Snapshot a BRepFace into a JSON-serialisable dict that the
    palette JS uses to render the active state and (eventually) build
    the stamp grid.

    All distances are converted from Fusion's internal cm to mm so
    the palette can work in user-facing units.
    """
    try:
        body = face.body
        evaluator = face.evaluator
        rng = _evaluator_param_range(evaluator)
        if rng is None:
            _log_warn('_capture_face_data: no parametric range')
            return None
        u_min, u_max, v_min, v_max = rng
        u_mid = (u_min + u_max) * 0.5
        v_mid = (v_min + v_max) * 0.5
        mid_param = adsk.core.Point2D.create(u_mid, v_mid)

        centre = _evaluator_point (evaluator, mid_param)
        normal = _evaluator_normal(evaluator, mid_param)
        cx, cy, cz = (centre.x, centre.y, centre.z) if centre else (0.0, 0.0, 0.0)
        nx, ny, nz = (normal.x, normal.y, normal.z) if normal else (0.0, 0.0, 1.0)

        bb = face.boundingBox
        bb_min = bb.minPoint
        bb_max = bb.maxPoint

        # area is in cm² internally; ×100 → mm².
        area_mm2 = face.area * 100.0

        # Classify surface kind for the palette to show.
        geom = face.geometry
        kind = type(geom).__name__ if geom else 'Unknown'

        # Editor canvas geometry — the same mm size the engine uses when
        # rasterising the SVG, plus the face's trim outline (in canvas
        # coords) so the SVG editor can render it as a backdrop guide.
        canvas_w_mm, canvas_h_mm, outline = _compute_face_canvas(face, u_min, u_max, v_min, v_max)

        return {
            'bodyName':     body.name if body else '?',
            'surfaceKind':  kind,
            'faceArea':     area_mm2,
            'centerMm':     [cx * 10.0, cy * 10.0, cz * 10.0],
            'normal':       [nx, ny, nz],
            'bboxMin':      [bb_min.x * 10.0, bb_min.y * 10.0, bb_min.z * 10.0],
            'bboxMax':      [bb_max.x * 10.0, bb_max.y * 10.0, bb_max.z * 10.0],
            'parametric':   {
                'uMin':     u_min,
                'uMax':     u_max,
                'vMin':     v_min,
                'vMax':     v_max,
            },
            # Editor canvas guide. canvasWMm/canvasHMm = the face's mm
            # extent matching the engine's widthMm/heightMm. `outline`
            # is a list of loops, each a list of [x, y] in canvas coords
            # (0..canvasWMm × 0..canvasHMm). The first loop is the outer
            # boundary; subsequent loops are holes.
            'canvasWMm':    canvas_w_mm,
            'canvasHMm':    canvas_h_mm,
            'outline':      outline,
        }
    except Exception:
        _log(f'_capture_face_data:\n{traceback.format_exc()}')
        return None


def _compute_face_canvas(face, u_min, u_max, v_min, v_max):
    """Compute the SVG editor canvas dimensions and the face's trim
    outline in canvas coordinates.

    Returns (width_mm, height_mm, outline) where:
      - width_mm  : chord length along U at the face's middle V (mm)
      - height_mm : chord length along V at the face's middle U (mm)
      - outline   : list of loops, each [[x, y], ...] in canvas mm
                    coords (0..width_mm × 0..height_mm). First loop is
                    the outer boundary; subsequent loops are holes.

    The mm size matches engine.js's widthMm/heightMm derivation so the
    editor canvas and the engine's rasterisation map to the same area.

    Loop sampling: walk the face's BRepLoops in order; for each edge,
    sample its 3D curve at N points, then look up the (u, v) of each
    sample via face.evaluator.getParameterAtPoint. Map (u, v) to
    canvas coords linearly using the face's parametric range.
    """
    ev = face.evaluator
    # Width: chord from (u_min, v_mid) to (u_max, v_mid)
    v_mid = (v_min + v_max) * 0.5
    p_left  = _evaluator_point(ev, adsk.core.Point2D.create(u_min, v_mid))
    p_right = _evaluator_point(ev, adsk.core.Point2D.create(u_max, v_mid))
    width_mm = 0.0
    if p_left and p_right:
        dx = (p_right.x - p_left.x) * 10.0
        dy = (p_right.y - p_left.y) * 10.0
        dz = (p_right.z - p_left.z) * 10.0
        width_mm = (dx*dx + dy*dy + dz*dz) ** 0.5
    # Height: chord from (u_mid, v_min) to (u_mid, v_max)
    u_mid = (u_min + u_max) * 0.5
    p_bot = _evaluator_point(ev, adsk.core.Point2D.create(u_mid, v_min))
    p_top = _evaluator_point(ev, adsk.core.Point2D.create(u_mid, v_max))
    height_mm = 0.0
    if p_bot and p_top:
        dx = (p_top.x - p_bot.x) * 10.0
        dy = (p_top.y - p_bot.y) * 10.0
        dz = (p_top.z - p_bot.z) * 10.0
        height_mm = (dx*dx + dy*dy + dz*dz) ** 0.5

    # Fallback to face bbox extents if chord calc returned zero (e.g.
    # closed surface where u_min == u_max in chord space).
    if width_mm  <= 0 or height_mm <= 0:
        bb = face.boundingBox
        width_mm  = max(width_mm,  (bb.maxPoint.x - bb.minPoint.x) * 10.0)
        height_mm = max(height_mm, (bb.maxPoint.y - bb.minPoint.y) * 10.0)
    if width_mm  <= 0: width_mm  = 1.0
    if height_mm <= 0: height_mm = 1.0

    # Sample each loop's edges and project to canvas coords. SAMPLES_PER_EDGE
    # is a compromise between outline fidelity (curves stay smooth) and
    # bridge payload size (one face × N loops × M edges × K samples).
    SAMPLES_PER_EDGE = 24
    du = u_max - u_min
    dv = v_max - v_min

    def uv_to_canvas(p2):
        # Y is flipped so the canvas Y-down convention matches the
        # face's V iteration in _eval_face_grid (v_max at top of canvas
        # / j=0; v_min at bottom / j=nz-1).
        x = (p2.x - u_min) / du * width_mm  if du > 0 else 0.0
        y = (v_max - p2.y) / dv * height_mm if dv > 0 else 0.0
        return [x, y]

    outline = []
    try:
        for loop in face.loops:
            loop_pts = []
            for edge in loop.edges:
                ce = edge.evaluator
                try:
                    r = ce.getParameterExtents()
                    if isinstance(r, (list, tuple)) and len(r) >= 3:
                        ok, t0, t1 = r[0], r[1], r[2]
                        if not ok:
                            continue
                    else:
                        continue
                except Exception:
                    continue
                # Sample edge at uniform parameter values.
                params = []
                for k in range(SAMPLES_PER_EDGE + 1):
                    params.append(t0 + (t1 - t0) * (k / SAMPLES_PER_EDGE))
                try:
                    rp = ce.getPointsAtParameters(params)
                    pts3d = rp[1] if isinstance(rp, (list, tuple)) and rp[0] else None
                except Exception:
                    pts3d = None
                if not pts3d:
                    continue
                # Convert SWIG vector → real list.
                try:
                    pts3d_list = [pts3d.item(i) for i in range(pts3d.count)]
                except Exception:
                    pts3d_list = list(pts3d)
                # Project each 3D sample to (u, v) on this face.
                rq = ev.getParametersAtPoints(pts3d_list)
                params2d = rq[1] if isinstance(rq, (list, tuple)) and rq[0] else None
                if not params2d:
                    continue
                try:
                    p2d_list = [params2d.item(i) for i in range(params2d.count)]
                except Exception:
                    p2d_list = list(params2d)
                for p2 in p2d_list:
                    loop_pts.append(uv_to_canvas(p2))
            if loop_pts:
                outline.append(loop_pts)
    except Exception:
        _log(f'_compute_face_canvas: outline sample failed:\n{traceback.format_exc()}')

    return width_mm, height_mm, outline


def _send_to_palette(action, data):
    """Convenience wrapper around `palette.sendInfoToHTML(action, json)`
    that swallows the now-routine "palette not open" race."""
    try:
        pal = ui.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML(action, json.dumps(data))
    except Exception:
        _log(f'_send_to_palette({action}):\n{traceback.format_exc()}')


# CG ghost — one group, replaced on every preview_mesh.
_cg_group = None


def _clear_cg():
    """Drop the stamp ghost from the active design's CG, if any."""
    global _cg_group
    try:
        if _cg_group:
            try:
                if _cg_group.isValid:
                    _cg_group.deleteMe()
            except Exception:
                pass
        _cg_group = None
    except Exception as e:
        _log(f'_clear_cg: {e}')


def _draw_cg_mesh(verts, indices, normals):
    """Replace the CG ghost with a fresh mesh built from the supplied
    flat vertex/index/normal lists.

    verts:   flat list of x,y,z floats in CENTIMETERS (the wire format
             the b-spline-gen / step-editor bridge has always used —
             matches Fusion's internal length unit).
    indices: flat list of triangle vertex indices.
    normals: optional flat list of normals; empty → Fusion auto-shades.
    """
    global _cg_group
    try:
        des = adsk.fusion.Design.cast(app.activeProduct)
        if not des:
            _log('preview_mesh: no active Fusion design — skipping')
            return None
        _clear_cg()
        _cg_group = des.rootComponent.customGraphicsGroups.add()
        coords = adsk.fusion.CustomGraphicsCoordinates.create(verts)
        idx_list = [int(i) for i in indices]
        nrm_list = [float(v) for v in (normals or [])]
        mesh = _cg_group.addMesh(coords, idx_list, nrm_list, [])
        try:
            color = adsk.core.Color.create(245, 158, 11, 220)  # warm amber
            mesh.color = adsk.fusion.CustomGraphicsSolidColorEffect.create(color)
        except Exception:
            pass
        try:
            material = adsk.fusion.CustomGraphicsPhongMaterial.create(
                0.10, 0.65, 0.40, 14.0,
            )
            mesh.effect = adsk.fusion.CustomGraphicsMaterialEffect.create(material)
        except Exception:
            pass
        return mesh
    except Exception:
        _log(f'_draw_cg_mesh EXCEPTION:\n{traceback.format_exc()}')
        return None


# ── Send to Fusion: MeshBody from deformed grid ─────────────────────────────

def _commit_stamp_to_fusion(grids_payload):
    """Bake the in-progress stamp as a real Fusion MeshBody per face.

    `grids_payload` is what the JS side ships from the engine —
    one entry per captured face, each carrying the deformed control
    points in PHYSICAL MM:

        [{ faceIndex, nx, nz, positions: [x,y,z, …] }, …]

    Per face we ask Fusion's own MeshCalculator to tessellate the BRep
    face — the resulting mesh already conforms to the face's trim
    outline. Each tessellated vertex is then displaced along the face
    normal by the engine's deformation, interpolated from the regular
    UV grid via `_displace_face_tessellation`. The displaced mesh is
    added as a MeshBody (`addByTriangleMeshData`), which Fusion CAM
    treats as fully machinable. In parametric designs the add is
    wrapped in a BaseFeature so the timeline tracks it.

    Each face is processed independently — one face failing doesn't
    abort the rest.
    """
    global _captured_faces

    if not _captured_faces:
        _log_warn('commit: no captured faces — nothing to bake')
        _send_to_palette('commit_result', {'ok': False, 'msg': 'No captured faces.'})
        return
    if not grids_payload:
        _log_warn('commit: empty grids payload')
        _send_to_palette('commit_result', {'ok': False, 'msg': 'No deformed grids to bake.'})
        return

    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    if not design:
        _log_error('commit: no active Design')
        _send_to_palette('commit_result', {'ok': False, 'msg': 'No active design.'})
        return

    parametric = (design.designType == adsk.fusion.DesignTypes.ParametricDesignType)
    try:
        timeline_group_start = design.timeline.markerPosition
    except Exception:
        timeline_group_start = None

    mesh_count = 0   # one increment per successfully created MeshBody
    errors     = []

    for entry in grids_payload:
        fi = int(entry.get('faceIndex', -1))
        try:
            nx = int(entry.get('nx', 0))
            nz = int(entry.get('nz', 0))
            pts = entry.get('positions') or []
            if fi < 0 or fi >= len(_captured_faces):
                errors.append(f'face index {fi} out of range')
                continue
            if nx < 2 or nz < 2 or len(pts) != nx * nz * 3:
                errors.append(f'face {fi}: bad grid (nx={nx} nz={nz} len={len(pts)})')
                continue

            face = _captured_faces[fi]
            if not face or not face.isValid:
                errors.append(f'face {fi}: stale face reference')
                continue

            try:
                target_comp = face.body.parentComponent
            except Exception:
                target_comp = design.rootComponent

            # Take Fusion's own tessellation of the BRep face (which is
            # already trimmed to the face outline), then displace each
            # vertex by the engine's deformation interpolated at that
            # vertex's U/V. Output is a mesh that EXACTLY matches the
            # original face's outline at the boundary.
            try:
                coords, indices = _displace_face_tessellation(face, nx, nz, pts)
                _log_info(f'  face {fi}: tessellation displaced — '
                          f'{len(coords)//3} verts, {len(indices)//3} tris')
            except Exception as e:
                errors.append(f'face {fi}: tessellation failed: {e}')
                _log_error(f'face {fi}: tessellation:\n{traceback.format_exc()}')
                continue

            # The face evaluator returns WORLD coords (via the proxy's
            # assembly context). target_comp.meshBodies.addByTriangleMeshData
            # interprets its input in the component's LOCAL space, so
            # we have to apply the inverse of the occurrence transform
            # before adding — otherwise the body's component transform
            # is applied a second time and the mesh ends up offset.
            occ = face.assemblyContext
            if occ is not None:
                try:
                    inv = occ.transform.copy()
                    if inv.invert():
                        coords = _transform_coords_inplace(coords, inv)
                except Exception as e:
                    _log_warn(f'face {fi}: world→local transform failed ({e}); '
                              f'mesh may be offset')

            # Drop the mesh into the captured face's parent component
            # so the new body lives next to the body it was stamped on.
            try:
                new_body = _add_mesh_body(target_comp, coords, indices,
                                          parametric, name=f'Stamp_face{fi}')
                if new_body:
                    mesh_count += 1
                    _log_info(f'face {fi}: MeshBody created '
                              f'({len(coords)//3} verts, {len(indices)//3} tris)')
                else:
                    errors.append(f'face {fi}: addByTriangleMeshData returned None')
            except Exception as e:
                errors.append(f'face {fi}: mesh body add failed: {e}')
                _log_error(f'face {fi}: mesh body add:\n{traceback.format_exc()}')

        except Exception as e:
            tb = traceback.format_exc()
            _log_error(f'commit: face {fi} threw:\n{tb}')
            errors.append(f'face {fi}: {e}')

    # Wrap the whole commit in one timeline group so a single undo
    # cleans it up (parametric designs only).
    try:
        if parametric and timeline_group_start is not None \
                and design.timeline.count > timeline_group_start:
            grp = design.timeline.timelineGroups.add(
                timeline_group_start, design.timeline.count - 1)
            grp.name = 'Stamp Editor — Apply'
    except Exception:
        pass

    _log_info(f'commit summary: meshBodies={mesh_count} errors={len(errors)}')
    _send_to_palette('commit_result', {
        'ok':         mesh_count > 0,
        'meshBodies': mesh_count,
        'errors':     errors,
    })


def _displace_face_tessellation(face, nx, nz, deformed_pts_mm):
    """Build a mesh that EXACTLY matches the BRep face's trimmed
    outline, with the engine's deformation applied to each vertex.

    Pipeline:
      1. Ask Fusion's MeshCalculator to tessellate `face`. This gives
         a TriangleMesh whose vertices/edges already conform to the
         face's trim curves (including holes and curved boundaries).
      2. For each tessellation vertex (in 3D, on the original face),
         project it to parametric (u, v) via `getParameterAtPoint`.
      3. Compute the deformation DELTA from the engine's regular grid
         at that (u, v) using bilinear interpolation. The grid stores
         deformed positions; subtracting the corresponding undeformed
         (face-surface) position gives the displacement vector.
      4. Add the displacement to the original vertex position.
      5. Triangulate using the tessellation's own indices.

    Returns (coords_cm, indices) ready for addByTriangleMeshData.
    """
    ev = face.evaluator
    rng = _evaluator_param_range(ev)
    if rng is None:
        raise RuntimeError('face has no parametric range')
    u0, u1, v0, v1 = rng

    # ── (1) Tessellate the face via Fusion's own mesher ───────────────
    # For a planar face Fusion's default tessellation is very sparse
    # (no curvature to capture). We force a dense mesh by bumping
    # quality and capping maxSideLength so the motif's detail survives.
    # 0.05 cm = 0.5 mm max edge ≈ 80×80 tris on a 40×40 mm face.
    mc = face.meshManager.createMeshCalculator()
    try:
        mc.setQuality(adsk.fusion.TriangleMeshQualityOptions.VeryHighQualityTriangleMesh)
    except Exception:
        pass
    try:
        mc.surfaceTolerance = 0.005     # cm  (0.05 mm)
        mc.maxSideLength    = 0.05      # cm  (0.5 mm) — drives density on flat regions
    except Exception:
        pass
    tri = mc.calculate()
    if not tri:
        raise RuntimeError('MeshCalculator.calculate() returned None')

    # nodeCoordinates: flat list of (x, y, z) in cm, Fusion's internal unit.
    # nodeIndices:     flat triangle indices.
    src_nodes   = list(tri.nodeCoordinatesAsDouble)
    src_indices = list(tri.nodeIndices)
    n_verts     = tri.nodeCount

    # ── (2) Pre-compute U/V per tessellation vertex ────────────────────
    # `getParametersAtPoints` accepts a list of Point3D and returns
    # a list of Point2D — much faster than per-point calls.
    pts3d = []
    for k in range(n_verts):
        o = k * 3
        pts3d.append(adsk.core.Point3D.create(
            src_nodes[o], src_nodes[o+1], src_nodes[o+2]))
    try:
        ok, p2_list = ev.getParametersAtPoints(pts3d)
        params = list(p2_list) if ok else None
    except Exception:
        params = None
    if not params:
        # Per-point fallback if the bulk call isn't supported.
        params = []
        for p3 in pts3d:
            try:
                r = ev.getParameterAtPoint(p3)
                if isinstance(r, (list, tuple)) and len(r) >= 2:
                    params.append(r[1] if r[0] else None)
                else:
                    params.append(r)
            except Exception:
                params.append(None)

    # ── (3) Pre-compute normals per tessellation vertex (in 3D) ────────
    try:
        ok, norm_list = ev.getNormalsAtParameters(params)
        normals = list(norm_list) if ok else None
    except Exception:
        normals = None
    if not normals:
        normals = []
        for p2 in params:
            try:
                n = _evaluator_normal(ev, p2) if p2 else None
                normals.append(n)
            except Exception:
                normals.append(None)

    # ── (4) Look up displacement per vertex by sampling the engine
    #         grid at the vertex's (u, v). Engine ships positions in
    #         mm; the face's tessellation is in cm — convert at the
    #         boundary. The "displacement" is the carve amount along
    #         the face normal, computed by projecting (deformed -
    #         undeformed) onto the normal at each grid sample, then
    #         bilinear-interpolating that scalar field. ────────────────
    # Per-grid-cell displacement field (mm).
    disp_grid = [0.0] * (nx * nz)
    # We re-eval the face at the grid's U/V to recover the undeformed
    # position at each grid sample, then dot (deformed - undeformed)
    # with the grid normal to get the scalar carve depth.
    # V is iterated TOP-DOWN to match _eval_face_grid's convention.
    grid_params = []
    for j in range(nz):
        v = v1 - (v1 - v0) * (j / max(1, nz - 1))
        for i in range(nx):
            u = u0 + (u1 - u0) * (i / max(1, nx - 1))
            grid_params.append(adsk.core.Point2D.create(u, v))
    grid_undef = _evaluator_points_bulk(ev, grid_params) or []
    grid_norms = _evaluator_normals_bulk(ev, grid_params) or []
    for k in range(min(len(grid_undef), len(grid_norms), nx * nz)):
        undef = grid_undef[k]   # Point3D in cm
        normal = grid_norms[k]
        o = k * 3
        dx_mm = deformed_pts_mm[o]     - undef.x * 10.0
        dy_mm = deformed_pts_mm[o + 1] - undef.y * 10.0
        dz_mm = deformed_pts_mm[o + 2] - undef.z * 10.0
        if normal is None:
            disp_grid[k] = 0.0
        else:
            disp_grid[k] = dx_mm * normal.x + dy_mm * normal.y + dz_mm * normal.z

    def bilinear(u, v):
        """Bilinear sample disp_grid at parametric (u, v). Returns mm.
        Note: fj uses the flipped V convention so grid row j=0 ↔ v=v1."""
        fi = (u - u0) / (u1 - u0) * (nx - 1) if u1 > u0 else 0.0
        fj = (v1 - v) / (v1 - v0) * (nz - 1) if v1 > v0 else 0.0
        i0 = max(0, min(nx - 2, int(fi)))
        j0 = max(0, min(nz - 2, int(fj)))
        ti = max(0.0, min(1.0, fi - i0))
        tj = max(0.0, min(1.0, fj - j0))
        d00 = disp_grid[j0 * nx + i0]
        d10 = disp_grid[j0 * nx + i0 + 1]
        d01 = disp_grid[(j0 + 1) * nx + i0]
        d11 = disp_grid[(j0 + 1) * nx + i0 + 1]
        d0 = d00 * (1 - ti) + d10 * ti
        d1 = d01 * (1 - ti) + d11 * ti
        return d0 * (1 - tj) + d1 * tj

    # ── (5) Apply displacement to each tessellation vertex ────────────
    out_coords = list(src_nodes)   # cm; we mutate in place
    for k in range(n_verts):
        p2 = params[k]
        n3 = normals[k] if k < len(normals) else None
        if p2 is None or n3 is None:
            continue
        d_mm = bilinear(p2.x, p2.y)
        d_cm = d_mm * 0.1
        o = k * 3
        out_coords[o]     += n3.x * d_cm
        out_coords[o + 1] += n3.y * d_cm
        out_coords[o + 2] += n3.z * d_cm

    return out_coords, src_indices


def _transform_coords_inplace(coords, matrix):
    """Apply a Matrix3D to every (x, y, z) triple in a flat coords list.
    Returns the list (the caller can rebind even though we mutate in
    place — Python's len-based addByTriangleMeshData doesn't care).
    """
    pt = adsk.core.Point3D.create(0, 0, 0)
    for i in range(0, len(coords), 3):
        pt.x = coords[i]
        pt.y = coords[i + 1]
        pt.z = coords[i + 2]
        pt.transformBy(matrix)
        coords[i]     = pt.x
        coords[i + 1] = pt.y
        coords[i + 2] = pt.z
    return coords


def _add_mesh_body(target_comp, coords, indices, parametric, name='Stamp'):
    """Add a triangle MeshBody to the target component.

    In parametric designs the add must be wrapped in a BaseFeature so
    the timeline tracks it. In direct mode the meshBodies collection
    accepts adds straight away.
    """
    if parametric:
        base = target_comp.features.baseFeatures.add()
        base.startEdit()
        try:
            body = target_comp.meshBodies.addByTriangleMeshData(
                coords, indices, [], [])
            if body:
                try: body.name = name
                except Exception: pass
            return body
        finally:
            base.finishEdit()
    else:
        body = target_comp.meshBodies.addByTriangleMeshData(
            coords, indices, [], [])
        if body:
            try: body.name = name
            except Exception: pass
        return body


# ── CommandCreated → open the palette ─────────────────────────────────────────
class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            onExecute = CommandExecuteHandler()
            cmd.execute.add(onExecute)
            handlers.append(onExecute)
        except Exception:
            _log(f'CommandCreatedHandler error:\n{traceback.format_exc()}')


class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            _open_palette()
        except Exception:
            tb = traceback.format_exc()
            _log(f'CommandExecuteHandler error:\n{tb}')
            if ui:
                ui.messageBox(f'Stamp Editor command failed:\n{tb}')


def _open_palette():
    """Create the palette if it doesn't exist, otherwise show it."""
    if not ui:
        _log('_open_palette: no UI available')
        return

    pal = ui.palettes.itemById(PALETTE_ID)
    if pal:
        _log('Palette exists — making visible')
        pal.isVisible = True
        return

    addin_dir = os.path.dirname(os.path.realpath(__file__))
    html_abs  = os.path.join(addin_dir, PALETTE_HTML)
    # Fusion expects forward-slash file:// URLs; the cache-bust query
    # string is added in a second pass via htmlFileURL setter once the
    # palette is alive (palettes.add() rejects query strings on first
    # creation — same quirk step-editor handles).
    html_url  = 'file:///' + html_abs.replace('\\', '/')

    _log(f'Creating palette, html_path={html_abs}')
    pal = ui.palettes.add(
        PALETTE_ID,
        PALETTE_NAME,
        html_url,
        True,   # is visible
        True,   # show close button
        True,   # is resizable
        420,    # width
        700,    # height
    )
    pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight

    # Cache-bust on every open so JS modules reload fresh.
    try:
        import time as _time
        pal.htmlFileURL = html_url + f'?v={int(_time.time() * 1000)}'
    except Exception:
        pass

    onHTML = PaletteHTMLEventHandler()
    pal.incomingFromHTML.add(onHTML)
    handlers.append(onHTML)

    onClosed = PaletteClosedHandler()
    pal.closed.add(onClosed)
    handlers.append(onClosed)

    _enable_live_face_count()

    _log('Palette created/wired (HTML + Closed events)')


# ── run / stop ────────────────────────────────────────────────────────────────
def run(context):
    """Wire the toolbar button into the B-Spline Builder panel on each
    target tab. Idempotent: clean up any leftover button + cmd-def from
    a prior run before installing fresh handlers."""
    try:
        _log('--- SESSION STARTED ---')
        global ui
        if ui is None:
            ui = adsk.core.Application.get().userInterface
        cmd_defs = ui.commandDefinitions

        # Defensive cleanup — stale palette from a prior session.
        try:
            stale = ui.palettes.itemById(PALETTE_ID)
            if stale:
                stale.deleteMe()
                _log('Cleaned up stale palette from prior session')
        except Exception:
            _log(f'Stale palette cleanup failed:\n{traceback.format_exc()}')

        # Drop the old toolbar control + command def before re-creating.
        for panel in ui.allToolbarPanels:
            try:
                ctrl = panel.controls.itemById(COMMAND_ID)
                if ctrl:
                    ctrl.deleteMe()
            except Exception:
                pass

        # One-time cleanup: remove the duplicate "B-Spline Builder" panel
        # that earlier builds created under its own id. Only check the
        # tabs we author into — iterating ui.allToolbarTabs trips a
        # RuntimeError on workspace-less tabs and would short-circuit
        # the rest of run().
        for tab_id in TARGET_TAB_IDS:
            try:
                tab = ui.allToolbarTabs.itemById(tab_id)
                if not tab:
                    continue
                for panel in list(tab.toolbarPanels):
                    try:
                        if panel.id.startswith(LEGACY_PANEL_PREFIX):
                            panel.deleteMe()
                            _log(f'Removed legacy panel {panel.id}')
                    except Exception:
                        pass
            except Exception:
                # Tab access threw — skip and keep going.
                pass

        existing = cmd_defs.itemById(COMMAND_ID)
        if existing:
            try: existing.deleteMe()
            except Exception: pass

        # Command definition. Icon folder name matches the on-disk
        # convention used by step-editor / fusion-exporter — the
        # `ressources` folder. Fusion caches button bitmaps by
        # (command-id, resource-path) for the life of the session, so
        # the first install of this add-in latches whatever PNGs are
        # in that folder and won't re-read updates without a full
        # Fusion restart. To break that cache we mirror the icon set
        # into a per-deploy `ressources_<mtime>` folder and point at
        # THAT — a fresh path is enough to defeat the cache.
        addin_dir = os.path.dirname(os.path.realpath(__file__))
        src_res   = os.path.join(addin_dir, 'ressources')
        try:
            sig = int(os.path.getmtime(os.path.join(src_res, '16x16.png')))
        except Exception:
            sig = int(datetime.datetime.now().timestamp())
        res_folder = os.path.join(addin_dir, f'ressources_{sig}')
        try:
            if not os.path.isdir(res_folder):
                os.makedirs(res_folder, exist_ok=True)
                for name in ('16x16.png', '32x32.png', '64x64.png'):
                    src = os.path.join(src_res, name)
                    if os.path.isfile(src):
                        shutil.copy2(src, os.path.join(res_folder, name))
            # Sweep up older `ressources_*` folders so the add-in dir
            # doesn't accumulate cruft across reloads.
            for entry in os.listdir(addin_dir):
                full = os.path.join(addin_dir, entry)
                if (entry.startswith('ressources_')
                        and full != res_folder
                        and os.path.isdir(full)):
                    try:
                        shutil.rmtree(full)
                    except Exception:
                        pass
        except Exception:
            # If anything fails, fall back to the canonical folder —
            # Fusion just won't reload the icon until next restart.
            res_folder = src_res
        cmd_def = cmd_defs.addButtonDefinition(COMMAND_ID, COMMAND_NAME, COMMAND_TOOLTIP, res_folder)

        onCreated = CommandCreatedHandler()
        cmd_def.commandCreated.add(onCreated)
        handlers.append(onCreated)

        # Add to the shared B-Spline Builder panel on every target tab.
        for tab_id in TARGET_TAB_IDS:
            tab = ui.allToolbarTabs.itemById(tab_id)
            if not tab:
                for t in ui.allToolbarTabs:
                    if tab_id in t.id or tab_id in (t.name or ''):
                        tab = t
                        break
            if not tab:
                _log(f'WARN: target tab {tab_id!r} not found — skipping')
                continue

            unique_panel_id = f'{SHARED_PANEL_ID}_{tab.id}'
            panel = tab.toolbarPanels.itemById(unique_panel_id)
            if not panel:
                panel = tab.toolbarPanels.add(unique_panel_id, SHARED_PANEL_NAME, 'SelectPanel', False)

            existing_ctrl = panel.controls.itemById(COMMAND_ID)
            if existing_ctrl:
                existing_ctrl.deleteMe()

            ctrl = panel.controls.addCommand(cmd_def)
            try:
                ctrl.isPromoted = True
                ctrl.isPromotedByDefault = True
            except Exception:
                pass

        _log('--- run() complete — Stamp Editor installed in B-Spline Builder panel ---')

    except Exception:
        tb = traceback.format_exc()
        _log(f'run() EXCEPTION:\n{tb}')
        if ui:
            ui.messageBox(f'Stamp Editor run failed:\n{tb}')


def stop(context):
    """Mirror of run() — remove the button from every panel it lives
    in, then drop the command definition. The palette (if open) is
    also cleaned up so a subsequent run() loads HTML from disk fresh."""
    try:
        _log('--- SESSION STOPPED ---')
        global ui
        if ui is None:
            ui = adsk.core.Application.get().userInterface

        _disable_live_face_count()

        try:
            palette = ui.palettes.itemById(PALETTE_ID)
            if palette:
                palette.deleteMe()
                _log('stop: palette deleted')
        except Exception:
            _log(f'stop: palette deleteMe threw:\n{traceback.format_exc()}')

        removed = 0
        for panel in ui.allToolbarPanels:
            try:
                ctrl = panel.controls.itemById(COMMAND_ID)
                if ctrl:
                    ctrl.deleteMe()
                    removed += 1
            except Exception:
                pass
        _log(f'stop: removed {removed} toolbar control(s)')

        existing = ui.commandDefinitions.itemById(COMMAND_ID)
        if existing:
            try:
                existing.deleteMe()
                _log('stop: command definition deleted')
            except Exception:
                _log(f'stop: cmd def deleteMe threw:\n{traceback.format_exc()}')

        # Face-pick uses ui.selectEntity (no command def needed) — no
        # extra teardown required there.

        handlers.clear()

    except Exception:
        tb = traceback.format_exc()
        _log(f'stop() EXCEPTION:\n{tb}')
