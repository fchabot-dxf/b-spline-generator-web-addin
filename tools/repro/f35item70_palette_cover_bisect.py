"""
F35 item 70: WHICH Fusion call puts the main window over the B-Spline palette mid-Send (seat A's live Sends: from the
bricks step on, the screen showed Fusion's viewport where the palette was, while PrintWindow still rendered it).

Run INSIDE Fusion (fusion_execute: exec this file's text) with the B-Spline palette open and visible. It works in a
NEW scratch design document it creates and closes itself (only that handle -- never by name or count), and does the
bricks step's own calls one at a time, pumping events after each (as the Send now does), then checks:
  covered    the window at the palette's centre on screen is NOT the palette (or one of its children)
  isVisible / dockingState   what the API says about the palette
Steps: 0 baseline; 1 sketches.add(plane); 2 sketch.name; 3 importManager.importToTarget(svg, sketch);
4 a second sketch + profile access (the frame build sketches too); then the REMEDY: 5 palette.isVisible = True.
Prints one JSON line per step; returns the list as `result` for fusion_execute.
"""
import ctypes
import json
import os
import tempfile
import time
from ctypes import wintypes

import adsk.core
import adsk.fusion

PALETTE_ID = 'fusionHybridPalette'      # b-spline-gen.py PALETTE_ID
PALETTE_NAME = 'Symmetric B-Spline Gen'  # b-spline-gen.py PALETTE_NAME
PUMP_S = 0.3

user32 = ctypes.windll.user32
user32.WindowFromPoint.argtypes = [wintypes.POINT]
user32.WindowFromPoint.restype = wintypes.HWND
user32.GetAncestor.restype = wintypes.HWND
user32.IsChild.argtypes = [wintypes.HWND, wintypes.HWND]
EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def _title(h):
    n = user32.GetWindowTextLengthW(h)
    b = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(h, b, n + 1)
    return b.value


def _find_palette_hwnd():
    """The palette's own window: a top-level (floating) or child (docked) window titled with the palette's name."""
    found = []

    def visit_children(parent):
        def cb(h, _):
            if PALETTE_NAME in _title(h):
                found.append(h)
            return True
        user32.EnumChildWindows(parent, EnumProc(cb), 0)

    def top(h, _):
        if PALETTE_NAME in _title(h):
            found.append(h)
        visit_children(h)
        return True
    user32.EnumWindows(EnumProc(top), 0)
    return found[0] if found else None


def _pump(s=PUMP_S):
    end = time.monotonic() + s
    while time.monotonic() < end:
        adsk.doEvents()
        time.sleep(0.01)


def _check(step, pal):
    hwnd = _find_palette_hwnd()
    row = {'step': step, 'isVisible': bool(pal.isVisible), 'dockingState': int(pal.dockingState), 'hwnd': bool(hwnd)}
    if hwnd:
        r = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        pt = wintypes.POINT((r.left + r.right) // 2, (r.top + r.bottom) // 2)
        at = user32.WindowFromPoint(pt)
        mine = bool(at) and (at == hwnd or user32.IsChild(hwnd, at))
        row.update({'rect': [r.left, r.top, r.right, r.bottom], 'covered': not mine, 'atTitle': _title(at)[:60] if at else ''})
    print(json.dumps(row))
    return row


def run():
    app = adsk.core.Application.get()
    ui = app.userInterface
    pal = ui.palettes.itemById(PALETTE_ID)
    if not pal:
        return [{'error': 'palette not open'}]
    rows = [_check('0 baseline (before the scratch doc)', pal)]
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)  # OUR handle: the only one we close
    try:
        _pump()
        rows.append(_check('0b scratch doc opened', pal))
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        sk = root.sketches.add(root.xYConstructionPlane)
        _pump()
        rows.append(_check('1 sketches.add(plane)', pal))
        sk.name = 'claude-item70-bricks-probe'
        _pump()
        rows.append(_check('2 sketch.name', pal))
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
               '<polygon points="10,10 60,10 60,40 10,40"/><polygon points="10,50 60,50 60,80 10,80"/></svg>')
        with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False, encoding='utf-8') as f:
            f.write(svg)
            path = f.name
        try:
            mgr = app.importManager
            opts = mgr.createSVGImportOptions(path)
            opts.scale = 1.0
            mgr.importToTarget(opts, sk)
        finally:
            os.remove(path)
        _pump()
        rows.append(_check('3 importManager.importToTarget(svg, sketch)', pal))
        sk2 = root.sketches.add(root.xZConstructionPlane)
        sk2.sketchCurves.sketchLines.addTwoPointRectangle(adsk.core.Point3D.create(0, 0, 0), adsk.core.Point3D.create(2, 1, 0))
        _ = sk2.profiles.count
        _pump()
        rows.append(_check('4 second sketch + rectangle + profiles', pal))
        pal.isVisible = True
        _pump()
        rows.append(_check('5 REMEDY: palette.isVisible = True', pal))
    finally:
        doc.close(False)
        _pump()
        rows.append(_check('6 scratch doc closed', pal))
    return rows


result = run()
