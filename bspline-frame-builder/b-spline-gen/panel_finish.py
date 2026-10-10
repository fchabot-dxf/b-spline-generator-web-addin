"""
panel_finish.py -- the B-spline panel's appearance in Fusion: KEEP the per-component colour rule (Stamped green, Clean
red), but MATTE and a shade darker, so the relief reads (Fred, 2026-10-10, choosing between seat A's green and grey shots
of claude_10's stone band: flat saturated green hid the stones, matte grey showed them).

The colours themselves arrive in the STEP (stepWriter.js GREEN / RED, 0.2 / 0.8), which Fusion imports as a glossy
"Opaque(r,g,b)" -- on the body and as face overrides on the B-spline faces. Right after the post-import verification the
add-in gives each declared component's bodies a copy of PANEL_FINISH_BASE (a matte library appearance) recoloured to
its PANEL_FINISH colour, and clears the faces' overrides so the body's finish shows. Declared here, once.

Pure / testable: no adsk import (the caller passes the design, the appearance library and a colour factory).
"""
PANEL_FINISH_BASE = 'Plastic - Matte (Gray)'  # Fusion Appearance Library: low gloss
PANEL_FINISH = {                               # 0-255; the STEP's own are (51, 204, 51) / (204, 51, 51)
    'Stamped': (40, 165, 40),
    'Clean': (165, 40, 40),
}
COLOR_PROPERTY_IDS = ('opaque_albedo', 'plastic_albedo', 'generic_diffuse')  # the first one the base appearance has


def finish_name(component_name):
    return f'B-Spline {component_name} (matte)'


def _color_property(appearance):
    props = appearance.appearanceProperties
    for pid in COLOR_PROPERTY_IDS:
        p = props.itemById(pid)
        if p is not None:
            return p
    return None


def finish_for(design, library, component_name, color, log=None):
    """The design's matte appearance for this component (made once per design), or None if not declared / unavailable."""
    rgb = PANEL_FINISH.get(component_name)
    if rgb is None:
        return None
    name = finish_name(component_name)
    ap = design.appearances.itemByName(name)
    if ap is not None:
        return ap
    base = library.appearances.itemByName(PANEL_FINISH_BASE) if library is not None else None
    if base is None:
        if log: log(f'[FINISH] base appearance {PANEL_FINISH_BASE!r} not found: {component_name} keeps the STEP colour')
        return None
    ap = design.appearances.addByCopy(base, name)
    prop = _color_property(ap)
    if prop is None:
        if log: log(f'[FINISH] no colour property ({", ".join(COLOR_PROPERTY_IDS)}) on {PANEL_FINISH_BASE!r}: left grey')
        return ap
    prop.value = color(*rgb)
    return ap


def apply_panel_finish(occurrences, design, library, color, log=None):
    """Every body of each declared component (Stamped / Clean) gets its matte finish; its faces' overrides are
    cleared so the finish shows. Returns [(component, body, faces cleared)]. Never raises for one body."""
    done = []
    for occ in occurrences:
        try:
            comp = occ.component
        except Exception:
            continue
        ap = finish_for(design, library, comp.name, color, log)
        if ap is None:
            continue
        for b in comp.bRepBodies:
            try:
                b.appearance = ap
                cleared = 0
                for f in b.faces:
                    if f.appearance is not None and f.appearance != ap:
                        f.appearance = None
                        cleared += 1
                done.append((comp.name, b.name, cleared))
            except Exception as e:
                if log: log(f'[FINISH] {comp.name}/{getattr(b, "name", "?")} failed: {e}')
    return done
