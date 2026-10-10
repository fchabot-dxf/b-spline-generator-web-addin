"""
2026-10-09 (seat A, measured live on claude_7's 74-node ballnose layer): _apply_declared_dimensions runs fb_engine's
DIMENSION_PHASES (create -> name -> drive) for ALL the manifest's dimensions at once -- every dimension created, then
every one named, then every one driven -- instead of the three per dimension (15-25 s -> 8.8-9.3 s; the solved
sketch identical to the bit: 89 curves, 74 dims, 124 constraints, fully constrained). Pinned here with the manifest
builder's own fakes: the order, and that the names / expressions end up exactly as before.

Run with:
    cd bspline-frame-builder/b-spline-gen
    python -m pytest test_dimension_phases.py
"""
import copy

import test_sketch_manifest_builder as T  # installs the fake adsk + exposes the fakes
from fb_engine.dimensions import DIMENSION_PHASES
from sketch_manifest_builder import build_constrained_sketch


class LoggingParameter(T.FakeParameter):
    def __setattr__(self, k, v):
        if k in ('name', 'expression') and 'attributes' in self.__dict__:  # after __init__: a real set
            T.CALL_LOG.append(('param.' + k, v))
        object.__setattr__(self, k, v)


def _three_nodes():
    m = copy.deepcopy(T._box_lattice_manifest(constrained=True))
    m['entities'] += [{'id': 'node1', 'type': 'Circle', 'center': [4.0, 1.0], 'radius': 0.075},
                      {'id': 'node2', 'type': 'Circle', 'center': [6.0, 3.0], 'radius': 0.075}]
    m['dimensions'] += [{'type': 'Diameter', 'target': 'node1', 'expression': 'node_diameter'},
                        {'type': 'Diameter', 'target': 'node2', 'expression': 'node_diameter'}]
    return m


def test_the_phases_are_declared_in_order():
    assert DIMENSION_PHASES == ('create', 'name', 'drive')


def test_every_dimension_is_created_then_every_one_named_then_every_one_driven(monkeypatch):
    monkeypatch.setattr(T, 'FakeParameter', LoggingParameter)
    T.CALL_LOG.clear()
    design = T.FakeDesign()
    build_constrained_sketch(design.rootComponent, design, _three_nodes())
    log = T.CALL_LOG
    creates = [i for i, e in enumerate(log) if e[0] == 'dim:Diameter']
    names = [i for i, e in enumerate(log) if e[0] == 'param.name' and str(e[1]).startswith('dim_node')]
    drives = [i for i, e in enumerate(log) if e[0] == 'param.expression' and e[1] == 'node_diameter']
    assert len(creates) == 3 and len(names) == 3 and len(drives) == 3
    assert max(creates) < min(names), 'every node dimension exists before any is named'
    assert max(names) < min(drives), 'every node dimension is named before any is driven'
    sketch = design.rootComponent._sketches[0]
    got = sorted((d.parameter.name, d.parameter.expression) for d in sketch.sketchDimensions if d.parameter.expression == 'node_diameter')
    assert got == [('dim_node0', 'node_diameter'), ('dim_node1', 'node_diameter'), ('dim_node2', 'node_diameter')]
