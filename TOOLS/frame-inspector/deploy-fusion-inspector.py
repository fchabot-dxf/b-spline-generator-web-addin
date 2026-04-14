import os
import sys
import shutil
import hashlib
from pathlib import Path
import json

# ---------------------------------------------------------------------------
# Configuration for Fusion Inspector Standalone
# ---------------------------------------------------------------------------
ADDIN_NAME = "fusion-inspector"
SRC_DIR    = Path(__file__).parent

APPDATA    = os.getenv('APPDATA', os.path.expanduser('~\\AppData\\Roaming'))
DEST_ROOT  = Path(APPDATA) / "Autodesk" / "Autodesk Fusion 360" / "API" / "AddIns"
DEST_DIR   = DEST_ROOT / ADDIN_NAME

# Key files we always verify after copy
VERIFY_FILES = [
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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def md5(path: Path) -> str:
	h = hashlib.md5()
	with open(path, "rb") as f:
		for chunk in iter(lambda: f.read(65536), b""):
			h.update(chunk)
	return h.hexdigest()

def ignore_patterns(path, names):
	"""Skip development noise."""
	skip = {'.git', '.gitignore', '__pycache__', 'venv', '.venv', 'node_modules', '*.pyc'}
	return [n for n in names if n in skip or n.startswith('.')]

def cleanup_cache(directory: Path):
	"""Recursively delete all __pycache__ folders and .pyc files."""
	if not directory.exists():
		return
	print(f"  Cleaning cache in: {directory}")
	for root, dirs, files in os.walk(directory, topdown=False):
		for name in files:
			if name.endswith('.pyc'):
				try:
					os.remove(os.path.join(root, name))
				except: pass
		for name in dirs:
			if name == "__pycache__":
				try:
					shutil.rmtree(os.path.join(root, name))
				except: pass

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

def deploy():
	print(f"--- {ADDIN_NAME} aggressive deploy ---")
	print(f"  Source : {SRC_DIR}")
	print(f"  Target : {DEST_DIR}")

	# 1. Verify source exists
	if not SRC_DIR.exists():
		print(f"ERROR: source directory not found: {SRC_DIR}")
		sys.exit(1)

	# 2. Cleanup stale cache BEFORE anything else
	cleanup_cache(SRC_DIR)
	if DEST_DIR.exists():
		cleanup_cache(DEST_DIR)

	# 3. Snapshot source hashes after cleanup
	src_hashes = {}
	for rel in VERIFY_FILES:
		p = SRC_DIR / rel
		if p.exists():
			src_hashes[rel] = md5(p)
		else:
			print(f"WARNING: expected source file missing: {rel}")

	# 4. Remove old version entirely
	if DEST_DIR.exists():
		print("  Removing old install...")
		try:
			shutil.rmtree(DEST_DIR)
		except Exception as e:
			print(f"ERROR: could not remove old install: {e}")
			sys.exit(1)

	# 5. Copy fresh
	print("  Copying fresh files...")
	try:
		shutil.copytree(SRC_DIR, DEST_DIR, ignore=ignore_patterns)
	except Exception as e:
		print(f"ERROR: copytree failed: {e}")
		sys.exit(1)

	# 6. Verify
	print("  Verifying key files...")
	all_ok = True
	for rel, src_hash in src_hashes.items():
		dest_path = DEST_DIR / rel
		if not dest_path.exists():
			print(f"  FAIL  {rel}  -- missing in destination!")
			all_ok = False
			continue
		dest_hash = str(md5(dest_path))
		match = "OK  " if dest_hash == src_hash else "MISMATCH"
		print(f"  {match}  {rel}  ({dest_hash[:8]})")
		if dest_hash != src_hash:
			all_ok = False

	print()
	if all_ok:
		print("Deployment successful (CACHE PURGED).")
		print("Next: Shift+S in Fusion 360 > Add-ins tab > Stop then Run.")
	else:
		print("ERROR: one or more files did not copy correctly — see above.")
		sys.exit(1)

def update_project_path_json():
    """Update project_path.json with the absolute path to the current frame-inspector folder."""
    abs_path = os.path.abspath(os.path.dirname(__file__))
    config = {"inspector_root": abs_path}
    config_path = os.path.join(abs_path, "project_path.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=4)

if __name__ == "__main__":
	update_project_path_json()
	print(f"Updated project_path.json with inspector_root: {os.path.abspath(os.path.dirname(__file__))}")
	deploy()
