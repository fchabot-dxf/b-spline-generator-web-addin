"""
Template Maker — Selection-driven code preview for frame template creation.
"""

import importlib
import adsk.core, adsk.fusion, traceback, os, json, subprocess, sys, shutil

_handlers = []
_html_handler = None
_doc_activated_handler = None
_last_sel_ids = ""
_latest_payload = ""
_latest_phase_id = 'p01'
_latest_sketch_name = ''
_latest_template_number = 'T2'

PALETTE_ID = 'TemplateMaker_Palette'
CMD_ID = 'TemplateMaker_Command'
PANEL_ID = 'TemplateMaker_Panel'

_current_dir = os.path.dirname(os.path.realpath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)
import template_generator
import template_payload
import template_code
import expression_coords
from rename_selection import rename_selection

PALETTE_URL = os.path.join(_current_dir, 'template_maker_palette.html').replace('\\', '/')
RESOURCES_PATH = os.path.join(_current_dir, 'ressources')


def _cleanup_cache_files(directory):
    try:
        if not directory or not os.path.isdir(directory):
            return
        for root, dirs, files in os.walk(directory, topdown=False):
            for name in files:
                if name.endswith('.pyc'):
                    try:
                        os.remove(os.path.join(root, name))
                    except Exception:
                        pass
            for name in dirs:
                if name == '__pycache__':
                    try:
                        shutil.rmtree(os.path.join(root, name))
                    except Exception:
                        pass
    except Exception:
        pass


def get_log_path():
    try:
        return os.path.join(_current_dir, 'template-maker-debug.log')
    except Exception:
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'template-maker-debug.log')


def _log(msg):
    try:
        with open(get_log_path(), 'a', encoding='utf-8') as f:
            f.write(f"{msg}\n")
    except Exception:
        pass


def _reload_modules():
    try:
        for mod in (expression_coords, template_payload, template_code, template_generator):
            importlib.reload(mod)
    except Exception:
        pass


class _SelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    def notify(self, args):
        try:
            _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


class _DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    def notify(self, args):
        try:
            _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


def _get_phase_prefix():
    if _latest_phase_id and _latest_sketch_name:
        return f'{_latest_phase_id}_{_latest_sketch_name}'
    if _latest_phase_id:
        return _latest_phase_id
    return _latest_sketch_name or None


def _get_phase_name():
    if _latest_phase_id and _latest_sketch_name:
        return f'{_latest_phase_id}_{_latest_sketch_name}'
    return _latest_sketch_name or _latest_phase_id or 'Generated Phase'


def _push_selection_to_palette():
    global _last_sel_ids, _latest_payload
    app = adsk.core.Application.get()
    ui = app.userInterface
    palette = ui.palettes.itemById(PALETTE_ID)
    if not palette or not palette.isValid or not palette.isVisible:
        return

    doc = app.activeDocument
    doc_key = ''
    try:
        if doc:
            doc_key = getattr(doc, 'fullFilename', None) or getattr(doc, 'name', None) or str(doc)
    except Exception:
        doc_key = ''

    sels = ui.activeSelections
    count = sels.count if sels else 0
    entities = []
    current_ids = f'{doc_key}|'

    if count > 0:
        for i in range(count):
            try:
                ent = sels.item(i).entity
                if ent:
                    entities.append(ent)
                    key = getattr(ent, 'entityToken', None)
                    if not key and hasattr(ent, 'tempId'):
                        key = ent.tempId
                    current_ids += str(key or id(ent)) + '|'
            except Exception:
                pass

    if current_ids == _last_sel_ids and _last_sel_ids != '':
        return
    _last_sel_ids = current_ids

    payload = template_generator.build_template_payload(
        entities,
        phase_prefix=_get_phase_prefix(),
        phase_id=_latest_phase_id,
        phase_name=_get_phase_name(),
        template_number=_latest_template_number
    )
    _latest_payload = json.dumps(payload)
    try:
        palette.sendInfoToHTML('update', _latest_payload)
    except Exception as e:
        _log(f"[ERROR] sendInfoToHTML failed: {e}")


class _HTMLEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        html_args = adsk.core.HTMLEventArgs.cast(args)
        action = html_args.action
        if action == 'poll':
            html_args.returnData = _latest_payload
        elif action == 'copy':
            try:
                payload = html_args.data or ''
                proc = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=False)
                proc.communicate(input=payload.encode('utf-8'))
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_COPY] {e}")
                html_args.returnData = 'error'
        elif action == 'settings':
            try:
                data = html_args.data or ''
                if isinstance(data, str):
                    data = json.loads(data)
                global _latest_phase_id, _latest_sketch_name, _latest_template_number, _last_sel_ids
                _latest_phase_id = str(data.get('phaseId', '') or 'p01')
                _latest_sketch_name = str(data.get('sketchName', '') or '')
                _latest_template_number = str(data.get('templateNumber', '') or 'T2')
                _last_sel_ids = ''
                _push_selection_to_palette()
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_SETTINGS] {e}")
                html_args.returnData = 'error'
        elif action == 'rename':
            try:
                data = html_args.data or ''
                if isinstance(data, str):
                    data = json.loads(data)
                global _latest_phase_id, _latest_sketch_name, _latest_template_number, _last_sel_ids
                _latest_phase_id = str(data.get('phaseId', '') or 'p01')
                _latest_sketch_name = str(data.get('sketchName', '') or '')
                _latest_template_number = str(data.get('templateNumber', '') or 'T2')
                app = adsk.core.Application.get()
                ui = app.userInterface
                sels = ui.activeSelections
                entities = []
                if sels:
                    for i in range(sels.count):
                        try:
                            ent = sels.item(i).entity
                            if ent:
                                entities.append(ent)
                        except Exception:
                            pass
                renamed = rename_selection(entities, phase_prefix=_get_phase_prefix())
                if renamed > 0:
                    _last_sel_ids = ''
                    _push_selection_to_palette()
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_RENAME] {e}")
                html_args.returnData = 'error'
        else:
            html_args.returnData = ''


class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        global _html_handler
        app = adsk.core.Application.get()
        ui = app.userInterface
        palette = ui.palettes.itemById(PALETTE_ID)
        if not palette:
            palette = ui.palettes.add(PALETTE_ID, 'Template Maker', PALETTE_URL, True, True, True, 360, 700)

        if not _html_handler:
            _html_handler = _HTMLEventHandler()
            try:
                palette.incomingFromHTML.add(_html_handler)
                _handlers.append(_html_handler)
            except Exception as e:
                _log(f"[ERROR] Failed to add HTML event handler: {e}")

        palette.isVisible = True


def run(context):
    try:
        _reload_modules()
        app = adsk.core.Application.get()
        ui = app.userInterface

        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()

        cmd_def = ui.commandDefinitions.addButtonDefinition(CMD_ID, 'Template Maker', 'Launch the selection-driven template code generator.', RESOURCES_PATH)
        handler = CommandCreatedHandler()
        cmd_def.commandCreated.add(handler)
        _handlers.append(handler)

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
                        panel = tab.toolbarPanels.add(PANEL_ID, 'TEMPLATE', '', False)
                    if not panel.controls.itemById(CMD_ID):
                        panel.controls.addCommand(cmd_def)
            except Exception:
                pass

        sel_handler = _SelectionChangedHandler()
        ui.activeSelectionChanged.add(sel_handler)
        _handlers.append(sel_handler)

        global _doc_activated_handler
        try:
            if _doc_activated_handler:
                app.documentActivated.remove(_doc_activated_handler)
        except Exception:
            pass
        _doc_activated_handler = _DocumentActivatedHandler()
        app.documentActivated.add(_doc_activated_handler)
        _handlers.append(_doc_activated_handler)
    except Exception:
        _log(traceback.format_exc())


def stop(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        palette = ui.palettes.itemById(PALETTE_ID)
        if palette:
            palette.deleteMe()

        for ws_id in ['FusionSolidEnvironment', 'SolidEnvironment', 'SketchEnvironment']:
            ws = ui.workspaces.itemById(ws_id)
            if ws:
                for tab in ws.toolbarTabs:
                    panel = tab.toolbarPanels.itemById(PANEL_ID)
                    if panel:
                        ctrl = panel.controls.itemById(CMD_ID)
                        if ctrl:
                            ctrl.deleteMe()
                        if panel.controls.count == 0:
                            panel.deleteMe()

        global _doc_activated_handler
        try:
            if _doc_activated_handler:
                app.documentActivated.remove(_doc_activated_handler)
        except Exception:
            pass
        _doc_activated_handler = None

        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()

        # Remove runtime cache files left by Python execution
        _cleanup_cache_files(_current_dir)
    except Exception:
        pass
