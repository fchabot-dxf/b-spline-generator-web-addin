import hashlib, json, os, sys, types
root = sys.argv[1]
fb = os.path.join(root, "bspline-frame-builder", "frame-builder")
sys.path.insert(0, fb)
from fb_engine.template_resolver import resolve_template
from fb_engine import declared_profiles as dp
from fb_engine.panel_lip import apply_panel_lip
from fb_engine.seed_geometry import apply_seed_geometry
from fb_engine import frame_definition as fd
out = []
for tid in ["template_1", "template_2", "template_3", "template_4", "template_5", "template_8"]:
    for ui in (None, {"frame_thickness": 0.5, "boundingboxoffset": 0.4}):
        spec, prefix = resolve_template(tid, ui) if ui is not None else resolve_template(tid)
        out.append(json.dumps([tid, prefix, spec], sort_keys=True, default=str))
    spec, _ = resolve_template(tid)
    out.append(json.dumps(apply_panel_lip(spec, 0.125), sort_keys=True, default=str))
    fr = spec["Frame"]; reg = fr["regions"]
    res = []
    for c in reg["outline"]:
        res.append(dp.bar_index(c, reg))
    for k, m in enumerate(reg["miters"]):
        ids = {reg["outline"][0], "inner_" + reg["outline"][0], dp.miter_curve_id(*m)}
        try: res.append(dp.classify(ids, fr))
        except Exception as e: res.append(repr(e))
    for ids in (set(reg["outline"]) | {reg["surround"]}, set(reg["inner"][:3]), set(reg["outline"][:2]), {"zzz"}):
        try: res.append(dp.classify(ids, fr))
        except Exception as e: res.append(repr(e))
    out.append(json.dumps(res, sort_keys=True, default=str))
out.append(json.dumps([fd.COMMON_FRAME_FEATURES, fd.frame_fit(7, 9, 0.75, 0.25), fd.frame_fit(5.51, 1.97, 0.75, 0.25)], sort_keys=True))
print(hashlib.sha256("\n".join(out).encode()).hexdigest(), len(out))
