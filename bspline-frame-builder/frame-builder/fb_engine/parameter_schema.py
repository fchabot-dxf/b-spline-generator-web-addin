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


class ParameterSchema:
    """Stateless registry for Fusion userParameter unit/validation rules.

    Methods are classmethods so call sites don't need to instantiate; the
    rules are global and there is no per-instance state worth carrying.
    """

    UNITLESS_PREFIXES = _UNITLESS_PREFIXES
    BOARD_OWNED_PARAMS = _BOARD_OWNED_PARAMS

    @classmethod
    def is_board_owned(cls, name):
        """True for a param the frame builder must never create or
        write — only Send to Fusion (b-spline-gen) owns these."""
        return name in cls.BOARD_OWNED_PARAMS

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
        """Pure name-based unit guess. ``'deg'`` for Taper params,
        ``'in'`` for everything else (length).

        Length params display in inches to match the imperial-authoring
        convention used by ``template_data.py`` and the b-spline add-in;
        Fusion still stores everything in cm internally.
        """
        if 'Taper' in name:
            return 'deg'
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
          3. Fall back to :py:meth:`name_based_unit` — ``'deg'`` for Taper,
             ``'in'`` for length.

        Replaces three copy-pasted hardcodes that defaulted to ``'cm'``
        and silently demoted ReadOnly inches params (``widthIn``,
        ``heightIn``, etc.) on first add.
        """
        if p_info is not None and 'Unit' in p_info:
            return p_info['Unit']
        if cls.is_unitless(name):
            return ''
        return cls.name_based_unit(name)

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
