"""Low-level entity unwrapping / identity helpers.

These two tiny helpers used to live in ``template_payload``. They're split
out so ``template_payload`` and ``relation_hints`` can both rely on them
without forming a circular import — ``relation_hints`` needs them for its
constraint / dimension target walk, and ``template_payload`` needs them
both for its own shape-hint builders and for re-export to older callers
like ``rename_selection`` that do ``from template_payload import _get_native``.

Nothing in here is Fusion-version specific. ``_get_native`` unwraps the
``nativeObject`` proxy that Fusion hands back for entities fetched through
browser / timeline / selection APIs; ``_same_entity`` is a best-effort
identity check that's safe to call on API proxies that may not be
``is``-identical across fetches of the same underlying object.
"""


def _get_native(ent):
    """Return the underlying native entity if ``ent`` is an API proxy.

    Fusion selections hand back proxy objects whose ``nativeObject``
    attribute points at the ``real`` entity in the document graph. Calling
    this before any downstream attribute walk keeps us comparing the same
    object that other code paths would reach — otherwise two proxies for
    the same entity can fail ``is`` and even ``==`` checks.
    """
    try:
        if hasattr(ent, 'nativeObject') and ent.nativeObject:
            return ent.nativeObject
    except Exception:
        pass
    return ent


def _same_entity(a, b):
    """Best-effort identity check for Fusion proxies and plain test objects.

    Fusion proxies may not be ``is``-identical across fetches of the same
    underlying entity but should compare equal via ``==`` (which delegates
    to the internal entity token). The broad ``except`` keeps us from
    ever crashing on a stale proxy whose ``==`` handler throws.
    """
    if a is b:
        return True
    try:
        return a == b
    except Exception:
        return False
