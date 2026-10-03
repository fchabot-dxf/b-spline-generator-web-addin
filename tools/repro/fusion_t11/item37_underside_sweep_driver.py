# H23 item 37: drive underside_extrude_probe.py across all 7 real captured panels, loading
# fb_engine/b-spline-gen fresh from THIS repo checkout (REPO global) so the probe exercises the
# unlanded isTopologyMatched/underside_face fix, not the deployed add-in copy.
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; PROBE = r'<repo>\tools\repro\fusion_t11\underside_extrude_probe.py'
#   OUT = r'<results.json>'; CASES = [('t7_7x9', r'<payload path>'), ...]
#   exec(open(r'<repo>\tools\repro\fusion_t11\item37_underside_sweep_driver.py').read())
import json, os, traceback

results = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}


def _write():
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, default=str)


_write()
for tag, payload_path in CASES:
    if tag in results and 'crash' not in results[tag]:
        continue
    g = {'app': app, 'adsk': adsk, 'REPO': REPO, 'PAYLOAD': payload_path, 'TAG': tag}
    try:
        exec(compile(open(PROBE, encoding='utf-8').read(), PROBE, 'exec'), g)
        results[tag] = g['res']
    except Exception:
        results[tag] = {'crash': traceback.format_exc()[-1500:]}
    _write()

print('done:', list(results.keys()))
