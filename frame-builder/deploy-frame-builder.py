import os
import shutil
import sys
import time
import json

def clean_dir(path):
    """Robustly deletes a directory."""
    if not os.path.exists(path):
        return
    for i in range(3):
        try:
            shutil.rmtree(path)
            return
        except Exception:
            time.sleep(1)
            
def write_project_handshake(dest_folder, current_dir):
    """Writes a project_path.json file to tether the add-in to the source."""
    try:
        config = {"project_root": current_dir}
        config_path = os.path.join(dest_folder, 'project_path.json')
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=4)
        print(f"Project handshake created: {config_path}")
    except Exception as e:
        print(f"Warning: Failed to create project handshake: {e}")

def deploy_addin(addin_name, current_dir, dest_root):
    dest_folder = os.path.join(dest_root, addin_name)
    # Source folder is the current add-in directory when script is in addin root
    src_folder = os.path.abspath(current_dir)
    
    if not os.path.exists(src_folder):
        print(f"Skipping {addin_name}: Source folder not found.")
        return

    print(f"Refreshing local Fusion 360 Add-In: {addin_name} at {dest_folder}")
    try:
        if os.path.exists(dest_folder):
            clean_dir(dest_folder)
        
        shutil.copytree(src_folder, dest_folder, ignore=shutil.ignore_patterns('__pycache__', '.DS_Store'))
        
        # Write the path handshake AFTER copying
        write_project_handshake(dest_folder, current_dir)
        
        print(f"Success: {addin_name} refreshed.")
    except Exception as e:
        print(f"Error deploying {addin_name}: {e}")

def deploy():
    current_dir = os.path.dirname(os.path.realpath(__file__))
    
    if sys.platform == "win32":
        dest_root = os.path.join(os.environ.get('APPDATA', ''), 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns')
    elif sys.platform == "darwin":
        dest_root = os.path.expanduser('~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns')
    else:
        print(f"Unsupported OS: {sys.platform}")
        return

    # Deploy ONLY the Frame Builder
    deploy_addin("frame-builder", current_dir, dest_root)
    
    print("\nNote: You may need to use 'Scripts and Add-Ins' > 'Stop' and 'Run' in Fusion 360 to see changes.")

if __name__ == "__main__":
    deploy()
