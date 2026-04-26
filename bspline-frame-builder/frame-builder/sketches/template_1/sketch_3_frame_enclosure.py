"""Sketch 3 (Frame Enclosure) for Template 1.

``load_phase_blocks`` is injected into this module's namespace by
``template_loader.TemplateLoader._exec_module`` before this file is
executed, so no import statement is needed.
"""


def get_sketch(ui_data=None):
    return {
        "Name": "3_frame_enclosure",
        "Blocks": load_phase_blocks(3, ui_data),  # noqa: F821 — injected
    }
