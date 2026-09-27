"""
ParameterSchema — single source of truth for Fusion userParameter
unit defaulting and validation rules.

History
-------
Three sites used to default parameter units independently:
  * ``parametric_engine._sync_user_parameters``
  * ``ui.sketch_builder_ui._update_fusion_param``
  * ``fb_engine.frame_engine._create_skeletal_parameters``

The first two were unified through ``fb_value_resolver.default_unit_for``,
but ``_create_skeletal_parameters`` still hand-rolled its own logic — using
``self.resolver.determine_unit`` for base requirements and
``p_info.get("Unit", "cm")`` for ReadOnly master parameters.

This module owns ALL unit-default decisions. ``fb_value_resolver`` exposes
backward-compat shims that delegate here; new code should import
``ParameterSchema`` directly.
"""


# Booleans / 0-or-1 toggles declared in template_data.py with Unit="".
# Any param whose name starts with one of these prefixes is unitless,
# regardless of whether a schema dict is available.
_UNITLESS_PREFIXES = ('en_', 'is_', 'ck_')

# FB-ORDER (Fred: "only Send to Fusion can create" widthIn/heightIn):
# the board dimensions are created/updated EXCLUSIVELY by Send to Fusion
# (b-spline-gen) — the frame builder only ever READS them (via Fusion
# expressions, e.g. template_factory.py's "widthIn/2 - boundingboxoffset").
# Declared once here (the same "one source of truth" reasoning this
# module's own docstring already gives for unit defaulting) so every
# frame-builder call site that touches userParameters checks against
# this SAME list rather than each hand-rolling its own widthIn/heightIn
# string literals that could silently drift apart.
_BOARD_OWNED_PARAMS = ('widthIn', 'heightIn')

# STALE-PARAMS R4 (advisor ruling, 2026-09-26): the Shape Lattice / constrained-
# sketch parameters b-spline-gen's OWN sketch_manifest_builder.py creates
# (`_sync_manifest_parameters`), declared here for the SAME reason as
# _BOARD_OWNED_PARAMS above — one list every "is this ours" check reads,
# rather than each call site (b-spline-gen/param_ownership.py, tests, …)
# hand-rolling its own copy of these 7 literal names
# (html/editor/editor-sketch-manifest.js:506,512,516,526,759,772,787,795).
# Ruling: this registry is the ONLY change allowed in frame-builder/ for
# R4 — the cleanup LOGIC lives in b-spline-gen/ and reads this list; it
# never holds its own name list. Tag group: 'Bspline' (same group as the
# board params — one Send surface, one tag; see STALE-PARAMS-DESIGN.md
# "R4 rulings").
_LATTICE_OWNED_PARAMS = (
    'stroke_width', 'rail_width', 'tie_width', 'node_diameter',
    'half_width', 'contour_width', 'contour_height',
)

# F22 PANEL LIP (Fred: "if needed add a param in fusion"): the ONE user parameter a frame build may create,
# the exception to "frames never get new params". Group 'FrameBuilder' (tagged FrameBuilder.owner), written only by
# [Send frame] (fb_engine/send_frame.py sync_panel_lip_param); the B-spline Send's cleanup (board + lattice
# groups) never touches it.
PANEL_LIP_PARAM = 'panel_lip'
_FRAME_OWNED_PARAMS = (PANEL_LIP_PARAM,)

# FB-FIX (F4): the ONE unit table for parsing a unit-suffixed value
# ('0.75 in', '19 mm', '0.75"') to Fusion's internal cm. Before this,
# BuildContext.resolve_val did float('0.75 in'), which raised and was swallowed
# as a silent 0 cm, so the frame got no bars (measured F3).
_UNIT_TO_CM = {
    'cm': 1.0, 'mm': 0.1, 'm': 100.0,
    'in': 2.54, 'inch': 2.54, 'inches': 2.54, '"': 2.54,
    'ft': 30.48,
}


class ResolveError(ValueError):
    """A value that cannot be resolved. The build reports it; it is never
    silently turned into 0."""


class ParameterSchema:
    """Stateless registry for Fusion userParameter unit/validation rules.

    Methods are classmethods so call sites don't need to instantiate; the
    rules are global and there is no per-instance state worth carrying.
    """

    UNITLESS_PREFIXES = _UNITLESS_PREFIXES
    BOARD_OWNED_PARAMS = _BOARD_OWNED_PARAMS
    LATTICE_OWNED_PARAMS = _LATTICE_OWNED_PARAMS
    FRAME_OWNED_PARAMS = _FRAME_OWNED_PARAMS

    @classmethod
    def is_board_owned(cls, name):
        """True for a param the frame builder must never create or
        write — only Send to Fusion (b-spline-gen) owns these."""
        return name in cls.BOARD_OWNED_PARAMS

    @classmethod
    def is_lattice_owned(cls, name):
        """True for a Shape Lattice / constrained-sketch parameter name
        (STALE-PARAMS R4) — the accessor every 'is this ours' check
        reads instead of holding its own copy of LATTICE_OWNED_PARAMS."""
        return name in cls.LATTICE_OWNED_PARAMS

    @classmethod
    def is_frame_owned(cls, name):
        """True for a parameter only [Send frame] creates / writes / removes (F22: panel_lip)."""
        return name in cls.FRAME_OWNED_PARAMS

    # ------------------------------------------------------------------
    # Unit resolution
    # ------------------------------------------------------------------

    @classmethod
    def is_unitless(cls, name):
        """True if ``name`` is a known boolean / toggle parameter
        (``en_``, ``is_``, ``ck_`` prefix)."""
        return name.startswith(cls.UNITLESS_PREFIXES)

    @classmethod
    def name_based_unit(cls, name):
        """Pure name-based unit guess: ``'in'`` (length).

        Length params display in inches to match the imperial-authoring
        convention used by ``template_data.py`` and the b-spline add-in;
        Fusion still stores everything in cm internally. (The former
        ``'deg'``-for-Taper rule existed only for ``Skel_Frame_Taper``,
        which nothing read — the extrude hard-codes 0° — and was
        removed with it in FB-APP S0.)
        """
        return 'in'

    @classmethod
    def default_unit(cls, name, p_info=None):
        """Single source of truth for what unit a Fusion userParameter
        should take when stub-creating it.

        Priority:
          1. Schema (``p_info['Unit']``) when provided — ``template_data.py``
             is authoritative. Empty-string ('') is a valid declared unit
             and must NOT fall through to the name-based guess.
          2. Boolean-toggle prefixes (``en_``, ``is_``, ``ck_``) → ``''``
             (unitless floats).
          3. Fall back to :py:meth:`name_based_unit` — ``'in'`` (length).

        Replaces three copy-pasted hardcodes that defaulted to ``'cm'``
        and silently demoted ReadOnly inches params (``widthIn``,
        ``heightIn``, etc.) on first add.
        """
        if p_info is not None and 'Unit' in p_info:
            return p_info['Unit']
        if cls.is_unitless(name):
            return ''
        return cls.name_based_unit(name)

    UNIT_TO_CM = _UNIT_TO_CM

    @classmethod
    def to_cm(cls, value, default_unit):
        """Parse a number or a unit-suffixed string to cm.

        A bare number takes ``default_unit`` (a param's declared unit, e.g.
        'in'). Unitless (``default_unit == ''``) returns the float as-is.
        Raises :class:`ResolveError` for anything it cannot parse: never 0.
        """
        if isinstance(value, bool):
            raise ResolveError(f"cannot resolve boolean {value!r}")
        if isinstance(value, (int, float)):
            number, unit = float(value), default_unit
        else:
            text = str(value).strip()
            unit = None
            for suffix in sorted(cls.UNIT_TO_CM, key=len, reverse=True):
                if text.lower().endswith(suffix) and suffix:
                    head = text[: -len(suffix)].strip()
                    try:
                        number = float(head)
                    except ValueError:
                        continue
                    unit = suffix
                    break
            if unit is None:
                try:
                    number, unit = float(text), default_unit
                except ValueError:
                    raise ResolveError(f"cannot resolve {value!r}: not a number with a known unit")
        if not unit:
            return number
        if unit not in cls.UNIT_TO_CM:
            raise ResolveError(f"cannot resolve {value!r}: unknown unit {unit!r}")
        return number * cls.UNIT_TO_CM[unit]

    # ------------------------------------------------------------------
    # Expression construction helpers
    # ------------------------------------------------------------------

    @classmethod
    def master_expression(cls, p_info):
        """Build a unit-suffixed expression string for a ReadOnly master
        parameter declared in ``template_data.py``.

        ``createByString`` honors the unit suffix so a schema like
        ``Val=5.51, Unit="in"`` creates 5.51 in (≈ 13.99 cm internally).
        ``createByReal`` would have stored 5.51 as cm regardless of the
        unit display field, silently truncating inch-authored values to
        ~40% of their intended size.
        """
        default_val = float(p_info.get('Val', 0))
        unit = cls.default_unit(p_info.get('Name', ''), p_info)
        if unit:
            return f"{default_val} {unit}".strip()
        return str(default_val)


# ---------------------------------------------------------------------------
# Backward-compat module-level shims. New code should use
# ``ParameterSchema`` directly.
# ---------------------------------------------------------------------------

def default_unit_for(name, p_info=None):
    """Backward-compat shim. Delegates to :py:meth:`ParameterSchema.default_unit`."""
    return ParameterSchema.default_unit(name, p_info)


def determine_unit(name):
    """Backward-compat shim. Delegates to
    :py:meth:`ParameterSchema.name_based_unit`."""
    return ParameterSchema.name_based_unit(name)
