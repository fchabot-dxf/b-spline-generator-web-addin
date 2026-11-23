"""
fb_shared.updater — "Update to latest" for the installed add-in (Fred 2026-11-22, simplified 2026-11-23: "why can't it
just be a script that copies the file to the Fusion folder?").

Pure stdlib (no adsk) so every step tests headlessly on a temp tree. The Fusion glue (the command, the Yes/No, closing
the palettes) lives in bspline-frame-builder.py and only calls in here, after the user said Yes:

    download_and_install(root)     # download the release zip -> check it is the add-in -> back up -> copy in

No version comparison, no checksum file: it always installs the current release zip.

The same install steps are written out in installer/install-bspline-addin.cmd (PowerShell) and
installer/install-bspline-addin.command (bash) for a machine that has no add-in yet. Keep the three in step.
"""
from __future__ import annotations

import os
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

ADDIN_NAME = "bspline-frame-builder"
RELEASE_BASE_URL = "https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/"
ZIP_NAME = ADDIN_NAME + ".zip"
ZIP_URL = RELEASE_BASE_URL + ZIP_NAME     # the zip the website button and both installers download

# The zip's one top folder must hold these, or it isn't the add-in.
REQUIRED_FILES = (ADDIN_NAME + ".py", ADDIN_NAME + ".manifest")
BACKUP_PREFIX = ADDIN_NAME + ".bak-"         # Fusion loads only <folder>/<folder>.manifest, so a .bak-* folder never runs
# Short on purpose: Windows tools without long-path support stop at 260 characters, and the add-in's deepest file
# sits ~115 below AddIns (measured 2026-11-22: a 45-character staging name failed the extract in a deep folder).
STAGING_NAME = "bsfb-new"
TIMESTAMP_FORMAT = "%Y%m%d-%H%M%S"           # sorts by name == sorts by time

# Written by the RUNNING add-in into its own folder, not by the release: carried into the new folder.
CARRY_OVER_FILES = (".addin-running.lock",)
# Overlay mode (the folder could not move) keeps these in place instead of deleting them as orphans.
OVERLAY_KEEP_SUFFIXES = (".log", ".txt")
OVERLAY_KEEP_DIRS = ("__pycache__",)

USER_AGENT = "bspline-frame-builder-updater"
RENAME_RETRIES = 3                           # a virus scanner can hold a fresh file for a moment

_RUN_ON_STARTUP_RE = re.compile(r'("runOnStartup"\s*:\s*)(true|false)')


class UpdateError(Exception):
    """A plain-English failure. ``code``: offline | bad_zip | in_use | no_addins_dir."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


# ── zip shape ────────────────────────────────────────────────────────────────────────────────────────────────────────
def validate_zip(path) -> list:
    """The zip's entry names, if it is the add-in: one top folder ``bspline-frame-builder/`` holding the entry .py and
    the .manifest, and no entry that could land outside that folder."""
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
    except (zipfile.BadZipFile, OSError):
        raise UpdateError("bad_zip", "The download is not a zip file.")
    top = ADDIN_NAME + "/"
    for n in names:
        parts = n.replace("\\", "/").split("/")
        if (not n.startswith(top) or n.startswith("/") or ":" in n or ".." in parts):
            raise UpdateError("bad_zip", f"The zip has an unexpected entry: {n}")
    for req in REQUIRED_FILES:
        if top + req not in names:
            raise UpdateError("bad_zip", f"The zip is missing {top + req}.")
    return names


# ── run on startup (the manifest's own key) ──────────────────────────────────────────────────────────────────────────
def set_run_on_startup(manifest_text: str, value: bool = True) -> str:
    """Set the manifest's ``"runOnStartup"`` without touching any other byte; add the key when it is missing."""
    word = "true" if value else "false"
    if _RUN_ON_STARTUP_RE.search(manifest_text):
        return _RUN_ON_STARTUP_RE.sub(lambda m: m.group(1) + word, manifest_text, count=1)
    return manifest_text.replace("{", '{\n    "runOnStartup": ' + word + ",", 1)


def read_run_on_startup(manifest_path):
    try:
        m = _RUN_ON_STARTUP_RE.search(Path(manifest_path).read_text(encoding="utf-8"))
    except OSError:
        return None
    return None if m is None else m.group(2) == "true"


def _write_run_on_startup(manifest_path: Path, value: bool):
    raw = manifest_path.read_bytes()
    text = raw.decode("utf-8-sig")
    manifest_path.write_bytes(set_run_on_startup(text, value).encode("utf-8"))   # never a BOM


# ── network ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def _ssl_context():
    try:
        import ssl
        try:
            import certifi                      # macOS Pythons can lack the system roots
            return ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            return ssl.create_default_context()
    except Exception:
        return None


def _open(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"})
    kwargs = {"timeout": timeout}
    if url.startswith("https://"):
        ctx = _ssl_context()
        if ctx is not None:
            kwargs["context"] = ctx
    return urllib.request.urlopen(req, **kwargs)


def download(url: str, dest, progress=None, timeout: float = 60):
    """Stream ``url`` into ``dest``. ``progress(done_bytes, total_bytes_or_None)`` after each chunk."""
    try:
        with _open(url, timeout) as resp, open(dest, "wb") as out:
            total = resp.headers.get("Content-Length")
            total = int(total) if total and total.isdigit() else None
            done = 0
            while True:
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
    except (urllib.error.URLError, OSError) as e:
        raise UpdateError("offline", f"The download failed (are you online?): {getattr(e, 'reason', e)}")


# ── install: stage, back up, swap ────────────────────────────────────────────────────────────────────────────────────
def _stamp_name(prefix, addins: Path, now) -> Path:
    base = prefix + (now or datetime.now()).strftime(TIMESTAMP_FORMAT)
    p, n = addins / base, 1
    while p.exists():
        n += 1
        p = addins / f"{base}-{n}"
    return p


def _retry_rename(rename, src, dst):
    for i in range(RENAME_RETRIES):
        try:
            rename(src, dst)
            return
        except OSError:
            if i == RENAME_RETRIES - 1:
                raise
            time.sleep(0.4)


def _files_under(root: Path) -> list:
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def _overlay(staged: Path, live: Path, backup: Path):
    """The folder can't move (Windows, a file in it is open): copy it to ``backup``, then replace file by file. A file
    that can't be replaced rolls every replaced one back from the backup -- never a half-new install."""
    shutil.copytree(live, backup)
    new_files = _files_under(staged)
    replaced, locked = [], []
    for rel in new_files:
        src, dst = staged / rel, live / rel
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            os.replace(src, dst)
            replaced.append(rel)
        except OSError:
            locked.append(rel)
    if locked:
        for rel in replaced:
            try:
                if (backup / rel).exists():
                    shutil.copy2(backup / rel, live / rel)
                else:
                    (live / rel).unlink()
            except OSError:
                pass
        shutil.rmtree(backup, ignore_errors=True)
        raise UpdateError("in_use", "Fusion is holding these files open, so nothing was changed: "
                                    + ", ".join(locked[:5]) + (" ..." if len(locked) > 5 else "")
                                    + ". Close Fusion and run the installer from the website instead.")
    keep = set(new_files) | set(CARRY_OVER_FILES)
    for rel in _files_under(live):
        parts = rel.split("/")
        if rel in keep or any(d in parts[:-1] for d in OVERLAY_KEEP_DIRS) or rel.lower().endswith(OVERLAY_KEEP_SUFFIXES):
            continue
        try:
            (live / rel).unlink()                # an orphan: gone from the new build
        except OSError:
            pass


def _long(p) -> str:
    """``p`` as a Windows extended-length path (``\\\\?\\C:\\...``) so deleting a tree deeper than 260 characters works
    without the LongPathsEnabled setting; unchanged elsewhere."""
    s = os.path.abspath(str(p))
    if os.name == "nt" and not s.startswith("\\\\?\\"):
        return "\\\\?\\UNC\\" + s[2:] if s.startswith("\\\\") else "\\\\?\\" + s
    return s


def _remove_tree(p) -> bool:
    shutil.rmtree(_long(p), ignore_errors=True)
    return not os.path.exists(_long(p))


def _prune_backups(addins: Path, keep: Path | None, prefix: str = BACKUP_PREFIX):
    """Keep only the newest ``<folder>.bak-*``. Returns the ones actually removed."""
    backups = sorted(p for p in addins.iterdir() if p.is_dir() and p.name.startswith(prefix))
    newest = keep if keep is not None else (backups[-1] if backups else None)
    removed = []
    for p in backups:
        if newest is not None and p == newest:
            continue
        if _remove_tree(p):
            removed.append(str(p))
    return removed


def install_zip(zip_path, addins_dir, *, folder_name=ADDIN_NAME, run_on_startup=None, now=None,
                rename=os.rename) -> dict:
    """Install the add-in zip as ``addins_dir/folder_name`` (``folder_name`` = the folder the running add-in lives in,
    whatever its name -- Fred 2026-11-23; backups are ``<folder_name>.bak-<time>``).

    1. check the zip's shape, 2. extract it into a staging folder next to the add-in (same drive, so the swap is a
    rename), 3. set runOnStartup (``None`` = keep what the installed manifest says; True for a first install), 4. carry
    the running add-in's heartbeat over, 5. move the old folder to ``bspline-frame-builder.bak-<time>`` and the staged
    one into place (or replace file by file when the old folder can't move), 6. keep only the newest backup.
    Touches nothing else in ``addins_dir``. Returns {mode: 'swap'|'overlay'|'fresh', backup, removed_backups}."""
    addins = Path(addins_dir)
    if not addins.is_dir():
        raise UpdateError("no_addins_dir", f"The Fusion AddIns folder was not found: {addins}")
    validate_zip(zip_path)
    live = addins / folder_name
    backup_prefix = folder_name + ".bak-"
    staging = addins / STAGING_NAME
    backup = None
    _remove_tree(staging)                         # a crashed earlier run's leftover (our own name)
    try:
        staging.mkdir()
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(staging)
        staged = staging / ADDIN_NAME
        if run_on_startup is None:
            run_on_startup = read_run_on_startup(live / (ADDIN_NAME + ".manifest")) if live.exists() else True
        if run_on_startup is not None:
            _write_run_on_startup(staged / (ADDIN_NAME + ".manifest"), bool(run_on_startup))
        for name in CARRY_OVER_FILES:
            if (live / name).is_file():
                shutil.copy2(live / name, staged / name)

        if not live.exists():
            _retry_rename(rename, staged, live)
            mode = "fresh"
        else:
            backup = _stamp_name(backup_prefix, addins, now)
            try:
                _retry_rename(rename, live, backup)
            except OSError:
                _overlay(staged, live, backup)
                mode = "overlay"
            else:
                try:
                    _retry_rename(rename, staged, live)
                except OSError:
                    _retry_rename(rename, backup, live)   # put the old one back
                    backup = None
                    raise UpdateError("in_use", "The new folder could not be moved into place; the old one is back. "
                                                "Close Fusion and try again.")
                mode = "swap"
    finally:
        _remove_tree(staging)
    removed = _prune_backups(addins, backup, backup_prefix)
    return {"mode": mode, "backup": None if backup is None else str(backup), "removed_backups": removed}


def download_and_install(addin_root, zip_url: str = ZIP_URL, *, progress=None, now=None) -> dict:
    """The user clicked "Update to latest" and said Yes: download the release zip to a temp file, then
    :func:`install_zip` over ``addin_root`` itself -- the folder this add-in runs from, whatever its name or what sits
    next to it (Fred 2026-11-23) -- with runOnStartup on, exactly as the website installers do."""
    root = Path(addin_root).resolve()
    tmp = Path(tempfile.mkdtemp(prefix="bspline-update-"))
    try:
        zpath = tmp / ZIP_NAME
        download(zip_url, zpath, progress=progress)
        return install_zip(zpath, root.parent, folder_name=root.name, run_on_startup=True, now=now)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
