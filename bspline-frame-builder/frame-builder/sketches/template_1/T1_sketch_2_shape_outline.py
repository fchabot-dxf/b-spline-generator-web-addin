try:
    from phases import p3_projs, p4_anatomy, p5_loop, p6_chain, p7_horns, p8_waist_pins, p9_tangency, p10_horn_tangency, p11_radius_removal, p12_welds, p13_drivers
except ImportError:
    # Fallback for different execution contexts
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p3_projs, p4_anatomy, p5_loop, p6_chain, p7_horns, p8_waist_pins, p9_tangency, p10_horn_tangency, p11_radius_removal, p12_welds, p13_drivers

def get_sketch(ui_data=None):
    """
    Sketch 2: Shape Outline.
    Phases 3-13 of the global construction sequence.
    """
    for m in [p3_projs, p4_anatomy, p5_loop, p6_chain, p7_horns, p8_waist_pins, p9_tangency, p10_horn_tangency, p11_radius_removal, p12_welds, p13_drivers]:
        importlib.reload(m)

    return {
        'Name': '2_shape-outline',
        'Blocks': [
            p3_projs.get_block(ui_data),
            p4_anatomy.get_block(ui_data),
            p5_loop.get_block(ui_data),
            p6_chain.get_block(ui_data),
            p7_horns.get_block(ui_data),
            p8_waist_pins.get_block(ui_data),
            p9_tangency.get_block(ui_data),
            p10_horn_tangency.get_block(ui_data),
            p11_radius_removal.get_block(ui_data),
            p12_welds.get_block(ui_data),
            p13_drivers.get_block(ui_data),
        ]
    }
