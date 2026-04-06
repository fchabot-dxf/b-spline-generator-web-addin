import adsk.core, adsk.fusion, traceback
from .sketch_builder import builder

class ParametricSketchBuilder(builder.ParametricSketchBuilder):
    """
    Legacy Wrapper for ParametricSketchBuilder.
    Redirects to the new modular sketch_builder package.
    """
    def __init__(self, target, design, logger, prefix="T2", local_values=None):
        super().__init__(target, design, logger, prefix, local_values)

    def build_template_with_retry(self, template):
        """Standard entry point for sketch synthesis."""
        return self.build_template(template)
