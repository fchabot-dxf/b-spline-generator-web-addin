import importlib
from engine import template_factory
importlib.reload(template_factory)
from engine.template_factory import get_skeleton, assemble_12nd_order
from . import T1_sketch_1_bounding_box, T1_sketch_2_skeleton, T1_sketch_3_shape_outline, T1_sketch_4_frame
importlib.reload(T1_sketch_1_bounding_box)
importlib.reload(T1_sketch_2_skeleton)
importlib.reload(T1_sketch_3_shape_outline)
importlib.reload(T1_sketch_4_frame)
from .T1_sketch_1_bounding_box import get_sketch as get_sketch_1_bounding_box
from .T1_sketch_2_skeleton import get_sketch as get_sketch_2_skeleton
from .T1_sketch_3_shape_outline import get_sketch as get_sketch_3_shape_outline
from .T1_sketch_4_frame import get_sketch as get_sketch_4_frame

def get_template_logic():
    """
    Returns the parametric logic for Template 1 (Signature Frame).
    Refactored to use modular template_factory for the 12nd-order silhouette.
    """
    # 1. Initialize Skeleton (The Point Factory)
    skel = get_skeleton()
    
    # 2. Assemble 12nd-Order Geometry (DISCONNECTED for Verification)
    geometry_loop = assemble_12nd_order(skel, show_skeleton=True, seal_manifold=False)
    
    return {
        "Name": "Template 1",
        "Description": "Signature Series - 12-segment S-Curve (Disconnected Verification Mode)",
        "Parameters": [
            {"Name": "widthIn", "Val": 7.0, "Unit": "in", "Comment": "Auto-sync width from model"},
            {"Name": "heightIn", "Val": 9.0, "Unit": "in", "Comment": "Auto-sync height from model"},
            {"Name": "boundingboxoffset", "Val": 0.25, "Unit": "in", "Comment": "Gap from B-Spline to Frame Start"},
            {"Name": "Skel_Frame_Offset", "Val": -0.75, "Unit": "in", "Comment": "Master Frame Thickness (Negative = Inward)"}
        ],
        "Sketches": [
            get_sketch_1_bounding_box(),
            get_sketch_2_skeleton(),
            get_sketch_3_shape_outline(geometry_loop),
            get_sketch_4_frame(),
        ]
    }

# Compatibility export for the Parametric Engine
TEMPLATE_1 = get_template_logic()
