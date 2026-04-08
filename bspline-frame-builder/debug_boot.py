import adsk.core, traceback, os, sys, importlib.util, tempfile

def run(context):
    ui = adsk.core.Application.get().userInterface
    log_path = os.path.join(tempfile.gettempdir(), 'bspline_debug_boot.txt')
    try:
        current_dir = os.path.dirname(os.path.realpath(__file__))
        target_script = os.path.join(current_dir, 'bspline-frame-builder.py')
        
        with open(log_path, 'a') as f:
            f.write(f"\n--- BOOTSTRAP ATTEMPT {tempfile.gettempdir()} ---\n")
            f.write(f"Target: {target_script}\n")

        ui.messageBox(f"BOOTSTRAP: Attempting to import\n{target_script}")
        
        if not os.path.exists(target_script):
            ui.messageBox(f"BOOTSTRAP ERROR: File not found!\n{target_script}")
            return

        # Attempt to load as a module to see the raw crash
        spec = importlib.util.spec_from_file_location("bs_debug_import", target_script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        ui.messageBox("BOOTSTRAP SUCCESS: The file loaded without crashing.")
        
    except Exception as e:
        err = f"BOOTSTRAP CRASH DETECTED:\n\nType: {type(e).__name__}\nMessage: {str(e)}\n\nTraceback:\n{traceback.format_exc()}"
        with open(log_path, 'a') as f:
            f.write(err + "\n")
        ui.messageBox(err)
