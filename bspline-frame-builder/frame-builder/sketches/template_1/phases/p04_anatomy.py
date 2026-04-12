def get_block(ui_data=None):
    """
    Step 4: Anatomy Foundation.
    Procedural Pinning and Origin Locking.
    """
    # 1. Seed Y positions — heightIn fractions place each zone in the correct quadrant
    #    independent of anatomy parameter resolution at seed time.
    #    Actual Y positions are locked by dimensions in Phase 7 (Polish).
    
    # 2. Dynamic Pining Logic
    is_pinned = True
    try:
        # Check ui_data snapshot first
        w_off = ui_data.get("WaistOffset", 0) if ui_data else 0
        # If the multiplier is non-zero, we are NOT pinned
        if abs(float(w_off)) > 1e-4:
            is_pinned = False
    except:
        pass

    # SEEDING: If pinned, we use a tiny offset (0.001) to avoid auto-coincidence
    # before we apply our explicit constraint.
    waist_y_seed = "WaistOffset"
    if is_pinned:
        waist_y_seed = 0.001
    
    shldr_y = f"({waist_y_seed} + TopGap)"    
    hip_y   = f"({waist_y_seed} - BottomGap)"   
    waist_y = waist_y_seed

    # 3. Procedural Sequence: Build and Lock in one pass
    seq = [
        # SHOULDER FOUNDATION
        {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, shldr_y], ['ShoulderSpan/2', shldr_y]], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E'},
        {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'IsConstruction': True, 'Points': [[-0.001, shldr_y], ['-ShoulderSpan/2', shldr_y]], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E'},
        {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L'], 'Name': 'shoulder_horiz', 'CK': 'ck_skel_shoulder_horiz'},
        # Symmetry handled in p13_symmetry
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS'],             'Name': 'shoulder_y_lock'},
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'skel_shoulder_pin_L:S'], 'Name': 'shoulder_merge', 'CK': 'ck_skel_shoulder_merge'},

        # WAIST FOUNDATION
        {'ID': 'skel_waist_pin_R',    'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, waist_y], ['WaistSpan/2', waist_y]], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E'},
        {'ID': 'skel_waist_pin_L',    'Type': 'Line', 'IsConstruction': True, 'Points': [[-0.001, waist_y], ['-WaistSpan/2', waist_y]], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E'},
        {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R', 'skel_waist_pin_L'], 'Name': 'waist_horiz', 'CK': 'ck_skel_waist_horiz'},
        # Symmetry handled in p13_symmetry
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'Y_AXIS'],             'Name': 'waist_y_lock'},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'skel_waist_pin_L:S'], 'Name': 'waist_merge'},

        # HIP FOUNDATION
        {'ID': 'skel_hip_pin_R',      'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, hip_y], ['HipSpan/2', hip_y]], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E'},
        {'ID': 'skel_hip_pin_L',      'Type': 'Line', 'IsConstruction': True, 'Points': [[-0.001, hip_y], ['-HipSpan/2', hip_y]], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E'},
        {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R', 'skel_hip_pin_L'], 'Name': 'hip_horiz', 'CK': 'ck_skel_hip_horiz'},
        # Symmetry handled in p13_symmetry
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'Y_AXIS'],             'Name': 'hip_y_lock'},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'skel_hip_pin_L:S'], 'Name': 'hip_merge', 'CK': 'ck_skel_hip_merge'},
    ]

    # VERTICAL LOCK: Gated Coincident vs Dimension
    # We use a Coincident constraint for the zero-state to prevent solver crashes
    # and only switch to a VerticalDistance when an actual offset is requested.
    if is_pinned:
        seq.append({'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN'], 'Name': 'waist_origin_lock', 'AllowNudge': True})
    else:
        seq.append({'Type': 'VerticalDistance', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN'], 'Expression': 'WaistOffset', 'Name': 'dim_waist_offset'})

    return {
        "PhaseID": "p04_anatomy",
        "Name": "Anatomy",
        "BuildSequence": seq
    }
