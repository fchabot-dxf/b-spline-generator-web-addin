"""Build a mirrored model catalog for the STL library sheet's Shape filter (SMITHSONIAN-BROWSER-DESIGN.md section 8).

The format is SOURCE-NEUTRAL (core/stl/catalog.js reads it; a later library writes the same fields and names itself):
  { "v": 1, "source": "<source id>", "built": "YYYY-MM-DD", "base": "<common uri prefix>",
    "models": [{ "id", "t": title, "u": owning unit or "", "g": the GLB uri WITHOUT base, "d": [small, mid, large] | null }] }
d = the model's box sides, sorted, from the GLB's POSITION accessors' min / max (ONE small Range request per GLB: the header and
the JSON chunk, never the mesh). Polite: sequential, a pause between requests, a plain client name.

Usage (from the repo root):
  python tools/build_stl_catalog.py                       crawl the Smithsonian, write the shipped catalog file
  python tools/build_stl_catalog.py --limit 20 --out x.json   crawl only the first 20 models (testing)
  python tools/build_stl_catalog.py --from-json OLD.json  convert an earlier crawl ({ models: [{ id, t, u, g: full uri, d, f }] })
                                                          to this format, no network
"""
import argparse, json, struct, sys, time, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP = REPO / 'bspline-frame-builder' / 'b-spline-gen' / 'html'
FORMAT_VERSION = 1
CLIENT = {'User-Agent': 'bspline-relief-catalog/1 (python urllib)'}  # a plain client name, never a browser's
PAUSE = 0.15  # seconds between requests

# The declared sources. The Smithsonian first; a later library is another entry (and its own crawl function).
SOURCES = {
    'smithsonian': {
        'api': 'https://3d-api.si.edu/api/v1.0/content/file/search',
        'base': 'https://3d-api.si.edu/content/document/',
        'model_filter': {'file_type': 'glb', 'file_quality': 'Low'},  # one row per model: its Low GLB
        'units': ['NMNHMAMMALS', 'NMNHINV', 'NMNHPALEO', 'NMNHEDUCATION', 'NMNHFISHES', 'NMNHHERPS', 'NMAH', 'NMAAHC', 'NASM',
                  'NPG', 'CHNDM', 'SAAM', 'SAO', 'DPO', 'NMAfA', 'OFEO-SG', 'FSG'],
        'out': APP / 'data' / 'stl-catalog-smithsonian.json',  # = SMITHSONIAN_SOURCE.catalogPath
    },
}


def get(url, rng=None, tries=3):
    for i in range(tries):
        try:
            h = dict(CLIENT)
            if rng: h['Range'] = rng
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=40) as r:
                return r.status, r.read()
        except Exception:  # a network hiccup: back off and retry
            if i == tries - 1: raise
            time.sleep(2 * (i + 1))


def glb_box(uri):
    """The sorted box sides of a GLB from its POSITION accessors' min / max; None when it has none."""
    _, b = get(uri, 'bytes=0-4095')
    if b[:4] != b'glTF': return None
    jl = struct.unpack('<I', b[12:16])[0]
    if 20 + jl > len(b):
        time.sleep(PAUSE)
        _, js = get(uri, f'bytes=20-{20 + jl - 1}')
    else:
        js = b[20:20 + jl]
    g = json.loads(js)
    lo, hi = [1e30] * 3, [-1e30] * 3
    for m in g.get('meshes', []):
        for p in m.get('primitives', []):
            a = g['accessors'][p['attributes']['POSITION']]
            if 'min' in a and 'max' in a:
                for i in range(3): lo[i] = min(lo[i], a['min'][i]); hi[i] = max(hi[i], a['max'][i])
    if lo[0] > hi[0]: return None
    return sorted(hi[i] - lo[i] for i in range(3))


def smithsonian_rows(src, params, limit=None):
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode({**params, **src['model_filter'], 'rows': 1000, 'start': start})
        _, b = get(f"{src['api']}?{q}")
        d = json.loads(b)
        out += d['rows']; start += 1000
        time.sleep(PAUSE)
        if start >= d['rowCount'] or not d['rows'] or (limit and len(out) >= limit): return out


def crawl_smithsonian(src, limit=None):
    """-> [{ id, t, u, g: full uri, d }] (a multi-part model: its first part's box stands for it)."""
    unit_of = {}
    for u in src['units']:
        for r in smithsonian_rows(src, {'owning_unit': u}):
            unit_of.setdefault(r['content'].get('model_url') or r['content']['uri'], u)
    seen, models, fails = set(), [], 0
    rows = smithsonian_rows(src, {}, limit)
    for n, r in enumerate(rows):
        c = r['content']; mid = c.get('model_url') or c['uri']
        if mid in seen: continue
        if limit and len(models) >= limit: break
        seen.add(mid)
        try:
            d = glb_box(c['uri'])
        except Exception:
            d = None
        if not d or d[2] <= 0: fails += 1; d = None
        models.append({'id': mid, 't': r.get('title', ''), 'u': unit_of.get(mid, ''), 'g': c['uri'], 'd': d})
        if n % 200 == 0: print(f'{n}/{len(rows)} rows, {fails} without a box', flush=True)
        time.sleep(PAUSE)
    return models


CRAWLERS = {'smithsonian': crawl_smithsonian}


def slim(source_id, models, built):
    """Full-uri models -> the catalog format: base stripped from g (a uri outside base stays whole), d rounded, nothing else."""
    base = SOURCES[source_id]['base']
    out = []
    for m in models:
        g = m['g']
        d = m.get('d')
        out.append({'id': m['id'], 't': m.get('t', ''), 'u': m.get('u', ''), 'g': g[len(base):] if g.startswith(base) else g,
                    'd': [round(x, 4) for x in d] if d else None})
    return {'v': FORMAT_VERSION, 'source': source_id, 'built': built, 'base': base, 'models': out}


def write(cat, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cat, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print(f"wrote {path}: {len(cat['models'])} models, {sum(1 for m in cat['models'] if m['d'])} with a box, {path.stat().st_size} bytes")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', default='smithsonian', choices=sorted(SOURCES))
    ap.add_argument('--out', help='output file (default: the shipped catalog file of the source)')
    ap.add_argument('--limit', type=int, help='crawl only the first N models (testing)')
    ap.add_argument('--from-json', help='convert an earlier crawl (full uris) instead of crawling')
    a = ap.parse_args(argv)
    out = a.out or SOURCES[a.source]['out']
    if a.from_json:
        old = json.loads(Path(a.from_json).read_text(encoding='utf-8'))
        cat = slim(a.source, old['models'], old.get('built') or time.strftime('%Y-%m-%d'))
    else:
        cat = slim(a.source, CRAWLERS[a.source](SOURCES[a.source], a.limit), time.strftime('%Y-%m-%d'))
    write(cat, out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
