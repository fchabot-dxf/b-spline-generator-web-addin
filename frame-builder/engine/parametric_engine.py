"""
Parametric Engine: Backward Compatibility Wrapper with Force-Reload.
This file now re-exports the modular ParametricSketchBuilder and forces a cache refresh.
"""
import adsk.core, adsk.fusion, traceback
import importlib
from .sketch_builder import builder

# Force Fusion 360 to see the new architecture
importlib.reload(builder)
from .sketch_builder.builder import ParametricSketchBuilder

# Legacy imports for external scripts
__all__ = ['ParametricSketchBuilder']
