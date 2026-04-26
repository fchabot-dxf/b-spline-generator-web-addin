"""Sketch 1 (Bounding Box) for Template 2.

``load_phase_blocks`` is injected into this module's namespace by
``template_loader.TemplateLoader._exec_module`` before this file is
executed, so no import statement is needed.
"""


def get_sketch(ui_data=None):
    return {
        "Name": "1_bounding_box",
        "Blocks": load_phase_blocks(1, ui_data),  # noqa: F821 — injected
    }
