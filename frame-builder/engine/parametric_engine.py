import adsk.core, adsk.fusion, traceback
import os
import math
import datetime
import re

class ParametricSketchBuilder:
    """
    Python-Native Parametric Engine (Instrumented).
    Hardened for unit-consistency and scale debugging.
    """
    def __init__(self, target, design, logger, prefix="T1", local_values=None):
        self.app = adsk.core.Application.get()
        self.ui = self.app.userInterface
        self.target = target 
        self.design = design
        self.user_params = design.userParameters
        self.logger = logger
        self.prefix = prefix
        self.local_values = local_values or {}
        self.sketches = {} 
        self.entity_map = {} 
        self.feature_count = 1
        # Deep projection trace is OFF by default; enable with FRAME_BUILDER_PROJ_TRACE=1 when needed.
        self.debug_projection_trace = os.getenv("FRAME_BUILDER_PROJ_TRACE", "0") != "0"
        # Per-entity projection info lines are noisy in normal runs; enable only when diagnosing.
        self.log_projection_details = os.getenv("FRAME_BUILDER_LOG_PROJECTION_DETAILS", "0") != "0"
        # Reject fallback reconciliation when candidate is too far from source geometry.
        self.max_projection_reconcile_dist_sq = float(os.getenv("FRAME_BUILDER_MAX_PROJ_RECONCILE_DIST_SQ", "16.0"))
        # Point-specific fallback threshold (keeps backward compatibility with existing env var).
        self.max_projection_reconcile_point_dist_sq = float(
            os.getenv("FRAME_BUILDER_MAX_PROJ_POINT_DIST_SQ", str(self.max_projection_reconcile_dist_sq))
        )
        # Line-specific fallback controls.
        self.max_projection_reconcile_line_mid_dist_sq = float(
            os.getenv("FRAME_BUILDER_MAX_PROJ_LINE_MID_DIST_SQ", "64.0")
        )
        self.min_projection_reconcile_line_dot = float(
            os.getenv("FRAME_BUILDER_MIN_PROJ_LINE_DOT", "0.85")
        )
        self._active_trace_token = None

    def _trace(self, message, level="DEBUG"):
        if self.debug_projection_trace:
            token = self._active_trace_token or "no-trace"
            self.logger.log(f"TRACE[{token}] {message}", level)

    def _safe_entity_type(self, entity):
        return type(entity).__name__ if entity else "None"

    def _map_keys_preview(self, sketch_name, limit=20):
        keys = list(self.entity_map.get(sketch_name, {}).keys())
        preview = keys[:limit]
        extra = len(keys) - len(preview)
        return preview, extra

    def _entity_token(self, ent):
        try:
            if ent and ent.isValid:
                return ent.entityToken
        except Exception:
            return None
        return None

    def _iter_sketch_entities(self, sketch):
        entities = []

        try:
            for i in range(sketch.sketchPoints.count):
                sp = sketch.sketchPoints.item(i)
                if sp and sp.isValid:
                    entities.append(sp)
        except Exception:
            pass

        curve_collections = [
            "sketchLines",
            "sketchArcs",
            "sketchCircles",
            "sketchFittedSplines",
            "sketchFixedSplines",
        ]
        for coll_name in curve_collections:
            coll = getattr(sketch.sketchCurves, coll_name, None)
            if not coll:
                continue
            try:
                for i in range(coll.count):
                    ent = coll.item(i)
                    if ent and ent.isValid:
                        entities.append(ent)
            except Exception:
                continue

        return entities

    def _entity_bucket_counts(self, sketch):
        counts = {
            "points": 0,
            "lines": 0,
            "arcs": 0,
            "circles": 0,
            "fittedSplines": 0,
            "fixedSplines": 0,
        }
        try:
            counts["points"] = sketch.sketchPoints.count
        except Exception:
            pass
        try:
            counts["lines"] = sketch.sketchCurves.sketchLines.count
        except Exception:
            pass
        try:
            counts["arcs"] = sketch.sketchCurves.sketchArcs.count
        except Exception:
            pass
        try:
            counts["circles"] = sketch.sketchCurves.sketchCircles.count
        except Exception:
            pass
        try:
            counts["fittedSplines"] = sketch.sketchCurves.sketchFittedSplines.count
        except Exception:
            pass
        try:
            counts["fixedSplines"] = sketch.sketchCurves.sketchFixedSplines.count
        except Exception:
            pass
        return counts

    def _project_phase_summary(self, sketch_name, phase_name, requested, outcomes):
        projected = []
        failed = []
        counts = {
            "projected": 0,
            "reconciled": 0,
            "zero_result": 0,
            "source_missing": 0,
            "suffix_missing": 0,
            "registration_failed": 0,
            "exception": 0,
        }
        for out in outcomes:
            status = out.get("status", "exception")
            counts[status] = counts.get(status, 0) + 1
            names = out.get("names", [])
            if names:
                projected.extend(names)
            if status != "projected":
                failed.append({
                    "source": out.get("source_id"),
                    "target": out.get("target_id"),
                    "status": status,
                    "reason": out.get("reason"),
                })

        self.logger.log(
            f"PHASE DONE: {phase_name} ({requested}) - "
            f"Summary={{projected:{counts.get('projected', 0)}, reconciled:{counts.get('reconciled', 0)}, zero_result:{counts.get('zero_result', 0)}, "
            f"source_missing:{counts.get('source_missing', 0)}, suffix_missing:{counts.get('suffix_missing', 0)}, "
            f"registration_failed:{counts.get('registration_failed', 0)}, exception:{counts.get('exception', 0)}}} "
            f"Projected={projected}"
        )
        if failed:
            self.logger.log(f"PHASE FAILURES: {phase_name} -> {failed}", "WARNING")

        key_preview, extra = self._map_keys_preview(sketch_name)
        self._trace(
            f"{phase_name} map snapshot keys={key_preview}{' ...+' + str(extra) if extra > 0 else ''}",
            "DEBUG",
        )

    def _project_snapshot_tokens(self, sketch):
        tokens = set()

        for ent in self._iter_sketch_entities(sketch):
            tok = self._entity_token(ent)
            if tok:
                tokens.add(tok)

        return tokens

    def _project_snapshot_entities(self, sketch, token_set):
        entities = []
        if not token_set:
            return entities

        for ent in self._iter_sketch_entities(sketch):
            tok = self._entity_token(ent)
            if tok and tok in token_set:
                entities.append(ent)

        return entities

    def _entity_reference_point(self, ent):
        if not ent:
            return None

        try:
            if hasattr(ent, "geometry") and ent.geometry and hasattr(ent.geometry, "x") and hasattr(ent.geometry, "y"):
                return ent.geometry
        except Exception:
            pass

        try:
            if hasattr(ent, "centerSketchPoint") and ent.centerSketchPoint and ent.centerSketchPoint.geometry:
                return ent.centerSketchPoint.geometry
        except Exception:
            pass

        try:
            if hasattr(ent, "startSketchPoint") and ent.startSketchPoint and ent.startSketchPoint.geometry:
                return ent.startSketchPoint.geometry
        except Exception:
            pass

        try:
            if hasattr(ent, "endSketchPoint") and ent.endSketchPoint and ent.endSketchPoint.geometry:
                return ent.endSketchPoint.geometry
        except Exception:
            pass

        return None

    def _entity_kind(self, ent):
        if not ent:
            return "unknown"
        if hasattr(ent, "startSketchPoint") and hasattr(ent, "endSketchPoint"):
            return "line_like"
        if hasattr(ent, "geometry") and ent.geometry and hasattr(ent.geometry, "x") and hasattr(ent.geometry, "y"):
            return "point_like"
        if hasattr(ent, "centerSketchPoint"):
            return "curve_like"
        return "unknown"

    def _line_endpoints(self, ent):
        try:
            sp = ent.startSketchPoint.geometry
            ep = ent.endSketchPoint.geometry
            if sp and ep:
                return sp, ep
        except Exception:
            return None, None
        return None, None

    def _line_midpoint(self, ent):
        sp, ep = self._line_endpoints(ent)
        if not sp or not ep:
            return None
        return adsk.core.Point3D.create((sp.x + ep.x) / 2.0, (sp.y + ep.y) / 2.0, 0)

    def _line_unit_direction(self, ent):
        sp, ep = self._line_endpoints(ent)
        if not sp or not ep:
            return None
        dx = ep.x - sp.x
        dy = ep.y - sp.y
        mag = math.sqrt(dx * dx + dy * dy)
        if mag <= 1e-9:
            return None
        return (dx / mag, dy / mag)

    def _dot_abs(self, u, v):
        if not u or not v:
            return None
        return abs(u[0] * v[0] + u[1] * v[1])

    def _entity_sort_key(self, ent):
        kind = self._entity_kind(ent)
        pt = self._entity_reference_point(ent)
        x = round(pt.x, 6) if pt else 0.0
        y = round(pt.y, 6) if pt else 0.0
        tok = self._entity_token(ent) or ""
        return (kind, x, y, tok)

    def _pick_primary_projection_index(self, entities, src_ent):
        if not entities:
            return None
        src_kind = self._entity_kind(src_ent)
        for i, ent in enumerate(entities):
            cand_kind = self._entity_kind(ent)
            if src_kind == "line_like" and cand_kind == "line_like":
                return i
            if src_kind == "point_like" and cand_kind == "point_like":
                return i
        return 0

    def _target_quadrant_sign(self, target_id):
        if not target_id:
            return None
        base = target_id.split(":")[0]
        mapping = {
            "proj_TL": (-1, 1),
            "proj_TR": (1, 1),
            "proj_BL": (-1, -1),
            "proj_BR": (1, -1),
            "proj_off_corner_TL": (-1, 1),
            "proj_off_corner_TR": (1, 1),
            "proj_off_corner_BL": (-1, -1),
            "proj_off_corner_BR": (1, -1),
        }
        return mapping.get(base)

    def _point_sign(self, pt):
        if not pt:
            return None
        sx = 1 if pt.x >= 0 else -1
        sy = 1 if pt.y >= 0 else -1
        return (sx, sy)

    def _is_projection_related_target_id(self, target_id):
        if not target_id:
            return False
        base = target_id.split(":")[0]
        if base.startswith("proj_"):
            return True
        return False

    def _choose_projection_candidate(self, sketch, sketch_name, src_ent, new_tokens, target_id=None):
        src_pt = self._entity_reference_point(src_ent)
        if not src_pt:
            return None, "no_source_geometry", 0, None

        src_kind = self._entity_kind(src_ent)
        src_mid = self._line_midpoint(src_ent) if src_kind == "line_like" else None
        src_dir = self._line_unit_direction(src_ent) if src_kind == "line_like" else None

        mapped_tokens = set()
        for ent in self.entity_map.get(sketch_name, {}).values():
            tok = self._entity_token(ent)
            if tok:
                mapped_tokens.add(tok)

        all_entities = self._iter_sketch_entities(sketch)

        stage_candidates = []
        for ent in self._project_snapshot_entities(sketch, new_tokens):
            tok = self._entity_token(ent)
            if tok and tok not in mapped_tokens:
                stage_candidates.append(ent)
        stage = "snapshot_delta"

        if not stage_candidates:
            stage = "reference_scan"
            for ent in all_entities:
                tok = self._entity_token(ent)
                if tok and tok in mapped_tokens:
                    continue
                try:
                    is_ref = getattr(ent, "isReference", False)
                except Exception:
                    is_ref = False
                try:
                    is_construction = getattr(ent, "isConstruction", False)
                except Exception:
                    is_construction = False
                if is_ref or is_construction:
                    stage_candidates.append(ent)

        if not stage_candidates:
            stage = "unmapped_scan"
            for ent in all_entities:
                tok = self._entity_token(ent)
                if tok and tok in mapped_tokens:
                    continue
                stage_candidates.append(ent)

        if not stage_candidates:
            return None, stage, 0, None

        if src_kind == "point_like":
            stage_candidates = [c for c in stage_candidates if self._entity_kind(c) == "point_like"]
            if not stage_candidates:
                return None, stage, 0, None

        chosen = stage_candidates[0]
        best_d2 = None
        best_dot = None
        best = None
        for cand in stage_candidates:
            cand_kind = self._entity_kind(cand)
            c_pt = self._entity_reference_point(cand)
            if not c_pt:
                continue

            d2 = None
            line_dot = None
            if src_kind == "line_like" and src_mid is not None:
                c_mid = self._line_midpoint(cand) if cand_kind == "line_like" else None
                if c_mid is not None:
                    d2 = (c_mid.x - src_mid.x) ** 2 + (c_mid.y - src_mid.y) ** 2
                    cand_dir = self._line_unit_direction(cand)
                    line_dot = self._dot_abs(src_dir, cand_dir)
                else:
                    # Keep points as very weak fallback candidates for line sources.
                    d2 = (c_pt.x - src_pt.x) ** 2 + (c_pt.y - src_pt.y) ** 2 + 1e6
            else:
                d2 = (c_pt.x - src_pt.x) ** 2 + (c_pt.y - src_pt.y) ** 2

            if best_d2 is None or d2 < best_d2:
                best_d2 = d2
                best_dot = line_dot
                best = cand
        if best is None:
            return None, "no_candidate_geometry", len(stage_candidates), best_d2

        # Guard 1: don't bind a distant fallback candidate.
        if src_kind == "line_like":
            if best_d2 is None or best_d2 > self.max_projection_reconcile_line_mid_dist_sq:
                return None, "distance_threshold", len(stage_candidates), best_d2
            if best_dot is not None and best_dot < self.min_projection_reconcile_line_dot:
                return None, "orientation_mismatch", len(stage_candidates), best_d2
        else:
            if best_d2 is None or best_d2 > self.max_projection_reconcile_point_dist_sq:
                return None, "distance_threshold", len(stage_candidates), best_d2

        chosen = best

        # Guard 2: for explicit corner targets, candidate must be in the expected quadrant.
        expected_sign = self._target_quadrant_sign(target_id)
        if expected_sign is not None:
            chosen_pt = self._entity_reference_point(chosen)
            actual_sign = self._point_sign(chosen_pt)
            if actual_sign != expected_sign:
                return None, "quadrant_mismatch", len(stage_candidates), best_d2

        return chosen, stage, len(stage_candidates), best_d2

    def _resolve_val(self, val):
        """Resolves a number or string expression (e.g. 'widthIn/2') to a float in CM."""
        if val is None: return 0.0
        if isinstance(val, (int, float)): return float(val)
        
        if isinstance(val, str):
            try: return float(val)
            except:
                # 1. Check Local Value Map (Semantic Names)
                # If we have a local_map from the UI, replace keys in the expression with their literal values.
                # This allows 'ShoulderSpan/2' to work even if ShoulderSpan is not yet a parameter.
                working_val = val
                if self.local_values:
                    # Sort keys by length descending to avoid partial matches (e.g. 'ShoulderSpan' vs 'Shoulder')
                    for k in sorted(self.local_values.keys(), key=len, reverse=True):
                        if k in working_val:
                            # Use parentheses to preserve order of operations
                            v = self.local_values[k]
                            working_val = working_val.replace(k, f"({v})")
                
                try: 
                    # Use cm (database units) for resolution
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

    def build_template(self, template):
        self.logger.log(f"Building Template: {template.get('Name', 'Unnamed')}")
        
        # 1. Sync template parameters ONLY if they don't exist (protect measured values)
        for p in template.get("Parameters", []):
            name = p["Name"]
            unit = p.get("Unit", "")
            if not self._is_parameter_enabled(p):
                self.logger.log(f"PARAM SKIP: {name} (disabled by {p.get('EnabledParam')})")
                continue
            v = self._build_param_expression(p, unit)
            existing = self.user_params.itemByName(name)
            if not existing:
                self._create_or_update_param(name, v, unit)
            else:
                self.logger.log(f"PRESERVING MODEL PARAM: {name} (Template default {v} skipped)")

        # 2. Iterate through sketches
        for sketch_spec in template.get("Sketches", []):
            try:
                self.logger.log(f"--- Creating Sketch: {sketch_spec['Name']} ---")
                self.build_sketch(sketch_spec)
            except:
                self.logger.log_error(f"CRASH in Sketch {sketch_spec['Name']}:\n{traceback.format_exc()}")
        
        self.logger.log("PARASYNTHESIS COMPLETE: Frame Logic Fully Built", "INFO")
        self.logger.log("SYNTHESIS COMPLETE")

    def build_sketch(self, sketch_spec):
        sketch_name = f"{self.prefix}_{sketch_spec['Name']}"
        self._active_trace_token = f"{sketch_name}-{datetime.datetime.now().strftime('%H%M%S')}-{self.feature_count}"
        sketch = self.target.sketches.add(self.target.xZConstructionPlane)
        sketch.name = sketch_name
        self.sketches[sketch_name] = sketch
        self.entity_map[sketch_name] = {"ORIGIN": sketch.originPoint}
        self._trace("build_sketch start")
        # Project the vertical origin axis (Z axis on XZ plane) into the sketch
        try:
            z_axis = self.design.rootComponent.zConstructionAxis
            proj_axis = sketch.project(z_axis)
            if proj_axis.count > 0:
                self.entity_map[sketch_name]["Y_AXIS"] = proj_axis.item(0)
                self.logger.log(f"Y_AXIS projected into {sketch_name}")
        except Exception as e:
            self.logger.log(f"Y_AXIS projection skipped: {e}", "WARNING")
        
        # Build sequence:
        # 0. Projections (reference geometry from other sketches)
        # 1. PreGeometry (skeleton pins — before arcs)
        # 2. PreConstraints (skeleton H/V, Equal — before arcs exist)
        # 3. Geometry (manifold lines, arcs)
        # 4. Constraints (coincident chain, tangent, pin-to-arc)
        # 5. Dimensions (parametric size — lock size before offset)
        # 6. VolatileDimensions (secondary dims)
        # 7. Offsets (legacy direct offsets)
        # 8. Steps (offset, etc. — runs on fully constrained geometry)
        bbox_projs = sketch_spec.get("BoundingBoxProjections", [])
        skel_projs = sketch_spec.get("SkeletonProjections", [])
        pre_geoms = sketch_spec.get("PreGeometry", [])
        pre_constrs = sketch_spec.get("PreConstraints", [])
        pre_dims = sketch_spec.get("PreDimensions", [])
        geoms = sketch_spec.get("Geometry", [])
        constrs = sketch_spec.get("Constraints", [])
        post_geoms = sketch_spec.get("PostGeometry", [])
        post_constrs = sketch_spec.get("PostConstraints", [])
        dims = sketch_spec.get("Dimensions", [])
        vdims = sketch_spec.get("VolatileDimensions", [])
        offs = sketch_spec.get("Offsets", [])
        steps = sketch_spec.get("Steps", [])

        def _filter_logged(items, label):
            kept, dropped = [], []
            for item in items:
                reason = []
                if self._is_spec_enabled(item, _log_reason=reason):
                    kept.append(item)
                else:
                    item_id = item.get('ID') or item.get('Name') or item.get('Type') or '?'
                    dropped.append(f"{item_id}({', '.join(reason)})")
            if dropped:
                self.logger.log(f"SPEC DROP [{sketch_name}] {label}: {dropped}", "WARNING")
            return kept

        pre_geoms   = _filter_logged(pre_geoms,   "pre_geom")
        pre_constrs = _filter_logged(pre_constrs, "pre_constr")
        pre_dims    = _filter_logged(pre_dims,    "pre_dim")
        geoms       = _filter_logged(geoms,       "geom")
        constrs     = _filter_logged(constrs,     "constr")
        post_geoms  = _filter_logged(post_geoms,  "post_geom")
        post_constrs= _filter_logged(post_constrs,"post_constr")
        # dims        = _filter_logged(dims,        "dim")
        # vdims       = _filter_logged(vdims,       "vdim")

        self.logger.log(f"SKETCH PLAN [{sketch_name}]: {len(bbox_projs)}bbox_proj {len(skel_projs)}skel_proj {len(pre_geoms)}pre_geom {len(pre_constrs)}pre_constr {len(pre_dims)}pre_dim {len(geoms)}geom {len(constrs)}constr {len(post_geoms)}post_geom {len(post_constrs)}post_constr {len(dims)}dim {len(vdims)}vdim {len(offs)}off {len(steps)}step")


        # --- PROJECTION PHASES: Always run with deferred compute OFF ---
        sketch.isComputeDeferred = False
        # --- PHASE: Bounding Box Projections ---
        self.logger.log(f"START BoundingBoxProjections phase for {sketch_name} ({len(bbox_projs)} items)")
        bbox_outcomes = []
        for proj in bbox_projs:
            outcome = self._project_step(sketch, sketch_name, proj)
            bbox_outcomes.append(outcome)
        self._project_phase_summary(sketch_name, "BoundingBoxProjections", len(bbox_projs), bbox_outcomes)

        # --- PHASE: Skeleton Projections ---
        self.logger.log(f"START SkeletonProjections phase for {sketch_name} ({len(skel_projs)} items)")
        skel_outcomes = []
        for proj in skel_projs:
            outcome = self._project_step(sketch, sketch_name, proj)
            skel_outcomes.append(outcome)
        self._project_phase_summary(sketch_name, "SkeletonProjections", len(skel_projs), skel_outcomes)

        # --- PHASE: PreGeometry ---
        sketch.isComputeDeferred = True
        for geom in pre_geoms: self._geom_step(sketch, sketch_name, geom)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: PreGeom ({len(pre_geoms)}geom)")

        # --- PHASE: Snap-to-Seed (Soft Seeding) ---
        # Position points based on slider values BEFORE constraints can lock them.
        sketch.isComputeDeferred = False # Pulse to ensure geometry is 'live'
        for dim in (dims + vdims):
            if not self._is_spec_enabled(dim):
                self._dimension_step(sketch, sketch_name, dim, is_snap_only=True)

        # --- PHASE: PreConstraints + PreDimensions ---
        sketch.isComputeDeferred = True
        for rel in pre_constrs: self._constraint_step(sketch, sketch_name, rel)
        for dim in pre_dims: self._dimension_step(sketch, sketch_name, dim)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: PreConstraints ({len(pre_constrs)}constr {len(pre_dims)}dim)")

        # --- PHASE: Geometry + Constraints ---
        sketch.isComputeDeferred = True
        for geom in geoms: self._geom_step(sketch, sketch_name, geom)
        for rel in constrs: self._constraint_step(sketch, sketch_name, rel)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Main ({len(geoms)}geom {len(constrs)}constr)")

        # --- PHASE: PostGeometry + PostConstraints ---
        sketch.isComputeDeferred = True
        for geom in post_geoms: self._geom_step(sketch, sketch_name, geom)
        for rel in post_constrs: self._constraint_step(sketch, sketch_name, rel)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Post ({len(post_geoms)}geom {len(post_constrs)}constr)")

        # --- PHASE: Final Dimensions (Locked) ---
        sketch.isComputeDeferred = True
        for dim in dims:
            if self._is_spec_enabled(dim):
                self._dimension_step(sketch, sketch_name, dim, is_snap_only=False)
        for vdim in vdims:
            if self._is_spec_enabled(vdim):
                self._dimension_step(sketch, sketch_name, vdim, is_snap_only=False)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Dimensions ({len(dims)}dim {len(vdims)}vdim)")

        # --- PHASE: Offsets + Steps ---
        sketch.isComputeDeferred = True
        for off in offs: self._offset_step(sketch, sketch_name, off)
        for step in steps: self._step_step(sketch, sketch_name, step)
        sketch.isComputeDeferred = False
        self.logger.log(f"PHASE DONE: Steps ({len(offs)}off {len(steps)}step)")
        self._trace("build_sketch end")
        self._active_trace_token = None

    def _format_bound_expr(self, raw, unit):
        if raw is None:
            return None
        if isinstance(raw, (int, float)):
            return f"{raw} {unit}".strip()
        expr = str(raw).strip()
        if not expr:
            return expr
        if unit and re.match(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$", expr):
            return f"{expr} {unit}"
        return expr

    def _build_param_expression(self, param_spec, unit):
        base_expr = str(param_spec.get("Val", param_spec.get("Value", 0))).strip()
        min_raw = param_spec.get("MinExpr", param_spec.get("Min"))
        max_raw = param_spec.get("MaxExpr", param_spec.get("Max"))
        if min_raw is None or max_raw is None:
            return base_expr

        min_expr = self._format_bound_expr(min_raw, unit)
        max_expr = self._format_bound_expr(max_raw, unit)
        clamped_expr = f"Max({min_expr}, Min({max_expr}, {base_expr}))"
        self.logger.log(f"CLAMPED PARAM: {param_spec.get('Name', '?')} = {clamped_expr}")
        return clamped_expr

    def _is_parameter_enabled(self, param_spec):
        toggle_name = param_spec.get("EnabledParam")
        if not toggle_name:
            return True

        default_enabled = bool(param_spec.get("EnabledDefault", 1))
        toggle = self.user_params.itemByName(toggle_name)
        if not toggle:
            return default_enabled

        try:
            return float(toggle.value) >= 0.5
        except Exception:
            expr = str(getattr(toggle, "expression", "")).strip().lower()
            if expr in ("0", "false", "off", "no"):
                return False
            if expr in ("1", "true", "on", "yes"):
                return True
            return default_enabled

    def _should_undefine_when_disabled(self, param_spec):
        if not param_spec.get("UndefinedWhenDisabled", False):
            return False

        toggle_name = param_spec.get("UndefinedWhenDisabledParam")
        if not toggle_name:
            return True

        toggle = self.user_params.itemByName(toggle_name)
        if not toggle:
            return True

        try:
            return float(toggle.value) >= 0.5
        except Exception:
            expr = str(getattr(toggle, "expression", "")).strip().lower()
            if expr in ("0", "false", "off", "no"):
                return False
            if expr in ("1", "true", "on", "yes"):
                return True
            return True

    def _is_spec_enabled(self, spec, _log_reason=None):
        """Returns True if spec should be built. Optionally appends the blocking reason to _log_reason list."""
        def _param_enabled(param_name, default_enabled):
            if not param_name:
                return default_enabled
            param = self.user_params.itemByName(param_name)
            if not param:
                return default_enabled
            try:
                return float(param.value) >= 0.5
            except Exception:
                expr = str(getattr(param, "expression", "")).strip().lower()
                if expr in ("0", "false", "off", "no"):
                    return False
                if expr in ("1", "true", "on", "yes"):
                    return True
                return default_enabled

        def _param_value_str(param_name):
            if not param_name:
                return "(no name)"
            p = self.user_params.itemByName(param_name)
            if not p:
                return "(missing)"
            try:
                return str(round(float(p.value), 4))
            except Exception:
                return str(getattr(p, "expression", "?"))

        default_enabled = bool(spec.get("EnabledDefault", 1))

        params_all = spec.get("EnabledParamsAll")
        if isinstance(params_all, (list, tuple)) and params_all:
            for param_name in params_all:
                if not _param_enabled(param_name, default_enabled):
                    if _log_reason is not None:
                        _log_reason.append(f"EnabledParamsAll[{param_name}]={_param_value_str(param_name)}")
                    return False

        params_any = spec.get("EnabledParamsAny")
        if isinstance(params_any, (list, tuple)) and params_any:
            any_enabled = False
            for param_name in params_any:
                if _param_enabled(param_name, default_enabled):
                    any_enabled = True
                    break
            if not any_enabled:
                if _log_reason is not None:
                    vals = {n: _param_value_str(n) for n in params_any}
                    _log_reason.append(f"EnabledParamsAny all false: {vals}")
                return False

        param_name = spec.get("EnabledParam")
        if param_name:
            if not _param_enabled(param_name, default_enabled):
                if _log_reason is not None:
                    _log_reason.append(f"EnabledParam[{param_name}]={_param_value_str(param_name)}")
                return False

        blocked_param = spec.get("BlockedParam")
        if blocked_param:
            if _param_enabled(blocked_param, False):
                if _log_reason is not None:
                    _log_reason.append(f"BlockedParam[{blocked_param}]={_param_value_str(blocked_param)}")
                return False

        return True

    def _create_or_update_param(self, name, val, unit):
        try:
            param = self.user_params.itemByName(name)
            val_input = adsk.core.ValueInput.createByString(str(val))
            if param: 
                param.expression = str(val)
                self.logger.log(f"PARAM SYNC: {name} = {val}")
            else: 
                self.user_params.add(name, val_input, unit, "Frame Builder Parameter")
                self.logger.log(f"PARAM NEW: {name} = {val} ({unit})")
        except:
            self.logger.log_error(f"Param Sync Failed: {name}")

    def _geom_step(self, sketch, s_name, geom):
        id, type, curves = geom["ID"], geom["Type"], sketch.sketchCurves
        entity = None

        if type == "Line":
            p1 = adsk.core.Point3D.create(self._resolve_val(geom["Points"][0][0]), self._resolve_val(geom["Points"][0][1]), 0)
            p2 = adsk.core.Point3D.create(self._resolve_val(geom["Points"][1][0]), self._resolve_val(geom["Points"][1][1]), 0)
            entity = curves.sketchLines.addByTwoPoints(p1, p2)
            self.logger.log(f"LINE {id}: ({p1.x:.2f},{p1.y:.2f}) -> ({p2.x:.2f},{p2.y:.2f})")
            # Assign semantic IDs to endpoints if provided
            start_id = geom.get("StartID")
            end_id = geom.get("EndID")
            if start_id:
                self._set_id(entity.startSketchPoint, s_name, "point", override_id=start_id)
            if end_id:
                self._set_id(entity.endSketchPoint, s_name, "point", override_id=end_id)
        
        elif type == "Arc3Point":
            pts = [adsk.core.Point3D.create(self._resolve_val(p[0]), self._resolve_val(p[1]), 0) for p in geom["Points"]]
            entity = curves.sketchArcs.addByThreePoints(pts[0], pts[1], pts[2])
            # Keep arc point naming deterministic for inspector and downstream constraints.
            start_id = geom.get("StartID", f"{id}:S")
            end_id = geom.get("EndID", f"{id}:E")
            center_id = geom.get("CenterID", f"{id}:C")
            if getattr(entity, "startSketchPoint", None):
                self._set_id(entity.startSketchPoint, s_name, "point", override_id=start_id)
            if getattr(entity, "endSketchPoint", None):
                self._set_id(entity.endSketchPoint, s_name, "point", override_id=end_id)
            if getattr(entity, "centerSketchPoint", None):
                self._set_id(entity.centerSketchPoint, s_name, "point", override_id=center_id)
            self.logger.log(f"ARC {id}: P1({pts[0].x:.2f},{pts[0].y:.2f}) P2({pts[1].x:.2f},{pts[1].y:.2f})")

        elif type in ("Rectangle", "RectangleCenter"):
            cp = adsk.core.Point3D.create(self._resolve_val(geom["Center"][0]), self._resolve_val(geom["Center"][1]), 0)
            w = self._resolve_val(geom["Size"][0])
            h = self._resolve_val(geom["Size"][1])
            corner = adsk.core.Point3D.create(cp.x + w/2, cp.y + h/2, 0)
            rect = curves.sketchLines.addCenterPointRectangle(cp, corner)
            self.logger.log(f"RECT {id}: Center({cp.x:.2f},{cp.y:.2f}) Total Lines: {rect.count}")
            
            # 1. Name the 4 boundary lines
            ids = geom.get("LineIDs", [f"{id}_L{i}" for i in range(4)])
            for i in range(min(rect.count, 4)): 
                self._set_id(rect.item(i), s_name, "line", override_id=ids[i])
            
            # 2. Name and flag diagonals (Lines 4 & 5 in Fusion's SketchLineList for center-rect)
            if rect.count >= 6:
                for i in range(4, 6):
                    diag = rect.item(i)
                    diag.isConstruction = True
                    self._set_id(diag, s_name, "line", override_id=f"{id}_diag{i-3}")

                # Center Point from diagonal intersection
                self._set_id(rect.item(4).startSketchPoint, s_name, "point", override_id=f"{id}:C")
                self.logger.log(f"RECT {id}: Diagonals found in API result ({rect.count} items)")
            else:
                # Fusion didn't return diagonals — create manually using Fusion's own pattern:
                # 1. Draw diags with endpoints offset from corners (outside 0.01cm merge zone)
                # 2. Coincident-snap diag endpoints to rect corners
                # 3. Add a sketch point, coincident to diag1, then diag2 (forces intersection)
                # 4. Coincident that point to origin
                self.logger.log(f"RECT {id}: No diagonals from API ({rect.count} items), creating manually")
                corners = []
                for i in range(min(rect.count, 4)):
                    corners.append(rect.item(i).startSketchPoint)

                diag1 = None
                diag2 = None
                if len(corners) == 4:
                    nudge = 1.0  # cm — well outside Fusion's 0.01cm merge tolerance

                    # --- Diagonal 1: corners[0] to corners[2] ---
                    try:
                        p0 = corners[0].geometry
                        p2 = corners[2].geometry
                        mid_x = (p0.x + p2.x) / 2
                        mid_y = (p0.y + p2.y) / 2
                        diag1 = curves.sketchLines.addByTwoPoints(
                            adsk.core.Point3D.create(mid_x - nudge, mid_y - nudge, 0),
                            adsk.core.Point3D.create(mid_x + nudge, mid_y + nudge, 0)
                        )
                        diag1.isConstruction = True
                        self._set_id(diag1, s_name, "line", override_id=f"{id}_diag1")
                        sketch.geometricConstraints.addCoincident(diag1.startSketchPoint, corners[0])
                        sketch.geometricConstraints.addCoincident(diag1.endSketchPoint, corners[2])
                        self.logger.log(f"RECT {id}: Diag1 OK (corners 0-2)")
                    except Exception as e:
                        self.logger.log_error(f"RECT {id}: Diag1 FAIL: {e}")

                    # --- Diagonal 2: corners[1] to corners[3] ---
                    try:
                        p1 = corners[1].geometry
                        p3 = corners[3].geometry
                        mid_x = (p1.x + p3.x) / 2
                        mid_y = (p1.y + p3.y) / 2
                        diag2 = curves.sketchLines.addByTwoPoints(
                            adsk.core.Point3D.create(mid_x - nudge, mid_y - nudge, 0),
                            adsk.core.Point3D.create(mid_x + nudge, mid_y + nudge, 0)
                        )
                        diag2.isConstruction = True
                        self._set_id(diag2, s_name, "line", override_id=f"{id}_diag2")
                        sketch.geometricConstraints.addCoincident(diag2.startSketchPoint, corners[1])
                        sketch.geometricConstraints.addCoincident(diag2.endSketchPoint, corners[3])
                        self.logger.log(f"RECT {id}: Diag2 OK (corners 1-3)")
                    except Exception as e:
                        self.logger.log_error(f"RECT {id}: Diag2 FAIL: {e}")

                    # --- Center point: single point on diag1, coincident diag2, coincident origin ---
                    try:
                        center_pt = sketch.sketchPoints.add(adsk.core.Point3D.create(nudge, nudge, 0))
                        if diag1 and diag1.isValid:
                            sketch.geometricConstraints.addCoincident(center_pt, diag1)
                        if diag2 and diag2.isValid:
                            sketch.geometricConstraints.addCoincident(center_pt, diag2)
                        sketch.geometricConstraints.addCoincident(center_pt, sketch.originPoint)
                        self._set_id(center_pt, s_name, "point", override_id=f"{id}:C")
                        self.logger.log(f"RECT {id}: Center point on diag intersection + origin OK")
                    except Exception as e:
                        # Fallback: just map origin as center
                        self._set_id(sketch.originPoint, s_name, "point", override_id=f"{id}:C")
                        self.logger.log_error(f"RECT {id}: Center point FAIL ({e}), using origin")

            entity = rect.item(0)


        if entity:
            if geom.get("IsConstruction"):
                if hasattr(entity, 'item'): # Handle SketchLineList collections (Rectangles)
                    for i in range(entity.count):
                        entity.item(i).isConstruction = True
                else: 
                    entity.isConstruction = True
            
            self._set_id(entity, s_name, "feature", override_id=id)

    def _project_step(self, sketch, s_name, proj):
        source_id = proj.get("SourceID")
        target_id = proj.get("TargetID")
        try:
            if not source_id:
                self.logger.log(f"PROJECTION WARNING: Missing SourceID in {s_name}", "WARNING")
                return {
                    "status": "exception",
                    "source_id": source_id,
                    "target_id": target_id,
                    "names": [],
                    "reason": "missing_source_id",
                }

            src_name = f"{self.prefix}_{proj['SourceSketch']}"
            base_id = source_id.split(':')[0]
            src_ent = self.entity_map.get(src_name, {}).get(base_id)
            self._trace(
                f"PROJECT START src={src_name}:{source_id} target={target_id} base={base_id} "
                f"src_type={self._safe_entity_type(src_ent)}"
            )
            if not src_ent:
                self.logger.log(f"PROJECTION WARNING: Source entity {source_id} not found in {src_name}", "WARNING")
                return {
                    "status": "source_missing",
                    "source_id": source_id,
                    "target_id": target_id,
                    "names": [],
                    "reason": f"source_missing:{src_name}:{base_id}",
                }
            if ":" in source_id and src_ent:
                suff = source_id.split(':')[1]
                self._trace(
                    f"PROJECT SUFFIX resolve source={source_id} suffix={suff} before={self._safe_entity_type(src_ent)}"
                )
                if suff == "S": src_ent = src_ent.startSketchPoint
                elif suff == "E": src_ent = src_ent.endSketchPoint
                elif suff == "C": src_ent = src_ent.centerSketchPoint
            if not src_ent:
                self.logger.log(f"PROJECTION WARNING: Suffix entity {source_id} not found in {src_name}", "WARNING")
                return {
                    "status": "suffix_missing",
                    "source_id": source_id,
                    "target_id": target_id,
                    "names": [],
                    "reason": f"suffix_missing:{source_id}",
                }

            before_tokens = self._project_snapshot_tokens(sketch)
            before_counts = self._entity_bucket_counts(sketch)
            res = sketch.project(src_ent)
            res_count = res.count if res else 0
            after_counts = self._entity_bucket_counts(sketch)
            self._trace(
                f"PROJECT API RESULT src={src_name}:{source_id} count={res_count} src_type={self._safe_entity_type(src_ent)}"
            )
            # Assign unique semantic ID to every projected point or entity
            base_name = source_id or target_id or 'proj'
            proj_names = []
            registration_failures = []

            if res_count == 0:
                # Option A fallback: reconcile with snapshot delta when Fusion shows visible projection but returns empty collection.
                after_tokens = self._project_snapshot_tokens(sketch)
                new_tokens = after_tokens - before_tokens
                self._trace(
                    f"PROJECT ZERO RESULT fallback source={source_id} target={target_id} new_tokens={len(new_tokens)}"
                )
                chosen, stage, candidate_count, best_d2 = self._choose_projection_candidate(
                    sketch,
                    s_name,
                    src_ent,
                    new_tokens,
                    target_id,
                )

                if chosen:
                    proj_name = target_id if target_id else f"proj_{base_name}_reconciled"
                    reg_ok = self._set_id(chosen, s_name, "proj", override_id=proj_name)
                    if reg_ok:
                        p = self._entity_reference_point(chosen)
                        coords = f"({p.x:.3f}, {p.y:.3f})" if p else "[no geometry]"
                        self.logger.log(
                            f"PROJECTION RECONCILED: Source={proj['SourceSketch']}:{source_id} Target={proj_name} Type={self._safe_entity_type(chosen)} Coords={coords} Stage={stage} Candidates={candidate_count} BestD2={best_d2 if best_d2 is not None else 'n/a'} in {s_name}",
                            "WARNING",
                        )
                        return {
                            "status": "reconciled",
                            "source_id": source_id,
                            "target_id": target_id,
                            "names": [proj_name],
                            "reason": "reconciled_from_snapshot",
                        }

                delta_counts = {
                    k: after_counts.get(k, 0) - before_counts.get(k, 0)
                    for k in after_counts.keys()
                }
                self.logger.log(
                    f"PROJECTION ZERO RESULT: Source={proj['SourceSketch']}:{source_id} Target={target_id} Stage={stage} Candidates={candidate_count} BestD2={best_d2 if best_d2 is not None else 'n/a'} BucketDelta={delta_counts} in {s_name}",
                    "WARNING",
                )
                return {
                    "status": "zero_result",
                    "source_id": source_id,
                    "target_id": target_id,
                    "names": [],
                    "reason": f"no_valid_candidates_after_validation:{stage}",
                }

            projected_entities = [res.item(i) for i in range(res_count)]
            projected_entities = sorted(projected_entities, key=self._entity_sort_key)
            primary_idx = self._pick_primary_projection_index(projected_entities, src_ent)

            for i, ent in enumerate(projected_entities):
                # Deterministic naming: reserve TargetID for a primary type-compatible candidate.
                if target_id and i == primary_idx:
                    proj_name = target_id
                elif target_id:
                    proj_name = f"{target_id}:ALT{i}"
                else:
                    proj_name = f"proj_{base_name}_{i}"
                self._trace(
                    f"PROJECT REGISTER attempt source={source_id} target={proj_name} idx={i} ent_type={self._safe_entity_type(ent)}"
                )
                reg_ok = self._set_id(ent, s_name, "proj", override_id=proj_name)
                if not reg_ok:
                    registration_failures.append(proj_name)
                    self.logger.log(
                        f"PROJECTION REGISTRATION FAIL: Source={source_id} Target={proj_name} in {s_name}",
                        "WARNING",
                    )
                    continue

                coords = None
                ent_type = type(ent).__name__
                if hasattr(ent, 'geometry') and hasattr(ent.geometry, 'x'):
                    coords = f"({ent.geometry.x:.3f}, {ent.geometry.y:.3f})"
                elif hasattr(ent, 'startSketchPoint') and hasattr(ent.startSketchPoint, 'geometry') and hasattr(ent.startSketchPoint.geometry, 'x'):
                    coords = f"({ent.startSketchPoint.geometry.x:.3f}, {ent.startSketchPoint.geometry.y:.3f})"
                else:
                    coords = "[curve geometry]"
                if self.log_projection_details:
                    self.logger.log(f"PROJECTION: Source={proj['SourceSketch']}:{source_id} Target={proj_name} Type={ent_type} Coords={coords if coords else '[no geometry]'} in {s_name}")
                proj_names.append(proj_name)

                # For line targets, always expose deterministic endpoint IDs.
                if target_id and i == primary_idx and self._entity_kind(ent) == "line_like":
                    sp = getattr(ent, "startSketchPoint", None)
                    ep = getattr(ent, "endSketchPoint", None)
                    if sp:
                        if self._set_id(sp, s_name, "proj", override_id=f"{target_id}:S"):
                            proj_names.append(f"{target_id}:S")
                    if ep:
                        if self._set_id(ep, s_name, "proj", override_id=f"{target_id}:E"):
                            proj_names.append(f"{target_id}:E")

            if registration_failures:
                return {
                    "status": "registration_failed",
                    "source_id": source_id,
                    "target_id": target_id,
                    "names": proj_names,
                    "reason": f"registration_failed:{registration_failures}",
                }

            return {
                "status": "projected",
                "source_id": source_id,
                "target_id": target_id,
                "names": proj_names,
                "reason": f"projected_count:{len(proj_names)}",
            }
        except Exception as e:
            self.logger.log_error(f"PROJECT FAIL: {target_id or '?'} in {s_name}: {e}")
            return {
                "status": "exception",
                "source_id": source_id,
                "target_id": target_id,
                "names": [],
                "reason": str(e),
            }

    def _offset_step(self, sketch, s_name, off):
        coll = adsk.core.ObjectCollection.create()
        for sid in off["SourceID"]:
            e = self.entity_map[s_name].get(sid)
            if e: coll.add(e)
            else: self.logger.log(f"OFFSET FAIL: Missing ID {sid} in {s_name}", "ERROR")

        try:
            d_val = self._resolve_val(off["DistanceExpr"])
            dir_raw = off.get("Direction") or [0.5, 0.5, 0]
            dir_pt = adsk.core.Point3D.create(dir_raw[0], dir_raw[1], 0)
            
            self.logger.log(f"OFFSET RUN: {s_name} Distance={d_val:.3f} cm at ({dir_pt.x},{dir_pt.y})")
            
            # Pass d_val (double/float) directly to the API
            try:
                offset_curves = sketch.offset(coll, dir_pt, d_val)
            except:
                self.logger.log(f"RETRYING OFFSET for {s_name} with negative distance", "WARNING")
                # Try the reverse direction if the primary one fails (solver instability)
                offset_curves = sketch.offset(coll, dir_pt, -d_val)
            
            if offset_curves and offset_curves.count > 0:
                self.logger.log(f"OFFSET SUCCESS: Generated {offset_curves.count} curves")
                t_ids = off.get("TargetIDs", [])
                source_ids = off.get("SourceID", [])

                # --- Robust Proximity Mapping ---
                # Match generated offset curves to their source IDs based on physical distance
                abs_d = abs(d_val)
                potential_maps = []
                for i in range(offset_curves.count):
                    off_c = offset_curves.item(i)
                    mp_off = self._get_midpoint(off_c)
                    
                    best_sid, min_err = None, 1.0e6
                    for sid in source_ids:
                        src_c = self.entity_map[s_name].get(sid)
                        if not src_c: continue
                        mp_src = self._get_midpoint(src_c)
                        dist = self._dist(mp_off, mp_src)
                        err = abs(dist - abs_d)
                        if err < min_err:
                            min_err = err
                            best_sid = sid
                    
                    if best_sid and min_err < 0.1: # Allow 1mm tolerance
                        target_id = f"frame_inner_{best_sid}" # default naming convention
                        # If explicit target IDs provided, use the map index
                        # (though proximity is safer for semantic names)
                        self._set_id(off_c, s_name, "offset", override_id=target_id)
                        self.logger.log(f"OFFSET MATCH: Curve {i} ({mp_off.x:.2f},{mp_off.y:.2f}) -> {target_id} (err={min_err:.4f})")
                    else:
                        self._set_id(off_c, s_name, "offset") # generic fallback if match failed

                # --- Corner Identification (optional) ---
                # If CornerIDs provided, find the 4 unique sketch points from offset curves
                # and name them by geometric quadrant: TL, TR, BL, BR
                corner_ids = off.get("CornerIDs", {})
                if corner_ids:
                    self._identify_offset_corners(offset_curves, s_name, corner_ids)
            else:
                self.logger.log(f"OFFSET EMPTY: No curves returned for {s_name}", "WARNING")
        except:
            self.logger.log_error(f"OFFSET CRASH in {s_name}")

    def _step_step(self, sketch, s_name, step):
        step_type = step.get("Type")
        if step_type == "Offset":
            source = step.get("SourceID")
            if isinstance(source, str): source = [source]
            off = {
                "SourceID": source or [],
                "DistanceExpr": step.get("DistanceExpr", "0"),
                "Direction": step.get("Direction"),
                "TargetIDs": step.get("TargetIDs", []),
                "TargetID": step.get("TargetID"),
                "CornerIDs": step.get("CornerIDs", {})
            }
            self._offset_step(sketch, s_name, off)

            # If a single named target is requested, assign it to the result of the first curve
            if off.get("TargetID"):
                last_ids = off.get("TargetIDs", [])
                if not last_ids:
                    for key in list(self.entity_map[s_name].keys()):
                        if key.startswith("offset-"):
                            self._set_id(self.entity_map[s_name][key], s_name, "offset", override_id=off["TargetID"])
                            break
        elif step_type == "Line":
            self._line_step(sketch, s_name, step)

    def _line_step(self, sketch, s_name, step):
        g_map = self.entity_map[s_name]
        p1_id = step.get("StartID")
        p2_id = step.get("EndID")
        line_id = step.get("ID")

        def resolve_point(tid):
            ent = g_map.get(tid)
            if not ent:
                base = tid.split(':')[0]
                ent = g_map.get(base)
                if not ent: return None
                if ":" in tid:
                    suff = tid.split(':')[1]
                    if suff == "S": ent = ent.startSketchPoint
                    elif suff == "E": ent = ent.endSketchPoint
                    elif suff == "C" and hasattr(ent, 'centerSketchPoint'): ent = ent.centerSketchPoint
            return ent

        p1 = resolve_point(p1_id)
        p2 = resolve_point(p2_id)

        if p1 and p2:
            try:
                # Free Seeding: Create the line at the target coordinates first (making it a free line)
                # rather than passing the SketchPoint objects directly. This prevents Fusion's
                # addByTwoPoints from automatically and potentially incorrectly connecting the points.
                line = sketch.sketchCurves.sketchLines.addByTwoPoints(p1.geometry, p2.geometry)
                
                # Manual Coincidence: Explicitly weld the line's endpoints to the actual SketchPoint objects.
                # Use separate try-except blocks to catch 'already applied' errors at either end.
                try: sketch.geometricConstraints.addCoincident(line.startSketchPoint, p1)
                except: pass
                try: sketch.geometricConstraints.addCoincident(line.endSketchPoint, p2)
                except: pass
                if line_id:
                    self._set_id(line, s_name, "step_line", override_id=line_id)
                self.logger.log(f"LINE STEP OK: {line_id or '?'} from {p1_id} to {p2_id}")
            except Exception as e:
                self.logger.log_error(f"LINE STEP FAIL: {line_id or '?'} {e}")
        else:
            self.logger.log(f"LINE STEP MISS: Could not resolve points {p1_id} or {p2_id}", "WARNING")

    def _identify_offset_corners(self, offset_curves, s_name, corner_ids):
        """
        After a rectangular offset, collect the unique sketch points from the
        returned curves and name them by geometric quadrant position.
        corner_ids: {"TL": "id", "TR": "id", "BL": "id", "BR": "id"}
        """
        try:
            # Collect all unique sketch points from the offset curves
            seen_tokens = set()
            points = []
            for i in range(offset_curves.count):
                curve = offset_curves.item(i)
                if not curve.isValid:
                    continue
                for sp in [curve.startSketchPoint, curve.endSketchPoint]:
                    if not sp or not sp.isValid:
                        continue
                    token = sp.entityToken
                    if token not in seen_tokens:
                        seen_tokens.add(token)
                        points.append(sp)

            self.logger.log(f"CORNER ID: Found {len(points)} unique points from offset")

            if len(points) < 4:
                self.logger.log(f"CORNER ID: Expected 4 points, got {len(points)}", "WARNING")
                return

            # Robust Corner Search: Find points with extreme X and Y
            # We look for the absolute Max/Min X, then pick the Max/Min Y within those extreme-X groups
            min_x = min(p.geometry.x for p in points)
            max_x = max(p.geometry.x for p in points)
            
            # Tolerance for "is at edge"
            tol = 0.01 
            left_pts = [p for p in points if abs(p.geometry.x - min_x) < tol]
            right_pts = [p for p in points if abs(p.geometry.x - max_x) < tol]

            left_pts_sorted = sorted(left_pts, key=lambda p: p.geometry.y, reverse=True)
            right_pts_sorted = sorted(right_pts, key=lambda p: p.geometry.y, reverse=True)

            mapping = {
                "TL": left_pts_sorted[0],   # leftmost, highest Y
                "BL": left_pts_sorted[-1],  # leftmost, lowest Y
                "TR": right_pts_sorted[0],  # rightmost, highest Y
                "BR": right_pts_sorted[-1], # rightmost, lowest Y
            }

            for key, sp in mapping.items():
                cid = corner_ids.get(key)
                if cid:
                    self._set_id(sp, s_name, "corner", override_id=cid)
                    g = sp.geometry
                    self.logger.log(f"CORNER {key} -> {cid}: ({g.x:.3f}, {g.y:.3f})")

        except Exception:
            self.logger.log_error(f"CORNER ID CRASH:\n{traceback.format_exc()}")

    def _set_id(self, entity, s_name, prefix, override_id=None):
        if not entity:
            self._trace(f"SET_ID FAIL: null entity sketch={s_name} prefix={prefix}", "WARNING")
            return False
        final_id = override_id if override_id else f"{prefix}-{self.feature_count}"
        self.feature_count += 1
        self.entity_map[s_name][final_id] = entity
        try:
            if hasattr(entity, 'attributes'):
                attr = entity.attributes.itemByName('FrameBuilder', 'name')
                if attr: attr.value = final_id
                else: entity.attributes.add('FrameBuilder', 'name', final_id)
            if hasattr(entity, 'name'): entity.name = final_id
            self._trace(
                f"SET_ID OK: sketch={s_name} id={final_id} type={self._safe_entity_type(entity)} total_keys={len(self.entity_map[s_name])}"
            )
            return True
        except Exception as e:
            self._trace(f"UI Rename skipped for {final_id}: {e}")
            return True

    def _constraint_step(self, sketch, s_name, rel):
        t = rel.get("Type")

        g_map = self.entity_map[s_name]
        targets = []
        self._trace(f"CONSTRAINT START type={rel.get('Type')} targets={rel.get('Targets')}")
        for t_id in rel["Targets"]:
            # First try the full ID (e.g. "main_bounding_rectangle:C") as a direct key
            ent = g_map.get(t_id)
            if ent:
                self._trace(f"CONSTRAINT LOOKUP direct-hit target={t_id} type={self._safe_entity_type(ent)}")
            if not ent:
                # Fallback: split base:suffix and resolve from the base entity
                base = t_id.split(':')[0]
                ent = g_map.get(base)
                self._trace(
                    f"CONSTRAINT LOOKUP fallback target={t_id} base={base} base_type={self._safe_entity_type(ent)}"
                )
                if not ent:
                    key_preview, extra = self._map_keys_preview(s_name, limit=30)
                    self.logger.log(
                        f"CONSTRAINT MISS: {t_id} not found in {s_name} | map_keys={key_preview}{' ...+' + str(extra) if extra > 0 else ''}",
                        "WARNING",
                    )
                    continue
                if ":" in t_id:
                    suff = t_id.split(':')[1]
                    self._trace(f"CONSTRAINT SUFFIX resolve target={t_id} suffix={suff}")
                    if suff == "S": ent = ent.startSketchPoint
                    elif suff == "E": ent = ent.endSketchPoint
                    elif suff == "C" and hasattr(ent, 'centerSketchPoint'): ent = ent.centerSketchPoint
                    elif suff == "C":
                        self.logger.log(f"CONSTRAINT MISS: {t_id} — entity has no centerSketchPoint", "WARNING")
                        continue
            if ent:
                self._trace(f"CONSTRAINT TARGET RESOLVED target={t_id} type={self._safe_entity_type(ent)}")
                targets.append(ent)
        if len(targets) >= 1:
            c, t = sketch.geometricConstraints, rel["Type"]
            try:
                applied = False
                if t == "Coincident" and len(targets) == 2: c.addCoincident(targets[0], targets[1])
                if t == "Coincident" and len(targets) == 2: applied = True
                elif t == "Collinear" and len(targets) == 2: c.addCollinear(targets[0], targets[1])
                if t == "Collinear" and len(targets) == 2: applied = True
                elif t == "Horizontal": c.addHorizontal(targets[0])
                if t == "Horizontal": applied = True
                elif t == "Vertical": c.addVertical(targets[0])
                if t == "Vertical": applied = True
                elif t == "Tangent" and len(targets) == 2: c.addTangent(targets[0], targets[1])
                if t == "Tangent" and len(targets) == 2: applied = True
                elif t == "Parallel" and len(targets) == 2: c.addParallel(targets[0], targets[1])
                if t == "Parallel" and len(targets) == 2: applied = True
                elif t == "Equal" and len(targets) == 2: c.addEqual(targets[0], targets[1])
                if t == "Equal" and len(targets) == 2: applied = True
                elif t == "Symmetric" and len(targets) == 3: c.addSymmetry(targets[0], targets[1], targets[2])
                if t == "Symmetric" and len(targets) == 3: applied = True
                if applied:
                    self.logger.log(f"CONSTRAINT OK: {t} on {rel['Targets']}")
                else:
                    self.logger.log(
                        f"CONSTRAINT SKIP: {t} on {rel['Targets']} (resolved_targets={len(targets)})",
                        "WARNING",
                    )
            except Exception as e:
                self.logger.log(f"CONSTRAINT FAIL: {t} on {rel['Targets']}: {e}", "ERROR")
                # Enhanced: Log all constraints/dimensions involving these targets for diagnostics
                related = []
                for constr in self.sketches[s_name].geometricConstraints:
                    for tgt in targets:
                        if hasattr(constr, 'entityOne') and constr.entityOne == tgt:
                            related.append(str(constr))
                        if hasattr(constr, 'entityTwo') and constr.entityTwo == tgt:
                            related.append(str(constr))
                self.logger.log(f"RELATED CONSTRAINTS for {rel['Targets']}: {related}", "DEBUG")

                # --- RetryDrop: relax over-constraining dimensions and retry the constraint ---
                # When Fusion's solver rejects a constraint (VCS_SKETCH_SOLVING_FAILED), the
                # sketch may be over-constrained by dimensions in another sketch (e.g. skeleton
                # span or vertical-gap dims that pin arc centers too tightly to allow tangency).
                #
                # RetryDrop works by deleting those dimensions one at a time, then immediately
                # re-attempting the constraint after each drop.  The first drop that unblocks
                # the solver wins; remaining drops are skipped.
                #
                # Usage in sketch spec:
                #   {'Type': 'Tangent', 'Targets': ['arc_waist_R', 'arc_hip_R'],
                #    'RetryDrop': ['dim_skel_waist_span', 'dim_skel_hip_span', 'dim_skel_vertical_hip']}
                #
                # Drop order matters: list the most expendable dimension first.
                # If a drop_id is already gone (deleted by a prior retry on the same build),
                # it is skipped silently so the L-side can still attempt its own drops.
                retry_drop = rel.get("RetryDrop", [])
                retry_success = False
                for drop_id in retry_drop:
                    if retry_success:
                        break
                    # Search every sketch's entity map for the dimension to drop
                    found = False
                    for sketch_name, emap in self.entity_map.items():
                        if drop_id in emap:
                            try:
                                emap[drop_id].deleteMe()
                                del emap[drop_id]
                                self.logger.log(f"RetryDrop: deleted '{drop_id}' from '{sketch_name}' — retrying {t}")
                                found = True
                            except Exception as e2:
                                self.logger.log(f"RetryDrop: exception deleting '{drop_id}' in '{sketch_name}': {e2}", "ERROR")
                            break
                    if not found:
                        # Already deleted by an earlier RetryDrop (e.g. R-side consumed it before L-side)
                        self.logger.log(f"RetryDrop: '{drop_id}' not found (already dropped or missing) — skipping", "WARNING")
                        continue
                    # Re-attempt the constraint immediately after the drop
                    try:
                        if   t == "Tangent"    and len(targets) == 2: c.addTangent(targets[0], targets[1])
                        elif t == "Coincident" and len(targets) == 2: c.addCoincident(targets[0], targets[1])
                        elif t == "Equal"      and len(targets) == 2: c.addEqual(targets[0], targets[1])
                        self.logger.log(f"RetryDrop OK: {t} on {rel['Targets']} after dropping '{drop_id}'")
                        retry_success = True
                    except Exception as retry_e:
                        self.logger.log(f"RetryDrop FAIL: {t} on {rel['Targets']} after dropping '{drop_id}': {retry_e} — trying next drop", "WARNING")

                if retry_drop and not retry_success:
                    self.logger.log(f"RetryDrop EXHAUSTED: {t} on {rel['Targets']} — all drops tried, constraint not applied", "ERROR")
                # --- End RetryDrop ---

    def _dimension_step(self, sketch, s_name, dim, is_snap_only=False):
        g_map = self.entity_map[s_name]
        dim_name = dim.get("Name", "?")
        dim_target = dim.get("Target", "?")
        try:
            tgt = g_map.get(dim.get("Target"))
            if not tgt:
                if not is_snap_only:
                    self.logger.log(f"DIM MISS: Target '{dim_target}' not found in {s_name}", "WARNING")
                return

            expr = dim.get("Expression") or dim.get("Name") or dim.get("Value")
            dim_type = dim.get("DimType") or dim.get("Type")
            
            # --- SNAP / SOFT-SEED LOGIC ---
            # When a skeleton dim toggle is OFF (is_snap_only=True), we still want the
            # solver to position the geometry correctly before releasing it.
            # Strategy: apply the full dimension, let Fusion solve, then delete it.
            # This "soft seed" leaves the geometry positioned but unconstrained —
            # much more reliable than directly setting .geometry on SketchPoints
            # (which the Fusion API does not support as a setter).
            if is_snap_only:
                if not expr: return
                try:
                    tp = dim.get("TextPoint", [0, 0, 0])
                    text_pt = adsk.core.Point3D.create(float(tp[0]), float(tp[1]), 0)
                    d = None
                    if dim_type == "Radius":
                        d = sketch.sketchDimensions.addRadialDimension(tgt, text_pt)
                    elif "Source" in dim:
                        src_ent = g_map.get(dim.get("Source"))
                        if src_ent:
                            s_pt = src_ent if not hasattr(src_ent, 'startSketchPoint') else src_ent.startSketchPoint
                            t_pt = tgt    if not hasattr(tgt,     'startSketchPoint') else tgt.startSketchPoint
                            orient = (adsk.fusion.DimensionOrientations.VerticalDimensionOrientation
                                      if dim.get("Orientation") == "Vertical"
                                      else adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation)
                            d = sketch.sketchDimensions.addDistanceDimension(s_pt, t_pt, orient, text_pt)
                    else:
                        if hasattr(tgt, 'startSketchPoint') and hasattr(tgt, 'endSketchPoint'):
                            d = sketch.sketchDimensions.addDistanceDimension(
                                tgt.startSketchPoint, tgt.endSketchPoint,
                                adsk.fusion.DimensionOrientations.AlignedDimensionOrientation, text_pt)
                    if d:
                        try:
                            d.parameter.expression = str(expr)
                            # Pulse the solver to move the point before we delete the constraint
                            sketch.isComputeDeferred = False
                        except Exception: pass
                        d.deleteMe()
                        self.logger.log(f"DIM SOFT SEED: {dim_name} applied+deleted (toggle OFF)", "DEBUG")
                    else:
                        self.logger.log(f"DIM SOFT SEED SKIP: {dim_name} — no dimension created", "DEBUG")
                except Exception as e:
                    self.logger.log(f"DIM SOFT SEED FAIL: {dim_name} {e}", "DEBUG")
                return

            # --- NORMAL CONSTRAINT LOGIC ---
            tp = dim.get("TextPoint", [0, 0, 0])
            text_pt = adsk.core.Point3D.create(float(tp[0]), float(tp[1]), 0)

            d = None
            if dim_type == "Radius":
                try:
                    cpt = getattr(tgt, 'centerSketchPoint', None)
                    if cpt and getattr(cpt, 'geometry', None):
                        cg = cpt.geometry
                        text_pt = adsk.core.Point3D.create(cg.x + 1.0, cg.y + 1.0, 0)
                except Exception: pass
                d = sketch.sketchDimensions.addRadialDimension(tgt, text_pt)
            elif dim_type == "Diameter":
                try:
                    cpt = getattr(tgt, 'centerSketchPoint', None)
                    if cpt and getattr(cpt, 'geometry', None):
                        cg = cpt.geometry
                        text_pt = adsk.core.Point3D.create(cg.x + 1.0, cg.y + 1.0, 0)
                except Exception: pass
                d = sketch.sketchDimensions.addDiameterDimension(tgt, text_pt)
            elif "Source" in dim:
                src = g_map.get(dim.get("Source"))
                if src:
                    s_pt = src if not hasattr(src, 'startSketchPoint') else src.startSketchPoint
                    t_pt = tgt if not hasattr(tgt, 'startSketchPoint') else tgt.startSketchPoint
                    orient = adsk.fusion.DimensionOrientations.VerticalDimensionOrientation if dim.get("Orientation") == "Vertical" else adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation
                    d = sketch.sketchDimensions.addDistanceDimension(s_pt, t_pt, orient, text_pt)
            else:
                if hasattr(tgt, 'startSketchPoint') and hasattr(tgt, 'endSketchPoint'):
                    d = sketch.sketchDimensions.addDistanceDimension(tgt.startSketchPoint, tgt.endSketchPoint, adsk.fusion.DimensionOrientations.AlignedDimensionOrientation, text_pt)
                elif hasattr(tgt, 'geometry') and hasattr(tgt, 'model'):
                    d = sketch.sketchDimensions.addDistanceDimension(tgt, tgt, adsk.fusion.DimensionOrientations.AlignedDimensionOrientation, text_pt)

            if d and expr:
                try:
                    # Named Model Parameters (Variables inside the sketches)
                    # If dim_name doesn't start with 'dim_', name the actual parameter
                    if dim_name and not dim_name.startswith("dim_") and dim_name != "?":
                        try:
                            d.parameter.name = dim_name
                            self.logger.log(f"DIM NAMED: {dim_name} (Model Parameter created)")
                        except: pass

                    # Only set the expression if it's different from the parameter name itself.
                    # Setting d.parameter.expression = "ShoulderSpan" when the parameter is 
                    # ALREADY named "ShoulderSpan" triggers a circular-reference error.
                    if str(expr) != dim_name:
                        d.parameter.expression = str(expr)
                    if dim_name and dim_name != "?":
                        self._set_id(d, s_name, "dim", override_id=dim_name)
                    self.logger.log(f"DIM OK: {dim_name} on '{dim_target}' = {expr}")
                except Exception as e:
                    self.logger.log(f"DIM EXPR FAIL: {dim_name} on '{dim_target}' expr='{expr}': {e}", "ERROR")
            elif not d:
                self.logger.log(f"DIM NODIM: {dim_name} on '{dim_target}' — no dimension created", "WARNING")

        except Exception as e:
            self.logger.log(f"DIM CRASH: {dim_name} on '{dim_target}': {e}", "ERROR")
            # Enhanced: Log all constraints/dimensions involving the target for diagnostics
            related = []
            for constr in self.sketches[s_name].geometricConstraints:
                if hasattr(constr, 'entityOne') and constr.entityOne == tgt:
                    related.append(str(constr))
                if hasattr(constr, 'entityTwo') and constr.entityTwo == tgt:
                    related.append(str(constr))
            self.logger.log(f"RELATED CONSTRAINTS for '{dim_target}': {related}", "DEBUG")

    def _get_midpoint(self, curve):
        try:
            if hasattr(curve, 'startSketchPoint'):
                sp = curve.startSketchPoint.geometry
                ep = curve.endSketchPoint.geometry
                return adsk.core.Point3D.create((sp.x + ep.x)/2, (sp.y + ep.y)/2, 0)
            return adsk.core.Point3D.create(0, 0, 0)
        except: return adsk.core.Point3D.create(0, 0, 0)

    def _dist(self, p1, p2):
        return ((p1.x - p2.x)**2 + (p1.y - p2.y)**2)**0.5

    def _resolve_expr(self, expr):
        """Resolves a parametric expression to a numeric value in cm."""
        try:
            if not expr: return None
            # 1. Check if it's a direct number
            try: return float(expr)
            except: pass
            
            # 2. Check User Parameters
            if self.design:
                p = self.design.userParameters.itemByName(str(expr).strip())
                if p: return p.value
            
            # 3. Simple Eval (Handle basic math if needed)
            # This is a fallback and should be used cautiously
            return None
        except: return None
