import sys
import os

# Append the parent folder logic and core folder logic
_tests_dir = os.path.dirname(os.path.realpath(__file__))
_parent_dir = os.path.dirname(_tests_dir)
_core_dir = os.path.join(_parent_dir, 'core')

if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)

if _core_dir not in sys.path:
    sys.path.insert(0, _core_dir)
