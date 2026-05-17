"""
sync_stamp_bundle.py
====================
Mirror b-spline-gen's stamp + editor modules into every sibling
add-in that consumes them, so b-spline-gen stays the single source
of truth while each consuming add-in ships with its own self-contained
copy of the bundle.

Three things get synced:

  1. The stamp pipeline (SDF + profile math) into `<addin>/html/core/stamp/`,
     with light import-path rewrites so `../coords.js`-style imports
     collapse to `./coords.js` inside the bundle.

  2. The SVG editor (VectorEditor + tools + symbol keyboard + curve fitting)
     into `<addin>/html/editor/`, mirrored 1:1 — no rewrites. The editor's
     external deps (`../core/coords.js`, `../core/svg-utils.js`) are
     ALSO mirrored at `<addin>/html/core/` so the parent-relative imports
     resolve the same way they do in b-spline-gen.

  3. (Implicit) The shared stylesheets at `bspline-frame-builder/styles/`
     are NOT copied — they already live alongside every consumer in the
     deploy tree and resolve via `../../styles/<name>.css`.

Files synced per target:

   stamp bundle:
     b-spline-gen/html/core/coords.js     -> <addin>/.../core/stamp/coords.js
     b-spline-gen/html/core/debug.js      -> <addin>/.../core/stamp/debug.js
     b-spline-gen/html/core/svg-utils.js  -> <addin>/.../core/stamp/svg-utils.js
     b-spline-gen/html/core/gaussian.js   -> <addin>/.../core/stamp/gaussian.js
     b-spline-gen/html/core/stamp/*.js    -> <addin>/.../core/stamp/*.js
     b-spline-gen/html/core/stamp/profiles/*.js
                                          -> <addin>/.../core/stamp/profiles/*.js
   editor bundle:
     b-spline-gen/html/core/coords.js     -> <addin>/html/core/coords.js
     b-spline-gen/html/core/svg-utils.js  -> <addin>/html/core/svg-utils.js
     b-spline-gen/html/editor/**/*.js     -> <addin>/html/editor/**/*.js

Usage:
   python sync_stamp_bundle.py          # syncs in place
   from sync_stamp_bundle import sync_stamp_bundle
   sync_stamp_bundle(repo_root)         # callable from deploy scripts
"""

from __future__ import annotations
import shutil
import sys
from pathlib import Path


# Files copied at the bundle root (rewritten so `../coords.js`-style
# imports collapse to `./coords.js`).
DEPS_AT_ROOT = [
    ('core/coords.js',    'coords.js'),
    ('core/debug.js',     'debug.js'),
    ('core/svg-utils.js', 'svg-utils.js'),
    ('core/gaussian.js',  'gaussian.js'),
]

# stamp/*.js files — kept at the same relative path inside the bundle.
STAMP_FILES = [
    'core/stamp/index.js',
    'core/stamp/sdf.js',
    'core/stamp/render-svg.js',
    'core/stamp/transform.js',
    'core/stamp/profiles/index.js',
    'core/stamp/profiles/flat.js',
    'core/stamp/profiles/vbit.js',
    'core/stamp/profiles/ballnose.js',
    'core/stamp/profiles/adaptive.js',
]

# Import rewrites: when a stamp file imports `../coords.js` (or any
# other root-level dep), collapse the parent hop because those files
# live alongside index.js inside the bundle.
IMPORT_REWRITES = [
    ("from '../coords.js'",    "from './coords.js'"),
    ('from "../coords.js"',    'from "./coords.js"'),
    ("from '../debug.js'",     "from './debug.js'"),
    ('from "../debug.js"',     'from "./debug.js"'),
    ("from '../svg-utils.js'", "from './svg-utils.js'"),
    ('from "../svg-utils.js"', 'from "./svg-utils.js"'),
    ("from '../gaussian.js'",  "from './gaussian.js'"),
    ('from "../gaussian.js"',  'from "./gaussian.js"'),
]


def _rewrite_imports(text: str) -> str:
    for src, dst in IMPORT_REWRITES:
        text = text.replace(src, dst)
    return text


def _sync_one(src_dir: Path, dst_root: Path) -> int:
    """Mirror the stamp bundle into one target tree."""
    if not src_dir.is_dir():
        print(f'sync_stamp_bundle: source missing: {src_dir}', file=sys.stderr)
        return 0

    written = 0

    # Wipe + recreate so deletions on the source side propagate.
    if dst_root.exists():
        shutil.rmtree(dst_root)
    dst_root.mkdir(parents=True, exist_ok=True)
    (dst_root / 'profiles').mkdir(parents=True, exist_ok=True)

    for src_rel, dst_name in DEPS_AT_ROOT:
        src = src_dir / src_rel
        if not src.is_file():
            print(f'sync_stamp_bundle: missing dep {src}', file=sys.stderr)
            continue
        (dst_root / dst_name).write_text(
            _rewrite_imports(src.read_text(encoding='utf-8')),
            encoding='utf-8',
        )
        written += 1

    for rel in STAMP_FILES:
        src = src_dir / rel
        if not src.is_file():
            print(f'sync_stamp_bundle: missing stamp file {src}', file=sys.stderr)
            continue
        rel_in_bundle = rel.replace('core/stamp/', '', 1)
        dst = dst_root / rel_in_bundle
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(
            _rewrite_imports(src.read_text(encoding='utf-8')),
            encoding='utf-8',
        )
        written += 1

    print(f'sync_stamp_bundle: wrote {written} files to {dst_root}')
    return written


# ─── Editor bundle ──────────────────────────────────────────────────────
# The editor lives at b-spline-gen/html/editor/. Its only external imports
# are `../core/coords.js` and `../core/svg-utils.js`, which we mirror into
# the consumer's own html/core/ so the same parent-relative paths resolve.

EDITOR_EXTERNAL_DEPS = [
    'core/coords.js',
    'core/svg-utils.js',
    'core/debug.js',     # re-exported by editor/debug.js
    'core/gaussian.js',  # safety: cheap and used in a few places
]


def _sync_editor(src_html: Path, addin_html: Path) -> int:
    """Mirror the entire html/editor/ tree from b-spline-gen into the
    consumer add-in. No rewrites — the imports are intra-folder or
    parent-relative `../core/*.js`, both of which work as long as we
    also mirror the matching core/ files."""
    src_editor = src_html / 'editor'
    dst_editor = addin_html / 'editor'
    if not src_editor.is_dir():
        print(f'sync_stamp_bundle: editor source missing: {src_editor}',
              file=sys.stderr)
        return 0

    # Wipe and recopy so deletions propagate.
    if dst_editor.exists():
        shutil.rmtree(dst_editor)
    dst_editor.mkdir(parents=True, exist_ok=True)

    written = 0
    for src_file in src_editor.rglob('*.js'):
        rel = src_file.relative_to(src_editor)
        dst_file = dst_editor / rel
        dst_file.parent.mkdir(parents=True, exist_ok=True)
        dst_file.write_text(src_file.read_text(encoding='utf-8'),
                            encoding='utf-8')
        written += 1

    # External deps — copied verbatim at the same relative path so
    # editor's `../core/coords.js` import resolves.
    dst_core = addin_html / 'core'
    dst_core.mkdir(parents=True, exist_ok=True)
    for rel in EDITOR_EXTERNAL_DEPS:
        src = src_html / rel
        if not src.is_file():
            print(f'sync_stamp_bundle: missing editor dep {src}',
                  file=sys.stderr)
            continue
        dst = dst_core / Path(rel).name
        dst.write_text(src.read_text(encoding='utf-8'), encoding='utf-8')
        written += 1

    print(f'sync_stamp_bundle: wrote {written} editor files to {dst_editor}')
    return written


def sync_stamp_bundle(repo_root) -> int:
    """Copy the stamp + editor bundles into every consuming add-in.
    Returns total files written across all targets."""
    root    = Path(repo_root)
    src_dir = root / 'b-spline-gen' / 'html'

    # Each entry is <addin>/html — the consuming add-in's web tree.
    consumer_htmls = [
        root / 'stamp-editor' / 'html',
        # step-editor used to ship the bundle for its in-house stamp
        # engine; that engine has moved to stamp-editor, so this entry
        # is left commented out. Re-enable if step-editor needs the
        # stamp pipeline again.
        # root / 'step-editor' / 'html',
    ]

    total = 0
    for addin_html in consumer_htmls:
        if not (addin_html.parent.is_dir()):
            continue
        # Stamp bundle goes under <addin>/html/core/stamp.
        total += _sync_one(src_dir, addin_html / 'core' / 'stamp')
        # Editor bundle + its core deps go under <addin>/html/editor
        # and <addin>/html/core respectively.
        total += _sync_editor(src_dir, addin_html)
    return total


if __name__ == '__main__':
    here = Path(__file__).resolve().parent
    sync_stamp_bundle(here)
