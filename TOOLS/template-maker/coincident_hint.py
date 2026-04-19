"""Probe-only scaffold for CoincidentConstraint support.

Companion to ``offset_hint.py``. No behavior change yet — this module
exists purely to answer the evidence-gap question:

    Direct-pick CC ``.point`` / ``.entity`` are verified native-AV
    hazards. Is the SAME slot on an ITERATED proxy (out of
    ``sketch.geometricConstraints``) also fatal, or does iteration
    produce a different proxy type that allows the read?

OffsetConstraint's iterated proxy lets ``.parentCurves`` / ``.childCurves``
through cleanly. The bet this probe tests: Coincident's iterated proxy
may similarly admit ``.point`` / ``.entity``. If it does, the real
Coincident handler can mirror ``find_owning_offset_constraint`` —
walk the sketch's constraints, match the picked CC by identity,
read targets off the iterated proxy, and feed the existing gate /
payload pipeline.

If iterated reads are ALSO fatal, the last ``[cc-*]`` marker written
to disk before Fusion dies identifies the exact step that was the AV
trigger, and we switch tactics (likely: refuse Coincident picks with
a clear status-bar message until Fusion exposes a safe API).

Diagnostic channel — ``[cc-*]`` markers on the same fsync-per-write
log used by ``[bp-*]`` / ``[gate-*]`` / ``[foc-*]`` so cross-referencing
timestamps is trivial:

    [cc-enter]   pick arrived, type + token (safe reads only)
    [cc-sketch]  owning sketch resolution (NOT via picked_cc.parentSketch
                 — that slot is a verified hazard on CC. Uses active edit
                 object instead: directly picking a CC inside a sketch
                 means the edit-context IS the sketch, no slot touch on
                 the picked proxy needed.)
    [cc-iter]    walking sketch.geometricConstraints
    [cc-match]   per-iter: _same_entity(iter_cc, picked_cc)
    [cc-slot]    per-iter CC: .point / .entity probe (THE QUESTION)
    [cc-exit]    done

Last line before Fusion dies tells us which step was fatal.
"""

from detection_log import _log_detection
from entity_util import _same_entity


def _safe_getattr(obj, name):
    """Mirror of ``offset_hint._safe_getattr``.

    Fusion proxies can raise bare ``RuntimeError`` on subtype-refused
    slots (not ``AttributeError``), so stock ``getattr(default=...)``
    doesn't catch them. Returns ``None`` on any exception so the walk
    continues past a poisoned slot instead of imploding.
    """
    try:
        return getattr(obj, name, None)
    except Exception:
        return None


def _active_sketch(app):
    """Resolve the sketch owning the picked CoincidentConstraint WITHOUT
    touching ``.parentSketch`` on the picked proxy.

    ``picked_cc.parentSketch`` is a verified delayed-native-AV site on
    CC picks (see 20:58:47 repro — last durable marker before Fusion
    died was exactly ``[foc-probe] parentSketch`` on a CC). Directly
    picking a constraint requires being inside its sketch, so the
    ``Design.activeEditObject`` IS the owning sketch. Read it from
    there and skip the hazardous slot entirely.
    """
    try:
        import adsk.fusion  # deferred — this file imports fine outside Fusion
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        if design is None:
            return None
        active = design.activeEditObject
        if active is None:
            return None
        if getattr(active, 'objectType', '') == adsk.fusion.Sketch.classType():
            return active
    except Exception:
        return None
    return None


def probe_coincident_constraint(picked_cc):
    """Pure-log evidence gatherer. No return value, no side effects on
    the payload pipeline.

    Does NOT touch ``.point`` / ``.entity`` / ``.parentSketch`` on the
    picked proxy. Walks the active sketch's constraint list and probes
    the target slots ONLY on iterated proxies.
    """
    _log_detection(None, f"[cc-enter]   type={type(picked_cc).__name__}")

    try:
        token = getattr(picked_cc, 'entityToken', None)
        _log_detection(None, f"[cc-enter]   token={'Some' if token else 'None'}")
    except Exception as e:
        _log_detection(
            None,
            f"[cc-enter]   token raised {type(e).__name__}: {e}",
        )

    # nativeObject probe — the picked-proxy entityToken is unreachable
    # (Utils::findObjectPath fails at the C++ layer), so _same_entity's
    # ==-based comparison can never match. If the picked CC's
    # nativeObject IS readable and returns a stable singleton, we can
    # match iterated CCs via Python ``is`` on their .nativeObject —
    # bypassing entityToken entirely. Log id() so we can compare it
    # against iterated-CC native ids later in the run.
    picked_native = _safe_getattr(picked_cc, 'nativeObject')
    if picked_native is None:
        _log_detection(None, "[cc-enter]   nativeObject=None")
        picked_native_id = None
    else:
        picked_native_id = id(picked_native)
        _log_detection(
            None,
            f"[cc-enter]   nativeObject type={type(picked_native).__name__} "
            f"py_id=0x{picked_native_id:x}",
        )

    # Enumerate what IS readable on the picked proxy — most previous
    # probes were "does X work" one-at-a-time. This is the shotgun:
    # dir() shows every Python-visible attribute name, and a short list
    # of specific slots we haven't tried individually yet. All guarded;
    # any read that raises is logged and the walk continues.
    try:
        attr_names = sorted(set(dir(picked_cc)))
        public = [n for n in attr_names if not n.startswith('_')]
        _log_detection(
            None,
            f"[cc-diag]    dir.count={len(public)} sample={public[:12]}",
        )
    except Exception as e:
        _log_detection(
            None,
            f"[cc-diag]    dir raised {type(e).__name__}: {e}",
        )
    for slot in ('isValid', 'assemblyContext', 'objectType', 'classType'):
        try:
            v = getattr(picked_cc, slot, '<missing>')
            if callable(v):
                try:
                    v = v()
                except Exception as e:
                    v = f'<call raised {type(e).__name__}: {e}>'
            _log_detection(None, f"[cc-diag]    {slot}={v!r}"[:200])
        except Exception as e:
            _log_detection(
                None,
                f"[cc-diag]    {slot} raised {type(e).__name__}: {e}",
            )

    # Settling attempt — use adsk.doEvents() module-level helper, NOT
    # Application.doEvents() (that signature doesn't exist; previous
    # run confirmed AttributeError). Likely moot now that the Selection
    # .point probe has opened the matching path, but keeping the probe
    # so we have evidence of whether doEvents would have helped either.
    try:
        import adsk
        adsk.doEvents()
        _log_detection(None, "[cc-diag]    adsk.doEvents() ran")
        try:
            retry_token = getattr(picked_cc, 'entityToken', None)
            if retry_token:
                _log_detection(
                    None,
                    f"[cc-diag]    post-doEvents token={retry_token[:24]}...",
                )
            else:
                _log_detection(None, "[cc-diag]    post-doEvents token=None")
        except Exception as e:
            _log_detection(
                None,
                f"[cc-diag]    post-doEvents token raised "
                f"{type(e).__name__}: {e}",
            )
    except Exception as e:
        _log_detection(
            None,
            f"[cc-diag]    adsk.doEvents raised {type(e).__name__}: {e}",
        )

    # Selection hit-point capture — THIS is the match key we were
    # missing. Previous probe revealed ``selection.dir`` includes
    # ``point``: Fusion records the 3D hit-point where the user clicked
    # (world-space Point3D). The CoincidentConstraint glyph is rendered
    # right at the coincidence anchor (c.point.worldGeometry), so
    # distance from sel.point to each iterated CC's anchor identifies
    # the picked one — no entityToken, no nativeObject needed.
    #
    # Stashed on the outer scope so the iteration loop below can
    # compute per-CC distances and log them.
    sel_point = None
    try:
        import adsk.core as _acore
        ui = _acore.Application.get().userInterface
        sels = ui.activeSelections
        if sels is None or sels.count == 0:
            _log_detection(None, "[cc-diag]    no activeSelections")
        else:
            sel = sels.item(0)
            sel_point = _safe_getattr(sel, 'point')
            if sel_point is None:
                _log_detection(None, "[cc-diag]    sel.point=None")
            else:
                sp_type = type(sel_point).__name__
                sp_x = _safe_getattr(sel_point, 'x')
                sp_y = _safe_getattr(sel_point, 'y')
                sp_z = _safe_getattr(sel_point, 'z')
                _log_detection(
                    None,
                    f"[cc-diag]    sel.point type={sp_type} "
                    f"xyz=({sp_x}, {sp_y}, {sp_z})",
                )
    except Exception as e:
        _log_detection(
            None,
            f"[cc-diag]    sel.point probe raised "
            f"{type(e).__name__}: {e}",
        )

    try:
        import adsk.core
        app = adsk.core.Application.get()
    except Exception as e:
        _log_detection(None, f"[cc-sketch]  adsk.core unavailable: {e}")
        return

    sketch = _active_sketch(app)
    if sketch is None:
        _log_detection(
            None,
            "[cc-sketch]  activeEditObject is not a Sketch -> abort probe",
        )
        return
    _log_detection(
        None,
        f"[cc-sketch]  name={getattr(sketch, 'name', '<?>')}",
    )

    constraints = _safe_getattr(sketch, 'geometricConstraints')
    if constraints is None:
        _log_detection(None, "[cc-iter]    no geometricConstraints -> abort")
        return

    try:
        n = constraints.count
    except Exception as e:
        _log_detection(
            None,
            f"[cc-iter]    count raised {type(e).__name__}: {e}",
        )
        return
    _log_detection(None, f"[cc-iter]    start n={n}")

    for i in range(n):
        try:
            c = constraints.item(i)
        except Exception as e:
            _log_detection(
                None,
                f"[cc-iter]    [{i}] item() raised {type(e).__name__}: {e}",
            )
            continue

        ot = _safe_getattr(c, 'objectType') or ''
        short = ot.split('::')[-1]
        if short != 'CoincidentConstraint':
            continue
        _log_detection(None, f"[cc-iter]    [{i}] CoincidentConstraint")

        # Identity match — three strategies logged in parallel so the
        # next run shows which (if any) can successfully identify the
        # picked CC among the iterated ones.
        #
        # A. _same_entity: entityToken-backed ==. KNOWN to fail
        #    universally because picked_cc.entityToken throws
        #    InternalValidationError (Utils::findObjectPath).
        # B. iter-side entityToken: read .entityToken on the iterated
        #    proxy. If readable, log first 16 chars so a human can
        #    compare tokens across the 8 CCs. This also lets us see
        #    whether the picked_cc token MIGHT be readable via some
        #    other path (e.g. delayed).
        # C. nativeObject py-identity: compare picked_native (stashed
        #    above) to iter_cc.nativeObject via Python ``is``. Doesn't
        #    touch entityToken at all. If Fusion hands out stable
        #    native singletons for a given underlying object, this
        #    succeeds regardless of which proxy you started from.
        try:
            is_match = _same_entity(c, picked_cc)
        except Exception as e:
            _log_detection(
                None,
                f"[cc-match]   [{i}] _same_entity raised "
                f"{type(e).__name__}: {e}",
            )
            is_match = False
        _log_detection(
            None,
            f"[cc-match]   [{i}] _same_entity={is_match}",
        )

        try:
            iter_token = getattr(c, 'entityToken', None)
            # Log FULL token — preview at 16 chars hit the shared
            # document/sketch prefix and every CC looked identical.
            # The per-constraint bytes are further in, so we need the
            # whole string to confirm tokens are actually unique
            # (and to leave room for a fingerprint strategy later).
            tok_len = len(iter_token) if iter_token else 0
            _log_detection(
                None,
                f"[cc-match]   [{i}] iter_token len={tok_len} "
                f"full={iter_token!r}",
            )
        except Exception as e:
            _log_detection(
                None,
                f"[cc-match]   [{i}] iter_token raised "
                f"{type(e).__name__}: {e}",
            )

        iter_native = _safe_getattr(c, 'nativeObject')
        if iter_native is None:
            _log_detection(None, f"[cc-match]   [{i}] iter_native=None")
        else:
            iter_native_id = id(iter_native)
            by_is = (
                picked_native is not None
                and iter_native is picked_native
            )
            _log_detection(
                None,
                f"[cc-match]   [{i}] iter_native "
                f"py_id=0x{iter_native_id:x} is_picked_native={by_is}",
            )

        # THE QUESTION: is the iterated proxy's .point / .entity safe?
        # _safe_getattr catches Python-level exceptions; it CANNOT save
        # us from a native-AV at the C++ layer. If Fusion dies here,
        # the marker immediately above is the last durable breadcrumb
        # and tells us "iter .point IS a hazard — bail on the iterated-
        # read approach entirely."
        _log_detection(None, f"[cc-slot]    [{i}] .point about to read")
        pt = _safe_getattr(c, 'point')
        pt_type = type(pt).__name__ if pt is not None else 'None'
        _log_detection(None, f"[cc-slot]    [{i}] .point -> {pt_type}")

        # Distance-match probe — the one that should actually identify
        # the picked CC. sel_point is the world-space Point3D where the
        # user clicked (captured from activeSelections.item(0).point
        # above). Each iterated CC's anchor is c.point.worldGeometry
        # (Point3D, world coords). The clicked CC's glyph renders AT
        # the anchor, so its distance should be near zero (well under
        # 1 mm = 0.1 cm in Fusion units), while the other N-1 CCs show
        # the actual geometric distance between their anchors and the
        # click position. Cheapest possible identity key — no tokens,
        # no native lookups, no internal Fusion machinery that can AV.
        if pt is not None and sel_point is not None:
            try:
                world_pt = _safe_getattr(pt, 'worldGeometry')
                if world_pt is None:
                    _log_detection(
                        None,
                        f"[cc-dist]    [{i}] worldGeometry=None",
                    )
                else:
                    wx = _safe_getattr(world_pt, 'x')
                    wy = _safe_getattr(world_pt, 'y')
                    wz = _safe_getattr(world_pt, 'z')
                    # distanceTo is a Point3D method — if it raises,
                    # fall back to a manual sqrt so we still get a
                    # number to compare. sel_point x/y/z were read
                    # earlier with _safe_getattr so they might be None
                    # if that probe failed; guard the math explicitly.
                    dist = None
                    try:
                        dist = sel_point.distanceTo(world_pt)
                    except Exception as e:
                        _log_detection(
                            None,
                            f"[cc-dist]    [{i}] distanceTo raised "
                            f"{type(e).__name__}: {e}",
                        )
                        try:
                            sx = _safe_getattr(sel_point, 'x')
                            sy = _safe_getattr(sel_point, 'y')
                            sz = _safe_getattr(sel_point, 'z')
                            if None not in (sx, sy, sz, wx, wy, wz):
                                from math import sqrt
                                dx = sx - wx
                                dy = sy - wy
                                dz = sz - wz
                                dist = sqrt(dx*dx + dy*dy + dz*dz)
                        except Exception as e2:
                            _log_detection(
                                None,
                                f"[cc-dist]    [{i}] manual dist raised "
                                f"{type(e2).__name__}: {e2}",
                            )
                    _log_detection(
                        None,
                        f"[cc-dist]    [{i}] dist={dist} "
                        f"anchor=({wx}, {wy}, {wz})",
                    )
            except Exception as e:
                _log_detection(
                    None,
                    f"[cc-dist]    [{i}] probe raised "
                    f"{type(e).__name__}: {e}",
                )
        else:
            _log_detection(
                None,
                f"[cc-dist]    [{i}] skip pt={pt is not None} "
                f"sel_point={sel_point is not None}",
            )

        _log_detection(None, f"[cc-slot]    [{i}] .entity about to read")
        en = _safe_getattr(c, 'entity')
        en_type = type(en).__name__ if en is not None else 'None'
        _log_detection(None, f"[cc-slot]    [{i}] .entity -> {en_type}")

    _log_detection(None, "[cc-exit]    done")


# ---------------------------------------------------------------------------
# REAL HANDLER — used by template_payload_builder._expand_offset_picks to
# swap a direct-pick CoincidentConstraint proxy for a safe iterated-proxy
# equivalent. The probe above stays in place as the evidence-gathering
# channel; this function is the load-bearing path. Mirrors the pattern
# of ``offset_hint.find_owning_offset_constraint`` — reverse-lookup via
# ``sketch.geometricConstraints``, then hand back the iterated proxy so
# downstream code can safely read ``.point`` / ``.entity``.
# ---------------------------------------------------------------------------

# Confidence threshold for the distance match. The winning CC must be at
# LEAST 2× closer to the click hit-point than the runner-up, otherwise
# the pick is considered ambiguous (two glyphs visually overlapping at
# the user's zoom level) and we refuse to match rather than silently
# emit the wrong constraint. Concrete numbers from the 09:35:30 repro:
# winner 0.377 cm vs runner-up 8.21 cm → ratio 0.046 — way under 0.5, so
# this threshold passes the validated case with massive margin while
# still catching tightly-stacked CC glyphs.
_AMBIGUITY_RATIO = 0.5


def _get_selection_hit_point():
    """Return the world-space Point3D where the user clicked, or ``None``.

    Fusion records the click hit-point on the Selection wrapper (NOT on
    the selected entity) — ``activeSelections.item(0).point`` gives a
    real Point3D, which is the missing piece that makes iteration-side
    identity matching possible. If there's no active selection (palette
    re-entry, programmatic call, etc.) we return ``None`` and the caller
    falls back to the no-match path.
    """
    try:
        import adsk.core as _acore
        app = _acore.Application.get()
        ui = app.userInterface
        sels = ui.activeSelections
        if sels is None or sels.count == 0:
            return None
        sel = sels.item(0)
        return _safe_getattr(sel, 'point')
    except Exception:
        return None


def find_matching_coincident_constraint(picked_cc):
    """Return the iterated-proxy CoincidentConstraint matching ``picked_cc``.

    The picked-proxy path is a dead end: ``entityToken`` throws,
    ``nativeObject`` returns None, ``.point`` / ``.entity`` are
    native-AV hazards. But:

    * ``sketch.geometricConstraints`` returns proxies whose slots ARE safe.
    * Fusion exposes the click hit-point via ``activeSelections.item(0).point``.
    * CC glyphs render at the constraint's anchor (``c.point.worldGeometry``).

    So the match is: walk the sketch's constraint list, compute the
    distance from the click hit-point to each CC's anchor, return the
    closest. Ambiguous matches (winner not decisively closer than
    runner-up) return ``None`` — the caller keeps the picked proxy
    and the payload flow treats it as unowned, which surfaces as a
    "please zoom in or use the Coincident button" hint in the palette.

    Returns ``None`` if:
      * no sketch active (shouldn't happen — directly picking a CC
        requires being inside its sketch);
      * no active selection hit-point (no UI context);
      * no CC in the sketch matches under the confidence threshold.

    Callers in ``template_payload_builder._expand_offset_picks`` use
    the return value to decide whether to swap the picked proxy for
    the iterated one or leave it alone.
    """
    _log_detection(None, "[cc-find]    find_matching_coincident_constraint start")

    sel_point = _get_selection_hit_point()
    if sel_point is None:
        _log_detection(None, "[cc-find]    no sel.point -> abort")
        return None

    try:
        import adsk.core
        app = adsk.core.Application.get()
    except Exception as e:
        _log_detection(None, f"[cc-find]    adsk.core unavailable: {e}")
        return None

    sketch = _active_sketch(app)
    if sketch is None:
        _log_detection(None, "[cc-find]    activeEditObject not a Sketch -> abort")
        return None

    constraints = _safe_getattr(sketch, 'geometricConstraints')
    if constraints is None:
        _log_detection(None, "[cc-find]    no geometricConstraints -> abort")
        return None

    try:
        n = constraints.count
    except Exception as e:
        _log_detection(
            None,
            f"[cc-find]    count raised {type(e).__name__}: {e}",
        )
        return None

    # Scan pass — record (distance, iter_cc) for every CC in the sketch.
    # Use a list rather than tracking best+second inline so the ambiguity
    # check is explicit and easy to reason about. N is small (dozens at
    # most; the test sketch had 16) so the extra allocation is free.
    scored = []
    for i in range(n):
        try:
            c = constraints.item(i)
        except Exception:
            continue
        ot = _safe_getattr(c, 'objectType') or ''
        if ot.split('::')[-1] != 'CoincidentConstraint':
            continue
        pt = _safe_getattr(c, 'point')
        if pt is None:
            continue
        world_pt = _safe_getattr(pt, 'worldGeometry')
        if world_pt is None:
            continue
        try:
            dist = sel_point.distanceTo(world_pt)
        except Exception:
            continue
        scored.append((dist, i, c))

    if not scored:
        _log_detection(None, "[cc-find]    no CC matched -> None")
        return None

    scored.sort(key=lambda t: t[0])
    best_dist, best_idx, best_cc = scored[0]

    # Ambiguity guard — one-CC case passes unconditionally (there's
    # nothing to confuse it with), multi-CC case requires the winner
    # to be meaningfully closer than the runner-up. Threshold is
    # relative (ratio) not absolute (cm) because distances scale with
    # zoom-induced click accuracy; a relative test self-calibrates.
    if len(scored) >= 2:
        second_dist = scored[1][0]
        # Handle the degenerate case where two CCs are at literally
        # identical coords (stacked points) — ratio math would divide
        # by a near-zero number or produce a meaningless result.
        if second_dist <= 1e-9:
            _log_detection(
                None,
                f"[cc-find]    winner=[{best_idx}] dist={best_dist} "
                f"runner-up dist={second_dist} (stacked) -> ambiguous",
            )
            return None
        ratio = best_dist / second_dist
        if ratio > _AMBIGUITY_RATIO:
            _log_detection(
                None,
                f"[cc-find]    winner=[{best_idx}] dist={best_dist} "
                f"runner-up dist={second_dist} ratio={ratio:.3f} "
                f"> {_AMBIGUITY_RATIO} -> ambiguous",
            )
            return None
        _log_detection(
            None,
            f"[cc-find]    winner=[{best_idx}] dist={best_dist} "
            f"runner-up dist={second_dist} ratio={ratio:.3f} -> match",
        )
    else:
        _log_detection(
            None,
            f"[cc-find]    winner=[{best_idx}] dist={best_dist} "
            "(only CC in sketch) -> match",
        )

    return best_cc


def describe_coincident_targets(iter_cc):
    """Return a ``(point_name, entity_name)`` string tuple for label rendering.

    Intended to be called on an iterated-proxy CoincidentConstraint (the
    return value of ``find_matching_coincident_constraint``). Reads
    ``.point`` and ``.entity`` and resolves each to its FrameBuilder
    name, using the curve-role-ID machinery in ``relation_hints`` where
    applicable so line endpoints render as ``horn_TL:E`` instead of a
    generic ``SketchPoint`` label.

    Returns ``('<unknown>', '<unknown>')`` on any read failure —
    caller uses the result purely for the items-list label, never
    for semantic decisions. Exists so the palette can show
    ``Coincident: horn_TL:E ↔ horn_BR:S`` at a glance instead of a
    generic ``CoincidentConstraint_1``.

    Safety: before touching ``.point`` / ``.entity`` we do the same
    entityToken pre-flight as ``ownership_gate.is_framebuilder_owned``.
    The direct-pick CC proxy has readable ``entityToken`` -> False
    (throws InternalValidationError), while iterated proxies have
    readable tokens. If the canary fails we bail with ``<unknown>``
    rather than touching the hazardous slots — defense in depth for
    any call site that might reach this function without having gone
    through the _expand_offset_picks swap pre-pass (e.g. a label
    render in ``rename_selection`` before the payload is built).
    """
    # entityToken canary — see ownership_gate [gate-cc] branch for
    # the same pattern. If this throws or returns None the proxy is
    # direct-pick (swap didn't happen) and reading .point / .entity
    # would be a delayed native-AV.
    try:
        if not getattr(iter_cc, 'entityToken', None):
            return ('<unknown>', '<unknown>')
    except Exception:
        return ('<unknown>', '<unknown>')


    # Deferred imports — relation_hints pulls in detection_log which
    # we already have, but keeping coincident_hint self-contained at
    # module-load time avoids any import-order surprises with the
    # ownership gate module.
    try:
        from relation_hints import _derive_point_role_id, _POINT_TYPES
    except Exception:
        _derive_point_role_id = None
        _POINT_TYPES = ('SketchPoint',)
    try:
        from entity_helpers import get_fb_name
    except Exception:
        def get_fb_name(_):
            return ''

    def _name_for(target):
        if target is None:
            return '<unknown>'
        try:
            t_type = _safe_getattr(target, 'objectType') or ''
            short = t_type.split('::')[-1]
            if short in _POINT_TYPES and _derive_point_role_id is not None:
                role = _derive_point_role_id(target)
                if role:
                    return role
            name = get_fb_name(target)
            if name and not name.startswith('Sketch') and not name.startswith('Vertex of'):
                return name
            return short or '<unknown>'
        except Exception:
            return '<unknown>'

    pt = _safe_getattr(iter_cc, 'point')
    en = _safe_getattr(iter_cc, 'entity')
    return (_name_for(pt), _name_for(en))
