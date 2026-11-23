"""
The website's one-click installers (Fred 2026-11-22): install-bspline-addin.cmd (Windows, inline PowerShell) and
install-bspline-addin.command (macOS bash). Each run here targets a temp AddIns folder (BSPLINE_ADDINS_DIR) and a
local zip built by release.py's own build_addin_release (file:// stands in for https) -- never the real AddIns folder.
Hidden processes only (CREATE_NO_WINDOW).
"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CMD = HERE / 'install-bspline-addin.cmd'
COMMAND = HERE / 'install-bspline-addin.command'
NAME = 'bspline-frame-builder'

sys.path.insert(0, str(REPO / 'bspline-frame-builder'))
from fb_shared import updater  # noqa: E402

_spec = importlib.util.spec_from_file_location('release_script', REPO / 'release.py')
release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release)

STAMP = {'version': '2026.11.22-1', 'sha': 'abc1234', 'branch': 'main', 'built_at': '2026-11-22T21:30:05-05:00',
         'source_root': '', 'dirty': False}
MANIFEST = '{\r\n    "id": "bspline-frame-builder",\r\n    "runOnStartup": false,\r\n    "entry": "bspline-frame-builder.py"\r\n}\r\n'
NO_WINDOW = 0x08000000 if sys.platform == 'win32' else 0


def _git_bash():
    if sys.platform != 'win32':
        return shutil.which('bash')
    git = shutil.which('git')
    if git:
        for cand in (Path(git).parent.parent / 'bin' / 'bash.exe', Path(git).parent / 'bash.exe'):
            if cand.exists():
                return str(cand)
    return None          # never WSL's System32\bash.exe: it can't see these paths


BASH = _git_bash()
RUNNERS = []
if sys.platform == 'win32':
    RUNNERS.append('cmd')
if BASH:
    RUNNERS.append('bash')


@pytest.fixture
def release_dir(tmp_path):
    """A release built the real way (release.build_addin_release) from a small add-in tree."""
    src = tmp_path / 'src' / NAME
    (src / 'b-spline-gen').mkdir(parents=True)
    (src / f'{NAME}.py').write_text('# entry new\n', encoding='utf-8')
    (src / f'{NAME}.manifest').write_bytes(MANIFEST.encode('utf-8'))
    (src / 'b-spline-gen' / 'b-spline-gen.py').write_text('# sub new\n', encoding='utf-8')
    out = tmp_path / 'release-out'
    release.build_addin_release(str(src), str(out), STAMP)
    return out


@pytest.fixture
def addins(tmp_path):
    a = tmp_path / 'AddIns'
    live = a / NAME
    live.mkdir(parents=True)
    (live / f'{NAME}.py').write_text('# entry old\n', encoding='utf-8')
    (live / f'{NAME}.manifest').write_bytes(MANIFEST.encode('utf-8'))
    (live / 'old-only.js').write_text('// old\n', encoding='utf-8')
    (a / f'{NAME}.bak-20250101-000000').mkdir()                                  # an older backup: pruned
    other = a / 'someone-elses-addin'
    other.mkdir()
    (other / 'x.py').write_text('keep', encoding='utf-8')
    return a


def _run(runner, addins_dir, zip_url, sha_url=None, extra_env=None):
    env = dict(os.environ, BSPLINE_ADDINS_DIR=str(addins_dir), BSPLINE_ZIP_URL=zip_url, BSPLINE_NO_PAUSE='1')
    if sha_url:
        env['BSPLINE_SHA256_URL'] = sha_url
    env.update(extra_env or {})
    if runner == 'cmd':
        args = ['cmd.exe', '/d', '/c', str(CMD)]
    else:
        env['BSPLINE_ADDINS_DIR'] = Path(addins_dir).as_posix()
        args = [BASH, COMMAND.as_posix()]
    p = subprocess.run(args, env=env, capture_output=True, text=True, timeout=180, creationflags=NO_WINDOW,
                       stdin=subprocess.DEVNULL)
    return p.returncode, p.stdout + p.stderr


def _snapshot(a):
    return sorted(p.relative_to(a).as_posix() for p in Path(a).rglob('*'))


@pytest.mark.parametrize('runner', RUNNERS)
def test_installs_backs_up_and_sets_run_on_startup(runner, release_dir, addins):
    rc, out = _run(runner, addins, (release_dir / f'{NAME}.zip').as_uri())
    assert rc == 0, out
    live = addins / NAME
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# entry new\n'
    assert not (live / 'old-only.js').exists()
    raw = (live / f'{NAME}.manifest').read_bytes()
    assert not raw.startswith(b'\xef\xbb\xbf')                                     # no BOM: Fusion must parse it
    assert json.loads(raw)['runOnStartup'] is True
    want = MANIFEST.encode('utf-8')
    if runner == 'bash' and sys.platform == 'win32':
        # Git-for-Windows' sed writes LF; macOS sed keeps the CRs. Same JSON either way.
        raw, want = raw.replace(b'\r\n', b'\n'), want.replace(b'\r\n', b'\n')
    assert raw.replace(b'true', b'false') == want                                  # nothing else changed
    assert json.loads((live / 'build-info.json').read_text(encoding='utf-8'))['sha'] == 'abc1234'
    names = sorted(p.name for p in addins.iterdir())
    assert names[0] == NAME and names[2] == 'someone-elses-addin' and len(names) == 3
    assert names[1].startswith(f'{NAME}.bak-') and names[1] != f'{NAME}.bak-20250101-000000'   # only the newest
    assert (addins / names[1] / f'{NAME}.py').read_text(encoding='utf-8') == '# entry old\n'
    assert (addins / 'someone-elses-addin' / 'x.py').read_text(encoding='utf-8') == 'keep'
    assert 'restart Fusion' in out and 'Add-Ins' in out and '2026.11.22-1' in out


@pytest.mark.parametrize('runner', RUNNERS)
def test_first_install_into_an_empty_addins_folder(runner, release_dir, tmp_path):
    a = tmp_path / 'Empty AddIns'                                                  # a space in the path, like Fusion's
    a.mkdir()
    rc, out = _run(runner, a, (release_dir / f'{NAME}.zip').as_uri())
    assert rc == 0, out
    assert sorted(p.name for p in a.iterdir()) == [NAME]
    assert json.loads((a / NAME / f'{NAME}.manifest').read_bytes())['runOnStartup'] is True


@pytest.mark.parametrize('runner', RUNNERS)
def test_checksum_mismatch_changes_nothing(runner, release_dir, addins, tmp_path):
    bad = tmp_path / 'bad.sha256'
    bad.write_text('0' * 64 + f'  {NAME}.zip\n', encoding='utf-8')
    before = _snapshot(addins)
    rc, out = _run(runner, addins, (release_dir / f'{NAME}.zip').as_uri(), sha_url=bad.as_uri())
    assert rc == 4, out
    assert 'checksum' in out
    assert _snapshot(addins) == before


@pytest.mark.parametrize('runner', RUNNERS)
def test_offline_is_exit_2(runner, addins, tmp_path):
    before = _snapshot(addins)
    rc, out = _run(runner, addins, (tmp_path / 'nowhere' / f'{NAME}.zip').as_uri())
    assert rc == 2, out
    assert 'online' in out
    assert _snapshot(addins) == before


@pytest.mark.parametrize('runner', RUNNERS)
def test_missing_addins_folder_is_exit_3(runner, release_dir, tmp_path):
    rc, out = _run(runner, tmp_path / 'no-fusion-here', (release_dir / f'{NAME}.zip').as_uri())
    assert rc == 3, out
    assert 'AddIns folder was not found' in out
    assert not (tmp_path / 'no-fusion-here').exists()


@pytest.mark.parametrize('runner', RUNNERS)
def test_a_zip_that_is_not_the_add_in_is_exit_5(runner, addins, tmp_path):
    z = tmp_path / 'other.zip'
    with zipfile.ZipFile(z, 'w') as zf:
        zf.writestr('some-other-thing/readme.txt', 'hi')
    (tmp_path / 'other.zip.sha256').write_text(hashlib.sha256(z.read_bytes()).hexdigest() + '  other.zip\n', encoding='utf-8')
    before = _snapshot(addins)
    rc, out = _run(runner, addins, z.as_uri())
    assert rc == 5, out
    assert _snapshot(addins) == before


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows file locking')
def test_cmd_a_file_held_open_is_exit_6_and_the_old_install_stays(release_dir, addins):
    held = open(addins / NAME / 'old-only.js', 'r', encoding='utf-8')
    try:
        rc, out = _run('cmd', addins, (release_dir / f'{NAME}.zip').as_uri())
    finally:
        held.close()
    assert rc == 6, out
    assert 'Close Fusion' in out
    assert (addins / NAME / f'{NAME}.py').read_text(encoding='utf-8') == '# entry old\n'
    assert not (addins / 'bsfb-new').exists()


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows PowerShell 260-character paths')
def test_cmd_installs_the_deepest_file_into_a_deep_addins_folder(tmp_path):
    # measured 2026-11-22 in the scratchpad test dir: AddIns 128 characters deep + the add-in's deepest entry (115,
    # fusion-exporter/exported files/...) fit at 243, but a 45-character staging folder pushed the extract past 260.
    a = tmp_path / ('d' * max(1, 127 - len(str(tmp_path)) - len('\\AddIns'))) / 'AddIns'
    a.mkdir(parents=True)
    assert len(str(a)) + 1 >= 120
    deep = f'{NAME}/' + 'x' * (115 - len(NAME) - 1 - len('/deep.json')) + '/deep.json'
    assert len(deep) == 115 and len(str(a)) + 1 + len(deep) < 260
    z = tmp_path / f'{NAME}.zip'
    with zipfile.ZipFile(z, 'w') as zf:
        zf.writestr(f'{NAME}/{NAME}.py', '# entry\n')
        zf.writestr(f'{NAME}/{NAME}.manifest', MANIFEST)
        zf.writestr(deep, '{}')
    (tmp_path / f'{NAME}.zip.sha256').write_text(hashlib.sha256(z.read_bytes()).hexdigest() + f'  {NAME}.zip\n', encoding='utf-8')
    rc, out = _run('cmd', a, z.as_uri())
    assert rc == 0, out
    assert (a / deep).read_text(encoding='utf-8') == '{}'


def test_both_scripts_download_from_the_updaters_release():
    for script in (CMD, COMMAND):
        text = script.read_text(encoding='utf-8')
        assert updater.RELEASE_BASE_URL in text, script.name
        assert f"'{updater.ADDIN_NAME}'" in text or f'"{updater.ADDIN_NAME}"' in text, script.name
        assert '.sha256' in text and 'runOnStartup' in text and '.bak-' in text and 'BSPLINE_ADDINS_DIR' in text


def test_line_endings_suit_each_shell():
    assert b'\r\n' in CMD.read_bytes() and b'\n' not in CMD.read_bytes().replace(b'\r\n', b'')
    assert b'\r' not in COMMAND.read_bytes()
    assert COMMAND.read_bytes().startswith(b'#!/bin/bash\n')
