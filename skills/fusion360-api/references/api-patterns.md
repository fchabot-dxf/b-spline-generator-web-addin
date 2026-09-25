# Fusion 360 API Detailed Patterns

## Table of Contents
1. [Complete Add-in Skeleton](#complete-add-in-skeleton)
2. [Sketch Geometry Creation](#sketch-geometry-creation)
3. [Constraint Application](#constraint-application)
4. [Offset Curves — Full Implementation](#offset-curves)
5. [Projection Between Sketches](#projection-between-sketches)
6. [Parameter Management](#parameter-management)
7. [Command Input Patterns](#command-input-patterns)
8. [Template-Driven Parametric Engine](#template-driven-parametric-engine)

---

## Complete Add-in Skeleton

A minimal but robust add-in entry point:

```python
import adsk.core, adsk.fusion, traceback
import os, time, importlib

handlers = []
_refresh_event_id = 'MyAddin_DeferredRefresh'
_refresh_event = None

def _log(msg):
    try:
        path = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'debug.log')
        with open(path, 'a', encoding='utf-8') as f:
            f.write(f'[{time.strftime("%Y-%m-%d %H:%M:%S")}] {msg}\n')
    except: pass

class _DeferredRefreshHandler(adsk.core.CustomEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            stop(None)
            run(None)
        except:
            _log(f"REFRESH CRASH: {traceback.format_exc()}")

def run(context):
    global _refresh_event
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        # Register deferred refresh
        try:
            _refresh_event = app.registerCustomEvent(_refresh_event_id)
            h = _DeferredRefreshHandler()
            _refresh_event.add(h)
            handlers.append(h)
        except: pass

        session_id = str(int(time.time() * 1000))[-6:]

        # Purge stale command definitions
        stale = [d for d in ui.commandDefinitions if d.id.startswith('MyPrefix')]
        for d in stale:
            try: d.deleteMe()
            except: pass

        # Create command definitions with session ID
        current_dir = os.path.dirname(os.path.realpath(__file__))
        cmd_id = f'MyPrefixMain_{session_id}'
        cmd_def = ui.commandDefinitions.addButtonDefinition(
            cmd_id, 'My Command', 'Description',
            os.path.join(current_dir, 'resources', 'MyCommand'))

        h = MyCreatedHandler()
        cmd_def.commandCreated.add(h)
        handlers.append(h)

        # Inject into toolbar
        for tab in ui.allToolbarTabs:
            if tab.id not in ['SolidTab', 'DesignTab', 'FusionSolidTab']:
                continue
            pid = f'MyPrefixPanel_{tab.id}'
            panel = tab.toolbarPanels.itemById(pid) or tab.toolbarPanels.add(pid, 'MY PANEL')

            # Purge stale controls (delete from end!)
            for _ in range(50):
                if panel.controls.count == 0: break
                try: panel.controls.item(panel.controls.count - 1).deleteMe()
                except: break

            c = ui.commandDefinitions.itemById(cmd_id)
            if c:
                ctl = panel.controls.addCommand(c)
                ctl.isPromoted = True

    except:
        _log(f"RUN CRASH: {traceback.format_exc()}")
        if ui: ui.messageBox(f'Error:\n{traceback.format_exc()}')

def stop(context):
    global _refresh_event
    try:
        app = adsk.core.Application.get()
        if not app:
            handlers.clear()
            return
        ui = app.userInterface

        try:
            app.unregisterCustomEvent(_refresh_event_id)
            _refresh_event = None
        except: pass

        if ui:
            for tab in ui.allToolbarTabs:
                try:
                    panels = [p for p in tab.toolbarPanels if p.isValid and p.id.startswith('MyPrefixPanel')]
                    for p in panels:
                        for _ in range(50):
                            if p.controls.count == 0: break
                            try: p.controls.item(p.controls.count - 1).deleteMe()
                            except: break
                        try: p.deleteMe()
                        except: pass
                except: pass

            try:
                defs = [d for d in ui.commandDefinitions if d.id.startswith('MyPrefix')]
                for d in defs:
                    try: d.deleteMe()
                    except: pass
            except: pass
    except: pass
    handlers.clear()
```

---

## Sketch Geometry Creation

### Center Point Rectangle
```python
lines = sketch.sketchCurves.sketchLines
center = adsk.core.Point3D.create(0, 0, 0)
corner = adsk.core.Point3D.create(w_cm / 2, h_cm / 2, 0)
rect_lines = lines.addCenterPointRectangle(center, corner)
# Returns ObjectCollection of 4 SketchLine objects
# Implicit: H/V constraints, center at given point
# rect_lines.item(0) = bottom, .item(1) = right, .item(2) = top, .item(3) = left
```

### Three-Point Arc
```python
arcs = sketch.sketchCurves.sketchArcs
start = adsk.core.Point3D.create(x1, y1, 0)
mid = adsk.core.Point3D.create(xm, ym, 0)
end = adsk.core.Point3D.create(x2, y2, 0)
arc = arcs.addByThreePoints(start, mid, end)
```

### Lines
```python
lines = sketch.sketchCurves.sketchLines
line = lines.addByTwoPoints(
    adsk.core.Point3D.create(x1, y1, 0),
    adsk.core.Point3D.create(x2, y2, 0))
```

### Construction Lines (Diagonals for centering)
```python
diag = lines.addByTwoPoints(corner1, corner2)
diag.isConstruction = True
sketch.geometricConstraints.addMidPoint(sketch.originPoint, diag)
```

---

## Constraint Application

### Safe Coincident (always use this pattern)
```python
def safe_coincident(sketch, point, target):
    """Add coincident only if not already coincident."""
    try:
        if hasattr(point, 'geometry') and hasattr(target, 'geometry'):
            if point.geometry.distanceTo(target.geometry) < 0.0001:
                return  # already coincident
        sketch.geometricConstraints.addCoincident(point, target)
    except Exception as e:
        pass  # log if needed
```

### Tangent
```python
sketch.geometricConstraints.addTangent(arc, line)
```

### Equal
```python
sketch.geometricConstraints.addEqual(line1, line2)
```

### Horizontal / Vertical
```python
# Only add if not already implicit (e.g., from addCenterPointRectangle)
try:
    sketch.geometricConstraints.addHorizontal(line)
except: pass
```

### MidPoint (for centering shapes at origin)
```python
sketch.geometricConstraints.addMidPoint(sketch.originPoint, diagonal_line)
```

---

## Offset Curves

Full robust implementation with 3-method cascade:

```python
def create_offset(sketch, source_curves, dist_expr, direction_point=None):
    """
    Create offset curves with automatic API fallback.
    source_curves: ObjectCollection of SketchCurve
    dist_expr: parameter expression string like "boundingboxoffset"
    direction_point: Point3D for offset direction (default: origin)
    Returns: (offset_constraint_or_None, offset_curves_collection_or_None)
    """
    if direction_point is None:
        direction_point = adsk.core.Point3D.create(0, 0, 0)

    # Method 1: Modern parametric API
    try:
        val_input = adsk.core.ValueInput.createByString(dist_expr)
        offset_input = sketch.geometricConstraints.createOffsetInput(source_curves, val_input)
        offset_const = sketch.geometricConstraints.addOffset2(offset_input)
        return (offset_const, None)
    except: pass

    # Method 2: Legacy parametric API (may work on older Fusion)
    try:
        val_input = adsk.core.ValueInput.createByString(dist_expr)
        offset_const = sketch.geometricConstraints.addOffset(source_curves, direction_point, val_input)
        return (offset_const, None)
    except: pass

    # Method 3: Non-parametric fallback
    try:
        design = adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
        dist_cm = design.unitsManager.evaluateExpression(dist_expr, 'cm')
        offset_curves = sketch.offset(source_curves, direction_point, dist_cm)
        return (None, offset_curves)
    except: pass

    return (None, None)
```

---

## Projection Between Sketches

```python
# In sketch_B, project entity from sketch_A
source = entity_map["sketch_A"]["my_arc"]
projections = sketch_B.project(source)

# project() returns ObjectCollection — usually 1 item per entity
for i in range(projections.count):
    item = projections.item(i)
    entity_map["sketch_B"]["projected_arc"] = item
    # item is a valid SketchCurve (SketchArc, SketchLine, etc.)
    # It's reference/construction geometry
```

Projected curves can be used in:
- Offset operations
- Constraints (tangent, coincident, etc.)
- As dimension references
- As extrusion profiles (if they form a closed loop)

---

## Parameter Management

### Creating User Parameters
```python
design = adsk.fusion.Design.cast(app.activeProduct)

# Add parameter (value in cm)
design.userParameters.add("widthIn",
    adsk.core.ValueInput.createByReal(7 * 2.54),  # 7 inches in cm
    "cm", "Frame width")

# Or with string expression
design.userParameters.add("boundingboxoffset",
    adsk.core.ValueInput.createByString("0.25 in"),
    "cm", "Offset distance")
```

### Reading Parameter Values
```python
param = design.userParameters.itemByName("widthIn")
if param:
    value_cm = param.value        # always in cm
    value_in = param.value / 2.54  # convert to inches
    expression = param.expression  # e.g., "7 in"
```

### Using Parameters in Dimensions
```python
# Dimension driven by parameter expression
sketch.sketchDimensions.addDistanceDimension(
    point1, point2,
    adsk.fusion.DimensionOrientations.HorizontalDimensionOrientation,
    adsk.core.Point3D.create(x, y, 0)  # text position
).parameter.expression = "widthIn"
```

---

## Command Input Patterns

### Dropdown
```python
drop = inputs.addDropDownCommandInput('style_select', 'Style',
    adsk.core.DropDownStyles.LabeledIconDropDownStyle)
drop.listItems.add("Option A", True, '')   # True = selected
drop.listItems.add("Option B", False, '')
```

### Value Input
```python
inputs.addValueInput('width_in', 'Width', 'in',
    adsk.core.ValueInput.createByReal(7.0))  # default 7 inches
```

### Boolean Toggle
```python
inputs.addBoolValueInput('use_manual', 'Manual Override', True, '', False)
```

### Dynamic Visibility (InputChanged handler)
```python
class MyInputHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        if args.input.id == 'use_manual':
            manual = args.input.value
            inputs = args.firingEvent.sender.commandInputs
            inputs.itemById('width_in').isVisible = manual
            inputs.itemById('height_in').isVisible = manual
```

---

## Template-Driven Parametric Engine

For complex geometry, define templates as data structures and execute them step-by-step:

```python
TEMPLATE = {
    "Parameters": [
        {"Name": "widthIn", "Expression": "7 in", "Units": "cm", "Comment": "Width"},
        {"Name": "heightIn", "Expression": "9 in", "Units": "cm", "Comment": "Height"},
    ],
    "Sketches": [
        {
            "Name": "bounding-box",
            "Plane": "XY",
            "Geometry": [
                {"Type": "CenterPointRect", "ID": "bbox",
                 "Center": [0, 0], "Corner": ["widthIn/2", "heightIn/2"]},
            ],
            "Offsets": [
                {"TargetID": "inner_bbox", "SourceID": ["bbox:L0", "bbox:L1", "bbox:L2", "bbox:L3"],
                 "DistanceExpr": "boundingboxoffset"},
            ],
            "Constraints": [
                {"Type": "MidPoint", "Targets": ["ORIGIN", "bbox:D1"]},
            ],
        }
    ]
}
```

The engine walks through Parameters → Sketches → Geometry → Offsets → Constraints → Dimensions, tracking every entity in the entity_map for cross-referencing.
