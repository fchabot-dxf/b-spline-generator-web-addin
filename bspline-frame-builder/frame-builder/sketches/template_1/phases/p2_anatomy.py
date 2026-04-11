def get_block(ui_data=None):
    """
    Phase 2: Anatomy Foundation.
    Procedural Pinning and Origin Locking.
    """
    # 1. Seed Y positions — heightIn fractions place each zone in the correct quadrant
    #    independent of anatomy parameter resolution at seed time.
    #    Actual Y positions are locked by dimensions in Phase 7 (Polish).
    shldr_y = "heightIn * 0.15"    # upper quadrant
    hip_y   = "-heightIn * 0.15"   # lower quadrant
    waist_y = "WaistOffset"        # centre — locked to ORIGIN or dim below

    # 2. Dynamic Pining Logic
    is_pinned = False
    try:
        w_off = ui_data.get("WaistOffset", 0) if ui_data else 0
        if float(w_off) <= 1e-4:
            is_pinned = True
    except:
        pass

    # 3. Procedural Sequence: Build and Lock in one pass
    seq = [
        # SHOULDER FOUNDATION
        {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, shldr_y], ['ShoulderSpan/2', shldr_y]], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E'},
        {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'IsConstruction': True, 'Points': [[-0.001, shldr_y], ['-ShoulderSpan/2', shldr_y]], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E'},
        {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L']},
        {'Type': 'Equal',      'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L']},
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'skel_shoulder_pin_L:S']},

        # WAIST FOUNDATION
        {'ID': 'skel_waist_pin_R',    'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, waist_y], ['WaistSpan/2', waist_y]], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E'},
        {'ID': 'skel_waist_pin_L',    'Type': 'Line', 'IsConstruction': True, 'Points': [[-0.001, waist_y], ['-WaistSpan/2', waist_y]], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E'},
        {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R', 'skel_waist_pin_L']},
        {'Type': 'Equal',      'Targets': ['skel_waist_pin_R', 'skel_waist_pin_L']},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'skel_waist_pin_L:S']},

        # HIP FOUNDATION
        {'ID': 'skel_hip_pin_R',      'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, hip_y], ['HipSpan/2', hip_y]], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E'},
        {'ID': 'skel_hip_pin_L',      'Type': 'Line', 'IsConstruction': True, 'Points': [[-0.001, hip_y], ['-HipSpan/2', hip_y]], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E'},
        {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R', 'skel_hip_pin_L']},
        {'Type': 'Equal',      'Targets': ['skel_hip_pin_R', 'skel_hip_pin_L']},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'skel_hip_pin_L:S']},
    ]

    # VERTICAL LOCK: The Pinning Logic
    if is_pinned:
        seq.append({'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN']})
    else:
        seq.append({'Type': 'VerticalDistance', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN'], 'Expression': 'WaistOffset', 'Name': 'dim_waist_offset'})

    return {
        "Name": "Anatomy",
        "BuildSequence": seq
    }
