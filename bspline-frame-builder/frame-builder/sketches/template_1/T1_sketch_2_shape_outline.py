import importlib
try:
    from phases import p1_projs, p2_anatomy, p3_loop, p4_chain, p5_tangency, p6_welds
except ImportError:
    # Fallback for different execution contexts
    import sys, os
    sys.path.append(os.path.dirname(__file__))
    from phases import p1_projs, p2_anatomy, p3_loop, p4_chain, p5_tangency, p6_welds

def get_sketch(ui_data=None):
    """
    Modular Refactor: Sketch 2 (Template 1).
    Assembles the sketch logic into sequential BuildingBlocks.

    Phase map:
      1  p1_projs    – projected reference geometry
      2  p2_anatomy  – skeleton anatomy pins
      3  p3_loop     – silhouette seeds + radius dims + corner locks
      4  p4_chain    – arc-to-arc head/tail Coincidents
      5  p5_tangency – G1 Tangent constraints across arc pairs
      6  p6_welds    – skeleton welds + horn tip welds
    """
    # Force reload of all phase modules during development
    for m in [p1_projs, p2_anatomy, p3_loop, p4_chain, p5_tangency, p6_welds]:
        importlib.reload(m)

    return {
        'Name': '2_shape-outline',
        'Blocks': [
            p1_projs.get_block(ui_data),
            p2_anatomy.get_block(ui_data),
            p3_loop.get_block(ui_data),
            p4_chain.get_block(ui_data),
            p5_tangency.get_block(ui_data),
            p6_welds.get_block(ui_data),
        ]
    }
