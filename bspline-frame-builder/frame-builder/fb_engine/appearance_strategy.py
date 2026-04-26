"""
AppearanceStrategy — pluggable hook for the SolidCoordinator's
appearance pipeline (capture / restore / finish).

Why a strategy?
---------------
SolidCoordinator used to inline three concerns in ``run()``:
  1. CAPTURE — snapshot the panel's true Custom Paint before the trim cut
     vandalizes it.
  2. RESTORE — re-stamp the body appearance and clear face overrides
     after the cut.
  3. FINISH  — apply either a UI-selected preset to the new bar bodies,
     or fall back to the captured panel paint.

Hardcoding these blocks made it impossible to override behavior without
forking the coordinator. With a strategy, callers can:
  * Swap in ``AlwaysBrushedSteelStrategy`` for production runs.
  * Pull appearance from an external source (ERP, web API).
  * Disable the snapshot / restore phases for diagnostic builds.

The default implementation, :py:class:`DefaultAppearanceStrategy`,
preserves the original behavior verbatim by delegating to
:py:class:`fb_engine.appearance_manager.AppearanceManager`.
"""

import adsk.core, adsk.fusion
import importlib

from fb_engine import grain_orient
importlib.reload(grain_orient)


class AppearanceStrategy:
    """Interface every appearance strategy implements.

    All three methods are tolerant of ``None`` inputs — the coordinator
    is responsible only for calling them in order; per-method skip rules
    live inside the strategy.
    """

    def capture(self, core_body):
        """Return an opaque appearance handle representing the body's
        'real' appearance, or ``None`` if nothing was captured."""
        raise NotImplementedError

    def restore(self, core_body, captured):
        """Restore ``captured`` onto ``core_body`` after a trim cut.
        No-op if either is ``None``."""
        raise NotImplementedError

    def finish(self, bodies, requested_name, captured):
        """Finish the synthesized bar bodies. If ``requested_name`` names
        a real preset, apply it; else fall back to ``captured``; else
        leave the bodies alone."""
        raise NotImplementedError


class DefaultAppearanceStrategy(AppearanceStrategy):
    """Original SolidCoordinator behavior, extracted into the strategy
    interface. Delegates to ``AppearanceManager`` for the heavy lifting
    so lower-level operations (find_appearance, library scanning, face
    override clearing) stay in one place.
    """

    def __init__(self, appearance_manager, logger):
        self.am = appearance_manager
        self.log = logger

    def capture(self, core_body):
        return self.am.capture_core_appearance(core_body)

    def restore(self, core_body, captured):
        if not core_body:
            return
        self.am.restore_core_appearance(core_body, captured)

    def finish(self, bodies, requested_name, captured):
        if not bodies:
            return

        if requested_name and requested_name != "(none)":
            self.am.apply_appearance(bodies, requested_name)
            self._orient_grain(bodies)
            return

        # Fallback: apply the captured panel paint to each new body.
        if captured:
            for b in bodies:
                try:
                    b.appearance = captured
                except Exception as app_err:
                    self.log.log(
                        f"  Could not apply appearance to body '{b.name}': {app_err}",
                        "DEBUG",
                    )
            self._orient_grain(bodies)

    def _orient_grain(self, bodies):
        """Run the grain auto-orient pass on each body. Best-effort:
        bodies without a wood-style appearance, or unsupported
        textureMapControl variants, are silently skipped (the module
        logs at DEBUG level). Errors never propagate out of here.
        """
        for b in bodies:
            try:
                grain_orient.auto_orient_grain(b, self.log)
            except Exception as e:
                try:
                    self.log.log(
                        f"  Grain orient failed for body '{b.name}': {e}",
                        "DEBUG",
                    )
                except Exception:
                    pass
