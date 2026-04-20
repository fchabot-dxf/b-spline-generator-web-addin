"""Shared safety canary for CoincidentConstraint proxies.

Fusion exposes two kinds of CoincidentConstraint proxies with
dangerously different contracts:

* **Iterated proxy** — the one you get from
  ``sketch.geometricConstraints.item(i)`` or from iterating the sketch's
  constraint collection. Reading ``.entityToken``, ``.point``, and
  ``.entity`` on it works cleanly.

* **Picked proxy** — the one you get from ``ui.activeSelections.item(i).entity``
  when the user clicked a CC glyph directly. Reading ``.point`` or
  ``.entity`` on it raises ``"vector too long"`` at the Python level
  (so the call appears to fail cleanly) but poisons Fusion's internal
  pointer graph. ~4 seconds later the next repaint dereferences the
  corrupted pointer and native-AVs the host process. There is no
  Python recovery path for a native AV — the only safe option is not
  to make the read.

The two forms are indistinguishable by type alone, so we use
``entityToken`` as the canary: iterated proxies return a readable
token; picked proxies raise ``InternalValidationError`` at
``Utils::findObjectPath``. Reading the token itself is safe on both
(it's what Fusion uses to identify the proxy, and doesn't walk the
corrupted slots), so we can use it to decide whether the HAZARDOUS
reads below (``.point`` / ``.entity``) are safe.

Coincidence is now expressed via ENTITY selection
(``coincidence_clusters.detect_coincidence_pairs``) rather than by
picking CC glyphs directly, so the old iterated-proxy swap pre-pass
(``coincident_hint.find_matching_coincident_constraint``) has been
removed. Picked CC proxies still need refusing defensively — a user
can always click a CC glyph by accident — so both sides of the
pipeline run this canary independently:

* ``ownership_gate.is_framebuilder_owned`` — refuses the CC as not
  owned rather than probing its targets.

* ``relation_hints._constraint_targets`` — returns an empty target
  list; the emitter falls through to a ``/* targets */`` placeholder
  that the user can hand-edit.

Both callers had essentially-identical copies of this check before
consolidation; keeping them as separate sites (with different log
prefixes) made it too easy for a future edit to touch one and forget
the other.
"""

from detection_log import _log_detection


def is_iterated_cc_proxy(ent, log_prefix='cc-canary'):
    """Return True if ``ent`` is a CoincidentConstraint proxy that is
    safe to read ``.point`` / ``.entity`` on (i.e. an iterated proxy,
    not a picked one). Returns False on a picked proxy, on any
    non-CC entity, and on any read failure.

    Callers pass their own ``log_prefix`` (e.g. ``"gate-cc"`` or
    ``"probe-cc"``) so a crash-log tail can distinguish which site
    triggered the canary. Leaving the default means the line shows
    ``[cc-canary]`` — useful for one-off diagnostics.

    The ``entityToken`` read itself is the whole test: if it returns
    a truthy value without raising, this is an iterated proxy. If it
    raises or returns empty, either this isn't a CC or the swap pre-
    pass failed to substitute an iterated one. In both "not-iterated"
    cases, refusing to probe is the correct conservative answer.
    """
    try:
        tok = getattr(ent, 'entityToken', None)
        if not tok:
            _log_detection(
                None,
                f"[{log_prefix}]     entityToken empty -> "
                "picked proxy (swap failed) or non-CC entity",
            )
            return False
    except Exception as e:
        _log_detection(
            None,
            f"[{log_prefix}]     entityToken raised "
            f"{type(e).__name__}: {e} -> "
            "picked proxy (swap failed)",
        )
        return False
    _log_detection(
        None,
        f"[{log_prefix}]     entityToken readable -> "
        "iterated proxy, safe to probe targets",
    )
    return True
