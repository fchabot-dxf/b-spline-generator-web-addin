# b-spline-gen.py
# Hybrid palette + native canvas terrain add-in.
# Palette (HTML/JS) handles the UI; Python handles canvas preview and STEP import.

# Probe: removed diagnostic

import adsk.core, adsk.fusion, adsk.cam, traceback

# adsk check: removed diagnostic

import os, tempfile, json, re
from datetime import datetime

# T63 (SE15): the constrained-sketch builder — a sibling module in this
# SAME folder, already on sys.path by the time this file loads
# (bspline-frame-builder.py's own _load_submodule inserts 'b-spline-gen/'
# before exec'ing this file), so a plain top-level import is safe here,
# matching this file's own existing import style.
from sketch_manifest_builder import build_constrained_sketch, BuildContext
from constrained_sketch_log import format_constrained_sketch_log
# STALE-PARAMS R4 item 4: the Bspline-group cleanup pass — a sibling module,
# same sys.path story as sketch_manifest_builder above.
from param_ownership import compute_stale_params

# imports check: removed diagnostic


def _prescale_svg(svg_text, scale, width_in=7.0, height_in=9.0):
    """
    PASS-THROUGH (SC2). The board->Fusion carve transform (scale x{dpi}, flip Y,
    center on origin) is now baked into the SVG coordinates on the JS side, in
    ONE place -- editor-io.js `bakeSvgForCarving` (editor-coords.js `carveMatrix`)
    -- before the SVG is sent. The SVG arrives Fusion-ready.

    This used to re-do that transform with regexes and was the source of the
    send-path bugs (SC1 trace):
      - MICRO: its coord regex `([-\\d.]+),([-\\d.]+)` matched only COMMA-separated
        pairs, but the editor/svg.js emit SPACE-separated path `d` -> <path> coords
        passed through untransformed -> inch units read by Fusion as pixels ->
        1/96 scale (micro), unflipped, uncentered.
      - OFFSET DOWN: the `-(0.5 * scale)` "drift fix" was a constant 0.5-inch
        downward shift.
      - DOUBLE FLIP: it flipped Y here AND the (now removed) JS normalizeSvgForCarving
        added a `<g scale(1 -1)>` flip.

    Kept as a no-op (not deleted) so the call site + any external callers stay
    valid. `scale`, `width_in`, `height_in` are now unused.
    """
    return svg_text

handlers = []


def _send_build_info(pal):
    """Best-effort: read the deploy-written build-info.json (at the add-in ROOT,
    two dirs up from this file) and push {sha, built_at, dirty, status, message}
    to the header badge via the 'build_info' handshake. Fully wrapped — a missing
    file / import hiccup must never disturb the board sync it rides on. See
    fb_shared.build_info / VERSION-STAMP-DESIGN.md."""
    try:
        import sys as _sys
        addin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if addin_root not in _sys.path:
            _sys.path.insert(0, addin_root)
        from fb_shared import build_info as _bi
        info = _bi.read_build_info(addin_root)
        status, message = _bi.compare_to_source(info)
        pal.sendInfoToHTML('build_info', json.dumps({
            'sha':      info.get('sha'),
            'built_at': info.get('built_at'),
            'dirty':    info.get('dirty'),
            'status':   status,
            'message':  message,
        }))
    except Exception:
        pass
ui  = None
app = adsk.core.Application.get()
if app:
    ui = app.userInterface

# ── Log file ──────────────────────────────────────────────────────────────────

def _dir_writable(d):
    """True only if directory `d` exists AND a file can actually be created in
    it. A plain isdir() check isn't enough: a moved/renamed workspace path won't
    exist, and an existing dir can still be read-only. Probing with a real write
    is the only reliable test."""
    try:
        if not d or not os.path.isdir(d):
            return False
        probe = os.path.join(d, '.bs_log_write_test')
        with open(probe, 'a', encoding='utf-8'):
            pass
        os.remove(probe)
        return True
    except Exception:
        return False


def get_log_path():
    """Log file path, DERIVED from this .py file's own location so it always
    resolves to a real, writable folder in BOTH the repo and the deployed Fusion
    AddIns folder.

    Optional override: the deploy handshake can redirect the log into the dev
    workspace for easy inspection. If workspace_link.json (written next to this
    file by DEPLOY_bspline-frame-builder.py) names a `workspace_root` that is a
    valid, WRITABLE directory, the log goes there; otherwise we fall back to the
    derived path — so a stale/invalid override never sends the log to a dead
    folder. (b_spline_log_path.json is intentionally NOT read: it was a stale,
    wrong-path orphan — git-ignored / local-only — never consulted here.
    workspace_link.json is the sole override.)
    """
    addin_dir = os.path.dirname(os.path.realpath(__file__))
    derived   = os.path.join(addin_dir, 'b_spline_gen_log.txt')  # always valid
    try:
        link_file = os.path.join(addin_dir, 'workspace_link.json')
        if os.path.isfile(link_file):
            with open(link_file, 'r', encoding='utf-8') as f:
                link = json.load(f)
            root = (link.get('workspace_root') or '').replace('/', os.sep)
            if _dir_writable(root):
                return os.path.join(root, 'b_spline_gen_log.txt')
    except Exception:
        pass
    return derived  # fallback: next to this .py (repo OR deployed AddIns)

LOG_FILE = get_log_path()

# ── Module-level import probe (removed) ──────────────────────────────────

import datetime
def _log(msg):
    """Writes a timestamped message to the log file with auto-rotation."""
    try:
        timestamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f"[{timestamp}] {msg}\n"
        # Open in append mode
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_entry)
        # Optional: Rotation logic to keep the file small
        if os.path.getsize(LOG_FILE) > 1024 * 512: # 512KB limit
            os.replace(LOG_FILE, LOG_FILE + ".old")
    except Exception:
        # Fail silently if the OS prevents file access
        pass


# Fred (2026-09-26): "make the addin store the current project so you can read it".
# Every Send to Fusion writes what the palette actually sent — params + every stamp
# layer (profile/depth, SVG, sketchManifest) — minus the bulky STEP variants, to a
# fixed local file the advisor/workers can read when debugging. Overwritten each
# send; never read back by the add-in itself.
LAST_SEND_FILE = os.path.join(os.path.expanduser('~'), '.bspline-frame-builder', 'last_send.json')


def _dump_last_send(data):
    try:
        slim = {k: v for k, v in data.items() if k != 'stepVariants'}
        slim['_written'] = datetime.datetime.now().isoformat(timespec='seconds')
        os.makedirs(os.path.dirname(LAST_SEND_FILE), exist_ok=True)
        with open(LAST_SEND_FILE, 'w', encoding='utf-8') as f:
            json.dump(slim, f, indent=1)
    except Exception as e:
        _log(f'[LAST_SEND] could not write {LAST_SEND_FILE}: {e}')


def _merge_last_send_key(key, value):
    """STALE-PARAMS R4 item 4: adds/overwrites ONE key in the already-written
    last_send.json. _dump_last_send(data) runs early (right after the param
    sync, before geometry) — the stale-param pass runs LATE (end of
    _handle_generate, ruling 7, after geometry exists — see
    compute_stale_params's own module docstring for why), so this can only
    ever ADD to that file, never replace the payload snapshot it already
    holds. Same guarded-log-and-continue discipline as _dump_last_send —
    a failure here must never surface to the user."""
    try:
        existing = {}
        if os.path.exists(LAST_SEND_FILE):
            with open(LAST_SEND_FILE, 'r', encoding='utf-8') as f:
                existing = json.load(f)
        existing[key] = value
        with open(LAST_SEND_FILE, 'w', encoding='utf-8') as f:
            json.dump(existing, f, indent=1)
    except Exception as e:
        _log(f'[LAST_SEND] could not merge key {key!r}: {e}')

# ── Palette constants ─────────────────────────────────────────────────────────
PALETTE_ID   = 'fusionHybridPalette'
PALETTE_NAME = 'Symmetric B-Spline Gen'
PALETTE_HTML = 'html/bspline_gen_palette.html'

# Track occurrences and graphics added during the session
last_imported_occurrences = []
current_import_group      = None
custom_graphics_group     = None

# Globals for the chunked-transfer + polling handshake
importing_done = False
chunk_buffer   = []

# ── Body name classifiers ────────────────────────────────────────────────────
# A "panel" or "surface" body may end up with several name shapes:
#   - clean rename: 'panel' / 'surface'
#   - bspline-gen suffix: 'panel_1' / 'surface_2'   (our underscore convention)
#   - Fusion auto-uniquifier: 'panel (1)' / 'surface (1)'   (when a setter
#     detects a name collision and Fusion forces a numeric suffix in parens)
# Centralise the detection so every consumer (consolidator, stamp helper,
# visibility block) treats them identically. ``bn`` is expected lowercased.
def _is_panel_body_name(bn):
    if bn == 'panel':
        return True
    if bn.startswith('panel_'):
        return True
    if bn.startswith('panel (') and bn.endswith(')'):
        return True
    return False


def _is_surface_body_name(bn):
    if bn == 'surface':
        return True
    if bn.startswith('surface_'):
        return True
    if bn.startswith('surface (') and bn.endswith(')'):
        return True
    return False


def _send_progress(msg):
    """Sends a progress message to the JS UI."""
    try:
        pal = app.userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML('import_progress', json.dumps({'msg': msg}))
            _log(f'[PROGRESS] {msg}')
    except Exception: pass


def _send_import_failed(msg):
    """Workflow audit #15: tell the palette a Send failed, right away -- it used to keep polling for minutes
    (the message box was the only feedback, and it is behind the palette on a busy screen)."""
    try:
        pal = app.userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML('import_failed', json.dumps({'msg': msg}))
        _log(f'[IMPORT FAILED] {msg}')
    except Exception: pass


def _clear_custom_graphics():
    """Remove the native canvas preview mesh."""
    global custom_graphics_group
    try:
        des = adsk.fusion.Design.cast(app.activeProduct)
        if not des: return
        count = 0
        groups = [g for g in des.rootComponent.customGraphicsGroups]
        for group in groups:
            try:
                if group.isValid:
                    group.deleteMe()
                    count += 1
            except Exception: pass
        if count > 0:
            _log(f'  _clear_custom_graphics: Removed {count} group(s)')
        custom_graphics_group = None
    except Exception as e:
        _log(f'  _clear_custom_graphics failed: {e}')


def _remove_last_import():
    """Delete every occurrence added by the last Apply/generate action."""
    global last_imported_occurrences, current_import_group
    
    if 'current_import_group' in globals() and current_import_group:
        try:
            if current_import_group.isValid:
                current_import_group.deleteMe()
        except Exception: pass
        current_import_group = None

    if last_imported_occurrences:
        _log(f'Removing {len(last_imported_occurrences)} previous occurrence(s)...')
    for occ in last_imported_occurrences:
        try:
            if occ.isValid:
                occ.deleteMe()
        except Exception as e:
            _log(f'  deleteMe failed: {e}')
    last_imported_occurrences = []
    _clear_custom_graphics()


def _timeline_marker_safe():
    """Read the current parametric timeline length, or None if we can't.

    Returns the timeline ENTRY COUNT (not markerPosition) — we use it as
    a stable anchor to grab any new entries created between two snapshots.
    Returns ``None`` if the design isn't parametric (direct-edit mode has
    no timeline) or if Fusion is in a state where the timeline isn't
    accessible. Callers must handle the None case gracefully.
    """
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            return None
        # Direct-edit designs have no timeline → designType == DirectDesignType.
        if design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
            return None
        return design.timeline.count
    except Exception:
        return None


def _wrap_timeline_in_group(start_count, group_name):
    """Wrap timeline entries [start_count .. current end] into a TimelineGroup.

    Call this after a batch of timeline-producing operations to collapse
    them visually into one expandable row. Silently no-op if:
      - No new entries were added (start_count >= current count)
      - We can't read the timeline (direct-edit design)
      - TimelineGroups.add raises for any reason
    """
    if start_count is None:
        return
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design or design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
            return
        timeline = design.timeline
        end_idx = timeline.count - 1
        if end_idx < start_count:
            return  # nothing new added
        group = timeline.timelineGroups.add(start_count, end_idx)
        try:
            group.name = group_name
        except Exception:
            pass
        # Collapse it by default so the user doesn't see the inner copy/paste/delete features.
        try:
            group.isCollapsed = True
        except Exception:
            pass
    except Exception as e:
        _log(f"[CONSOLIDATE] timeline group wrap failed: {e}")


def _post_import_setup(occurrences, parent_hint=None):
    """Post-import verify & normalize pass.

    Walks the imported subtree, finds Clean / Stamped components wherever
    Fusion stuck them, and normalizes component names and body names
    (panel / surface based on isSolid).

    Resulting tree on import (the "B-Spline" wrapper is Fusion's auto-
    wrapping for multi-product STEP files; we accept it):

        B-Spline Set
            B-Spline                    <- Fusion wrapper, kept
                Clean   [panel, surface]
                Stamped [panel, surface]

    History: earlier revisions tried to delete the "B-Spline" wrapper
    via Occurrence.moveToComponent. That API's documented behavior
    contradicts itself (one sentence says "into the component owned by
    the specified occurrence", another says "into the parent component
    of the target occurrence") and empirically the second reading wins:
    moveToComponent makes the source a SIBLING of the target, not a
    child of target.component. Passing the wrapper's parent as target
    therefore moves Clean/Stamped UP TO ROOT instead of into the
    parent's component, leaving B-Spline Set empty. Multiple attempts
    to work around this broke the design tree. Definitively parked
    until a reliable mechanism for cross-context occurrence moves
    surfaces. See BSPLINE_CONTEXT.md "Stop trying these things".

    The Unstitched feature dissolve (Phase 3 in earlier revisions) is
    also parked - see _eliminate_unstitched below.

    The `parent_hint` parameter is kept in the signature for call-site
    compatibility but currently unused. It was previously passed by
    callers who fetched occurrences via component.occurrences.item(i),
    which yields native (assemblyContext=None) occurrences; the hint
    let _uplift_through_wrappers find the destination. With uplift
    disabled the hint has no effect.

    Returns the input list unchanged.
    """
    if not occurrences:
        return occurrences

    _log(f"[POST-IMPORT] >>> verifying {len(occurrences)} occurrence(s)")

    # Phase 1: find and normalize Clean / Stamped (only phase that runs).
    targets = []
    for occ in occurrences:
        targets.extend(_find_clean_stamped(occ, depth=0))
    _log(f"[POST-IMPORT]   found {len(targets)} Clean/Stamped target(s) in subtree")
    for occ in targets:
        _normalize_occurrence(occ)

    # Phase 2 (wrapper uplift) and Phase 3 (Unstitched dissolve) are parked.
    # See _post_import_setup docstring and BSPLINE_CONTEXT.md.

    _log(f"[POST-IMPORT] <<< done")
    return occurrences


def _find_clean_stamped(occ, depth):
    """Recursively search occ's subtree for Clean / Stamped / Analytical
    components. Returns list. Bounded depth for safety."""
    if depth > 6:
        return []
    found = []
    try:
        cname = (occ.component.name or "").lower()
    except Exception:
        return found

    if "stamped" in cname or "clean" in cname or "analytical" in cname:
        found.append(occ)
        return found

    try:
        n = occ.childOccurrences.count
    except Exception:
        return found

    for i in range(n):
        try:
            child = occ.childOccurrences.item(i)
            if child and child.isValid:
                found.extend(_find_clean_stamped(child, depth + 1))
        except Exception:
            continue
    return found


def _normalize_occurrence(occ):
    """Rename component to canonical name; rename bodies to panel / surface
    based on isSolid."""
    try:
        cname = occ.component.name or ""
    except Exception:
        return
    cname_lower = cname.lower()

    if "stamped" in cname_lower:
        target_cname = "Stamped"
    elif "clean" in cname_lower:
        target_cname = "Clean"
    elif "analytical" in cname_lower:
        target_cname = "Analytical"
    else:
        return

    if cname != target_cname:
        try:
            occ.component.name = target_cname
            _log(f"[POST-IMPORT]   comp rename {cname!r} -> {target_cname!r}")
        except Exception as e:
            _log(f"[POST-IMPORT]   comp rename {cname!r} -> {target_cname!r} FAILED: {e}")

    try:
        body_count = occ.component.bRepBodies.count
    except Exception as e:
        _log(f"[POST-IMPORT]   body count read failed in {target_cname!r}: {e}")
        return

    panel_seq = 0
    surface_seq = 0
    for i in range(body_count):
        try:
            b = occ.component.bRepBodies.item(i)
            bn = b.name or ""
        except Exception as e:
            _log(f"[POST-IMPORT]     body[{i}] read failed: {e}")
            continue

        try:
            kind = "panel" if b.isSolid else "surface"
        except Exception:
            bn_lower = bn.lower()
            if _is_panel_body_name(bn_lower):
                kind = "panel"
            elif _is_surface_body_name(bn_lower):
                kind = "surface"
            else:
                _log(f"[POST-IMPORT]     body {bn!r} in {target_cname!r}: cannot classify, leaving alone")
                continue

        if kind == "panel":
            target_bn = "panel" if panel_seq == 0 else f"panel_{panel_seq}"
            panel_seq += 1
        else:
            target_bn = "surface" if surface_seq == 0 else f"surface_{surface_seq}"
            surface_seq += 1

        if bn == target_bn:
            _log(f"[POST-IMPORT]     body {bn!r} in {target_cname!r} ok (isSolid={kind=='panel'})")
            continue

        try:
            tmp = f"_bsg_tmp_{target_cname}_{i}"
            b.name = tmp
        except Exception as e:
            _log(f"[POST-IMPORT]     tmp-rename failed: {e}")
        try:
            b.name = target_bn
            _log(f"[POST-IMPORT]     body rename {bn!r} -> {target_bn!r} in {target_cname!r} (isSolid={kind=='panel'})")
        except Exception as e:
            _log(f"[POST-IMPORT]     body rename {bn!r} -> {target_bn!r} in {target_cname!r} FAILED: {e}")


def _uplift_through_wrappers(occurrences, targets, parent_hint=None):
    """PARKED. Do not call. Do not revive without rereading the history.

    Goal: delete Fusion's auto-wrapper occurrence around multi-product
    STEP imports so the design tree shows Clean/Stamped as direct
    children of the import target group.

    Why parked: every implementation has misbehaved because
    Occurrence.moveToComponent(target) does not do what the API docs
    primarily claim. The doc page contradicts itself:
      - Sentence 1: "into the component owned by the specified
        occurrence" implies source becomes a CHILD of target.component.
      - Sentence 2: "into the parent component of the target occurrence"
        implies source becomes a SIBLING of target.
    Empirically the SECOND reading is correct. Passing the wrapper's
    parent (e.g. B-Spline Set) as target moved Clean/Stamped UP to the
    root component instead of into the parent's component, leaving
    B-Spline Set empty. Confirmed in the field, design tree
    screenshotted, undone. The "obvious" fix of passing the wrapper
    itself as target also runs into the documented "must be in the
    same context" requirement: the wrapper proxy and its child proxies
    have different assemblyContexts, so moveToComponent silently
    returns None.

    Other approaches considered and discarded:
      - Component.occurrences.addExistingComponent + delete wrapper:
        creates fresh Stamped:2 / Clean:2 occurrences (since :1 is
        still referenced), and deleting the wrapper would also nuke
        the original Stamped:1 / Clean:1 references. Net result:
        cosmetic name churn and at least one invalid intermediate
        state. Not tried in the field but high probability of new
        breakage.
      - Direct-edit-mode conversion of the import: destructive,
        breaks parametric history.

    Decision: keep the wrapper. Cosmetic but stable. Downstream code
    (CAM filter, body lookups by name) walks by component name and is
    indifferent to the extra hierarchy level.

    See BSPLINE_CONTEXT.md "Stop trying these things" for the full
    history. _post_import_setup no longer calls this function.
    """
    return  # no-op


def _eliminate_unstitched(occ):
    """No-op (parked).

    Earlier versions of this function tried to dissolve Fusion's
    Unstitched parametric feature -- which wraps surface bodies imported
    via MANIFOLD_SURFACE_SHAPE_REPRESENTATION -- by capturing each output
    body's geometry via TemporaryBRepManager, recreating it inside a
    BaseFeature edit on the same component, then deleting the original
    parametric feature. In practice the dance was unreliable: the field
    log showed BaseFeature.add returning a body, finishEdit appearing to
    succeed, then the post-edit refetch finding bRepBodies smaller than
    expected -- both panel AND surface ended up gone, replaced by a
    single auto-named Body3. Until we have a reliable way to dissolve
    the parametric Unstitched feature without collateral, the cosmetic
    "Unstitched" folder in the browser stays.

    The body itself is correctly named ("surface") and accessible via
    occ.component.bRepBodies. CAM-builder's MM filter and any caller
    walking by name finds it without needing the folder dissolved.
    """
    try:
        cname = occ.component.name
    except Exception:
        cname = "<?>"
    _log(f"[POST-IMPORT]   {cname!r}: Unstitched dissolve skipped (cosmetic Fusion display)")


def _get_current_board_size():
    """Queries the design for widthIn/heightIn to sync the UI.

    Only returns keys that actually exist in the design. If neither
    parameter exists, returns an empty dict so the palette keeps its
    last-session / default values instead of being reset to placeholders.
    """
    out = {}
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            return out
        w_param = design.allParameters.itemByName('widthIn') or design.allParameters.itemByName('BSG_widthIn')
        h_param = design.allParameters.itemByName('heightIn') or design.allParameters.itemByName('BSG_heightIn')
        if w_param:
            out['widthIn'] = w_param.value / 2.54
        if h_param:
            out['heightIn'] = h_param.value / 2.54
    except Exception as e:
        _log(f"_get_current_board_size failed: {e}")
    return out

def _expression_is_numeric(expr):
    """Return True if a Fusion parameter expression is a plain number
    (optionally followed by a unit suffix like ' in' or ' mm'), and False
    if it references other parameters or contains arithmetic ops.

    Used to decide whether a widthIn/heightIn expression in the design is
    a literal value (safe to overwrite) or a parametric formula like
    'd3 - 1' that the user wants preserved.
    """
    if not expr:
        return True
    s = str(expr).strip()
    # Strip a trailing unit suffix (Fusion stores expressions like '7 in').
    for unit in (' in', ' mm', ' cm', ' m', ' ft'):
        if s.endswith(unit):
            s = s[:-len(unit)].strip()
            break
    try:
        float(s)
        return True
    except ValueError:
        return False


def _sync_user_parameters(design, params):
    """
    Creates or updates Fusion 360 User Parameters based on generator settings.
    Prefixes names with 'BSG_' to avoid collisions.

    Expression-preservation rule for widthIn/heightIn: if the parameter
    already has a non-numeric expression (e.g. 'd3 - 1') AND the palette's
    value matches the resolved expression value, we skip the write so the
    parametric link survives. If the palette value differs, we treat that
    as a manual user override and overwrite the expression with the new
    number — restoring the bspline tool as the source of truth.
    """
    if not design or not params: return

    # Shared Namespace: using widthIn/heightIn directly (v45 Simplified)
    param_map = {
        'widthIn':  ('widthIn', 'in'),
        'heightIn': ('heightIn', 'in'),
    }

    user_params = design.userParameters
    EPS_IN = 0.001  # inch tolerance for "values match"

    for key, (f_name, unit) in param_map.items():
        if key in params:
            val = params[key]
            try:
                existing = user_params.itemByName(f_name)
                if existing:
                    skip_write = False
                    if not _expression_is_numeric(existing.expression):
                        # Resolved value comes back from Fusion in cm.
                        resolved_in = existing.value / 2.54
                        if abs(resolved_in - float(val)) < EPS_IN:
                            # Palette already matches the formula — preserve it.
                            skip_write = True
                            _log(f"Preserving expression for {f_name}: '{existing.expression}' "
                                 f"(resolved {resolved_in:.4f}in matches palette {float(val):.4f}in)")
                    if not skip_write:
                        existing.expression = str(val)
                    param = existing
                else:
                    val_input = adsk.core.ValueInput.createByString(str(val))
                    param = user_params.add(f_name, val_input, unit, 'Design Master Parameter')
                # Stamp bspline ownership on every touch (create OR update).
                # Tagging on update covers the case where the parameter was
                # first created by another tool (e.g. frame-builder's
                # engine) and is now being sync'd by bspline — from that
                # point on bspline is the source of truth for its value,
                # so the ownership marker belongs here. The group name
                # 'Bspline' is intentionally distinct from 'FrameBuilder'
                # to avoid any confusion with the sketch-entity attribute
                # group used across the rest of the toolchain.
                _ensure_bspline_param_tag(param, f_name)
            except Exception as e:
                _log(f"Failed to sync parameter {f_name}: {e}")


def _ensure_bspline_param_tag(param, f_name):
    """Idempotently stamp ``Bspline.owner = '1'`` on a UserParameter.

    Safe to call on both freshly-created and pre-existing parameters.
    Wrapped in try/except because UserParameter.attributes is
    occasionally flaky across Fusion versions — tagging is never worth
    failing the sync over.
    """
    try:
        if not param or not hasattr(param, 'attributes'):
            return
        existing_tag = param.attributes.itemByName('Bspline', 'owner')
        if existing_tag and existing_tag.value:
            return
        param.attributes.add('Bspline', 'owner', '1')
    except Exception as tag_err:
        _log(f"Tag skip on {f_name}: {tag_err}")


# ── Palette Closed event handler ──────────────────────────────────────────────
class PaletteClosedHandler(adsk.core.UserInterfaceGeneralEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            _log('Palette closed event received — clearing temporary graphics only')
            _clear_custom_graphics()
        except Exception:
            _log(f'Error in PaletteClosedHandler:\n{traceback.format_exc()}')


def _layer_manifest(layer):
    """R7 item 0(b) (home advisor, LIVE bug found in Fusion): the ONE place
    a layer's own constrained-sketch manifest is read — `layer['sketch
    Manifest']` (export-flow.js:472/484 is the ONE thing that ever writes
    it). The stale-params payload-name collection (Finalise, below) used
    to read `layer.get('manifest')` instead — a key that never existed in
    a real payload — so every lattice parameter looked "out of payload"
    and became a stale-delete candidate on every ordinary Send (only
    `dependentParameters` stood between it and `deleteMe()`). Declared
    here so `_svg_layer_import_plan` (the ONLY other reader) and the
    payload-names loop can never diverge on the key name again."""
    return layer.get('sketchManifest')


class _LogAdapter:
    """R7 item 0(a) (home advisor, LIVE bug found in Fusion): `_log(msg)`
    takes exactly ONE positional argument — this module's own logging
    convention bakes any level into the message text itself (grep this
    file's own `_log(` call sites). `param_ownership.compute_stale_params`
    calls `logger.log(msg, level)` (a 2-arg shape, matching OTHER loggers
    elsewhere in this codebase, e.g. fb_engine's own `DebugLogger`) — every
    such call raised `TypeError: _log() takes 1 positional argument but 2
    were given`, which (however it actually surfaced live) meant the
    cleanup pass never completed a single run. Wraps `_log` behind the
    2-arg shape `compute_stale_params` actually calls, folding `level`
    into the message the same way this file's OWN direct `_log` calls
    already do by convention (an explicit `[LEVEL]` prefix), rather than
    inventing a second logging convention."""
    def log(self, msg, level=None):
        _log(f"[{level}] {msg}" if level else msg)


def _svg_layer_import_plan(layers, design_available):
    """T74 AMEND 5: the PURE per-layer decision `_import_all_svg_layers`
    executes — entirely Fusion-API-free (no adsk.* references anywhere
    in this function) so it's directly unit-testable without a live
    Fusion session or a heavy adsk.* stub surface, unlike the rest of
    this class. One entry per layer, `sketch_name` computed the same way
    the real loop always has:
      build_constrained: a real sketchManifest AND a Design in scope —
        the constrained-sketch path runs.
      manifest_skipped_no_design: a manifest exists but there's no Design
        in scope — constrained sketch skipped (logged separately by the
        caller), never silently conflated with "no manifest at all".
      import_svg: `svg` is non-empty — export-flow.js already strips a
        pattern's own lattice/contour content out of it whenever a
        manifest was attached for that layer, so this never duplicates
        the constrained sketch's own geometry; a layer with no manifest
        gets its full, unfiltered svg here, exactly as before T74."""
    plan = []
    for layer in layers:
        idx = layer.get('index', 1)
        cfg = layer.get('config', {})
        svg = layer.get('svg', '')
        manifest = _layer_manifest(layer)
        prof = cfg.get('profile', 'flat')
        depth = cfg.get('depth', 0)
        plan.append({
            # BOUNDARY-GUIDE (L1): a manifest-only entry (the "Lattice
            # Boundary" sketch, export-flow.js) declares its own name.
            'sketch_name': layer.get('sketchName') or f"L{idx} - {prof} ({depth}\")",
            'manifest': manifest,
            'svg': svg,
            'build_constrained': bool(manifest and design_available),
            'manifest_skipped_no_design': bool(manifest and not design_available),
            'import_svg': bool(svg),
        })
    return plan


def _ordered_svg_layer_import_plan(layers, design_available):
    """T76 (SE17, item 5): `_svg_layer_import_plan`'s own plan, REORDERED so
    a pattern's own kind-layers (contour/rails/ties/nodes -- identified by
    `manifest['patternId']`, splitManifestByKind's own new field, JS side)
    build in `manifest['buildOrder']` sequence, regardless of the layers'
    own array position (the APP's own layer stacking order, independently
    user-drag-reorderable -- ROADMAP.md's own SE17 entry: "The APP
    stacking order is independent of the FUSION sketch build order").
    This matters because a LATER kind's own manifest.projections can only
    resolve an EARLIER kind's own entities once that earlier sketch has
    actually been built.

    Every step NOT part of a kind-split pattern (no `patternId` at all --
    a hand-drawn layer, or a pre-SE17 single-layer lattice) keeps its own
    original RELATIVE order untouched, via a stable sort: Python's own
    `sorted()` never reorders two entries whose sort key compares equal,
    so `(1, original_index)` for every ungrouped step preserves the exact
    order `_svg_layer_import_plan` already produced. Grouped-pattern steps
    sort before ungrouped ones (`0 < 1`) -- an arbitrary but harmless and
    fully deterministic choice; nothing in the spec cares which SIDE of a
    hand-drawn layer's own sketch a lattice pattern's own four land on,
    only that the four themselves land in the right order relative to
    EACH OTHER.

    Pure and Fusion-API-free, same as `_svg_layer_import_plan` itself --
    directly unit-testable without a live Fusion session."""
    plan = _svg_layer_import_plan(layers, design_available)

    def sort_key(item, idx):
        m = item['manifest']
        pattern_id = m.get('patternId') if m else None
        if pattern_id:
            return (0, pattern_id, m.get('buildOrder', 0))
        return (1, idx, 0)

    indexed = list(enumerate(plan))
    indexed.sort(key=lambda pair: sort_key(pair[1], pair[0]))
    return [item for _, item in indexed]


# ── Palette HTML event handler ────────────────────────────────────────────────
# ── FB-APP S5 (F10): [Send frame] ─────────────────────────────────────────────
# The frame engine module the add-in root loads fresh and injects here, the
# same way it injects it into the Frame Builder palettes (bspline-frame-builder.py).
frame_engine = None

# The body [Send frame] extrudes the bars to: the solid 'panel' in
# "B-Spline Set" / "Clean", the hierarchy _handle_generate and
# _normalize_occurrence build (their own literals, not re-declared there).
BSPLINE_SET_NAME = "B-Spline Set"
CLEAN_COMPONENT_NAME = "Clean"
PANEL_BODY_NAME = "panel"


def _find_bspline_core_body(design):
    """The B-spline body in assembly context (its occurrence's proxy), or None."""
    if design is None:
        return None
    for occ in design.rootComponent.occurrences:
        if occ.component.name != BSPLINE_SET_NAME:
            continue
        for child in occ.childOccurrences:
            if child.component.name != CLEAN_COMPONENT_NAME:
                continue
            for body in child.bRepBodies:
                if body.name == PANEL_BODY_NAME and body.isSolid:
                    return body
    return None


def _frame_builder_dir():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frame-builder')


class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        global last_imported_occurrences, importing_done, chunk_buffer
        try:
            htmlArgs = adsk.core.HTMLEventArgs.cast(args)
            action   = htmlArgs.action
            data_preview = (htmlArgs.data[:50] + '...') if htmlArgs.data and len(htmlArgs.data) > 50 else htmlArgs.data
            

            # v37: EXTREME SILENCE. Silencing these high-frequency actions 
            # at the source to prevent any possible file write during polling.
            # Now, allow 'log' action to write to log file from JS
            if action == 'log':
                try:
                    data = json.loads(htmlArgs.data)
                    msg = data.get('msg', '')
                    _log(f'[JS LOG] {msg}')
                except Exception as e:
                    _log(f'[JS LOG ERROR] Failed to log message: {e}')
                return
            if action not in ['check_import_status', 'ping', 'preview_mesh', 'log']:
                _log(f'Action: "{action}" | Data: {data_preview}')

            # ── Polling: JS asks whether the import finished ──────────────────
            if action == 'check_import_status':
                if importing_done:
                    pal = None
                    if app.userInterface:
                        pal = app.userInterface.palettes.itemById(PALETTE_ID)
                    if pal:
                        # Signal JS and then hide
                        pal.sendInfoToHTML('import_ready', '{}')
                        pal.isVisible = False  # CORRECT API for closing/hiding palette
                    # One-shot completion signal: prevent repeated auto-hide loops
                    # if old polling intervals are still alive in HTML.
                    importing_done = False
                return

            if action == 'ping':
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('pong', '{}')
                return

            if action == 'get_design_params':
                # UI asks: "How big is my board?" 
                board = _get_current_board_size()
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    _log(f"Sending Board Sync: {board}")
                    pal.sendInfoToHTML('sync_board', json.dumps(board))
                    # Piggy-back the deployed version stamp on this first
                    # handshake reply so the header badge fills in at open.
                    _send_build_info(pal)
                return

            # ── Reset UI / session restart (from JS)
            if action == 'reset_ui':
                _log('reset_ui received - clearing chunk buffer and state')
                chunk_buffer = []
                importing_done = False
                return

            # ── Chunked transfer ──────────────────────────────────────────────
            if action == 'generate_start':
                chunk_buffer   = []
                importing_done = False
                _log('Chunked transfer started...')
                return

            if action == 'generate_chunk':
                data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                chunk = data.get('data', '')
                chunk_buffer.append(chunk)
                _log(f'Received chunk {data.get("index")} (buffer size: {len(chunk_buffer)})')
                return

            if action == 'generate_finish':
                payload_json = "".join(chunk_buffer)
                num_chunks = len(chunk_buffer)
                chunk_buffer = []
                _log(f'Chunked transfer complete — received {len(payload_json)} chars across {num_chunks} chunks')
                try:
                    payload = json.loads(payload_json)
                    self._handle_generate(payload)
                except Exception as e:
                    _log(f'ERROR: Failed to parse chunked JSON payload: {e}')
                    if ui: ui.messageBox('Failed to parse STEP payload.')
                return

            # ── send_frame — FB-APP S5 (F10): the frame on its own ───────────
            if action == 'send_frame':
                data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                self._handle_send_frame(data)
                return

            # ── generate — single-shot (small payloads / legacy) ─────────────
            if action == 'generate':
                data = json.loads(htmlArgs.data) if htmlArgs.data else {}
                self._handle_generate(data)

            # ── preview_mesh — lightweight native canvas mesh ─────────────────
            elif action == 'preview_mesh':
                try:
                    data = json.loads(htmlArgs.data)
                except Exception:
                    return
                _clear_custom_graphics()
                verts   = data.get('verts',   [])
                indices = data.get('indices', [])
                if not verts or not indices:
                    return
                des = adsk.fusion.Design.cast(app.activeProduct)
                if not des:
                    return

                # Compute normals from triangle indices if not provided.
                normals = data.get('normals')
                if not normals:
                    numVerts = len(verts) // 3
                    normals = [0.0] * (numVerts * 3)

                    def _add_normal(vi, nx, ny, nz):
                        normals[vi * 3 + 0] += nx
                        normals[vi * 3 + 1] += ny
                        normals[vi * 3 + 2] += nz

                    def _normalize(v):
                        x, y, z = v
                        mag = (x*x + y*y + z*z) ** 0.5
                        if mag > 1e-9:
                            return (x / mag, y / mag, z / mag)
                        return (0.0, 0.0, 1.0)

                    for i in range(0, len(indices), 3):
                        a = indices[i]
                        b = indices[i + 1]
                        c = indices[i + 2]

                        ax, ay, az = verts[a*3:a*3+3]
                        bx, by, bz = verts[b*3:b*3+3]
                        cx, cy, cz = verts[c*3:c*3+3]

                        ux, uy, uz = bx - ax, by - ay, bz - az
                        vx, vy, vz = cx - ax, cy - ay, cz - az
                        nx = uy * vz - uz * vy
                        ny = uz * vx - ux * vz
                        nz = ux * vy - uy * vx

                        # normalize face normal
                        fnx, fny, fnz = _normalize((nx, ny, nz))

                        _add_normal(a, fnx, fny, fnz)
                        _add_normal(b, fnx, fny, fnz)
                        _add_normal(c, fnx, fny, fnz)

                    for vi in range(numVerts):
                        n = _normalize((normals[vi*3], normals[vi*3+1], normals[vi*3+2]))
                        normals[vi*3:vi*3+3] = list(n)

                global custom_graphics_group
                custom_graphics_group = des.rootComponent.customGraphicsGroups.add()
                coords = adsk.fusion.CustomGraphicsCoordinates.create(verts)

                # convert triangle indices to ints (coordinate indexing)
                coord_index_list = [int(i) for i in indices]

                # normalVectors: flat list of normals (x,y,z per vertex)
                normal_vectors = [float(v) for v in normals]

                # For one-to-one normals mapping, pass an empty normalIndexList.
                mesh   = custom_graphics_group.addMesh(coords, coord_index_list, normal_vectors, [])

                # Ghost preview color: low opacity for subtle shading and hover behavior.
                color = adsk.core.Color.create(0, 102, 204, 43)  # approx 17% alpha
                mesh.color = adsk.fusion.CustomGraphicsSolidColorEffect.create(color)

                # Add a strong reflective material effect as primary renderer.
                try:
                    material = adsk.fusion.CustomGraphicsPhongMaterial.create(
                        0.00,  # ambient (no ambient light)
                        0.30,  # diffuse (boosted for stronger base tone)
                        1.00,  # specular
                        2.0    # roughness
                    )
                    material_effect = adsk.fusion.CustomGraphicsMaterialEffect.create(material)
                    mesh.effect = material_effect
                except Exception:
                    # Keep solid color effect fallback if material API not available.
                    pass

            # ── ok — keep geometry, close palette ────────────────────────────
            elif action == 'ok':
                _log('ok: forgetting occurrence refs, hiding palette')
                last_imported_occurrences = []
                palette = ui.palettes.itemById(PALETTE_ID)
                if palette:
                    palette.isVisible = False

            # ── cancel — remove preview and close palette ─────────────────────
            elif action == 'cancel':
                _log('cancel: removing preview geometry, hiding palette')
                _remove_last_import()
                palette = ui.palettes.itemById(PALETTE_ID)
                if palette:
                    palette.isVisible = False

            # ── ping — bridge health check ────────────────────────────────────
            elif action == 'ping':
                # Silenced to prevent refresh loop
                pal = ui.palettes.itemById(PALETTE_ID)
                if pal:
                    pal.sendInfoToHTML('pong', '{}')

            # ── log — JS diagnostic tunnelled to Python log ───────────────────
            elif action == 'log':
                # Silenced to prevent refresh loop
                pass

        except Exception:
            tb = traceback.format_exc()
            _log(f'UNHANDLED EXCEPTION in palette handler:\n{tb}')
            if ui:
                ui.messageBox('Palette HTML event failed:\n{}'.format(tb))

    def _handle_send_frame(self, payload):
        """FB-APP S5 (F10): fb_engine.send_frame does the work (delete the
        previous frame by attribute, rebuild through the palettes' own entry
        points); this finds the B-spline body this add-in created, records the
        send in last_send.json and reports back to the palette."""
        try:
            from fb_engine import send_frame as fb_send, solid_coordinator
            from fb_engine.template_resolver import resolve_template
            from fb_utils.fb_logger import DebugLogger
            design = adsk.fusion.Design.cast(app.activeProduct)
            result = fb_send.send_frame(
                design, payload, lambda: _find_bspline_core_body(design), DebugLogger(_frame_builder_dir()),
                resolve_template=resolve_template,
                build_sketch=frame_engine.build_sketch_logic_v3,
                build_solid=solid_coordinator.build_solid_logic_v3)
        except Exception as e:
            _log(f'SEND FRAME crashed: {e}\n{traceback.format_exc()}')
            result = {'ok': False, 'error': f'Send frame failed: {e}', 'deleted': [], 'frame': None,
                      'fit': None, 'seeds': None}
        _log(f'SEND FRAME result: {result}')
        _merge_last_send_key('frame', {'payload': payload, 'result': result})
        try:
            pal = app.userInterface.palettes.itemById(PALETTE_ID)
            if pal:
                pal.sendInfoToHTML('frame_result', json.dumps(result, default=str))
        except Exception as e:
            _log(f'SEND FRAME could not report back: {e}')

    def _handle_generate(self, data, step_text=None):
        """
        MULTI-EXPORT / SINGLE-STEP IMPORT HANDLER  (Python bridge receiver)
        ---------------------------------------------------------------------
        Central handler for all STEP imports from the JS palette.  Detects the
        payload format automatically and routes accordingly:

        [MULTI-VARIANT path]  payload key: 'stepVariants'
          Sent by: executeExport() / processExport() in main.js (OK button & wizard).
          Contains a list of { type, name, stepText } dicts — one per selected body.
          Each variant is written to its own temp file and imported into Fusion
          individually, so they arrive as separate components in the browser tree.

        [SINGLE-STEP path]  payload key: 'stepText'
          Sent by: sendFusionPreview() in main.js (auto live-preview on rebuild).
          Contains one STEP file representing the current preview body (surface or solid).

        In both cases Smart Visibility selects the highest-priority body to show,
        and SVG stamp layers are applied to that primary body afterwards.
        Log tags: [MULTI-VARIANT] and [SINGLE-STEP] for easy grep.
        """
        global importing_done, last_imported_occurrences
        try:
            is_preview = data.get('isPreview', False)
            if not is_preview:
                importing_done = False
                _send_progress("Preparing Geometry...")

            _log(f'_handle_generate: isPreview={is_preview}, payload keys={list(data.keys())}')

            # ── Detect payload format ────────────────────────────────────────────
            # New format (OK button / executeExport): payload has 'stepVariants' list
            # Legacy format (live preview / sendFusionPreview): payload has single 'stepText'
            step_variants = data.get('stepVariants', [])
            has_variants  = bool(step_variants)

            if has_variants:
                _log(f'[MULTI-VARIANT] Detected {len(step_variants)} STEP variant(s): {[v.get("name","?") for v in step_variants]}')
            else:
                _log(f'[SINGLE-STEP] Legacy single-stepText path.')

            # 1. Check for active design
            des = adsk.fusion.Design.cast(app.activeProduct)
            if not des:
                _log('ERROR: no active Design product')
                if not is_preview: _send_import_failed('No active Fusion design -- open or create a design, then Send again.')
                if ui: ui.messageBox('No active Fusion design found.')
                return

            # Sync User Parameters (if not preview)
            if not is_preview:
                params = data.get('params', {})
                _sync_user_parameters(des, params)

            _log(f'Design: {des.parentDocument.name}, type={des.designType}')
            root_comp     = des.rootComponent
            import_mgr    = app.importManager
            stamp_data    = data.get('stamp')
            params        = data.get('params', {})
            orientation   = params.get('exportOrientation', 'z-up')
            _dump_last_send(data)

            # ── Remove previous import ───────────────────────────────────────────
            is_append = data.get('isAppend', False)
            is_visible = data.get('isVisible', True)
            
            global current_import_group
            if not is_preview and not is_append:
                _remove_last_import()
                current_import_group = root_comp.occurrences.addNewComponent(adsk.core.Matrix3D.create())
                current_import_group.component.name = "B-Spline Set"

            primary_imported_occurrence = None

            # ════════════════════════════════════════════════════════════════════
            # MULTI-VARIANT PATH  (OK button → executeExport → stepVariants)
            # ════════════════════════════════════════════════════════════════════
            if has_variants:
                all_newly_added = []

                import_target_comp = current_import_group.component if ('current_import_group' in globals() and current_import_group and current_import_group.isValid) else root_comp

                for vi, variant in enumerate(step_variants):
                    v_name     = variant.get('name', f'Variant_{vi}')
                    v_steptext = variant.get('stepText', '')
                    v_filename = f'terrain_{v_name.replace(" ", "_").lower()}.step'

                    _log(f'[VARIANT {vi+1}/{len(step_variants)}] name="{v_name}", stepLen={len(v_steptext)}, file={v_filename}')

                    if not v_steptext:
                        _log(f'  SKIP: stepText empty for variant "{v_name}"')
                        continue

                    tmp_path = os.path.join(tempfile.gettempdir(), v_filename)
                    try:
                        with open(tmp_path, 'w', encoding='utf-8') as f:
                            f.write(v_steptext)
                        _log(f'  Written to {tmp_path}')
                    except Exception as e:
                        _log(f'  ERROR writing STEP for variant "{v_name}": {e}')
                        continue

                    step_options           = import_mgr.createSTEPImportOptions(tmp_path)
                    step_options.isViewFit = False
                    initial_count          = import_target_comp.occurrences.count
                    _send_progress(f"Importing {v_name}...")
                    try:
                        ok = import_mgr.importToTarget(step_options, import_target_comp)
                        if not ok:
                            raise RuntimeError('importToTarget returned False')

                        newly_added = []
                        for i in range(initial_count, import_target_comp.occurrences.count):
                            try:
                                occ = import_target_comp.occurrences.item(i)
                                if occ and occ.isValid:
                                    # Rename generic component names to match variant label
                                    if any(kw in occ.component.name for kw in ('Component', 'Part')):
                                        occ.component.name = v_name
                                    newly_added.append(occ)
                            except Exception:
                                pass

                        _log(f'  Imported {len(newly_added)} occurrence(s) for "{v_name}".')
                        all_newly_added.extend(newly_added)

                    except Exception as e:
                        _log(f'  importToTarget failed for variant "{v_name}": {e}')
                        continue

                _log(f'[MULTI-VARIANT] Total occurrences imported (pre-consolidation): {len(all_newly_added)}')

                # Verify component / body names. Since the JS side now
                # emits one STEP per OK click with bodies pre-grouped by
                # base, this is a thin pass that just confirms names are
                # canonical. It does NOT try to delete Fusion's auto-
                # wrapper -- see _post_import_setup docstring for why.
                all_newly_added = _post_import_setup(all_newly_added)
                _log(f'[MULTI-VARIANT] After consolidation: {len(all_newly_added)} occurrence(s)')

                # v41: Fix append logic to ensure all imported occurrences are tracked
                if is_append:
                    last_imported_occurrences.extend(all_newly_added)
                else:
                    last_imported_occurrences = all_newly_added

                # Visibility is set by the unified post-import block below
                # (see ~50 lines down). That block applies the canonical
                # rules (panel ON / surface ALWAYS OFF; Stamped ON, Clean
                # OFF when both exist; Clean ON when alone) and is the
                # sole visibility authority. The earlier inline block here
                # was removed because it honored the per-call `is_visible`
                # flag and could be overridden by a stale 'last call wins'
                # ordering -- now defangged. Just track the first occurrence
                # so primary_imported_occurrence isn't None on the path
                # leading into the unified block.
                if all_newly_added:
                    primary_imported_occurrence = all_newly_added[0]

            # ════════════════════════════════════════════════════════════════════
            # SINGLE-STEP PATH  (live preview → sendFusionPreview → stepText)
            # ════════════════════════════════════════════════════════════════════
            else:
                if step_text is None:
                    step_text = data.get('stepText', '')
                filename  = data.get('filename', 'terrain_preview.step')
                is_solid  = data.get('isSolid', False)
                _log(f'Single-step import: filename={filename}, isSolid={is_solid}, stepLen={len(step_text)}')

                if not step_text:
                    _log('ERROR: stepText is empty — import aborted')
                    if not is_preview:
                        _send_import_failed('No STEP data reached Fusion -- Send again.')
                    if ui: ui.messageBox('No STEP data received from palette.')
                    return

                tmp_path = os.path.join(tempfile.gettempdir(), filename)
                _log(f'Writing {len(step_text)} chars to {tmp_path}...')
                try:
                    with open(tmp_path, 'w', encoding='utf-8') as f:
                        f.write(step_text)
                    _log('File written OK.')
                except Exception as e:
                    _log(f'ERROR writing STEP file: {e}')
                    if ui: ui.messageBox('Failed to write STEP file:\n{}'.format(e))
                    return

                step_options           = import_mgr.createSTEPImportOptions(tmp_path)
                step_options.isViewFit = False
                comp_name              = filename.replace('.step', '').replace('terrain_preview_', 'Terrain_').replace('_', ' ')
                
                import_target_comp = current_import_group.component if (not is_preview and 'current_import_group' in globals() and current_import_group and current_import_group.isValid) else root_comp
                initial_count          = import_target_comp.occurrences.count
                _send_progress("Importing to Fusion...")
                try:
                    ok = import_mgr.importToTarget(step_options, import_target_comp)
                    if not ok:
                        raise RuntimeError('importToTarget returned False')

                    newly_added = []
                    for i in range(initial_count, import_target_comp.occurrences.count):
                        try:
                            occ = import_target_comp.occurrences.item(i)
                            if occ and occ.isValid:
                                if any(kw in occ.component.name for kw in ('Component', 'Part')):
                                    occ.component.name = comp_name
                                newly_added.append(occ)
                        except Exception:
                            pass

                    # v41: Fix append logic for single-step
                    if is_append:
                        last_imported_occurrences.extend(newly_added)
                    else:
                        last_imported_occurrences = newly_added
                    _log(f'Imported {len(newly_added)} occurrence(s).')

                    # Smart Visibility
                    if len(newly_added) > 1:
                        best_occ, max_p = None, -1
                        for occ in newly_added:
                            name_parts = [occ.component.name.lower(), occ.name.lower()]
                            try:
                                for b in occ.component.bRepBodies:
                                    name_parts.append(b.name.lower())
                            except Exception: pass
                            nm = ' '.join(name_parts)
                            p  = 4 if ('stamped' in nm and 'solid' in nm) else \
                                 3 if  'stamped' in nm else \
                                 2 if  'solid'   in nm else \
                                 1 if  'surface' in nm else 0
                            if p > max_p:
                                max_p, best_occ = p, occ
                        if best_occ:
                            primary_imported_occurrence = best_occ
                            _log(f'[VISIBILITY] Primary: "{best_occ.component.name}"')
                            for occ in newly_added:
                                # v41: Respect isVisible flag
                                try: occ.isLightBulbOn = (occ == best_occ and is_visible)
                                except Exception: pass
                        else:
                            for occ in newly_added:
                                try: occ.isLightBulbOn = is_visible
                                except Exception: pass
                    elif newly_added:
                        primary_imported_occurrence = newly_added[0]
                        for occ in newly_added:
                            try: occ.isLightBulbOn = is_visible
                            except Exception: pass

                except Exception as e:
                    _log(f'importToTarget failed: {e}')
                    if is_preview: return
                    _log('Retry: importToNewDocument...')
                    try:
                        import_mgr.importToNewDocument(step_options)
                        _log('importToNewDocument OK (opened in new tab)')
                        # If we open in a new document, we can't track it in the session
                        if not is_append: last_imported_occurrences = []
                    except Exception as e2:
                        _log(f'Final failure: {e2}')
                        _send_import_failed(f'Fusion could not import the STEP: {e2}')
                        if ui: ui.messageBox('Failed to import STEP:\n{}'.format(e2))
                        return

            # ── UNIFIED post-import consolidation ────────────────────────────────
            # After EITHER the multi-variant or single-step path runs, walk
            # whatever occurrences ended up inside B-Spline Set and fold any
            # Clean Solid + Clean Surface (and Stamped equivalents) into max
            # 2 components ("Clean" / "Stamped") with body names "panel" /
            # "surface".
            #
            # This block exists (in addition to the inline multi-variant
            # consolidation) because some JS export paths split the output
            # into back-to-back single-stepText calls -- one for cleanSolid,
            # then one for cleanSurface with isAppend=True. Each lands in
            # the SINGLE-STEP Python path, so consolidation has to run
            # every time the import handler completes.
            #
            # Idempotent: if multi-variant already consolidated, this finds
            # the merged components and bucketing produces zero work.
            if not is_preview:
                try:
                    if 'current_import_group' in globals() and current_import_group and current_import_group.isValid:
                        # Iterate the import target's children. childOccurrences
                        # returns proxies in this occurrence's context (vs.
                        # comp.occurrences which returns natives); the
                        # difference is harmless here -- _post_import_setup
                        # only renames in-place, no occurrence reparenting.
                        all_siblings = []
                        try:
                            kids = current_import_group.childOccurrences
                            for i in range(kids.count):
                                try:
                                    occ = kids.item(i)
                                    if occ and occ.isValid:
                                        all_siblings.append(occ)
                                except Exception: pass
                        except Exception as e:
                            _log(f'[CONSOLIDATE] sibling enum failed: {e}')

                        if all_siblings:
                            before = len(all_siblings)
                            consolidated = _post_import_setup(all_siblings)
                            after = len(consolidated)
                            _log(f'[POST-IMPORT] occurrences: {before} -> {after} occurrence(s)')

                            # Track the consolidated set so future
                            # _remove_last_import() targets the live nodes
                            # rather than the deleted sibling references.
                            if is_append:
                                # In append mode last_imported_occurrences may
                                # also hold occurrences from prior runs; keep
                                # only the still-valid ones plus consolidated.
                                live = [o for o in last_imported_occurrences
                                        if (o is not None and getattr(o, 'isValid', False))]
                                last_imported_occurrences = live + [
                                    o for o in consolidated if o not in live
                                ]
                            else:
                                last_imported_occurrences = list(consolidated)

                            # Re-pick primary -- prefer Stamped (if it actually
                            # carries a 'panel' body), fall back to first
                            # consolidated occurrence.
                            def _has_panel_body(o):
                                try:
                                    for i in range(o.component.bRepBodies.count):
                                        nm = (o.component.bRepBodies.item(i).name or '').lower()
                                        if _is_panel_body_name(nm):
                                            return True
                                except Exception:
                                    pass
                                return False

                            stamped_with_panel = None
                            for occ in consolidated:
                                try:
                                    nm = (occ.component.name or '').lower()
                                except Exception: nm = ''
                                if 'stamped' in nm and _has_panel_body(occ):
                                    stamped_with_panel = occ
                                    break

                            best = stamped_with_panel
                            if not best and consolidated:
                                best = consolidated[0]
                            if best:
                                primary_imported_occurrence = best

                            # Visibility rules (final):
                            #   Body level — ALWAYS:
                            #     panel  → visible
                            #     surface → hidden
                            #   Component (occurrence) level:
                            #     - If a Stamped (with panel) exists, it's the
                            #       primary visible occurrence; Clean is hidden.
                            #     - If only Clean exists, Clean is the visible
                            #       occurrence.
                            def _set_body_visibility(occ):
                                """Panels visible, surfaces hidden — unconditionally."""
                                try:
                                    for i in range(occ.component.bRepBodies.count):
                                        b  = occ.component.bRepBodies.item(i)
                                        bn = (b.name or '').lower()
                                        if _is_panel_body_name(bn):
                                            try: b.isLightBulbOn = True
                                            except Exception: pass
                                        elif _is_surface_body_name(bn):
                                            try: b.isLightBulbOn = False
                                            except Exception: pass
                                except Exception as e:
                                    _log(f'[VISIBILITY] body toggle failed: {e}')

                            # Stamp body visibility on every consolidated occurrence first
                            # — same rule everywhere, doesn't depend on which one is primary.
                            for occ in consolidated:
                                _set_body_visibility(occ)

                            # Then occurrence visibility: only the primary lights up.
                            #
                            # NOTE: we IGNORE the per-call `is_visible` flag here.
                            # JS sends `isVisible: false` for surface-variant calls
                            # (e.g. cleanSurface, stampedSurface) so they don't
                            # visually clash with the solid imports. After
                            # consolidation that signal is meaningless: the surface
                            # body is already inside the same component as the
                            # panel and is hidden body-side. The consolidated
                            # primary occurrence (panel-bearing) must be visible
                            # so the user can see the panel that just landed.
                            # If we honor `is_visible` here, the LAST call's
                            # value wins — and surface calls run last in the
                            # back-to-back single-step pattern, so Stamped
                            # ends up dark even though it should be primary.
                            for occ in consolidated:
                                try: occ.isLightBulbOn = (occ is best)
                                except Exception: pass

                            if stamped_with_panel is not None:
                                _log('[VISIBILITY] Stamped panel is primary; Clean occurrence hidden. Surfaces hidden.')
                            elif best:
                                try:
                                    _log(f'[VISIBILITY] Primary: "{best.component.name}" (only Clean). Surface hidden, panel visible.')
                                except Exception: pass
                except Exception as e:
                    _log(f'[CONSOLIDATE] post-import failed: {e}')

            # ── SVG Stamping (applied to primary body) ───────────────────────────
            _send_progress('Analyzing Stamping Surface...')
            _log(f'SVG Stamping Check: active_layers={len(stamp_data.get("layers", [])) if stamp_data else "NoData"}, orientation={orientation}')
            if stamp_data and stamp_data.get('enabled'):
                try:
                    body_target = root_comp
                    if primary_imported_occurrence:
                        body_target = primary_imported_occurrence.component
                    elif last_imported_occurrences:
                        body_target = last_imported_occurrences[0].component
                        
                    sketch_target = current_import_group.component if ('current_import_group' in globals() and current_import_group and current_import_group.isValid) else root_comp
                    _send_progress('Projecting SVG Artwork...')
                    self._import_all_svg_layers(sketch_target, body_target, stamp_data, orientation, params, des)
                except Exception as e:
                    _log(f'SVG Stamp Import/Project failed: {e}')

            # ── Finalise ─────────────────────────────────────────────────────────
            _send_progress('Cleaning up graphics...')
            _clear_custom_graphics()
            if not is_preview:
                # STALE-PARAMS R4 item 4 (ruling 7, "ONE call ... after
                # geometry"): board + lattice params created/updated by
                # THIS Send are already synced (params sync ran near the
                # top of this function; the lattice manifests' own params
                # were synced inside _import_all_svg_layers above, which
                # has now returned) — so `des.userParameters` reflects the
                # post-Send state the reference guard needs to see (2d).
                # Guarded exactly like every other post-import step in this
                # function: a failure here is logged, never shown to Fred,
                # never blocks the Send that already succeeded.
                try:
                    payload_names = set(params.keys())
                    for layer in (stamp_data.get('layers', []) if stamp_data else []):
                        manifest = _layer_manifest(layer) or {}
                        for p in manifest.get('parameters', []) or []:
                            if p.get('name'):
                                payload_names.add(p['name'])
                    stale = compute_stale_params(des.userParameters, payload_names, logger=_LogAdapter())
                    _merge_last_send_key('stale_params', stale)
                    if stale['deleted'] or stale['failed']:
                        _log(f'[STALE PARAMS] deleted={stale["deleted"]} adopted={stale["adopted"]} '
                             f'kept_referenced={[k["name"] for k in stale["kept_referenced"]]} failed={stale["failed"]}')
                except Exception as e:
                    _log(f'[STALE PARAMS] cleanup pass failed (Send itself unaffected): {e}')
                importing_done = True
                _send_progress('Finalizing Import...')
                _log('Import session finalized.')

            pal = app.userInterface.palettes.itemById(PALETTE_ID)
            if pal:
                pal.sendInfoToHTML('import_success', '{}')

        except Exception:
            tb = traceback.format_exc()
            _log(f'_handle_generate EXCEPTION:\n{tb}')
            if not data.get('isPreview', False):
                _send_import_failed('The Send failed in Fusion -- see the message there (and the add-in log).')
            if ui: ui.messageBox('Error in generate:\n{}'.format(tb))

    def _import_all_svg_layers(self, sketch_target, body_target, stamp_data, orientation='z-up', params=None, design=None):
        """Processes multiple SVG layers if available, otherwise falls back to single SVG.

        T63 (SE15 §7): a layer carrying a `sketchManifest` (set by
        export-flow.js's own _fusionLayerManifest, gated on the SAME
        includeSVG toggle as `.svg`) gets a REAL constrained sketch via
        build_constrained_sketch. T74 AMEND 5 (Fred, live: a hand-drawn
        layer was sent as a LATTICE constrained sketch instead of its own
        artwork): a manifest is now attached ONLY when the layer actually
        contains pieces owned by that pattern (export-flow.js's own fix),
        and building the constrained sketch no longer EXCLUDES the plain
        SVG import — a MIXED layer (lattice content AND hand-drawn/other
        elements) gets BOTH: the constrained sketch for the lattice, then
        whatever's left of `svg` (export-flow.js already strips that same
        pattern's own lattice/contour content out of it whenever a
        manifest is attached, so this never duplicates the sketch's own
        geometry). A layer with no manifest at all still gets its full,
        unfiltered `svg` imported, exactly as before this turn.

        The one narrow, pre-existing edge case this doesn't fully solve:
        if `design` is falsy (no active Design in scope), the constrained
        sketch is skipped entirely — but export-flow.js has ALREADY
        stripped the lattice/contour content out of `svg` before sending,
        having no way to know whether Python will find a usable `design`
        at import time. That lattice content is lost for this one
        request (a pre-existing "manifest present but no Design" fallback
        was already degraded before this turn — it never built a
        constrained sketch either — this turn just narrows what the
        fallback recovers, from the full flat geometry to none)."""
        layers = stamp_data.get('layers', [])

        if not layers:
            # Legacy Fallback: Single master SVG
            svg_text = stamp_data.get('svg')
            if svg_text:
                _log('[STAMP] No layers array found. Falling back to single master SVG import.')
                # Create a pseudo-layer for the legacy logic
                layers = [{
                    'index': 1,
                    'config': {
                        'profile': stamp_data.get('profile', 'unknown'),
                        'depth': stamp_data.get('depth', 0)
                    },
                    'svg': svg_text
                }]
            else:
                _log('[STAMP] No SVG data found in payload.')
                return

        _log(f'[STAMP] Processing {len(layers)} layer(s)...')

        # We find the top face ONCE to reuse for all layer projections
        top_face = None
        if body_target.bRepBodies.count > 0:
            body = body_target.bRepBodies.item(0)
            max_val = -1e9
            for face in body.faces:
                box = face.boundingBox
                val = box.maxPoint.y if orientation == 'y-up' else box.maxPoint.z
                if val > max_val:
                    max_val = val
                    top_face = face

        # T76 (SE17, item 5): a pattern's own kind-layers (contour/rails/
        # ties/nodes, identified by manifest['patternId']) share ONE
        # construction plane (coplanar sketches, so a LATER kind's own
        # `sketch.project()` of an EARLIER kind's curve is geometrically
        # meaningful — parametric_engine's own noted precedent for this
        # SAME real Fusion API), ONE BuildContext (so entity_map
        # accumulates across the group, letting a projection find what an
        # earlier call already built), and ONE kind->sketch-name map (so a
        # projection's own `sourceKind` resolves to the actual sketch to
        # project FROM). Keyed by patternId; empty/never-touched for any
        # plan with no kind-split pattern in it at all, in which case
        # every step behaves exactly as it always has (its own fresh plane,
        # its own fresh ctx, via build_constrained_sketch's own `ctx=None`
        # default).
        pattern_planes = {}
        pattern_ctx = {}
        pattern_kind_to_sketch = {}

        for step in _ordered_svg_layer_import_plan(layers, design is not None):
            sketch_name = step['sketch_name']
            manifest = step.get('manifest')
            pattern_id = manifest.get('patternId') if manifest else None

            # T74 AMEND 5: ONE construction plane per layer, computed lazily
            # (only if this layer actually imports something) and SHARED by
            # both import paths below — previously each path computed its
            # own, so a mixed layer would have ended up with two identically
            # -named, identically-placed planes for no reason. T76 (SE17):
            # a kind-split pattern's own steps instead share ONE plane
            # across the WHOLE group (see this loop's own header comment).
            plane = pattern_planes.get(pattern_id) if pattern_id else None

            if step['build_constrained']:
                _log(f'[SE15] Starting constrained-sketch build: {sketch_name}')
                if plane is None:
                    plane_name = f"pattern {pattern_id}" if pattern_id else sketch_name
                    plane = self._compute_artwork_plane(sketch_target, plane_name, top_face, orientation)
                    if pattern_id:
                        pattern_planes[pattern_id] = plane
                ctx = pattern_ctx.get(pattern_id) if pattern_id else None
                kind_to_sketch = pattern_kind_to_sketch.setdefault(pattern_id, {}) if pattern_id else None
                used_ctx = self._build_constrained_sketch_for_layer(
                    sketch_target, design, manifest, sketch_name, plane, ctx=ctx, kind_to_sketch=kind_to_sketch)
                if pattern_id and ctx is None:
                    pattern_ctx[pattern_id] = used_ctx
            elif step['manifest_skipped_no_design']:
                _log(f'[SE15] Manifest present for {sketch_name} but no active Design in scope — constrained sketch skipped; importing whatever plain SVG remains.')

            if step['import_svg']:
                _log(f'[STAMP] Starting Import: {sketch_name}')
                if plane is None:
                    plane = self._compute_artwork_plane(sketch_target, sketch_name, top_face, orientation)
                self._import_single_layer_svg(sketch_target, step['svg'], plane, sketch_name, params)

    def _compute_artwork_plane(self, sketch_target, sketch_name, top_face, orientation='z-up'):
        """The SAME offset-above-peak construction plane every flat 2D
        sketch import (SVG stamp OR, since T63, a constrained sketch)
        lands on (SE15's own open question #4, kept at today's default
        per the advisor's "Answers": "keep _import_single_layer_svg's
        construction-plane placement... revisit after use"). T74 AMEND 5:
        called ONCE per layer by _import_all_svg_layers, which then hands
        the SAME plane object to whichever of _build_constrained_sketch_
        for_layer / _import_single_layer_svg actually runs (a mixed layer
        runs both, on the ONE plane, not two identically-placed ones)."""
        if orientation == 'y-up':
            target_plane = sketch_target.xZConstructionPlane
        else:
            target_plane = sketch_target.xYConstructionPlane

        peak_h = 2.0
        if top_face:
            box = top_face.boundingBox
            peak_h = box.maxPoint.y if orientation == 'y-up' else box.maxPoint.z

        offset_val = adsk.core.ValueInput.createByReal(peak_h + 5.0)
        planes = sketch_target.constructionPlanes
        plane_input = planes.createInput()
        plane_input.setByOffset(target_plane, offset_val)
        artwork_plane = planes.add(plane_input)
        artwork_plane.name = f"Plane for {sketch_name}"
        return artwork_plane

    def _build_constrained_sketch_for_layer(self, sketch_target, design, manifest, sketch_name, plane, ctx=None, kind_to_sketch=None):
        """T63 (SE15 §7): builds a real constrained sketch for one layer,
        via sketch_manifest_builder.build_constrained_sketch — placed on
        `plane` (T74 AMEND 5: computed ONCE by the caller and shared with
        `_import_single_layer_svg` for a mixed layer, rather than each
        path minting its own identically-placed, identically-named
        construction plane). Failures here are caught and logged, never
        abort the rest of _handle_generate's own per-layer loop (same
        "skip + report" discipline build_constrained_sketch's own
        internals already apply one level down).

        T64: names the sketch to match the plain-SVG path's own scheme
        (`Source - {sketch_name} [constrained]`, e.g. "Source - L1 - vbit
        (0.25\") [constrained]") instead of letting build_constrained_sketch
        fall back to the manifest's own generic `sketchName` field
        ("Layer 1") — the advisor's own real Fusion run found the mismatch.

        T76 (SE17, item 5): `ctx`/`kind_to_sketch`, when given by the
        caller (a kind-split pattern's own later steps), are passed
        straight through to build_constrained_sketch so this sketch's own
        projections can resolve an earlier kind's own entities, and so
        THIS sketch registers itself for whichever LATER kind still needs
        to find it. When `ctx` is omitted (the first step of a pattern
        group, or any standalone layer), a fresh one is created here (not
        left for build_constrained_sketch's own internal default) so it
        can be RETURNED to the caller, which caches it for the group's own
        remaining steps — build_constrained_sketch itself has no way to
        hand back a ctx it created internally, only to mutate one it was
        already given. Returns the ctx used (whether freshly created here
        or the one passed in), so the caller always has it to cache."""
        if ctx is None:
            ctx = BuildContext(sketch_target, design, logger=None, prefix="SE15")
        try:
            summary = build_constrained_sketch(
                sketch_target, design, manifest, placement=plane, log_fn=_log,
                sketch_name_override=f"Source - {sketch_name} [constrained]",
                ctx=ctx, kind_to_sketch=kind_to_sketch)
            # ADD1 (measured live): this log used to read summary['offsets']
            # inline here — see constrained_sketch_log.py's own module
            # docstring for why that raised KeyError on every SUCCESSFUL
            # build and what replaced it.
            _log(format_constrained_sketch_log(sketch_name, summary))
        except Exception as e:
            _log(f'[SE15] Constrained sketch build failed for {sketch_name}: {e}')
        return ctx

    def _import_single_layer_svg(self, sketch_target, svg_text, plane, sketch_name, params=None):
        """Imports a single SVG string and projects it onto `plane` (T74
        AMEND 5: computed ONCE by the caller and shared with
        _build_constrained_sketch_for_layer for a mixed layer, rather
        than minting a second, identically-placed construction plane)."""
        try:
            dpi = 96.0 # standard
            # DYNAMIC SCALE: Use design's board size or FALLBACK to 7x9 only if missing
            board = _get_current_board_size()
            width_in  = float(params.get('widthIn', board['widthIn'])) if params else board['widthIn']
            height_in = float(params.get('heightIn', board['heightIn'])) if params else board['heightIn']

            # 1. Coordinate Transform (Pre-scale to pixels)
            svg_text = _prescale_svg(svg_text, int(dpi), width_in, height_in)

            # 2. Write to temp file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.svg', delete=False, encoding='utf-8') as tmp:
                tmp.write(svg_text)
                tmp_path = tmp.name

            # 3. Create Sketch and Import
            sketch = sketch_target.sketches.add(plane)
            sketch.name = f"Source - {sketch_name}"

            import_mgr = adsk.core.Application.get().importManager
            svg_options = import_mgr.createSVGImportOptions(tmp_path)
            svg_options.scale = 1.0
            import_mgr.importToTarget(svg_options, sketch)


            # 4. Preserving Calibration Boundary Lines (User likes them for alignment)
            _log(f'[STAMP] Preserving 7x9 border lines for {sketch_name}')

            # Cleanup temp file
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        except Exception as e:
            _log(f'[STAMP] Error in layer {sketch_name}: {e}')

# ── Command constants ─────────────────────────────────────────────────────────
COMMAND_ID      = 'fusionHybridCommand'
COMMAND_NAME    = 'B-Spline'
COMMAND_TOOLTIP = 'Procedural B-Spline Surface & Solid Engine (Fusion 360 Add-in)'



# ── CommandExecuteHandler — opens / shows the palette ────────────────────────
class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            global importing_done, chunk_buffer
            palettes = ui.palettes
            palette  = palettes.itemById(PALETTE_ID)
            if not palette:
                current_dir = os.path.dirname(os.path.realpath(__file__))
                html_path   = os.path.join(current_dir, PALETTE_HTML).replace('\\', '/')
                _log(f'Creating palette, html_path={html_path}')
                palette = palettes.add(
                    PALETTE_ID, PALETTE_NAME, html_path,
                    True, True, True, 1000, 850
                )
                palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
                onHTMLEvent = PaletteHTMLEventHandler()
                palette.incomingFromHTML.add(onHTMLEvent)
                handlers.append(onHTMLEvent)

                onClosed = PaletteClosedHandler()
                palette.closed.add(onClosed)
                handlers.append(onClosed)

                _log('Palette created/wired (HTML + Closed events)')
            else:
                _log('Palette already exists — making visible and resetting UI state')
                # Reset completion/payload state when user reopens the palette so
                # stale polling from a prior export cannot immediately re-close it.
                importing_done = False
                chunk_buffer = []
                palette.isVisible = True
                palette.sendInfoToHTML('reset_ui', '{}')
        except Exception:
            tb = traceback.format_exc()
            _log(f'CommandExecute FAILED:\n{tb}')
            if ui:
                ui.messageBox('Command Execute Failed:\n{}'.format(tb))


# ── CommandCreatedHandler ─────────────────────────────────────────────────────
class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            command   = args.command
            onExecute = CommandExecuteHandler()
            command.execute.add(onExecute)
            handlers.append(onExecute)
            _log('CommandCreated: execute handler wired')
        except Exception:
            tb = traceback.format_exc()
            _log(f'CommandCreated FAILED:\n{tb}')
            if ui:
                ui.messageBox('Command Created Failed:\n{}'.format(tb))




# ── run ───────────────────────────────────────────────────────────────────────



def run(context):
    # run probe: removed diagnostic
    # run probe: removed
    try:
        _log("--- SESSION STARTED ---")
        # _direct_write removed
        global ui
        _log('--- run() start ---')
        _log(f'Fusion version: {app.version}')
        # _direct_write removed

        cmd_defs = ui.commandDefinitions
        _log('cmd_defs obtained')

        # --- A. Main Palette Command ---
        cmd_def  = cmd_defs.itemById(COMMAND_ID)
        if cmd_def:
            _log(f'Deleting existing cmd_def: {COMMAND_ID}')
            cmd_def.deleteMe()

        res_folder = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'resources')
        _log(f'res_folder: {res_folder}  exists={os.path.isdir(res_folder)}')
        cmd_def = cmd_defs.addButtonDefinition(COMMAND_ID, COMMAND_NAME, COMMAND_TOOLTIP, res_folder)
        _log('Main cmd_def created')
        onCommandCreated = CommandCreatedHandler()
        cmd_def.commandCreated.add(onCommandCreated)
        handlers.append(onCommandCreated)
        _log('CommandCreatedHandler wired')


        # Find workspace → tab → panel (three-level fallback)
        ws = ui.workspaces.itemById('FusionSolidEnvironment')
        _log(f'FusionSolidEnvironment ws: {ws}')
        if not ws: ws = ui.workspaces.itemById('SolidEnvironment')
        if not ws: ws = ui.activeWorkspace
        _log(f'workspace found: {ws is not None} id={getattr(ws, "id", "n/a")}')

        if ws:
            tab = ws.toolbarTabs.itemById('SolidTab')
            _log(f'SolidTab: {tab}')
            if not tab:
                for t in ws.toolbarTabs:
                    _log(f'  scanning tab: id={t.id} name={t.name}')
                    if 'Solid' in t.id or 'Solid' in t.name:
                        tab = t; break

            _log(f'tab resolved: {tab is not None}')
            if tab:
                panel_id = 'SymmetricBSplinePanel'
                panel = tab.toolbarPanels.itemById(panel_id)
                _log(f'existing panel: {panel is not None}')
                if not panel:
                    panel = tab.toolbarPanels.add(panel_id, 'B-Spline', '', False)
                    _log('panel created')

                if panel:
                    cntrl = panel.controls.itemById(COMMAND_ID)
                    if cntrl: cntrl.deleteMe()
                    panel.controls.addCommand(cmd_def)
                    _log('Main button added to panel')

                    _log('--- run() complete — toolbar button should be visible ---')
                    # _direct_write removed
                else:
                    _log('ERROR: Could not create/find panel')
                    # _direct_write removed
            else:
                _log('ERROR: Solid tab not found')
                # _direct_write removed
                if ui: ui.messageBox('Could not find Solid tab in Design workspace.')
        else:
            _log('ERROR: Design/Solid workspace not found')
            # _direct_write removed
            if ui: ui.messageBox('Could not find Design/Solid workspace.')

    except Exception:
        tb = traceback.format_exc()
        _log(f'run() EXCEPTION:\n{tb}')
        # _direct_write removed
        if ui:
            ui.messageBox('Run Failed:\n{}'.format(tb))


# ── stop ──────────────────────────────────────────────────────────────────────
def stop(context):
    try:
        global ui
        _log("--- SESSION STOPPED ---")
        _log('--- stop() start ---')

        # 1. Remove any leftover preview geometry only. Keep final imported bodies.
        _clear_custom_graphics()

        # 2. Delete the palette
        palette = ui.palettes.itemById(PALETTE_ID)
        if palette:
            palette.deleteMe()
            _log('Palette deleted')

        # 3. Remove toolbar button
        ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if not ws: ws = ui.workspaces.itemById('SolidEnvironment')
        if ws:
            tab = ws.toolbarTabs.itemById('SolidTab')
            if not tab:
                for t in ws.toolbarTabs:
                    if 'Solid' in t.id or 'Solid' in t.name:
                        tab = t; break
            if tab:
                panel = tab.toolbarPanels.itemById('SymmetricBSplinePanel')
                if panel:
                    cntrl = panel.controls.itemById(COMMAND_ID)
                    if cntrl: cntrl.deleteMe()

                    if panel.controls.count == 0:
                        panel.deleteMe()

        # 4. Remove command definition
        cmd_def = ui.commandDefinitions.itemById(COMMAND_ID)
        if cmd_def: cmd_def.deleteMe()

        _log('--- stop() complete ---')

    except Exception:
        tb = traceback.format_exc()
        _log(f'stop() EXCEPTION:\n{tb}')
        if ui:
            ui.messageBox('Stop Failed:\n{}'.format(tb))
    finally:
        handlers.clear()
   