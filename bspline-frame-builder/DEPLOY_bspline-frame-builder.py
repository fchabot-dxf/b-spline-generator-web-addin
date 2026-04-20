"""
DEPLOY_bspline-frame-builder.py
================================
Deploys the unified bspline-frame-builder add-in (all 3 commands) in two steps:

  1. LOCAL DEPLOY  — copies the add-in into Fusion 360's AddIns folder so you
                     can immediately Stop/Run it inside Fusion.

  2. ZIP BUNDLE    — creates  bspline-frame-builder.zip  next to this script,
                     suitable for distributing to other users.

The b-spline-gen Cloudflare deploy (DEPLOY_cloudflare.py) is NOT
touched by this script — it continues to handle the HTML/JS web publish
and its own standalone ZIP independently.

Usage:
    python DEPLOY_bspline-frame-builder.py
"""

import os
import sys
import shutil
import hashlib
import json
import time
import zipfile
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

# ZIP output location (sits next to this script, easy to find / distribute)
ZIP_OUT  = SRC_DIR / f"{ADDIN_NAME}.zip"

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
        print("  Removing old install...")
        clean_dir(dest_dir)

    print("  Copying files...")
    try:
        shutil.copytree(src_dir, dest_dir, ignore=_ignore)
        if extra_copy:
            extra_copy(src_dir, dest_dir)
    except Exception as e:
        print(f"  ERROR: copytree failed: {e}")
        return False

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


def cleanup_legacy_standalone_addins() -> None:
    """Remove the old top-level AddIns folders that used to house template-maker,
    fusion-inspector, and fusion-exporter as SEPARATE Fusion add-ins.

    These three modules are now consolidated into the bspline-frame-builder
    add-in (they live under its subfolders and are loaded by the main
    bootstrap). Leaving the old folders in place would make Fusion's Add-Ins
    dialog show them as duplicate entries alongside the unified one.
    """
    dest_root = get_default_dest_root()
    legacy = ['template-maker', 'fusion-inspector', 'fusion-exporter']
    print("=" * 60)
    print("CLEANUP: removing legacy standalone add-in folders")
    print("=" * 60)
    for name in legacy:
        path = dest_root / name
        if path.exists():
            print(f"  Removing {path}")
            clean_dir(path)
        else:
            print(f"  (not present) {path}")


def deploy_all() -> bool:
    cleanup_legacy_standalone_addins()
    # The three former sub-add-ins are now bundled INSIDE bspline-frame-builder
    # (their source subfolders are copied as part of deploy_local), so we no
    # longer install them as separate top-level AddIns.
    return deploy_local()


# Files to verify after the local copy
VERIFY_FILES = [
    "bspline-frame-builder.py",
    "bspline-frame-builder.manifest",
    "frame-builder/ui/hybrid_builder_ui.py",
    "frame-builder/ui/html/index.html",
    "b-spline-gen/b-spline-gen.py",
    "b-spline-gen/html/index.html",
]

# Folders / patterns to SKIP in both local deploy and ZIP
SKIP_NAMES = {
    ".git", ".gitignore", ".gitkeep",
    "__pycache__", ".venv", "venv", "node_modules",
    ".wrangler", "deploy_dist",
    "probe.txt", "import_test.txt", "run_test.txt", "run_debug.txt",
    "desktop.ini",
}
SKIP_SUFFIXES = {".log", ".old", ".pyc", ".pyo"}
# Dev-only scripts that shouldn't ship to end-users
SKIP_FILES_EXACT = {
    "DEPLOY_bspline-frame-builder.py",   # this script itself
    "deploy-frame-builder.py",
    "deploy_bspline_addin.py",
    "DEPLOY_cloudflare.py",
    "workspace_link.json",
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
    """shutil.copytree ignore callback."""
    return [n for n in names if _should_skip(n)]


def clean_dir(path: Path, retries: int = 3):
    """Robustly delete a directory, retrying on transient locks."""
    if not path.exists():
        return
    for i in range(retries):
        try:
            shutil.rmtree(path)
            return
        except Exception as e:
            if i < retries - 1:
                print(f"  Retry {i+1}: could not remove {path}: {e}")
                time.sleep(1)
            else:
                print(f"  WARNING: could not fully remove {path}: {e}")

def scrub_source(base: Path):
    """Recursively delete __pycache__ and .pyc files in the source tree."""
    print("  Scrubbing source (removing .pyc and __pycache__)...")
    for p in base.rglob("*"):
        if p.is_dir() and p.name == "__pycache__":
            clean_dir(p)
        elif p.suffix.lower() in {".pyc", ".pyo"}:
            try: p.unlink()
            except: pass


# ---------------------------------------------------------------------------
# Step 1 — Local Fusion 360 deploy
# ---------------------------------------------------------------------------

def deploy_local():
    print("=" * 60)
    print("STEP 1: Local Fusion 360 deploy")
    print(f"  Source : {SRC_DIR}")
    print(f"  Target : {DEST_DIR}")
    print("=" * 60)

    if not SRC_DIR.exists():
        print(f"ERROR: source directory not found: {SRC_DIR}")
        sys.exit(1)

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

    # Remove old install
    if DEST_DIR.exists():
        print("  Removing old install...")
        clean_dir(DEST_DIR)

    # Copy
    print("  Copying files...")
    try:
        shutil.copytree(SRC_DIR, DEST_DIR, ignore=ignore_for_copy)
        # CONSOLIDATION: Copy shared-style.css into the frame-builder UI folder
        style_src = SRC_DIR / "b-spline-gen" / "html" / "shared-style.css"
        style_dest = DEST_DIR / "frame-builder" / "ui" / "html" / "shared-style.css"
        if style_src.exists():
            shutil.copy2(style_src, style_dest)
            print("  Consolidated shared-style.css to UI folder.")
    except Exception as e:
        print(f"  ERROR: copytree failed: {e}")
        sys.exit(1)

    # Write project_path.json handshake for the frame-builder sub-module so
    # its DebugLogger can write logs back to the source workspace.
    _write_fb_handshake()

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


# ---------------------------------------------------------------------------
# Step 2 — ZIP bundle for distribution
# ---------------------------------------------------------------------------

def build_zip():
    print()
    print("=" * 60)
    print("STEP 2: ZIP bundle")
    print(f"  Output : {ZIP_OUT}")
    print("=" * 60)

    if ZIP_OUT.exists():
        ZIP_OUT.unlink()

    def _iter_files(base: Path):
        """Yield (abs_path, archive_path) for every file to include."""
        for root, dirs, files in os.walk(base):
            root_path = Path(root)

            # Prune dirs in-place (affects os.walk descent)
            dirs[:] = [d for d in dirs if not _should_skip(d)]

            for fname in files:
                if _should_skip(fname):
                    continue
                abs_path  = root_path / fname
                # Archive path: ADDIN_NAME/frame-builder/engine/... etc.
                rel_path  = abs_path.relative_to(base.parent)
                yield abs_path, str(rel_path)

    file_count = 0
    with zipfile.ZipFile(ZIP_OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for abs_path, arc_path in _iter_files(SRC_DIR):
            zf.write(abs_path, arc_path)
            file_count += 1

    size_kb = ZIP_OUT.stat().st_size / 1024
    print(f"  Packed {file_count} files → {ZIP_OUT.name}  ({size_kb:.1f} KB)")
    print("\n  ZIP bundle complete.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _usage():
    print("Usage: python DEPLOY_bspline-frame-builder.py [all|bbf|cleanup]")
    print("  all        Remove legacy standalone add-in folders, then deploy the")
    print("             unified bspline-frame-builder add-in (contains template-maker,")
    print("             fusion-inspector, and fusion-exporter as sub-modules).")
    print("  bbf        Deploy bspline-frame-builder only (skip cleanup).")
    print("  cleanup    Only remove the legacy standalone add-in folders,")
    print("             don't deploy anything.")
    print("\nLegacy targets (template-maker | fusion-inspector | fusion-exporter)")
    print("are still supported for emergency debug but install those modules as")
    print("SEPARATE Fusion add-ins, which conflicts with the unified add-in.")
    print("\nExample: python DEPLOY_bspline-frame-builder.py all")

if __name__ == "__main__":
    target = sys.argv[1].lower() if len(sys.argv) > 1 else "all"

    if target in {"all", "deploy-all"}:
        success = deploy_all()
    elif target in {"bbf", "bspline", "framebuilder", "frame-builder", "bspline-frame-builder", "local"}:
        success = deploy_local()
    elif target in {"cleanup", "clean"}:
        cleanup_legacy_standalone_addins()
        success = True
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
    # build_zip()  # Disabled for faster local iteration
    print()
    print("All done.")
