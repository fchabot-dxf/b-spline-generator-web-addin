"""
F35 item 70: WHEN, during a REAL Send, does Fusion's main window come over the B-Spline palette? The isolated bricks-
step calls never did (tools/repro/f35item70_palette_cover_bisect.py, seat A 2026-10-06: 8/8 rows uncovered with the
palette in front), but real Sends lost the palette at the bricks step (run 2) and during the frame build (run 1).

A background thread samples every SAMPLE_S while the Send runs on Fusion's main thread. It only calls Win32 (no adsk
API off the main thread). Each change of state is recorded with a wall-clock time (to line up with the add-in log's
[STAGE] / [PROGRESS] lines) and:
  fg           the foreground top-level window: title, whether it is Fusion's main window / the palette / Fusion's / other
  covered      the top-level window at the palette's centre is not the palette, and whose it is
  owner        GetWindow(palette, GW_OWNER) -- an owned window always stays above its owner; an unowned one can be covered
Use inside ONE fusion_execute, around your usual replay of a captured Send payload:
    exec(open(r'<repo>/tools/repro/f35item70_cover_monitor.py').read())
    mon = CoverMonitor(); mon.start()
    ... the replay (e.g. the add-in's _handle_generate with the payload) ...
    result = mon.stop()        # [{'t': 'HH:MM:SS.mmm', 'fg': ..., 'covered': ..., 'at': ..., 'owner': ...}, ...]
"""
import ctypes
import datetime
import os
import threading
import time
from ctypes import wintypes

import adsk.core

PALETTE_ID = 'fusionHybridPalette'  # b-spline-gen.py PALETTE_ID
SAMPLE_S = 0.05

user32 = ctypes.windll.user32
user32.WindowFromPoint.argtypes = [wintypes.POINT]
user32.WindowFromPoint.restype = wintypes.HWND
user32.GetAncestor.restype = wintypes.HWND
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindow.restype = wintypes.HWND
user32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
GW_OWNER, GA_ROOT = 4, 2


def _title(h):
    if not h:
        return ''
    n = user32.GetWindowTextLengthW(h)
    b = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(h, b, n + 1)
    return b.value


def _rect(h):
    r = wintypes.RECT()
    user32.GetWindowRect(h, ctypes.byref(r))
    return [r.left, r.top, r.right, r.bottom]


def _pid(h):
    p = wintypes.DWORD()
    user32.GetWindowThreadProcessId(h, ctypes.byref(p))
    return p.value


class CoverMonitor:
    """Start on Fusion's main thread (it reads the palette's size through the API once), then samples off-thread."""

    def __init__(self):
        pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
        if not pal:
            raise RuntimeError('palette not open')
        self._pw, self._ph = pal.width, pal.height
        self._pid = os.getpid()
        self._stop = threading.Event()
        self._rows = []
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._palette = self._main = None

    def _find(self):
        """The palette: Fusion's visible top-level 'Fusion360' window sized like it; the main window: the largest one."""
        cands = []

        def cb(h, _):
            if _pid(h) == self._pid and user32.IsWindowVisible(h) and _title(h) == 'Fusion360':
                l, t, r, b = _rect(h)
                s = user32.GetDpiForWindow(h) / 96.0
                cands.append((abs((r - l) - self._pw * s) + abs((b - t) - self._ph * s), (r - l) * (b - t), h))
            return True
        user32.EnumWindows(EnumProc(cb), 0)
        if not cands:
            return None, None
        palette = min(cands, key=lambda c: c[0])[2]
        main = max(cands, key=lambda c: c[1])[2]
        return palette, (main if main != palette else None)

    def _kind(self, h):
        if not h:
            return 'none'
        if h == self._palette:
            return 'palette'
        if h == self._main:
            return 'fusion-main'
        return 'fusion-other' if _pid(h) == self._pid else 'other-app'

    def _loop(self):
        prev = user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))  # this sampling thread only
        try:
            self._palette, self._main = self._find()
            last = None
            while not self._stop.is_set():
                if not self._palette:
                    self._palette, self._main = self._find()
                row = {'fg': None, 'covered': None, 'at': None, 'owner': None}
                fg = user32.GetForegroundWindow()
                row['fg'] = f'{self._kind(fg)}: {_title(fg)[:40]}'
                if self._palette:
                    l, t, r, b = _rect(self._palette)
                    at = user32.WindowFromPoint(wintypes.POINT((l + r) // 2, (t + b) // 2))
                    root = user32.GetAncestor(at, GA_ROOT) if at else None
                    row['covered'] = root != self._palette
                    row['at'] = f'{self._kind(root)}: {_title(root)[:40]}'
                    own = user32.GetWindow(self._palette, GW_OWNER)
                    row['owner'] = f'{self._kind(own)}: {_title(own)[:40]}' if own else 'unowned'
                key = tuple(row.values())
                if key != last:
                    row['t'] = datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3]
                    self._rows.append(row)
                    last = key
                time.sleep(SAMPLE_S)
        finally:
            if prev:
                user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(prev))

    def start(self):
        self._rows.append({'t': datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3], 'event': 'monitor start'})
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        self._thread.join(2)
        self._rows.append({'t': datetime.datetime.now().strftime('%H:%M:%S.%f')[:-3], 'event': 'monitor stop'})
        return self._rows
