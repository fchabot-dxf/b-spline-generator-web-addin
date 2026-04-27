# b-spline-gen.py
# Hybrid palette + native canvas terrain add-in.
# Palette (HTML/JS) handles the UI; Python handles canvas preview and STEP import.

# Probe: removed diagnostic

import adsk.core, adsk.fusion, adsk.cam, traceback

# adsk check: removed diagnostic

import os, tempfile, json, re
from datetime import datetime

# imports check: removed diagnostic


def _prescale_svg(svg_text, scale, width_in=7.0, height_in=9.0):
    """
    Pre-scale, pre-flip Y, and pre-center SVG coordinates for Fusion 360 import.

    ROOT CAUSE: Fusion's SVG importer reads coordinates as raw pixels (1 unit = 1/96 inch),
    ignoring width/height/viewBox and svg_options.scale entirely.

    This single transform bakes everything in so the sketch lands correctly with NO
    sketch.move() required:
      - Scale:   inch-units → pixel-units  (x96)
      - Flip Y:  SVG Y goes down; negate so artwork is right-side-up in Fusion
      - Center:  shift so board center lands on the world origin (0, 0)

    Result after Fusion import:
      x  in [-w_cm/2,  w_cm/2]   e.g. [-8.89,  +8.89] cm for a 7-inch wide board
      y  in [-h_cm/2,  h_cm/2]   e.g. [-11.43, +11.43] cm for a 9-inch tall board
    """
    w_px   = width_in  * scale   # e.g. 7  * 96 = 672
    h_px   = height_in * scale   # e.g. 9  * 96 = 864
    half_w = w_px / 2            # 336
    half_h = h_px / 2            # 432

    def transform_coord(x_str, y_str):
        new_x = float(x_str) * scale - half_w   # scale + center X
        # FLIP + Shift: cad_y = (half_h - svg_y * scale) - 0.5 * scale (to fix drift)
        new_y = (half_h - float(y_str) * scale) - (0.5 * scale)
        return f'{new_x:.4f},{new_y:.4f}'

    def scale_pair(m):
        return transform_coord(m.group(1), m.group(2))

    # 1. Transform positional attributes x, y, cx, cy (Bake centering + scaling)
    def scale_x_attr(m):
        return f'{m.group(1)}="{float(m.group(2)) * scale - half_w:.4f}"'
    svg_text = re.sub(r'\b(x|cx)="([^"]+)"', scale_x_attr, svg_text)

    def scale_y_attr(m):
        # FLIP Y + Shift: cad_y = (half_h - svg_y * scale) - 0.5 * scale (to fix drift)
        val = (half_h - float(m.group(2)) * scale) - (0.5 * scale)
        return f'{m.group(1)}="{val:.4f}"'
    svg_text = re.sub(r'\b(y|cy)="([^"]+)"', scale_y_attr, svg_text)

    # 2. Transform scale-only attributes (width, height, r, rx, ry, font-size)
    def scale_only_attr(m):
        return f'{m.group(1)}="{float(m.group(2)) * scale:.4f}"'
    svg_text = re.sub(r'\b(width|height|r|rx|ry|font-size)="([^"]+)"', scale_only_attr, svg_text)

    # 3. Transform polyline/polygon points="x1,y1 x2,y2 ..."
    def scale_pts(m):
        return 'points="' + re.sub(r'([-\d.]+),([-\d.]+)', scale_pair, m.group(1)) + '"'
    svg_text = re.sub(r'points="([^"]+)"', scale_pts, svg_text)

    # 4. Transform path d="M x,y L x,y C x1,y1 x2,y2 x,y ..."
    def scale_d(m):
        return 'd="' + re.sub(r'([-\d.]+),([-\d.]+)', scale_pair, m.group(1)) + '"'
    svg_text = re.sub(r'\bd="([^"]+)"', scale_d, svg_text)

    # 5. Update viewBox to centered pixel coordinate space
    svg_text = re.sub(
        r'viewBox="[^"]+"',
        f'viewBox="{-half_w:.0f} {-half_h:.0f} {w_px:.0f} {h_px:.0f}"',
        svg_text
    )

    return svg_text

handlers = []
ui  = None
app = adsk.core.Application.get()
if app:
    ui = app.userInterface

# ── Log file ──────────────────────────────────────────────────────────────────

def get_log_path():
    """
    Returns the log file path, preferring the developer source folder.

    The deploy script writes workspace_link.json next to this .py file with the
    absolute path to the source workspace root.  When that file is present the
    log is written there so it stays in the dev tree for easy inspection.
    Falls back to the directory next to this .py file if the link is missing.
    """
    addin_dir = os.path.dirname(os.path.realpath(__file__))
    link_file  = os.path.join(addin_dir, 'workspace_link.json')
    try:
        if os.path.isfile(link_file):
            with open(link_file, 'r', encoding='utf-8') as f:
                link = json.load(f)
            workspace_root = link.get('workspace_root', '').replace('/', os.sep)
            if workspace_root and os.path.isdir(workspace_root):
                return os.path.join(workspace_root, 'b_spline_gen_log.txt')
    except Exception:
        pass
    # Fallback: log next to the deployed .py file
    return os.path.join(addin_dir, 'b_spline_gen_log.txt')

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
    except:
        # Fail silently if the OS prevents file access
        pass

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
    except: pass


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
            except: pass
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
        except: pass
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


def _consolidate_bspline_variants(occurrences):
    """Group up to 4 imported variants ("Clean Solid", "Clean Surface",
    "Stamped Solid", "Stamped Surface") into max 2 occurrences ("Clean"
    and "Stamped"), each holding both the thickened solid body (renamed
    ``panel``) and the source surface body (renamed ``surface``) in the
    same component.

    This makes the downstream tree easier to read AND lets
    CAM-builder's classifier work on stable body names rather than
    component-name patterns. Single-variant runs still produce one
    consolidated occurrence; runs with only solids or only surfaces
    keep just whichever bodies exist.

    Strategy:
      1. Bucket occurrences by base ('Clean' | 'Stamped') and kind
         ('solid' | 'surface'). Anything we can't classify (e.g.
         analytical thick-region surfaces) is left alone and returned
         as-is.
      2. For each base, pick a "home" occurrence -- preferring the
         solid one because it's usually the one users care about.
         Rename its component to the base ("Clean" / "Stamped") and
         rename its body to "panel" or "surface".
      3. Copy bodies from sibling occurrences into the home component
         using ``BRepBody.copyToComponent``, naming them appropriately.
         Delete the now-empty sibling occurrences.

    Returns the trimmed list of consolidated + un-classified
    occurrences, suitable for replacing ``all_newly_added``.
    """
    if not occurrences:
        return occurrences

    # Snapshot timeline length so we can group whatever this consolidation
    # adds (CopyPasteBodies features, occurrence deletions, etc.) under a
    # single expandable timeline row.
    _tl_start = _timeline_marker_safe()

    # 1. Bucket
    #
    # Recognize three name patterns:
    #   a) Fresh STEP import: 'terrain clean solid' / 'terrain stamped surface' etc.
    #      → classified by 'clean|stamped' + 'solid|surface' tokens in the comp name.
    #   b) Already-consolidated by a prior pass: comp name is exactly 'Clean' or
    #      'Stamped' (or Fusion-suffixed 'Clean (1)') AND it owns 'panel'/'surface'
    #      bodies. We must classify these so the next single-step import folds
    #      INTO them instead of becoming a sibling. This is the back-to-back
    #      single-step case (cleanSolid call → 'Clean' + panel, then cleanSurface
    #      call → 'terrain clean surface' lands as a new sibling and must merge
    #      into the existing 'Clean').
    buckets = {}   # base -> {'solid': [occ], 'surface': [occ]}
    other   = []
    for occ in occurrences:
        try:
            cname_raw = occ.component.name or ''
        except Exception:
            other.append(occ)
            continue
        cname = cname_raw.lower()

        # Detect base from comp name tokens.
        if 'stamped' in cname:
            base = 'Stamped'
        elif 'clean' in cname:
            base = 'Clean'
        else:
            other.append(occ)
            continue

        # Detect kind from comp name tokens first (fresh-import path).
        kind = None
        if 'solid' in cname:
            kind = 'solid'
        elif 'surface' in cname:
            kind = 'surface'

        # If comp name has no kind token, it's an already-consolidated occurrence
        # (e.g. just 'Clean' or 'Clean (1)'). Inspect its body names: a
        # consolidated Clean has 'panel' (solid) and/or 'surface' (surface).
        # We bucket it under whichever kind(s) it has so a new sibling of the
        # missing kind gets folded into it. Prefer 'solid' as the home anchor
        # if both bodies are present.
        if kind is None:
            try:
                body_names = []
                for i in range(occ.component.bRepBodies.count):
                    try:
                        body_names.append((occ.component.bRepBodies.item(i).name or '').lower())
                    except Exception:
                        pass
            except Exception:
                body_names = []

            has_panel   = any(_is_panel_body_name(n)   for n in body_names)
            has_surface = any(_is_surface_body_name(n) for n in body_names)

            if has_panel:
                kind = 'solid'
            elif has_surface:
                kind = 'surface'
            else:
                # Comp name like 'Clean' but no recognizable bodies → leave alone.
                other.append(occ)
                continue

        bucket = buckets.setdefault(base, {'solid': [], 'surface': []})
        bucket[kind].append(occ)

    consolidated = []

    # 2. Per base: pick home, move bodies, delete siblings
    for base, bucket in buckets.items():
        # Prefer the first solid occurrence as home (panel is the
        # primary body people machine). Fall back to surface.
        home_occ = None
        home_kind = None
        if bucket['solid']:
            home_occ, home_kind = bucket['solid'][0], 'solid'
        elif bucket['surface']:
            home_occ, home_kind = bucket['surface'][0], 'surface'
        if home_occ is None:
            continue

        try:
            home_occ.component.name = base
        except Exception as e:
            _log(f"[CONSOLIDATE] rename home '{base}' failed: {e}")

        # Stamp the home component's bodies
        _stamp_body_name(home_occ, 'panel' if home_kind == 'solid' else 'surface')

        # Snapshot kind_counters BEFORE any copies so the freshly-copied
        # bodies aren't double-counted as "existing" when we figure out
        # suffix numbers. Counting after the copy loop made the rename
        # pass think there was already a 'surface' present and bump the
        # next one to 'surface_1' — even though that body WAS the only
        # surface (which is what produced 'surface_1 (1)' in the tree).
        kind_counters = {'panel': 0, 'surface': 0}
        try:
            for i in range(home_occ.component.bRepBodies.count):
                try:
                    nm = (home_occ.component.bRepBodies.item(i).name or '').lower()
                except Exception:
                    nm = ''
                if _is_panel_body_name(nm):
                    kind_counters['panel'] += 1
                elif _is_surface_body_name(nm):
                    kind_counters['surface'] += 1
        except Exception:
            pass

        # Copy bodies from sibling occurrences into the home component using
        # the TemporaryBRepManager pattern, then delete the source occurrences,
        # THEN rename the new bodies.
        #
        # Why not BRepBody.copyToComponent any more?
        # ------------------------------------------
        # copyToComponent creates a parametric "Copy/Paste Bodies" timeline
        # feature that holds back-references to BOTH the source body AND the
        # source occurrence. We then have to delete the source occurrence in
        # the same pass (otherwise we'd end up with duplicate geometry in
        # sibling occurrences), which leaves the parametric reference in the
        # CopyPasteBodies feature DANGLING. Fusion flags this on the next
        # compute as two yellow-triangle warnings:
        #   "1 Reference Failures: The model is using cached geometry to solve."
        #   "1 Reference Failures: Failed to get target occurrence transform"
        # Wrapping in a BaseFeature doesn't help — copyToComponent's reference
        # is created at the parametric layer and survives BaseFeature wrapping.
        #
        # Replacement strategy:
        # 1. TemporaryBRepManager.copy(sb) gets us an in-memory body in
        #    sib_component LOCAL coordinates (no parametric reference at all).
        # 2. We compute the transform from sib's world space into home's
        #    local space (sib_world * inv(home_world)) and apply it to the
        #    transient body so it lands at the right world position. For
        #    STEP imports under the same parent this is typically identity,
        #    but we apply it defensively in case the wrapper or a sibling
        #    has been moved/rotated upstream.
        # 3. home_component.bRepBodies.add(transient, baseFeature) inserts
        #    the body into a BaseFeature edit on the HOME component (not
        #    cross-component) — no parametric back-reference to the source.
        # 4. After finishEdit(), sib_occ.deleteMe() runs as an ordinary
        #    parametric op with no dangling reference behind it.
        tbm = adsk.fusion.TemporaryBRepManager.get()

        # Compute inv(home_world) once per home for transform differentials.
        try:
            home_w = home_occ.transform2
            home_inv = home_w.copy()
            home_inv.invert()
        except Exception:
            home_inv = None

        # Open a single BaseFeature on the home component so all the new
        # bodies land in one timeline entry. No-op if the design is in
        # direct-edit mode (then the add() below auto-uses direct geometry).
        home_bf = None
        try:
            home_bf = home_occ.component.features.baseFeatures.add()
            home_bf.startEdit()
        except Exception as e:
            _log(f"[CONSOLIDATE] home BaseFeature wrap unavailable: {e}")
            home_bf = None

        # Track new bodies by POSITIONAL INDEX in home_occ.component.bRepBodies.
        # The body reference returned by bRepBodies.add(transient, base_feat)
        # is bound to the active BaseFeature edit; once finishEdit() commits,
        # that reference is stale and writes through it silently no-op
        # (verified in the field: bodies kept their auto-assigned 'Body2' name
        # and were later renamed to 'panel_1' by the next pass's
        # _stamp_body_name fallback). After finishEdit we MUST refetch the
        # body via home_occ.component.bRepBodies.item(index) to get a live
        # reference whose .name setter actually persists.
        index_renames = []  # [(idx, desired_name), ...]
        sibs_to_delete = []
        try:
            for sib_kind, sib_list in bucket.items():
                target_body_name = 'panel' if sib_kind == 'solid' else 'surface'
                for occ in sib_list:
                    if occ is home_occ:
                        continue
                    sibs_to_delete.append(occ)
                    try:
                        src_bodies = [occ.component.bRepBodies.item(i)
                                      for i in range(occ.component.bRepBodies.count)]
                    except Exception:
                        src_bodies = []

                    # Differential transform: sib_world * inv(home_world) so
                    # transient bodies in sib_local end up in home_local at
                    # the original world position.
                    xform = None
                    if home_inv is not None:
                        try:
                            sib_w = occ.transform2
                            xform = sib_w.copy()
                            xform.transformBy(home_inv)
                        except Exception:
                            xform = None

                    for sb in src_bodies:
                        try:
                            transient = tbm.copy(sb)
                            if xform is not None:
                                try:
                                    tbm.transform(transient, xform)
                                except Exception:
                                    pass
                            if home_bf is not None:
                                new_b = home_occ.component.bRepBodies.add(transient, home_bf)
                            else:
                                # Direct-edit fallback (no BaseFeature in
                                # direct mode — bRepBodies.add takes the
                                # transient directly).
                                new_b = home_occ.component.bRepBodies.add(transient)
                            # New body lands at the END of the collection.
                            # Capture its index NOW (still valid inside the
                            # edit) so we can refetch by position post-edit.
                            try:
                                new_idx = home_occ.component.bRepBodies.count - 1
                            except Exception:
                                new_idx = -1
                            # Belt-and-suspenders: also try renaming via the
                            # held ref while the edit is still open. Some
                            # Fusion versions accept this and persist the
                            # name through finishEdit; on others it no-ops.
                            try:
                                if new_b is not None:
                                    new_b.name = target_body_name
                            except Exception:
                                pass
                            if new_idx >= 0:
                                index_renames.append((new_idx, target_body_name))
                        except Exception as e:
                            _log(f"[CONSOLIDATE] tbm-copy/add failed for {target_body_name}: {e}; falling back to copyToComponent")
                            # Last-resort fallback so a TBM hiccup doesn't
                            # silently drop the body. The dangling-reference
                            # warning will come back on this code path but
                            # functional correctness is preserved. Track the
                            # fallback body the same way.
                            try:
                                fb = sb.copyToComponent(home_occ)
                                try:
                                    fb.name = target_body_name
                                except Exception:
                                    pass
                                try:
                                    fb_idx = home_occ.component.bRepBodies.count - 1
                                    if fb_idx >= 0:
                                        index_renames.append((fb_idx, target_body_name))
                                except Exception:
                                    pass
                            except Exception as ee:
                                _log(f"[CONSOLIDATE] copyToComponent fallback failed: {ee}")
        finally:
            if home_bf is not None:
                try:
                    home_bf.finishEdit()
                except Exception as e:
                    _log(f"[CONSOLIDATE] home BaseFeature finishEdit failed: {e}")

        # Rename via FRESH refs fetched from home_occ.component.bRepBodies.item(idx).
        # This is what actually makes the rename stick — the held new_b
        # references captured during the edit are stale post-finishEdit.
        for idx, desired in index_renames:
            try:
                if idx >= home_occ.component.bRepBodies.count:
                    _log(f"[CONSOLIDATE] index {idx} out of range (count={home_occ.component.bRepBodies.count})")
                    continue
                live = home_occ.component.bRepBodies.item(idx)
                if live is None or not live.isValid:
                    _log(f"[CONSOLIDATE] body at idx {idx} is invalid; skipping rename to '{desired}'")
                    continue
                # Apply suffix logic: kind_counters tracks how many of this
                # kind have already landed in the home, so a second 'surface'
                # becomes 'surface_1', third 'surface_2', etc.
                kind_key = 'panel' if desired == 'panel' else 'surface'
                already = kind_counters.get(kind_key, 0)
                target = desired if already == 0 else f"{desired}_{already}"

                # Skip if it already reads the target name (the in-edit
                # rename above may have already taken).
                try:
                    cur = (live.name or '')
                except Exception:
                    cur = ''
                if cur.lower() == target.lower():
                    kind_counters[kind_key] = already + 1
                    continue

                # Two-step rename to dodge Fusion's auto-uniquifier when the
                # target name happens to already exist in the design (the
                # cross-component 'surface' collision).
                tmp = f"_bsg_tmp_{idx}_{already}"
                try:
                    live.name = tmp
                except Exception as e:
                    _log(f"[CONSOLIDATE] tmp-rename failed at idx {idx}: {e}")
                try:
                    live.name = target
                except Exception as e:
                    _log(f"[CONSOLIDATE] rename to '{target}' failed at idx {idx}: {e}")
                try:
                    final = live.name
                    if final != target:
                        _log(f"[CONSOLIDATE] rename collision at idx {idx}: wanted '{target}' got '{final}'")
                except Exception:
                    pass
                kind_counters[kind_key] = already + 1
            except Exception as e:
                _log(f"[CONSOLIDATE] index_renames pass raised at idx {idx}: {e}")

        # Delete sib occurrences last so any failure above doesn't lose
        # geometry — the original sib bodies are still alive until this
        # loop runs.
        for occ in sibs_to_delete:
            try:
                if occ.isValid:
                    occ.deleteMe()
            except Exception as e:
                _log(f"[CONSOLIDATE] deleteMe sibling failed: {e}")

        consolidated.append(home_occ)

    # Collapse all the timeline entries we just produced into one named
    # group so the user isn't staring at a column of CopyPasteBodies +
    # occurrence-delete features. No-op in direct-edit mode.
    _wrap_timeline_in_group(_tl_start, "B-Spline Consolidate")

    return consolidated + other


def _apply_pending_renames(pending_renames, kind_counters):
    """Rename freshly-copied bodies to ``panel`` / ``surface`` (with
    ``_N`` suffixes if multiple of the same kind landed in the same
    home). Called from inside the BaseFeature edit so the body refs
    are still live.

    Behavior:
      - If the body already reads the target name (the pre-rename of
        the source body propagated through copyToComponent), SKIP the
        setter entirely. Re-assigning a body's current name is exactly
        what triggers Fusion's auto-uniquifier (``surface`` → ``surface (1)``).
      - Otherwise, do the defensive tmp-name dance (assign a unique
        temp name first to release any internal claim on the desired
        name, then assign the desired name).

    ``kind_counters`` is mutated as we go so suffixes are deterministic
    across calls.
    """
    for new_b, desired in pending_renames:
        already = kind_counters.get(desired, 0)
        target = desired if already == 0 else f"{desired}_{already}"

        actual = ''
        try:
            actual = (new_b.name or '')
        except Exception:
            pass
        if actual.lower() == target.lower():
            kind_counters[desired] = already + 1
            continue

        tmp = f"_bsg_tmp_{id(new_b)}_{already}"
        try:
            new_b.name = tmp
        except Exception as e:
            _log(f"[CONSOLIDATE] tmp-rename '{tmp}' failed: {e}")
        try:
            new_b.name = target
        except Exception as e:
            _log(f"[CONSOLIDATE] rename copied body to '{target}' failed: {e}")
        try:
            final = new_b.name
            if final != target:
                _log(f"[CONSOLIDATE] rename collision: wanted '{target}' got '{final}' (before='{actual}')")
        except Exception:
            pass
        kind_counters[desired] = already + 1


def _stamp_body_name(occ, name):
    """Rename BRepBodies in ``occ.component`` to ``name`` (the home kind:
    'panel' or 'surface'), but leave bodies already named with the OTHER
    semantic name alone. This protects re-consolidation passes: when a
    home already holds both ``panel`` AND ``surface`` and we stamp it
    with 'panel', the existing 'surface' body must NOT be renamed to
    'panel_1'. Only un-stamped bodies (or bodies already matching ``name``)
    get touched. Multiple un-stamped bodies get suffixed ``_1``, ``_2``."""
    try:
        bodies = [occ.component.bRepBodies.item(i)
                  for i in range(occ.component.bRepBodies.count)]
    except Exception:
        return

    SEMANTIC = ('panel', 'surface')
    other = 'surface' if name == 'panel' else 'panel'

    seq = 0
    for b in bodies:
        try:
            current = (b.name or '').lower()
        except Exception:
            current = ''
        # Skip bodies already correctly tagged as the OTHER semantic name —
        # they were placed by a prior consolidation pass and must be preserved.
        if current == other or current.startswith(other + '_'):
            continue
        # Already correctly named this kind? Leave it (and bump the suffix
        # counter so any further un-stamped bodies get _1/_2 etc.).
        if current == name:
            seq += 1
            continue
        try:
            b.name = name if seq == 0 else f"{name}_{seq}"
            seq += 1
        except Exception as e:
            _log(f"[CONSOLIDATE] body rename to '{name}' failed: {e}")
    # NOTE: visibility (panels visible, surfaces hidden) is decided centrally
    # in the post-import block, not here, because the rule depends on whether
    # a Stamped occurrence is taking primary stage. When only Clean exists,
    # surfaces stay visible.


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


# ── Palette HTML event handler ────────────────────────────────────────────────
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
                            except:
                                pass

                        _log(f'  Imported {len(newly_added)} occurrence(s) for "{v_name}".')
                        all_newly_added.extend(newly_added)

                    except Exception as e:
                        _log(f'  importToTarget failed for variant "{v_name}": {e}')
                        continue

                _log(f'[MULTI-VARIANT] Total occurrences imported (pre-consolidation): {len(all_newly_added)}')

                # Consolidate up to 4 imported occurrences into max 2
                # ("Clean" and/or "Stamped"), each holding the solid body
                # named "panel" and the surface body named "surface".
                # See _consolidate_bspline_variants() docstring for the
                # rationale -- short version: makes downstream MM body
                # filtering trivial since solid+surface stay paired.
                all_newly_added = _consolidate_bspline_variants(all_newly_added)
                _log(f'[MULTI-VARIANT] After consolidation: {len(all_newly_added)} occurrence(s)')

                # v41: Fix append logic to ensure all imported occurrences are tracked
                if is_append:
                    last_imported_occurrences.extend(all_newly_added)
                else:
                    last_imported_occurrences = all_newly_added

                # Smart Visibility: show Stamped if present, else Clean.
                # Priority: Stamped (2) > Clean (1) > everything else (0)
                best_occ, max_p = None, -1
                for occ in all_newly_added:
                    try:
                        nm = (occ.component.name or '').lower()
                    except Exception:
                        nm = ''
                    p = 2 if 'stamped' in nm else 1 if 'clean' in nm else 0
                    if p > max_p:
                        max_p, best_occ = p, occ

                if best_occ:
                    primary_imported_occurrence = best_occ
                    _log(f'[VISIBILITY] Primary: "{best_occ.component.name}" (priority={max_p})')
                    for occ in all_newly_added:
                        try: occ.isLightBulbOn = (occ == best_occ and is_visible)
                        except: pass
                elif all_newly_added:
                    primary_imported_occurrence = all_newly_added[0]
                    for occ in all_newly_added:
                        try: occ.isLightBulbOn = is_visible
                        except: pass

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
                        importing_done = True
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
                        except:
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
                            except: pass
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
                                except: pass
                        else:
                            for occ in newly_added:
                                try: occ.isLightBulbOn = is_visible
                                except: pass
                    elif newly_added:
                        primary_imported_occurrence = newly_added[0]
                        for occ in newly_added:
                            try: occ.isLightBulbOn = is_visible
                            except: pass

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
                        comp = current_import_group.component
                        all_siblings = []
                        try:
                            for i in range(comp.occurrences.count):
                                try:
                                    occ = comp.occurrences.item(i)
                                    if occ and occ.isValid:
                                        all_siblings.append(occ)
                                except: pass
                        except Exception as e:
                            _log(f'[CONSOLIDATE] sibling enum failed: {e}')

                        if all_siblings:
                            before = len(all_siblings)
                            consolidated = _consolidate_bspline_variants(all_siblings)
                            after = len(consolidated)
                            _log(f'[CONSOLIDATE] post-import: {before} -> {after} occurrence(s)')

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
                                except: nm = ''
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
                                            except: pass
                                        elif _is_surface_body_name(bn):
                                            try: b.isLightBulbOn = False
                                            except: pass
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
                                except: pass

                            if stamped_with_panel is not None:
                                _log('[VISIBILITY] Stamped panel is primary; Clean occurrence hidden. Surfaces hidden.')
                            elif best:
                                try:
                                    _log(f'[VISIBILITY] Primary: "{best.component.name}" (only Clean). Surface hidden, panel visible.')
                                except: pass
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
                    self._import_all_svg_layers(sketch_target, body_target, stamp_data, orientation, params)
                except Exception as e:
                    _log(f'SVG Stamp Import/Project failed: {e}')

            # ── Finalise ─────────────────────────────────────────────────────────
            _send_progress('Cleaning up graphics...')
            _clear_custom_graphics()
            if not is_preview:
                importing_done = True
                _send_progress('Finalizing Import...')
                _log('Import session finalized.')

            pal = app.userInterface.palettes.itemById(PALETTE_ID)
            if pal:
                pal.sendInfoToHTML('import_success', '{}')

        except Exception:
            tb = traceback.format_exc()
            _log(f'_handle_generate EXCEPTION:\n{tb}')
            if ui: ui.messageBox('Error in generate:\n{}'.format(tb))

    def _import_all_svg_layers(self, sketch_target, body_target, stamp_data, orientation='z-up', params=None):
        """Processes multiple SVG layers if available, otherwise falls back to single SVG."""
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
        
        for layer in layers:
            idx = layer.get('index', 1)
            cfg = layer.get('config', {})
            svg = layer.get('svg', '')
            
            # Generate a descriptive name for the sketch
            prof  = cfg.get('profile', 'flat')
            depth = cfg.get('depth', 0)
            sketch_name = f"L{idx} - {prof} ({depth}\")"
            
            _log(f'[STAMP] Starting Import: {sketch_name}')
            self._import_single_layer_svg(sketch_target, svg, sketch_name, top_face, orientation, params)

    def _import_single_layer_svg(self, sketch_target, svg_text, sketch_name, top_face, orientation='z-up', params=None):
        """Imports a single SVG string and projects it."""
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

            # 3. Setup Plane
            if orientation == 'y-up':
                target_plane = sketch_target.xZConstructionPlane
                project_axis = sketch_target.yConstructionAxis
            else:
                target_plane = sketch_target.xYConstructionPlane
                project_axis = sketch_target.zConstructionAxis

            # 4. Create offset plane above peak
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
            
            # 5. Create Sketch and Import
            sketch = sketch_target.sketches.add(artwork_plane)
            sketch.name = f"Source - {sketch_name}"
            
            import_mgr = adsk.core.Application.get().importManager
            svg_options = import_mgr.createSVGImportOptions(tmp_path)
            svg_options.scale = 1.0
            import_mgr.importToTarget(svg_options, sketch)


            # 6. Preserving Calibration Boundary Lines (User likes them for alignment)
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
   