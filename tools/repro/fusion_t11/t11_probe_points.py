"""Numeric T11 loop geometry for the Fusion solver probe: every point in CENTRED sketch coords (inches),
the 3 arc circles per side, plus BOTH kinds of via point per arc -- the phase file's own 'hint' via
(chord midpoint pushed 0.15*chord sideways) and the EXACT arc midpoint on the correct branch.
Usage: python tools/repro/fusion_t11/t11_probe_points.py <widthIn> <heightIn> <bbo> > pts.json
"""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "bspline-frame-builder", "frame-builder"))
from fb_engine.t11_geometry import t11_outline

W, H, BBO = (float(a) for a in sys.argv[1:4])
w, h = W - 2 * BBO, H - 2 * BBO          # safe-zone dims (what t11_outline takes)
o = t11_outline(w, h, 0.75)
hw, hh = w / 2.0, h / 2.0

def c(p):  # safe-zone board coords (origin bottom-left) -> centred sketch coords
    return [p[0] - hw, p[1] - hh]

def arc_mid(p0, p1, centre, radius, major, want_x_less_than_chord_mid):
    cx, cy = centre
    a0 = math.atan2(p0[1] - cy, p0[0] - cx)
    a1 = math.atan2(p1[1] - cy, p1[0] - cx)
    d_ccw = (a1 - a0) % (2 * math.pi)
    for dth in (d_ccw, d_ccw - 2 * math.pi):
        if (abs(dth) > math.pi) != major:
            continue
        m = (cx + radius * math.cos(a0 + dth / 2), cy + radius * math.sin(a0 + dth / 2))
        chord_mid_x = (p0[0] + p1[0]) / 2
        if (m[0] < chord_mid_x) == want_x_less_than_chord_mid:
            return list(m), math.degrees(abs(dth))
    raise SystemExit("no branch matched")

def hint(p0, p1, sign):
    return [(p0[0] + p1[0]) / 2 + sign * 0.15 * abs(p1[0] - p0[0]), (p0[1] + p1[1]) / 2]

E, SH, SW, WH, HHp, base, peak = o["E"], o["shoulder_horn"], o["shoulder_waist_jct"], o["waist_hip_jct"], o["hip_horn"], o["base"], o["peak"]
sh_mid, sh_sweep = arc_mid(SH, SW, o["C_shoulder"], o["r_shoulder"], False, False)   # convex: bulges AWAY (x greater)
wa_mid, wa_sweep = arc_mid(SW, WH, o["C_waist"], o["r_waist"], o["waist_major"], True)  # concave: bulges TOWARD centreline
hi_mid, hi_sweep = arc_mid(WH, HHp, o["C_hip"], o["r_hip"], False, False)

out = {
    "W": W, "H": H, "bbo": BBO, "HW": hw, "HH": hh,
    "peak": c(peak), "E": c(E), "SH": c(SH), "SW": c(SW), "WH": c(WH), "HHp": c(HHp), "base": c(base),
    "arcs": {
        "shoulder": {"p0": c(SH), "p1": c(SW), "centre": c(o["C_shoulder"]), "r": o["r_shoulder"], "mid_exact": c(sh_mid), "mid_hint": c(hint(SH, SW, +1)), "sweep_deg": sh_sweep},
        "waist":    {"p0": c(SW), "p1": c(WH), "centre": c(o["C_waist"]),    "r": o["r_waist"],    "mid_exact": c(wa_mid), "mid_hint": c(hint(SW, WH, -1)), "sweep_deg": wa_sweep},
        "hip":      {"p0": c(WH), "p1": c(HHp), "centre": c(o["C_hip"]),     "r": o["r_hip"],      "mid_exact": c(hi_mid), "mid_hint": c(hint(WH, HHp, +1)), "sweep_deg": hi_sweep},
    },
}
json.dump(out, sys.stdout, indent=1)
