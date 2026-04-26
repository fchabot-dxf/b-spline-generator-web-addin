"""
TemplateLoader — discovers sketches and phases inside a template folder.

A single shared implementation, used by every ``template_data.py``. Each
template instantiates its own ``TemplateLoader(folder_path)``; state lives
on the instance, not on module globals, so two templates can never share
caches or step on each other's ``sys.modules`` entries.

This module is deliberately standalone — it lives at the ``frame-builder``
root rather than inside ``fb_engine`` so it carries no dependency on
Fusion (``adsk.*``) and can be imported and unit-tested in plain Python.

Layout discovered
-----------------

Each template folder contains:

    template_data.py
    sketch_<N>_<token>.py        (one per sketch)
    phases/
        __init__.py
        p<sketch:02>_<phase:02>_<token>.py   (one per phase)

The loader is invariant to which template folder it points at — pass a
different folder, get a different (and isolated) view of sketches and
phases.

Why this is a class, not module-level functions
-----------------------------------------------

The previous design lived as module-level functions inside per-template
``template_loader.py`` files, with module-scope caches. That setup
required:

  * One copy of the loader file per template folder.
  * Bare ``from template_loader import …`` statements inside every
    sketch and phase file, which Python resolved through ``sys.path``.
  * A purge-and-restore dance in ``frame_engine`` to keep two templates
    from sharing the cached ``template_loader`` module.

Bare imports through ``sys.path`` were the root cause of the
"Template 1 silently uses Template 2's phases" bug fixed on 2026-04-25.
Switching to a class kills that whole class of problem:

  * The function ``load_phase_blocks`` is **injected** into each sketch
    and phase module's namespace before exec, so those files no longer
    need an ``import`` statement at all.
  * Caches are instance attributes — no global state to leak between
    templates, no ``sys.modules`` keys to manage by hand.
  * One file in one place to fix when the loader needs changing.
"""

import importlib.util
import os
import re
import sys


_PHASE_RE = re.compile(r'^p(\d{2})_(\d{2})_[^.]+\.py$')
_SKETCH_RE = re.compile(r'^sketch_(\d+)_[^.]+\.py$')


class TemplateLoader:
    """Per-template module loader. Instantiate once per template folder."""

    def __init__(self, folder_path):
        """``folder_path`` is the absolute path to a template folder."""
        self.folder = os.path.realpath(folder_path)
        self.phases_dir = os.path.join(self.folder, 'phases')
        self.tag = os.path.basename(self.folder)
        # Caches keyed by absolute file path so a moved/renamed file
        # invalidates cleanly without us having to track names.
        self._phase_cache = {}    # abs_path -> module
        self._sketch_cache = {}   # abs_path -> module

    # -- discovery -----------------------------------------------------

    def _scan_phase_files(self):
        """Return ``{sketch_idx: [(phase_idx, abs_path), ...]}`` sorted."""
        buckets = {}
        if not os.path.isdir(self.phases_dir):
            return buckets
        for fn in sorted(os.listdir(self.phases_dir)):
            m = _PHASE_RE.match(fn)
            if not m:
                continue
            sketch_idx = int(m.group(1))
            phase_idx = int(m.group(2))
            abs_path = os.path.join(self.phases_dir, fn)
            buckets.setdefault(sketch_idx, []).append((phase_idx, abs_path))
        for idx in buckets:
            buckets[idx].sort(key=lambda pair: pair[0])
        return buckets

    def _scan_sketch_files(self):
        """Return ``[(sketch_idx, abs_path), ...]`` sorted by sketch index."""
        found = []
        if not os.path.isdir(self.folder):
            return found
        for fn in sorted(os.listdir(self.folder)):
            m = _SKETCH_RE.match(fn)
            if not m:
                continue
            sketch_idx = int(m.group(1))
            abs_path = os.path.join(self.folder, fn)
            found.append((sketch_idx, abs_path))
        found.sort(key=lambda pair: pair[0])
        return found

    # -- module loading ------------------------------------------------

    def _unique_module_name(self, abs_path):
        """Folder-scoped key for ``sys.modules``.

        Includes the template tag so a sibling template's same-named file
        never collides with ours; includes a stem so different files in
        the same folder get distinct keys.
        """
        stem = os.path.splitext(os.path.basename(abs_path))[0]
        return "fb_tpl_{}__{}".format(self.tag, stem)

    def _exec_module(self, abs_path, inject):
        """Load ``abs_path`` as a fresh module with ``inject`` keys preset.

        ``inject`` is a dict whose entries are stamped onto the new
        module's namespace **before** ``exec_module`` runs. That's how
        sketch files get ``load_phase_blocks`` without writing an
        ``import`` statement - the function is already defined in their
        module globals by the time their source executes.
        """
        key = self._unique_module_name(abs_path)
        spec = importlib.util.spec_from_file_location(key, abs_path)
        if spec is None or spec.loader is None:
            raise ImportError(
                "TemplateLoader: could not build spec for {}".format(abs_path))
        module = importlib.util.module_from_spec(spec)
        for name, value in inject.items():
            setattr(module, name, value)
        # Note: we deliberately do not register in ``sys.modules``. Each
        # build re-execs the source so file edits are picked up; nothing
        # else in the process holds module references between calls.
        spec.loader.exec_module(module)
        return module

    # -- public API ----------------------------------------------------

    def load_phase_blocks(self, sketch_index, ui_data=None):
        """Return the ordered list of phase blocks for ``sketch_index``.

        Each phase file exposes ``get_block(ui_data)`` returning a dict.
        We stamp ``PhaseFile`` onto every block dict so logs and tests
        can identify which file produced it (cheap, helps a lot when
        diagnosing surprises).
        """
        blocks = []
        for _, abs_path in self._scan_phase_files().get(int(sketch_index), []):
            mod = self._phase_cache.get(abs_path)
            if mod is None:
                mod = self._exec_module(abs_path, inject={})
                self._phase_cache[abs_path] = mod
            block = mod.get_block(ui_data)
            if isinstance(block, dict):
                block.setdefault("PhaseFile", os.path.basename(abs_path))
            blocks.append(block)
        return blocks

    def load_all_sketches(self, ui_data=None):
        """Return ``[sketch_dict, ...]`` in sketch-index order.

        Each sketch module exposes ``get_sketch(ui_data)`` returning a
        dict with at least ``Name`` and ``Blocks``. Sketch files reach
        ``load_phase_blocks`` through namespace injection - they don't
        import it. Caller stamps ``Label`` and ``Parameters`` after.
        """
        results = []
        for _, abs_path in self._scan_sketch_files():
            mod = self._sketch_cache.get(abs_path)
            if mod is None:
                mod = self._exec_module(
                    abs_path,
                    inject={'load_phase_blocks': self.load_phase_blocks},
                )
                self._sketch_cache[abs_path] = mod
            results.append(mod.get_sketch(ui_data))
        return results

    def reload_all(self):
        """Drop caches so the next ``load_*`` call re-execs from disk.

        Also evicts ``sketches._common.*`` from ``sys.modules``.
        Per-template phase and sketch files are exec'd via
        ``spec_from_file_location`` and never registered in
        ``sys.modules``, so clearing the instance caches is enough for
        those. Shim files in each template's ``phases/`` folder, however,
        do real ``from sketches._common.phases.X import get_block``
        statements that go through Python's regular import machinery and
        cache the canonical modules. Without this eviction, edits or
        Ctrl+Z to files in ``sketches/_common/`` would not be picked up
        on reload - the shim would re-exec but get the stale cached
        ``get_block`` back.
        """
        self._phase_cache.clear()
        self._sketch_cache.clear()
        stale = [k for k in sys.modules
                 if k == 'sketches._common'
                 or k.startswith('sketches._common.')]
        for k in stale:
            del sys.modules[k]

    def describe(self):
        """Human-readable summary of what this loader sees on disk."""
        lines = ["TemplateLoader[{}] @ {}".format(self.tag, self.folder)]
        sketches = self._scan_sketch_files()
        buckets = self._scan_phase_files()
        lines.append("  sketches: {}".format(len(sketches)))
        for idx, abs_path in sketches:
            phase_count = len(buckets.get(idx, []))
            lines.append(
                "    [{}] {}  ({} phases)".format(
                    idx, os.path.basename(abs_path), phase_count))
        return "\n".join(lines)
