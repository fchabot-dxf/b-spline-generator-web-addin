# H23 item 43: does the fix change T10's own recorded golden numbers at all, or only which
# SketchPoint gets a name? Runs record_frame_parity.py's own record_case() with frame_engine_core
# etc. loaded FRESH from this repo checkout (never touching the deployed add-in, never writing to
# the committed tests/fixtures/frame-parity/ files) and diffs the result against the CURRENTLY
# COMMITTED golden for the same board size.
#
# Run inside Fusion via fusion_execute:
#   REPO = r'<checkout>'; W = 7; H = 9
#   exec(open(r'<repo>\tools\repro\fusion_t11\item43_golden_check.py').read())
import sys, os, json, importlib.util

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
REPRO_DIR = os.path.join(REPO, "tools", "repro")
GOLDEN_PATH = os.path.join(REPO, "tests", "fixtures", "frame-parity", f"template_10_{W}x{H}.json")

mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.') or m in ('frame_engine_core', 'fb_utils', 'fb_utils.fb_logger')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
try:
    for m in list(saved_mods):
        if m in sys.modules: del sys.modules[m]
    sys.path[:] = saved_path
    sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB))

    spec = importlib.util.spec_from_file_location('frame_engine_core', os.path.join(FB, 'fb_engine', 'frame_engine.py'))
    fe = importlib.util.module_from_spec(spec)
    sys.modules['frame_engine_core'] = fe
    spec.loader.exec_module(fe)

    import fb_utils.fb_logger  # noqa: F401 -- ensure the real module backs sys.modules['fb_utils.fb_logger']
    import fb_engine.solid_coordinator  # noqa: F401 -- record_case reads this straight off sys.modules

    sys.path.insert(0, REPRO_DIR)
    spec2 = importlib.util.spec_from_file_location('record_frame_parity_item43', os.path.join(REPRO_DIR, 'record_frame_parity.py'))
    rfp = importlib.util.module_from_spec(spec2)
    spec2.loader.exec_module(rfp)

    result = rfp.record_case('template_10', W, H, None)
    golden = json.load(open(GOLDEN_PATH, encoding='utf-8'))

    diffs = []
    for key in ('sketch2_shape_outline', 'sketch3_frame_enclosure', 'sketch3_profiles', 'bars', 'panelAfterTrim'):
        if json.dumps(result[key], sort_keys=True) != json.dumps(golden[key], sort_keys=True):
            diffs.append(key)
    print('DIFFERING KEYS:', diffs)
    if 'bars' in diffs:
        print('old bars:', golden['bars'])
        print('new bars:', result['bars'])
    if 'sketch3_profiles' in diffs:
        print('old profiles count:', len(golden['sketch3_profiles']), 'new:', len(result['sketch3_profiles']))
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
