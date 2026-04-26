"""
Grain Orientation -- per-body texture rotation so the applied wood
appearance's grain runs along the body's long axis.

Mimics what Fusion's GUI does automatically when you apply an
appearance through the Appearance browser. The Fusion API does NOT
expose that auto-orient logic, so we compute it ourselves.

Algorithm
---------
1. Determine the body's long axis from its axis-aligned bounding box
   (largest of X / Y / Z extents).
2. Build a rotation Matrix3D that rotates the appearance's default
   grain axis (assumed world Z, the convention Fusion's wood
   appearances use - see end-grain ring patterns visible on extruded
   bodies before any orientation is set) onto the body's long axis.
   Rotation pivots around the body's bbox centroid so the texture
   "centre" stays inside the body.
3. Apply the matrix via ``body.textureMapControl``. Fusion exposes
   two control types depending on the appearance:
     * ``ProjectedTextureMapControl`` -- has a ``transform`` property
       that accepts a Matrix3D directly. Covers most regular wood /
       2D appearances.
     * ``TextureMapControl3D`` -- 3D-Wood-specific positioning
       interface, less documented; we fall back to a no-op log if we
       see this type, since the right method depends on the appearance.
4. Returns True if a transform was applied, False on skip
   (no appearance, no textureMapControl, unsupported control type,
   or already aligned).

Single public entry point
-------------------------
``auto_orient_grain(body, logger=None) -> bool``

Internal helpers (``_compute_long_axis``, ``_build_orient_matrix``,
``_apply_via_texture_map_control``) stay private so callers don't lock
themselves to the current pipeline.
"""

import math
import adsk.core, adsk.fusion


# Fusion's wood and 3D-wood textures author their fiber axis along
# world Z by default. End-grain ring patterns visible on freshly
# extruded bodies (before any orientation pass) confirm the
# convention.
_DEFAULT_GRAIN_AXIS = (0.0, 0.0, 1.0)


# ----------------------------------------------------------------------
# Public entry point
# ----------------------------------------------------------------------
def auto_orient_grain(body, logger=None):
    """Apply auto-computed grain orientation to a single body.

    Parameters
    ----------
    body : adsk.fusion.BRepBody
        Target body. Must already have an appearance applied (we do
        not assign one here).
    logger : optional
        Anything with ``.log(msg, level)``. Used for diagnostic
        output. ``None`` silences logging.

    Returns
    -------
    bool
        True if a texture transform was applied, False if skipped for
        any reason (no body / no appearance / unsupported control
        type / already aligned / API error). All errors are caught -
        this never raises into the caller.
    """
    if body is None:
        return False

    try:
        if not getattr(body, 'appearance', None):
            _log(logger, f"GRAIN ORIENT skip: {_safe_name(body)} has no appearance", "DEBUG")
            return False
    except Exception:
        return False

    long_axis_info = _compute_long_axis(body)
    if long_axis_info is None:
        _log(logger, f"GRAIN ORIENT skip: {_safe_name(body)} bbox not computable", "DEBUG")
        return False
    axis_vec, origin = long_axis_info

    matrix = _build_orient_matrix(_DEFAULT_GRAIN_AXIS, axis_vec, origin)
    if matrix is None:
        _log(logger, f"GRAIN ORIENT skip: {_safe_name(body)} default axis already matches long axis", "DEBUG")
        return False

    return _apply_via_texture_map_control(body, matrix, logger)


# ----------------------------------------------------------------------
# Long-axis discovery
# ----------------------------------------------------------------------
def _compute_long_axis(body):
    """Pick whichever of (1,0,0), (0,1,0), (0,0,1) has the largest
    body bbox extent. Returns ``(axis_unit_tuple, centroid_tuple)`` or
    None if the bbox can't be read.

    Note: this is axis-aligned, not oriented. For frame side bodies
    that ARE axis-aligned (extruded vertically from XY-plane sketches),
    this is sufficient. If we ever need oriented bboxes, the API path
    is ``body.physicalProperties.principalAxes`` (PCA) or
    ``orientedMinimumBoundingBox`` -- left as future work.
    """
    try:
        bbox = body.boundingBox
        if not bbox:
            return None
        mn = bbox.minPoint
        mx = bbox.maxPoint
        dx = float(mx.x) - float(mn.x)
        dy = float(mx.y) - float(mn.y)
        dz = float(mx.z) - float(mn.z)
        cx = (float(mx.x) + float(mn.x)) / 2.0
        cy = (float(mx.y) + float(mn.y)) / 2.0
        cz = (float(mx.z) + float(mn.z)) / 2.0
    except Exception:
        return None

    # Largest extent wins. Ties resolve to X > Y > Z (arbitrary but
    # deterministic; tied dimensions are visually identical).
    if dx >= dy and dx >= dz:
        axis = (1.0, 0.0, 0.0)
    elif dy >= dz:
        axis = (0.0, 1.0, 0.0)
    else:
        axis = (0.0, 0.0, 1.0)

    return axis, (cx, cy, cz)


# ----------------------------------------------------------------------
# Rotation matrix construction
# ----------------------------------------------------------------------
def _build_orient_matrix(from_axis, to_axis, origin):
    """Construct a Matrix3D that rotates ``from_axis`` onto
    ``to_axis`` around ``origin``. Returns None if the axes are
    already aligned (no rotation needed) or if Matrix3D construction
    fails.

    Handles the three cases:
      - parallel (dot ~= +1)         -> no rotation, return None
      - anti-parallel (dot ~= -1)    -> 180 deg around any
                                        perpendicular axis
      - general                      -> angle = acos(dot), axis =
                                        from x to (normalised)
    """
    fx, fy, fz = from_axis
    tx, ty, tz = to_axis
    dot = fx * tx + fy * ty + fz * tz

    if dot > 0.9999:
        return None

    if dot < -0.9999:
        # Anti-parallel - pick any axis perpendicular to from_axis.
        if abs(fx) < 0.9:
            axis = _cross(from_axis, (1.0, 0.0, 0.0))
        else:
            axis = _cross(from_axis, (0.0, 1.0, 0.0))
        axis = _normalise(axis)
        angle = math.pi
    else:
        axis = _cross(from_axis, to_axis)
        axis = _normalise(axis)
        if axis is None:
            return None
        # Clamp dot to valid acos range for numerical safety.
        angle = math.acos(max(-1.0, min(1.0, dot)))

    try:
        m = adsk.core.Matrix3D.create()
        axis_v = adsk.core.Vector3D.create(*axis)
        origin_p = adsk.core.Point3D.create(*origin)
        m.setToRotation(angle, axis_v, origin_p)
        return m
    except Exception:
        return None


def _cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _normalise(v):
    mag = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if mag < 1e-9:
        return None
    return (v[0] / mag, v[1] / mag, v[2] / mag)


# ----------------------------------------------------------------------
# Apply via textureMapControl
# ----------------------------------------------------------------------
def _apply_via_texture_map_control(body, matrix, logger):
    """Set ``body.textureMapControl.transform = matrix`` for the
    common (ProjectedTextureMapControl) case. For TextureMapControl3D
    or other unhandled types, log the type name and return False so
    a future contributor can extend this dispatch."""
    try:
        tmc = body.textureMapControl
    except Exception as e:
        _log(logger,
             f"GRAIN ORIENT skip: {_safe_name(body)} textureMapControl unavailable: {e}",
             "DEBUG")
        return False

    if tmc is None:
        _log(logger,
             f"GRAIN ORIENT skip: {_safe_name(body)} textureMapControl is None",
             "DEBUG")
        return False

    tmc_type = type(tmc).__name__

    # Most appearances expose a ProjectedTextureMapControl with a
    # writable ``transform`` Matrix3D property.
    if hasattr(tmc, 'transform'):
        try:
            tmc.transform = matrix
            _log(logger,
                 f"GRAIN ORIENT applied: {_safe_name(body)} via {tmc_type}.transform")
            return True
        except Exception as e:
            _log(logger,
                 f"GRAIN ORIENT fail: {_safe_name(body)} {tmc_type}.transform "
                 f"raised: {e}",
                 "WARNING")
            return False

    # TextureMapControl3D and other variants don't expose a single
    # ``transform`` property - their positioning interface is
    # appearance-specific. Log and skip so future work can extend.
    _log(logger,
         f"GRAIN ORIENT skip: {_safe_name(body)} unsupported tmc type {tmc_type} "
         f"(extend grain_orient to handle this case if needed)",
         "DEBUG")
    return False


# ----------------------------------------------------------------------
# Logging helpers
# ----------------------------------------------------------------------
def _safe_name(body):
    try:
        return body.name or '<unnamed>'
    except Exception:
        return '<body>'


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
