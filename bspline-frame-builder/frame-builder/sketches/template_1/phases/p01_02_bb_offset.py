"""Shim — defers to the canonical BB Offset phase in ``_common``.

See ``sketches/_common/phases/p01_02_bb_offset.py`` for the actual
block content. Keeping this file here preserves the
``pNN_MM_<token>.py`` filename convention the loader scans for.
"""

from sketches._common.phases.p01_02_bb_offset import get_block  # noqa: F401
