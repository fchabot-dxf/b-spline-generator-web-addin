"""Fusion's own memory, read before each Send (b-spline-gen) and each BUILD (CAM-builder): DETECTION ONLY.

MEASURED 2026-10-07 (seat A): each Send + BUILD + APPLY doc, closed by handle, leaves ~2.6 GB of private bytes inside
Fusion (3.3 -> 9.0 GB over 2 docs; 3.2 -> 5.8 -> 8.5) -- not held by this add-in (its globals hold no closed-doc
objects; dropping the 3 stale proxies it did hold + gc changed nothing). Long sessions reached 65 GB, and at 18.6 GB
Fusion stopped responding on this 32 GB PC. Nothing is blocked here: the palette shows one line above the declared
soft threshold (amber) and the hard one (red), the reading is logged with each Send / BUILD, and the user decides.
Thresholds are declared once, here.
"""
import sys

FUSION_RESTART_SOFT_GB = 12
FUSION_RESTART_HARD_GB = 24


def private_gb():
    """This process's private bytes (Fusion's, when called from an add-in), in GB; None where it can't be read."""
    if sys.platform != 'win32':
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class _PMCEx(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD),
                        ('PeakWorkingSetSize', ctypes.c_size_t), ('WorkingSetSize', ctypes.c_size_t),
                        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t), ('QuotaPagedPoolUsage', ctypes.c_size_t),
                        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t), ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
                        ('PagefileUsage', ctypes.c_size_t), ('PeakPagefileUsage', ctypes.c_size_t),
                        ('PrivateUsage', ctypes.c_size_t)]

        c = _PMCEx()
        c.cb = ctypes.sizeof(c)
        k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        psapi = ctypes.WinDLL('psapi', use_last_error=True)
        k32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
        if not psapi.GetProcessMemoryInfo(k32.GetCurrentProcess(), ctypes.byref(c), c.cb):
            return None
        return c.PrivateUsage / 2 ** 30
    except Exception:
        return None


def memory_signal(gb):
    """Pure: {'gb', 'level': 'ok' | 'soft' | 'hard', 'text'} for a reading in GB (None = unknown -> ok, no text)."""
    if gb is None:
        return {'gb': None, 'level': 'ok', 'text': ''}
    level = 'hard' if gb >= FUSION_RESTART_HARD_GB else 'soft' if gb >= FUSION_RESTART_SOFT_GB else 'ok'
    # the reason, measured 2026-10-09 (seat A): Fusion's own memory grows ~0.55 GB per Send and a document CLOSE adds
    # ~0.5 GB more -- only a restart frees it
    text = f'Fusion is using {gb:.0f} GB: save and restart Fusion soon (closing documents does not free memory)' if level != 'ok' else ''
    return {'gb': round(gb, 1), 'level': level, 'text': text}


def read_signal(log=None, where=''):
    """Read, log one line ('[MEMORY] <where>: Fusion private N GB (level)') and return the signal."""
    sig = memory_signal(private_gb())
    if log:
        try:
            log(f"[MEMORY] {where}: Fusion private {sig['gb'] if sig['gb'] is not None else '?'} GB ({sig['level']})")
        except Exception:
            pass
    return sig
