"""hole_chain.py -- the hole operations BUILD stamps into a setup, declared as DATA and made by ONE builder.

Fred's node holes (the 0.38 in circles) used to be a hand-added 3D pocket whose boundary he clicked circle by circle
(16 of the 20 were picked). The chain below replaces the clicking: two 3D pockets on EVERY whole circle of the panel's
constrained Source sketch, a larger tool first with rest machining OFF, then a smaller tool with rest machining ON from
the previous operations (seat D, measured live 2026-10-20 on a copy of his file: every hole reaches at least 0.35 in
past the far face; the rest source 'bodies' stops at the panel body and reaches only ~0.15, so it is never emitted).

Declared here (edit the table, not the builder):
  circle_sketch   which sketch holds the hole circles: its name ends with ``name_suffix`` and it holds whole circles;
                  the one with the most circles wins, the others are named in an INFO line, none = a WARNING and
                  nothing is built (never a guess)
  common          CAM parameter name -> expression, written on every op of the chain
  stock_to_leave  the one number Fred edits (verticalStockToLeave). MEASURED live: a CAM expression cannot read a design
                  user parameter ("Failed to evaluate expression"), so it is the same literal on each op
  tool            the minimal flat end mill the ops are made with; ``dia_in`` of each op fills the diameter
  ops             in cutting order: name, tool diameter (inches), rest source (None = rest off)

A project built before this existed keeps exactly its setups until the next APPLY, which adds the two operations.
Operations made here are recorded in op_ledger (leaf ``hole-chain:<key>``): a second APPLY stamps nothing again and only
re-binds the boundary circles when they are stale (a Send replaces the sketches the selection pointed at); Fred's own
operations, his hand-added hole pockets included, are never touched.
"""

from __future__ import annotations

import json
import math

import adsk.cam

from . import op_ledger

HOLE_CHAINS = {
    'node_holes': {
        'leaf': 'hole-chain:node_holes',
        'strategy': 'pocket_clearing',
        'circle_sketch': {'name_suffix': '[constrained]'},
        'boundary_param': 'machiningBoundarySel',
        'stock_to_leave': {'param': 'verticalStockToLeave', 'expr': '-0.6 in'},
        'common': {
            'boundaryMode': "'selection'",
            'boundaryContainment': "'inside'",
            'topHeight_mode': "'from stock top'",
            'topHeight_offset': '-0.3 in',
            'bottomHeight_mode': "'from stock bottom'",
            'bottomHeight_offset': '0 in',
            'maximumStepdown': '0.01 in',
            'rampType': "'plunge'",
            'useStockToLeave': 'true',
            'stockToLeave': '0 in',
            'tolerance': '0.004 in',
            'shaftAndHolderMode': "'non trimmed'",
        },
        'tool': {
            'type': 'flat end mill', 'unit': 'inches', 'description': 'Hole chain flat end mill',
            'number_of_flutes': 1, 'flute_length_in': 0.875, 'length_below_holder_in': 1.25, 'overall_length_in': 2.5,
            'rpm': 18000, 'feed_ipm': 55, 'plunge_ipm': 25, 'tool_number': 1,
        },
        'ops': [
            {'name': 'Holes A 3-16 rough', 'dia_in': 0.1875, 'rest_source': None},
            {'name': 'Holes B 1-8 rest', 'dia_in': 0.125, 'rest_source': 'previousOperations'},
        ],
    },
}

# strategies a hand-added hole pocket can carry (the strategy parameter reads 'pocket_new', operation.strategy 'pocket_clearing')
_POCKET_STRATEGIES = ('pocket_clearing', 'pocket_new')


def tool_json(tool, dia_in, name):
    """The Tool JSON for one op: the declared minimal flat end mill at ``dia_in``. Pure."""
    n = tool['rpm']
    return json.dumps({
        'BMC': 'carbide', 'GRADE': 'Mill Generic', 'description': f"{name} ({dia_in:g} in)", 'type': tool['type'],
        'unit': tool['unit'], 'vendor': '', 'product-id': '', 'product-link': '',
        'geometry': {
            'CSP': False, 'DC': dia_in, 'HAND': True, 'LB': tool['length_below_holder_in'], 'LCF': tool['flute_length_in'],
            'NOF': tool['number_of_flutes'], 'NT': 1, 'OAL': tool['overall_length_in'], 'RE': 0, 'SFDM': dia_in,
            'TA': 0, 'TP': 0, 'shoulder-diameter': dia_in, 'shoulder-length': tool['flute_length_in'],
            'tip-diameter': 0, 'tip-length': 0, 'tip-offset': 0, 'thread-profile-angle': 60,
        },
        'post-process': {'break-control': False, 'comment': '', 'diameter-offset': tool['tool_number'],
                         'length-offset': tool['tool_number'], 'live': True, 'manual-tool-change': False,
                         'number': tool['tool_number'], 'turret': 0},
        'start-values': {'presets': [{
            'name': 'Default preset', 'description': '', 'n': n, 'n_ramp': n, 'v_f': tool['feed_ipm'],
            'v_f_leadIn': tool['feed_ipm'], 'v_f_leadOut': tool['feed_ipm'], 'v_f_transition': tool['feed_ipm'],
            'v_f_plunge': tool['plunge_ipm'], 'v_f_ramp': tool['plunge_ipm'], 'ramp-angle': 2,
            'v_c': math.pi * dia_in * n / 12.0, 'f_n': tool['plunge_ipm'] / n,
            'f_z': tool['feed_ipm'] / (n * tool['number_of_flutes']), 'tool-coolant': 'flood',
            'use-stepdown': False, 'use-stepover': False,
            'material': {'category': 'all', 'query': '', 'use-hardness': False}}]},
    })


def op_expressions(chain, op):
    """{parameter: expression} written on one op, in order: the common ones, the stock to leave, then the rest options.
    Rest is ON only with a rest source, and the source is never 'bodies' (it caps the cut at the panel body)."""
    out = dict(chain['common'])
    out[chain['stock_to_leave']['param']] = chain['stock_to_leave']['expr']
    src = op.get('rest_source')
    if src:
        if src == 'bodies':
            raise ValueError("hole chain: rest source 'bodies' caps the cut at the panel body -- never declared")
        out['useRestMachining'] = 'true'
        out['restMaterialSource'] = f"'{src}'"
    else:
        out['useRestMachining'] = 'false'
    return out


def pick_sketch(candidates, suffix, logger=None):
    """candidates: [(name, n_circles, handle)]. The sketch whose name ends with ``suffix`` and holds whole circles; the
    one with the most circles wins (ties: the first), the others are named in an INFO line. None when none matches."""
    hits = [c for c in candidates if str(c[0]).endswith(suffix) and c[1] > 0]
    if not hits:
        return None
    best = hits[0]
    for c in hits[1:]:
        if c[1] > best[1]:
            best = c
    others = [f"{c[0]!r} ({c[1]})" for c in hits if c is not best]
    if others:
        _log(logger, f"HOLE CHAIN: circles taken from {best[0]!r} ({best[1]}); also matched, not used: {', '.join(others)}")
    return best


def _coll(c):
    """The items of a Fusion collection (count / item) or a plain list."""
    try:
        return [c.item(i) for i in range(c.count)]
    except Exception:
        return list(c)


def hole_circles(mm, chain, logger=None):
    """The whole SketchCircles (assembly-context proxies, what a CAM selection takes) of the declared sketch in the
    panel's Manufacturing Model, or [] (WARNING: nothing is guessed)."""
    cands = []
    try:
        comp = mm.occurrence.component
        scopes = [(None, comp)] + [(o, o.component) for o in _coll(comp.allOccurrences)]
        for occ, c in scopes:
            for sk in _coll(c.sketches):
                try:
                    n = sk.sketchCurves.sketchCircles.count
                except Exception:
                    n = 0
                cands.append((sk.name, n, (sk, occ)))
    except Exception as e:
        _log(logger, f"HOLE CHAIN: reading the MM's sketches failed: {type(e).__name__}: {e}", "WARNING")
        return []
    best = pick_sketch(cands, chain['circle_sketch']['name_suffix'], logger)
    if best is None:
        _log(logger, f"HOLE CHAIN: no sketch ending '{chain['circle_sketch']['name_suffix']}' with whole circles "
             f"in the MM -- no hole operations made", "WARNING")
        return []
    sk, occ = best[2]
    try:
        proxy = sk.createForAssemblyContext(occ) if occ is not None else sk
        return _coll(proxy.sketchCurves.sketchCircles)
    except Exception as e:
        _log(logger, f"HOLE CHAIN: reading the circles of {best[0]!r} failed: {type(e).__name__}: {e}", "WARNING")
        return []


def _set_param(params, name, expr, logger):
    try:
        p = params.itemByName(name)
        if not p:
            _log(logger, f"HOLE CHAIN: parameter '{name}' not present", "WARNING")
            return False
        p.expression = str(expr)
        return True
    except Exception as e:
        _log(logger, f"HOLE CHAIN: set {name}={expr!r} failed: {e}", "WARNING")
        return False


def _circle_key(c):
    """A circle's place: its centre (world, cm) and radius, rounded. Measured live: the entity tokens of a selection's
    circles and of freshly read proxies differ for the same circle (and a selection lists each circle twice), so
    identity is read from the geometry."""
    g = c.centerSketchPoint.worldGeometry
    return (round(g.x, 4), round(g.y, 4), round(g.z, 4), round(c.radius, 4))


def _selection_matches(param, circles):
    """True when the op's boundary already is exactly these circles (so a re-APPLY leaves a valid toolpath alone).
    An unreadable selection (a dead reference) is a mismatch."""
    try:
        cs = param.value.getCurveSelections()
        have = set()
        for i in range(cs.count):
            have.update(_circle_key(x) for x in cs.item(i).inputGeometry)
        return have == {_circle_key(c) for c in circles}
    except Exception:
        return False


def _apply_circles(param, circles):
    """Replace the op's boundary with one chain selection per circle."""
    v = param.value
    cs = v.getCurveSelections()
    cs.clear()
    for c in circles:
        sel = cs.createNewChainSelection()
        sel.inputGeometry = [c]
    v.applyCurveSelections(cs)


def build_hole_chain(setup, mm, design, key, logger=None):
    """Make (or, for ops it already made, re-bind) the declared hole chain in ``setup``. Returns
    {'created': [names], 'rebound': [names], 'skipped': reason or None}. Never raises."""
    chain = HOLE_CHAINS[key]
    out = {'created': [], 'rebound': [], 'skipped': None}
    try:
        _build(setup, mm, design, chain, out, logger)
    except Exception as e:
        out['skipped'] = f"{type(e).__name__}: {e}"
        _log(logger, f"HOLE CHAIN ({setup.name}): raised {type(e).__name__}: {e}", "WARNING")
    return out


def _build(setup, mm, design, chain, out, logger):
    setup_name = setup.name
    leaf = chain['leaf']
    ops = op_ledger._ops(setup)
    mine = [o for o in ops if op_ledger.op_key(o) in set((op_ledger.load(design, setup_name) or {}).get(leaf, []))]
    foreign = [o for o in op_ledger.foreign_operations(design, setup, setup_name)
               if getattr(o, 'strategy', None) in _POCKET_STRATEGIES]
    if foreign:
        _log(logger, f"HOLE CHAIN ({setup_name}): hand-added pocket operation(s) {[o.name for o in foreign]} left as they "
             f"are -- they may cut the holes a second time (suppress them if the chain replaces them)")
    circles = hole_circles(mm, chain, logger)
    if not circles:
        out['skipped'] = 'no hole circles'
        return
    has_record = op_ledger.load(design, setup_name) is not None
    held = op_ledger.holds_template(design, setup, setup_name, leaf) if has_record else \
        any(op_ledger.named_like(setup, o['name']) for o in chain['ops'])
    if held:
        for o in mine:
            p = o.parameters.itemByName(chain['boundary_param'])
            if _selection_matches(p, circles):
                continue
            _apply_circles(p, circles)
            out['rebound'].append(o.name)
        _log(logger, f"HOLE CHAIN ({setup_name}): already made -- boundary re-bound on {len(out['rebound'])} op(s), nothing added")
        return
    made = []
    for decl in chain['ops']:
        inp = setup.operations.createInput(chain['strategy'])
        inp.tool = adsk.cam.Tool.createFromJson(tool_json(chain['tool'], decl['dia_in'], decl['name']))
        try:
            inp.displayName = decl['name']
        except Exception as e:
            _log(logger, f"HOLE CHAIN ({setup_name}): displayName {decl['name']!r} failed: {e}", "WARNING")
        for pname, expr in op_expressions(chain, decl).items():
            _set_param(inp.parameters, pname, expr, logger)
        _apply_circles(inp.parameters.itemByName(chain['boundary_param']), circles)
        op = setup.operations.add(inp)
        made.append(op)
        out['created'].append(getattr(op, 'name', decl['name']))
    op_ledger.record(design, setup_name, leaf, made)
    _log(logger, f"HOLE CHAIN ({setup_name}): made {out['created']} on {len(circles)} circle(s)")


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
