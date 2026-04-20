"""Coincidence-cluster detection for Template Maker selection-based picks.

When the user selects entities that already share a position, they are
expressing intent to coincide those entities at phase-run time. The
seed-offset workflow deliberately starts with geometry that is not-yet-
constrained and lets the user solve it via entity selection; the point
that matters at generation time is "which entities should emit as a
Coincident pair?" — position match is the canonical answer.

Two source relationships produce pairs:

1. **Point ≡ Point** — two SketchPoints share a rounded world coord.
2. **Point on Line/Axis** — a SketchPoint's position lies on a selected
   SketchLine's infinite extension (within tol), or on an origin
   ConstructionAxis. Emitted the same way: ``addCoincident(point, line)``
   in Fusion is the point-on-line constraint, identical API shape.

Cluster sizes, for point-point:

* **Size 2** — unambiguous. Emit ``Constraints.CoincidentConstraint``
  over the pair automatically. No UI round-trip needed.

* **Size 3+** — ambiguous. The user must pick which 2 of N points
  should be paired. We surface the cluster to the palette via the
  ``ambiguousClusters`` payload field; the palette renders checkboxes
  (all unchecked by default, FIFO-bump on 3rd check) and sends the
  user's picks back via the ``clusterPicks`` bridge action. The next
  ``build_template_payload`` call reads those picks and emits the
  chosen pair as if it were a size-2 cluster.

Point-on-curve pairs always auto-emit; a union-find pass suppresses
redundant edges that would otherwise crash Fusion's constraint solver.
Example: {A, B, Y-axis} with A=B and both on Y-axis → point-point
cluster emits (A, B), then the curve pass emits exactly one of
(A, Y-axis) / (B, Y-axis). The second would create a cycle (redundant)
and is skipped by the MST rule.

Cluster ORDER matters for the emitted phase block: multi-cluster
selections must appear in the order the user picked the first point
of each cluster, not sorted by coord or entity type. We use an
``OrderedDict`` keyed on the rounded world coord so the natural
insertion order gives us first-encounter order "for free". Point-curve
pairs follow in pick order (outer loop over points, inner loop over
curves, both in selection order).

Point ORDER within a pair matters too: the user's pick order
determines which ID is the first positional arg in
``CoincidentConstraint("A", "B")``. Re-ordering that would not change
runtime behaviour (both slots are equivalent to Fusion), but it would
make emitted hints non-deterministic across runs — which breaks
diff-based review and git history for generated phase modules.

No duplicate-pair guard here. The user is responsible for not
selecting the same pair twice across runs; surfacing duplicate CCs
at the palette level was rejected as overreach during design review.
"""

import math
from collections import OrderedDict

from entity_util import _get_native
from fb_attributes import get_fb_id
from relation_hints import _derive_point_role_id
from detection_log import _log_detection


# Rounding precision for coord-key clustering. Fusion internally works
# in centimetres with double precision; observed sketch-solver "snap"
# noise stays well under 1e-5 cm, so 6 decimal places keeps coincident
# points on the same key without collapsing intentionally-nearby ones.
# If future tolerance complaints arise, widen to 5 — don't narrow below
# 6 because Fusion's solver re-positions points by sub-micron amounts
# on rebuild and we'd drop pairs that are visually on top of each other.
_COORD_DECIMALS = 6


_POINT_TYPE_SUFFIXES = ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D')
_LINE_TYPE_SUFFIXES = ('SketchLine',)
_AXIS_TYPE_SUFFIXES = ('ConstructionAxis',)

# Tolerance (cm) for point-on-line coincidence detection. Fusion solver
# snap noise stays well under 1e-5 cm; 1e-4 gives us an order-of-magnitude
# cushion without collapsing intentionally-near points onto nearby lines.
_COINCIDENT_POINT_ON_LINE_TOL_CM = 1e-4


def _is_sketch_point(ent):
    """True if ``ent`` is a SketchPoint subtype.

    Checks ``objectType`` with a suffix match so we catch the
    fully-qualified Fusion name (``adsk::fusion::SketchPoint``) as well
    as the short form a test harness might feed in.
    """
    try:
        ot = getattr(ent, 'objectType', '') or ''
    except Exception:
        return False
    return any(ot.endswith(suffix) for suffix in _POINT_TYPE_SUFFIXES)


def _is_sketch_line(ent):
    """True if ``ent`` is a SketchLine (including origin-axis reference lines)."""
    try:
        ot = getattr(ent, 'objectType', '') or ''
    except Exception:
        return False
    return any(ot.endswith(suffix) for suffix in _LINE_TYPE_SUFFIXES)


def _is_construction_axis(ent):
    """True if ``ent`` is a ConstructionAxis picked directly (browser tree)."""
    try:
        ot = getattr(ent, 'objectType', '') or ''
    except Exception:
        return False
    return any(ot.endswith(suffix) for suffix in _AXIS_TYPE_SUFFIXES)


def _is_line_or_axis(ent):
    """True if ``ent`` is either a SketchLine or a ConstructionAxis."""
    return _is_sketch_line(ent) or _is_construction_axis(ent)


def _point_coord_key(pt):
    """Return a hashable rounded-coord tuple for clustering.

    Reads ``pt.geometry.x / .y`` — every SketchPoint subtype exposes
    those. Returns ``None`` on any failure so the caller can drop the
    point rather than crash the cluster pass; we'd rather produce
    fewer clusters than take Fusion down over one unreadable proxy.
    """
    try:
        geom = getattr(pt, 'geometry', None)
        if geom is None:
            return None
        x = round(float(geom.x), _COORD_DECIMALS)
        y = round(float(geom.y), _COORD_DECIMALS)
        # SketchPoints in 3D sketches carry z too; keep it in the key
        # so a 3D sketch's overlapping-in-XY-but-apart-in-Z points
        # don't get spuriously clustered.
        z = round(float(getattr(geom, 'z', 0.0) or 0.0), _COORD_DECIMALS)
        return (x, y, z)
    except Exception:
        return None


def _resolve_point_id(pt):
    """Best-effort FrameBuilder ID for a SketchPoint, or None.

    Order of preference:

    1. Direct ``FrameBuilder:ID`` attribute on the point itself —
       covers points the rename pass stamped as standalone (rare;
       most points get their ID via the derivation path).

    2. ``_derive_point_role_id`` — walks ``connectedEntities`` and
       returns ``"{curve_name}:S|:E|:C"`` for points that live on
       a named curve's start/end/center slot. This is the normal
       ownership path for 99% of points in the offset-seed workflow.

    3. ``_origin_axis_token`` — handles the projected-origin case
       (``isReference=True`` SketchPoint whose referencedEntity is
       the root's ``originConstructionPoint``). Returns ``'ORIGIN'``
       so a point picked at the sketch origin can still participate
       in a coincidence pair without an FB stamp.

    Returns ``None`` if none of the paths yield an ID. A None'd point
    can't be emitted as a Coincident target (no way to name it in
    the generated hint), so the whole cluster is demoted — we log
    it and let the existing "N untagged entities skipped" banner
    surface the failure via the unowned-count mechanism upstream.
    """
    try:
        direct = get_fb_id(pt)
        if direct:
            return direct
        role = _derive_point_role_id(pt)
        if role:
            return role
        # Origin-token fallback — ``_origin_axis_token`` returns
        # ``'ORIGIN'`` for projected origin points. Deferred import
        # keeps the top of the module honest: the origin fallback is a
        # bolted-on third choice, not a peer of the FB paths.
        try:
            from relation_hints import _origin_axis_token
            tok = _origin_axis_token(pt)
            if tok:
                return tok
        except Exception:
            pass
    except Exception:
        return None
    return None


def _resolve_curve_id(curve):
    """FB-ID for a SketchLine, or origin-axis token for a ConstructionAxis.

    Origin-axis lines take priority so the emitted hint uses the bare
    token (``Y_AXIS`` etc.) rather than an FB ID stamped on the
    projected proxy — the FB runtime's ``ctx.resolve_entity`` knows
    how to turn the token back into the real axis, but it wouldn't
    know what to do with a proxy-local FB stamp.
    """
    try:
        from relation_hints import _origin_axis_token
        tok = _origin_axis_token(curve)
        if tok:
            return tok
    except Exception:
        pass
    try:
        direct = get_fb_id(curve)
        if direct:
            return direct
    except Exception:
        pass
    return None


def _point_on_line_segment_distance(p, s, e):
    """Perpendicular distance from ``p`` to the infinite line through ``s``/``e``.

    Uses the infinite extension because Fusion's ``addCoincident(point,
    line)`` also coincides on the infinite geometry — a point that
    visually lies "off the end" of a segment but on its extension will
    still satisfy Fusion's constraint. Returns ``None`` if the segment
    is degenerate (start == end) so the caller can treat it as "no
    meaningful line here."
    """
    try:
        vx, vy, vz = e.x - s.x, e.y - s.y, e.z - s.z
        wx, wy, wz = p.x - s.x, p.y - s.y, p.z - s.z
    except Exception:
        return None
    # Cross product magnitude / segment length = perp distance.
    cx = vy * wz - vz * wy
    cy = vz * wx - vx * wz
    cz = vx * wy - vy * wx
    cross_mag = math.sqrt(cx * cx + cy * cy + cz * cz)
    seg_mag = math.sqrt(vx * vx + vy * vy + vz * vz)
    if seg_mag < 1e-12:
        return None
    return cross_mag / seg_mag


def _point_on_infinite_line_distance(p, origin, direction):
    """Perpendicular distance from ``p`` to ``origin + t*direction``."""
    try:
        wx, wy, wz = p.x - origin.x, p.y - origin.y, p.z - origin.z
        dx, dy, dz = direction.x, direction.y, direction.z
    except Exception:
        return None
    cx = wy * dz - wz * dy
    cy = wz * dx - wx * dz
    cz = wx * dy - wy * dx
    cross_mag = math.sqrt(cx * cx + cy * cy + cz * cz)
    dir_mag = math.sqrt(dx * dx + dy * dy + dz * dz)
    if dir_mag < 1e-12:
        return None
    return cross_mag / dir_mag


def _point_on_curve_distance(point, curve):
    """Perpendicular distance (cm) from a SketchPoint to a line/axis.

    Dispatches on ``curve.objectType``. Sketch-line path uses the
    in-sketch start/end geometry (which for a projected origin axis is
    the axis projected into the sketch plane — same infinite line).
    ConstructionAxis path uses ``.geometry`` (InfiniteLine3D) so browser-
    tree axis picks work without requiring an in-sketch projection.

    Returns ``None`` on any read failure — caller treats that as
    "not coincident" rather than crashing the detection pass.
    """
    try:
        p = point.geometry
    except Exception:
        return None
    if p is None:
        return None
    if _is_sketch_line(curve):
        try:
            s = curve.startSketchPoint.geometry
            e = curve.endSketchPoint.geometry
        except Exception:
            return None
        return _point_on_line_segment_distance(p, s, e)
    if _is_construction_axis(curve):
        try:
            geom = curve.geometry  # InfiniteLine3D
            origin = geom.origin
            direction = geom.direction
        except Exception:
            return None
        return _point_on_infinite_line_distance(p, origin, direction)
    return None


class _UnionFind:
    """Minimal union-find over ID strings.

    Used for the point-curve MST pass: an edge is emitted only if its
    two endpoints aren't already transitively connected via previously-
    emitted constraints. This is what stops {A, B, Y-axis} (with A=B
    and both on Y) from emitting all three edges — after (A, B) and
    (A, Y) are bound, (B, Y) is already implied and would crash the
    Fusion solver as a redundant constraint.
    """

    def __init__(self):
        self._parent = {}

    def _find(self, x):
        if x not in self._parent:
            self._parent[x] = x
            return x
        root = x
        while self._parent[root] != root:
            root = self._parent[root]
        # Path compression — next lookup on any node in this chain
        # lands on the root in a single hop.
        while self._parent[x] != root:
            nxt = self._parent[x]
            self._parent[x] = root
            x = nxt
        return root

    def union(self, a, b):
        ra, rb = self._find(a), self._find(b)
        if ra != rb:
            self._parent[ra] = rb

    def same_set(self, a, b):
        return self._find(a) == self._find(b)


def cluster_sketchpoints(entities):
    """Cluster picked SketchPoints by rounded world coord.

    Returns an ``OrderedDict`` mapping coord-key → list of point dicts
    in pick order. Each point dict has shape::

        {'entity': <native SketchPoint>,
         'id':     <FB-ID string or None>,
         'coord':  <(x, y, z) rounded tuple>}

    Non-SketchPoint entities are skipped silently — this function is
    only interested in the coincidence-cluster view of the selection.
    Points with unreadable coords are skipped too (logged via
    ``[cluster-skip]``). The rest of the selection flows through the
    normal pipeline unaffected.

    Insertion order is pick order: Python 3.7+ dicts preserve it.
    That's the invariant the ``ambiguousClusters`` payload relies on
    to show clusters in the same order the user picked them.
    """
    clusters = OrderedDict()
    for ent in entities or []:
        try:
            native = _get_native(ent)
        except Exception:
            continue
        if not _is_sketch_point(native):
            continue
        key = _point_coord_key(native)
        if key is None:
            _log_detection(
                None,
                "[cluster-skip] point missing readable geometry -> skip",
            )
            continue
        fb_id = _resolve_point_id(native)
        entry = {'entity': native, 'id': fb_id, 'coord': key}
        if key in clusters:
            clusters[key].append(entry)
        else:
            clusters[key] = [entry]
    return clusters


def _detect_point_curve_pairs(entities, existing_auto_pairs):
    """Detect point-on-line / point-on-axis coincidences in a selection.

    Returns a list of ``(point_id, curve_id)`` tuples ready to append to
    the main ``auto_pairs`` stream. The caller has already resolved
    point-point clusters and forced-pick cluster resolutions into
    ``existing_auto_pairs``; we seed a ``_UnionFind`` from those pairs
    and skip any point-curve edge whose endpoints are already in the
    same set. That's the MST rule that stops {A, B, Y-axis} (A=B, both
    on Y) from emitting all three edges — after ``(A, B)`` binds A and
    B transitively, the second of ``(A, Y)`` / ``(B, Y)`` would form a
    cycle and would crash Fusion's solver as a redundant constraint.
    The first encountered curve-point match per point-curve pair wins.

    Ordering: we iterate points in selection pick order (outer loop)
    then curves in selection pick order (inner loop). That gives us
    deterministic pair output across runs, matching the convention the
    point-point cluster pass uses.
    """
    uf = _UnionFind()
    for a, b in existing_auto_pairs:
        uf.union(a, b)

    point_entries = []
    curve_entries = []
    for ent in entities or []:
        try:
            native = _get_native(ent)
        except Exception:
            continue
        if _is_sketch_point(native):
            pid = _resolve_point_id(native)
            if pid:
                point_entries.append((native, pid))
        elif _is_line_or_axis(native):
            cid = _resolve_curve_id(native)
            if cid:
                curve_entries.append((native, cid))

    if not point_entries or not curve_entries:
        return []

    pairs = []
    for point, pid in point_entries:
        for curve, cid in curve_entries:
            dist = _point_on_curve_distance(point, curve)
            if dist is None:
                continue
            if dist > _COINCIDENT_POINT_ON_LINE_TOL_CM:
                continue
            if uf.same_set(pid, cid):
                _log_detection(
                    None,
                    f"[curve-skip] ({pid}, {cid}) dist={dist:.2e} "
                    "-> redundant (same union-find set)",
                )
                continue
            pairs.append((pid, cid))
            uf.union(pid, cid)
            _log_detection(
                None,
                f"[curve-auto] ({pid}, {cid}) dist={dist:.2e}",
            )
    return pairs


def emit_coincident_hint(id_a, id_b):
    """Format a ``Constraints.CoincidentConstraint`` call string.

    Mirrors the shape ``relation_hints._hint_constraint`` emits for
    actual Fusion constraint entities. The phase_parser branch
    ``_build_constraint_step`` handles this exact form — two quoted
    target IDs, no name — so the output round-trips cleanly through
    ``build_code_preview`` / ``_build_phase_block_code``.

    IDs are emitted in the order given. Callers are responsible for
    preserving pick order (first-picked before second-picked) so the
    emitted phase modules stay diff-stable across regenerations.
    """
    return f'Constraints.CoincidentConstraint("{id_a}", "{id_b}")'


def detect_coincidence_pairs(entities, forced_picks=None):
    """Resolve a selection into auto-pairs and size-3+ cluster descriptors.

    Returns ``(auto_pairs, clusters)``:

      auto_pairs — list of ``(id_a, id_b)`` tuples in cluster order,
                   each pair in user pick order. Callers feed these
                   to ``emit_coincident_hint`` and append synthetic
                   items to the payload. Includes both size-2
                   auto-pairs AND size-3+ clusters that had a valid
                   forced pick applied.

      clusters   — list of dicts for the palette's checkbox UI, one
                   per size-3+ cluster regardless of resolution state.
                   Each dict shape::

                       {'clusterId':     'cluster_0',
                        'size':          N,
                        'coord':         '(x, y)',
                        'points': [
                            {'index': i, 'id': 'horn_TL:E'},
                            ...
                        ],
                        'resolved':      True | False,
                        'pickedIndices': [a, b] or []}

                   ``resolved`` is True when a valid 2-element
                   ``forced_picks`` entry landed in ``auto_pairs``
                   for this cluster; ``pickedIndices`` carries the
                   two indices the picks landed on (palette rehydrates
                   checkbox state from this on a fresh render). The
                   palette keeps the section visible for both
                   resolved and unresolved clusters so users can
                   revise a pick without the panel vanishing on 2/2.

                   ``clusterId`` is stable within a single
                   ``build_template_payload`` call — palette state
                   is keyed on it. Size-2 clusters are NOT included
                   in this list (they emit unambiguously — there's
                   nothing for the user to disambiguate).

    ``forced_picks`` is a dict mapping ``clusterId`` → ``[index_a,
    index_b]`` (two integers, indices into the cluster's ``points``
    list in the SAME ORDER the palette last saw). When a cluster has
    a valid forced pick, it emits into ``auto_pairs`` AND the cluster
    descriptor is marked ``resolved=True``. This is the round-trip
    hook B3 uses to honour the user's checkbox selection without
    replaying selections across the ``ui.activeSelections`` boundary.

    Size-1 clusters are dropped silently — a point selected without a
    twin has no coincidence to express, and the normal ownership-gate
    pass will still include it as a positional seed target if it's
    referenced by some other entity.
    """
    forced_picks = forced_picks or {}
    clusters_map = cluster_sketchpoints(entities)

    auto_pairs = []
    clusters = []
    cluster_idx = 0

    for coord_key, members in clusters_map.items():
        if len(members) < 2:
            continue

        # A cluster is only usable if EVERY member has a resolvable
        # FrameBuilder ID. One None'd member means we can't emit a
        # complete pair (and can't offer a consistent checkbox list
        # to the palette), so we log and drop the whole cluster.
        # ``build_payload_items`` will already have surfaced the
        # untagged member via the "N untagged entities skipped"
        # banner, so the user has a breadcrumb for the skip.
        missing = [i for i, m in enumerate(members) if not m['id']]
        if missing:
            _log_detection(
                None,
                f"[cluster-drop] coord={coord_key} size={len(members)} "
                f"missing_ids={missing} -> drop cluster (untagged member)",
            )
            continue

        cluster_id = f'cluster_{cluster_idx}'
        cluster_idx += 1

        if len(members) == 2:
            auto_pairs.append((members[0]['id'], members[1]['id']))
            _log_detection(
                None,
                f"[cluster-auto] {cluster_id} size=2 -> "
                f"({members[0]['id']}, {members[1]['id']})",
            )
            continue

        # size >= 3 — always surface to the palette. Check for a
        # forced pick from the previous round-trip; if valid, also
        # emit the pair and mark the cluster resolved so the UI
        # keeps the checkboxes visible (and checked).
        resolved = False
        picked_indices = []
        forced = forced_picks.get(cluster_id)
        if forced and len(forced) == 2:
            try:
                a_idx, b_idx = int(forced[0]), int(forced[1])
                if (0 <= a_idx < len(members) and
                        0 <= b_idx < len(members) and
                        a_idx != b_idx):
                    auto_pairs.append(
                        (members[a_idx]['id'], members[b_idx]['id'])
                    )
                    resolved = True
                    picked_indices = [a_idx, b_idx]
                    _log_detection(
                        None,
                        f"[cluster-forced] {cluster_id} size={len(members)} "
                        f"picks=[{a_idx},{b_idx}] -> "
                        f"({members[a_idx]['id']}, {members[b_idx]['id']})",
                    )
            except (TypeError, ValueError):
                # Bad payload shape from the palette — log and leave
                # the cluster unresolved so the user can re-pick
                # rather than silently losing the cluster.
                _log_detection(
                    None,
                    f"[cluster-forced-bad] {cluster_id} picks={forced!r} "
                    "-> surface as unresolved",
                )

        if not resolved:
            _log_detection(
                None,
                f"[cluster-amb]  {cluster_id} size={len(members)} "
                "-> surface to palette (unresolved)",
            )

        clusters.append({
            'clusterId': cluster_id,
            'size': len(members),
            'coord': f'({coord_key[0]}, {coord_key[1]})',
            'points': [
                {'index': i, 'id': m['id']} for i, m in enumerate(members)
            ],
            'resolved': resolved,
            'pickedIndices': picked_indices,
        })

    # Second pass — point-on-line and point-on-axis detection.
    # Seeded with the point-point auto-pairs so the union-find knows
    # which endpoints are already transitively bound. See the module
    # docstring for the {A, B, Y-axis} redundancy walkthrough.
    curve_pairs = _detect_point_curve_pairs(entities, auto_pairs)
    auto_pairs.extend(curve_pairs)

    return auto_pairs, clusters
