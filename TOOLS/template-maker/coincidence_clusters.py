"""Coincidence-cluster detection for Template Maker SketchPoint picks.

When the user selects SketchPoints that share a world coordinate, they
are expressing an intent to coincide those points at phase-run time.
The seed-offset workflow deliberately starts with geometry that is
not-yet-coincident and lets the user solve it via CC glyphs; the
point that matters at generation time is "which points should be
emitted as a Coincident pair?" — coord match is the canonical answer.

Two paths, by cluster size:

* **Size 2** — unambiguous. Emit ``Constraints.CoincidentConstraint``
  over the pair automatically. No UI round-trip needed.

* **Size 3+** — ambiguous. The user must pick which 2 of N points
  should be paired. We surface the cluster to the palette via the
  ``ambiguousClusters`` payload field; the palette renders checkboxes
  (all unchecked by default, FIFO-bump on 3rd check) and sends the
  user's picks back via the ``clusterPicks`` bridge action. The next
  ``build_template_payload`` call reads those picks and emits the
  chosen pair as if it were a size-2 cluster.

Cluster ORDER matters for the emitted phase block: multi-cluster
selections must appear in the order the user picked the first point
of each cluster, not sorted by coord or entity type. We use an
``OrderedDict`` keyed on the rounded world coord so the natural
insertion order gives us first-encounter order "for free".

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

    Returns ``None`` if neither path yields an ID. A None'd point
    can't be emitted as a Coincident target (no way to name it in
    the generated hint), so the whole cluster is demoted — we log
    it and let the existing "N untagged entities skipped" banner
    surface the failure via the unowned-count mechanism upstream.
    """
    try:
        direct = get_fb_id(pt)
        if direct:
            return direct
        return _derive_point_role_id(pt)
    except Exception:
        return None


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

    return auto_pairs, clusters
