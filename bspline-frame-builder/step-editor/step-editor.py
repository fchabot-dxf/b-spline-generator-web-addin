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
import os, json, shutil, tempfile, datetime

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
                self._handle_send_to_fusion(envelope)
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
        sibling folder breaks both. Restart Fusion to pick up HTML/JS
        changes; Python edits hot-reload via the bspline reload cmd."""
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
                # Lives in the B-Spline Builder dropdown only — same default
                # as fusion-exporter after its recent un-promote. The STEP
                # editor isn't a primary workflow command for most sessions.
                new_ctrl.isPromoted = False
                new_ctrl.isPromotedByDefault = False
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
