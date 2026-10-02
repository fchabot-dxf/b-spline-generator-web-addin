"""Shim — defers to the canonical BB Layout phase in ``_common``.

The actual block content lives in
``sketches/_common/phases/p01_01_bb_layout.py``. This file exists so
``TemplateLoader._scan_phase_files`` still finds a ``p01_01_*.py`` here
(filename → ``PhaseID`` convention) and so ``ls phases/`` still answers
"what does this template build?".
"""

from sketches._common.phases.p01_01_bb_layout import get_block  # noqa: F401
