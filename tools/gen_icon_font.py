#!/usr/bin/env python
"""Build the SELF-HOSTED Material Symbols Outlined subset the web app loads (no Google Fonts request).

Why: the app used to pull the font from fonts.googleapis.com. Where that request fails (iPad Chrome, a content
blocker, offline, the Fusion palette with no network) every icon span showed its raw ligature NAME ('save_as',
'create_new_folder', 'image' ...) in a serif font. A same-origin font file cannot fail that way.

Source font: google/material-design-icons  variablefont/MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].ttf
(Apache License 2.0, https://github.com/google/material-design-icons/blob/master/LICENSE).

Usage (needs `pip install fonttools brotli`):
    python tools/gen_icon_font.py path/to/MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].ttf
Writes bspline-frame-builder/b-spline-gen/html/fonts/material-symbols-outlined.woff2 and
material-symbols-outlined.json (the manifest the vitest pins read). To add an icon: use it in the app, rerun.
"""
import hashlib
import json
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'bspline-frame-builder'))
SCAN = [os.path.join(ROOT, 'b-spline-gen', 'html'), os.path.join(ROOT, 'styles')]
SKIP_DIRS = {'fonts', 'assets', 'data', 'node_modules'}
OUT_DIR = os.path.join(ROOT, 'b-spline-gen', 'html', 'fonts')
OUT_FONT = os.path.join(OUT_DIR, 'material-symbols-outlined.woff2')
OUT_JSON = os.path.join(OUT_DIR, 'material-symbols-outlined.json')

# a name used as a quoted string, a tag body (>name<) or `icon: name`
USE = re.compile(r"""(?:['"`>]|\bicon\s*[:=]\s*)([a-z][a-z0-9_]*)(?=['"`<])""")


def used_names(glyphs):
    found = set()
    for base in SCAN:
        for dp, dn, fn in os.walk(base):
            dn[:] = [d for d in dn if d not in SKIP_DIRS]
            for n in fn:
                if n.endswith(('.html', '.js', '.css')):
                    with open(os.path.join(dp, n), encoding='utf8', errors='ignore') as fh:
                        for m in USE.findall(fh.read()):
                            if len(m) > 1 and m in glyphs:
                                found.add(m)
    return sorted(found)


def main(src):
    font = TTFont(src)
    order = font.getGlyphOrder()
    glyphs = {g for g in order if '.' not in g}
    names = used_names(glyphs)
    keep = set(names) | {n + '.fill' for n in names if n + '.fill' in order}
    # The font's ligature table maps every icon name to its glyph; drop the rules whose result we do not keep, or the
    # subsetter's closure pulls all 6650 glyphs back in.
    gsub = font['GSUB'].table
    for lk in gsub.LookupList.Lookup:
        for st in lk.SubTable:
            s = getattr(st, 'ExtSubTable', st)
            if hasattr(s, 'ligatures'):
                for first in list(s.ligatures):
                    s.ligatures[first] = [l for l in s.ligatures[first] if l.LigGlyph in keep]
                    if not s.ligatures[first]:
                        del s.ligatures[first]
            elif hasattr(s, 'mapping'):
                s.mapping = {k: v for k, v in s.mapping.items() if k in keep and v in keep}
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['rlig', 'rclt', 'liga']
    opts.hinting = False
    opts.notdef_outline = True
    opts.name_IDs = ['*']
    ss = subset.Subsetter(opts)
    ss.populate(glyphs=sorted(keep), unicodes=[0x20, *range(0x30, 0x3A), 0x5F, *range(0x61, 0x7B)])
    ss.subset(font)
    os.makedirs(OUT_DIR, exist_ok=True)
    font.flavor = 'woff2'
    font.save(OUT_FONT)
    with open(OUT_FONT, 'rb') as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    with open(OUT_JSON, 'w', encoding='utf8') as fh:
        json.dump({'licence': 'Apache-2.0', 'source': 'google/material-design-icons variablefont/MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].ttf',
                   'sha256': digest, 'names': names}, fh, indent=1)
        fh.write('\n')
    print(len(names), 'icons,', os.path.getsize(OUT_FONT), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1])
