"""
record_frame_parity.py — FB-APP S4: record the frame-parity GOLDENS from a
real Fusion build. The app's frame preview is compared against these (§5.2 of
FB-APP-DESIGN.md). They are re-recorded only on purpose.

Run INSIDE Fusion (e.g. via the fusion360 MCP bridge's fusion_execute): exec
this file's source, then call

    main(OUT_DIR, [("template_1", 7, 9), ("template_2", 12, 6), ...])

Hygiene (hard rules): every case builds in its OWN new scratch document,
which is closed via its own handle in a `finally` and never saved; the
user's documents are never read or written; nothing is added to
sys.path / sys.modules. It calls the frame builder the installed add-in has
already loaded (sys.modules['frame_engine_core'] / 'fb_engine.*').

The core body is DECLARED, not copied from a real Send: a flat box
widthIn x heightIn x CORE_THICKNESS_IN whose underside is z = 0. That makes
the goldens reproducible at any board size. (A real Send panel's underside is
sculpted; F2 measured that separately.)

Units in the output: inches (lengths), square inches (areas), cubic inches
(volumes); Fusion's internal cm are converted.
"""
import json
import os
import sys
import time

import adsk.core
import adsk.fusion

CORE_THICKNESS_IN = 0.75
FRAME_THICKNESS = "template default (0.75 in)"
FRAME_BOTTOM = "-1 in"
CM = 2.54


def _r(v, n=5):
    return round(v, n)


def _pt(p):
    return [_r(p.x / CM), _r(p.y / CM)]


def _fb_id(entity):
    try:
        a = entity.attributes.itemByName("FrameBuilder", "ID")
        return a.value if a else None
    except Exception:
        return None


def _curves(sketch):
    out = {}
    for c in sketch.sketchCurves:
        cid = _fb_id(c)
        if not cid:
            continue
        g = c.worldGeometry
        entry = {"construction": bool(c.isConstruction)}
        if isinstance(c, adsk.fusion.SketchLine):
            entry.update(type="line", start=_pt(g.startPoint), end=_pt(g.endPoint))
        elif isinstance(c, adsk.fusion.SketchArc):
            ev = g.evaluator
            ok, p0, p1 = ev.getParameterExtents()
            ok, mid = ev.getPointAtParameter((p0 + p1) / 2.0)
            entry.update(type="arc", start=_pt(g.startPoint), end=_pt(g.endPoint), mid=_pt(mid),
                         center=_pt(g.center), radius=_r(g.radius / CM))
        else:
            entry.update(type=type(c).__name__)
        out[cid] = entry
    return dict(sorted(out.items()))


def _bbox(bb):
    return {"min": [_r(bb.minPoint.x / CM), _r(bb.minPoint.y / CM), _r(bb.minPoint.z / CM)],
            "max": [_r(bb.maxPoint.x / CM), _r(bb.maxPoint.y / CM), _r(bb.maxPoint.z / CM)]}


def _make_core(d, w_in, h_in):
    root = d.rootComponent
    bs = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    bs.component.name = "B-Spline Set"
    cl = bs.component.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    cl.component.name = "Clean"
    obb = adsk.core.OrientedBoundingBox3D.create(
        adsk.core.Point3D.create(0, 0, CORE_THICKNESS_IN * CM / 2),
        adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
        w_in * CM, h_in * CM, CORE_THICKNESS_IN * CM)
    box = adsk.fusion.TemporaryBRepManager.get().createBox(obb)
    bf = cl.component.features.baseFeatures.add()
    bf.startEdit()
    cl.component.bRepBodies.add(box, bf)
    bf.finishEdit()
    cl.component.bRepBodies.item(0).name = "panel"


def _core_proxy(d):
    """The core body as an occurrence-path proxy (what a face pick gives),
    looked up FRESH. A proxy taken before the frame build adds its
    occurrence goes stale (measured: body.appearance then raises
    InternalValidationError getObjectPath)."""
    bs = [o for o in d.rootComponent.occurrences if o.component.name == "B-Spline Set"][0]
    cl = [o for o in bs.childOccurrences if o.component.name == "Clean"][0]
    return cl.bRepBodies.item(0)


def _underside(body):
    def nz(f):
        ok, n = f.evaluator.getNormalAtPoint(f.pointOnFace)
        return n.z
    return sorted(body.faces, key=nz)[0]


def record_case(template_id, w_in, h_in, shot_path=None):
    app = adsk.core.Application.get()
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    try:
        d = adsk.fusion.Design.cast(doc.products.itemByProductType("DesignProductType"))
        d.designType = adsk.fusion.DesignTypes.ParametricDesignType
        up = d.userParameters
        up.add("widthIn", adsk.core.ValueInput.createByString(f"{w_in} in"), "in", "parity golden")
        up.add("heightIn", adsk.core.ValueInput.createByString(f"{h_in} in"), "in", "parity golden")
        _make_core(d, w_in, h_in)

        fe = sys.modules["frame_engine_core"]
        lg = sys.modules["fb_utils.fb_logger"].DebugLogger(os.path.dirname(os.path.dirname(fe.__file__)))
        # No ui_data override: BuildContext.resolve_val does float(ui_data[name]),
        # so a unit-suffixed value ('0.75 in') raises, is swallowed as FAIL
        # RESOLVE and zeroes the offset (measured F3). The template's own
        # declared default (0.75 in) is what the goldens record.
        fe.build_frame_logic(template_id, "joint", external_logger=lg, data={"ui_data": {}})
        sys.modules["fb_engine.solid_coordinator"].build_solid_logic_v3(
            to_face=_underside(_core_proxy(d)), start_offset_expr=FRAME_BOTTOM, appearance_name=None,
            external_logger=lg)

        root = d.rootComponent
        fc = [o for o in root.occurrences if o.component.name.startswith("Frame_")][0].component
        sk = {s.name.split("_", 1)[1]: s for s in fc.sketches}  # "T1_2_shape_outline" -> "2_shape_outline"
        sk3 = sk["3_frame_enclosure"]
        profiles = []
        for i in range(sk3.profiles.count):
            p = sk3.profiles.item(i)
            profiles.append({"area": _r(p.areaProperties().area / CM ** 2),
                             "bbox": _bbox(p.boundingBox)})
        profiles.sort(key=lambda e: (e["bbox"]["min"], e["area"]))
        bars = {b.name: {"bbox": _bbox(b.boundingBox), "volume": _r(b.volume / CM ** 3)}
                for b in fc.bRepBodies}
        panel = _core_proxy(d)
        tl = d.timeline
        result = {
            "meta": {
                "template": template_id, "widthIn": w_in, "heightIn": h_in,
                "frame_thickness": FRAME_THICKNESS, "frame_height_offset": FRAME_BOTTOM,
                "core": f"flat box {w_in}x{h_in}x{CORE_THICKNESS_IN} in, underside z=0",
                "units": "in / in^2 / in^3", "recorded": time.strftime("%Y-%m-%d"),
                "recorder": "tools/repro/record_frame_parity.py",
                "timelineHealthy": all(tl.item(i).healthState == 0 for i in range(tl.count)),
            },
            "sketch2_shape_outline": _curves(sk["2_shape_outline"]),
            "sketch3_frame_enclosure": _curves(sk3),
            "sketch3_profiles": profiles,
            "bars": dict(sorted(bars.items())),
            "panelAfterTrim": {"bbox": _bbox(panel.boundingBox), "volume": _r(panel.volume / CM ** 3)},
        }
        if shot_path:
            vp = app.activeViewport
            cam = vp.camera
            cam.viewOrientation = adsk.core.ViewOrientations.IsoTopRightViewOrientation
            cam.isFitView = True
            vp.camera = cam
            vp.saveAsImageFile(shot_path, 1200, 800)
        return result
    finally:
        doc.close(False)


def main(out_dir, cases, shot_dir=None):
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for template_id, w, h in cases:
        tag = f"{template_id}_{w}x{h}"
        shot = os.path.join(shot_dir, time.strftime("%H%M") + f"_F3_parity_{tag}.png") if shot_dir else None
        res = record_case(template_id, w, h, shot)
        path = os.path.join(out_dir, tag + ".json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(res, indent=2, sort_keys=True) + "\n")
        written.append((path, len(res["sketch2_shape_outline"]), len(res["bars"]), res["meta"]["timelineHealthy"]))
    return written
