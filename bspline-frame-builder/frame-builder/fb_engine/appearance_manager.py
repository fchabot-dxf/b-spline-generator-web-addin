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

# Generic appearance names that indicate Fusion's default materials, not
# a user's intentional finish. The capture path treats these as "needs
# better" and probes faces / assembly context for the real custom paint.
GENERIC_APPEARANCE_NAMES = ('Pine', 'Steel', 'Aluminum', 'Brass')


class AppearanceManager:
    def __init__(self, app, design, logger):
        self.app = app
        self.design = design
        self.log = logger

    def capture_core_appearance(self, core_body):
        """Snapshot the panel's true 'Custom Paint' before the trim cut
        vandalizes it.

        Anti-fallback walk: start with the body appearance; if it looks
        generic (Pine / Steel / Aluminum / Brass), probe sample faces
        first, then the occurrence's assembly context, looking for a
        custom appearance to use instead. Returns the resolved Appearance
        (or None if nothing usable was found).

        Was inline in ``SolidCoordinator.run()``; lives here now so all
        appearance logic — capture, restore, apply — sits in one module
        and is testable as a unit.
        """
        if not core_body:
            return None

        # 1. Start with the body appearance
        original_app = core_body.appearance

        # 2. ANTI-FALLBACK: If it looks like a generic default, look for the real paint.
        needs_better = not original_app or any(
            g in (original_app.name or '') for g in GENERIC_APPEARANCE_NAMES
        )

        if needs_better:
            try:
                # Check sample faces first (source of most custom paints)
                for f in core_body.faces:
                    if f.appearance and not any(
                        g in f.appearance.name for g in GENERIC_APPEARANCE_NAMES
                    ):
                        self.log.log(
                            f"  SNAPSHOT HIT (Face): Captured Custom Paint '{f.appearance.name}'"
                        )
                        original_app = f.appearance
                        break

                # Check context/occurrence if faces are still generic
                if not original_app or any(
                    g in original_app.name for g in GENERIC_APPEARANCE_NAMES
                ):
                    occ = core_body.assemblyContext
                    if occ and occ.appearance:
                        original_app = occ.appearance
            except Exception as snap_err:
                self.log.log(f"  SNAPSHOT: capture failed: {snap_err}", "DEBUG")

        self.log.log(
            f"SNAPSHOT: core='{core_body.name}', "
            f"app={original_app.name if original_app else 'None'}"
        )
        return original_app

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
        except Exception as ref_err:
            self.log.log(f"  RESTORE: skipped (body reference invalidated post-cut): {ref_err}")
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
            except Exception:
                continue

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
            except Exception:
                continue

        self.log.log(f"      [WARNING] Global MISS: could not find any appearance matching '{name}'.", "WARNING")
        return None
