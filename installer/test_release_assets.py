"""
release.py --addin builds THREE release assets (Fred 2026-11-22: the one-click installer + in-add-in updater):
    bspline-frame-builder.zip          the add-in, now carrying its own build-info.json (the existing version stamp)
    bspline-frame-builder.zip.sha256   what the installers check the download against
    latest.json                        what "Check for updates" reads: the same stamp + the zip's URL, SHA-256, size
and uploads all three, latest.json LAST (a client that sees the new latest.json then finds the new zip).
Built on a fake add-in tree in a temp dir; gh is never run.
"""
import hashlib
import importlib.util
import json
import os
import sys
import zipfile
from datetime import datetime

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, 'bspline-frame-builder'))
from fb_shared import updater  # noqa: E402
from fb_shared.build_info import read_build_info  # noqa: E402

_spec = importlib.util.spec_from_file_location('release_script', os.path.join(REPO, 'release.py'))
release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release)

NAME = 'bspline-frame-builder'
NOW = datetime(2026, 11, 22, 21, 30, 5).astimezone()
STAMP = {'version': '2026.11.22-1', 'sha': 'abc1234', 'branch': 'main', 'built_at': NOW.isoformat(timespec='seconds'),
         'source_root': '', 'dirty': False}


@pytest.fixture
def fake_addin(tmp_path):
    root = tmp_path / NAME
    (root / 'b-spline-gen').mkdir(parents=True)
    (root / f'{NAME}.py').write_text('# entry\n', encoding='utf-8')
    (root / f'{NAME}.manifest').write_text('{\n    "runOnStartup": false\n}\n', encoding='utf-8')
    (root / 'b-spline-gen' / 'b-spline-gen.py').write_text('# sub\n', encoding='utf-8')
    (root / 'b-spline-gen' / 'x.log').write_text('log', encoding='utf-8')          # never shipped
    return root


def test_release_builds_zip_sha256_and_latest_json(tmp_path, fake_addin):
    out = tmp_path / 'release-out'
    assets = release.build_addin_release(str(fake_addin), str(out), STAMP)

    assert [os.path.basename(p) for p in assets] == [f'{NAME}.zip', f'{NAME}.zip.sha256', 'latest.json']
    zpath, shapath, latestpath = assets
    digest = hashlib.sha256(open(zpath, 'rb').read()).hexdigest()

    # the zip: the add-in shape the installers accept, plus the stamp inside it
    names = updater.validate_zip(zpath)
    assert f'{NAME}/b-spline-gen/x.log' not in names
    with zipfile.ZipFile(zpath) as zf:
        assert json.loads(zf.read(f'{NAME}/build-info.json')) == STAMP
    assert not (fake_addin / 'build-info.json').exists()                           # the source tree stays clean

    # the checksum file, sha256sum format
    assert open(shapath, encoding='utf-8').read() == f'{digest}  {NAME}.zip\n'
    assert updater.parse_sha256_text(open(shapath, encoding='utf-8').read()) == digest

    # latest.json: the stamp + where to get it; the updater accepts it, and calls the zip's own stamp current
    latest = json.load(open(latestpath, encoding='utf-8'))
    assert latest == dict(STAMP, name=NAME, zip_url=updater.RELEASE_BASE_URL + f'{NAME}.zip', sha256=digest,
                          size=os.path.getsize(zpath))
    updater.validate_latest(latest)
    installed = tmp_path / 'AddIns'
    installed.mkdir()
    updater.install_zip(zpath, installed)
    assert updater.compare_builds(read_build_info(installed / NAME), latest) == 'current'


def test_release_stamp_reuses_the_deploy_stamp_and_hides_the_source_path(monkeypatch):
    stamp = release.release_stamp(NOW, prev_latest={'version': '2026.11.22-3'})
    assert set(stamp) == {'version', 'sha', 'branch', 'built_at', 'source_root', 'dirty'}   # build-info.json's keys
    assert stamp['version'] == '2026.11.22-4'                                       # DEPLOY's next_version, per release
    assert stamp['source_root'] == ''                                               # no dev path in a public file
    assert stamp['sha'] != 'unknown'                                                # run inside the repo: git answers


def test_upload_sends_all_three_and_latest_json_last(tmp_path, monkeypatch, fake_addin):
    out = tmp_path / 'release-out'
    assets = release.build_addin_release(str(fake_addin), str(out), STAMP)
    calls = []

    class Done:
        returncode = 0

    monkeypatch.setattr(release.shutil, 'which', lambda name: 'gh')
    monkeypatch.setattr(release.subprocess, 'run', lambda cmd, **kw: (calls.append(cmd), Done())[1])
    monkeypatch.setattr(release, 'RELEASE_ASSETS', assets)
    release.step_gh_release()
    uploads = [c for c in calls if c[1:3] == ['release', 'upload']]
    assert [os.path.basename(c[4]) for c in uploads] == [f'{NAME}.zip', f'{NAME}.zip.sha256', 'latest.json']
    assert all('--clobber' in c for c in uploads)
