def get_block(ui_data=None):
    """
    Phase 7: Parametric Drivers.
    Links the final skeleton anatomy and arc radii to the UI sliders.
    Radii use Volatile logic: nudge to slider value then release.
    """
    return {
        "PhaseID": "p13_drivers",
        "Name": "Drivers",
        "Dimensions": [
            {'Name': 'ShoulderSpan', 'Type': 'HorizontalDistance', 'Targets': ['skel_shoulder_pin_L:E', 'skel_shoulder_pin_R:E'], 'Expression': 'ShoulderSpan', 'EnabledParam': 'en_ShoulderSpan'},
            {'Name': 'WaistSpan',    'Type': 'HorizontalDistance', 'Targets': ['skel_waist_pin_L:E',    'skel_waist_pin_R:E'],    'Expression': 'WaistSpan',    'EnabledParam': 'en_WaistSpan'},
            {'Name': 'HipSpan',      'Type': 'HorizontalDistance', 'Targets': ['skel_hip_pin_L:E',      'skel_hip_pin_R:E'],      'Expression': 'HipSpan',      'EnabledParam': 'en_HipSpan'},
            {'Name': 'TopGap',       'Type': 'VerticalDistance',   'Targets': ['skel_shoulder_pin_R:S', 'skel_waist_pin_R:S'],    'Expression': 'TopGap',       'EnabledParam': 'en_TopGap'},
            {'Name': 'BottomGap',    'Type': 'VerticalDistance',   'Targets': ['skel_waist_pin_R:S',    'skel_hip_pin_R:S'],      'Expression': 'BottomGap',    'EnabledParam': 'en_BottomGap'},
        ],
        "VolatileDimensions": [
            {'Name': 'arc_shoulder_R_rad', 'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'ShoulderRadius', 'EnabledParam': 'en_ShoulderRadius'},
            {'Name': 'arc_shoulder_L_rad', 'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'ShoulderRadius', 'EnabledParam': 'en_ShoulderRadius'},
            {'Name': 'arc_hip_R_rad',      'Type': 'Radius', 'Target': 'arc_hip_R',      'Expression': 'HipRadius',      'EnabledParam': 'en_HipRadius'},
            {'Name': 'arc_hip_L_rad',      'Type': 'Radius', 'Target': 'arc_hip_L',      'Expression': 'HipRadius',      'EnabledParam': 'en_HipRadius'},
            {'Name': 'arc_waist_R_rad',    'Type': 'Radius', 'Target': 'arc_waist_R',    'Expression': 'WaistRadius',    'EnabledParam': 'en_WaistRadius'},
            {'Name': 'arc_waist_L_rad',    'Type': 'Radius', 'Target': 'arc_waist_L',    'Expression': 'WaistRadius',    'EnabledParam': 'en_WaistRadius'},
        ]
    }
