"""
Template Factory for Frame Builder
Provides modular Construction Skeleton and Arc Trio components for parametric synthesis.
"""

def get_skeleton(width_expr="widthIn", height_expr="heightIn", offset_expr="boundingboxoffset"):
    """
    Returns a dictionary of coordinate expressions defining the frame's skeleton.
    """
    w = width_expr
    h = height_expr
    off = offset_expr
    
    return {
        # --- Corners ---
        "TOP_LEFT": [f"-{w}/2 + {off}", f"{h}/2 - {off}"],
        "TOP_RIGHT": [f"{w}/2 - {off}", f"{h}/2 - {off}"],
        "BOT_LEFT": [f"-{w}/2 + {off}", f"-{h}/2 + {off}"],
        "BOT_RIGHT": [f"{w}/2 - {off}", f"-{h}/2 + {off}"],
        
        # --- Transitions (Relative to height) ---
        "SHOULDER_Y": f"{h}/4",
        "WAIST_Y": f"0",
        "HIP_Y": f"-{h}/4",
        "HIP_BOT_Y": f"-{h}/4 - {h}/8",
        
        # --- Bulge/Waist Points ---
        "WAIST_CENTER_LEFT": [f"-{w}/2 + 2*{off}", "0"],
        "WAIST_CENTER_RIGHT": [f"{w}/2 - 2*{off}", "0"],
        "SHOULDER_IN_LEFT": [f"-{w}/2", f"{h}/8 + {h}/16"],
        "SHOULDER_IN_RIGHT": [f"{w}/2", f"{h}/8 + {h}/16"],
        "HIP_IN_LEFT": [f"-{w}/2", f"-{h}/8 - {h}/16"],
        "HIP_IN_RIGHT": [f"{w}/2", f"-{h}/8 - {h}/16"]
    }

def get_arc_trio(side, skel):
    """
    Generates a 3rdrd-order vertex-locked transition trio.
    """
    is_left = (side.lower() == "left")
    prefix = "L" if is_left else "R"
    x_val = f"-widthIn/2 + boundingboxoffset" if is_left else f"widthIn/2 - boundingboxoffset"

    # Seed points expressed as width/height ratios (baseline fit: widthIn=7, heightIn=9).
    # This keeps seeds scalable while preserving the tuned left/right mirrored shape.
    if is_left:
        shoulder_start = ["-(8.26/7)*widthIn", "(4.57/9)*heightIn"]
        shoulder_bulge = ["-(6.12/7)*widthIn", "(2.25/9)*heightIn"]
        shoulder_end = ["-(7.85/7)*widthIn", "(3.26/9)*heightIn"]

        hip_start = ["-(8.26/7)*widthIn", "-(4.57/9)*heightIn"]
        hip_bulge = ["-(6.12/7)*widthIn", "-(2.25/9)*heightIn"]
        hip_end = ["-(7.85/7)*widthIn", "-(3.26/9)*heightIn"]

        waist_start = ["-(8.13/7)*widthIn", "-(2.54/9)*heightIn"]
        waist_bulge = ["-(5.54/7)*widthIn", "0"]
        waist_end = ["-(8.05/7)*widthIn", "(2.54/9)*heightIn"]
    else:
        shoulder_start = ["(8.26/7)*widthIn", "(4.57/9)*heightIn"]
        shoulder_bulge = ["(6.12/7)*widthIn", "(2.25/9)*heightIn"]
        shoulder_end = ["(7.85/7)*widthIn", "(3.26/9)*heightIn"]

        hip_start = ["(8.26/7)*widthIn", "-(4.57/9)*heightIn"]
        hip_bulge = ["(6.12/7)*widthIn", "-(2.25/9)*heightIn"]
        hip_end = ["(7.85/7)*widthIn", "-(3.26/9)*heightIn"]

        waist_start = ["(8.13/7)*widthIn", "-(2.54/9)*heightIn"]
        waist_bulge = ["(5.54/7)*widthIn", "0"]
        waist_end = ["(8.05/7)*widthIn", "(2.54/9)*heightIn"]

    # Arc seeds are fully defined by explicit S/B/E points.
    
    return [
        {"ID": f"arc_shoulder_{prefix}", "Type": "Arc3Point",
         "Points": [shoulder_start, shoulder_bulge, shoulder_end]},
        {"ID": f"arc_waist_{prefix}", "Type": "Arc3Point",
         "Points": [waist_start, waist_bulge, waist_end]},
        {"ID": f"arc_hip_{prefix}", "Type": "Arc3Point",
            "Points": [hip_start, hip_bulge, hip_end]}
    ]

def assemble_12nd_order(skel, show_skeleton=True, seal_manifold=False):
    """
    Assembles a full 12-segment manifold from modular components.
    
    Phases:
    1. SEALED: Complete coincident manifold (production).
    2. DISCONNECTED: Standalone modules for verification (debug).
    """
    left_trio = get_arc_trio("left", skel)
    right_trio = get_arc_trio("right", skel)
    
    x_left = "-widthIn/2 + boundingboxoffset"
    x_right = "widthIn/2 - boundingboxoffset"
    
    entities = []
    
    # --- 1. CONSTRUCTION SKELETON (Always available for pins) ---
    # Seed positions use different X extents so the solver has a violin-shaped
    # starting point: waist wider (0.4), shoulder/hip narrower (0.2).
    # These are just seeds — constraints define the real geometry.
    if show_skeleton:
        entities.extend([
            {"ID": "skel_shoulder_pin_R", "Type": "Line", "IsConstruction": True, "Points": [[0, skel["SHOULDER_Y"]], ["widthIn/5", skel["SHOULDER_Y"]]]},
            {"ID": "skel_shoulder_pin_L", "Type": "Line", "IsConstruction": True, "Points": [[0, skel["SHOULDER_Y"]], ["-widthIn/5", skel["SHOULDER_Y"]]]},

            {"ID": "skel_waist_pin_R", "Type": "Line", "IsConstruction": True, "Points": [[0, 0], ["widthIn/3", 0]]},
            {"ID": "skel_waist_pin_L", "Type": "Line", "IsConstruction": True, "Points": [[0, 0], ["-widthIn/3", 0]]},

            {"ID": "skel_hip_pin_R", "Type": "Line", "IsConstruction": True, "Points": [[0, skel["HIP_Y"]], ["widthIn/5", skel["HIP_Y"]]]},
            {"ID": "skel_hip_pin_L", "Type": "Line", "IsConstruction": True, "Points": [[0, skel["HIP_Y"]], ["-widthIn/5", skel["HIP_Y"]]]}
        ])

    # --- 2. MANIFOLD SEGMENTS (Disconnected or Sealed) ---
    # We always return the list; the 'sealing' happens via Constraints in the Template data,
    # but here we ensure the segments represent the modular blocks clearly.
    
    entities.extend([
        # TOP BLOCK (Horizontal Line)
        {"ID": "G_05", "Type": "Line", "Points": [skel["TOP_LEFT"], skel["TOP_RIGHT"]]},
        
        # RIGHT TRIO MODULE
        {"ID": "horn_RU", "Type": "Line", "Points": [skel["TOP_RIGHT"], [x_right, skel["SHOULDER_Y"]]]},
        right_trio[0], # arc_shoulder_R
        right_trio[1], # arc_waist_R
        right_trio[2], # arc_hip_R
        {"ID": "horn_RL", "Type": "Line", "Points": [[x_right, skel["HIP_BOT_Y"]], skel["BOT_RIGHT"]]},
        
        # BOTTOM BLOCK (Horizontal Line)
        {"ID": "G_10", "Type": "Line", "Points": [skel["BOT_RIGHT"], skel["BOT_LEFT"]]},
        
        # LEFT TRIO MODULE
        {"ID": "horn_LL", "Type": "Line", "Points": [skel["BOT_LEFT"], [x_left, skel["HIP_BOT_Y"]]]},
        left_trio[2], # arc_hip_L
        left_trio[1], # arc_waist_L
        left_trio[0], # arc_shoulder_L
        {"ID": "horn_LU", "Type": "Line", "Points": [[x_left, skel["SHOULDER_Y"]], skel["TOP_LEFT"]]}
    ])
    
    return entities
