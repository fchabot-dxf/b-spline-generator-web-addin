import adsk.core, adsk.fusion, adsk.cam, traceback
import os
import importlib

# Global list of event handlers to keep them alive
handlers = []

# Import local modules
try:
    from . import exporter
    # Hot-reload modules during development if they are already in sys.modules
    importlib.reload(exporter)
except:
    # Handle first-time load or if relative import fails during certain start conditions
    import exporter
    importlib.reload(exporter)

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        
        # --- Configuration ---
        # Specialized for Export/Audit only
        commands = [
            {
                'id': 'FusionExportCommand',
                'name': 'Fusion Export',
                'tooltip': 'Audit and Export Fusion 360 Design Data to DNA JSON',
                'res_folder': '',  # Use root ressources folder
                'logic': exporter.export_data_logic
            }
        ]
        
        current_dir = os.path.dirname(os.path.realpath(__file__))
        cmd_defs = ui.commandDefinitions

        # --- 1. Register Commands ---
        for cmd_info in commands:
            cmd_id = cmd_info['id']
            # If res_folder is '', use ressources directly; else, join subfolder
            if cmd_info['res_folder']:
                res_path = os.path.join(current_dir, 'ressources', cmd_info['res_folder'])
            else:
                res_path = os.path.join(current_dir, 'ressources')

            # A. Aggressive Cleanup of any existing controls to avoid "apiCmdDef" errors
            for panel in ui.allToolbarPanels:
                try:
                    cntrl = panel.controls.itemById(cmd_id)
                    if cntrl: cntrl.deleteMe()
                except:
                    pass

            # B. Defensive deletion of Command Definition
            try:
                existing_def = cmd_defs.itemById(cmd_id)
                if existing_def: existing_def.deleteMe()
            except:
                # If it fails, it means it's still "in use" somewhere. 
                # We'll skip deletion and use the existing one.
                pass

            # C. Create or Get Command Definition
            new_def = cmd_defs.itemById(cmd_id)
            if not new_def:
                new_def = cmd_defs.addButtonDefinition(cmd_id, cmd_info['name'], cmd_info['tooltip'], res_path)

            # D. Wire up the handler
            on_created = CommandCreatedHandler(cmd_info['logic'])
            new_def.commandCreated.add(on_created)
            handlers.append(on_created)
            
        # --- 2. Add to UI (Solid Tab & Manufacture Utilities) ---
        target_tabs = ['SolidTab', 'CAMUtilitiesTab']
        for tab_id in target_tabs:
            tab = ui.allToolbarTabs.itemById(tab_id)
            if tab:
                panel_id = 'FusionIOPanel'
                panel_name = 'FUSION-IO'
                
                # Get or create the panel
                panel = tab.toolbarPanels.itemById(panel_id)
                if not panel:
                    panel = tab.toolbarPanels.add(panel_id, panel_name)
                
                # Add buttons to the panel
                for cmd_info in commands:
                    cmd_id = cmd_info['id']
                    # Ensure no duplicate control exists
                    cntrl = panel.controls.itemById(cmd_id)
                    if cntrl: cntrl.deleteMe()
                    
                    cmd_def = cmd_defs.itemById(cmd_id)
                    if cmd_def:
                        panel.controls.addCommand(cmd_def)

    except:
        if ui: ui.messageBox('Add-In Start Failed:\n{}'.format(traceback.format_exc()))

def stop(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        cmd_defs = ui.commandDefinitions
        
        # List of IDs and Panels to clean up (include legacy names)
        ids = ['FusionExportCommand']
        panels_to_clean = ['FusionIOPanel']
        
        for cmd_id in ids:
            # 1. Clean up ALL controls across all tabs/panels first
            for panel in ui.allToolbarPanels:
                try:
                    cntrl = panel.controls.itemById(cmd_id)
                    if cntrl:
                        cntrl.deleteMe()
                except:
                    pass
            
            # 2. Delete command definition
            try:
                cdef = cmd_defs.itemById(cmd_id)
                if cdef: cdef.deleteMe()
            except:
                pass
            
        # 3. Clean up the panels if they are empty
        solid_tab = ui.allToolbarTabs.itemById('SolidTab')
        if solid_tab:
            for p_id in panels_to_clean:
                try:
                    panel = solid_tab.toolbarPanels.itemById(p_id)
                    if panel and panel.controls.count == 0:
                        panel.deleteMe()
                except:
                    pass
    except:
        pass

def _get_audited_projects():
    """Returns a list of folders (name, path) found in the comparative-audit directory."""
    try:
        base_path = r'C:\Users\danse\APPS\import-export-template\comparative-audit\Fusion-json'
        if not os.path.exists(base_path): return []
        
        projects = []
        for d in os.listdir(base_path):
            full_path = os.path.join(base_path, d)
            if os.path.isdir(full_path) and '_JSON_AUDIT' in d:
                # Clean up name for UI: "jesmo 14x17.5 v3_JSON_AUDIT" -> "jesmo 14x17.5 v3"
                clean_name = d.replace('_JSON_AUDIT', '').replace('_', ' ')
                projects.append((clean_name, full_path))
        return sorted(projects, key=lambda x: x[0])
    except:
        return []

# --- Event Handler Classes ---
class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, action_func):
        super().__init__()
        self.action_func = action_func
    def notify(self, args):
        try:
            event_args = adsk.core.CommandCreatedEventArgs.cast(args)
            cmd = event_args.command
            
            # --- Config UI for Export ---
            if cmd.parentCommandDefinition.id == 'FusionExportCommand':
                inputs = cmd.commandInputs
                inputs.addBoolValueInput('phys', 'Include Physical Audit (COM/MOI)', True, '', True)
                inputs.addBoolValueInput('param', 'Include Design Parameters', True, '', True)
                inputs.addBoolValueInput('sketch_deep', 'Include Deep Sketch Audit (Geometry/Constraints)', True, '', True)
                inputs.addBoolValueInput('attr', 'Include Metadata Attributes', True, '', True)
                inputs.addBoolValueInput('mfg', 'Include Manufacturing (CAM/Toolpaths)', True, '', True)
            
            # --- Config UI for Import (Native Dropdown) ---
            elif cmd.parentCommandDefinition.id == 'FusionImportCommand':
                inputs = cmd.commandInputs
                projects = _get_audited_projects()
                
                drop_input = inputs.addDropDownCommandInput('project_select', 'Choose DNA Project', adsk.core.DropDownStyles.LabeledIconDropDownStyle)
                if not projects:
                    drop_input.listItems.add('No Audits Found (Run Export First)', True)
                else:
                    for name, path in projects:
                        drop_input.listItems.add(name, False, '', -1)
                        # Store the full path in a hidden or indexed way (we'll look it up in Execute)
            
            on_execute = CommandExecuteHandler(self.action_func)
            cmd.execute.add(on_execute)
            handlers.append(on_execute)
        except:
            app = adsk.core.Application.get()
            ui = app.userInterface
            if ui: ui.messageBox('Command Created Failed:\n{}'.format(traceback.format_exc()))
        
class CommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self, action_func):
        super().__init__()
        self.action_func = action_func
    def notify(self, args):
        try:
            event_args = adsk.core.CommandEventArgs.cast(args)
            cmd = event_args.command
            
            # Capture inputs for export
            config = None
            dna_path = None
            
            if cmd.parentCommandDefinition.id == 'FusionExportCommand':
                inputs = cmd.commandInputs
                config = {
                    'phys': inputs.itemById('phys').value,
                    'param': inputs.itemById('param').value,
                    'sketch_deep': inputs.itemById('sketch_deep').value,
                    'attr': inputs.itemById('attr').value,
                    'mfg': inputs.itemById('mfg').value
                }
            elif cmd.parentCommandDefinition.id == 'FusionImportCommand':
                inputs = cmd.commandInputs
                sel_item = inputs.itemById('project_select').selectedItem
                if sel_item:
                    # Look up path by name from the helper
                    projects = _get_audited_projects()
                    for name, path in projects:
                        if name == sel_item.name:
                            dna_path = path; break
            
            # Final Execution
            if config:
                self.action_func(config)
            elif dna_path:
                self.action_func(dna_path)
            else:
                # If no projects chosen or no config, just try calling as-is or fail
                try: 
                    self.action_func()
                except: pass
        except:
            app = adsk.core.Application.get()
            ui = app.userInterface
            if ui: ui.messageBox('Command Failed:\n{}'.format(traceback.format_exc()))
