import adsk.core, adsk.fusion, traceback
import math

class Resolver:
    """Handles parameter resolution with focus on Scale Precision (Inches vs CM)."""
    def __init__(self, design, logger, local_values=None):
        self.design = design
        self.user_params = design.userParameters
        self.all_params = design.allParameters
        self.logger = logger
        self.local_values = local_values or {}

    def resolve(self, expr):
        """Resolves an expression. Raw floats = Inches. Injected vars = CMs."""
        # 1. Raw Numerical Input (From Template Arcs/Lines)
        if isinstance(expr, (int, float)): 
            # These are designer units (Inches) -> Scale to Fusion Internal (CM)
            return float(expr) * 2.54
            
        if not isinstance(expr, str): return 0.0
        
        working_expr = str(expr).strip()
        if not working_expr: return 0.0

        # 2. Local Variable Injection (These are already CMs from Fusion Sliders)
        # We wrap them in absolute units to stop Fusion from re-scaling them
        did_inject = False
        for key, val in self.local_values.items():
            if key in working_expr:
                # Append 'cm' to force Fusion to treat the injected raw value as absolute
                working_expr = working_expr.replace(key, f"({val} cm)")
                did_inject = True
        
        # 3. Design Parameter Lookup (No math, just direct name)
        if not did_inject:
            try:
                param = self.all_params.itemByName(working_expr)
                if param: return param.value
            except: pass
        
        # 4. Pure Numerical String (Treat as Inches)
        try:
            val = float(working_expr)
            return val * 2.54
        except ValueError:
            pass

        # 5. Fusion Expression Evaluation (The heavy lifter)
        try:
            # We evaluate. If we injected (16.8cm)/2, Fusion returns 8.4cm.
            # If the template had "widthIn/2", Fusion handles the parameter units.
            val = self.design.unitsManager.evaluateExpression(working_expr, "cm")
            # self.logger.log(f"   [MATH] {expr} -> {working_expr} = {val:.4f} cm", "DEBUG")
            return val
        except:
            # 6. Simple Python Fallback
            try:
                clean = working_expr.replace('in', '*2.54').replace('cm', '*1.0').replace('mm', '*0.1')
                res = float(eval(clean, {"__builtins__": None}, {}))
                return res
            except Exception as e:
                self.logger.log(f"   (FAIL) RESOLVE: {expr} [{working_expr}] -> 0.0", "ERROR")
                return 0.0

    def is_spec_enabled(self, spec, log_id=None):
        if not spec: return True
        if not spec.get("Enabled", True):
            if log_id: self.logger.log(f"   (SKIP) {log_id}: Enabled=False", "BUILD")
            return False
        
        param_name = spec.get("EnabledParam")
        if param_name:
            # Check local_values first (dialog toggles), then fall back to Fusion user params
            if param_name in self.local_values:
                if abs(self.local_values[param_name]) < 1e-6:
                    if log_id: self.logger.log(f"   (SKIP) {log_id}: {param_name} is OFF (local)", "BUILD")
                    return False
            else:
                try:
                    param = self.user_params.itemByName(param_name)
                    if param and abs(param.value) < 1e-6:
                        if log_id: self.logger.log(f"   (SKIP) {log_id}: {param_name} is OFF", "BUILD")
                        return False
                except: pass

        blocked_param = spec.get("BlockedParam")
        if blocked_param:
            # Check local_values first (dialog toggles), then fall back to Fusion user params
            if blocked_param in self.local_values:
                if abs(self.local_values[blocked_param]) > 1e-6:
                    if log_id: self.logger.log(f"   (SKIP) {log_id}: blocked by {blocked_param} (local)", "BUILD")
                    return False
            else:
                try:
                    param = self.user_params.itemByName(blocked_param)
                    if param and abs(param.value) > 1e-6:
                        if log_id: self.logger.log(f"   (SKIP) {log_id}: blocked by {blocked_param}", "BUILD")
                        return False
                except: pass

        if spec.get("IsDisabled"):
            if log_id: self.logger.log(f"   (SKIP) {log_id}: IsDisabled=True", "BUILD")
            return False
            
        return True
