import json
import subprocess
import traceback
import adsk.core
import adsk.fusion
from template_generator import build_template_payload
from rename_selection import rename_selection

_latest_payload = ''
_last_sel_ids = ''
_latest_phase_id = 'p01'
_latest_sketch_name = ''
_latest_template_number = 'T2'


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
    palette = ui.palettes.itemById('TemplateMaker_Palette')
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

    payload = build_template_payload(
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


def _log(msg):
    try:
        with open('template-maker-debug.log', 'a', encoding='utf-8') as f:
            f.write(f"{msg}\n")
    except Exception:
        pass


class SelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    def notify(self, args):
        try:
            _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


class DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    def notify(self, args):
        try:
            _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


class HTMLEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        global _latest_phase_id, _latest_sketch_name, _latest_template_number, _last_sel_ids
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
