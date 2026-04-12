try:
    from phases import p1_projs, p2_anatomy, p3_loop, p4_chain, p4b_horns, p4c_waist_pins, p5_tangency, p5b_horn_tangency, p5c_radius_removal, p6_welds, p7_drivers
except ImportError:
    # Fallback for different execution contexts
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p1_projs, p2_anatomy, p3_loop, p4_chain, p4b_horns, p4c_waist_pins, p5_tangency, p5b_horn_tangency, p5c_radius_removal, p6_welds, p7_drivers

def get_sketch(ui_data=None):
    """
    Modular Refactor: Sketch 2 (Template 1).
    Assembles the sketch logic into sequential BuildingBlocks.

    Phase map:
      1  p1_projs         – projected reference geometry
      2  p2_anatomy       – skeleton anatomy pins
      3  p3_loop          – silhouette seeds + radius dims + corner locks
      4  p4_chain         – arc-to-arc waist/shoulder/hip Coincidents
      4b p4b_horns        – horn tip welds (shoulder/hip arcs → horn :E endpoints)
      4c p4c_waist_pins   – waist hub center pins (arc :C → skel hub :E)
      5  p5_tangency      – G1 Tangent constraints across arc pairs
      5b p5b_horn_tang_   – G1 Tangent constraints (arcs ↔ horns)
      5c p5c_rad_rem_     – surgically remove Phase 3 radius seeds
      6  p6_welds         – skeleton center welds (remaining arcs :C → anatomy pins)
      7  p7_drivers       – final parametric anatomy/radii (gated)
    """
    # Force reload of all phase modules during development
    for m in [p1_projs, p2_anatomy, p3_loop, p4_chain, p4b_horns, p4c_waist_pins, p5_tangency, p5b_horn_tangency, p5c_radius_removal, p6_welds, p7_drivers]:
        importlib.reload(m)

    return {
        'Name': '2_shape-outline',
        'Blocks': [
            p1_projs.get_block(ui_data),
            p2_anatomy.get_block(ui_data),
            p3_loop.get_block(ui_data),
            p4_chain.get_block(ui_data),
            p4b_horns.get_block(ui_data),
            p4c_waist_pins.get_block(ui_data),
            p5_tangency.get_block(ui_data),
            p5b_horn_tangency.get_block(ui_data),
            p5c_radius_removal.get_block(ui_data),
            p6_welds.get_block(ui_data),
            p7_drivers.get_block(ui_data),
        ]
    }
