import adsk.core, adsk.fusion, adsk.cam, traceback
import json
import os


def _collect_attrs(ent):
    out = []
    try:
        if not ent or not hasattr(ent, 'attributes'):
            return out
        attrs = ent.attributes
        for i in range(attrs.count):
            a = attrs.item(i)
            out.append({"Group": a.groupName, "Name": a.name, "Value": a.value})
    except Exception:
        pass
    return out


def _entity_meta(ent):
    meta = {
        "Type": None,
        "Token": None,
        "Name": None,
        "IsReference": False,
        "IsConstruction": False,
        "Attributes": []
    }
    try:
        if not ent:
            return meta
        meta["Type"] = ent.objectType
        try:
            meta["Token"] = ent.entityToken
        except Exception:
            pass
        try:
            meta["Name"] = ent.name
        except Exception:
            pass
        try:
            meta["IsReference"] = bool(ent.isReference)
        except Exception:
            pass
        try:
            meta["IsConstruction"] = bool(ent.isConstruction)
        except Exception:
            pass
        meta["Attributes"] = _collect_attrs(ent)
    except Exception:
        pass
    return meta

def export_data_logic(config=None):
    app = adsk.core.Application.get()
    ui  = app.userInterface

    # Resolve the Design via activeDocument.products rather than
    # app.activeProduct -- the latter returns CAMProduct when launched
    # from the Manufacture workspace, which fails the Design.cast and
    # would falsely report "no active design". The products lookup
    # works from any workspace as long as the document carries a Design.
    design = None
    try:
        doc = app.activeDocument
        if doc:
            ds = doc.products.itemByProductType('DesignProductType')
            if ds:
                design = adsk.fusion.Design.cast(ds)
    except Exception:
        design = None

    # Fallback for completeness: if products lookup didn't work for some
    # reason, try the original activeProduct cast path.
    if not design:
        design = adsk.fusion.Design.cast(app.activeProduct)

    if not design:
        ui.messageBox('No active Fusion design', 'Fusion Export')
        return

    if not config:
        config = {'phys': True, 'param': True, 'sketch_deep': True, 'attr': True, 'mfg': True}

    # Ask user for export location (folder picker) with a sensible default.
    default_output_dir = r'C:\Users\danse\APPS\b-spline-generator-web-addin\bspline-frame-builder\fusion-exporter\exported files'
    # Pre-create the default dir so the picker actually opens there
    # rather than silently falling back to the parent (or worse, the
    # last system-wide picker location).
    try:
        if not os.path.exists(default_output_dir):
            os.makedirs(default_output_dir)
    except Exception:
        pass
    output_dir = default_output_dir
    try:
        folder_dlg = ui.createFolderDialog()
        folder_dlg.title = 'Select Export Folder for Fusion-IO JSON Audit'
        try:
            folder_dlg.initialDirectory = default_output_dir
        except Exception:
            pass
        dlg_result = folder_dlg.showDialog()
        if dlg_result == adsk.core.DialogResults.DialogOK:
            if folder_dlg.folder:
                output_dir = folder_dlg.folder
        else:
            ui.messageBox('Export cancelled: no folder selected.', 'Fusion Export')
            return
    except Exception:
        # Fallback to default if picker fails unexpectedly.
        output_dir = default_output_dir

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    progressDialog = None
    original_workspace = ui.activeWorkspace
    try:
        # Immediate Workspace Switch
        try:
            design_ws = ui.workspaces.itemById('FusionSolidWorkspace')
            if design_ws: 
                design_ws.activate()
                adsk.doEvents()
        except Exception: pass

        doc_name = app.activeDocument.name
        progressDialog = ui.createProgressDialog()
        progressDialog.isBackgroundTranslucent = False
        progressDialog.show('FUSION-IO Portfolio Audit', 'Initializing Knowledge Base...', 0, design.allComponents.count + 40, 0)

        # 1. Root Folder
        export_folder = os.path.join(output_dir, f"{doc_name}_JSON_AUDIT")
        if os.path.exists(export_folder):
            counter = 1
            while os.path.exists(os.path.join(output_dir, f"{doc_name}_JSON_AUDIT_{counter}")): counter += 1
            export_folder = os.path.join(output_dir, f"{doc_name}_JSON_AUDIT_{counter}")
        os.makedirs(export_folder)

        # 2. CAM Folder Structure
        cam_folder = os.path.join(export_folder, "CAM")
        if config.get('mfg'):
            os.makedirs(cam_folder)
            os.makedirs(os.path.join(cam_folder, "mfgmodel"))
            os.makedirs(os.path.join(cam_folder, "setups"))

        portfolio = {
            "STRUCTURE": { 
                "Metadata": {
                    "Project": doc_name, 
                    "Version": "1.0.8-DeepMFG",
                    "Timestamp": "2026-03-28 13:24"
                }, 
                "Timeline": [], "DesignTree": {}, "CAMIndex": [] 
            },
            "PARAMETERS": { "User": [], "Model": [], "Features": [] },
            "PHYSICAL": { "Bodies": [] },
            "SKETCHES": { "Sketches": [] }
        }

        context = {
            "config": config, "portfolio": portfolio, "comp_cache": {}, "progress": progressDialog, 
            "count": 0, "export_folder": export_folder, "cam_folder": cam_folder
        }

        # --- GLOBAL DIAGNOSTICS ---
        try:
            context["portfolio"]["STRUCTURE"]["Metadata"]["GlobalProducts"] = [p.productType for p in app.activeDocument.products]
        except Exception: pass

        # --- PHASE 1: Main Design ---
        portfolio["PARAMETERS"]["User"], portfolio["PARAMETERS"]["Model"] = audit_global_parameters(design, config)
        portfolio["STRUCTURE"]["Timeline"] = audit_timeline(design)
        portfolio["STRUCTURE"]["DesignTree"] = audit_occurrence(design.rootComponent, context)

        # --- PHASE 2: Manufacturing Expansion ---
        if config.get('mfg'):
            try:
                cam_ws = ui.workspaces.itemById('CAMEnvironment')
                if cam_ws: 
                    cam_ws.activate()
                    adsk.doEvents()
                    import time
                    time.sleep(0.5)
            except Exception: pass

            # Deep Manufacturing Models
            mfg_models = audit_mfg_models_recursive(design, context)
            cam_setups = audit_cam_setups_granular(app, context)
            nc_progs = audit_nc_programs_granular(app, context)
            portfolio["STRUCTURE"]["CAMIndex"] = { "Models": mfg_models, "Setups": cam_setups, "NCPrograms": nc_progs }

        if progressDialog.wasCancelled:
            ui.messageBox('Audit Cancelled by User', 'Fusion-IO'); return

        # 3. Write Main JSON
        created_files = []
        for key, data in portfolio.items():
            if data:
                f_path = os.path.join(export_folder, f"{key}.json")
                with open(f_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
                created_files.append(os.path.basename(f_path))

        if original_workspace: original_workspace.activate()
        
        msg = f"Deep Portfolio Complete!\n\nLocation: {os.path.basename(export_folder)}\n"
        msg += f"Models: {len(mfg_models) if config.get('mfg') else 0}, Setups: {len(cam_setups) if config.get('mfg') else 0}"
        ui.messageBox(msg, "Fusion-IO Portfolio")

    except Exception: 
        ui.messageBox(f"Export Failed:\n{traceback.format_exc()}")
        if original_workspace: original_workspace.activate()
    finally:
        if progressDialog: progressDialog.hide()

def audit_global_parameters(design, config):
    user, model = [], []
    if config.get('param'):
        for p in design.userParameters:
            user.append({"Name": p.name, "Expr": p.expression, "Val": p.value, "Unit": p.unit})
        for p in design.allParameters:
            if not hasattr(p, 'isUserParameter') or not p.isUserParameter:
                model.append({"Name": p.name, "Expr": p.expression, "Val": p.value, "Unit": p.unit})
    return user, model

def audit_timeline(design):
    tl = []
    for i in range(design.timeline.count):
        obj = design.timeline.item(i)
        
        # 1. Start with safe defaults
        ent_type = "N/A"
        item_name = "TimelineObject"
        
        try:
            item_name = obj.name
        except Exception: pass
        
        # 2. Aggressive safety for the .entity property
        # Wrapping the property access itself to catch the RuntimeError 3
        try:
            ent = obj.entity
            if ent:
                ent_type = ent.objectType
        except Exception:
            ent_type = "Ghost/Internal"
            
        tl.append({
            "Idx": i, 
            "Name": item_name, 
            "Type": ent_type, 
            "Supp": obj.isSuppressed
        })
    return tl

def audit_occurrence(item, context):
    comp = item.component if hasattr(item, 'component') else item
    context["count"] += 1
    if context["progress"]:
        context["progress"].value = context["count"]
        context["progress"].message = f'Auditing Design: {comp.name}'
        adsk.doEvents()
        if context["progress"].wasCancelled: return None

    ref_id = f"Comp_{comp.id}"
    if ref_id not in context["comp_cache"]:
        context["comp_cache"][ref_id] = True
        audit_component_definition(comp, ref_id, context)

    occ_data = {"InstName": item.name if hasattr(item, 'name') else "Root", "RefID": ref_id, "Children": []}
    if hasattr(item, 'transform'): occ_data["Trans"] = item.transform.asArray()
    if hasattr(comp, 'occurrences'):
        for occ in comp.occurrences:
            if occ.component:
                child = audit_occurrence(occ, context)
                if child: occ_data["Children"].append(child)
    return occ_data

def audit_component_definition(comp, ref_id, context):
    config, portfolio = context["config"], context["portfolio"]
    for body in comp.bRepBodies:
        b_id = f"{ref_id}_Body_{body.name}"
        b_data = {"RefID": b_id, "Parent": ref_id, "Name": body.name}
        if config.get('phys'):
            try:
                p = body.getPhysicalProperties(adsk.fusion.CalculationAccuracy.MediumCalculationAccuracy)
                b_data["Phys"] = {"Mass": p.mass, "Vol": p.volume, "COM": [p.centerOfMass.x, p.centerOfMass.y, p.centerOfMass.z]}
            except Exception: pass

        # Axis-aligned bbox (world coords). Cheap rotation-detection: if a
        # body was rotated 90° around Z, its AABB X and Y dimensions swap.
        # All values in cm (Fusion internal units).
        try:
            bb = body.boundingBox
            if bb is not None:
                mn, mx = bb.minPoint, bb.maxPoint
                b_data["BBox"] = {
                    "Min":  [round(mn.x, 6), round(mn.y, 6), round(mn.z, 6)],
                    "Max":  [round(mx.x, 6), round(mx.y, 6), round(mx.z, 6)],
                    "Size": [round(mx.x - mn.x, 6), round(mx.y - mn.y, 6), round(mx.z - mn.z, 6)],
                }
        except Exception:
            pass

        # Oriented Minimum Bounding Box — captures ROTATION directly via the
        # length/width/height direction vectors. If a body was rotated 90°
        # around Z, its lengthDirection swaps from (1,0,0) to (0,1,0). This
        # is the cleanest rotation diagnostic for diffing two audits — pure
        # AABB-size swaps could come from many transforms; OBB axes pin
        # down which way the body is actually facing.
        try:
            obb = body.orientedMinimumBoundingBox
            if obb is not None:
                def _v(v):
                    try:
                        return [round(v.x, 6), round(v.y, 6), round(v.z, 6)]
                    except Exception:
                        return None
                b_data["OBB"] = {
                    "Center":          _v(obb.centerPoint),
                    "LengthDirection": _v(obb.lengthDirection),
                    "WidthDirection":  _v(obb.widthDirection),
                    "HeightDirection": _v(obb.heightDirection),
                    "Length":          round(obb.length, 6),
                    "Width":           round(obb.width, 6),
                    "Height":          round(obb.height, 6),
                }
        except Exception:
            pass

        portfolio["PHYSICAL"]["Bodies"].append(b_data)
        
    for sketch in comp.sketches:
        sk_id = f"{ref_id}_Sketch_{sketch.name}"
        sk_data = {"RefID": sk_id, "Parent": ref_id, "Name": sketch.name, "Geom": [], "Relations": [], "Dimensions": [], "RefPoints": []}
        if config.get('sketch_deep'):
            id_map = {}
            # 1. Capture Geometry & Map Entities
            for i, c in enumerate(sketch.sketchCurves):
                g_id = f"G_{i:02d}"
                g = {"GeomID": g_id, "Type": c.objectType}
                id_map[c.entityToken] = g_id
                if config.get('attr'):
                    g["Entity"] = _entity_meta(c)
                
                try: 
                    # Map Endpoints (Coincident logic)
                    if hasattr(c, 'startPoint'):
                        id_map[c.startPoint.entityToken] = f"{g_id}:S"
                        if config.get('attr'):
                            g["StartPointMeta"] = _entity_meta(c.startPoint)
                    if hasattr(c, 'endPoint'):
                        id_map[c.endPoint.entityToken] = f"{g_id}:E"
                        if config.get('attr'):
                            g["EndPointMeta"] = _entity_meta(c.endPoint)
                    if hasattr(c, 'centerPoint'):
                        id_map[c.centerPoint.entityToken] = f"{g_id}:C"
                        if config.get('attr'):
                            g["CenterPointMeta"] = _entity_meta(c.centerPoint)
                    
                    geom = c.geometry
                    if 'Line' in c.objectType:
                        l = adsk.fusion.SketchLine.cast(c)
                        g["S"] = [l.startPoint.geometry.x, l.startPoint.geometry.y, l.startPoint.geometry.z]
                        g["E"] = [l.endPoint.geometry.x, l.endPoint.geometry.y, l.endPoint.geometry.z]
                    elif hasattr(geom, 'center'):
                        g["C"] = [geom.center.x, geom.center.y, geom.center.z]
                        if hasattr(geom, 'radius'): g["R"] = geom.radius
                except Exception: pass
                sk_data["Geom"].append(g)

            # 1b. Capture all sketch points (critical for projected point diagnostics)
            if config.get('attr'):
                try:
                    for p_i, sp in enumerate(sketch.sketchPoints):
                        p_data = {
                            "PointID": f"P_{p_i:03d}",
                            "Coords": [sp.geometry.x, sp.geometry.y, sp.geometry.z],
                            "Meta": _entity_meta(sp),
                            "MappedAs": id_map.get(sp.entityToken)
                        }
                        conn = []
                        try:
                            for ce in sp.connectedEntities:
                                conn.append(_entity_meta(ce))
                        except Exception:
                            pass
                        p_data["Connected"] = conn
                        sk_data["RefPoints"].append(p_data)
                except Exception:
                    pass
                
            # 2. Capture Relational Constraints
            try:
                for gc in sketch.geometricConstraints:
                    rel = {"Type": gc.objectType.split('::')[-1], "Targets": []}
                    # Dynamic search for participants (generic approach)
                    for prop_name in ['lineOne', 'lineTwo', 'circleOne', 'circleTwo', 'entityOne', 'entityTwo', 'pointOne', 'pointTwo', 'line', 'curve']:
                        try:
                            item = getattr(gc, prop_name, None)
                            if item and item.entityToken in id_map: rel["Targets"].append(id_map[item.entityToken])
                        except Exception: pass
                    if config.get('attr'):
                        rel["Meta"] = _entity_meta(gc)
                    if rel["Targets"]: sk_data["Relations"].append(rel)
            except Exception: pass

            # 3. Capture Dimensions
            try:
                for d in sketch.sketchDimensions:
                    d_data = {"Name": d.parameter.name if d.parameter else "N/A", "Value": d.parameter.value if d.parameter else 0}
                    sk_data["Dimensions"].append(d_data)
            except Exception: pass
        portfolio["SKETCHES"]["Sketches"].append(sk_data)
        
    for feat in comp.features:
        if config.get('param'):
            f_data = {"Feat": feat.name, "Parent": ref_id, "Type": feat.objectType, "Suppressed": feat.isSuppressed, "Params": [], "Settings": {}}
            try:
                if hasattr(feat, 'operation'):
                    op_map = {0: "Join", 1: "Cut", 2: "Intersect", 3: "NewBody", 4: "NewComponent"}
                    f_data["Settings"]["Op"] = op_map.get(feat.operation, str(feat.operation))
            except Exception: pass
            if hasattr(feat, 'parameters') and feat.parameters.count > 0:
                for p in feat.parameters: f_data["Params"].append({"Name": p.name, "Expr": p.expression, "Val": p.value})
            portfolio["PARAMETERS"]["Features"].append(f_data)

def audit_mfg_models_recursive(design, context):
    index = []
    models = []
    if hasattr(design, 'manufacturingModels'):
        for i in range(design.manufacturingModels.count): 
            models.append(design.manufacturingModels.item(i))
    # Deep Scan of ALL products in the document
    try:
        doc = adsk.core.Application.get().activeDocument
        for p in doc.products:
            if 'Model' in p.productType: models.append(p)
    except Exception: pass

    for i, p in enumerate(models):
        try:
            m_type = p.productType
            # 1. Stable Diagnostic
            try:
                context["portfolio"]["STRUCTURE"]["Metadata"][f"Dbg_{i}_{m_type}_Valid"] = True
            except Exception: pass

            # 2. Extract Name & Prep Folders
            m_name = f"Model_{i+1}"
            try: 
                if hasattr(p, 'name'): m_name = p.name
                elif hasattr(p, 'workingModel') and hasattr(p.workingModel, 'name'): m_name = p.workingModel.name
            except Exception: pass
            
            safe_name = "".join([c for c in m_name if c.isalnum() or c in (' ', '.', '_')]).rstrip()
            m_dir = os.path.join(context["cam_folder"], "mfgmodel", safe_name)
            os.makedirs(m_dir, exist_ok=True)
            
            # 3. Sub-Portfolio Initialization
            sub_portfolio = {
                "STRUCTURE": { "Metadata": {"MfgModel": m_name, "SourceType": m_type}, "DesignTree": {} },
                "PARAMETERS": { "User": [], "Model": [], "Features": [] },
                "PHYSICAL": { "Bodies": [] },
                "SKETCHES": { "Sketches": [] }
            }
            sub_context = {
                "config": context["config"], "portfolio": sub_portfolio, "comp_cache": {}, 
                "progress": context["progress"], "count": context["count"], "cam_folder": m_dir
            }
            
            # 4. Aggressive Component Search (The Universal Key - Brute Force Edition)
            comp = None
            try:
                # Path A: Direct Casting (Manufacturing Models are technically Designs)
                try:
                    as_design = adsk.fusion.Design.cast(p)
                    if as_design and as_design.rootComponent: comp = as_design.rootComponent
                except Exception: pass
                
                if not comp:
                    # Path B: Linked Working Model
                    if hasattr(p, 'workingModel') and p.workingModel.occurrence: 
                        comp = p.workingModel.occurrence.component
                    # Path C: Direct Root Component
                    elif hasattr(p, 'rootComponent'): comp = p.rootComponent
                    # Path D: Legacy Occurrence
                    elif hasattr(p, 'occurrence') and p.occurrence: comp = p.occurrence.component
            except Exception: pass
            
            if comp:
                sub_portfolio["STRUCTURE"]["DesignTree"] = audit_occurrence(comp, sub_context)
                context["count"] = sub_context["count"] # Sync back
                for key, data in sub_portfolio.items():
                    f_path = os.path.join(m_dir, f"{key}.json")
                    with open(f_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
                index.append({"Name": m_name, "Path": f"CAM/mfgmodel/{safe_name}"})
            else:
                context["portfolio"]["STRUCTURE"]["Metadata"][f"{m_name}_Skip"] = "Component Root not found (Brute Force failed)"
        except Exception:
            import traceback
            context["portfolio"]["STRUCTURE"]["Metadata"][f"Model_{i}_Error"] = traceback.format_exc()
    return index

def audit_cam_setups_granular(app, context):
    index = []
    cam_p = app.activeDocument.products.itemByProductType('CAMProductType')
    if not cam_p: return []

    # Top-level Manufacturing Models dump (sibling to setups). Useful when
    # diffing a hand-built reference job against what the CAM-builder
    # add-in produces, since MMs are how Setup -> bodies linkage works.
    mm_index = []
    try:
        for mi in range(cam_p.manufacturingModels.count):
            mm = cam_p.manufacturingModels.item(mi)
            mm_index.append({
                "Name": getattr(mm, 'name', '<unnamed>'),
                "OccurrenceFullPath": getattr(getattr(mm, 'occurrence', None), 'fullPathName', ''),
            })
    except Exception:
        pass

    for i in range(cam_p.setups.count):
        try:
            s = cam_p.setups.item(i)
            s_data = {
                "Name": s.name,
                "Stock": int(getattr(s, 'stockType', 0)),
                # Setup-level parameters (job_stockMode, wcs_origin_mode,
                # wcs_orientation_mode, etc) -- the exact names + working
                # expression strings we need for setup_builder. Captures
                # everything; downstream code can grep for what it needs.
                "SetupParams": {},
                # Typed properties on the Setup object that DON'T live in
                # the parameters dict. These are the closest thing to
                # ground truth -- when a string parameter and a typed
                # property disagree, the typed property is what Fusion
                # actually uses to draw / generate code.
                "TypedProps": {},
                # Geometric WCS -- the actual triad transform Fusion uses
                # to position the on-screen widget and emit G-code. If a
                # string param like wcs_origin_boxPoint silently re-resolves,
                # the Matrix is the only place the truth shows up. Captured
                # as origin + xAxis + yAxis + zAxis vectors in cm
                # (Fusion's internal units).
                "WorkCoordinateSystem": None,
                "ModelBodies": [],
                "Ops": [],
            }

            # Dump every setup parameter with name + expression + value.
            # ``expression`` is the canonical form for choice params
            # (string is "'modelOrientation'" with inner quotes).
            try:
                for p in s.parameters:
                    try:
                        rec = {"Expression": p.expression}
                        try:
                            rec["Value"] = str(p.value.value)
                        except Exception:
                            pass
                        try:
                            rec["Title"] = p.title
                        except Exception:
                            pass
                        try:
                            choices = list(getattr(p.value, 'choices', []) or [])
                            if choices:
                                rec["Choices"] = choices
                        except Exception:
                            pass
                        s_data["SetupParams"][p.name] = rec
                    except Exception:
                        pass
            except Exception:
                pass

            # Typed properties on the Setup object. These don't appear in
            # ``s.parameters``, so a parameter-only walk misses them. List:
            #   - stockMode  : adsk.cam.SetupStockModes enum (RelativeBoxStock, etc)
            #   - operationType : OperationTypes enum
            #   - isActive   : bool
            #   - workOffset : int
            for prop_name in ('stockMode', 'operationType', 'isActive',
                              'workOffset', 'name', 'objectType'):
                try:
                    val = getattr(s, prop_name)
                    # Enum values come out as ints; stringify so JSON is
                    # readable. For everything else, str() is fine too.
                    s_data["TypedProps"][prop_name] = str(val) if val is not None else None
                except Exception:
                    pass

            # Geometric WCS -- read setup.workCoordinateSystem (Matrix3D)
            # and decompose into origin + x/y/z axis vectors. This is the
            # single most diagnostic field for WCS issues: when the dialog
            # shows the triad in a corner that doesn't match what
            # wcs_origin_boxPoint claims, the truth is here.
            try:
                wcs = s.workCoordinateSystem
                if wcs is not None:
                    origin, xAxis, yAxis, zAxis = wcs.getAsCoordinateSystem()
                    def _v(v):
                        try:
                            return [round(v.x, 6), round(v.y, 6), round(v.z, 6)]
                        except Exception:
                            return None
                    s_data["WorkCoordinateSystem"] = {
                        "Origin_cm": _v(origin),
                        "XAxis":     _v(xAxis),
                        "YAxis":     _v(yAxis),
                        "ZAxis":     _v(zAxis),
                        "_note": "Origin in cm (Fusion internal units). Axes are unit vectors. Compare against SetupParams['wcs_origin_boxPoint'] etc to spot silent re-resolution.",
                    }
            except Exception as e:
                s_data["WorkCoordinateSystem"] = {"_error": str(e)}

            # Bound model bodies (what setup.models was set to). Helps
            # us verify the body-binding pass.
            try:
                for m in s.models:
                    try:
                        s_data["ModelBodies"].append({
                            "Type": m.objectType.split('::')[-1],
                            "Name": getattr(m, 'name', ''),
                        })
                    except Exception:
                        pass
            except Exception:
                pass

            for op in s.allOperations:
                op_data = {
                    "Name": op.name,
                    "Type": op.objectType.split('::')[-1],
                    "Path": op.hasToolpath,
                    "Params": {}
                }
                # Capture all non-empty operation parameters (Feed, Speed, Stepover...)
                try:
                    for p in op.parameters:
                        try:
                            val = p.expression
                            if not val and hasattr(p, 'value'): val = str(p.value.value)
                            if val: op_data["Params"][p.name] = val
                        except Exception: pass
                except Exception: pass
                s_data["Ops"].append(op_data)

            f_name = f"SETUP_{i+1:02d}_{s.name}.json"
            f_path = os.path.join(context["cam_folder"], "setups", f_name)
            with open(f_path, 'w', encoding='utf-8') as f: json.dump(s_data, f, indent=4)
            index.append({"Name": s.name, "File": f"CAM/setups/{f_name}"})
        except Exception: pass

    # Also write the MM index alongside setups for one-stop reference.
    if mm_index:
        try:
            mm_path = os.path.join(context["cam_folder"], "MANUFACTURING_MODELS.json")
            with open(mm_path, 'w', encoding='utf-8') as f:
                json.dump(mm_index, f, indent=4)
        except Exception:
            pass

    return index

def audit_nc_programs_granular(app, context):
    index = []
    cam_p = app.activeDocument.products.itemByProductType('CAMProductType')
    if not cam_p or not hasattr(cam_p, 'ncPrograms'): return []
    for i in range(cam_p.ncPrograms.count):
        try:
            nc = cam_p.ncPrograms.item(i)
            # 1. Capture NC Settings (Folder + Filename = Path)
            nc_data = {"Name": nc.name, "Post": "N/A", "OutputFile": "N/A", "Operations": []}
            try:
                folder = nc.parameters.itemByName('nc_program_folder').value.value
                filename = nc.parameters.itemByName('nc_program_filename').value.value
                nc_data["Post"] = nc.parameters.itemByName('nc_program_post').value.value
                nc_data["OutputFile"] = os.path.normpath(os.path.join(folder, filename))
                
                # Capture the explicit operations list
                if hasattr(nc, 'operations'):
                    for o in nc.operations: nc_data["Operations"].append(o.name)
                elif hasattr(nc, 'setups'):
                    for s in nc.setups:
                         for o in s.allOperations: nc_data["Operations"].append(o.name)
            except Exception: pass
            
            # 2. Write Metadata
            f_name = f"NC_PROG_{i+1:02d}_{nc.name}.json"
            f_path = os.path.join(context["cam_folder"], "setups", f_name)
            with open(f_path, 'w', encoding='utf-8') as f: json.dump(nc_data, f, indent=4)
            index.append({"Name": nc.name, "File": f"CAM/setups/{f_name}"})
            
            # 3. Optional: Copy physical G-code if it exists
            try:
                if nc_data["OutputFile"] != "N/A" and os.path.exists(nc_data["OutputFile"]):
                    import shutil
                    nc_ext = os.path.splitext(nc_data["OutputFile"])[1] or ".nc"
                    shutil.copy(nc_data["OutputFile"], os.path.join(context["cam_folder"], "setups", f"NC_CODE_{i+1:02d}_{nc.name}{nc_ext}"))
            except Exception: pass
        except Exception: pass
    return index
