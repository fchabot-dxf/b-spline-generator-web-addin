"""H23 item 82 (probe finding, measured live 2026-10-05): ``adsk.cam.SetupStockModes`` exposes
FixedBoxStock, FixedCylinderStock, FixedTubeStock, PreviousSetupStock, RelativeBoxStock,
RelativeCylinderStock, RelativeTubeStock, SolidStock -- and nothing else. setup_builder's
``_STOCK_MODE_ENUM_NAMES`` mapped 'from_solid' -> 'FromSolidStock' and 'from_prev_setup' ->
'FromPreviousSetup', neither of which exists, so those two intents silently skipped the typed
path and went through the fragile ``job_stockMode`` string fallback.

The fake enum below carries exactly the measured member names; every declared intent must
resolve through the typed path (no fallback call).

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_stock_mode_enum_names.py
"""
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# Measured live (dir(adsk.cam.SetupStockModes), Fusion 2026-10-05).
MEASURED_STOCK_MODES = (
    'FixedBoxStock', 'FixedCylinderStock', 'FixedTubeStock', 'PreviousSetupStock',
    'RelativeBoxStock', 'RelativeCylinderStock', 'RelativeTubeStock', 'SolidStock',
)


@pytest.fixture
def setup_builder(monkeypatch):
    adsk = types.ModuleType('adsk')
    adsk.core = types.ModuleType('adsk.core')
    adsk.fusion = types.ModuleType('adsk.fusion')
    adsk.cam = types.ModuleType('adsk.cam')
    adsk.cam.SetupStockModes = type(
        'SetupStockModes', (), {n: i for i, n in enumerate(MEASURED_STOCK_MODES)})
    for name, mod in (('adsk', adsk), ('adsk.core', adsk.core),
                      ('adsk.fusion', adsk.fusion), ('adsk.cam', adsk.cam)):
        monkeypatch.setitem(sys.modules, name, mod)
    for name in [m for m in sys.modules if m == 'cam_engine' or m.startswith('cam_engine.')
                 or m == 'cam_utils' or m.startswith('cam_utils.')]:
        monkeypatch.delitem(sys.modules, name)
    from cam_engine import setup_builder as sb
    return sb


class _FakeSetup:
    def __init__(self):
        self.stockMode = None
        self.parameters = None   # the string fallback must never be reached


def test_every_declared_intent_maps_to_a_measured_enum(setup_builder):
    sb = setup_builder
    for intent, enum_name in sb._STOCK_MODE_ENUM_NAMES.items():
        assert enum_name in MEASURED_STOCK_MODES, (intent, enum_name)


@pytest.mark.parametrize('intent, expected', [
    ('auto_bbox', 'RelativeBoxStock'),
    ('fixed_box', 'FixedBoxStock'),
    ('from_solid', 'SolidStock'),
    ('from_prev_setup', 'PreviousSetupStock'),
])
def test_set_stock_mode_uses_typed_enum(setup_builder, monkeypatch, intent, expected):
    sb = setup_builder
    fallback_calls = []
    monkeypatch.setattr(sb.pi, 'set_choice', lambda *a, **k: fallback_calls.append(a))
    s = _FakeSetup()
    assert sb._set_stock_mode(s, intent, 'test', None)
    assert s.stockMode == getattr(sb.adsk.cam.SetupStockModes, expected)
    assert fallback_calls == []
