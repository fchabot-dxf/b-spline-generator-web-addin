def get_block(ui_data=None):
    """
    Phase 7 (final): Arch Rebuild.

    H23 item 17's own finding: `top_edge`'s branch (short vs. reflex) needs the anchor-plus-Coincident
    mechanism from `p02_03_loop.py` to stay in place THROUGHOUT the rest of the build for the shoulder/
    waist/hip chain to resolve correctly (MEASURED: deleting/rebuilding `top_edge` any EARLIER, even right
    after re-establishing the exact same Coincident link, loses whatever that link gives the later phases --
    shoulder goes back to 357.9 deg). But that same mechanism leaves `top_edge` ITSELF on the reflex branch
    (323 deg) -- a bare `Coincident`, even to an exactly-Fixed anchor, does not stop an Arc3Point from
    reinterpreting its own trim between two now-correctly-placed endpoints (p02_03_loop.py's own docstring
    has the full account).

    So: let everything else (horn_TR/TL, the whole shoulder-waist-hip chain, p02_04 through p02_11) resolve
    FIRST, using the anchor-linked (reflex) `top_edge` exactly as `p02_03_loop.py` leaves it -- by this point
    every OTHER entity's own position is already settled and does not care what `top_edge`'s own bulge looks
    like, only that its `:S`/`:E` endpoints are where they are (unchanged by this rebuild's own Points, the
    SAME closed-form HW/CY `p02_03_loop.py` already used). THEN, and only then, delete and recreate
    `top_edge` fresh (`Rebuild: True`) -- a brand new `addByThreePoints` call with NO constraint history at
    all reliably lands on the short branch, the same deterministic construction that gets it right on first
    creation every time.

    Three things `Rebuild` needs that a plain creation doesn't, all MEASURED live, all now handled:
      - Deleting the old arc also deletes ITS endpoints, which silently removes any constraint that
        referenced them -- `p02_03_loop.py`'s own `Coincident(horn_TR:S, top_edge:E)` /
        `Coincident(horn_TL:S, top_edge:S)` welds go with it. `horn_TR`/`TL` don't visibly move (nothing
        else asks them to, so they stay where they last solved), but they're no longer actually TIED to
        `top_edge` at all -- re-welded below so the sketch isn't left with a silently-freed DOF.
      - Re-running `addByThreePoints` on a sketch that already has substantial OTHER content does NOT
        reliably keep `startSketchPoint`/`endSketchPoint` matching the first/third seed point the way the
        very FIRST creation did (MEASURED: the identical seed Points came back with `:S`/`:E` SWAPPED).
        `fb_engine/geometry.py`'s own `_fix_rebuild_start_end` re-tags `Rebuild` results to match the
        requested point order, not whatever Fusion happened to call "start" this time.
      - That fix alone was NOT enough to stop `p03_04_encl_miters.py`'s own `proj_top_edge:S` from landing
        on the wrong corner -- `sketch.project()` (sketch 3's own projection of this rebuilt `top_edge`)
        has the SAME swap problem independently, on its OWN copy of the curve, and does not inherit the
        correction above. `fb_engine/projections.py`'s own `_register_endpoints` now cross-checks a
        single-result projection's `startSketchPoint` against the SOURCE's own (already-corrected)
        `:S` and re-tags there too.

    H23 item 46 (item 45's own finding): this step used to re-type `p02_03_loop.py`'s own closed-form
    `HW`/`CY`/`LY` literal a SECOND time by hand -- an independently-maintained duplicate of the exact
    same formula, the item-18 bug class item 45 went looking for. FIRST FIX (item 46) declared a
    step-level `SeedFrom: 'top_edge'` (`fb_engine/seed_basis.py`'s own `apply_seed_from`, a PURE,
    template-resolution-time copy, run BEFORE any seed is even applied) -- byte-identical for the
    UNSEEDED default (confirmed), but MEASURED LIVE (item 47) to not help a real drag at all: it
    copies `top_edge`'s own declared LITERAL Points, before `apply_seed_geometry` ever runs, and
    `apply_seed_geometry`'s own pop-on-first-match (`seed_geometry.py`) only ever patches the FIRST
    `top_edge` step (`p02_03_loop.py`'s) -- this rebuild step's own copy stayed frozen at the
    unseeded literal regardless of what was actually sent, reproducing the exact bug item 46 set out
    to fix, one layer removed.

    H23 item 47 (the real fix): the two ENDS track `top_edge`'s own CURRENT, just-built endpoints at
    BUILD TIME, chosen by left/right position (`fb_engine/geometry.py`'s own `_resolve_point_spec` +
    `_point_seed_from`, item 46's own measured fix for picking by geometry, not by Fusion's `:S`/`:E`
    label) -- resolved BEFORE this step's own `Rebuild` deletes the prior `top_edge`, so there is
    something live left to read. The APEX stays the one, genuinely-needed fixed literal (`LY`
    below): it exists only to force the correct (short) arc branch on `addByThreePoints`, a role
    that has nothing to do with WHERE the seeded ends are and must not track them (the two
    constraints -- "track the seed" and "force the branch" -- are now cleanly separated onto the
    one point each actually governs, instead of one literal doing neither job half-right). Confirmed
    live: both ends of T10's own Arch-rise handle now build 4/4 with DIFFERENT volumes (previously
    identical at both ends); the unseeded default stays byte-identical (nothing here changes what
    the LEFT/RIGHT endpoints of an un-dragged `top_edge` physically are).
    """
    LY = 'heightIn/2 - 0.25 in'  # the safe zone's own top line -- the apex's fixed ceiling, independent of any seed

    seq = [
        {'ID': 'top_edge', 'Type': 'Arc3Point', 'Rebuild': True, 'Points': [
            {'SeedFrom': {'id': 'top_edge', 'side': 'left'}},
            ['0.001', LY],
            {'SeedFrom': {'id': 'top_edge', 'side': 'right'}},
        ], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'Type': 'Fix', 'Targets': ['top_edge:S', 'top_edge:E']},
        # Re-weld horn_TR/TL to the rebuilt arc -- the delete above silently dropped p02_03_loop.py's own
        # Coincident welds along with the old arc's endpoints.
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
    ]

    return {"Name": "ArchRebuild", "PhaseID": "p02_12_arch_rebuild", "BuildSequence": seq}
