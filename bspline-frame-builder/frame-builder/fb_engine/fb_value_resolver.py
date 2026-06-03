"""
FBValueResolver - The Geometric Brain of the FrameBuilder.
Handles unit normalization, aesthetic scaling, and parameter resolution.
Ensures metric (cm) consistency across the entire build pipeline.
"""
import adsk.core

# Unit-default rules now live in ``parameter_schema.ParameterSchema`` —
# the single source of truth used by every site that creates / updates
# Fusion userParameters. The module-level ``default_unit_for`` and
# ``determine_unit`` names below are kept as backward-compat shims so
# existing callers (parametric_engine, sketch_builder_ui) keep working;
# new code should import ``ParameterSchema`` directly.
from fb_engine.parameter_schema import (
    ParameterSchema,
    _UNITLESS_PREFIXES,
    default_unit_for,
    determine_unit,
)


class FBValueResolver:
    def __init__(self, design, logger=None):
        self.design = design
        self.logger = logger
        self.units_manager = design.unitsManager

    def get_base_frame_requirements(self):
        """Returns the standardized metric defaults for every frame."""
        return {
            'frame_thickness':      -1.905, # -0.75 in (XY Inset)
            'Skel_Slot_Tolerance':   0.635, #  0.25 in
            'boundingboxoffset':     0.635, #  0.25 in
            'Skel_Frame_Taper':      0.0,
        }

    def resolve_dna_parameter(self, p_info, active_vars=None):
        """
        Resolves a Template parameter spec into a Fusion-safe (expression, unit).
        Handles metric enforcement and cross-unit evaluation.
        Prioritizes UI overrides and converts Factor inputs to Parametric Expressions.
        """
        name = p_info.get("Name", "?")
        raw_val = p_info.get("Val", 0)
        target_unit = p_info.get("Unit", "cm")

        # 1. UI Override Priority
        if active_vars and name in active_vars:
            raw_val = active_vars[name]

        # 2. Factor Wrapping (Unifies 'Val' defaults and 'active_vars' overrides)
        raw_val = self.wrap_expression_if_factor(name, raw_val)

        return str(raw_val), target_unit

    def wrap_expression_if_factor(self, name, value):
        """
        Wraps a numeric or string value in a widthIn/heightIn expression
        if the parameter name belongs to the scaled anatomy categories.
        Now hardened against string inputs with unit suffixes.
        """
        original_value = value
        try:
            # 1. Clean input: remove units if present (e.g. '1.03 cm' -> '1.03')
            val_str = str(value).lower().replace('cm', '').replace('in', '').replace('"', '').replace('mm', '').strip()

            # 2. Skip if already an expression
            if 'widthin' in val_str or 'heightin' in val_str or '*' in val_str:
                return value

            num_val = float(val_str)

            # 3. Categorized Wrapping (Case-Insensitive Match)
            name_lower = name.lower()

            # Width-based Drivers (Multipliers of widthIn)
            if name_lower in ['shoulderspan', 'waistspan', 'hipspan']:
                result = f"(widthIn * {num_val})"
            # Height-based Drivers (Multipliers of heightIn) - TopGap/BottomGap
            # are vertical offsets, Shoulder/Waist/HipRadius are arc radii that
            # also scale with frame height (so the silhouette stays proportional
            # as heightIn changes).
            elif name_lower in ['topgap', 'bottomgap',
                                'shoulderradius', 'waistradius', 'hipradius']:
                result = f"(heightIn * {num_val})"
            # Special Case: Waist Offset (Multiplier of half-height)
            elif name_lower == 'waistoffset':
                result = f"((heightIn / 2.0) * {num_val})"
            else:
                result = value

            if self.logger and result != original_value:
                self.logger.log(f"[RESOLVER] Wrapped '{name}': '{original_value}' -> '{result}'")
            return result
        except Exception as e:
            if self.logger:
                self.logger.log(f"[RESOLVER WARNING] Skipping wrap for '{name}' ({value}): {e}")

        return value

    def validate_unit_consistency(self, name, expression, target_unit):
        """
        Hardened unit check for live parameter syncing.
        Returns the resolved metric value for logging/verification.
        """
        try:
            resolved_cm = self.units_manager.evaluateExpression(str(expression), "cm")
            if target_unit == "cm":
                if self.logger:
                    self.logger.log(f"[UNIT GUARD] '{name}' = {expression} -> {resolved_cm:.3f} cm")
            return resolved_cm
        except Exception as e:
            if self.logger:
                self.logger.log(f"[UNIT GUARD WARNING] Failed to validate {name}: {e}")
            return None

    def determine_unit(self, name):
        """Backward-compat method - delegates to module-level
        ``determine_unit(name)`` so all callers (instance and free-function)
        share one implementation.
        """
        return determine_unit(name)
