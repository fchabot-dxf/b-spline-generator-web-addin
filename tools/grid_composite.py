"""tools/grid_composite.py -- compose a labeled rows x cols image grid from a JSON report +
per-cell PNG files, for the "render a grid of real close-ups, label each cell" asks that have
come up more than once in this project (e.g. the F35 item 16 resolution x brick-size grid). A
declared, reusable compositor instead of a one-off per grid: the only per-grid-specific code is
the JSON manifest, not this script.

Usage:
    python tools/grid_composite.py <report.json> <cellDir> <outPath> [--row-label KEY=FMT]
                                    [--col-label KEY=FMT] [--cell-label KEY=FMT ...]

<report.json>  Has {"rows": [...], "cols": [...], "cells": [{"row","col","file",...}, ...]}
               (tools/repro/brick_resolution_grid_shots.mjs's own report shape).
<cellDir>      Directory the cells' own "file" paths are relative to.
<outPath>      Output PNG path.
--row-label / --col-label   One Python format string applied to the row/col's own raw value
                             (e.g. 'spacing={:.3f}"'); defaults to str(value).
--cell-label   Repeatable: 'key=format' pairs rendered under each cell, reading that key off the
               cell's own JSON object (e.g. 'rebuildMs={:.0f}ms' 'pointCount={:,} pts').
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = ImageFont.load_default(size=15)
FONT_SMALL = ImageFont.load_default(size=12)
MARGIN = 18
ROW_LABEL_W = 110
COL_LABEL_H = 34
CAPTION_H = 54


def main():
    args = sys.argv[1:]
    if len(args) < 3:
        print(__doc__)
        sys.exit(1)
    report_path, cell_dir, out_path = args[0], Path(args[1]), args[2]
    row_fmt = col_fmt = '{}'
    cell_fmts = []
    i = 3
    while i < len(args):
        if args[i] == '--row-label':
            row_fmt = args[i + 1]; i += 2
        elif args[i] == '--col-label':
            col_fmt = args[i + 1]; i += 2
        elif args[i] == '--cell-label':
            cell_fmts.append(args[i + 1]); i += 2
        else:
            i += 1

    report = json.loads(Path(report_path).read_text())
    rows, cols, cells = report['rows'], report['cols'], report['cells']
    by_rc = {(c['row'], c['col']): c for c in cells}

    sample = Image.open(cell_dir / cells[0]['file'])
    cw, ch = sample.size

    grid_w = ROW_LABEL_W + len(cols) * cw
    grid_h = COL_LABEL_H + len(rows) * (ch + CAPTION_H)
    canvas = Image.new('RGB', (grid_w + MARGIN * 2, grid_h + MARGIN * 2), 'white')
    draw = ImageDraw.Draw(canvas)

    for ci, colval in enumerate(cols):
        x = MARGIN + ROW_LABEL_W + ci * cw
        label = col_fmt.format(colval)
        draw.text((x + cw / 2, MARGIN + COL_LABEL_H / 2), label, fill='black', font=FONT, anchor='mm')

    for ri, rowval in enumerate(rows):
        y_img = MARGIN + COL_LABEL_H + ri * (ch + CAPTION_H)
        draw.text((MARGIN + ROW_LABEL_W / 2, y_img + ch / 2), row_fmt.format(rowval),
                   fill='black', font=FONT, anchor='mm')
        for ci, colval in enumerate(cols):
            cell = by_rc.get((ri, ci))
            x = MARGIN + ROW_LABEL_W + ci * cw
            if not cell:
                draw.rectangle([x, y_img, x + cw, y_img + ch], outline='red')
                continue
            img = Image.open(cell_dir / cell['file'])
            canvas.paste(img, (x, y_img))
            draw.rectangle([x, y_img, x + cw, y_img + ch], outline='#cccccc')
            lines = []
            for fmt in cell_fmts:
                key, _, f = fmt.partition('=')
                try:
                    lines.append(f.format(cell.get(key)))
                except (KeyError, ValueError, TypeError):
                    lines.append(f'{key}=?')
            caption = '  '.join(lines)
            draw.text((x + 4, y_img + ch + 4), caption, fill='black', font=FONT_SMALL)

    canvas.save(out_path)
    print(f'wrote {out_path} ({canvas.size[0]}x{canvas.size[1]})')


if __name__ == '__main__':
    main()
