"""Smoke tests for the template loader / discovery refactor.

These tests run *outside* Fusion. They exercise:

  1. Each template in isolation produces the expected sketch and phase
     counts.
  2. Loading both templates back-to-back doesn't cause one to silently
     pick up the other's phases (the original bug behind this refactor).

Run with::

    cd bspline-frame-builder/frame-builder
    python3 test_templates.py

A non-zero exit code means at least one assertion failed; output lists
which template / sketch / counter went wrong.
"""

import importlib.util
import os
import sys
import traceback


_HERE = os.path.dirname(os.path.realpath(__file__))
# Defensive: ensure ``from template_loader import TemplateLoader`` resolves
# when test_templates.py is invoked directly from this folder.
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_SKETCHES_ROOT = os.path.join(_HERE, 'sketches')


# Expected shape of each template, hand-derived from the phase files on
# disk. Updating phases? Bump these counts.
EXPECTED = {
    'template_1': {
        'name': 'Template 1 - Hourglass',
        'phase_counts': {1: 2, 2: 12, 3: 5},
    },
    'template_2': {
        'name': 'Template 2 - Narrow Neck',
        'phase_counts': {1: 2, 2: 7, 3: 5},
    },
}


# ---------------------------------------------------------------------------
# Module loading — mirrors fb_engine.frame_engine._load_template_module so
# the test exercises the same machinery the add-in uses at runtime.
# ---------------------------------------------------------------------------

def _load_template_module(data_path, module_name):
    spec = importlib.util.spec_from_file_location(module_name, data_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not build spec for {data_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

def _check(condition, message, errors):
    """Append ``message`` to ``errors`` if ``condition`` is falsy."""
    if not condition:
        errors.append(message)


def _verify_template_spec(folder, spec, errors):
    expected = EXPECTED[folder]
    _check(
        spec.get('Name') == expected['name'],
        f"[{folder}] Name mismatch: got {spec.get('Name')!r}, "
        f"want {expected['name']!r}",
        errors,
    )
    sketches = spec.get('Sketches') or []
    _check(
        len(sketches) == 3,
        f"[{folder}] expected 3 sketches, got {len(sketches)}",
        errors,
    )
    for idx, sk in enumerate(sketches, start=1):
        blocks = sk.get('Blocks') or []
        want = expected['phase_counts'].get(idx)
        _check(
            len(blocks) == want,
            f"[{folder}] sketch {idx} expected {want} phases, "
            f"got {len(blocks)} (Name={sk.get('Name')!r})",
            errors,
        )
        # Each phase should be a dict carrying PhaseFile (stamped by the
        # loader) so a future regression where Template 1 picks up
        # Template 2's phases would surface here as well.
        for j, blk in enumerate(blocks):
            _check(
                isinstance(blk, dict),
                f"[{folder}] sketch {idx} block {j} is not a dict: "
                f"type={type(blk).__name__}",
                errors,
            )
            if isinstance(blk, dict):
                pf = blk.get('PhaseFile', '')
                _check(
                    pf.startswith(f"p{idx:02d}_"),
                    f"[{folder}] sketch {idx} block {j} has wrong PhaseFile "
                    f"prefix: {pf!r}",
                    errors,
                )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_each_template_in_isolation():
    """Each template, loaded fresh in its own subprocess-equivalent."""
    errors = []
    for folder in EXPECTED:
        data_path = os.path.join(_SKETCHES_ROOT, folder, 'template_data.py')
        try:
            mod = _load_template_module(data_path, f"_test_{folder}_iso")
            spec = mod.get_template_logic()
            _verify_template_spec(folder, spec, errors)
        except Exception as e:
            errors.append(
                f"[{folder}] raised {type(e).__name__}: {e}\n"
                f"{traceback.format_exc()}"
            )
    return errors


def test_cross_template_regression():
    """Load T1 then T2 (and vice versa) — neither should leak into the
    other. This is the original bug guard.
    """
    errors = []
    sequences = [
        ('template_1', 'template_2'),
        ('template_2', 'template_1'),
    ]
    for first, second in sequences:
        try:
            first_mod = _load_template_module(
                os.path.join(_SKETCHES_ROOT, first, 'template_data.py'),
                f"_test_{first}_then_{second}_a",
            )
            second_mod = _load_template_module(
                os.path.join(_SKETCHES_ROOT, second, 'template_data.py'),
                f"_test_{first}_then_{second}_b",
            )
            # Verify both *after* both are loaded — that's when the leak
            # would have surfaced under the old loader.
            _verify_template_spec(first,  first_mod.get_template_logic(),  errors)
            _verify_template_spec(second, second_mod.get_template_logic(), errors)
        except Exception as e:
            errors.append(
                f"[{first}->{second}] raised {type(e).__name__}: {e}\n"
                f"{traceback.format_exc()}"
            )
    return errors


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main():
    all_errors = []
    for test in (test_each_template_in_isolation, test_cross_template_regression):
        print(f"== running {test.__name__} ==")
        errs = test()
        if errs:
            print(f"  FAIL ({len(errs)} error(s)):")
            for e in errs:
                print(f"    - {e}")
        else:
            print("  OK")
        all_errors.extend(errs)

    print()
    if all_errors:
        print(f"FAILED — {len(all_errors)} total error(s)")
        return 1
    print("PASSED")
    return 0


if __name__ == '__main__':
    sys.exit(main())
