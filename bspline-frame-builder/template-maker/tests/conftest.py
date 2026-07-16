import sys
import os
import types

import pytest

# Append the parent folder logic and core folder logic
_tests_dir = os.path.dirname(os.path.realpath(__file__))
_parent_dir = os.path.dirname(_tests_dir)
_core_dir = os.path.join(_parent_dir, 'core')
_addin_root = os.path.dirname(_parent_dir)   # bspline-frame-builder/ (for `import fb_shared`)

for _p in (_parent_dir, _core_dir, _addin_root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── C4-S2 acceptance gate ─────────────────────────────────────────────────────
# Run the ENTIRE template-maker test tree against the CANONICAL fb_shared copies
# instead of template-maker/core's — WITHOUT touching any production caller. The
# tests (and the core modules they import, e.g. template_generator) resolve
# `expression_coords` / `entity_helpers` by BARE name, so we alias those names in
# sys.modules to the fb_shared modules (sys.modules wins over sys.path). If the
# suite stays green, the merged canonical (incl. the arc-midpoint reconciliation)
# is behaviour-equivalent to the copies it replaces. A stub adsk is installed
# first because fb_shared.* import adsk.core/adsk.fusion at module level; the
# individual tests re-stub adsk for their own use, which is harmless.
if 'adsk' not in sys.modules:
    _adsk = types.ModuleType('adsk')
    _adsk_core = types.ModuleType('adsk.core')
    _adsk_fusion = types.ModuleType('adsk.fusion')
    _adsk.core = _adsk_core
    _adsk.fusion = _adsk_fusion

    class _NoApp:
        @staticmethod
        def get():
            return None

    _adsk_core.Application = _NoApp
    sys.modules['adsk'] = _adsk
    sys.modules['adsk.core'] = _adsk_core
    sys.modules['adsk.fusion'] = _adsk_fusion

import fb_shared.entity_helpers as _fb_entity_helpers
import fb_shared.expression_coords as _fb_expression_coords
sys.modules['entity_helpers'] = _fb_entity_helpers
sys.modules['expression_coords'] = _fb_expression_coords


# ── Test-isolation: per-module ``adsk`` stub, immune to collection order ──────
@pytest.fixture(autouse=True)
def _reinstall_module_adsk_stub(request):
    """Re-install THIS test module's own module-level ``adsk`` stub before each
    of its tests, then restore the prior sys.modules state afterwards.

    WHY: several test files install a fake ``adsk`` at import time
    (``sys.modules['adsk'] = adsk``). pytest imports every test module ONCE, at
    collection, into a single shared ``sys.modules`` — so the LAST-collected
    stub wins for the whole run. Any module whose runtime re-reads
    ``sys.modules['adsk']`` then sees the wrong stub and fails purely on
    collection order. Concretely, ``relation_hints._get_origin_entity_map`` does
    ``import adsk.core`` on EVERY call (no cache), so
    ``test_origin_axis_target`` passes 14/14 alone but 9 fail in the full suite
    once a later file (e.g. ``test_template_naming.py`` / ``test_rename_selection.py``)
    clobbers ``sys.modules['adsk']`` with a stub whose ``Application.get()`` isn't
    the origin fixture's fake root.

    Re-installing the running test's own module-level ``adsk`` (if it declared
    one) makes every file's tests order-independent. One declared reset; all
    tests inherit it. No assertions or product code touched.
    """
    _keys = ('adsk', 'adsk.core', 'adsk.fusion')
    _saved = {k: sys.modules.get(k) for k in _keys}
    _stub = getattr(request.module, 'adsk', None)
    if _stub is not None:
        sys.modules['adsk'] = _stub
        _core = getattr(_stub, 'core', None)
        if _core is not None:
            sys.modules['adsk.core'] = _core
        _fusion = getattr(_stub, 'fusion', None)
        if _fusion is not None:
            sys.modules['adsk.fusion'] = _fusion
    try:
        yield
    finally:
        for _k, _v in _saved.items():
            if _v is None:
                sys.modules.pop(_k, None)
            else:
                sys.modules[_k] = _v
