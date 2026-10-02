"""
H23 item 27, part 2 (Fred approved): T11's own two pure-python cross-checks
(fb_engine/test_t11_fusion_expressions.py on lane-b), generalised into ONE
parametrised suite over EVERY template -- no Fusion needed, operates purely
on each template's own resolved Sketch 2 (Shape Outline) BuildSequence
(expression strings -> numbers, substituting widthIn/heightIn/
boundingboxoffset). Three checks:

1. WELD ORIENTATION (the real gate -- T7's own bug class). Fusion's SketchArc
   always runs counter-clockwise start->end (fusion360-quirks skill, section
   1): `addByThreePoints(p0, via, p1)` silently swaps which declared point
   becomes :S vs :E depending on the 3-point turn's own sign. A weld that
   assumes "point[0] is always :S" is wrong for every clockwise-declared arc.
   This derives each arc's PHYSICAL :S/:E from that turn sign (a `Rebuild`
   item is the one documented exception -- fb_engine/geometry.py's own
   `_fix_rebuild_start_end` re-tags it to the REQUESTED order unconditionally,
   confirmed against Template 10's own arch), then checks every Coincident
   weld against BOTH candidate orientations of each ambiguous (arc) side: if
   swapping EITHER side to its alternative candidate would bring the weld
   meaningfully closer together, that is the crossed-weld signature -- NOT
   "is the raw declared gap near zero", which is the wrong test entirely for
   any template using approximate (solver-refined) seeds rather than exact
   closed-form ones (confirmed directly: Template 1's own `horn_tip_weld_TR`
   has a 0.34 in RAW gap at 7x9 and is still correctly oriented -- the near
   candidate, not the far one; Template 7's own crossed welds instead show
   the alternative candidate closing the gap to within thousandths, a
   qualitatively different, unambiguous signal).

2. SEED MIDPOINT (report, don't fail): for every Arc3Point, is its own
   `via` point at the TRUE angular midpoint of the minor branch between its
   two ends (on the circle the 3 points themselves define)? REPORTS the
   measured angular offset per template -- most templates (built before this
   quirk was understood) use a rough "hint" via that the Tangent solver later
   corrects, which is legitimate (MEASURED, fusion360-quirks: Tangent only
   solves an arc whose BOTH ends are already pinned -- an internal chain
   joint's free end keeps whatever the seed said, so SOME seeds genuinely
   need to be close; this just reports how close every template's actually
   is, it does not fail on an imprecise one).

3. CONVEX RADIUS VS BAR (H23 item 28: DECLARED known list, enforced): every
   CONVEX arc's radius (its own explicit seed Radius dimension if declared,
   else its 3-point circumcircle) must exceed `frame_thickness` for Fusion's
   own `addOffset2` to keep the whole enclosure loop parametric
   (fusion360-quirks, advisor probe C1/C2) -- a radius at or below it
   silently falls back to a non-parametric, differently-shaped offset.
   Convexity is approximated as "does the arc's own via point sit farther
   from the outline's own centroid than its chord's midpoint" (bulges
   outward = convex) -- a reasonable, not exhaustively-verified heuristic.
   Per Fred: the templates currently below the bar are ACCEPTED cases (warn
   only at Send, offsets.py's own loud fallback -- see item 28's other
   half), not a to-do -- KNOWN_CONVEX_RADIUS_BELOW_BAR documents exactly
   which templates, and the test enforces that it stays in sync: a NEW
   template joining this class fails loudly instead of disappearing into a
   report nobody reads, and a template that's quietly LEFT the class (a
   seed rework, say) prompts pruning the now-stale entry. Shape changes to
   fix an existing entry are still the advisor's own per-template call, not
   this test's.
"""
import math
import os
import re
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.closed_form_arc import true_via_point  # noqa: E402
from fb_engine.template_resolver import resolve_template, get_available_templates  # noqa: E402

BOARDS = [(7, 9), (9, 12), (6, 9)]
BBO = 0.25
AXES = {'Y_AXIS', 'X_AXIS'}
TEMPLATE_IDS = [t['value'] for t in get_available_templates()]
# H23 item 27: T7's own crossed welds, known and expected until its weld fix lands.
XFAIL_WELD_ORIENTATION = set()  # H23 item 27: template_7's own fix landed


def _all_items(sketch):
    out = []
    for b in sketch.get('Blocks', []):
        out.extend(b.get('BuildSequence', []) or [])
    return out


def _projections(sketch):
    out = []
    for b in sketch.get('Blocks', []):
        if 'Projections' in b:
            out.extend(b.get('Projections', []) or [])
    return out


def _ev_factory(W, H, bbo, sketch=None):
    """A `Points`-expression evaluator for `sketch` at board (W,H). H23 item 27: also pre-resolves
    the sketch's own declared `Parameters` (e.g. T7's t7_* circle/via-point chain, template_data.py's
    own SKETCH_2_PARAMETERS) into the environment IN DECLARATION ORDER first, so a later expression
    can reference an earlier one by its bare name -- the same two-phase resolution
    frame_engine._create_skeletal_parameters itself does in the real Fusion build."""
    env = {'widthIn': W, 'heightIn': H, 'boundingboxoffset': bbo,
           'sqrt': math.sqrt, 'abs': abs, 'min': min, 'max': max}
    ev = lambda e: eval(re.sub(r'\bin\b', '', e), {"__builtins__": {}}, env)  # noqa: S307 -- controlled strings, test-only
    for p in (sketch or {}).get('Parameters', []) or []:
        if not p.get('ReadOnly') and isinstance(p.get('Val'), str):
            env[p['Name']] = ev(p['Val'])
    return ev


def _circumcircle(p0, p1, p2):
    ax, ay = p0; bx, by = p1; cx, cy = p2
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:
        return None
    ux = ((ax**2 + ay**2) * (by - cy) + (bx**2 + by**2) * (cy - ay) + (cx**2 + cy**2) * (ay - by)) / d
    uy = ((ax**2 + ay**2) * (cx - bx) + (bx**2 + by**2) * (ax - cx) + (cx**2 + cy**2) * (bx - ax)) / d
    r = math.hypot(ax - ux, ay - uy)
    return (ux, uy), r


def _entity_candidates(t, sketch, W, H, bbo):
    """{id -> {'S','E','altS','altE','C'}} for every Line/Arc3Point in `sketch`, plus every id a
    Projections block pulls in from another sketch (a point has no S/E ambiguity: S==E==alt)."""
    ev = _ev_factory(W, H, bbo, sketch)
    items = _all_items(sketch)
    cand = {}
    for it in items:
        if it.get('Type') not in ('Line', 'Arc3Point') or 'Points' not in it:
            continue
        pid = it['ID']
        p = [(ev(x), ev(y)) for x, y in it['Points']]
        if it['Type'] == 'Line':
            cand[pid] = {'S': p[0], 'E': p[1], 'altS': p[0], 'altE': p[1], 'C': None}
        else:
            x0, y0 = p[0]; x1, y1 = p[1]; x2, y2 = p[2]
            ccw = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0
            if it.get('Rebuild'):
                S, E = p[0], p[2]  # _fix_rebuild_start_end's own unconditional re-tag (item 17/23)
            else:
                S, E = (p[0], p[2]) if ccw else (p[2], p[0])
            cc = _circumcircle(p[0], p[1], p[2])
            cand[pid] = {'S': S, 'E': E, 'altS': E, 'altE': S, 'C': cc[0] if cc else None,
                         '_pts': p, '_circle': cc}
    for proj in _projections(sketch):
        src_sketch = next((s for s in t['Sketches'] if s['Name'] == proj['SourceSketch']), None)
        if src_sketch is None:
            continue
        src = _entity_candidates(t, src_sketch, W, H, bbo)
        src_id, src_tag = proj['SourceID'].split(':') if ':' in proj['SourceID'] else (proj['SourceID'], 'S')
        if src_id in src:
            pt = src[src_id][src_tag]
            cand[proj['TargetID']] = {'S': pt, 'E': pt, 'altS': pt, 'altE': pt, 'C': None}
    return cand


def _resolve(cand, tag):
    eid, suf = tag.split(':') if ':' in tag else (tag, None)
    if eid not in cand:
        return None
    c = cand[eid]
    if suf is None:
        return c.get('S')
    if suf == 'C':
        return c.get('C')
    return c.get(suf), c.get('alt' + suf)


def _shape_outline_sketch(tid):
    t, _ = resolve_template(tid)
    return t, next(s for s in t['Sketches'] if 'shape_outline' in s['Name'])


# ---------------------------------------------------------------------------
# Check 1: weld orientation (the real gate)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("tid", TEMPLATE_IDS)
@pytest.mark.parametrize("W,H", BOARDS)
def test_weld_orientation_every_coincident_picks_the_nearer_candidate(tid, W, H):
    if tid in XFAIL_WELD_ORIENTATION:
        pytest.xfail(f"{tid}: known crossed welds, H23 item 27's own fix not landed yet")
    t, sk = _shape_outline_sketch(tid)
    welds = [it for it in _all_items(sk) if it.get('Type') == 'Coincident']
    cand = _entity_candidates(t, sk, W, H, BBO)
    suspicious = []
    for w in welds:
        a, b = w['Targets']
        if a in AXES or b in AXES:
            continue  # an axis coincidence has no S/E ambiguity -- not this bug class
        ra, rb = _resolve(cand, a), _resolve(cand, b)
        if ra is None or rb is None:
            continue  # an anchor/pin this generic walk doesn't resolve -- not a weld-orientation signal
        a_amb = isinstance(ra, tuple) and isinstance(ra[0], tuple)
        b_amb = isinstance(rb, tuple) and isinstance(rb[0], tuple)
        a_pick, b_pick = (ra[0] if a_amb else ra), (rb[0] if b_amb else rb)
        d_declared = math.hypot(a_pick[0] - b_pick[0], a_pick[1] - b_pick[1])
        best = d_declared
        if a_amb:
            best = min(best, math.hypot(ra[1][0] - b_pick[0], ra[1][1] - b_pick[1]))
        if b_amb:
            best = min(best, math.hypot(a_pick[0] - rb[1][0], a_pick[1] - rb[1][1]))
        if a_amb and b_amb:
            best = min(best, math.hypot(ra[1][0] - rb[1][0], ra[1][1] - rb[1][1]))
        margin = d_declared - best
        # the crossed-weld signature: an alternative candidate would close MOST of the gap (not just
        # trim a rough seed's own small roughness) -- half the declared gap is a wide, safe margin
        # given Template 7's own margin is >99.7% of its gap and Template 1's worst case is 0.0.
        if margin > max(0.05, d_declared * 0.5):
            suspicious.append((w.get('Name', f'{a}~{b}'), a, b, d_declared, margin))
    assert suspicious == [], f"{tid} {W}x{H}: possible crossed weld(s) (alt candidate closes most of the gap): {suspicious}"


# ---------------------------------------------------------------------------
# Check 2: seed midpoint (report, never fails except the templates with an
# exact-seed contract)
# ---------------------------------------------------------------------------
# Templates whose own docstrings declare an EXACT closed-form seed contract (no seed Radius, no
# nudges) -- these alone are held to a tight tolerance; every other template is report-only.
EXACT_SEED_TEMPLATES = {'template_7'}  # H23 item 27: its own fix landed -- exact closed-form seed


@pytest.mark.parametrize("tid", TEMPLATE_IDS)
def test_seed_midpoint_report(tid, capsys):
    t, sk = _shape_outline_sketch(tid)
    arcs = [it for it in _all_items(sk) if it.get('Type') == 'Arc3Point']
    ev = _ev_factory(7, 9, BBO, sk)
    worst_deg = 0.0
    for it in arcs:
        p = [(ev(x), ev(y)) for x, y in it['Points']]
        cc = _circumcircle(*p)
        if cc is None:
            continue
        (cx, cy), r = cc
        if r < 1e-9:
            continue
        angs = [math.atan2(y - cy, x - cx) for x, y in p]
        a0, av, a1 = angs
        # the minor-branch angular midpoint, independent of declared order: closed_form_arc's own
        # true_via_point (H23 item 18) -- the same bisector-of-end-unit-vectors math this test
        # always used, now the one declared place that math lives.
        u0 = ((p[0][0] - cx) / r, (p[0][1] - cy) / r)
        u1 = ((p[2][0] - cx) / r, (p[2][1] - cy) / r)
        if math.hypot(u0[0] + u1[0], u0[1] + u1[1]) < 1e-9:
            continue  # a half-turn arc has no minor-branch midpoint
        vx, vy = true_via_point((cx, cy), r, p[0], p[2])
        mid_ang = math.atan2(vy - cy, vx - cx)
        off = abs(math.degrees((av - mid_ang + math.pi) % (2 * math.pi) - math.pi))
        off = min(off, abs(180 - off))  # the major-branch midpoint is just as valid a "declared major" seed
        worst_deg = max(worst_deg, off)
    print(f"{tid}: worst via-vs-true-midpoint offset = {worst_deg:.2f} deg (7x9)")
    if tid in EXACT_SEED_TEMPLATES:
        assert worst_deg < 0.01, f"{tid} declares an exact-seed contract but its worst offset is {worst_deg:.2f} deg"


# ---------------------------------------------------------------------------
# Check 3: convex radius vs bar thickness -- declared known list, enforced
# ---------------------------------------------------------------------------
# H23 item 28: MEASURED (this check, every board size) which templates have at least one convex
# arc at or below frame_thickness -- Fred: accepted, warn-only cases, not a to-do. A template not
# in this set that starts failing is a NEW finding to report; an entry here whose template stops
# failing is a stale entry to prune (the test below enforces both directions).
KNOWN_CONVEX_RADIUS_BELOW_BAR = {
    'template_1', 'template_2', 'template_3', 'template_4', 'template_5',
    'template_8', 'template_10', 'template_11', 'template_12', 'template_13',
}


@pytest.mark.parametrize("tid", TEMPLATE_IDS)
def test_convex_radius_vs_frame_thickness_known_list(tid, capsys):
    t, sk = _shape_outline_sketch(tid)
    items = _all_items(sk)
    arcs = [it for it in items if it.get('Type') == 'Arc3Point']
    radius_dims = {it['Target']: it['Expression'] for it in items if it.get('Type') == 'Radius'}
    enclosure = next((s for s in t['Sketches'] if 'frame_enclosure' in s['Name']), None)
    ft_param = next((p for s in t['Sketches'] for p in s.get('Parameters', []) if p.get('Name') == 'frame_thickness'), None)
    ft_default = ft_param['Val'] if ft_param else 0.75
    findings = []
    for (W, H) in BOARDS:
        ev = _ev_factory(W, H, BBO, sk)
        pts_by_id = {it['ID']: [(ev(x), ev(y)) for x, y in it['Points']] for it in items
                     if it.get('Type') in ('Line', 'Arc3Point') and 'Points' in it}
        all_pts = [pt for pts in pts_by_id.values() for pt in pts]
        if not all_pts:
            continue
        cx = sum(p[0] for p in all_pts) / len(all_pts)
        cy = sum(p[1] for p in all_pts) / len(all_pts)
        for it in arcs:
            pid = it['ID']
            p = pts_by_id[pid]
            cc = _circumcircle(*p)
            if cc is None:
                continue
            _, r_seed = cc
            if pid in radius_dims:
                try:
                    r = ev(radius_dims[pid])
                except Exception:
                    r = r_seed
            else:
                r = r_seed
            chord_mid = ((p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2)
            via_d = math.hypot(p[1][0] - cx, p[1][1] - cy)
            chord_d = math.hypot(chord_mid[0] - cx, chord_mid[1] - cy)
            convex = via_d > chord_d
            if convex and r <= ft_default:
                findings.append((W, H, pid, round(r, 4)))
    print(f"{tid}: frame_thickness={ft_default}, convex-arc-below-bar: {findings}")
    has_findings = bool(findings)
    known = tid in KNOWN_CONVEX_RADIUS_BELOW_BAR
    assert has_findings == known, (
        f"{tid}: convex-radius-below-bar status changed (findings={findings}) -- "
        f"{'add to' if has_findings else 'remove'} KNOWN_CONVEX_RADIUS_BELOW_BAR "
        f"{'' if has_findings else 'this stale entry '}(shape fixes are still the advisor's own "
        f"per-template call, not this test's)")
