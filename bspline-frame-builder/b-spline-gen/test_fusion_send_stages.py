"""
F35 item 70, the add-in side: each step of a Send is reported to the palette by its DECLARED id ('import_stage' {id})
from html/data/fusion-send-stages.js -- the one file the palette imports too. Never for a preview, never an id the
palette would not know. The palette side: tests/fusion-send-stages.test.js.
"""
import json
import os
import re
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402  (same adsk stubs + loader)


def _fake_palette(monkeypatch):
    sent, logged = [], []
    pal = types.SimpleNamespace(sendInfoToHTML=lambda action, data: sent.append((action, json.loads(data))))
    ui = types.SimpleNamespace(palettes=types.SimpleNamespace(itemById=lambda _id: pal))
    monkeypatch.setattr(bsg, 'app', types.SimpleNamespace(userInterface=ui))
    monkeypatch.setattr(bsg, '_log', lambda msg: logged.append(msg))
    # every post lets the palette paint at once (adsk.doEvents): recorded in the same list, in order
    monkeypatch.setattr(bsg.adsk, 'doEvents', lambda: sent.append(('doEvents', None)), raising=False)
    return sent, logged


def test_the_add_in_reads_the_palettes_own_declaration():
    with open(bsg.FUSION_SEND_STAGES_FILE, encoding='utf-8') as f:
        src = f.read()
    ids_in_file = re.findall(r'"id":\s*"([^"]+)"', src)
    assert bsg._fusion_send_stage_ids(bsg.FUSION_SEND_STAGES_FILE) == ids_in_file
    assert ids_in_file[0] == 'fusionPrepare' and ids_in_file[-1] == 'fusionFinalize'


def test_a_declared_stage_is_sent_by_id(monkeypatch):
    sent, _ = _fake_palette(monkeypatch)
    for sid in bsg._fusion_send_stage_ids():
        bsg._send_stage(sid)
    assert sent == [x for sid in bsg._fusion_send_stage_ids() for x in (('import_stage', {'id': sid}), ('doEvents', None))]


def test_a_progress_message_is_painted_at_once_too(monkeypatch):
    sent, _ = _fake_palette(monkeypatch)
    bsg._send_progress('Building the frame...')
    assert sent == [('import_progress', {'msg': 'Building the frame...'}), ('doEvents', None)]


def test_never_for_a_preview_and_never_an_undeclared_id(monkeypatch):
    sent, logged = _fake_palette(monkeypatch)
    bsg._send_stage('fusionFrame', is_preview=True)
    bsg._send_stage('fusionSomethingNew')
    assert sent == []
    assert any('undeclared stage id' in m for m in logged)


def test_every_stage_the_send_reports_is_declared():
    # the ids _handle_generate passes to _send_stage, read from the source: each must be in the declaration
    with open(os.path.join(_HERE, 'b-spline-gen.py'), encoding='utf-8') as f:
        used = set(re.findall(r"_send_stage\('([A-Za-z]+)'", f.read()))
    assert used, 'no _send_stage call found'
    assert used <= set(bsg._fusion_send_stage_ids())
    assert used == set(bsg._fusion_send_stage_ids()), 'a declared stage the Send never reports'
