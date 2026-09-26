"""
param_ownership.py — STALE-PARAMS R4 item 3: the Bspline-group cleanup pass.

Ruling 3 (advisor + Fred, 2026-09-26): a candidate is a user parameter whose NAME is in the
declared registry (board or lattice, `fb_engine.parameter_schema.ParameterSchema`) AND is not
one of the names THIS Send's payload is about to create-or-update AND has no dependents.
Ruling 5 ("take over existing params"): registry membership by NAME is the whole ownership test —
whether or not the parameter carries the `Bspline.owner` attribute (that attribute is still written
on every touch by `_sync_user_parameters` / `_sync_manifest_parameters`, but this pass no longer
GATES on it; it only reports, in `adopted`, which candidates it found unstamped). An unregistered
name is never touched, never stamped, never deleted, whatever it's called.

Ruling 4: the reference guard is Fusion's OWN `Parameter.dependentParameters` — a real ObjectCollection
on the base `Parameter` class that lists every OTHER parameter/dimension expression that names this
one — and nothing else (no hand-rolled expression-text scan). This is flagged "verify live" in
STALE-PARAMS-DESIGN.md's own R4-rulings section: nobody has run this against a live Fusion session
in this turn (NO FUSION is the standing rule for reg-addin turns).

Pure / testable: this module never imports `adsk` and takes plain Python objects (a `user_params`
ITERABLE — `for p in design.userParameters` is the established pattern elsewhere in this repo, see
`CAM-builder/cam_engine/mm_builder.py:284`, `fusion-exporter/exporter.py:226` — never `.item(i)`
indexing) so a fake collection in a test needs nothing but `__iter__`.
"""
from fb_engine.parameter_schema import ParameterSchema


def _is_registered(name):
    return ParameterSchema.is_board_owned(name) or ParameterSchema.is_lattice_owned(name)


def _has_bspline_owner_tag(param):
    try:
        attrs = getattr(param, "attributes", None)
        if attrs is None:
            return False
        tag = attrs.itemByName("Bspline", "owner")
        return bool(tag and tag.value)
    except Exception:
        return False


def _dependents(param):
    """The live count of Parameter.dependentParameters, or None if the object doesn't expose one
    (never treated as "0 dependents" — a caller that can't check must not delete)."""
    coll = getattr(param, "dependentParameters", None)
    if coll is None:
        return None
    count = getattr(coll, "count", None)
    if count is not None:
        return int(count)
    try:
        return len(coll)
    except TypeError:
        return None


def compute_stale_params(user_params, payload_names, logger=None):
    """Compute the cleanup decision for every registered parameter NOT in `payload_names`.

    `user_params`: an iterable of parameter-like objects (`.name`, `.attributes`,
    `.dependentParameters`, `.deleteMe()`).
    `payload_names`: an iterable of the names THIS Send is about to create-or-update (board's
    `param_map` keys + the lattice manifest's own parameter names) — these are never candidates,
    registered or not, since they're about to be synced, not stale.
    Returns `{"deleted": [...], "kept_referenced": [{"name", "reason"}], "adopted": [...],
    "failed": [{"name", "error"}]}` — every key always present, `deleted`/`adopted` are name lists.
    `deleteMe()` is called ONLY on a candidate that clears the reference guard; a parameter this
    function cannot prove is unreferenced (no `dependentParameters` on the object at all) is treated
    the same as "has dependents" — kept, never deleted, logged with an explicit reason so a caller
    can tell "definitely referenced" apart from "couldn't check" if it ever matters.
    """
    log = logger.log if logger else (lambda *a, **k: None)
    payload = set(payload_names or ())
    result = {"deleted": [], "kept_referenced": [], "adopted": [], "failed": []}

    for param in user_params or ():
        name = getattr(param, "name", None)
        if not name or not _is_registered(name) or name in payload:
            continue  # unregistered, or this Send is about to touch it — never a candidate

        was_stamped = _has_bspline_owner_tag(param)
        if not was_stamped:
            result["adopted"].append(name)  # ruling 5: registered name = ours, stamped or not

        dep_count = _dependents(param)
        if dep_count is None:
            result["kept_referenced"].append(
                {"name": name, "reason": "dependentParameters unavailable on this object — kept, not checked"})
            log(f"STALE PARAM KEPT (unchecked): {name} — no dependentParameters on this object", "WARNING")
            continue
        if dep_count > 0:
            result["kept_referenced"].append(
                {"name": name, "reason": f"referenced by {dep_count} dependentParameters"})
            log(f"STALE PARAM KEPT (referenced): {name} — {dep_count} dependentParameters", "DEBUG")
            continue

        try:
            ok = param.deleteMe()
            if ok is False:
                result["failed"].append({"name": name, "error": "deleteMe() returned False"})
                log(f"STALE PARAM DELETE FAILED: {name} — deleteMe() returned False", "WARNING")
            else:
                result["deleted"].append(name)
                log(f"STALE PARAM DELETED: {name}", "DEBUG")
        except Exception as e:
            result["failed"].append({"name": name, "error": str(e)})
            log(f"STALE PARAM DELETE FAILED: {name}: {e}", "WARNING")

    return result
