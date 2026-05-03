---
name: fusion360-api
description: "Expert guidance for Fusion 360 Python API add-in development. Use when writing or debugging Fusion 360 add-ins, sketch geometry creation, constraints, offsets, toolbar/panel management, command handlers, hot-reload patterns, or any Fusion API Python code. Covers critical API gotchas like retired methods (addOffset), solver crashes from redundant constraints, live collection iteration bugs, deferred execution via CustomEvent, and parametric sketch building. Trigger whenever user mentions Fusion 360 API, add-in development, sketch constraints, offset curves, toolbar buttons, command definitions, or Python scripting for Fusion."
---

# Fusion 360 Python API — Battle-Tested Patterns & Pitfalls

This skill captures hard-won knowledge from real production add-in development. Every item here was discovered through actual crashes, silent failures, or hours of log analysis.

## Critical API Gotchas

### 1. `addOffset` is RETIRED — Use Modern API

The `GeometricConstraints.addOffset(curves, directionPoint, offset)` method is retired in current Fusion 360. It throws cryptic SWIG type errors like:

```
argument 2 of type 'std::vector< adsk::core::Ptr< adsk::fusion::SketchCurve > > const &'
```

Use this cascade instead:

```python
# Attempt 1: Modern API (preferred — parametric)
try:
    val_input = adsk.core.ValueInput.createByString(dist_expr)
    offset_input = sketch.geometricConstraints.createOffsetInput(curves, val_input)
    offset_const = sketch.geometricConstraints.addOffset2(offset_input)
except Exception:
    offset_const = None

# Attempt 2: sketch.offset() fallback (works but non-parametric, takes float not ValueInput)
if offset_const is None:
    design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    dist_val = design.unitsManager.evaluateExpression(dist_expr, 'cm')
    offset_curves = sketch.offset(curves, direction_point, dist_val)
```

The `sketch.offset()` method takes a **numeric float** (in cm, Fusion internal units), not a ValueInput. It returns an ObjectCollection of the new curves, not a constraint object.

### 2. Redundant Coincident Constraints Crash the Solver

If a point is already at the target location (e.g., center point of `addCenterPointRectangle` is already at origin), adding a coincident constraint crashes Fusion's constraint solver. Always check distance first:

```python
dist = point.geometry.distanceTo(target.geometry)
if dist > 0.0001:  # tolerance in cm
    sketch.geometricConstraints.addCoincident(point, target)
# else: skip — already coincident
```

This applies to ALL coincident constraints, not just origin. Build the distance check into every coincident call.

### 3. `addCenterPointRectangle` Creates Implicit Constraints

When you call `sketchLines.addCenterPointRectangle(centerPt, cornerPt)`, Fusion automatically adds:
- Horizontal constraints on top/bottom lines
- Vertical constraints on left/right lines
- The center point is placed at `centerPt`

Do NOT add H/V constraints or coincident-to-origin on these lines/points again. Redundant constraints cause solver crashes or unpredictable behavior. If you need to apply them defensively, wrap each in try/except.

### 4. `addOffset` Argument Order vs `sketch.offset`

These two methods have different signatures — don't mix them up:

```python
# Constraint-based (parametric):
sketch.geometricConstraints.createOffsetInput(curves_collection, value_input)

# Sketch-level (non-parametric):
sketch.offset(curves_collection, direction_point, distance_float)
```

The direction point (Point3D) determines which side the offset goes. For inward offset of a shape centered at origin, use `Point3D.create(0, 0, 0)`.

### 5. Offset Direction and Sign

The offset direction is determined by the direction point relative to the source curves. A positive offset value goes toward the direction point. If the offset appears on the wrong side, either negate the distance expression or move the direction point.

For parametric expressions, use the parameter name directly: `"boundingboxoffset"` not `"-boundingboxoffset"` — adjust the direction point instead.

---

## Add-in Lifecycle Patterns

### Deferred Refresh via CustomEvent

Never call `stop()` + `run()` inside a command execute handler — it tries to delete command definitions while they're still executing, which hangs Fusion. Use a CustomEvent for deferred execution:

```python
_refresh_event_id = 'MyAddin_DeferredRefresh'
_refresh_event = None

class _DeferredRefreshHandler(adsk.core.CustomEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        stop(None)
        run(None)

def run(context):
    global _refresh_event
    app = adsk.core.Application.get()
    _refresh_event = app.registerCustomEvent(_refresh_event_id)
    h = _DeferredRefreshHandler()
    _refresh_event.add(h)
    handlers.append(h)
    # ... rest of run() ...

# In the refresh button's execute handler:
adsk.core.Application.get().fireCustomEvent(_refresh_event_id, '{}')
```

### Toolbar Button Stacking

Each `run()` creates new command definitions with unique session IDs. If old controls aren't cleaned up, buttons multiply. Always purge panels before adding new controls:

```python
# Delete from END of collection (live collection iteration bug — see below)
for _ in range(50):  # safety counter
    if panel.controls.count == 0:
        break
    try:
        panel.controls.item(panel.controls.count - 1).deleteMe()
    except:
        break
```

Also purge stale command definitions on startup:

```python
stale = [d for d in ui.commandDefinitions if d.id.startswith('MyPrefix')]
for d in stale:
    try: d.deleteMe()
    except: pass
```

### Live Collection Iteration Bug

Fusion API collections are live — deleting item[0] shifts all indices. Iterating forward while deleting causes skips or crashes. Always:
- Delete from the END: `collection.item(collection.count - 1).deleteMe()`
- Or collect to a list first: `items = [c for c in collection]` then delete
- Always use a safety counter to prevent infinite loops

### stop() Must Be Bulletproof

The `stop()` function runs when the user clicks "Stop" in the Add-Ins dialog. If it throws or hangs, the add-in becomes unkillable (requires Fusion restart). Rules:
- Wrap every block in try/except
- Use safety counters on all loops
- Check `isValid` before calling `deleteMe()`
- Clear the handlers list at the very end
- Don't depend on other modules (they might already be unloaded)

```python
def stop(context):
    try:
        app = adsk.core.Application.get()
        if not app:
            handlers.clear()
            return
        # ... cleanup ...
    except:
        pass
    handlers.clear()  # ALWAYS clear, even on error
```

---

## Hot-Reload Pattern

For rapid development, use `importlib.reload()` in execute handlers so code changes take effect without restarting Fusion:

```python
from . import my_engine
importlib.reload(my_engine)
```

If `my_engine` imports other modules, reload them first (reload doesn't cascade):

```python
from . import utils, my_engine
importlib.reload(utils)
importlib.reload(my_engine)
```

**Critical**: Clear `__pycache__` when deploying new .py files. Stale .pyc files will run old code even if the .py is updated.

---

## Parametric Sketch Building

### Entity Map Pattern

Track every created entity by name for later reference (constraints, dimensions, projections):

```python
entity_map = {"sketch_name": {}}

# After creating geometry:
entity_map["sketch1"]["my_line"] = line_entity
entity_map["sketch1"]["my_line:S"] = line_entity.startSketchPoint
entity_map["sketch1"]["my_line:E"] = line_entity.endSketchPoint
```

Convention: `:S` for start point, `:E` for end point, `:CP` for center point.

### Projecting Between Sketches

To reference geometry from sketch A in sketch B, project it:

```python
source_entity = entity_map["sketch_A"]["my_arc"]
projections = sketch_B.project(source_entity)
for i in range(projections.count):
    projected = projections.item(i)
    entity_map["sketch_B"]["projected_arc"] = projected
```

Projected entities become reference geometry (construction-like). They are valid SketchCurves and can be used in offsets, constraints, and dimensions.

### Null Safety on Sketch Points

Sketch points can become invalid during constraint solving. Always guard:

```python
for idx, p in enumerate(sketch.sketchPoints):
    try:
        if not p.isValid:
            continue
        pg = p.geometry
        if not pg:
            continue
        # safe to use pg.x, pg.y, etc.
    except Exception:
        continue
```

### Parameter Expressions

Use string expressions referencing user parameters for parametric dimensions:

```python
# Creating a parameter
design.userParameters.add("widthIn", adsk.core.ValueInput.createByReal(7 * 2.54), "cm", "")

# Referencing in a dimension
adsk.core.ValueInput.createByString("widthIn")
adsk.core.ValueInput.createByString("-Skel_Frame_Offset")  # negation works
adsk.core.ValueInput.createByString("widthIn / 2")  # expressions work
```

Fusion stores everything in cm internally. A parameter set to `7 * 2.54` (cm) displays as 7" when units are inches.

### Evaluating Expressions to Numeric Values

When you need the numeric value of a parameter expression:

```python
design = adsk.fusion.Design.cast(app.activeProduct)
value_cm = design.unitsManager.evaluateExpression("boundingboxoffset", "cm")
```

---

## Debugging & Logging

### Dual-Write Logger Pattern

Write logs to both the deployed AddIns folder and the source project folder so you can always find them:

```python
class DebugLogger:
    def __init__(self, addin_root):
        self.log_paths = [os.path.join(addin_root, "debug.log")]
        # Also write to source project via handshake file
        handshake = os.path.join(addin_root, "project_path.json")
        if os.path.exists(handshake):
            config = json.load(open(handshake))
            source_log = os.path.join(os.path.dirname(config["project_root"]), "debug.log")
            self.log_paths.append(source_log)
```

The `project_path.json` handshake file bridges deployed code to the source project:

```json
{"project_root": "C:\\Users\\me\\MyProject\\tools"}
```

### Log Everything During Development

Log before and after every API call, especially:
- Constraint creation (type, targets, success/fail)
- Geometry creation (type, coordinates, entity count)
- Offset attempts (method tried, curve count, result)
- Collection iterations (count before/after deletions)

This is the only way to diagnose Fusion crashes — the app may terminate before showing an error.

---

## Common Error Messages and Their Causes

| Error | Cause | Fix |
|-------|-------|-----|
| `argument 2 of type 'std::vector<SketchCurve>'` | Using retired `addOffset` | Switch to `createOffsetInput` + `addOffset2` |
| Fusion hangs on Stop | `stop()` deletes command during its own handler | Use CustomEvent deferred pattern |
| Buttons multiply on refresh | Panel controls not cleaned before adding new ones | Purge all controls on startup |
| Constraint solver crash | Redundant coincident on already-coincident point | Distance check before addCoincident |
| Old code runs after deploy | Stale `__pycache__/*.pyc` | Delete `__pycache__` folder |
| `isValid` returns False | Entity invalidated by solver/undo | Always check `isValid` before accessing |
| Offset appears on wrong side | Direction point on wrong side of curves | Move direction point or negate distance |

---

## Fusion Internal Units

Fusion stores all values in **centimeters** internally, regardless of the document's display units.
- 1 inch = 2.54 cm
- `addByTwoPoints(Point3D.create(0, 0, 0), Point3D.create(2.54, 0, 0))` = 1 inch line
- `ValueInput.createByReal(2.54)` = 1 inch
- `ValueInput.createByString("1 in")` = also 1 inch (parsed by Fusion)
- Parameters created with `createByReal` use cm; use `createByString` for unit-aware values

For more API details, read `references/api-patterns.md`.
