# step-editor.py
# STEP (.stp) file editor — palette + Python bridge.
# Mirrors b-spline-gen.py's hybrid pattern: HTML/JS owns the UI; Python
# tunnels log messages, opens/closes the palette, and (eventually) hands
# edited STEP files to Fusion's importManager.
#
# SCAFFOLD STAGE: this file only wires the palette button and the basic
# log/ping/reset_ui round-trip. STP import, sculpt, merge/split, and the
# generate handshake are TBD — when ready, port from b-spline-gen.py's
# _handle_generate / chunked-transfer block (which already knows how to
# write a STEP temp file and call ImportManager.importToTarget).

import adsk.core, adsk.fusion, traceback
import os, json, shutil, tempfile, datetime, base64, time
from array import array as _array  # faster than struct.pack for big buffers

handlers = []
ui  = None
app = adsk.core.Application.get()
if app:
    ui = app.userInterface

# ── Log file ──────────────────────────────────────────────────────────────────
def get_log_path():
    """Mirror of b-spline-gen's log-path strategy: prefer the workspace
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
                return os.path.join(workspace_root, 'step_editor_log.txt')
    except Exception:
        pass
    return os.path.join(addin_dir, 'step_editor_log.txt')

LOG_FILE = get_log_path()

def _log(msg):
    """Timestamped append + auto-rotation at 512 KB. Failures swallowed."""
    try:
        ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f'[{ts}] {msg}\n')
        if os.path.getsize(LOG_FILE) > 1024 * 512:
            os.replace(LOG_FILE, LOG_FILE + '.old')
    except Exception:
        pass

# ── Palette constants ─────────────────────────────────────────────────────────
PALETTE_ID   = 'stepEditorPalette'
PALETTE_NAME = 'STEP Editor'
PALETTE_HTML = 'html/step_editor_palette.html'
PALETTE_CACHE_PREFIX = '_palette_'  # legacy cache-folder name (see _cleanup_old_palette_dirs)


# ── Stale-cache cleanup ───────────────────────────────────────────────────────
# Earlier builds of this add-in tried to cache-bust the palette HTML by
# copying the html/ tree into a timestamped sibling folder. That
# broke Fusion's `window.adsk` injection and external script loading
# (the webview only trusts the original registered path), so the
# scheme was reverted. This helper sweeps up any leftover folders
# from those builds. Called on each stop() so the user's addin tree
# doesn't accumulate cruft across upgrades.
def _cleanup_old_palette_dirs(addin_dir):
    """Best-effort remove leftover _palette_* subfolders under the
    addin dir. Safe to call any time."""
    try:
        for name in os.listdir(addin_dir):
            if not name.startswith(PALETTE_CACHE_PREFIX):
                continue
            path = os.path.join(addin_dir, name)
            try:
                shutil.rmtree(path)
            except Exception:
                # File still locked by the previous webview — leave it,
                # Windows will reap when the lock releases.
                pass
    except Exception:
        pass

# Globals for the chunked-transfer handshake. Same shape as b-spline-gen
# so the two add-ins behave identically from the JS bridge's POV.
importing_done = False
chunk_buffer   = []
expected_chunks = 0    # set by generate_start; sanity-checked at finish

# CustomGraphics state — a single group held in the active design's root
# component. Cleared and rebuilt on every preview_mesh from the palette so
# scrubbing doesn't pile up garbage. Cleared again on cancel/close.
custom_graphics_group = None


def _clear_custom_graphics():
    """Remove the live-preview CustomGraphics group from the active design.
    Safe to call when nothing is drawn yet. Mirrors b-spline-gen.py
    `_clear_custom_graphics`. Iterates over a snapshot of the groups
    collection so the parallel deleteMe() doesn't trip the live-iteration
    Fusion API bug."""
    global custom_graphics_group
    try:
        des = adsk.fusion.Design.cast(app.activeProduct)
        if not des:
            return
        # Snapshot first — deleteMe shrinks the live collection mid-walk.
        for grp in list(des.rootComponent.customGraphicsGroups):
            try:
                if grp.isValid:
                    grp.deleteMe()
            except Exception:
                pass
        custom_graphics_group = None
    except Exception as e:
        _log(f'_clear_custom_graphics failed: {e}')


def _draw_preview_mesh(verts, indices, normals=None):
    """Replace the live-preview CustomGraphics group with a fresh mesh
    built from the supplied flat vertex/index/normal lists.

    verts:   flat list of x,y,z floats (length = 3 * vertexCount). The
             JS side ships them in CENTIMETERS (mm × 0.1). We rescale
             them here into the active design's CURRENT display unit
             before handing them to CustomGraphicsCoordinates, because
             that API interprets its input in DISPLAY units (not the
             internal cm convention you'd expect from the rest of the
             Fusion API). Verified empirically: in an inch-unit doc,
             sending raw cm makes the ghost mesh render 2.54× too big.
    indices: flat list of triangle vertex indices (length = 3 * triCount).
    normals: optional flat list of normal vectors. If None, leaves the
             normalVectors parameter empty so Fusion computes shading.

    Returns the new CustomGraphicsMesh on success, None on failure (logged)."""
    global custom_graphics_group
    try:
        des = adsk.fusion.Design.cast(app.activeProduct)
        if not des:
            _log('preview_mesh: no active Fusion Design — skipping')
            return None
        # Always rebuild — the alternative (mutating the existing group's
        # mesh) is fiddly enough that a fresh draw is simpler and still
        # fast for the typical body sizes (rectangle ~24 verts; canoe ~12 K).
        _clear_custom_graphics()
        custom_graphics_group = des.rootComponent.customGraphicsGroups.add()
        # Convert JS-side cm into the doc's display unit.
        #   um.convert(1, 'cm', display_unit) returns how many display-units
        #   one cm represents (e.g. 0.3937 for inches, 10 for mm).
        # Multiplying each cm coordinate by this factor produces the
        # value CustomGraphicsCoordinates wants.
        try:
            um = des.unitsManager
            display_unit = um.defaultLengthUnits   # 'in', 'mm', 'cm', 'm', ...
            scale_to_display = um.convert(1.0, 'cm', display_unit)
        except Exception as e:
            _log(f'preview_mesh: unit conversion lookup failed ({e}); falling through with scale=1.0')
            display_unit = '?'
            scale_to_display = 1.0
        if abs(scale_to_display - 1.0) > 1e-9:
            verts = [v * scale_to_display for v in verts]
            _log(f'preview_mesh: doc unit "{display_unit}" — scaling verts by {scale_to_display:.6f}')
        coords = adsk.fusion.CustomGraphicsCoordinates.create(verts)
        idx_list = [int(i) for i in indices]
        nrm_list = [float(v) for v in (normals or [])]
        mesh = custom_graphics_group.addMesh(coords, idx_list, nrm_list, [])
        # Subtle, slightly-translucent body colour so the preview reads as
        # "not yet committed" but is still visible on top of any other
        # geometry the user has in the scene.
        try:
            color = adsk.core.Color.create(216, 221, 227, 200)   # matches BODY_COLOUR_DEFAULT, ~80% alpha
            mesh.color = adsk.fusion.CustomGraphicsSolidColorEffect.create(color)
        except Exception:
            pass
        try:
            material = adsk.fusion.CustomGraphicsPhongMaterial.create(
                0.05,   # ambient
                0.70,   # diffuse
                0.30,   # specular
                10.0,   # shininess
            )
            mesh.effect = adsk.fusion.CustomGraphicsMaterialEffect.create(material)
        except Exception:
            # Material API not available on this Fusion build — solid colour fallback.
            pass
        return mesh
    except Exception:
        tb = traceback.format_exc()
        _log(f'_draw_preview_mesh EXCEPTION:\n{tb}')
        return None


def _send_progress(msg):
    """Push a progress line back to the palette HTML's status bar."""
    try:
        pal = app.userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML('import_progress', json.dumps({'msg': msg}))
    except Exception:
        pass


def _send_import_error(msg):
    """Tell the JS side a Send-to-Fusion attempt failed."""
    try:
        pal = app.userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML('import_error', json.dumps({'msg': msg}))
    except Exception:
        pass


# ── Palette Closed event handler ──────────────────────────────────────────────
class PaletteClosedHandler(adsk.core.UserInterfaceGeneralEventHandler):
    def notify(self, args):
        try:
            _log('Palette closed event received')
            # Drop the live-preview ghost so it doesn't outlive the palette.
            _clear_custom_graphics()
        except Exception:
            _log(f'PaletteClosedHandler error:\n{traceback.format_exc()}')


# ── Palette HTML event handler ────────────────────────────────────────────────
class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        global importing_done, chunk_buffer, expected_chunks
        try:
            htmlArgs = adsk.core.HTMLEventArgs.cast(args)
            action   = htmlArgs.action
            data_preview = (htmlArgs.data[:50] + '...') if htmlArgs.data and len(htmlArgs.data) > 50 else htmlArgs.data

            # JS-side console.log tunnel — useful while building the UI.
            if action == 'log':
                try:
                    data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                    _log(f'[JS LOG] {data.get("msg", "")}')
                except Exception as e:
                    _log(f'[JS LOG ERROR] {e}')
                return

            if action not in ('ping', 'log'):
                _log(f'Action: "{action}" | Data: {data_preview}')

            # Bridge health check.
            if action == 'ping':
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('pong', '{}')
                return

            # JS asked us to reset session state (e.g. after a soft refresh).
            if action == 'reset_ui':
                _log('reset_ui received')
                chunk_buffer = []
                importing_done = False
                return

            # ── Chunked-transfer: receive an edited STEP file from JS ────────
            # The JS side (core/fusion-bridge.js) splits the JSON envelope
            # { stepText, params } into 256 KB chunks and pushes them via
            # generate_start / generate_chunk / generate_finish. Same wire
            # contract as b-spline-gen — kept identical so the two add-ins
            # stay debuggable with the same eyeballs.
            if action == 'generate_start':
                data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                expected_chunks = int(data.get('totalChunks', 0))
                chunk_buffer    = []
                importing_done  = False
                _log(f'generate_start: expecting {expected_chunks} chunks')
                return

            if action == 'generate_chunk':
                data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                idx  = data.get('index', -1)
                payload = data.get('data', '')
                chunk_buffer.append(payload)
                # Progress every 10th chunk to avoid spamming the log.
                if expected_chunks and (idx + 1) % 10 == 0:
                    pct = int(((idx + 1) / expected_chunks) * 100)
                    _send_progress(f'Receiving STEP… {pct}%')
                return

            if action == 'generate_finish':
                _log(f'generate_finish: {len(chunk_buffer)} chunk(s) received')
                if expected_chunks and len(chunk_buffer) != expected_chunks:
                    msg = f'chunk count mismatch: got {len(chunk_buffer)}, expected {expected_chunks}'
                    _log(f'ERROR: {msg}')
                    _send_import_error(msg)
                    chunk_buffer = []
                    return
                envelope_json = ''.join(chunk_buffer)
                chunk_buffer  = []
                expected_chunks = 0
                try:
                    envelope = json.loads(envelope_json)
                except Exception as e:
                    msg = f'failed to parse JSON envelope: {e}'
                    _log(f'ERROR: {msg}')
                    _send_import_error(msg)
                    return
                # Dispatch based on envelope mode. Default mode is the
                # existing "import into active design" flow (Send to Fusion
                # button). The palette can request mode='tessellate' to use
                # Fusion's native STEP loader purely for fast preview
                # (~50 ms total for the 14 MB canoe, vs minutes via WASM).
                mode = (envelope.get('params') or {}).get('mode', 'import')
                if mode == 'tessellate':
                    self._handle_tessellate_via_fusion(envelope)
                else:
                    self._handle_send_to_fusion(envelope)
                return

            # ── preview_mesh: live ghost preview via CustomGraphics ──────
            # Receives a tessellated mesh (verts + tri-indices, optional
            # normals) from the palette JS and draws it as a transient
            # CustomGraphics group on the active design's root component.
            # Same pattern as b-spline-gen — no real BRep, no design-tree
            # entries, no Fusion canvas flashing. Cleared on cancel /
            # close / Send-to-Fusion commit.
            if action == 'preview_mesh':
                try:
                    data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                except Exception as e:
                    _log(f'preview_mesh: bad JSON: {e}')
                    return
                verts   = data.get('verts',   [])
                indices = data.get('indices', [])
                normals = data.get('normals')   # may be None or []
                if not verts or not indices:
                    _log('preview_mesh: empty verts or indices, clearing')
                    _clear_custom_graphics()
                    return
                _draw_preview_mesh(verts, indices, normals)
                return

            # ── preview_clear: explicit removal of the ghost preview ─────
            if action == 'preview_clear':
                _clear_custom_graphics()
                return

            # ── SVG extrude: create solid body from SVG + depth ──────────
            if action == 'svg_extrude':
                try:
                    data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                except Exception as e:
                    _send_import_error(f'svg_extrude: bad JSON: {e}')
                    return
                self._handle_svg_extrude(data)
                return

            # ── SVG fill: receive tiled SVG, create sketch in Fusion ─────
            if action == 'svg_fill':
                try:
                    data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                except Exception as e:
                    _send_import_error(f'svg_fill: bad JSON: {e}')
                    return
                self._handle_svg_fill(data)
                return

            # Close palette without saving anything.
            if action == 'cancel':
                _log('cancel: hiding palette')
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.isVisible = False
                return

        except Exception:
            tb = traceback.format_exc()
            _log(f'UNHANDLED EXCEPTION in palette handler:\n{tb}')
            if ui:
                ui.messageBox(f'Palette HTML event failed:\n{tb}')

    def _handle_send_to_fusion(self, envelope):
        """Write the supplied STEP text to a temp file and import it as bodies
        in the active Fusion design.

        envelope: { stepText: str, params: { filename?, groupName? } }

        On success: emits `import_success` to JS. On any failure: emits
        `import_error { msg }` so the palette can show a useful status.
        The temp file is deleted on success and kept on failure (for
        post-mortem inspection — the path is in the log).
        """
        try:
            step_text  = envelope.get('stepText', '') or ''
            params     = envelope.get('params', {}) or {}
            filename   = params.get('filename', 'edited.stp')
            group_name = params.get('groupName', 'STEP_Import')

            if not step_text:
                _send_import_error('empty stepText')
                return

            if not step_text.lstrip().startswith('ISO-10303-21'):
                _send_import_error('payload is not a STEP file (missing ISO-10303-21 header)')
                return

            des = adsk.fusion.Design.cast(app.activeProduct)
            if not des:
                _send_import_error('No active Fusion design — open a design first.')
                return

            # 1. Write the temp file. Use NamedTemporaryFile to avoid filename
            #    collisions when the same file is sent multiple times in one
            #    session.
            _send_progress('Writing temp file…')
            safe_filename = ''.join(c for c in filename if c.isalnum() or c in '._-') or 'edited.stp'
            tmp_path = os.path.join(tempfile.gettempdir(), f'step_editor_{os.getpid()}_{safe_filename}')
            try:
                with open(tmp_path, 'w', encoding='utf-8') as f:
                    f.write(step_text)
                _log(f'wrote {len(step_text)} chars to {tmp_path}')
            except Exception as e:
                _send_import_error(f'failed to write temp file: {e}')
                return

            # 2. Create a wrapper occurrence so the imported bodies are
            #    grouped under one node in the design tree. Mirrors the
            #    "B-Spline Set" pattern from b-spline-gen.
            root_comp = des.rootComponent
            group_occ = None
            try:
                group_occ = root_comp.occurrences.addNewComponent(adsk.core.Matrix3D.create())
                group_occ.component.name = group_name
            except Exception as e:
                _send_import_error(f'failed to create import group "{group_name}": {e}')
                return

            # 3. Run the import.
            _send_progress('Importing into Fusion…')
            import_mgr   = app.importManager
            step_options = import_mgr.createSTEPImportOptions(tmp_path)
            step_options.isViewFit = False

            ok = False
            try:
                ok = import_mgr.importToTarget(step_options, group_occ.component)
            except Exception as e:
                _send_import_error(f'importToTarget threw: {e}')
                _safe_delete_occurrence(group_occ)
                return

            if not ok:
                _send_import_error('importToTarget returned False')
                _safe_delete_occurrence(group_occ)
                return

            # 4. Clean up the temp file on success. Keep it on failure
            #    (paths from the log block above stay valid for debugging).
            try:
                os.remove(tmp_path)
            except Exception:
                pass

            _log(f'imported "{filename}" → "{group_name}"')
            try:
                pal = app.userInterface.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('import_success', '{}')
            except Exception:
                pass

        except Exception:
            tb = traceback.format_exc()
            _log(f'_handle_send_to_fusion EXCEPTION:\n{tb}')
            _send_import_error('internal error — see step_editor_log.txt')


    def _handle_tessellate_via_fusion(self, envelope):
        """Fast-path tessellation: write the STEP to a temp file, import into
        a new (throwaway) Fusion document, walk every BRep body, tessellate
        each one at LowQuality via meshManager.createMeshCalculator, then
        close the temp doc WITHOUT saving and reactivate whatever document
        the user was on. Mesh data is shipped back to the palette as
        chunked base64'd Float32/Int32 buffers.

        The user's active design is untouched — no bodies added, no
        timeline entries. This is purely a preview path; the palette's
        in-memory STEP graph remains the source of truth for editing.

        Wire contract (Py → JS):
            tess_result_start  { totalChunks, meshCount, totalBytes,
                                 importMs, tessMs, closeMs }
            tess_result_chunk  { index, data }            × totalChunks
            tess_result_finish {}
        On failure:
            import_error { msg }
        """
        prev_doc = None
        temp_doc = None
        tmp_path = None
        try:
            step_text = envelope.get('stepText', '') or ''
            params    = envelope.get('params', {}) or {}
            filename  = params.get('filename', 'preview.stp')

            if not step_text:
                _send_import_error('tessellate: empty stepText')
                return
            if not step_text.lstrip().startswith('ISO-10303-21'):
                _send_import_error('tessellate: payload is not STEP (no ISO-10303-21 header)')
                return

            # 1. Write temp STEP file. createSTEPImportOptions wants a path on disk.
            _send_progress('Writing temp STEP for native import…')
            safe_filename = ''.join(c for c in filename if c.isalnum() or c in '._-') or 'preview.stp'
            tmp_path = os.path.join(tempfile.gettempdir(), f'step_editor_tess_{os.getpid()}_{safe_filename}')
            with open(tmp_path, 'w', encoding='utf-8') as f:
                f.write(step_text)
            _log(f'tessellate: wrote {len(step_text)} chars to {tmp_path}')

            # 2. Remember the user's active doc so we can bring it back.
            #    importToNewDocument flips the active doc to the new one.
            prev_doc = app.activeDocument

            # 3. Native STEP import into a throwaway doc.
            _send_progress('Importing STEP natively…')
            t0 = time.time()
            opts = app.importManager.createSTEPImportOptions(tmp_path)
            opts.isViewFit = False
            temp_doc = app.importManager.importToNewDocument(opts)
            import_ms = (time.time() - t0) * 1000.0
            if not temp_doc:
                _send_import_error('tessellate: importToNewDocument returned None')
                return

            # 4. Walk every BRep body across every component+occurrence.
            design = temp_doc.products.itemByProductType('DesignProductType')
            if not design:
                _send_import_error('tessellate: imported doc has no Design product')
                return

            bodies = []
            def collect(comp, prefix=''):
                for j in range(comp.bRepBodies.count):
                    b = comp.bRepBodies.item(j)
                    name = f'{prefix}{b.name}' if prefix else b.name
                    bodies.append((name, b))
                for i in range(comp.occurrences.count):
                    occ = comp.occurrences.item(i)
                    # Prefix nested body names so the palette outliner can
                    # distinguish "Body1" in Canoe_grab vs in canoe_plus_paddle.
                    collect(occ.component, prefix=f'{occ.name}/')
            collect(design.rootComponent)

            _log(f'tessellate: {len(bodies)} body(ies) found')

            # 5. Tessellate each body at LowQuality. Pack each into
            #    {name, coords_b64, normals_b64, indices_b64, vertexCount, triCount}.
            _send_progress(f'Tessellating {len(bodies)} body(ies)…')
            t0 = time.time()
            mesh_objs = []
            quality = adsk.fusion.TriangleMeshQualityOptions.LowQualityTriangleMesh

            for body_name, body in bodies:
                try:
                    calc = body.meshManager.createMeshCalculator()
                    calc.setQuality(quality)
                    mesh = calc.calculate()
                    if mesh.triangleCount == 0:
                        continue
                    # Fusion hands us Python tuples — pack as binary then base64.
                    # Coords + normals are float (single precision is plenty
                    # for preview meshes); indices are int (unsigned 32-bit).
                    # array.tobytes() is ~10× faster than struct.pack for big buffers.
                    coords  = mesh.nodeCoordinatesAsFloat
                    normals = mesh.normalVectorsAsFloat
                    indices = mesh.nodeIndices

                    # 'f' is always single-precision float (4 bytes) — guaranteed.
                    # For indices we want explicit uint32 LE so the JS side can read
                    # them as Uint32Array. array.array('I') is "unsigned int" which is
                    # platform-dependent (4 B on Windows, but not guaranteed) — so we
                    # check the itemsize and fall back to 'L' (unsigned long) if 'I'
                    # turns out to be the wrong width.
                    coords_bin  = _array('f', coords).tobytes()
                    normals_bin = _array('f', normals).tobytes()
                    _idx_arr = _array('I', indices)
                    if _idx_arr.itemsize != 4:
                        _idx_arr = _array('L', indices)
                        if _idx_arr.itemsize != 4:
                            import struct
                            indices_bin = struct.pack(f'<{len(indices)}I', *indices)
                        else:
                            indices_bin = _idx_arr.tobytes()
                    else:
                        indices_bin = _idx_arr.tobytes()

                    mesh_objs.append({
                        'name':         body_name,
                        'coords_b64':   base64.b64encode(coords_bin).decode('ascii'),
                        'normals_b64': base64.b64encode(normals_bin).decode('ascii'),
                        'indices_b64': base64.b64encode(indices_bin).decode('ascii'),
                        'vertexCount': mesh.nodeCount,
                        'triCount':    mesh.triangleCount,
                    })
                except Exception as e:
                    _log(f'tessellate: body "{body_name}" failed: {e}')
            tess_ms = (time.time() - t0) * 1000.0

            # 6. Close the temp doc WITHOUT saving so the user's tree stays clean.
            _send_progress('Closing temp doc…')
            t0 = time.time()
            try:
                temp_doc.close(False)
            except Exception as e:
                _log(f'tessellate: temp_doc.close failed: {e}')
            temp_doc = None
            close_ms = (time.time() - t0) * 1000.0

            # 7. Reactivate the user's previous doc. importToNewDocument
            #    leaves the activeDocument pointing at our temp; after
            #    closing it, Fusion may land on whichever doc loaded next.
            try:
                if prev_doc and prev_doc.isValid:
                    prev_doc.activate()
            except Exception as e:
                _log(f'tessellate: prev_doc.activate failed: {e}')

            # 8. Clean up temp STEP file (no longer needed; Fusion has the bodies).
            try:
                os.remove(tmp_path)
            except Exception:
                pass
            tmp_path = None

            # 9. Ship the mesh payload back to JS in 256 KB chunks (same
            #    size as the JS→Py chunked sender — well under Fusion's
            #    sendInfoToHTML practical ceiling).
            payload_str = json.dumps({'meshes': mesh_objs})
            CHUNK = 256 * 1024
            total_chunks = max(1, (len(payload_str) + CHUNK - 1) // CHUNK)
            _log(f'tessellate: import={import_ms:.0f}ms tess={tess_ms:.0f}ms close={close_ms:.0f}ms '
                 f'payload={len(payload_str)}B in {total_chunks} chunk(s) meshes={len(mesh_objs)}')

            pal = app.userInterface.palettes.itemById(PALETTE_ID)
            if not pal:
                _send_import_error('tessellate: palette vanished during import')
                return

            pal.sendInfoToHTML('tess_result_start', json.dumps({
                'totalChunks': total_chunks,
                'meshCount':   len(mesh_objs),
                'totalBytes':  len(payload_str),
                'importMs':    round(import_ms, 1),
                'tessMs':      round(tess_ms, 1),
                'closeMs':     round(close_ms, 1),
            }))
            for i in range(total_chunks):
                chunk = payload_str[i * CHUNK : (i + 1) * CHUNK]
                pal.sendInfoToHTML('tess_result_chunk', json.dumps({
                    'index': i,
                    'data':  chunk,
                }))
            pal.sendInfoToHTML('tess_result_finish', '{}')

        except Exception:
            tb = traceback.format_exc()
            _log(f'_handle_tessellate_via_fusion EXCEPTION:\n{tb}')
            _send_import_error('tessellate: internal error — see step_editor_log.txt')
            # Best-effort cleanup on the error path.
            try:
                if temp_doc and temp_doc.isValid:
                    temp_doc.close(False)
            except Exception:
                pass
            try:
                if prev_doc and prev_doc.isValid:
                    prev_doc.activate()
            except Exception:
                pass
            try:
                if tmp_path and os.path.isfile(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass


    def _handle_svg_fill(self, data):
        """Receive a pre-tiled SVG from the JS side and import it as a sketch
        onto a construction plane that faces the selected surface's normal.

        data keys:
            svg        — SVG markup string (already in Fusion px units, 96 dpi)
            fillW      — fill width  (mm, for logging)
            fillH      — fill height (mm, for logging)
            hitPoint   — {x, y, z} in Three.js / Fusion world coords (mm)
            hitNormal  — {x, y, z} face normal (world space)
            meshName   — body name (for status)
            boxMin/Max — body bounding box (unused for now)
        """
        try:
            svg_text  = data.get('svg', '') or ''
            fill_w    = float(data.get('fillW', 100))
            fill_h    = float(data.get('fillH', 100))
            hit_pt    = data.get('hitPoint',  {})
            hit_nrm   = data.get('hitNormal', {})
            mesh_name = data.get('meshName', '?')

            if not svg_text:
                _send_import_error('svg_fill: empty svg')
                return

            des = adsk.fusion.Design.cast(app.activeProduct)
            if not des:
                _send_import_error('svg_fill: no active Fusion design')
                return

            root = des.rootComponent

            # ── Determine construction plane ──────────────────────────────
            # Choose the XY / XZ / YZ plane based on which component of the
            # face normal has the largest magnitude, then offset that plane
            # to the hit point's coordinate on that axis.
            nx = abs(float(hit_nrm.get('x', 0)))
            ny = abs(float(hit_nrm.get('y', 0)))
            nz = abs(float(hit_nrm.get('z', 0)))

            px = float(hit_pt.get('x', 0))
            py = float(hit_pt.get('y', 0))
            pz = float(hit_pt.get('z', 0))

            # Fusion uses cm internally; the STEP / Three.js world is in mm.
            # Divide by 10 to convert mm → cm for offset values.
            CM = 0.1

            if nx >= ny and nx >= nz:
                base_plane  = root.xZConstructionPlane
                offset_val  = py * CM          # normal along X → offset YZ-like plane at Y
                plane_label = f'X-normal @ Y={py:.1f} mm'
            elif ny >= nx and ny >= nz:
                base_plane  = root.xYConstructionPlane
                offset_val  = pz * CM          # normal along Y → offset XY plane at Z
                plane_label = f'Y-normal @ Z={pz:.1f} mm'
            else:
                base_plane  = root.xYConstructionPlane
                offset_val  = pz * CM          # normal along Z → offset XY plane at Z
                plane_label = f'Z-normal @ Z={pz:.1f} mm'

            _log(f'svg_fill: dominant plane {plane_label}, offset {offset_val:.3f} cm')

            # Create the offset construction plane.
            cp_input = root.constructionPlanes.createInput()
            cp_input.setByOffset(base_plane, adsk.core.ValueInput.createByReal(offset_val))
            cplane   = root.constructionPlanes.add(cp_input)
            cplane.name = f'SVG Fill — {mesh_name}'

            # ── Write the SVG to a temp file ──────────────────────────────
            _send_progress('Writing SVG temp file…')
            tmp_svg = os.path.join(
                tempfile.gettempdir(),
                f'step_editor_svgfill_{os.getpid()}.svg'
            )
            try:
                with open(tmp_svg, 'w', encoding='utf-8') as f:
                    f.write(svg_text)
                _log(f'svg_fill: wrote {len(svg_text)} chars to {tmp_svg}')
            except Exception as e:
                _send_import_error(f'svg_fill: failed to write SVG temp file: {e}')
                return

            # ── Create a sketch on the construction plane and import SVG ──
            _send_progress('Importing SVG into sketch…')
            try:
                sketch = root.sketches.add(cplane)
                sketch.name = f'SVG Fill — {mesh_name} ({fill_w:.0f}×{fill_h:.0f} mm)'

                import_mgr  = app.importManager
                svg_options = import_mgr.createSVGImportOptions(tmp_svg)
                import_mgr.importToTarget(svg_options, sketch)
                _log(f'svg_fill: imported SVG into sketch "{sketch.name}"')
            except Exception as e:
                _send_import_error(f'svg_fill: SVG import failed: {e}')
                return
            finally:
                try:
                    os.remove(tmp_svg)
                except Exception:
                    pass

            # ── Notify JS side ────────────────────────────────────────────
            try:
                pal = app.userInterface.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('import_success', '{}')
            except Exception:
                pass

            _log(f'svg_fill: done — {fill_w}×{fill_h} mm on "{mesh_name}"')

        except Exception:
            tb = traceback.format_exc()
            _log(f'_handle_svg_fill EXCEPTION:\n{tb}')
            _send_import_error('svg_fill: internal error — see step_editor_log.txt')


    def _handle_svg_extrude(self, data):
        """Import an SVG motif into a sketch on a construction plane aligned to
        the selected surface, then extrude it to create real solid body geometry
        in the active Fusion 360 design.

        data keys (same as svg_fill plus):
            depth  — extrusion depth in mm (positive = along surface normal)
            mmW    — motif physical width  (mm) — passed for logging only
            mmH    — motif physical height (mm)
        """
        try:
            svg_text   = data.get('svg', '') or ''
            depth_mm   = float(data.get('depth', 3))
            mmW        = float(data.get('mmW', 100))
            mmH        = float(data.get('mmH', 100))
            hit_pt     = data.get('hitPoint',  {})
            hit_nrm    = data.get('hitNormal', {})
            mesh_name  = data.get('meshName', '?')

            if not svg_text:
                _send_import_error('svg_extrude: empty svg')
                return

            des = adsk.fusion.Design.cast(app.activeProduct)
            if not des:
                _send_import_error('svg_extrude: no active Fusion design')
                return

            root = des.rootComponent

            # ── Construction plane (same dominant-axis logic as svg_fill) ──
            nx = abs(float(hit_nrm.get('x', 0)))
            ny = abs(float(hit_nrm.get('y', 0)))
            nz = abs(float(hit_nrm.get('z', 0)))

            px = float(hit_pt.get('x', 0))
            py = float(hit_pt.get('y', 0))
            pz = float(hit_pt.get('z', 0))

            CM = 0.1   # mm → cm

            if nx >= ny and nx >= nz:
                base_plane  = root.xZConstructionPlane
                offset_val  = py * CM
                plane_label = f'X-normal @ Y={py:.1f} mm'
            elif ny >= nx and ny >= nz:
                base_plane  = root.xYConstructionPlane
                offset_val  = pz * CM
                plane_label = f'Y-normal @ Z={pz:.1f} mm'
            else:
                base_plane  = root.xYConstructionPlane
                offset_val  = pz * CM
                plane_label = f'Z-normal @ Z={pz:.1f} mm'

            _log(f'svg_extrude: plane {plane_label}, depth {depth_mm} mm, motif {mmW}×{mmH} mm')

            cp_input = root.constructionPlanes.createInput()
            cp_input.setByOffset(base_plane, adsk.core.ValueInput.createByReal(offset_val))
            cplane   = root.constructionPlanes.add(cp_input)
            cplane.name = f'SVG Extrude — {mesh_name}'

            # ── Write SVG temp file ────────────────────────────────────────
            _send_progress('Writing SVG temp file…')
            tmp_svg = os.path.join(
                tempfile.gettempdir(),
                f'step_editor_extrude_{os.getpid()}.svg'
            )
            try:
                with open(tmp_svg, 'w', encoding='utf-8') as f:
                    f.write(svg_text)
                _log(f'svg_extrude: wrote {len(svg_text)} chars to {tmp_svg}')
            except Exception as e:
                _send_import_error(f'svg_extrude: failed to write SVG: {e}')
                return

            # ── Create sketch and import SVG ───────────────────────────────
            _send_progress('Creating sketch…')
            try:
                sketch = root.sketches.add(cplane)
                sketch.name = f'SVG Extrude — {mesh_name}'

                import_mgr  = app.importManager
                svg_options = import_mgr.createSVGImportOptions(tmp_svg)
                import_mgr.importToTarget(svg_options, sketch)
                _log(f'svg_extrude: imported SVG into sketch "{sketch.name}"')
            except Exception as e:
                _send_import_error(f'svg_extrude: SVG sketch import failed: {e}')
                return
            finally:
                try:
                    os.remove(tmp_svg)
                except Exception:
                    pass

            # ── Find closed profiles and extrude ──────────────────────────
            _send_progress('Extruding profiles…')
            profile_count = sketch.profiles.count
            if profile_count == 0:
                _send_import_error(
                    'svg_extrude: no closed profiles found. '
                    'Draw closed shapes (rect, ellipse, closed polyline) in the motif editor.'
                )
                return

            _log(f'svg_extrude: {profile_count} profile(s) found, extruding {depth_mm} mm')

            depth_cm  = depth_mm * CM   # Fusion internal units = cm
            dist_val  = adsk.core.ValueInput.createByReal(depth_cm)
            ext_feats = root.features.extrudeFeatures
            bodies_created = 0

            for i in range(profile_count):
                profile = sketch.profiles.item(i)
                try:
                    ext_input = ext_feats.createInput(
                        profile,
                        adsk.fusion.FeatureOperations.NewBodyFeatureOperation
                    )
                    extent = adsk.fusion.DistanceExtentDefinition.create(dist_val)
                    ext_input.setOneSideExtent(
                        extent,
                        adsk.fusion.ExtentDirections.PositiveExtentDirection
                    )
                    feat = ext_feats.add(ext_input)
                    if feat and feat.bodies.count > 0:
                        feat.bodies.item(0).name = f'SVG Extrude {i+1} — {mesh_name}'
                    bodies_created += 1
                    _log(f'svg_extrude: profile {i+1} extruded OK')
                except Exception as e:
                    _log(f'svg_extrude: profile {i+1} extrude failed: {e}')
                    # Continue with remaining profiles.

            if bodies_created == 0:
                _send_import_error(
                    'svg_extrude: all extrude attempts failed. '
                    'Profiles may be self-intersecting or too small.'
                )
                return

            # ── Success ───────────────────────────────────────────────────
            try:
                pal = app.userInterface.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('import_success', '{}')
            except Exception:
                pass

            _log(f'svg_extrude: done — {bodies_created}/{profile_count} bodies on "{mesh_name}"')

        except Exception:
            tb = traceback.format_exc()
            _log(f'_handle_svg_extrude EXCEPTION:\n{tb}')
            _send_import_error('svg_extrude: internal error — see step_editor_log.txt')


def _safe_delete_occurrence(occ):
    """Delete an occurrence we just created if a subsequent import failed,
    so failed-import attempts don't leave empty wrapper components lying
    around the design tree. Failure to delete is logged but otherwise
    swallowed — leaving a stale empty group is preferable to crashing
    on the error-recovery path."""
    if occ is None:
        return
    try:
        if occ.isValid:
            occ.deleteMe()
    except Exception as e:
        _log(f'_safe_delete_occurrence failed: {e}')


# ── Command constants ─────────────────────────────────────────────────────────
COMMAND_ID      = 'stepEditorCommand'
COMMAND_NAME    = 'STEP Editor'
COMMAND_TOOLTIP = 'Open, view, edit, sculpt, and merge STEP (.stp) files'


# ── CommandExecuteHandler — opens / shows the palette ────────────────────────
class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        """Show the STEP Editor palette. Creates it from the canonical
        in-tree HTML path the first time; on subsequent clicks just
        makes the existing palette visible again.

        Cache-busting via timestamped subfolder was attempted and
        reverted — Fusion's palette webview only injects `window.adsk`
        (and only allows external CDN scripts) when the HTML loads
        from the addin's original registered path. Loading from a
        sibling folder breaks both. The query-string cache-bust trick
        below sidesteps both issues: Fusion still resolves the file
        path correctly (so window.adsk + CDN script tags work), and
        the webview treats `…?v=12345` as a different URL than its
        previous load, forcing a hard reload of HTML + every JS
        module without restarting Fusion.

        Python edits hot-reload via the bspline reload cmd."""
        try:
            global importing_done, chunk_buffer
            palettes = ui.palettes
            palette  = palettes.itemById(PALETTE_ID)
            if not palette:
                addin_dir = os.path.dirname(os.path.realpath(__file__))
                html_path = os.path.join(addin_dir, PALETTE_HTML).replace('\\', '/')
                _log(f'Creating palette, html_path={html_path}')
                palette = palettes.add(
                    PALETTE_ID, PALETTE_NAME, html_path,
                    True, True, True, 1000, 850
                )
                palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight

                onHTMLEvent = PaletteHTMLEventHandler()
                palette.incomingFromHTML.add(onHTMLEvent)
                handlers.append(onHTMLEvent)

                onClosed = PaletteClosedHandler()
                palette.closed.add(onClosed)
                handlers.append(onClosed)
                _log('Palette created/wired (HTML + Closed events)')
            else:
                _log('Palette exists — making visible and resetting UI state')
                importing_done = False
                chunk_buffer = []
                palette.isVisible = True
                palette.sendInfoToHTML('reset_ui', '{}')
        except Exception:
            tb = traceback.format_exc()
            _log(f'CommandExecute FAILED:\n{tb}')
            if ui:
                ui.messageBox(f'STEP Editor Execute Failed:\n{tb}')


# ── CommandCreatedHandler ─────────────────────────────────────────────────────
class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            command   = args.command
            onExecute = CommandExecuteHandler()
            command.execute.add(onExecute)
            handlers.append(onExecute)
        except Exception:
            tb = traceback.format_exc()
            _log(f'CommandCreated FAILED:\n{tb}')


# ── Shared B-Spline Builder panel constants ──────────────────────────────────
# Mirrors fusion-exporter.py / fusion-inspector.py / template-maker.py so all
# four consolidated sub-add-ins land in the SAME panel and dropdown. Listed
# under "Fusion Export, Fusion Inspector, Template Maker, …" in the screenshot.
SHARED_PANEL_ID   = 'bsplinePanel'
SHARED_PANEL_NAME = 'B-Spline Builder'
TARGET_TAB_IDS    = ('SolidTab', 'SketchTab', 'MillingTab')


# ── run ───────────────────────────────────────────────────────────────────────
def run(context):
    """Registered as a sub-module by bspline-frame-builder.py — its main
    run() calls ours after the core add-in is set up. Adds the STEP Editor
    button to the shared B-Spline Builder panel on every workspace that
    hosts one.

    Promotion: the command lands UN-promoted, so it shows up only in the
    panel's dropdown (alongside Fusion Export, Inspector, Template Maker)
    rather than taking a slot in the always-visible row. Easy to change
    later — flip the two `isPromoted` flags below to True.
    """
    try:
        _log('--- SESSION STARTED ---')
        global ui
        if ui is None:
            ui = adsk.core.Application.get().userInterface
        cmd_defs = ui.commandDefinitions

        # Defensive cleanup — if a previous session left a palette behind
        # (which happened with the older bspline-frame-builder.py builds
        # that didn't yet have step-editor in their _teardown_submodules
        # list), nuke it now so this run() starts from a clean slate.
        try:
            stale_pal = ui.palettes.itemById(PALETTE_ID)
            if stale_pal:
                stale_pal.deleteMe()
                _log('Cleaned up stale palette from prior session')
        except Exception:
            _log(f'Stale palette cleanup failed:\n{traceback.format_exc()}')

        # 1. Defensive cleanup — drop any stale control from a previous load
        #    BEFORE we delete the command definition, otherwise Fusion can
        #    return apiCmdDef errors trying to remove a def with a live ctrl.
        for panel in ui.allToolbarPanels:
            try:
                ctrl = panel.controls.itemById(COMMAND_ID)
                if ctrl:
                    ctrl.deleteMe()
            except Exception:
                pass

        existing_def = cmd_defs.itemById(COMMAND_ID)
        if existing_def:
            try:
                existing_def.deleteMe()
            except Exception:
                pass

        # 2. Create the command definition. The icon folder uses the French
        #    spelling 'ressources' to match the on-disk layout the user
        #    created. Fusion accepts either — it just passes the path
        #    verbatim and looks for 16x16.png / 32x32.png / 64x64.png inside.
        res_folder = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'ressources')
        cmd_def = cmd_defs.addButtonDefinition(COMMAND_ID, COMMAND_NAME, COMMAND_TOOLTIP, res_folder)

        onCommandCreated = CommandCreatedHandler()
        cmd_def.commandCreated.add(onCommandCreated)
        handlers.append(onCommandCreated)

        # 3. Add the command to the shared B-Spline Builder panel on every
        #    target tab. Iteration model copied from fusion-exporter.py.
        for tab_id in TARGET_TAB_IDS:
            tab = ui.allToolbarTabs.itemById(tab_id)
            if not tab:
                # Fallback fuzzy lookup — some Fusion builds rename SolidTab.
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

            new_ctrl = panel.controls.addCommand(cmd_def)
            try:
                # Promoted: the STEP Editor button now sits in the visible
                # toolbar row of the B-Spline Builder panel on every target
                # tab (Solid, Sketch, Milling) instead of hiding inside the
                # dropdown. Set both flags so the button persists across
                # Fusion sessions (isPromotedByDefault writes into the
                # user's UI customisation file).
                new_ctrl.isPromoted = True
                new_ctrl.isPromotedByDefault = True
            except Exception:
                pass

        _log('--- run() complete — STEP Editor installed in B-Spline Builder panel ---')

    except Exception:
        tb = traceback.format_exc()
        _log(f'run() EXCEPTION:\n{tb}')
        if ui:
            ui.messageBox(f'STEP Editor run failed:\n{tb}')


# ── stop ──────────────────────────────────────────────────────────────────────
def stop(context):
    """Mirror of run() — remove the button from every panel it lives in,
    then drop the command definition. The palette (if open) is also
    cleaned up so a subsequent run() loads HTML from disk fresh.

    Each step pyLogs whether it found something to clean and whether the
    teardown succeeded, so the log file shows exactly where teardown
    went off the rails (if it does)."""
    try:
        _log('--- SESSION STOPPED ---')
        global ui
        if ui is None:
            ui = adsk.core.Application.get().userInterface

        # 1. Hide and drop the palette if it's around.
        try:
            palette = ui.palettes.itemById(PALETTE_ID)
            if palette:
                palette.deleteMe()
                _log('stop: palette deleted')
            else:
                _log('stop: no palette to delete')
        except Exception:
            _log(f'stop: palette deleteMe FAILED\n{traceback.format_exc()}')

        # 2. Sweep every panel for our control. Costs a few ms; saves us
        #    from having to track which tabs we landed in.
        removed = 0
        for panel in ui.allToolbarPanels:
            try:
                cntrl = panel.controls.itemById(COMMAND_ID)
                if cntrl:
                    cntrl.deleteMe()
                    removed += 1
            except Exception:
                pass
        _log(f'stop: removed {removed} toolbar control(s)')

        # 3. Drop the command definition itself.
        try:
            cmd_def = ui.commandDefinitions.itemById(COMMAND_ID)
            if cmd_def:
                cmd_def.deleteMe()
                _log('stop: command definition deleted')
            else:
                _log('stop: no command definition to delete')
        except Exception:
            _log(f'stop: cmd_def deleteMe FAILED\n{traceback.format_exc()}')

        # 4. Cleanup any cache-busted palette folders left behind. Best
        #    effort — locked folders survive and get cleaned next time.
        try:
            addin_dir = os.path.dirname(os.path.realpath(__file__))
            _cleanup_old_palette_dirs(addin_dir)
        except Exception:
            pass

    except Exception:
        tb = traceback.format_exc()
        _log(f'stop() EXCEPTION:\n{tb}')
        if ui:
            ui.messageBox(f'STEP Editor stop failed:\n{tb}')
