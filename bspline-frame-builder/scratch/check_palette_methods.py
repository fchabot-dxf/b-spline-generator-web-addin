import adsk.core, adsk.fusion, traceback

def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        
        pal = ui.palettes.itemById('HybridFrameBuilderPalette')
        if not pal:
            ui.messageBox('Palette not found. Please open it first.')
            return

        methods = dir(pal)
        ui.messageBox("Palette methods:\n" + "\n".join(methods))
        
    except:
        if ui:
            ui.messageBox('Failed:\n{}'.format(traceback.format_exc()))
