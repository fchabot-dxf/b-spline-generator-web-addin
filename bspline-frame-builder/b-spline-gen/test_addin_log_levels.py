"""
H23 item 93: one palette load wrote ~600 KB to b_spline_gen_log.txt (the session JSON echoed on every save) and a
Send's own lines were 2/3 '[DEBUG] ATTR TAG' + 1/6 'CONSTRAINT OK' (seat A, measured 2026-10-06), so the 512 KB log
rotated twice inside one load and that load's own lines were gone. html/data/addin-log.js now DECLARES the debug
level (off), the demoted prefixes and the rotation size; this drives the REAL _log against it.

Run with:
    cd bspline-frame-builder/b-spline-gen
    python3 -m pytest test_addin_log_levels.py
"""
import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import test_import_failed_no_modal as _shared  # installs the minimal fake adsk BEFORE the module import

bsg = _shared.bsg


def _declared():
    src = open(os.path.join(_HERE, 'html', 'data', 'addin-log.js'), encoding='utf-8').read()
    m = re.search(r'^export default', src, re.M)
    return json.loads(src[m.end():].strip().rstrip(';'))


def _lines(path):
    return open(path, encoding='utf-8').read().splitlines() if os.path.exists(path) else []


KEEP = ['[STAGE] fusionBricks', '[PROGRESS] Building the frame...', '[JS LOG] [MODE] Fusion host: adsk after 549 ms',
        '[XFER] chunk 35: 262144 bytes at +264 ms', '[ERROR] stamp failed', '[WARNING] PARITY WARNING: 24 entities',
        'Import session finalized.', 'SEND FRAME result: {}']
NOISE = ['[DEBUG] ATTR TAG: constraint-83 assigned to CoincidentConstraint in Source - L2',
         "CONSTRAINT OK: Coincident on ['seg0:E', 'seg1:S']", "      [DEBUG] bbox: (0.00,0.00)"]


class TestAddinLogLevels:
    def test_the_declaration_ships_debug_off(self):
        assert _declared()['debug'] is False

    def test_debug_off_drops_the_noise_and_keeps_stages_mode_xfer_errors(self, tmp_path, monkeypatch):
        log = str(tmp_path / 'log.txt')
        monkeypatch.setattr(bsg, 'LOG_FILE', log)
        for m in NOISE + KEEP:
            bsg._log(m)
        written = '\n'.join(_lines(log))
        for m in KEEP:
            assert m in written, m
        for m in NOISE:
            assert m.strip() not in written, m

    def test_debug_on_writes_everything(self, tmp_path, monkeypatch):
        log = str(tmp_path / 'log.txt')
        monkeypatch.setattr(bsg, 'LOG_FILE', log)
        monkeypatch.setitem(bsg.ADDIN_LOG, 'debug', True)
        for m in NOISE:
            bsg._log(m)
        assert len(_lines(log)) == len(NOISE)

    def test_rotation_follows_the_declared_size(self, tmp_path, monkeypatch):
        log = str(tmp_path / 'log.txt')
        monkeypatch.setattr(bsg, 'LOG_FILE', log)
        monkeypatch.setitem(bsg.ADDIN_LOG, 'rotateBytes', 2000)
        for i in range(30):  # ~3 KB: exactly one rotation past 2000 B
            bsg._log(f'[STAGE] line {i:03d} ' + 'x' * 60)
        assert os.path.exists(log + '.old')
        assert os.path.getsize(log + '.old') > 2000 and os.path.getsize(log) <= 2000

    def test_no_kept_tag_is_ever_a_debug_prefix(self):
        prefixes = tuple(_declared()['debugPrefixes'])
        for m in KEEP:
            assert not m.startswith(prefixes), m
