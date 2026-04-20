"""Role-point slot map shared between generate and rename paths.

A SketchPoint that serves as the start / end / center of a named curve
inherits that curve's identity via a role suffix (``"curve_name:S"``,
``":E"``, ``":C"``). Two independent passes need the mapping from slot
name to suffix:

* ``relation_hints._derive_point_role_id`` — READ side. Given a picked
  SketchPoint, walks connected curves and returns the derived role ID
  if any curve has this point in one of its role slots. Used by the
  ownership gate (to accept the point as derived-owned) and the label
  pass (to show "horn_TL:E" in the palette items list).

* ``rename_selection._stamp_role_points`` — WRITE side. When a curve
  gets renamed, stamps matching FrameBuilder IDs on its role points so
  the FrameBuilder runtime resolver (which does literal attribute
  match, no role-suffix fallback) can find them.

Both sides MUST agree on every entry or a stamped ``:E`` won't
round-trip through the ownership gate. Keeping the single source of
truth here instead of duplicating the tuple in both modules closes
that drift window; when midpoint support or a new curve subtype adds
another role slot, one edit in one file touches both sides.

The tuple order is load-bearing only insofar as ``_derive_point_role_id``
returns the FIRST match — if a single curve somehow exposed the same
point as both start and center (shouldn't happen in valid sketches,
but defensive), the earlier-listed suffix wins. Keeping start/end
before center matches the intuitive "endpoints before the center"
reading order.
"""

# (slot_attribute_name, role_suffix)
ROLE_POINT_SLOTS = (
    ('startSketchPoint',  ':S'),
    ('endSketchPoint',    ':E'),
    ('centerSketchPoint', ':C'),
)
