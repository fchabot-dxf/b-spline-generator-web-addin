import sys
import os
import types

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
