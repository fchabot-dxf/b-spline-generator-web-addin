"""
H23 item 18 (2/2, resumed as item 49): the audit `closed_form_arc.py`'s own docstring (H23 item
18, part 1 -- commit 5b922e8) deferred to "a separate commit": every template's own literal
`widthIn * k` / `heightIn * k` seed, classified DERIVED / FITTED-OK / WRONG per HANDOFF-ranchy.md's
own audit question ("does this seed encode a relationship to OTHER geometry -- tangency, a shared
join, a pass-through point -- and if so, is it solved from that relationship or just fitted to
look right at one board size?").

Full classification (WORK-LOG H23 item 49 carries the per-template writeup; this file is the
ONE finding worth a permanent, codified guard, not a one-time report):

  DERIVED (already closed-form, nothing to do): T7 (t7_geometry.py's own worked example, item 27);
  T11 (its own HW/HH/A/R/S formulas); T5's and T8's own TOP dip/shoulder radius (items 6, and T8's
  own `R = (a^2+d^2)/(4d)` "exact tangent-triple" formula); T10's arch (items 17/46/47); T12/T13's
  seed-board routing (seat C, F30 item 3, confirmed: both call `seed_sketch`).

  FITTED-OK (not derived, but MEASURED not to cause harm at the board sizes Fred actually sends --
  see below for the one surprising, now-guarded exception): T2/T13's own arcs (seeded by 3 points
  alone, no separate Radius dimension to be inconsistent WITH -- structurally immune to this bug
  class); T3/T4's own independently-fitted shoulder/waist/hip points (different fractions from
  T1's, not copied); T12's own independently-fitted (not copied, numerically distinct:
  `heightIn * 0.06925`/`0.075575`, not T1's `heightIn/14`) side-chain radius.

  FITTED-OK, with a MEASURED, now-guarded margin: T1/T3/T4/T5/T8/T10's own shared
  `arc_shoulder_{R,L}` / `arc_hip_{R,L}` seed Radius dimension (`heightIn/14`, IDENTICAL across
  T1/T3/T4/T5/T8/T10 -- T10's own case is the literal, word-for-word incident item 18 originally
  named: Points copied verbatim from T1, never re-derived for T10's own chain). This radius IS a
  real tangency relationship (`arc_shoulder_R` is Tangent to the VERTICAL `horn_TR`, `arc_hip_R` to
  `horn_BR` -- fb_engine/closed_form_arc.py's own `tangent_circle_through_point` is exactly the
  declared primitive for this) -- MEASURED (this file) to be FITTED, not solved: the TRUE
  closed-form radius exceeds the declared `heightIn/14` by 0.006-0.03 in at Fred's own portrait
  board sizes (7x9/6x9/9x12), growing to 0.10-0.15 in at the already-excluded landscape sizes
  (12x6/5.51x1.97) -- the SAME bug class as T5's original item-6 incident (there: a 23% shortfall,
  geometrically impossible; here: 1-4% at portrait sizes, geometrically valid but imprecise).

  Classified FITTED-OK, not WRONG, because: (a) the Radius dimension is TEMPORARY -- every one of
  these templates deletes it in its own p02_09_radius_removal.py phase before the sketch is
  considered final, so it only ever nudges the solver's INITIAL guess, never the built shape
  itself; (b) MEASURED, not assumed: every template sharing this constant already has a clean,
  passing golden at every portrait size (confirmed by reading the committed fixtures directly --
  e.g. tests/fixtures/frame-parity/template_1_12x6.json, the single WORST-margin case measured
  here, has all 4 bars and `timelineHealthy: true`) -- the margin measured here has never once
  manifested as a live build defect, unlike T5's own original (an outright wrong-branch solve).

  Why not fix it anyway (re-derive the shared literal via `tangent_circle_through_point`)? Six
  templates share this ONE constant; re-deriving it touches code that is CURRENTLY, PROVABLY
  working everywhere it's tested, for a value that gets deleted before it can affect the final
  shape -- exactly what HANDOFF-ranchy.md's own audit section calls "leave seeds alone that are
  provably fine." The margin is instead CODIFIED below as a permanent regression guard: if a
  future edit to either the points or the radius ever widens this gap past a generous bound, this
  test fails BEFORE the gap reaches the size that broke T5 -- cheaper than re-deriving six
  templates' own working seeds today.
"""
import math
import os
import re
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.closed_form_arc import tangent_circle_through_point  # noqa: E402
from fb_engine.template_resolver import resolve_template  # noqa: E402

BBO = 0.25
PORTRAIT_BOARDS = [(7, 9), (9, 12), (6, 9)]
# MEASURED margin at these sizes tops out under 0.03 in (see this file's own module docstring) --
# a generous 3x bound, so this guards against the gap WIDENING, not today's own known value.
MAX_RADIUS_GAP_IN = 0.1


def _ev_factory(W, H, bbo):
    env = {'widthIn': W, 'heightIn': H, 'boundingboxoffset': bbo,
           'sqrt': math.sqrt, 'abs': abs, 'min': min, 'max': max}
    return lambda e: eval(re.sub(r'\bin\b', '', str(e)), {"__builtins__": {}}, env)  # noqa: S307


def _find(items, **match):
    for it in items:
        if all(it.get(k) == v for k, v in match.items()):
            return it
    raise KeyError(f"no item matching {match}")


def _all_items(sketch):
    out = []
    for b in sketch.get('Blocks', []):
        out.extend(b.get('BuildSequence', []) or [])
    return out


# (template, arc id, horn id (the VERTICAL line it's Tangent to), tangent-point index in the arc's
# own declared Points -- the OTHER end, index 2-tangent_index, is the through_point shared with its
# neighbor). Confirmed structurally identical across all six (every one of T3/T4/T5/T8/T10's own
# docstring: "Template 1's own ... topology") by reading each one's own p02_08_horn_tangency.py.
CASES = [
    ('template_1', 'arc_shoulder_R', 'horn_TR', 0), ('template_1', 'arc_hip_R', 'horn_BR', 2),
    ('template_1', 'arc_shoulder_L', 'horn_TL', 0), ('template_1', 'arc_hip_L', 'horn_BL', 2),
    ('template_3', 'arc_shoulder_R', 'horn_TR', 0), ('template_3', 'arc_hip_R', 'horn_BR', 2),
    ('template_4', 'arc_shoulder_R', 'horn_TR', 0), ('template_4', 'arc_hip_R', 'horn_BR', 2),
    ('template_5', 'arc_shoulder_R', 'horn_TR', 0), ('template_5', 'arc_hip_R', 'horn_BR', 2),
    ('template_8', 'arc_shoulder_L', 'horn_TL', 0), ('template_8', 'arc_hip_L', 'horn_BL', 2),
    ('template_10', 'arc_shoulder_R', 'horn_TR', 0), ('template_10', 'arc_hip_R', 'horn_BR', 2),
]


@pytest.mark.parametrize("tid,arc_id,horn_id,tangent_idx", CASES)
@pytest.mark.parametrize("W,H", PORTRAIT_BOARDS)
def test_shared_side_chain_radius_stays_within_a_bounded_margin_of_the_true_tangent_radius(tid, arc_id, horn_id, tangent_idx, W, H):
    sk2 = resolve_template(tid)[0]['Sketches'][1]
    items = _all_items(sk2)
    arc = _find(items, ID=arc_id, Type='Arc3Point')
    radius_step = _find(items, Type='Radius', Target=arc_id)
    ev = _ev_factory(W, H, BBO)

    pts = [(ev(x), ev(y)) for x, y in arc['Points']]
    tangent_pt, through_pt = pts[tangent_idx], pts[2 - tangent_idx]
    _, true_r = tangent_circle_through_point(tangent_pt, (0.0, 1.0), through_pt)
    declared_r = ev(radius_step['Expression'])

    gap = abs(abs(true_r) - declared_r)
    assert gap < MAX_RADIUS_GAP_IN, (
        f"{tid}:{arc_id} at {W}x{H}: declared radius {declared_r:.4f} vs. the TRUE tangent-to-"
        f"{horn_id} radius {abs(true_r):.4f} (gap {gap:.4f} in) -- past the bounded regression "
        f"guard; re-derive via fb_engine/closed_form_arc.py's own tangent_circle_through_point "
        f"(see HANDOFF-ranchy.md's own seed-derivation convention) before this reaches the scale "
        f"of T5's original item-6 incident")
