"""
ADD1 (measured live in Fusion): _build_constrained_sketch_for_layer's own
log line used to read summary['offsets'] — a key T64 removed when the
offset/cap step was replaced by Slot entities creating their own width
dimension. Every SUCCESSFUL build raised KeyError('offsets') right there,
was caught by the surrounding `except`, and logged "Constrained sketch
build failed ... 'offsets'" for a sketch that had just built fine.

Reuses test_sketch_manifest_builder.py's own adsk stub + FakeDesign/
_box_lattice_manifest (importing that module executes its module-level
`_install_adsk_stubs()` call as a side effect, same as running it
directly) so format_constrained_sketch_log is exercised against
build_constrained_sketch's REAL return shape, not a hand-guessed fake of
it — the whole point being to catch exactly the kind of shape drift T64
already caused once.
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_sketch_manifest_builder import (  # noqa: E402
    build_constrained_sketch,
    FakeDesign,
    _box_lattice_manifest,
)
from constrained_sketch_log import format_constrained_sketch_log  # noqa: E402


def _real_summary():
    design = FakeDesign()
    manifest = _box_lattice_manifest(constrained=True)
    return build_constrained_sketch(design.rootComponent, design, manifest)


def test_build_constrained_sketch_no_longer_returns_an_offsets_key():
    """Proves the bug was real, against the ACTUAL function, not a stale
    assumption about its shape: T64 removed the offsets step, so a real
    successful build's summary has no 'offsets' key at all any more — the
    OLD log line's summary['offsets'] access would raise KeyError on this
    exact object."""
    summary = _real_summary()
    assert "offsets" not in summary


def test_format_constrained_sketch_log_does_not_raise_on_a_real_summary():
    summary = _real_summary()
    line = format_constrained_sketch_log("Test Layer", summary)
    assert "offsets" not in line
    assert "Test Layer" in line


def test_format_constrained_sketch_log_reports_parity_maxErr():
    summary = _real_summary()
    line = format_constrained_sketch_log("Test Layer", summary)
    assert f"parity_maxErr={summary['parity']['maxErr']}" in line


def test_format_constrained_sketch_log_reports_entities_constraints_dims_params_and_seconds():
    summary = _real_summary()
    line = format_constrained_sketch_log("Test Layer", summary)
    total = summary["entities"]["created"] + len(summary["entities"]["skipped"])
    assert f"entities={summary['entities']['created']}/{total}" in line
    assert f"constraints_issues={summary['constraints']['count']}" in line
    assert f"dim_issues={summary['dimensions']['count']}" in line
    assert (
        f"params(created={summary['parameters']['created']},"
        f"updated={summary['parameters']['updated']})" in line
    )
    assert f"{summary['seconds']}s" in line


def test_format_constrained_sketch_log_raises_a_clear_error_on_a_shape_that_lost_a_key():
    """Mirrors the ORIGINAL bug shape one level up: if a FUTURE change
    removes another key this formatter reads (say 'parity'), it should
    fail loudly with a KeyError naming that key — not silently — so the
    next such regression is at least as debuggable as this one turned out
    to be once someone actually looked."""
    summary = _real_summary()
    del summary["parity"]
    try:
        format_constrained_sketch_log("Test Layer", summary)
        assert False, "expected a KeyError for the missing 'parity' key"
    except KeyError as e:
        assert "parity" in str(e)
