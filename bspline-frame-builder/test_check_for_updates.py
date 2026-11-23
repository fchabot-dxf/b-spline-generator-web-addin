"""
"Check for updates" inside the add-in (Fred 2026-11-22). bspline-frame-builder.py is loaded with a fake adsk and its
_addin_root pointed at a temp AddIns/bspline-frame-builder; the release is a local latest.json + zip (file://).
What it must do: never install without the user's Yes; on Yes download, verify, swap, then delete every palette object
(the measured stale-palette trap) and say how to restart. The real Fusion run is a live check with Fred.
"""
import hashlib
import importlib.util
import json
import os
import sys
import types
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, _HERE)
NAME = 'bspline-frame-builder'
YES, NO = 2, 3


def _install_fake_adsk():
    adsk = types.ModuleType('adsk')
    adsk.core = types.ModuleType('adsk.core')
    adsk.fusion = types.ModuleType('adsk.fusion')
    adsk.cam = types.ModuleType('adsk.cam')
    for base in ('CustomEventHandler', 'CommandCreatedEventHandler', 'CommandEventHandler'):
        setattr(adsk.core, base, type(base, (), {'__init__': lambda self: None}))
    adsk.core.MessageBoxButtonTypes = SimpleNamespace(YesNoButtonType='YesNo')
    adsk.core.MessageBoxIconTypes = SimpleNamespace(QuestionIconType='Question')
    adsk.core.DialogResults = SimpleNamespace(DialogYes=YES, DialogNo=NO)
    adsk.doEvents = lambda: None
    sys.modules.update({'adsk': adsk, 'adsk.core': adsk.core, 'adsk.fusion': adsk.fusion, 'adsk.cam': adsk.cam})


def _load():
    _install_fake_adsk()
    spec = importlib.util.spec_from_file_location('bsfb_updates_under_test', os.path.join(_HERE, f'{NAME}.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakePalette:
    def __init__(self, log, pid):
        self.log, self.pid = log, pid

    def deleteMe(self):
        self.log.append(self.pid)


class FakeUI:
    def __init__(self, answer):
        self.answer, self.messages, self.deleted, self.progress = answer, [], [], []
        self.palettes = SimpleNamespace(itemById=lambda pid: FakePalette(self.deleted, pid))

    def messageBox(self, text, title='', buttons=None, icon=None):
        self.messages.append((text, buttons))
        return self.answer if buttons == 'YesNo' else 0

    def createProgressDialog(self):
        ui = self

        class Dlg:
            isCancelButtonShown = True

            def show(self, *a):
                ui.progress.append('show')

            def hide(self):
                ui.progress.append('hide')

            @property
            def progressValue(self):
                return 0

            @progressValue.setter
            def progressValue(self, v):
                ui.progress.append(v)
        return Dlg()


def _stamp(built_at, sha):
    return {'version': '2026.11.22-1', 'sha': sha, 'branch': 'main', 'built_at': built_at, 'source_root': '', 'dirty': False}


@pytest.fixture
def setup(tmp_path):
    addins = tmp_path / 'AddIns'
    live = addins / NAME
    live.mkdir(parents=True)
    (live / f'{NAME}.py').write_text('# old\n', encoding='utf-8')
    (live / f'{NAME}.manifest').write_text('{\n    "runOnStartup": true\n}\n', encoding='utf-8')
    (live / 'build-info.json').write_text(json.dumps(_stamp('2026-11-01T09:00:00-05:00', 'old0000')), encoding='utf-8')
    rel = tmp_path / 'release'
    rel.mkdir()
    z = rel / f'{NAME}.zip'
    new = _stamp('2026-11-22T09:00:00-05:00', 'new1111')
    with zipfile.ZipFile(z, 'w') as zf:
        zf.writestr(f'{NAME}/{NAME}.py', '# new\n')
        zf.writestr(f'{NAME}/{NAME}.manifest', '{\n    "runOnStartup": false\n}\n')
        zf.writestr(f'{NAME}/build-info.json', json.dumps(new))
    latest = dict(new, zip_url=z.as_uri(), sha256=hashlib.sha256(z.read_bytes()).hexdigest(), size=z.stat().st_size)
    (rel / 'latest.json').write_text(json.dumps(latest), encoding='utf-8')
    mod = _load()
    mod._addin_root = str(live)
    for attr, pid in (('_bs', 'fusionHybridPalette'), ('_fb_sketch', 'frameSketchBuilderPalette'),
                      ('_cam', 'CamBuilder_Palette'), ('_st', 'stampEditorPalette')):
        setattr(mod, attr, SimpleNamespace(PALETTE_ID=pid))
    return mod, live, (rel / 'latest.json').as_uri()


def test_no_means_nothing_is_installed(setup):
    mod, live, url = setup
    ui = FakeUI(NO)
    assert mod._check_for_updates(ui, latest_url=url) == 'declined'
    assert ui.messages[0][1] == 'YesNo' and 'newer build' in ui.messages[0][0]
    assert 'new1111' in ui.messages[0][0] and 'old0000' in ui.messages[0][0]
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# old\n'
    assert ui.deleted == []
    assert sorted(p.name for p in live.parent.iterdir()) == [NAME]


def test_yes_installs_closes_every_palette_and_says_how_to_restart(setup):
    mod, live, url = setup
    ui = FakeUI(YES)
    assert mod._check_for_updates(ui, latest_url=url) == 'installed'
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# new\n'
    assert json.loads((live / f'{NAME}.manifest').read_text(encoding='utf-8'))['runOnStartup'] is True   # kept
    assert ui.deleted == ['fusionHybridPalette', 'frameSketchBuilderPalette', 'CamBuilder_Palette', 'stampEditorPalette']
    assert ui.progress[0] == 'show' and ui.progress[-1] == 'hide' and 100 in ui.progress
    done = ui.messages[-1][0]
    assert 'restart Fusion' in done and 'Stop, then Run' in done and '.bak-' in done


def test_current_build_just_says_so(setup):
    mod, live, url = setup
    (live / 'build-info.json').write_text(json.dumps(_stamp('2026-11-22T09:00:00-05:00', 'new1111')), encoding='utf-8')
    ui = FakeUI(YES)
    assert mod._check_for_updates(ui, latest_url=url) == 'current'
    assert len(ui.messages) == 1 and ui.messages[0][1] is None and 'newest build' in ui.messages[0][0]


def test_offline_is_a_message_not_a_crash(setup, tmp_path):
    mod, live, _ = setup
    ui = FakeUI(YES)
    assert mod._check_for_updates(ui, latest_url=(tmp_path / 'missing.json').as_uri()) == 'error'
    assert 'Could not check for updates' in ui.messages[0][0]


def test_the_command_is_declared_in_the_panel_table_off_the_panel_face(setup):
    mod, _, _ = setup
    cmd = next(c for c in mod._commands() if c['id'] == mod.UPDATE_COMMAND_ID)
    assert cmd['promoted'] is False and cmd['name'] == 'Check for updates'
    real_res = Path(_HERE) / 'resources' / 'UpdateCommand'
    assert Path(cmd['res_path']).name == 'UpdateCommand'
    for size in ('16x16.png', '32x32.png'):
        assert (real_res / size).read_bytes().startswith(b'\x89PNG')
    assert mod.UPDATE_COMMAND_ID in mod.OWN_COMMAND_IDS       # purged by run(), removed by stop()
