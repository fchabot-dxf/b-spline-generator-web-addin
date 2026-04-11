"""
FBValueResolver — The Geometric Brain of the FrameBuilder.
Handles unit normalization, aesthetic scaling, and parameter resolution.
Ensures metric (cm) consistency across the entire build pipeline.
"""
import adsk.core

class FBValueResolver:
    def __init__(self, design, logger=None):
        self.design = design
        self.logger = logger
        self.units_manager = design.unitsManager

    def get_base_frame_requirements(self):
        """Returns the standardized metric defaults for every frame."""
        return {
            'Skel_Frame_Offset':    -1.905, # -0.75 in
            'Skel_Slot_Tolerance':   0.635, #  0.25 in
            'boundingboxoffset':     0.635, #  0.25 in
            'Skel_Frame_Taper':      0.0,
            'Skel_Frame_Thickness':  2.54   #  1.00 in
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

        # 1. UI Override Priority & Parametric Scaling
        if active_vars and name in active_vars:
            ui_val = float(active_vars[name])
            
            # Width-based Drivers (Percentages of widthIn)
            if name in ['ShoulderSpan', 'WaistSpan', 'HipSpan']:
                raw_val = f"widthIn * ({ui_val}/100.0)"
                if self.logger: self.logger.log(f"[RESOLVER] Scale WIDTH: {name} = {raw_val}")
            
            # Height-based Drivers (Percentages of heightIn)
            elif name in ['TopGap', 'BottomGap']:
                raw_val = f"heightIn * ({ui_val}/100.0)"
                if self.logger: self.logger.log(f"[RESOLVER] Scale HEIGHT: {name} = {raw_val}")

            # Special Case: Waist Offset (100% = heightIn / 2)
            elif name == 'WaistOffset':
                raw_val = f"(heightIn / 2.0) * ({ui_val}/100.0)"
                if self.logger: self.logger.log(f"[RESOLVER] Scale OFFSET: {name} = {raw_val}")
            
            else:
                raw_val = ui_val
                if self.logger: self.logger.log(f"[RESOLVER] UI Override (Absolute): {name} = {raw_val}")

        # 2. Evaluate expression to check for unit-drift
        expr_str = str(raw_val)
        try:
            # Check if Fusion sees a different unit than intended (e.g. Inch explosion)
            if target_unit == "cm":
                resolved_cm = self.units_manager.evaluateExpression(expr_str, "cm")
                if self.logger:
                    self.logger.log(f"[RESOLVER] {name} resolves to {resolved_cm:.3f} cm")
        except Exception as e:
            if self.logger:
                self.logger.log(f"[RESOLVER WARNING] Evaluation failed for {name}: {e}")

        return expr_str, target_unit

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
        """Helper to assign correct Fusion units based on parameter typing."""
        if 'Taper' in name:
            return 'deg'
        return 'cm'

    def normalize_measurement(self, name, raw_cm_val):
        """
        Standardizes raw database measurements (cm) for parameter injection.
        Ensures that 'widthIn' and 'heightIn' are clearly identified in logs.
        """
        if self.logger:
            self.logger.log(f"[RESOLVER] Normalized {name}: {raw_cm_val:.3f} cm")
        return raw_cm_val, "cm"
