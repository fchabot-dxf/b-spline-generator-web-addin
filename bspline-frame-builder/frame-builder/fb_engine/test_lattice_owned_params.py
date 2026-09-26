"""
STALE-PARAMS R4 item 1: the LATTICE_OWNED_PARAMS registry + its accessor
(fb_engine/parameter_schema.py), added right beside BOARD_OWNED_PARAMS per
the advisor's ruling. No adsk stub needed — this module has no adsk import
at all (pure Python), unlike test_board_params_ownership.py's stub dance.

Run with:
    cd bspline-frame-builder/frame-builder
    python3 -m pytest fb_engine/test_lattice_owned_params.py
"""
from fb_engine.parameter_schema import ParameterSchema


class TestLatticeOwnedParams:
    def test_declared_list_is_exactly_the_seven_lattice_params(self):
        # Names as pushed by html/editor/editor-sketch-manifest.js
        # (:506,512,516,526,759,772,787,795) — the survey's own list
        # (STALE-PARAMS-DESIGN.md §1b).
        assert ParameterSchema.LATTICE_OWNED_PARAMS == (
            'stroke_width', 'rail_width', 'tie_width', 'node_diameter',
            'half_width', 'contour_width', 'contour_height',
        )

    def test_each_declared_name_is_lattice_owned(self):
        for name in ParameterSchema.LATTICE_OWNED_PARAMS:
            assert ParameterSchema.is_lattice_owned(name)

    def test_a_board_param_is_not_lattice_owned(self):
        assert not ParameterSchema.is_lattice_owned('widthIn')
        assert not ParameterSchema.is_lattice_owned('heightIn')

    def test_a_frame_param_is_not_lattice_owned(self):
        assert not ParameterSchema.is_lattice_owned('frame_thickness')
        assert not ParameterSchema.is_lattice_owned('boundingboxoffset')

    def test_an_unregistered_name_is_never_lattice_owned(self):
        assert not ParameterSchema.is_lattice_owned('node_radius')  # pre-NODE-D name, not registered
        assert not ParameterSchema.is_lattice_owned('anything_fred_typed')

    def test_board_and_lattice_registries_never_overlap(self):
        assert set(ParameterSchema.BOARD_OWNED_PARAMS).isdisjoint(ParameterSchema.LATTICE_OWNED_PARAMS)
