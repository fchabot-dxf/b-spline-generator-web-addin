"""
F35 item 70: the add-in half of the palettes' declared loading stages, shared by every add-in that reports them
(CAM-builder now; b-spline-gen's own copy of the same two helpers moves here once fusion-stages-70 is on main).

  declared_stage_ids(path)        the ids of a stage declaration module (e.g. CAM-builder/ui/html/cam-stages.js): the
                                  pure-JSON object after the line that starts with the export -- the SAME file the
                                  palette imports, so the two sides cannot disagree.
  pump(do_events, window_s)       keep Fusion's events pumping for window_s after a post to a palette. MEASURED live
                                  (seat A, 2026-10-06): the palette's window runs on Fusion's main thread, so a message
                                  posted from a long handler is not painted until the handler returns; ONE doEvents
                                  painted every message one post late; pumping for a short window paints each in time.

Pure stdlib: the caller passes adsk.doEvents, so this imports and unit-tests without Fusion.
"""
import json
import re
import time

POST_PAINT_PUMP_S = 0.08


def declared_stage_ids(path):
    with open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    m = re.search(r'^export default', src, re.M)
    return [s['id'] for s in json.loads(src[m.end():].strip().rstrip(';'))['stages']]


def pump(do_events, window_s=None):
    end = time.monotonic() + (POST_PAINT_PUMP_S if window_s is None else window_s)
    while True:
        do_events()
        if time.monotonic() >= end:
            return
        time.sleep(0.01)
