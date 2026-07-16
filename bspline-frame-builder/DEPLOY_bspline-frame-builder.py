"""
DEPLOY_bspline-frame-builder.py
================================
Local-install only: copies the unified bspline-frame-builder add-in (B-Spline Gen, 
Frame Builder, CAM Builder, Fusion Inspector, Fusion Exporter, Template Maker) 
into Fusion 360's AddIns folder so you can immediately Stop/Run it inside Fusion.

The public distribution ZIP and GitHub 'latest' release are built and uploaded by
release.py (`--addin` / `--all`), NOT by this script. deploy_cloudflare.py is
web-only (it builds dist/ and deploys Cloudflare Pages).

Usage:
    python DEPLOY_bspline-frame-builder.py
"""

import os
import sys
import shutil
import hashlib
import json
import time
import subprocess
from pathlib import Path
from datetime import datetime

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ADDIN_NAME = "bspline-frame-builder"

# Source: the directory that contains THIS script
SRC_DIR  = Path(__file__).parent.resolve()

# Fusion 360 AddIns destination
if sys.platform == "win32":
    _appdata   = os.getenv("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
    DEST_ROOT  = Path(_appdata) / "Autodesk" / "Autodesk Fusion 360" / "API" / "AddIns"
elif sys.platform == "darwin":
    DEST_ROOT  = Path.home() / "Library" / "Application Support" / "Autodesk" / "Autodesk Fusion 360" / "API" / "AddIns"
else:
    print(f"Unsupported OS: {sys.platform}")
    sys.exit(1)

DEST_DIR = DEST_ROOT / ADDIN_NAME

# ---------------------------------------------------------------------------
# Shared Add-in Deploy Helpers
# ---------------------------------------------------------------------------

def get_default_dest_root() -> Path:
    if sys.platform == "win32":
        _appdata = os.getenv("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        return Path(_appdata) / "Autodesk" / "Autodesk Fusion 360" / "API" / "AddIns"
    elif sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Autodesk" / "Autodesk Fusion 360" / "API" / "AddIns"
    else:
        raise RuntimeError(f"Unsupported OS: {sys.platform}")


def _deploy_addin(src_dir: Path, addin_name: str, verify_files: list[str], skip_names=None, skip_suffixes=None, skip_files_exact=None, extra_copy=None) -> bool:
    dest_dir = get_default_dest_root() / addin_name
    print("=" * 60)
    print(f"DEPLOYING {addin_name}")
    print(f"  Source : {src_dir}")
    print(f"  Target : {dest_dir}")
    print("=" * 60)

    if not src_dir.exists():
        print(f"ERROR: source directory not found: {src_dir}")
        return False

    if skip_names is None:
        skip_names = SKIP_NAMES
    if skip_suffixes is None:
        skip_suffixes = SKIP_SUFFIXES
    if skip_files_exact is None:
        skip_files_exact = SKIP_FILES_EXACT

    def _ignore(src_path: str, names: list) -> list:
        return [n for n in names if n in skip_names or n in skip_files_exact or Path(n).suffix.lower() in skip_suffixes or n.startswith('.')]

    src_hashes = {}
    for rel in verify_files:
        p = src_dir / rel
        if p.exists():
            src_hashes[rel] = md5(p)
        else:
            print(f"  WARNING: expected source file missing: {rel}")

    scrub_source(src_dir)

    if dest_dir.exists():
        clean_dir(dest_dir)

    print("  Copying files...")
    try:
        copied, skipped_paths = copy_overlay(src_dir, dest_dir, _ignore)
    except Exception as e:
        print(f"  ERROR: copy_overlay failed: {e}")
        return False
    if skipped_paths:
        # A skipped file = a STALE deploy. Fail LOUD with the full list rather
        # than soft-tipping and returning success (the stale-deploy bug).
        print(f"  ERROR: copy skipped {len(skipped_paths)} file(s) — {addin_name} deploy is STALE/incomplete:")
        for rel in skipped_paths:
            print(f"    SKIPPED {rel}")
        print(f"  Stop the add-in in Fusion, then redeploy.")
        return False
    print(f"  Copied {copied} files.")
    if extra_copy:
        extra_copy(src_dir, dest_dir)

    print("  Verifying key files...")
    all_ok = True
    for rel, src_hash in src_hashes.items():
        dest_path = dest_dir / rel
        if not dest_path.exists():
            print(f"  FAIL    {rel}  — missing in destination!")
            all_ok = False
            continue
        dest_hash = md5(dest_path)
        status = "OK     " if dest_hash == src_hash else "MISMATCH"
        print(f"  {status}  {rel}")
        if dest_hash != src_hash:
            all_ok = False

    if all_ok:
        print(f"  {addin_name} deploy successful.")
    else:
        print(f"  ERROR: {addin_name} deploy had problems.")

    return all_ok


def deploy_template_maker() -> bool:
    from pathlib import Path as _Path
    addin_dir = SRC_DIR / "template-maker"
    verify_files = [
        "template-maker.py",
        "template-maker.manifest",
        "template_maker_palette.html",
        "template_generator.py",
        "entity_helpers.py",
        "expression_coords.py",
        "ressources/16x16.png",
        "ressources/32x32.png",
        "ressources/64x64.png",
    ]
    return _deploy_addin(addin_dir, "template-maker", verify_files)


def deploy_fusion_inspector() -> bool:
    addin_dir = SRC_DIR / "frame-inspector"
    verify_files = [
        "fusion-inspector.py",
        "fusion-inspector.manifest",
        "inspector_palette.html",
        "selection_items.py",
        "entity_helpers.py",
        "payload_builder.py",
        "resources/InspectorCommand/16x16.png",
        "resources/InspectorCommand/32x32.png",
        "resources/InspectorCommand/64x64.png",
    ]
    return _deploy_addin(addin_dir, "fusion-inspector", verify_files)


def deploy_fusion_exporter() -> bool:
    addin_dir = SRC_DIR / "fusion-exporter"
    verify_files = [
        "fusion-exporter.py",
        "fusion-exporter.manifest",
        "exporter.py",
        "ressources/16x16.png",
        "ressources/32x32.png",
        "ressources/64x64.png",
    ]
    return _deploy_addin(addin_dir, "fusion-exporter", verify_files)


def deploy_all(force=False) -> bool:
    # The three former sub-add-ins are now bundled INSIDE bspline-frame-builder
    # (their source subfolders are copied as part of deploy_local), so we no
    # longer install them as separate top-level AddIns.
    return deploy_local(force=force)


# Files to verify after the local copy
VERIFY_FILES = [
    "bspline-frame-builder.py",
    "bspline-frame-builder.manifest",
    "frame-builder/ui/sketch_builder_ui.py",
    "frame-builder/ui/solid_builder_ui.py",
    "frame-builder/ui/html/sketch_builder_palette.html",
    "frame-builder/ui/html/solid_builder_palette.html",
    "frame-builder/fb_engine/parametric_engine.py",
    # fb_shared — the single source of truth consolidated in C4 (consumed by
    # both frame-inspector and template-maker). A stale copy here would drift
    # the shared modules silently, so verify all three.
    "fb_shared/__init__.py",
    "fb_shared/entity_helpers.py",
    "fb_shared/expression_coords.py",
    # Bundled sub-add-in entry points (installed as part of this unified deploy).
    "frame-inspector/fusion-inspector.py",
    "template-maker/template-maker.py",
    "b-spline-gen/b-spline-gen.py",
    "b-spline-gen/html/index.html",
    # stamp-editor — sibling add-in for surface-deformation stamping.
    "stamp-editor/stamp-editor.py",
    "stamp-editor/stamp-editor.manifest",
    "stamp-editor/html/index.html",
    "stamp-editor/html/main/main.js",
    "stamp-editor/html/main/ui-bindings.js",
    "stamp-editor/html/core/runtime.js",
    "stamp-editor/html/styles/stamp-editor.css",
]

# Folders / patterns to SKIP in both local deploy and ZIP
SKIP_NAMES = {
    ".git", ".gitignore", ".gitkeep",
    "__pycache__", ".venv", "venv", "node_modules",
    ".wrangler", "deploy_dist",
    "probe.txt", "import_test.txt", "run_test.txt", "run_debug.txt",
    "desktop.ini",
    "_legacy_archived",  # archived hybrid-palette source — kept locally, not shipped
    ".addin-running.lock",  # runtime heartbeat lock (E3 stop-first guard) — never ship/copy
}
SKIP_SUFFIXES = {".log", ".old", ".pyc", ".pyo"}
# Dev-only scripts that shouldn't ship to end-users
SKIP_FILES_EXACT = {
    "DEPLOY_bspline-frame-builder.py",   # this script itself
    "deploy-frame-builder.py",
    "deploy_bspline_addin.py",
    "DEPLOY_cloudflare.py",
    # NOTE: "workspace_link.json" intentionally NOT skipped. When present in
    # b-spline-gen/, it tells the running addin to write its log file into
    # the dev workspace folder instead of AppData. Skipping it from deploy
    # would defeat that purpose. The addin treats the file as optional dev
    # metadata; a missing/invalid path falls back to AppData logging.
    "project_path.json",
    "b_spline_log_path.json",
    "b_spline_gen_log.txt",
    "frame-builder.py",       # LEGACY: ignore the monolithic backup
    "frame-builder.manifest", # LEGACY: ignore redundant manifest
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _should_skip(name: str) -> bool:
    """Return True if this file/folder name should be excluded from deploy/zip."""
    if name in SKIP_NAMES:
        return True
    if name in SKIP_FILES_EXACT:
        return True
    suffix = os.path.splitext(name)[1].lower()
    if suffix in SKIP_SUFFIXES:
        return True
    return False


def ignore_for_copy(src_path: str, names: list) -> list:
    """shutil.copytree ignore callback. Also drops any cache-busting
    folders a sub-addin leaves behind in its own directory between
    sessions (named `_palette_<timestamp>_<pid>`)."""
    return [n for n in names if _should_skip(n) or n.startswith('_palette_')]


def clean_dir(path: Path, retries: int = 2, verbose: bool = True):
    """Try to delete a directory. Silent fall-through to overlay-copy mode
    when locked files (e.g. an addin log Fusion still has open) make rmtree
    impossible.

    We attempt rmtree a couple of times with a short backoff. On final
    failure we print a single concise note (only when ``verbose``) and let
    the caller fall back to ``copy_overlay``. No multi-line retry spam.
    """
    if not path.exists():
        return True
    for i in range(retries):
        try:
            shutil.rmtree(path)
            return True
        except Exception:
            if i < retries - 1:
                time.sleep(0.5)
            else:
                if verbose:
                    print(f"  Old install left in place (some files locked); files will be overlaid.")
                return False
    return False


def copy_overlay(src: Path, dst: Path, ignore_func) -> tuple[int, list]:
    """Walk ``src`` and copy every file into ``dst``, overwriting.

    Per-file errors are reported but don't abort the walk, so the caller sees
    the FULL set of skipped files (not just the first). Returns
    ``(copied, skipped_paths)`` where ``skipped_paths`` is the list of
    dst-relative POSIX paths that could not be copied. Reporting the paths as
    DATA lets the CALLER decide the policy: today a non-empty list is fatal
    (a skipped file = a stale deploy). Mirrors ``shutil.copytree`` filtering
    semantics via ``ignore_func``.
    """
    copied = 0
    skipped_paths = []
    for root, dirs, files in os.walk(src):
        rel_root = Path(root).relative_to(src)
        # Apply ignore filter on dirnames in-place so os.walk skips them.
        ignored_here = ignore_func(root, list(dirs) + list(files))
        dirs[:]  = [d for d in dirs  if d not in ignored_here]
        files    = [f for f in files if f not in ignored_here]

        target_root = dst / rel_root
        try:
            target_root.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"  WARNING: cannot create {target_root}: {e}")
            skipped_paths.extend((rel_root / f).as_posix() for f in files)
            continue

        for fname in files:
            src_file = Path(root) / fname
            dst_file = target_root / fname
            try:
                shutil.copy2(src_file, dst_file)
                copied += 1
            except Exception as e:
                # Most common reason: Fusion has the file open (logs).
                rel = dst_file.relative_to(dst).as_posix()
                print(f"  SKIP {rel}: {e}")
                skipped_paths.append(rel)
    return copied, skipped_paths

def scrub_source(base: Path):
    """Recursively delete __pycache__ and .pyc files in the source tree."""
    print("  Scrubbing source (removing .pyc and __pycache__)...")
    for p in base.rglob("*"):
        if p.is_dir() and p.name == "__pycache__":
            clean_dir(p)
        elif p.suffix.lower() in {".pyc", ".pyo"}:
            try: p.unlink()
            except Exception: pass


# ---------------------------------------------------------------------------
# Step 1 — Local Fusion 360 deploy
# ---------------------------------------------------------------------------

_LOCK_STALE_SECONDS = 24 * 3600   # a lock older than this is treated as stale (PID-reuse guard)


def _pid_alive(pid):
    """True if a process with ``pid`` is currently running. Windows-safe: it
    QUERIES the process (OpenProcess + GetExitCodeProcess) and never signals it.
    (The POSIX ``os.kill(pid, 0)`` liveness idiom is DANGEROUS on Windows, where
    os.kill routes to TerminateProcess and would KILL the target, e.g. Fusion.)"""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        k = ctypes.windll.kernel32
        k.OpenProcess.restype        = wintypes.HANDLE
        k.OpenProcess.argtypes       = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        k.CloseHandle.argtypes       = [wintypes.HANDLE]
        h = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return False          # no such process (or not queryable) -> not alive
        try:
            code = wintypes.DWORD()
            if k.GetExitCodeProcess(h, ctypes.byref(code)):
                return code.value == STILL_ACTIVE
            return False
        finally:
            k.CloseHandle(h)
    try:
        os.kill(pid, 0)           # POSIX: signal 0 only tests existence, does NOT kill
    except ProcessLookupError:
        return False
    except PermissionError:
        return True               # exists but owned by another user
    return True


def _detect_running_addin():
    """Best-effort stop-first pre-check. Reads ``DEST_DIR/.addin-running.lock``
    (written by the add-in's run(), removed by stop()) and returns
    ``(status, message)``:

      'live'  — lock present, its PID is running, and it isn't older than the
                stale threshold  -> caller REFUSES (unless --force).
      'stale' — lock present but the PID is dead / the file is unreadable / it is
                older than the threshold  -> caller WARNS + proceeds.
      'none'  — no lock  -> silent, proceed.

    Never blocks on uncertainty: any read/parse problem degrades to 'stale'."""
    lock = DEST_DIR / ".addin-running.lock"
    if not lock.exists():
        return ("none", "")
    try:
        info    = json.loads(lock.read_text(encoding="utf-8"))
        pid     = int(info.get("pid"))
        started = str(info.get("started_at", "?"))
    except Exception:
        return ("stale", "unreadable .addin-running.lock (ignoring)")
    if not _pid_alive(pid):
        return ("stale", f"stale lock — pid {pid} is not running (ignoring)")
    try:
        age = (datetime.now().astimezone() - datetime.fromisoformat(started)).total_seconds()
        if age > _LOCK_STALE_SECONDS:
            return ("stale", f"lock is ~{int(age // 3600)}h old — pid {pid} likely reused (ignoring)")
    except Exception:
        pass
    return ("live", f"add-in appears LIVE in Fusion (pid {pid}, since {started})")


def deploy_local(force=False):
    print("=" * 60)
    print("STEP 1: Local Fusion 360 deploy")
    print(f"  Source : {SRC_DIR}")
    print(f"  Target : {DEST_DIR}")
    print("=" * 60)

    # Stop-first pre-check (E3): refuse to deploy over a demonstrably-live add-in.
    # Best-effort — degrades to a warning on ANY uncertainty, and E1's post-copy
    # fail-loud remains the correctness gate regardless.
    _status, _msg = _detect_running_addin()
    if _status == "live" and not force:
        print("  " + "=" * 58)
        print(f"  REFUSING TO DEPLOY: {_msg}")
        print("  Deploying over a running add-in fights a live process and can")
        print("  leave a STALE / partial install. Stop it first:")
        print("      Fusion -> Tools -> Add-Ins -> Stop")
        print("  then redeploy. To deploy anyway, re-run with  --force")
        print("  " + "=" * 58)
        sys.exit(2)
    elif _status == "live":
        print(f"  WARNING (--force): {_msg} — deploying over it anyway.")
    elif _status == "stale":
        print(f"  Note: {_msg}")

    if not SRC_DIR.exists():
        print(f"ERROR: source directory not found: {SRC_DIR}")
        sys.exit(1)

    # Sync b-spline-gen's stamp module + deps into stamp-editor's tree
    # so stamp-editor's source code can import them from its own path
    # (./core/stamp/) without reaching across add-in folders.
    # The deploy copies the bundle just-in-time so the canonical source
    # of truth remains b-spline-gen/html/core/stamp/.
    try:
        from sync_stamp_bundle import sync_stamp_bundle
        sync_stamp_bundle(Path(__file__).resolve().parent)
    except Exception as e:
        print(f"  WARNING: stamp bundle sync failed: {e}")

    # Snapshot source hashes BEFORE touching anything
    src_hashes = {}
    for rel in VERIFY_FILES:
        p = SRC_DIR / rel
        if p.exists():
            src_hashes[rel] = md5(p)
        else:
            print(f"  WARNING: expected source file missing: {rel}")

    # Scrub source
    scrub_source(SRC_DIR)

    # Remove old install (silent fall-through to overlay if locked)
    if DEST_DIR.exists():
        clean_dir(DEST_DIR)

    # Copy. copy_overlay mirrors the whole repo file-by-file, so styles/,
    # fonts under b-spline-gen/html/fonts/, and every command's HTML/JS/CSS
    # land in place automatically. Per-file errors (e.g. Fusion holding a
    # log file open) are skipped without aborting the deploy.
    print("  Copying files...")
    try:
        copied, skipped_paths = copy_overlay(SRC_DIR, DEST_DIR, ignore_for_copy)
    except Exception as e:
        print(f"  ERROR: copy_overlay failed: {e}")
        sys.exit(1)
    if skipped_paths:
        # A skipped file = a STALE deploy. Fail LOUD with the full list rather
        # than soft-tipping and returning success (the stale-deploy bug).
        print(f"  ERROR: copy skipped {len(skipped_paths)} file(s) — deploy is STALE/incomplete:")
        for rel in skipped_paths:
            print(f"    SKIPPED {rel}")
        print(f"  A running Fusion add-in is holding these locked. Stop it")
        print(f"  (Fusion -> Tools -> Add-Ins -> Stop), then redeploy.")
        sys.exit(1)
    print(f"  Copied {copied} files.")

    # Write project_path.json handshake for the frame-builder sub-module so
    # its DebugLogger can write logs back to the source workspace.
    _write_fb_handshake()
    _write_cam_handshake()
    _write_bspline_handshake()
    _write_stamp_editor_handshake()

    # Version stamp: record what was deployed (git SHA + build time) as an inert
    # DEST-only artifact every palette's Python can read. See VERSION-STAMP-DESIGN.md.
    _write_build_info()

    # Verify
    print("  Verifying key files...")
    all_ok = True
    for rel, src_hash in src_hashes.items():
        dest_path = DEST_DIR / rel
        if not dest_path.exists():
            print(f"  FAIL    {rel}  — missing in destination!")
            all_ok = False
            continue
        dest_hash = md5(dest_path)
        status    = "OK     " if dest_hash == src_hash else "MISMATCH"
        print(f"  {status}  {rel}")
        if dest_hash != src_hash:
            all_ok = False

    if all_ok:
        print("\n  Local deploy successful.")
        print("  Next: Shift+S in Fusion 360 -> Add-ins -> Stop then Run.")
    else:
        print("\n  ERROR: one or more files did not copy correctly.")
    return all_ok


def _write_build_info():
    """
    Write build-info.json into the deployed add-in ROOT (DEST-only artifact,
    fork F1=A) so every palette's Python can read WHAT was deployed:
        {sha, branch, built_at, source_root, dirty}
    Computed from git in SRC_DIR at deploy time. On ANY git failure (git absent,
    not a repo, timeout) we fall back to sha='unknown' and STILL write the file —
    a version stamp must never crash the deploy. Mirrors the _write_*_handshake
    writers. See VERSION-STAMP-DESIGN.md 2a.
    """
    def _git(*args, default="unknown"):
        try:
            out = subprocess.run(
                ["git", "-C", str(SRC_DIR), *args],
                capture_output=True, text=True, timeout=10,
            )
            if out.returncode == 0:
                return out.stdout.strip() or default
        except Exception:
            pass
        return default

    sha    = _git("rev-parse", "--short", "HEAD")
    branch = _git("rev-parse", "--abbrev-ref", "HEAD")

    # source_root = the git repo TOPLEVEL (where .git lives — SRC_DIR's parent),
    # stored portable (~/...) like the handshakes so compare_to_source can locate
    # <source_root>/.git. Falls back to SRC_DIR's parent when git is absent.
    toplevel  = _git("rev-parse", "--show-toplevel", default="")
    repo_root = Path(toplevel) if toplevel else SRC_DIR.parent
    try:
        rel_to_home = repo_root.relative_to(Path.home())
        source_root = f"~/{rel_to_home.as_posix()}"
    except ValueError:
        source_root = str(repo_root)

    # dirty = uncommitted changes to TRACKED files. Untracked files (e.g. the
    # advisor's NEXT-SESSION.md / ROADMAP.md / scratchpad) are IGNORED via
    # --untracked-files=no so they don't perpetually flag every deploy dirty;
    # 'dirty' therefore means "deployed modified tracked code not in any commit".
    dirty = bool(_git("status", "--porcelain", "--untracked-files=no", default=""))

    info = {
        "sha":         sha,
        "branch":      branch,
        "built_at":    datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_root": source_root,
        "dirty":       dirty,
    }
    try:
        out_path = DEST_DIR / "build-info.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(info, f, indent=4)
        print(f"  Build info: {sha} ({branch}){' DIRTY' if dirty else ''} @ {info['built_at']}")
    except Exception as e:
        print(f"  WARNING: could not write build-info.json: {e}")


def _write_fb_handshake():
    """
    Write project_path.json into the deployed frame-builder sub-folder so
    its DebugLogger knows where to write source-side logs.
    """
    try:
        fb_dest = DEST_DIR / "frame-builder"
        if fb_dest.exists():
            # Portability Fix: Store path relative to HOME if possible
            try:
                home = Path.home()
                rel_to_home = (SRC_DIR / "frame-builder").relative_to(home)
                path_str = f"~/{rel_to_home.as_posix()}"
            except ValueError:
                # Not under home, use absolute path
                path_str = str(SRC_DIR / "frame-builder")

            config     = {"project_root": path_str}
            handshake  = fb_dest / "project_path.json"
            with open(handshake, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=4)
            print(f"  Handshake written (Portable): {path_str}")
    except Exception as e:
        print(f"  WARNING: could not write frame-builder handshake: {e}")


def _write_cam_handshake():
    """
    Write project_path.json into the deployed CAM-builder sub-folder so
    its CamDebugLogger knows where to write source-side logs (mirrors
    _write_fb_handshake -- without this, CamDebugLogger falls back to
    frame-builder's handshake and routes CAM-builder logs to the wrong
    source folder).
    """
    try:
        cam_dest = DEST_DIR / "CAM-builder"
        if cam_dest.exists():
            try:
                home = Path.home()
                rel_to_home = (SRC_DIR / "CAM-builder").relative_to(home)
                path_str = f"~/{rel_to_home.as_posix()}"
            except ValueError:
                path_str = str(SRC_DIR / "CAM-builder")

            config     = {"project_root": path_str}
            handshake  = cam_dest / "project_path.json"
            with open(handshake, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=4)
            print(f"  CAM Handshake written (Portable): {path_str}")
    except Exception as e:
        print(f"  WARNING: could not write CAM-builder handshake: {e}")


def _write_bspline_handshake():
    """
    Write workspace_link.json into the deployed b-spline-gen sub-folder
    so its ``get_log_path()`` writes b_spline_gen_log.txt back to the
    source workspace instead of the deployed addin folder.

    Different filename + key from the frame-builder/CAM-builder handshake
    because b-spline-gen uses its own pre-existing convention
    (workspace_link.json + 'workspace_root' key). Kept that way for
    backwards-compat; the unifying refactor can wait.
    """
    try:
        bs_dest = DEST_DIR / "b-spline-gen"
        if not bs_dest.exists():
            return
        # Resolve the source path. Use absolute (not ~) form because
        # b-spline-gen's get_log_path uses os.path.isdir directly without
        # expanding tildes.
        src_path = (SRC_DIR / "b-spline-gen").resolve()
        config    = {"workspace_root": str(src_path)}
        handshake = bs_dest / "workspace_link.json"
        with open(handshake, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4)
        print(f"  B-Spline Handshake written: {src_path}")
    except Exception as e:
        print(f"  WARNING: could not write b-spline-gen handshake: {e}")


def _write_stamp_editor_handshake():
    """Same idea as the b-spline-gen handshake — routes stamp-editor's
    log file back to the source workspace so the dev tree's
    stamp_editor_log.txt is the source of truth, not the one inside
    %APPDATA%\\AddIns\\."""
    try:
        st_dest = DEST_DIR / "stamp-editor"
        if not st_dest.exists():
            return
        src_path = (SRC_DIR / "stamp-editor").resolve()
        config    = {"workspace_root": str(src_path)}
        handshake = st_dest / "workspace_link.json"
        with open(handshake, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4)
        print(f"  Stamp Editor Handshake written: {src_path}")
    except Exception as e:
        print(f"  WARNING: could not write stamp-editor handshake: {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _usage():
    print("Usage: python DEPLOY_bspline-frame-builder.py [all|bbf]")
    print("  all        Deploy the unified bspline-frame-builder add-in (contains")
    print("             template-maker, fusion-inspector, and fusion-exporter as")
    print("             sub-modules).")
    print("  bbf        Same as 'all' (deploy bspline-frame-builder).")
    print("\nLegacy targets (template-maker | fusion-inspector | fusion-exporter)")
    print("are still supported for emergency debug but install those modules as")
    print("SEPARATE Fusion add-ins, which conflicts with the unified add-in.")
    print("\nExample: python DEPLOY_bspline-frame-builder.py all")

if __name__ == "__main__":
    _flags      = {a.lower() for a in sys.argv[1:] if a.startswith("--")}
    _positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    _force      = "--force" in _flags   # skip the E3 stop-first refusal
    target = _positional[0].lower() if _positional else "all"

    if target in {"all", "deploy-all"}:
        success = deploy_all(force=_force)
    elif target in {"bbf", "bspline", "framebuilder", "frame-builder", "bspline-frame-builder", "local"}:
        success = deploy_local(force=_force)
    elif target in {"template-maker", "template_maker", "template"}:
        print("WARNING: installing template-maker as a SEPARATE add-in.")
        print("         The unified bspline-frame-builder add-in already contains it.")
        success = deploy_template_maker()
    elif target in {"fusion-inspector", "fusion_inspector", "inspector"}:
        print("WARNING: installing fusion-inspector as a SEPARATE add-in.")
        print("         The unified bspline-frame-builder add-in already contains it.")
        success = deploy_fusion_inspector()
    elif target in {"fusion-exporter", "fusion_exporter", "exporter"}:
        print("WARNING: installing fusion-exporter as a SEPARATE add-in.")
        print("         The unified bspline-frame-builder add-in already contains it.")
        success = deploy_fusion_exporter()
    else:
        _usage()
        sys.exit(1)

    if not success:
        sys.exit(1)
    print()
    print("All done.")
