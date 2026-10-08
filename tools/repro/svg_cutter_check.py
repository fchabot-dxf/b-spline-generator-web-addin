"""Seat D 2026-10-08: a cutter-style import check of the app's SVG download (stdlib only: no Inkscape / lxml on this PC).
Usage: python svg_cutter_check.py <file.svg> [expected_w_in expected_h_in]"""
import re, sys, json
import xml.etree.ElementTree as ET

SVG = '{http://www.w3.org/2000/svg}'
INK = '{http://www.inkscape.org/namespaces/inkscape}'
path, exp = sys.argv[1], [float(v) for v in sys.argv[2:4]] if len(sys.argv) >= 4 else None
problems, notes = [], {}
try:
    root = ET.parse(path).getroot()
except ET.ParseError as e:
    print(json.dumps({'file': path, 'ok': False, 'problems': [f'XML parse error: {e}']})); sys.exit(1)

# 1. real size: width / height in inches (or px at the declared dpi) agree with the viewBox in inches
w, h, vb = root.get('width'), root.get('height'), root.get('viewBox')
dpi = float(root.get('data-export-dpi') or 96)
def to_in(v):
    m = re.fullmatch(r'\s*([\d.]+)\s*(in|px|mm|cm)?\s*', v or '')
    if not m: return None
    n, u = float(m.group(1)), m.group(2) or 'px'
    return {'in': n, 'px': n / dpi, 'mm': n / 25.4, 'cm': n / 2.54}[u]
wi, hi = to_in(w), to_in(h)
vbn = [float(x) for x in (vb or '').replace(',', ' ').split()] if vb else []
notes['size'] = {'width': w, 'height': h, 'viewBox': vb, 'dpi': dpi, 'inches': [wi, hi]}
if wi is None or hi is None: problems.append(f'width/height not a length: {w} / {h}')
if len(vbn) != 4: problems.append(f'no viewBox: {vb}')
elif wi and hi and (abs(vbn[2] - wi) > 1e-3 or abs(vbn[3] - hi) > 1e-3):
    problems.append(f'viewBox {vbn[2]}x{vbn[3]} user units != the declared size {wi:.4f}x{hi:.4f} in (1 unit = 1 in expected)')
if exp and wi and hi and (abs(wi - exp[0]) > 1e-3 or abs(hi - exp[1]) > 1e-3):
    problems.append(f'size {wi}x{hi} in, expected {exp[0]}x{exp[1]}')
if root.get('preserveAspectRatio') not in (None, 'xMidYMid meet') and wi and vbn and abs(wi / hi - vbn[2] / vbn[3]) > 1e-6:
    problems.append('preserveAspectRatio none with a mismatched aspect')

# 2. every top-level group is a named Inkscape layer; ids unique
tops = [c for c in root if c.tag == SVG + 'g']
for g in tops:
    if g.get(INK + 'groupmode') != 'layer' or not g.get(INK + 'label'): problems.append(f'top group {g.get("id")} is not a named Inkscape layer')
ids = [e.get('id') for e in root.iter() if e.get('id')]
dups = sorted({i for i in ids if ids.count(i) > 1})
if dups: problems.append(f'duplicate ids: {dups[:5]}{"..." if len(dups) > 5 else ""}')
notes['layers'] = [(g.get('id'), g.get(INK + 'label')) for g in tops]

# 3. paths: closed, non-degenerate; fills flat colours only (no url / pattern), no stroke on bricks
def poly_area(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2
def subpaths(d):
    out, cur = [], None
    for cmd, args in re.findall(r'([MLZmlzHVhvCcSsQqTtAa])([^MLZmlzHVhvCcSsQqTtAa]*)', d):
        nums = [float(n) for n in re.findall(r'-?[\d.]+(?:e-?\d+)?', args)]
        if cmd == 'M': cur = {'pts': [tuple(nums[0:2])] + [tuple(nums[i:i + 2]) for i in range(2, len(nums), 2)], 'closed': False, 'curves': False}; out.append(cur)
        elif cmd == 'L' and cur is not None: cur['pts'] += [tuple(nums[i:i + 2]) for i in range(0, len(nums), 2)]
        elif cmd in 'Zz' and cur is not None: cur['closed'] = True
        elif cur is not None: cur['curves'] = True
    return out
counts = {'bricks': 0, 'grout': 0, 'art': 0, 'frame': 0}
fills = {}
for g in tops:
    kind = (g.get('id') or '').split(':')[0]
    for p in g.iter(SVG + 'path'):
        if kind in counts: counts[kind] += 1
        f = p.get('fill')
        fills.setdefault(kind, {}).setdefault(f, 0); fills[kind][f] += 1
        if f and 'url(' in f: problems.append(f'{kind} path {p.get("id")} fill references {f}')
        if kind in ('bricks', 'grout'):
            d = p.get('d') or ''
            sps = subpaths(d)
            if not sps: problems.append(f'{kind} path {p.get("id")} has no geometry'); continue
            for sp in sps:
                if not sp['closed']: problems.append(f'{kind} path {p.get("id")} has an OPEN subpath'); break
                if not sp['curves'] and (len(sp['pts']) < 3 or poly_area(sp['pts']) < 1e-6): problems.append(f'{kind} path {p.get("id")} has a degenerate subpath ({len(sp["pts"])} pts)'); break
        if kind == 'bricks':
            if p.get('stroke') not in (None, 'none'): problems.append(f'brick {p.get("id")} has a stroke {p.get("stroke")}')
            if not re.fullmatch(r'#([0-9a-f]{2})\1\1', f or '', re.I): problems.append(f'brick {p.get("id")} fill {f} is not a flat grey')
        if kind == 'grout' and p.get('fill-rule') != 'evenodd': problems.append(f'grout {p.get("id")} not even-odd')
for e in root.iter():
    if e.tag in (SVG + 'pattern', SVG + 'image'): problems.append(f'an embedded <{e.tag.split("}")[1]}> (id {e.get("id")})')
notes['counts'] = counts
notes['fills'] = {k: dict(sorted(v.items(), key=lambda kv: -kv[1])[:6]) for k, v in fills.items()}
print(json.dumps({'file': path.split('/')[-1], 'ok': not problems, 'problems': problems[:25], 'nProblems': len(problems), 'notes': notes}, indent=1))
