"""F16 (SE16): static mockups of the cut tool, for Fred (CUT-TOOL-DESIGN.md). A brick lattice (3 rails; ties
between neighbouring rails, alternating) on a 0.5 in grid.
    python tools/repro/cut_tool_mockups.py <outDir>     -> 1_hover.svg .. 4_joint_vs_end.svg
Render to PNG with headless Chrome (--screenshot, --window-size=700,530). SVGs are git-ignored (*.svg), so this
script is the tracked source."""
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'cut-tool-mockups'
os.makedirs(OUT, exist_ok=True)
S = 60                   # px per inch
OX, OY = 60, 120         # board origin (px)
W, H = 8, 5              # board (in)
RAILS = [1, 2.5, 4]      # rail rows (y, in)
UPPER = [1.5, 5]         # ties rail 0 -> rail 1 (x, in)
LOWER = [3, 6.5]         # ties rail 1 -> rail 2
RAIL_X = (0.5, 7.5)
CUTS = [3, 5]            # both are joints on the middle rail (a lower tie, an upper tie)
SEG_COLORS = ['#e53935', '#1e88e5', '#43a047']
GREY, TIE = '#5d6b78', '#90a4ae'
IMG_W, IMG_H = OX * 2 + W * S + 100, OY + H * S + 110


def px(x, y):
    return OX + x * S, OY + y * S


def grid():
    out = [f'<rect x="{OX}" y="{OY}" width="{W*S}" height="{H*S}" fill="#fafafa" stroke="#b0bec5"/>']
    for i in range(0, W * 2 + 1):
        x = OX + i * S / 2
        out.append(f'<line x1="{x}" y1="{OY}" x2="{x}" y2="{OY+H*S}" stroke="#e3e8ec" stroke-width="1"/>')
    for j in range(0, H * 2 + 1):
        y = OY + j * S / 2
        out.append(f'<line x1="{OX}" y1="{y}" x2="{OX+W*S}" y2="{y}" stroke="#e3e8ec" stroke-width="1"/>')
    return out


def line(a, b, color=GREY, w=10, extra=''):
    (x1, y1), (x2, y2) = px(*a), px(*b)
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{w}" stroke-linecap="round" {extra}/>'


def ties(ymid=RAILS[1], color=TIE, extra=''):
    return ([line((x, RAILS[0]), (x, ymid), color, 6, extra) for x in UPPER]
            + [line((x, ymid), (x, RAILS[2]), color, 6, extra) for x in LOWER])


def outer_rails():
    return [line((RAIL_X[0], y), (RAIL_X[1], y)) for y in (RAILS[0], RAILS[2])]


def joint(x, y, label=None, dy=-20):
    cx, cy = px(x, y)
    s = [f'<rect x="{cx-9}" y="{cy-9}" width="18" height="18" transform="rotate(45 {cx} {cy})" fill="#fff" stroke="#212121" stroke-width="2.5"/>']
    if label:
        s.append(text(cx, cy + dy, label, 13, 'middle'))
    return s


def text(x, y, t, size=15, anchor='start', weight='normal', color='#263238'):
    return f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" font-weight="{weight}" fill="{color}">{t}</text>'


def toolbar(active):
    tools = [('Select', 'select'), ('Direct', 'direct'), ('\u2702 Cut', 'cut'), ('Line', 'line')]
    out = []
    for k, (lab, key) in enumerate(tools):
        bx, by = OX + k * 78, 58
        on = key == active
        out.append(f'<rect x="{bx}" y="{by}" width="72" height="26" rx="4" fill="{"#0696D7" if on else "#eceff1"}" stroke="#b0bec5"/>')
        out.append(text(bx + 36, by + 18, lab, 13, 'middle', color='#fff' if on else '#37474f'))
    return out


def svg(body, title, captions, active):
    cap = ''.join(text(OX, OY + H * S + 34 + 22 * k, c, 13, color='#455a64') for k, c in enumerate(captions))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{IMG_W}" height="{IMG_H}" viewBox="0 0 {IMG_W} {IMG_H}" '
            f'font-family="Segoe UI, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>'
            + text(OX, 36, title, 19, weight='bold') + ''.join(toolbar(active)) + ''.join(body) + cap + '</svg>')


def write(name, body, title, captions, active):
    open(os.path.join(OUT, name + '.svg'), 'w', encoding='utf-8').write(svg(body, title, captions, active))


# 1. hover: the cut marker snapped to a joint (tie contact), a grid crossing as the next candidate
b = grid() + ties() + outer_rails() + [line((RAIL_X[0], RAILS[1]), (RAIL_X[1], RAILS[1]))]
cx, cy = px(CUTS[0], RAILS[1])
b.append(f'<circle cx="{cx}" cy="{cy}" r="15" fill="none" stroke="#ff6f00" stroke-width="3"/>')
b.append(f'<line x1="{cx}" y1="{cy-22}" x2="{cx}" y2="{cy+22}" stroke="#ff6f00" stroke-width="3" stroke-dasharray="4 3"/>')
b.append(text(cx - 130, cy - 26, '\u2702 cut here: a joint (tie contact)', 14, color='#e65100', weight='bold'))
gx, gy = px(3.5, RAILS[1])
b.append(f'<circle cx="{gx}" cy="{gy}" r="5" fill="#fff" stroke="#78909c" stroke-width="2"/>')
b.append(text(gx + 70, gy - 16, 'next candidate: grid point', 12, color='#78909c'))
mx, my = cx + 18, cy + 18
b.append(f'<path d="M{mx} {my} l14 34 l6 -12 l13 -4 z" fill="#263238"/>')
write('1_hover', b, '1  \u2702 Cut: tap a line where you want it split', [
    'The marker shows WHERE the cut will land before you tap: a joint wins, then a grid point on the line;',
    'hold Alt to cut exactly at the finger. Tap an existing cut again = Join.'], 'cut')

# 2. after two cuts: the middle rail is 3 segments, each its own colour (one wider); joints as diamonds
xs = [RAIL_X[0]] + CUTS + [RAIL_X[1]]
b = grid() + ties() + outer_rails()
for k in range(3):
    b.append(line((xs[k], RAILS[1]), (xs[k + 1], RAILS[1]), SEG_COLORS[k], 15 if k == 1 else 10))
for x in CUTS:
    b += joint(x, RAILS[1])
b.append(text(px(4, RAILS[1])[0], px(0, RAILS[1])[1] + 34, 'its own colour and width', 12, 'middle', color='#1565c0'))
write('2_cut_3_segments', b, '2  One rail, three segments (\u25c7 = joint), still ONE rail', [
    'Collinear + touching end-to-end = one rail, worked out at every drag (no stored parent).',
    'Colour and width are per segment and never split the rail.'], 'cut')

# 3. drag the blue segment down: all three segments move together, the ties on both sides stretch
dy = 0.75
y2 = RAILS[1] + dy
b = grid() + ties(RAILS[1], '#cfd8dc', 'stroke-dasharray="6 5"')
b.append(line((RAIL_X[0], RAILS[1]), (RAIL_X[1], RAILS[1]), '#cfd8dc', 10, 'stroke-dasharray="10 6"'))
b += ties(y2) + outer_rails()
for k in range(3):
    b.append(line((xs[k], y2), (xs[k + 1], y2), SEG_COLORS[k], 15 if k == 1 else 10))
for x in CUTS:
    b += joint(x, y2)
hx, hy = px(4, y2)
b.append(f'<path d="M{hx} {hy-60} v36" stroke="#ff6f00" stroke-width="3"/><path d="M{hx-8} {hy-26} l8 12 l8 -12 z" fill="#ff6f00"/>')
b.append(text(hx + 14, hy - 42, 'drag ANY segment: the whole rail moves', 13, color='#e65100', weight='bold'))
write('3_drag_moves_whole_rail', b, '3  Lattice drag: a cut rail behaves exactly like the uncut one', [
    'Grey dashes = before. Every tie on either side stretches exactly as it would on the uncut rail;',
    'the colours stay on their segments. Same gesture before/after the cut = identical coordinates.'], 'select')

# 4. joint vs outer end: grabbing a joint slides the cut along the rail; only the true outer ends stretch
xs4 = [RAIL_X[0], CUTS[0] + 0.5, CUTS[1], RAIL_X[1] - 0.5]
b = grid() + ties() + outer_rails()
for k in range(3):
    b.append(line((xs4[k], RAILS[1]), (xs4[k + 1], RAILS[1]), SEG_COLORS[k], 10))
b += joint(xs4[1], RAILS[1], 'joint: both ends move together', 34)
b += joint(xs4[2], RAILS[1])
ox_, oy_ = px(CUTS[0], RAILS[1])
b.append(f'<path d="M{ox_} {oy_-22} h{0.5*S-6}" stroke="#ff6f00" stroke-width="3"/><path d="M{ox_+0.5*S-8} {oy_-29} l10 7 l-10 7 z" fill="#ff6f00"/>')
ex, ey = px(xs4[3], RAILS[1])
b.append(f'<circle cx="{ex}" cy="{ey}" r="9" fill="#fff" stroke="#212121" stroke-width="2.5"/>')
b.append(f'<path d="M{ex+4} {ey-22} h-{0.5*S-14}" stroke="#ff6f00" stroke-width="3"/><path d="M{ex-0.5*S+12} {ey-29} l-10 7 l10 7 z" fill="#ff6f00"/>')
b.append(text(ex, ey + 34, 'outer end: stretches', 13, 'middle'))
write('4_joint_vs_end', b, '4  A joint is not an end: no gap can open', [
    'Grab a joint: it slides along the rail and both segments follow. Only the rail\u2019s TRUE outer ends stretch.',
    'Direct edit on a plain (non-lattice) line: the cut pieces are independent, as Fred ruled.'], 'select')
print('ok', IMG_W, IMG_H)
