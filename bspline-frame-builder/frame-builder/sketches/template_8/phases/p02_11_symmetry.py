def get_block(ui_data=None):
    """
    Step 13: Symmetry Finalization (Template 8 - Dipped Top + Left-Only Wave).

    No skeleton Equal: Template 1's own `shoulder_equal` / `waist_equal` tie the LEFT skeleton pin to the RIGHT
    one - this template has no right pin at all, so there is nothing to tie.

    The TOP dip's own tie (as Template 5): `Equal(arc_top_shoulder_L, arc_top_shoulder_R)`. Unlike Template 5,
    the dip is NOT centred (p02_06 leaves its centre to the seeds, off axis per Fred's sketch), so this Equal no
    longer forces full left/right symmetry - it only ties the two shoulder radii together (both arcs still built
    from ONE shared radius `r = (a^2 + D^2) / 4D`, the closed-form the app's own hourglassConstruction uses for
    ANY dip position, editor-shape-lattice-generator.js). With unequal stub lengths (the corners fixed, the dip
    off centre) and equal shoulder radii, the top is a genuine asymmetric "wave" rather than two independently
    free shoulders. NEEDS LIVE VERIFICATION (LIVE_CHECK.md). Not gated by a ck_* toggle (no new parameter, as
    Template 5's own).
    """
    seq = [
        {'Type': 'Equal', 'Targets': ['arc_top_shoulder_L', 'arc_top_shoulder_R'], 'Name': 'top_shoulder_equal'},

        # Pulse to snap the tie into the viewport
        {'Type': 'Pulse'}
    ]

    return {"Name": "Symmetry", "PhaseID": "p02_11_symmetry", "BuildSequence": seq}
