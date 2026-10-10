"""
2026-10-09 (seat A, measured in a profiled Send): fb_utils/fb_logger.DebugLogger fsync'd every line on every log path --
1,100-1,800 fsyncs, 1.2-1.9 s of each Send. Now a line is appended + flushed (a Python crash loses nothing) and the
disk sync happens once per session: DebugLogger.sync(), called from send_frame's finally (any exit).
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))

from fb_utils import fb_logger  # noqa: E402
from fb_utils.fb_logger import DebugLogger  # noqa: E402
from fb_engine.test_send_frame import World, send_bspline, Builds, Body, payload  # noqa: E402  (shared fakes)
from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine import send_frame as sf  # noqa: E402


@pytest.fixture
def fsyncs(monkeypatch):
    calls = []
    real = os.fsync
    monkeypatch.setattr(fb_logger.os, 'fsync', lambda fd: (calls.append(fd), real(fd)))
    return calls


def _two_path_logger(tmp_path):
    addin, work = tmp_path / 'addin', tmp_path / 'work'
    addin.mkdir(); work.mkdir()
    (addin / 'project_path.json').write_text(json.dumps({'project_root': str(work)}), encoding='utf-8')
    lg = DebugLogger(str(addin))
    assert len(lg.log_paths) == 2
    return lg


def test_a_line_is_on_disk_at_once_without_a_disk_sync(tmp_path, fsyncs):
    lg = _two_path_logger(tmp_path)
    fsyncs.clear()
    for i in range(50):
        lg.log(f'line {i}')
        for p in lg.log_paths:  # readable by another reader right away (flushed, closed)
            with open(p, encoding='utf-8') as f:
                assert f.read().rstrip().endswith(f'line {i}')
    assert fsyncs == []


def test_sync_is_one_disk_sync_per_log_path(tmp_path, fsyncs):
    lg = _two_path_logger(tmp_path)
    lg.log('x')
    fsyncs.clear()
    lg.sync()
    assert len(fsyncs) == 2


class SyncLog:
    def __init__(self):
        self.lines, self.syncs = [], 0

    def log(self, msg, level='INFO'):
        self.lines.append((level, msg))

    def log_error(self, msg):
        self.lines.append(('ERROR', msg))

    def sync(self):
        self.syncs += 1


def _send(w, pl, logger, solid=None):
    b = Builds(w)
    return sf.send_frame(w, pl, lambda: Body(), logger, resolve_template=resolve_template,
                         build_sketch=b.sketch, build_solid=solid or b.solid, value_input=lambda e: e)


def test_send_frame_syncs_the_log_once_on_success_refusal_and_crash():
    w = World(); send_bspline(w)
    lg = SyncLog()
    assert _send(w, payload(), lg)['ok'] and lg.syncs == 1
    lg = SyncLog()
    assert _send(w, payload(templateId=None), lg)['error'] and lg.syncs == 1  # refused: still synced

    def boom(**k):
        raise RuntimeError('solid build crashed')
    lg = SyncLog()
    with pytest.raises(RuntimeError):
        _send(w, payload(), lg, solid=boom)
    assert lg.syncs == 1


def test_a_logger_without_sync_still_works():
    w = World(); send_bspline(w)
    from fb_engine.test_send_frame import Log
    assert _send(w, payload(), Log())['ok']
