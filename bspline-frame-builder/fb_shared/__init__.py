"""
fb_shared — single source of truth for the Fusion entity/coordinate helpers
that frame-inspector and template-maker previously each shipped as their own
drifted copy (C4/F8 module de-dup).

Imported PACKAGE-QUALIFIED (``from fb_shared.entity_helpers import ...``) so the
``sys.modules`` key is ``fb_shared.entity_helpers`` — the same object for every
consumer — which retires the bare-name collision the parent add-in used to work
around with ``_force_wipe(_shared_project_names)``.

Populated in slices (see MODULE-DEDUP-DESIGN.md): S1 = entity_helpers.
"""
