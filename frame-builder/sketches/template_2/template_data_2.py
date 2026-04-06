import importlib
from . import T2_sketch_1_bounding_box
from . import T2_sketch_2_shape_outline

# Explicitly reload ONLY the 2 remaining sketches
importlib.reload(T2_sketch_1_bounding_box)
importlib.reload(T2_sketch_2_shape_outline)

from .T2_sketch_1_bounding_box   import get_sketch as get_sketch_1_bounding_box
from .T2_sketch_2_shape_outline  import get_sketch as get_sketch_2_shape_outline

def get_template_logic():
    return {
        "Name": "Template 2",
        "Description": "Symmetric Arc Frame (2-Sketch System)",
        "Parameters": [
            {"Name": "widthIn",                 "Val": 7.0,          "Unit": "in", "Comment": "Auto-sync width from model"},
            {"Name": "heightIn",                "Val": 9.0,          "Unit": "in", "Comment": "Auto-sync height from model"},
            {"Name": "boundingboxoffset",       "Val": 0.25,         "Unit": "in", "Comment": "Gap from silhouette to frame start"},
            {"Name": "Skel_Frame_Offset",       "Val": -0.75,        "Unit": "in", "Comment": "Master frame thickness (negative = inward)"},
            {"Name": "skelShoulderLen",         "Val": "widthIn/1.5","Unit": "in", "Comment": "Shoulder pin pair total span"},
            {"Name": "skelWaistLen",            "Val": "widthIn/1.1","Unit": "in", "Comment": "Waist pin pair total span"},
            {"Name": "skelHipLen",              "Val": "widthIn/1.5","Unit": "in", "Comment": "Hip pin pair total span"},
            {"Name": "skelVerticalGapShoulder", "Val": "heightIn/5", "Unit": "in", "Comment": "Shoulder Y above waist"},
            {"Name": "skelVerticalGapHip",      "Val": "heightIn/5", "Unit": "in", "Comment": "Hip Y below waist"},
            {"Name": "shapeRadiusShoulder",     "Val": "widthIn/7",  "Unit": "in", "Comment": "Shoulder arc radius (both sides)"},
            {"Name": "shapeRadiusWaist",        "Val": "widthIn/7",  "Unit": "in", "Comment": "Waist arc radius (both sides)"},
            {"Name": "shapeRadiusHip",          "Val": "widthIn/7",  "Unit": "in", "Comment": "Hip arc radius (both sides)"}
        ],
        "Sketches": [
            # ONLY build the first two sketches
            get_sketch_1_bounding_box(),
            get_sketch_2_shape_outline(),
        ]
    }

# Compatibility export for the engine
TEMPLATE_2 = get_template_logic()