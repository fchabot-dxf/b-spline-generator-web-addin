"""
constrained_sketch_log.py — ADD1 (measured live in Fusion).

format_constrained_sketch_log() used to be inlined into b-spline-gen.py's
_build_constrained_sketch_for_layer, reading summary['offsets'] — a key
T64 removed when the offset/cap step was replaced by Slot entities
creating their own width dimension as a side effect of geometry creation
(sketch_manifest_builder.build_constrained_sketch's own T64 comment). So
every SUCCESSFUL build raised KeyError('offsets') right there, was caught
by the surrounding except, and logged "Constrained sketch build failed
... 'offsets'" for a sketch that had just built fine.

Pulled out to its own zero-dependency module (no adsk import at all —
this is pure dict formatting) for two reasons: (1) b-spline-gen.py itself
imports adsk.core/adsk.fusion/adsk.cam at module level and calls
adsk.core.Application.get() at import time, which makes it awkward to
import in a test without a much larger Fusion stub than this one
function needs; (2) it's genuinely reusable/testable in total isolation,
same reasoning main/slider-scroll-guard.js (b-spline-frame-builder web
add-in's own JS side) was pulled out of its caller for.

Keys used here match build_constrained_sketch's own docstring exactly
(that function's docstring is the source of truth for this shape) — no
'offsets' key exists any more.
"""


def format_constrained_sketch_log(sketch_name, summary):
    return (
        f"[SE15] {sketch_name}: entities={summary['entities']['created']}/"
        f"{summary['entities']['created'] + len(summary['entities']['skipped'])} "
        f"constraints_issues={summary['constraints']['count']} "
        f"dim_issues={summary['dimensions']['count']} "
        f"params(created={summary['parameters']['created']},updated={summary['parameters']['updated']}) "
        f"parity_maxErr={summary['parity']['maxErr']} "
        f"{summary['seconds']}s"
    )
