"""
Build Context — Shared state and core helpers for the parametric engine.

All sub-modules (geometry, constraints, dimensions, etc.) receive a BuildContext
instance rather than importing each other. This eliminates circular dependencies
and keeps every module independently testable.
"""
import adsk.core, adsk.fusion


class BuildContext:
    """
    Carries the shared mutable state that every build phase needs.

    Attributes
    ----------
    app          : adsk.core.Application
    ui           : adsk.core.UserInterface
    target       : adsk.fusion.Component   — the Frame_N component we're drawing into
    design       : adsk.fusion.Design
    user_params  : adsk.fusion.UserParameters
    logger       : utils.logger.DebugLogger
    prefix       : str                      — e.g. "T1", "T2"
    sketches     : dict[str, adsk.fusion.Sketch]
    entity_map   : dict[str, dict[str, Any]]
    feature_count: int                      — monotonic counter for unique IDs
    """

    def __init__(self, target, design, logger, prefix="T1"):
        self.app = adsk.core.Application.get()
        self.ui = self.app.userInterface
        self.target = target
        self.design = design
        self.user_params = design.userParameters
        self.logger = logger
        self.prefix = prefix
        self.sketches = {}
        self.entity_map = {}
        self.feature_count = 1

    # ------------------------------------------------------------------
    # Expression resolver
    # ------------------------------------------------------------------
    def resolve_val(self, val):
        """Resolve a number or string expression (e.g. 'widthIn/2') to a float in CM."""
        if val is None:
            return 0.0
        if isinstance(val, (int, float)):
            return float(val)
        if isinstance(val, str):
            try:
                return float(val)
            except ValueError:
                try:
                    resolved = self.design.unitsManager.evaluateExpression(val, "cm")
                    self.logger.log(f"RESOLVED: {val} -> {resolved:.3f} cm")
                    return resolved
                except Exception:
                    self.logger.log_error(f"FAIL RESOLVE: {val}")
                    return 0.0
        return 0.0

    # ------------------------------------------------------------------
    # Entity naming / mapping
    # ------------------------------------------------------------------
    def set_id(self, entity, s_name, prefix, override_id=None):
        """
        Assign a semantic ID to a sketch entity and store it in the entity map.

        Parameters
        ----------
        entity      : Any sketch entity (SketchLine, SketchPoint, SketchArc …)
        s_name      : Sketch name key for entity_map
        prefix      : Fallback category prefix (e.g. "line", "arc", "point")
        override_id : Explicit ID to use instead of auto-generated one
        """
        if not entity:
            return
        final_id = override_id if override_id else f"{prefix}-{self.feature_count}"
        self.feature_count += 1
        try:
            if hasattr(entity, 'attributes'):
                attr = entity.attributes.itemByName('FrameBuilder', 'ID')
                if attr:
                    attr.value = final_id
                else:
                    entity.attributes.add('FrameBuilder', 'ID', final_id)
                # Backward-compat 'name' attribute
                attr_old = entity.attributes.itemByName('FrameBuilder', 'name')
                if attr_old:
                    attr_old.value = final_id
                else:
                    entity.attributes.add('FrameBuilder', 'name', final_id)

            if hasattr(entity, 'name'):
                entity.name = final_id

            self.entity_map[s_name][final_id] = entity
            self.logger.log(f"ATTR TAG: {final_id} assigned to {type(entity).__name__} in {s_name}", "DEBUG")
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Entity lookup (with :S / :E / :C suffix resolution)
    # ------------------------------------------------------------------
    def resolve_entity(self, s_name, entity_id):
        """
        Look up an entity by its ID string, handling :S / :E / :C suffixes.

        Returns None (with a log warning) if nothing is found.
        """
        g_map = self.entity_map.get(s_name, {})

        # Direct hit
        ent = g_map.get(entity_id)
        if ent:
            return ent

        # Split base:suffix
        if ":" not in entity_id:
            self.logger.log(f"RESOLVE MISS: {entity_id} not found in {s_name}", "WARNING")
            return None

        base, suffix = entity_id.rsplit(":", 1)
        ent = g_map.get(base)
        if not ent:
            self.logger.log(f"RESOLVE MISS: base '{base}' not found in {s_name}", "WARNING")
            return None

        if suffix == "S" and hasattr(ent, 'startSketchPoint'):
            return ent.startSketchPoint
        if suffix == "E" and hasattr(ent, 'endSketchPoint'):
            return ent.endSketchPoint
        if suffix == "C" and hasattr(ent, 'centerSketchPoint'):
            return ent.centerSketchPoint

        self.logger.log(f"RESOLVE MISS: suffix ':{suffix}' unsupported on {type(ent).__name__}", "WARNING")
        return None

    # ------------------------------------------------------------------
    # Parameter create / update
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Spatial Sorting / Classification
    # ------------------------------------------------------------------
    def classify_rect_lines(self, curves):
        """
        Classify 4 rectangle lines into Top, Right, Bottom, Left based on centroids.
        Returns a dict: {'top': curve, 'bottom': curve, 'left': curve, 'right': curve}
        """
        if not curves or len(curves) < 4:
            return {}

        # Calculate centroids
        centroids = []
        for i in range(len(curves)):
            c = curves[i]
            bbox = c.boundingBox
            cx = (bbox.minPoint.x + bbox.maxPoint.x) / 2
            cy = (bbox.minPoint.y + bbox.maxPoint.y) / 2
            centroids.append((cx, cy, i))

        # Sort by Y for Top/Bottom
        sorted_y = sorted(centroids, key=lambda p: p[1], reverse=True)
        top_idx = sorted_y[0][2]
        bottom_idx = sorted_y[-1][2]

        # Sort by X for Left/Right
        sorted_x = sorted(centroids, key=lambda p: p[0], reverse=True)
        right_idx = sorted_x[0][2]
        left_idx = sorted_x[-1][2]

        return {
            "top": curves[top_idx],
            "bottom": curves[bottom_idx],
            "left": curves[left_idx],
            "right": curves[right_idx]
        }

    def classify_points_by_quadrant(self, points, center_pt=None):
        """
        Classify a set of points into TL, TR, BL, BR relative to a center point.
        For each quadrant, selects the point farthest from center (the outer corner),
        not just the last point iterated — which is wrong for curved shapes with
        multiple vertices per quadrant.
        Returns a dict: {'TL': point, 'TR': point, 'BL': point, 'BR': point}
        """
        if not points:
            return {}

        cx, cy = 0, 0
        if center_pt:
            g = center_pt.geometry
            cx, cy = g.x, g.y
        else:
            # Fallback: compute average position
            for p in points:
                cx += p.geometry.x
                cy += p.geometry.y
            cx /= len(points)
            cy /= len(points)

        # For each quadrant, keep the point with maximum squared distance from center
        best = {}  # quadrant -> (dist_sq, point)
        for p in points:
            g = p.geometry
            dx, dy = g.x - cx, g.y - cy
            dist_sq = dx * dx + dy * dy
            if   dx >= 0 and dy >= 0: quad = "TR"
            elif dx <  0 and dy >= 0: quad = "TL"
            elif dx >= 0 and dy <  0: quad = "BR"
            else:                      quad = "BL"

            if quad not in best or dist_sq > best[quad][0]:
                best[quad] = (dist_sq, p)

        return {q: v[1] for q, v in best.items()}

    def create_or_update_param(self, name, val, unit):
        """Create a new user parameter or update its expression if it already exists."""
        try:
            param = self.user_params.itemByName(name)
            val_input = adsk.core.ValueInput.createByString(str(val))
            if param:
                param.expression = str(val)
                self.logger.log(f"PARAM SYNC: {name} = {val}")
            else:
                self.user_params.add(name, val_input, unit, "Frame Builder Parameter")
                self.logger.log(f"PARAM NEW: {name} = {val} ({unit})")
        except Exception:
            self.logger.log_error(f"Param Sync Failed: {name}")
