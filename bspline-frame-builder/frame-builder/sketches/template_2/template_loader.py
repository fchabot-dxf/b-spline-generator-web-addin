"""
Template Loader — auto-wires phases into sketches and sketches into templates.

Copy this file verbatim into any ``template_N/`` folder. It scans the folder
it lives in plus its ``phases/`` subfolder and builds the template tree from
filenames alone — no manual import lists, no explicit block sequences.

Template identity comes from the containing folder name (``template_1``,
``template_2``, ...). Files inside carry no template-number prefix, so the
same filenames recur across every template folder.

Naming convention
-----------------

Phases (in ``phases/``):
    ``p<sketch:02>_<phase:02>_<token>.py``

    - ``<sketch>`` — 2-digit sketch index (``01`` / ``02`` / ``03`` ...).
      Determines which sketch the phase belongs to.
    - ``<phase>``  — 2-digit position within that sketch (``01`` first).
      Determines build order.
    - ``<token>``  — free-form, human-readable suffix.

    Example: ``p02_05_chain.py`` → sketch 2, phase 5.

Sketches (in the template folder root):
    ``sketch_<N>_<token>.py``

    Each sketch file only needs to expose ``get_sketch(ui_data=None)``
    returning ``{"Name": "...", "Blocks": [...]}``. The ``Blocks`` list is
    produced by :func:`load_phase_blocks` at call time.

Usage inside a sketch file
--------------------------

::

    from template_loader import load_phase_blocks

    def get_sketch(ui_data=None):
        return {
            "Name": "2_shape-outline",
            "Blocks": load_phase_blocks(1, ui_data),
        }

The integer argument is the **sketch index** (``1``, ``2``, ``3`` ...).
That's the only template-specific detail the sketch file has to carry.

Usage inside ``template_data.py``
---------------------------------

::

    from template_loader import load_all_sketches

    def get_template_logic(ui_data=None):
        sketches = load_all_sketches(ui_data)
        sketches[0]["Label"] = "Bounding Box"
        sketches[0]["Parameters"] = [...]
        ...
        return {
            "Name": "Template 1 - Hourglass",
            "Description": "...",
            "Sketches": sketches,
        }

``load_all_sketches`` returns the sketch dicts in sketch-index order, so
``sketches[0]`` is always sketch 1, ``sketches[1]`` is sketch 2, etc.

Module-cache isolation
----------------------

Every template folder ships an identical copy of this file, so bare names
like ``template_loader``, ``sketch_1_bounding-box``, and ``p02_05_chain``
collide across folders inside ``sys.modules``. The first template loaded
wins; subsequent loads silently get the cached module pointing at the
wrong folder (bug symptom: Template 2 reporting Template 1's phase count).

Fix: phase and sketch modules are loaded via
``importlib.util.spec_from_file_location`` using a folder-scoped key
``fb_tpl_<folder>__<bare>``. Each template's modules live in their own
``sys.modules`` slot and can never pave over a sibling template's.
"""

import importlib
import importlib.util
import os
import re
import sys


# Regex for phase files. Groups: (sketch, phase).
# The folder carries the template identity, so filenames no longer need
# a ``T{N}_`` prefix.
_PHASE_RE = re.compile(r'^p(\d{2})_(\d{2})_[^.]+\.py$')

# Regex for sketch files. Group: (sketch_index).
_SKETCH_RE = re.compile(r'^sketch_(\d+)_[^.]+\.py$')


def _here():
    """Absolute path of the template folder this loader lives in."""
    return os.path.dirname(os.path.realpath(__file__))


def _phases_dir():
    return os.path.join(_here(), 'phases')


def _folder_tag():
    """Short identifier for the containing template folder.

    Used to namespace imported phase/sketch modules in ``sys.modules``
    so a sibling template's ``p02_01_projs`` can't collide with ours.
    Without this tag, Python's module cache silently serves the first
    template's phase list to the second (the bug that showed up as
    "19 phases for Template 2" after the ``T{N}_`` prefix was dropped).
    """
    return os.path.basename(os.path.dirname(os.path.realpath(__file__)))


def _unique_mod_name(bare_name):
    """Return ``fb_tpl_<folder>__<bare>`` — the cache key we use for imports."""
    return f"fb_tpl_{_folder_tag()}__{bare_name}"


def _ensure_on_syspath(path):
    """Make ``path`` importable without mutating the caller's environment.

    Kept because phase files may ``import`` each other by bare name, and
    bare imports still need ``sys.path`` to resolve. The loader itself
    no longer relies on ``sys.path`` — it loads by file path.
    """
    if path and path not in sys.path:
        sys.path.insert(0, path)


def _scan_phase_files():
    """Return ``{sketch_idx: [(phase_idx, bare_name, abs_path), ...]}`` sorted.

    Files that don't match ``_PHASE_RE`` are silently ignored — the
    sidecar ``__init__.py`` and ``*.md`` documentation live in the same
    folder and must not be interpreted as phases.
    """
    buckets = {}
    pdir = _phases_dir()
    for fn in sorted(os.listdir(pdir)):
        m = _PHASE_RE.match(fn)
        if not m:
            continue
        sketch_idx = int(m.group(1))
        phase_idx = int(m.group(2))
        bare_name = fn[:-3]  # strip ``.py``
        abs_path = os.path.join(pdir, fn)
        buckets.setdefault(sketch_idx, []).append(
            (phase_idx, bare_name, abs_path))
    for idx in buckets:
        buckets[idx].sort(key=lambda triple: triple[0])
    return buckets


def _scan_sketch_files():
    """Return ``[(sketch_idx, bare_name, abs_path), ...]`` sorted by sketch index.

    ``template_data.py`` and ``template_loader.py`` live next to the
    sketch files but don't match the sketch regex, so they're filtered
    out without a special-case list.
    """
    found = []
    root = _here()
    for fn in sorted(os.listdir(root)):
        m = _SKETCH_RE.match(fn)
        if not m:
            continue
        sketch_idx = int(m.group(1))
        bare_name = fn[:-3]
        abs_path = os.path.join(root, fn)
        found.append((sketch_idx, bare_name, abs_path))
    found.sort(key=lambda triple: triple[0])
    return found


def _load_by_path(bare_name, abs_path):
    """Load ``abs_path`` as a module stored at ``fb_tpl_<folder>__<bare>``.

    Uses ``importlib.util.spec_from_file_location`` to bypass ``sys.path``
    entirely — two templates can have identically-named phase files and
    neither will shadow the other, because each ends up under a
    folder-scoped key. If the module is already cached under its unique
    key, reload it in place so code edits take effect inside a single
    Fusion Run.
    """
    key = _unique_mod_name(bare_name)
    existing = sys.modules.get(key)
    if existing is not None and getattr(existing, '__file__', None) == abs_path:
        # Same file — just reload so edits are picked up.
        try:
            return importlib.reload(existing)
        except Exception:
            # Reload failed (e.g. syntax error mid-edit); fall through to
            # a fresh load so the stale module doesn't mask the problem.
            sys.modules.pop(key, None)

    spec = importlib.util.spec_from_file_location(key, abs_path)
    if spec is None or spec.loader is None:
        raise ImportError(
            f"template_loader: could not build spec for {abs_path}")
    module = importlib.util.module_from_spec(spec)
    # Register before exec so intra-module circular imports resolve.
    sys.modules[key] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(key, None)
        raise
    return module


# Module-scope caches. Keyed by the folder-scoped unique name so repeated
# ``load_phase_blocks`` calls inside a single Fusion Run don't re-import.
# Cleared by :func:`reload_all` when the user forces a fresh load.
_PHASE_CACHE = {}
_SKETCH_CACHE = {}


def reload_all():
    """Drop import caches and rescan both folders.

    Call this at the top of ``template_data.py`` if you want a hard
    reload on every Fusion Run (the old code did this unconditionally).
    Otherwise the caches stick within a single Run for speed.
    """
    _PHASE_CACHE.clear()
    _SKETCH_CACHE.clear()
    _ensure_on_syspath(_here())
    _ensure_on_syspath(_phases_dir())
    buckets = _scan_phase_files()
    for triples in buckets.values():
        for _, bare_name, abs_path in triples:
            key = _unique_mod_name(bare_name)
            _PHASE_CACHE[key] = _load_by_path(bare_name, abs_path)
    for _, bare_name, abs_path in _scan_sketch_files():
        key = _unique_mod_name(bare_name)
        _SKETCH_CACHE[key] = _load_by_path(bare_name, abs_path)


def load_phase_blocks(sketch_index, ui_data=None):
    """Return the ``get_block(ui_data)`` list for ``sketch_index`` in order.

    Missing phases produce an empty list rather than raising — a sketch
    with no phases yet is a valid editing intermediate, and swallowing
    keeps the sketch file importable during that window.
    """
    _ensure_on_syspath(_here())
    _ensure_on_syspath(_phases_dir())
    buckets = _scan_phase_files()
    triples = buckets.get(int(sketch_index), [])
    blocks = []
    for _, bare_name, abs_path in triples:
        key = _unique_mod_name(bare_name)
        mod = _PHASE_CACHE.get(key)
        if mod is None or getattr(mod, '__file__', None) != abs_path:
            mod = _load_by_path(bare_name, abs_path)
            _PHASE_CACHE[key] = mod
        block = mod.get_block(ui_data)
        if isinstance(block, dict):
            block.setdefault("PhaseFile", f"{bare_name}.py")
        blocks.append(block)
    return blocks


def load_all_sketches(ui_data=None):
    """Return every sketch dict in sketch-index order.

    Each sketch module must expose ``get_sketch(ui_data)`` returning a
    dict with at least ``Name`` and ``Blocks``. The caller is free to
    stamp ``Label`` and ``Parameters`` onto the returned dicts —
    ``template_data.py`` is where those live, since they're
    UI-panel metadata rather than sketch geometry.
    """
    _ensure_on_syspath(_here())
    results = []
    for _, bare_name, abs_path in _scan_sketch_files():
        key = _unique_mod_name(bare_name)
        mod = _SKETCH_CACHE.get(key)
        if mod is None or getattr(mod, '__file__', None) != abs_path:
            mod = _load_by_path(bare_name, abs_path)
            _SKETCH_CACHE[key] = mod
        results.append(mod.get_sketch(ui_data))
    return results


def describe():
    """Return a human-readable summary of the scanned tree (for debug).

    Prints nothing — returns a multi-line string so callers can log or
    assert against it. Handy inside ``template_data.py`` when a
    newly-added phase file isn't showing up and you want to see what
    the loader actually found.
    """
    lines = []
    buckets = _scan_phase_files()
    sketches = _scan_sketch_files()
    lines.append(f"template_loader scan — {_here()}")
    lines.append(f"  folder tag: {_folder_tag()}")
    lines.append(f"  sketches found: {len(sketches)}")
    for idx, bare_name, _ in sketches:
        phase_count = len(buckets.get(idx, []))
        lines.append(f"    [{idx}] {bare_name}  ({phase_count} phases)")
    for idx in sorted(buckets.keys()):
        lines.append(f"  sketch {idx} phases:")
        for phase_idx, bare_name, _ in buckets[idx]:
            lines.append(f"    {phase_idx:02d}  {bare_name}")
    return "\n".join(lines)
