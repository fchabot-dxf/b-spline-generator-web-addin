"""Canonical phase modules shared by every template.

Each module here exposes ``get_block(ui_data=None) -> dict`` and is the
single source of truth for a phase whose payload is identical across
every template. Per-template ``phases/<same_name>.py`` files re-export
``get_block`` from here so the on-disk filename still matches the
``PhaseID`` and ``TemplateLoader._scan_phase_files`` keeps working
unchanged.
"""
