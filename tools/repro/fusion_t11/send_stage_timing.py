# H23 item 29 part 1 (PREP ONLY -- advisor dispatch 2026-10-02, epoch 6 turn 407): times a real
# Send (_handle_generate) stage by stage -- STEP import, stamp imports, each frame sketch,
# extrusions, trim, timeline reorder -- by WRAPPING the existing functions at runtime (no
# production code changes), replaying a captured payload inside ONE fusion_execute call. Also
# builds the SAME frame in a fresh EMPTY doc (no STEP import, no stamping) for comparison, so the
# frame-build's own cost can be told apart from the rest of the pipeline. NOT RUN by this pass --
# item 29's own scope is prep only; the live timing run happens once the advisor hands over Fusion
# time. Its non-Fusion parts (payload loading, stage-duration math, the log-parsing regexes, and
# the _send_progress wrapping mechanism itself against the REAL _handle_generate) are dry-run-
# tested without any bridge in stage_timing_lib.py / test_stage_timing_lib.py (same directory) --
# read those first if this script needs changes; this file is deliberately thin on its own logic.
#
# Inputs (set by the caller before this script runs, same convention as this directory's other
# harnesses -- see live_build_readback.py / step_removal_ab.py):
#   REPO          - path to a clean checkout (so fb_engine / b-spline-gen load from there, not the
#                   deployed add-in copy -- fusion360-quirks: the deployed copy is a SEPARATE tree)
#   PAYLOAD_PATH  - optional, default ~/.bspline-frame-builder/last_send.json (the file
#                   b-spline-gen.py's own _dump_last_send already writes after every real Send).
#                   That file EXCLUDES stepVariants/stepText (see stage_timing_lib's own docstring)
#                   -- point this at a capture that includes them for a full STEP-import timing.
#   VARIANT       - optional, default 'baseline'. 'deferred_whole_build' additionally applies the
#                   EXPERIMENTAL, UNVERIFIED "defer compute across the whole sketch build" switch
#                   (see _apply_deferred_whole_build_variant's own docstring) -- prepared per the
#                   dispatch, not validated against real Fusion yet.
#   OUT           - optional, default <repo>/scratch/send_stage_timing_results.jsonl (gitignored).
import sys, os, time, json, types, traceback
import adsk.core, adsk.fusion

_HERE = os.path.join(REPO, 'tools', 'repro', 'fusion_t11')  # no __file__ inside fusion_execute's exec'd string
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
from stage_timing_lib import (
    stage_durations, load_captured_payload, parse_solid_coordinator_phases, unwrap_captured_frame_payload,
)

FB = os.path.join(REPO, "bspline-frame-builder", "frame-builder")
BSG_DIR = os.path.join(REPO, "bspline-frame-builder", "b-spline-gen")
_payload_path = PAYLOAD_PATH if 'PAYLOAD_PATH' in dir() else os.path.join(
    os.path.expanduser('~'), '.bspline-frame-builder', 'last_send.json')
_variant = VARIANT if 'VARIANT' in dir() else 'baseline'
OUT_PATH = OUT if 'OUT' in dir() else os.path.join(os.path.dirname(FB), 'scratch', 'send_stage_timing_results.jsonl')
LOG_PATH = os.path.join(FB, 'frame-builder-debug.log')  # DebugLogger(_frame_builder_dir())'s own path

HOLD = sys.modules.get('__send_stage_timing')
if HOLD is None:
    HOLD = types.ModuleType('__send_stage_timing'); HOLD.docs = {}; sys.modules['__send_stage_timing'] = HOLD
for _i in range(app.documents.count - 1, -1, -1):
    _d = app.documents.item(_i); _des = _d.products.itemByProductType('DesignProductType')
    _p = _des.userParameters.itemByName('adv_stage_timing_fp') if _des else None
    if _p and _des.rootComponent.occurrences.count == 0 and _des.rootComponent.sketches.count == 0:
        _d.close(False)


def _apply_deferred_whole_build_variant(pe_module):
    """EXPERIMENTAL, UNVERIFIED (item 29's own dispatch: prepare, don't run). offsets.py's own
    offset_step() pulses sketch.isComputeDeferred False-then-True once per successful offset call
    (its own comment: "forces Fusion to do a single compute pass ... then re-enter deferred mode
    for the miters that follow") -- this variant instead holds the WHOLE sketch build deferred and
    pulses exactly ONCE at the end, by wrapping ParametricSketchBuilder.build_sketch: set
    isComputeDeferred True before calling the original, True again after (undoing any pulse the
    original's own offset_step calls performed in between), so only ONE forced compute happens per
    sketch instead of one per offset call. Does not touch offsets.py -- a monkeypatch, not a
    production edit, per the dispatch. UNTESTED: whether re-asserting isComputeDeferred=True right
    after build_sketch returns actually finalizes the new entities the same way the per-step pulse
    already proved it needs to (frame_engine.py's own comment on that pulse: proxies from a
    deferred-mode offset aren't finalized, so downstream ID lookups can silently no-op) is exactly
    the live question this variant exists to answer -- it may turn out to break entity naming, not
    just save time. Verify ID tagging correctness FIRST, before trusting any timing number from it.
    """
    orig_build_sketch = pe_module.ParametricSketchBuilder.build_sketch

    def wrapped(self, sketch_spec, limit=None, ui_data=None):
        result = orig_build_sketch(self, sketch_spec, limit=limit, ui_data=ui_data)
        try:
            sketch = self.ctx.sketches.get(f"{self.prefix}_{sketch_spec['Name']}")
            if sketch is not None:
                sketch.isComputeDeferred = True
        except Exception as e:
            self.ctx.logger.log(f"DEFERRED-WHOLE-BUILD VARIANT: re-assert failed: {e}", "WARNING")
        return result

    pe_module.ParametricSketchBuilder.build_sketch = wrapped
    return orig_build_sketch


mod_keys = lambda: [m for m in list(sys.modules) if m == 'fb_engine' or m.startswith('fb_engine.') or m.startswith('sketches') or m == 'template_loader' or m.startswith('template_') or m == 'fb_shared' or m.startswith('fb_shared.')]
saved_mods = {m: sys.modules[m] for m in mod_keys()}
saved_path = list(sys.path)
out = {'variant': _variant}
try:
    for m in list(saved_mods): del sys.modules[m]
    sys.path.insert(0, FB); sys.path.insert(0, os.path.dirname(FB))
    sys.path.insert(0, BSG_DIR)  # b-spline-gen.py's own sibling imports (sketch_manifest_builder etc.)
    if os.path.exists(LOG_PATH):
        open(LOG_PATH, 'w', encoding='utf-8').close()  # DebugLogger truncates on its own next construction anyway; be sure

    payload, warning = load_captured_payload(_payload_path)
    out['payload_warning'] = warning
    if payload is None:
        raise RuntimeError(f"no captured payload: {warning}")
    payload = unwrap_captured_frame_payload(payload)

    import importlib.util
    spec = importlib.util.spec_from_file_location("bsg_stage_timing", os.path.join(BSG_DIR, "b-spline-gen.py"))
    bsg = importlib.util.module_from_spec(spec)
    sys.modules["bsg_stage_timing"] = bsg
    spec.loader.exec_module(bsg)

    from fb_engine import parametric_engine as pe
    from fb_engine import timeline_order

    progress_events = []
    orig_send_progress = bsg._send_progress

    def wrapped_send_progress(msg):
        progress_events.append((msg, time.time()))
        return orig_send_progress(msg)

    bsg._send_progress = wrapped_send_progress

    sketch_timings = []
    orig_build_sketch = pe.ParametricSketchBuilder.build_sketch

    def timed_build_sketch(self, sketch_spec, limit=None, ui_data=None):
        t0 = time.time()
        result = orig_build_sketch(self, sketch_spec, limit=limit, ui_data=ui_data)
        sketch_timings.append((sketch_spec.get('Label', sketch_spec['Name']), time.time() - t0))
        return result

    pe.ParametricSketchBuilder.build_sketch = timed_build_sketch

    timeline_calls = []
    orig_ensure_frame = timeline_order.ensure_frame_before_inlay

    def timed_ensure_frame(design, frame_component_name, logger=None):
        t0 = time.time()
        result = orig_ensure_frame(design, frame_component_name, logger=logger)
        timeline_calls.append(time.time() - t0)
        return result

    timeline_order.ensure_frame_before_inlay = timed_ensure_frame

    deferred_restore = None
    if _variant == 'deferred_whole_build':
        deferred_restore = _apply_deferred_whole_build_variant(pe)

    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = adsk.fusion.Design.cast(app.activeProduct)
    des.userParameters.add('adv_stage_timing_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-stage-timing')
    HOLD.docs['full'] = doc

    t_start = time.time()
    handler = bsg.PaletteHTMLEventHandler()
    handler._handle_generate(payload)
    t_end = time.time()

    pe.ParametricSketchBuilder.build_sketch = orig_build_sketch
    timeline_order.ensure_frame_before_inlay = orig_ensure_frame
    if deferred_restore is not None:
        pe.ParametricSketchBuilder.build_sketch = deferred_restore

    out['total_seconds'] = round(t_end - t_start, 3)
    out['progress_stages'] = [(lbl, round(d, 3)) for lbl, d in stage_durations(progress_events, t_end)]
    out['frame_sketches'] = [(lbl, round(d, 3)) for lbl, d in sketch_timings]
    out['timeline_reorder_calls'] = [round(d, 4) for d in timeline_calls]
    if os.path.exists(LOG_PATH):
        out['solid_coordinator_phases'] = parse_solid_coordinator_phases(
            open(LOG_PATH, encoding='utf-8', errors='replace').read())

    # ---- comparison: same frame, fresh EMPTY doc, no STEP import / no stamping ----
    params = payload.get('params', {}) or {}
    # `payload['frame']` is already unwrapped to its raw pre-send shape above.
    # 'templateId' is send_frame.py's own payload key (fb_engine/send_frame.py:200).
    frame_payload = payload.get('frame') or {}
    style_id = frame_payload.get('templateId')
    if style_id:
        from fb_engine import frame_engine as fe
        doc2 = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des2 = adsk.fusion.Design.cast(app.activeProduct)
        des2.userParameters.add('adv_stage_timing_fp', adsk.core.ValueInput.createByReal(1.0), '', 'adv-stage-timing')
        HOLD.docs['empty'] = doc2
        empty_sketch_timings = []

        def timed_build_sketch_empty(self, sketch_spec, limit=None, ui_data=None):
            t0 = time.time()
            result = orig_build_sketch(self, sketch_spec, limit=limit, ui_data=ui_data)
            empty_sketch_timings.append((sketch_spec.get('Label', sketch_spec['Name']), time.time() - t0))
            return result

        pe.ParametricSketchBuilder.build_sketch = timed_build_sketch_empty
        t0 = time.time()
        fb = fe.FrameBuilder(external_logger=None)
        fb.run_sketch_only(style_id=style_id, ui_data=params)
        out['empty_doc_seconds'] = round(time.time() - t0, 3)
        out['empty_doc_frame_sketches'] = [(lbl, round(d, 3)) for lbl, d in empty_sketch_timings]
        pe.ParametricSketchBuilder.build_sketch = orig_build_sketch
    else:
        out['empty_doc_skipped'] = 'no styleId/templateId in the captured payload\'s frame block'

except Exception:
    out['CRASH'] = traceback.format_exc()[-1200:]
finally:
    for m in mod_keys():
        if m in sys.modules: del sys.modules[m]
    sys.modules.update(saved_mods)
    sys.path[:] = saved_path
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'a', encoding='utf-8') as fh:
        fh.write(json.dumps(out) + '\n')

print(json.dumps(out, indent=2))
