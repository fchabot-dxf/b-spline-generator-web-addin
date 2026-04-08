# Entry point for the unified Fusion 360 add-in: bspline-frame-builder
import adsk.core, adsk.fusion, adsk.cam, traceback
import os

handlers = []

# Command IDs, Names, Tooltips (ordered: bspline, sketch, solid)
COMMANDS = [
    {
        'id': 'bsplineCommand',
        'name': 'B-spline',
        'tooltip': 'Procedural B-spline Surface & Solid Engine',
        'res_folder': 'bspline',
        'logic': None  # To be wired to bspline logic
    },
    {
        'id': 'sketchBuilderCommand',
        'name': 'Sketch Builder',
        'tooltip': 'Procedural Sketch Builder for Fusion 360',
        'res_folder': 'sketch',
        'logic': None  # To be wired to sketch logic
    },
    {
        'id': 'solidBuilderCommand',
        'name': 'Solid Builder',
        'tooltip': 'Procedural Solid Builder for Fusion 360',
        'res_folder': 'solid',
        'logic': None  # To be wired to solid logic
    }
]

# TODO: Import and wire up logic from frame-builder and symmetric-b-spline-gen modules

class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self, action_func):
        super().__init__()
        self.action_func = action_func
    def notify(self, args):
        if self.action_func:
            self.action_func(args)


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        current_dir = os.path.dirname(os.path.realpath(__file__))
        cmd_defs = ui.commandDefinitions

        for cmd in COMMANDS:
            cmd_id = cmd['id']
            res_path = os.path.join(current_dir, 'resources', cmd['res_folder'])
            # Defensive cleanup
            try:
                existing_def = cmd_defs.itemById(cmd_id)
                if existing_def: existing_def.deleteMe()
            except:
                pass
            new_def = cmd_defs.itemById(cmd_id)
            if not new_def:
                new_def = cmd_defs.addButtonDefinition(cmd_id, cmd['name'], cmd['tooltip'], res_path)
            on_created = CommandCreatedHandler(cmd['logic'])
            new_def.commandCreated.add(on_created)
            handlers.append(on_created)

        # Add buttons to a single custom panel in the correct order
        ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if not ws: ws = ui.workspaces.itemById('SolidEnvironment')
        if not ws: ws = ui.activeWorkspace
        if ws:
            tab = ws.toolbarTabs.itemById('SolidTab')
            if not tab:
                for t in ws.toolbarTabs:
                    if 'Solid' in t.id or 'Solid' in t.name:
                        tab = t; break
            if tab:
                panel_id = 'bsplinePanel'
                panel = tab.toolbarPanels.itemById(panel_id)
                if not panel:
                    panel = tab.toolbarPanels.add(panel_id, 'B-spline Builder', 'SelectPanel', False)
                for cmd in COMMANDS:
                    control = panel.controls.addCommand(cmd_defs.itemById(cmd['id']))
                    control.isPromoted = True
                    control.isPromotedByDefault = True

    except:
        if ui: ui.messageBox('Add-In Start Failed:\n{}'.format(traceback.format_exc()))

def stop(context):
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        cmd_defs = ui.commandDefinitions
        ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if not ws: ws = ui.workspaces.itemById('SolidEnvironment')
        if ws:
            tab = ws.toolbarTabs.itemById('SolidTab')
            if not tab:
                for t in ws.toolbarTabs:
                    if 'Solid' in t.id or 'Solid' in t.name:
                        tab = t; break
            if tab:
                panel = tab.toolbarPanels.itemById('BSplineFramePanel')
                if panel:
                    for cmd in COMMANDS:
                        cntrl = panel.controls.itemById(cmd['id'])
                        if cntrl: cntrl.deleteMe()
                    if panel.controls.count == 0:
                        panel.deleteMe()
        for cmd in COMMANDS:
            cmd_def = cmd_defs.itemById(cmd['id'])
            if cmd_def: cmd_def.deleteMe()
    except:
        pass
