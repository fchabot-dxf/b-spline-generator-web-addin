import adsk.core, adsk.fusion, traceback

class ValueResolver:
    """Handles resolution of numeric values and semantic expressions (e.g., 'ShoulderSpan/2')."""
    def __init__(self, design, logger, local_values=None):
        self.design = design
        self.logger = logger
        self.local_values = local_values or {}

    def resolve(self, val):
        """Resolves a number or string expression to a float in CM."""
        if val is None: return 0.0
        if isinstance(val, (int, float)): return float(val)
        
        if isinstance(val, str):
            try: return float(val)
            except:
                # 1. Local Value Map (Semantic Names)
                working_val = val
                
                # Pre-handle unary minus if it's a simple -VariableName
                clean_val = val
                is_negative = False
                if val.startswith('-') and val[1:] in self.local_values:
                    clean_val = val[1:]
                    is_negative = True

                if self.local_values:
                    # Sort keys by length descending to avoid partial matches
                    for k in sorted(self.local_values.keys(), key=len, reverse=True):
                        if k in working_val:
                            v = self.local_values[k]
                            working_val = working_val.replace(k, f"({v})")
                
                try: 
                    # Use evaluateExpression on the Fusion design context
                    # Fusion's evaluateExpression is robust, but our local replacement helps with non-Design params
                    resolved = self.design.unitsManager.evaluateExpression(working_val, "cm")
                    if working_val != val:
                        self.logger.log(f"RESOLVED (Local): {val} -> {working_val} -> {resolved:.3f} cm")
                    else:
                        self.logger.log(f"RESOLVED (Fusion): {val} -> {resolved:.3f} cm")
                    return resolved
                except Exception as e: 
                    self.logger.log_error(f"FAIL RESOLVE: {val} (Working: {working_val}) Error: {e}")
                    return 0.0
        return 0.0
