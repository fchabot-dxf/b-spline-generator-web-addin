"""
TemplateResolver — discovery, lazy loading, and resolution of frame
templates declared under ``sketches/template_*``.

Why split this out?
-------------------
``frame_engine.py`` used to mix three responsibilities: (1) template
discovery + lazy load + resolution, (2) FrameBuilder orchestration,
(3) Fusion document state management. The first ~250 lines were all
about templates. Extracting them here lets FrameBuilder stay focused on
"build a frame" and lets the discovery / resolution code be tested or
swapped (cloud-backed registry, versioned templates, etc.) without
touching the geometry pipeline.

Public API
----------
* :py:func:`get_available_templates` — list of ``{label, value}`` dicts
  for UI population.
* :py:func:`get_template_spec(style_id)` — returns the resolved template
  spec dict for a given style id.
* :py:func:`resolve_template(style_id, ui_data=None)` — returns
  ``(template_spec, prefix)``. Used by :py:class:`FrameBuilder`.

Module-level state
------------------
The registry is built lazily on first access and cached for the rest of
the Fusion session. Each registry entry holds an AST-parsed display name
and a closure that imports + caches its ``template_data.py`` on first
use, so the cost of importing N templates is paid only when N templates
are actually built.
"""

import ast
import importlib
import importlib.util
import os
import sys


_FRAME_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
_SKETCHES_ROOT = os.path.join(_FRAME_ROOT, 'sketches')
_TEMPLATE_REGISTRY = None


# Module-level logger. Initialized lazily so importing this module never
# crashes if fb_utils isn't on the path yet (e.g. during early add-in
# bootstrap).
_logger = None


def _get_logger():
    global _logger
    if _logger is None:
        try:
            from fb_utils import fb_logger
            _logger = fb_logger.DebugLogger(_FRAME_ROOT)
        except Exception:
            _logger = None
    return _logger


def _log(msg, level=None):
    """Forward ``msg`` to the module logger if available; silent otherwise."""
    lg = _get_logger()
    if lg is None:
        return
    if level:
        lg.log(msg, level)
    else:
        lg.log(msg)


# ---------------------------------------------------------------------------
# Discovery / loading helpers
#
# The previous implementation eagerly executed every ``template_data.py``
# at startup just to read its ``TEMPLATE_NAME``, and surrounded each load
# with a sys.modules / sys.path purge dance because each template folder
# shipped its own ``template_loader.py`` whose bare imports collided in
# ``sys.modules``.
#
# The current design:
#   * The shared ``template_loader.TemplateLoader`` lives at the
#     frame-builder root. Per-template state lives on instances, so two
#     templates can never share a cached loader, and there is nothing to
#     purge from ``sys.modules`` between loads.
#   * Discovery is lazy — we AST-parse ``TEMPLATE_NAME`` so the UI can
#     populate without paying the cost of importing every template.
#   * Each registry entry holds a closure that imports + caches its
#     ``template_data.py`` on first use.
#   * Every spec returned by a template is run through
#     ``_validate_template_spec`` so malformed templates fail loudly
#     here instead of crashing deep inside the geometry pipeline.
# ---------------------------------------------------------------------------


def _read_template_name(data_path):
    """Pull ``TEMPLATE_NAME = "…"`` out of a template_data.py without exec.

    Cheap (single AST parse, no module load), and side-effect-free —
    importantly, it never instantiates a ``TemplateLoader`` so disk
    scans for sketch / phase files are deferred to first use.
    Returns ``None`` if the file can't be parsed or has no top-level
    ``TEMPLATE_NAME`` string assignment.
    """
    try:
        with open(data_path, 'r', encoding='utf-8') as f:
            tree = ast.parse(f.read(), filename=data_path)
    except Exception:
        return None
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == 'TEMPLATE_NAME':
                if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                    return node.value.value
    return None


def _load_template_module(data_path, module_name):
    """Execute ``data_path`` as a fresh module under ``module_name``.

    Stable, simple — no sys.modules purging, no sys.path swizzling. The
    loader (``template_loader.TemplateLoader``) is a stable absolute
    import name and each template_data.py owns its own loader instance,
    so cross-template collisions are no longer possible at this layer.
    """
    if module_name in sys.modules:
        del sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, data_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot build spec for {data_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _validate_template_spec(spec, folder_name):
    """Sanity-check the dict returned by ``get_template_logic``.

    Catches malformed templates at the boundary instead of letting them
    crash deep inside ``ParametricSketchBuilder`` with a confusing
    trace. Raises ``ValueError`` / ``TypeError`` with a message naming
    the offending template + sketch.
    """
    if not isinstance(spec, dict):
        raise TypeError(
            f"Template '{folder_name}': get_template_logic must return dict, "
            f"got {type(spec).__name__}")
    if not spec.get('Name'):
        raise ValueError(f"Template '{folder_name}': spec missing 'Name'")
    sketches = spec.get('Sketches')
    if not isinstance(sketches, list) or not sketches:
        raise ValueError(
            f"Template '{folder_name}': spec missing non-empty 'Sketches' list")
    for i, sk in enumerate(sketches, start=1):
        if not isinstance(sk, dict):
            raise TypeError(
                f"Template '{folder_name}': sketch index {i} is not a dict "
                f"(got {type(sk).__name__})")
        if not sk.get('Name'):
            raise ValueError(
                f"Template '{folder_name}': sketch index {i} missing 'Name'")
        if 'Blocks' not in sk:
            raise ValueError(
                f"Template '{folder_name}': sketch '{sk.get('Name')}' "
                f"(index {i}) missing 'Blocks'")
        if not isinstance(sk['Blocks'], list):
            raise TypeError(
                f"Template '{folder_name}': sketch '{sk.get('Name')}' "
                f"'Blocks' must be list, got {type(sk['Blocks']).__name__}")


def _make_lazy_loader(folder_name, data_path):
    """Build a ``loader(ui_data)`` closure that imports on first call.

    The closure caches the imported template_data module so repeated
    builds within a single Fusion run skip the import. Each invocation
    re-runs ``get_template_logic`` (so ui_data is honored) and revalidates
    the returned spec.
    """
    module_name = f"fb_template_{folder_name}_template_data"
    cached = {'module': None}

    def loader(ui_data=None):
        if cached['module'] is None:
            cached['module'] = _load_template_module(data_path, module_name)
        mod = cached['module']
        try:
            spec = mod.get_template_logic(ui_data)
        except TypeError:
            spec = mod.get_template_logic()
        _validate_template_spec(spec, folder_name)
        return spec

    return loader


def _discover_template_entries():
    """Build the registry without importing any template_data.py.

    Reads ``TEMPLATE_NAME`` via AST, defers the actual import to the
    closure returned by ``_make_lazy_loader``. Folders missing
    ``template_data.py`` or ``TEMPLATE_NAME`` are skipped with a log
    warning (so a typo doesn't silently drop a template).
    """
    entries = []
    if not os.path.isdir(_SKETCHES_ROOT):
        return entries

    _log(f"TEMPLATE DISCOVERY: scanning {_SKETCHES_ROOT}")

    for folder in sorted(os.listdir(_SKETCHES_ROOT)):
        folder_path = os.path.join(_SKETCHES_ROOT, folder)
        if not os.path.isdir(folder_path) or not folder.startswith('template_'):
            continue

        data_path = os.path.join(folder_path, 'template_data.py')
        if not os.path.isfile(data_path):
            _log(f"Template '{folder}' skipped — no template_data.py", "WARNING")
            continue

        style_name = _read_template_name(data_path)
        if not style_name:
            _log(
                f"Template '{folder}' skipped — TEMPLATE_NAME not found "
                f"in {data_path}", "WARNING")
            continue

        template_index = folder.split('_', 1)[1] if '_' in folder else folder
        prefix = f"T{template_index}" if template_index.isdigit() else folder.upper()

        entries.append({
            'id': folder,
            'style_name': style_name,
            'loader': _make_lazy_loader(folder, data_path),
            'prefix': prefix,
            'folder': folder,
        })

        _log(
            f"TEMPLATE DISCOVERED: {folder} -> '{style_name}' "
            f"(prefix={prefix}, lazy)")

    return entries


def _ensure_template_registry():
    global _TEMPLATE_REGISTRY
    if _TEMPLATE_REGISTRY is None:
        _TEMPLATE_REGISTRY = _discover_template_entries()
    return _TEMPLATE_REGISTRY


def reset_registry():
    """Drop the cached registry so the next call re-scans disk.

    Useful for test setups and for the rare case where a template is
    added to disk during a Fusion session without restart.
    """
    global _TEMPLATE_REGISTRY
    _TEMPLATE_REGISTRY = None


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def resolve_template(style_id, ui_data=None):
    """Return ``(template_spec, prefix)`` for ``style_id``. Raises on unknown id.

    Match strategy (strict — no fuzzy substring):
      1. Exact folder id (``template_1``).
      2. Exact full name (``"Template 1 - Hourglass"``).
      3. Case-insensitive base label (``"template 1"``, the part before
         the first ``" - "``).

    Substring matching was removed because it caused false positives
    when one template's name happened to be a substring of another's,
    and because the UI always passes a precise identifier.
    """
    registry = _ensure_template_registry()
    normalized = str(style_id or '').strip()
    registry_names = [f"{e['id']} ({e['style_name']})" for e in registry]
    _log(
        f"TEMPLATE RESOLVE: trying style_id='{style_id}' "
        f"with registry={registry_names}")

    for entry in registry:
        candidate_id = entry['id']
        candidate_name = entry['style_name']
        candidate_label = (candidate_name.split(' - ')[0]
                           if ' - ' in candidate_name else candidate_name)

        if normalized == candidate_id:
            _log(
                f"TEMPLATE RESOLVE: exact id match '{style_id}' -> "
                f"'{candidate_name}' (folder={entry['folder']})")
            return entry['loader'](ui_data), entry['prefix']
        if normalized == candidate_name:
            _log(
                f"TEMPLATE RESOLVE: exact name match '{style_id}' -> "
                f"'{candidate_name}' (folder={entry['folder']})")
            return entry['loader'](ui_data), entry['prefix']
        if normalized.lower() == candidate_label.lower():
            _log(
                f"TEMPLATE RESOLVE: base label match '{style_id}' -> "
                f"'{candidate_name}' (folder={entry['folder']})")
            return entry['loader'](ui_data), entry['prefix']

    raise ValueError(
        f"Unknown style_id: '{style_id}'. Registered: {registry_names}")


def get_available_templates():
    """Return the list of available templates for UI population."""
    registry = _ensure_template_registry()
    templates = [{"label": entry["style_name"], "value": entry["id"]}
                 for entry in registry]
    _log(f"TEMPLATE LIST GENERATED: {[t['value'] for t in templates]}")
    return templates


def get_template_spec(style_id="Template 1"):
    """Module-level wrapper so callers can fetch a spec by id."""
    spec, _ = resolve_template(style_id)
    return spec
