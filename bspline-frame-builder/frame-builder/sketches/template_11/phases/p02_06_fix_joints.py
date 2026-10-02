def get_block(ui_data=None):
    """
    Fix Internal Joints (Template 11 - Diamond-top, 3-arc Hourglass).

    WHY THIS PHASE EXISTS: the 3-arc shoulder/waist/hip chain is under-constrained with Tangent +
    Coincident welds alone -- CONFIRMED LIVE (WORK-LOG-lane-b.md Turn 220): building with the OLD order
    (seed Radius -> weld -> Tangent -> delete Radius), every arc on both sides settled at its own
    literal SEED radius (1.5*HW) instead of its tangent-solved shape. Root cause, also confirmed live:
    with the seed Radius dimension still present when Tangent was applied, each arc's SIZE was already
    completely pinned, so Tangent could only reposition/reorient the (wrong-sized) arc, never resize
    it. Reordered this turn so Radius deletion (p02_04_radius_removal.py) runs BEFORE Tangent
    (p02_05_tangency.py) -- each arc's curvature is genuinely free when Tangent is applied, which may
    already be sufficient on its own.

    This phase runs LAST regardless, as a belt-and-suspenders lock: Template 7's simpler 2-arc
    (neck/body) chain gets away with Tangent + Coincident alone because each of ITS arcs keeps one end
    pinned to an independently-fixed point; T11's chain has 2 INTERNAL joins (shoulder<->waist,
    waist<->hip) free at BOTH ends even after the reorder above, which tangency alone may still not
    fully pin down on its own (not yet distinguished live from "the reorder alone was enough" --
    whichever is true, locking the solved joints here is harmless and costs nothing).

    THE FIX (fusion360-quirks skill, "Fix is not transitive"): `isFixed = True` is a SketchPoint
    property, not a constraint that propagates through a `Coincident` weld -- "an un-fixed anchor point
    tied by Coincident to other geometry has exactly as much freedom as whatever it's tied to." So this
    phase `Fix`es BOTH physical SketchPoints at each of the 2 internal joins per side (the arc that ENDS
    there and the arc that STARTS there, even though p02_03 already welded them Coincident) -- 8 points
    total.

    `Fix` is a NEW declarative BuildSequence step type (fb_engine/constraints.py's own `fix_step`,
    dispatched in parametric_engine.py), added this turn as a small, generically reusable primitive --
    not special-cased to this template.
    """
    seq = [
        # Right side: shoulder<->waist joint, waist<->hip joint.
        {'Type': 'Fix', 'Targets': ['arc_shoulder_R:E', 'arc_waist_R:S']},
        {'Type': 'Fix', 'Targets': ['arc_waist_R:E', 'arc_hip_R:S']},

        # Left side (mirror): waist<->hip joint, shoulder<->waist joint.
        {'Type': 'Fix', 'Targets': ['arc_hip_L:E', 'arc_waist_L:S']},
        {'Type': 'Fix', 'Targets': ['arc_waist_L:E', 'arc_shoulder_L:S']},

        # Pulse to snap the solved loop into the viewport (as every other template's final p02 phase).
        {'Type': 'Pulse'},
    ]

    return {
        "PhaseID": "p02_06_fix_joints",
        "Name": "Fix Internal Joints",
        "BuildSequence": seq,
    }
