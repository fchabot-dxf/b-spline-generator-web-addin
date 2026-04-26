"""Sketch 2 (Shape Outline) for Template 1.

``load_phase_blocks`` is injected into this module's namespace by
``template_loader.TemplateLoader._exec_module`` before this file is
executed, so no import statement is needed.
"""


def get_sketch(ui_data=None):
    return {
        "Name": "2_shape_outline",
        "Blocks": load_phase_blocks(2, ui_data),  # noqa: F821 — injected
    }
