# Frame Builder Engine Projection Rules

## Rule 1: Never defer compute during projection phases

Projection loops (BoundingBoxProjections, SkeletonProjections, legacy Projections) must run with `sketch.isComputeDeferred` left unchanged (no True/False wrapping).

Reason:
- In deferred mode, Fusion may display projected reference geometry after solve while `sketch.project()` returns an empty collection during the projection call.
- Empty projection return breaks immediate semantic ID assignment (`FrameBuilder/name`) and causes mapping gaps.

Expected behavior:
- `sketch.project()` returns entities in-phase.
- IDs are assigned immediately in `_project_step`.
- Projection summaries report real projected counts instead of persistent zero-result for valid sources.

Operational note:
- Keep projection trace logging off by default.
- Enable deep projection trace only for diagnosis with `FRAME_BUILDER_PROJ_TRACE=1`.
