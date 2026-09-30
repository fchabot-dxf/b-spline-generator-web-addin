import hashlib, json, os, sys
root = sys.argv[1]
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "bspline-frame-builder", "CAM-builder", "test_mm_builder_frame_layout.py")).read()
src = src.replace('_HERE = os.path.dirname(os.path.realpath(__file__))', f'_HERE = {os.path.join(root, "bspline-frame-builder", "CAM-builder")!r}')
g = {"__name__": "abcam"}
exec(compile(src, "abcam", "exec"), g)
mm_builder, _mm, T1 = g["mm_builder"], g["_mm"], g["T1_BARS"]
assert mm_builder.__file__.startswith(root), mm_builder.__file__
out = []
cases = {"t1": T1, "t1_missing_left": {k: v for k, v in T1.items() if k != "frame_left"},
         "t1_plus_extra": dict(T1, frame_extra=((0, 0, -2.54), (1, 3, 0))),
         "none": {"panel": ((0, 0, 0), (1, 1, 1))},
         "t1_swapped_aspect": {k: ((v[0][1], v[0][0], v[0][2]), (v[1][1], v[1][0], v[1][2])) for k, v in T1.items()}}
for name, bars in cases.items():
    mm, frame = _mm(bars)
    r = mm_builder._populate_frame_geometry(mm, None, None)
    out.append(json.dumps([name, r, frame.features.moveFeatures.log, [(b.name, b.mn, b.mx) for b in frame.bRepBodies]]))
print(hashlib.sha256("\n".join(out).encode()).hexdigest(), len(out))
