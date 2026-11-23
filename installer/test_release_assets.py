"""
release.py --addin builds and uploads ONE asset, bspline-frame-builder.zip (Fred 2026-11-23: "just a script that copies
the file" -- no .sha256, no latest.json). The zip carries its own build-info.json (the existing version stamp the
palette badges read), written into the archive, never into the source tree. Built on a fake add-in tree; gh never runs.
"""
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


def test_release_builds_only_the_zip_with_its_stamp_inside(tmp_path, fake_addin):
    out = tmp_path / 'release-out'
    zpath = release.build_addin_release(str(fake_addin), str(out), STAMP)
    assert sorted(os.listdir(out)) == [f'{NAME}.zip']                              # no .sha256, no latest.json
    names = updater.validate_zip(zpath)                                             # the shape the installers accept
    assert f'{NAME}/b-spline-gen/x.log' not in names
    with zipfile.ZipFile(zpath) as zf:
        assert json.loads(zf.read(f'{NAME}/build-info.json')) == STAMP
    assert not (fake_addin / 'build-info.json').exists()                           # the source tree stays clean
    installed = tmp_path / 'AddIns'
    installed.mkdir()
    updater.install_zip(zpath, installed)
    assert read_build_info(installed / NAME)['sha'] == 'abc1234'


def test_release_stamp_reuses_the_deploy_stamp_and_hides_the_source_path():
    stamp = release.release_stamp(NOW, prev_info={'version': '2026.11.22-3'})
    assert set(stamp) == {'version', 'sha', 'branch', 'built_at', 'source_root', 'dirty'}   # build-info.json's keys
    assert stamp['version'] == '2026.11.22-4'                                       # DEPLOY's next_version, per release
    assert stamp['source_root'] == ''                                               # no dev path in a public file
    assert stamp['sha'] != 'unknown'                                                # run inside the repo: git answers


def test_upload_sends_just_the_zip(tmp_path, monkeypatch, fake_addin):
    zpath = release.build_addin_release(str(fake_addin), str(tmp_path / 'release-out'), STAMP)
    calls = []

    class Done:
        returncode = 0

    monkeypatch.setattr(release.shutil, 'which', lambda name: 'gh')
    monkeypatch.setattr(release.subprocess, 'run', lambda cmd, **kw: (calls.append(cmd), Done())[1])
    monkeypatch.setattr(release, 'ZIP_TARGET', zpath)
    release.step_gh_release()
    uploads = [c for c in calls if c[1:3] == ['release', 'upload']]
    assert uploads == [['gh', 'release', 'upload', 'latest', zpath, '--clobber']]
