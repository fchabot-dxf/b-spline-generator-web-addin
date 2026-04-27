"""cam_engine — Manufacturing Model + Setup orchestration for the
CAM-builder palette.

Layered modules:
  - cam_workspace      Workspace activation + ``adsk.cam.CAM`` cast guard.
  - parameter_introspect  Runtime enumeration of CAM parameter choices
                       (stock modes, WCS modes) so we never hardcode
                       Autodesk's internal enum strings.
  - mm_builder         Build the 3 Manufacturing Models (stock /
                       B-spline set / frame).
  - setup_builder      Build the 4 Setups (Stock, B-spline Top,
                       B-spline Bottom, Frame) bound to MMs via
                       ``setupInput.models``.
  - cam_coordinator    Top-level orchestrator the UI calls into.

See ``CAM_API_NOTES.md`` at the project root for verified API surface
and known gotchas.
"""
