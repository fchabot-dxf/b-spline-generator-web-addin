import sys
import os
import importlib

# Add the phases directory to path
phases_dir = r"C:\Users\danse\APPS\b-spline-generator-web-addin\bspline-frame-builder\frame-builder\sketches\template_1\phases"
if phases_dir not in sys.path:
    sys.path.insert(0, phases_dir)

def crawl_phases():
    print("=== UI DYNAMIC DISCOVERY SCAN ===")
    print(f"{'STEP':<6} | {'BLOCK NAME':<20} | {'DISCOVERED TOGGLES'}")
    print("-" * 60)
    
    for i in range(1, 14): # Scanning the silhouette phases for now
        mod_name = f"p{i}"
        if i == 3: mod_name = "p3_projs"
        elif i == 4: mod_name = "p4_anatomy"
        elif i == 5: mod_name = "p5_loop"
        elif i == 6: mod_name = "p6_chain"
        elif i == 7: mod_name = "p7_horns"
        elif i == 8: mod_name = "p8_waist_pins"
        elif i == 9: mod_name = "p9_tangency"
        elif i == 10: mod_name = "p10_horn_tangency"
        elif i == 11: mod_name = "p11_radius_removal"
        elif i == 12: mod_name = "p12_welds"
        elif i == 13: mod_name = "p13_drivers"
        
        try:
            m = importlib.import_module(mod_name)
            block = m.get_block()
            name = block.get("Name", "Unnamed")
            
            # Find all dictionaries in BuildSequence that have a 'Name'
            toggles = [item['Name'] for item in block.get("BuildSequence", []) if 'Name' in item]
            
            toggle_str = ", ".join(toggles) if toggles else "---"
            print(f"{i:<6} | {name:<20} | {toggle_str}")
            
        except Exception as e:
            print(f"{i:<6} | Error loading {mod_name}: {e}")

if __name__ == "__main__":
    crawl_phases()
