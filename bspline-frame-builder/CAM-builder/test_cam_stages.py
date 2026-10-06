"""
F35 item 70, the CAM add-in side: BUILD SETUPS / APPLY TOOLPATHS report each step to the CAM palette by its DECLARED
id ('cam_stage' {id}) from ui/html/cam-stages.js -- the one file the palette imports too (cam-loading.js) -- through
fb_shared.palette_stages (the shared reader + the paint pump). The palette side: tests/cam-stages.test.js.
"""
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _ROOT)

from fb_shared import palette_stages  # noqa: E402

STAGES_FILE = os.path.join(_HERE, 'ui', 'html', 'cam-stages.js')


def _src(name):
    with open(os.path.join(_HERE, name), encoding='utf-8') as f:
        return f.read()


def test_the_add_in_reads_the_palettes_own_declaration():
    with open(STAGES_FILE, encoding='utf-8') as f:
        ids_in_file = re.findall(r'"id":\s*"([^"]+)"', f.read())
    assert palette_stages.declared_stage_ids(STAGES_FILE) == ids_in_file


def test_every_reported_stage_is_declared_and_every_declared_stage_is_reported():
    used = set(re.findall(r"stage\('(cam[A-Za-z]+)'\)", _src(os.path.join('cam_engine', 'cam_coordinator.py'))))
    used |= set(re.findall(r"_post_cam_stage\('(cam[A-Za-z]+)'\)", _src('cam-builder.py')))
    assert used == set(palette_stages.declared_stage_ids(STAGES_FILE))


def test_the_build_steps_are_reported_in_their_declared_order():
    src = _src(os.path.join('cam_engine', 'cam_coordinator.py'))
    order = [m.group(1) for m in re.finditer(r"stage\('(cam[A-Za-z]+)'\)", src)]
    assert order == ['camWcs', 'camCleanup', 'camModels', 'camSetups']


def test_the_pump_keeps_pumping_for_its_window_not_once():
    calls = []
    t0 = palette_stages.time.monotonic()
    palette_stages.pump(lambda: calls.append(palette_stages.time.monotonic()))
    assert len(calls) > 1 and calls[-1] - t0 >= palette_stages.POST_PAINT_PUMP_S
