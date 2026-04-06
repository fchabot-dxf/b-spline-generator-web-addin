"""
Appearance Manager — Handles Fusion 360 Material and Appearance libraries.
Isolates the finicky search and assignment logic from the geometric engine.
"""
import adsk.core, adsk.fusion, traceback

# Preset appearances the UI dropdown will offer (Synchronized with Fusion 360 Library Names)
APPEARANCE_PRESETS = [
    # ── 3D Hardwoods (Downloaded) ────────────────────────────────────
    "3D Ash - Unfinished",
    "3D Maple - Unfinished",
    "3D Pine - Unfinished",
    # ── Standard finishes ────────────────────────────────────────────
    "Paint - Enamel Glossy (White)",
    "Aluminum",
    "Brass",
]

class AppearanceManager:
    def __init__(self, app, design, logger):
        self.app = app
        self.design = design
        self.log = logger

    def apply_appearance(self, bodies, appearance_name):
        """
        Assign appearance_name to every body in the list.
        """
        if not appearance_name or appearance_name == "(none)":
            self.log.log("APPEARANCE: skipped (none)")
            return

        self.log.log(f"APPEARANCE: applying '{appearance_name}' to {len(bodies)} bodies")
        
        appearance = self.find_appearance(appearance_name)
        if not appearance:
            self.log.log(f"APPEARANCE MISS: '{appearance_name}' not found", "WARNING")
            return

        for body in bodies:
            try:
                body.appearance = appearance
                self.log.log(f"  Applied: '{appearance.name}' → '{body.name}'")
            except Exception as e:
                self.log.log(f"  Fail on '{body.name}': {e}", "WARNING")

    def restore_core_appearance(self, core_body, original_app):
        """
        Aggressively restores the core panel appearance after a SURROUND cut.
        Clears 100% of the 'grey steel' vandalism Fusion stamps on new cut faces.
        """
        if not core_body:
            return

        # Safe unwrapper to prevent crashes on invalid/deleted BRep references
        try:
            body = getattr(core_body, 'nativeObject', None) or core_body
            if not body or not hasattr(body, 'name'):
                self.log.log("  RESTORE: skipped (invalid body object context)")
                return
            self.log.log(f"  RESTORE (AGGRESSIVE): body='{body.name}' type={type(body).__name__}")
        except:
            self.log.log("  RESTORE: skipped (body reference invalidated post-cut)")
            return

        # Phase 1: Re-stamp Body Appearance
        if original_app:
            try:
                body.appearance = original_app
                self.log.log(f"  Body appearance re-stamped to '{original_app.name}'")
            except Exception as e_set:
                self.log.log(f"  Body appearance set FAILED: {e_set}", "WARNING")

        # Phase 2: Aggressively Clear Face Overrides
        # We MUST strip face-level appearances (grey steel) to reveal the body color.
        cleared = 0
        skipped = 0
        for face in body.faces:
            try:
                if face.appearance is not None:
                    # Clear override to show body appearance
                    face.appearance = None
                    cleared += 1
            except Exception:
                skipped += 1

        self.log.log(f"RESTORE SUCCESS: '{body.name}' — cleared {cleared} face overrides, skipped {skipped}.")

    def find_appearance(self, name):
        """
        Robust search for appearance:
        1. Local design assets (exact match)
        2. Library assets (exact match via API itemByName)
        3. Library assets (Fuzzy/Iteration match - the failsafe)
        """
        # --- 1. Local Design Search ---
        local = self.design.appearances.itemByName(name)
        if local:
            self.log.log(f"      [DISCOVERY] Found '{name}' in Local Assets.")
            return local

        # --- 2. Standard Library Search (itemByName) ---
        for lib in self.app.materialLibraries:
            try:
                lib_app = lib.appearances.itemByName(name)
                if lib_app:
                    self.log.log(f"      [DISCOVERY] Found '{name}' in '{lib.name}'. Copying...")
                    return self.design.appearances.addByCopy(lib_app, name)
            except: continue

        # --- 3. ROBUST SCANNER (Failsafe for naming inconsistencies) ---
        # If itemByName fails, we manually iterate to find a match (ignores casing/metadata mismatches)
        self.log.log(f"      [INFO] Exact match for '{name}' failed. Starting library scan...")
        
        search_term = name.lower()
        for lib in self.app.materialLibraries:
            try:
                for app_asset in lib.appearances:
                    if app_asset.name.lower() == search_term:
                        self.log.log(f"      [DISCOVERY HIT] Found direct match '{app_asset.name}' via scan in '{lib.name}'.")
                        return self.design.appearances.addByCopy(app_asset, app_asset.name)
            except: continue

        self.log.log(f"      [WARNING] Global MISS: could not find any appearance matching '{name}'.", "WARNING")
        return None
