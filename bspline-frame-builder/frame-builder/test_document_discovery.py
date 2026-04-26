"""Unit tests for ``fb_engine.document_discovery.DocumentDiscovery``.

Locks in the three ladders the frame pipeline relies on, in the order
the original code chose:

* ``find_aesthetic_core_body``: attribute → legacy named occurrence
  ``AESTHETIC_CORE`` → name-hint scavenge with ``clean solid`` drill-down
  → first body on root → ``None``.

* ``find_frame_component``: attribute → greedy ``frame``-name scavenge
  picking the highest trailing number → root component as failsafe.

* ``find_frame_sketch``: targeted scan inside ``target_comp`` walking
  category priority (FRAME ENCLOSURE > FRAME SKETCH > SHAPE OUTLINE)
  → deep scan across ``design.allComponents`` with the same priority
  → ``(None, DEFAULT_SKETCH_PREFIX)``.

The tests stub ``adsk.core`` and ``adsk.fusion`` (plus the
``adsk.fusion.Component.cast`` indirection) so they run without Fusion.
Test doubles imitate just enough of each Fusion type to drive the
ladders — collections expose ``count`` / ``item(i)`` and behave as
iterables; components carry ``bRepBodies`` / ``occurrences`` / ``sketches``
plus the ``name`` and ``childOccurrences`` shape DocumentDiscovery reads.

Run with::

    cd bspline-frame-builder/frame-builder
    python3 test_document_discovery.py

Adding a new ladder branch? Drop a test into the ``TESTS`` list at the
bottom.
"""

import os
import sys
import traceback
import types


# ---------------------------------------------------------------------------
# Stub Fusion's adsk modules so importing document_discovery works.
# ---------------------------------------------------------------------------

def _install_adsk_stubs():
    if 'adsk' in sys.modules and hasattr(sys.modules.get('adsk.fusion'), 'Component'):
        return
    adsk = types.ModuleType('adsk')
    adsk.core = types.ModuleType('adsk.core')
    adsk.fusion = types.ModuleType('adsk.fusion')

    class _Component:
        """Stub for ``adsk.fusion.Component`` exposing ``cast``.

        The real ``cast`` returns ``None`` for objects that aren't
        Components. For tests, every component-shaped fake passes
        through unchanged; non-component sentinels can return ``None``
        by setting ``.is_component = False``.
        """

        @staticmethod
        def cast(obj):
            if obj is None:
                return None
            if getattr(obj, 'is_component', True):
                return obj
            return None

    adsk.fusion.Component = _Component
    sys.modules['adsk'] = adsk
    sys.modules['adsk.core'] = adsk.core
    sys.modules['adsk.fusion'] = adsk.fusion


_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_install_adsk_stubs()


from fb_engine.document_discovery import (  # noqa: E402
    DocumentDiscovery,
    DEFAULT_SKETCH_PREFIX,
)


# ---------------------------------------------------------------------------
# Fusion-shaped test doubles
# ---------------------------------------------------------------------------

class _Collection:
    """Iterable wrapper exposing ``count`` and ``item(i)`` like Fusion's
    ObjectCollection / BodyList / OccurrenceList."""

    def __init__(self, items=None):
        self._items = list(items or [])

    @property
    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i]

    def itemByName(self, name):
        for it in self._items:
            if getattr(it, 'name', None) == name:
                return it
        return None

    def __iter__(self):
        return iter(self._items)


class FakeBody:
    def __init__(self, name='body'):
        self.name = name


class FakeSketch:
    def __init__(self, name):
        self.name = name


class FakeComponent:
    """Mimics enough of ``adsk.fusion.Component`` for discovery."""

    is_component = True

    def __init__(self, name, bodies=None, sketches=None, occurrences=None):
        self.name = name
        self.bRepBodies = _Collection(bodies)
        self.sketches = _Collection(sketches)
        self.occurrences = _Collection(occurrences)


class FakeOccurrence:
    """Mimics ``adsk.fusion.Occurrence``: has ``name``, a child
    ``component``, and ``childOccurrences`` (also a Collection)."""

    def __init__(self, name, component, child_occurrences=None):
        self.name = name
        self.component = component
        self.childOccurrences = _Collection(child_occurrences)


class FakeAttribute:
    def __init__(self, value, parent):
        self.value = value
        self.parent = parent


class FakeDesign:
    """Stand-in for ``adsk.fusion.Design`` exposing ``rootComponent``,
    ``findAttributes`` and ``allComponents``.

    ``find_attributes_factory`` is a callable returning the attribute
    list — tests inject one to control attribute search results
    (including raising for the negative path)."""

    def __init__(self, root, all_components=None,
                 find_attributes_factory=None):
        self.rootComponent = root
        self._all_components = list(all_components or [root])
        self._find_attrs = find_attributes_factory or (lambda ns, key: [])

    def findAttributes(self, namespace, key):
        return self._find_attrs(namespace, key)

    @property
    def allComponents(self):
        return list(self._all_components)


class RecordingLogger:
    def __init__(self):
        self.entries = []

    def log(self, msg, level=None):
        self.entries.append((str(msg), level))


# ---------------------------------------------------------------------------
# Assertion helper
# ---------------------------------------------------------------------------

def _check(condition, message, errors):
    if not condition:
        errors.append(message)


def _make_discovery(root, all_components=None, find_attrs=None):
    design = FakeDesign(root, all_components=all_components,
                        find_attributes_factory=find_attrs)
    return DocumentDiscovery(app=None, design=design, logger=RecordingLogger())


# ---------------------------------------------------------------------------
# find_aesthetic_core_body
# ---------------------------------------------------------------------------

def test_aesthetic_core_via_attribute():
    errors = []
    body = FakeBody('panel')
    tagged = FakeComponent('CorePanel', bodies=[body])
    other = FakeComponent('Junk')

    def find_attrs(ns, key):
        return [
            FakeAttribute(value='SomethingElse', parent=other),
            FakeAttribute(value='AestheticCore', parent=tagged),
        ]

    root = FakeComponent('Root', occurrences=[FakeOccurrence('o1', other)])
    disc = _make_discovery(root, find_attrs=find_attrs)

    result = disc.find_aesthetic_core_body()

    _check(result is body, f"expected tagged body, got {result!r}", errors)
    return errors


def test_aesthetic_core_attribute_skipped_when_no_bodies():
    """Tagged component without bodies must not hijack the search —
    fall through to the next ladder rung."""
    errors = []
    legacy_body = FakeBody('legacy-panel')
    tagged_no_bodies = FakeComponent('TaggedShell')  # no bodies
    legacy_comp = FakeComponent('AestheticCorePanel', bodies=[legacy_body])
    legacy_occ = FakeOccurrence('AESTHETIC_CORE', legacy_comp)

    def find_attrs(ns, key):
        return [FakeAttribute(value='AestheticCore', parent=tagged_no_bodies)]

    root = FakeComponent('Root', occurrences=[legacy_occ])
    disc = _make_discovery(root, find_attrs=find_attrs)

    _check(
        disc.find_aesthetic_core_body() is legacy_body,
        "should fall through to AESTHETIC_CORE occurrence when tagged "
        "component has no bodies",
        errors,
    )
    return errors


def test_aesthetic_core_via_legacy_named_occurrence():
    errors = []
    body = FakeBody('panel')
    comp = FakeComponent('Whatever', bodies=[body])
    occ = FakeOccurrence('AESTHETIC_CORE', comp)
    root = FakeComponent('Root', occurrences=[occ])
    disc = _make_discovery(root)

    _check(
        disc.find_aesthetic_core_body() is body,
        "should return body from AESTHETIC_CORE-named occurrence",
        errors,
    )
    return errors


def test_aesthetic_core_via_name_hint():
    errors = []
    body = FakeBody('terrain-body')
    hinted = FakeComponent('Terrain Mesh v3', bodies=[body])
    occ = FakeOccurrence('Terrain', hinted)
    root = FakeComponent('Root', occurrences=[occ])
    disc = _make_discovery(root)

    _check(
        disc.find_aesthetic_core_body() is body,
        "should match by 'terrain' name hint",
        errors,
    )
    return errors


def test_aesthetic_core_drills_into_clean_solid_child():
    """When a hinted container has no bodies but holds a 'clean solid'
    child occurrence with bodies, drill into the child."""
    errors = []
    deep_body = FakeBody('clean-body')
    clean_solid = FakeComponent('Clean Solid Result', bodies=[deep_body])
    container = FakeComponent('B-Spline Set Container')  # no bodies
    inner_occ = FakeOccurrence('CleanSolid', clean_solid)
    outer_occ = FakeOccurrence('Set', container, child_occurrences=[inner_occ])
    root = FakeComponent('Root', occurrences=[outer_occ])
    disc = _make_discovery(root)

    _check(
        disc.find_aesthetic_core_body() is deep_body,
        "should drill into 'clean solid' child when parent has no bodies",
        errors,
    )
    return errors


def test_aesthetic_core_falls_back_to_root_body():
    errors = []
    root_body = FakeBody('orphan')
    root = FakeComponent('Root', bodies=[root_body])
    disc = _make_discovery(root)

    _check(
        disc.find_aesthetic_core_body() is root_body,
        "should fall back to the first root-component body",
        errors,
    )
    return errors


def test_aesthetic_core_returns_none_when_empty():
    errors = []
    root = FakeComponent('Root')
    disc = _make_discovery(root)

    _check(
        disc.find_aesthetic_core_body() is None,
        "empty design should yield None",
        errors,
    )
    return errors


# ---------------------------------------------------------------------------
# find_frame_component
# ---------------------------------------------------------------------------

def test_frame_component_via_attribute():
    errors = []
    tagged = FakeComponent('Tagged Frame Hold')

    def find_attrs(ns, key):
        return [FakeAttribute(value='Frame', parent=tagged)]

    root = FakeComponent('Root', occurrences=[FakeOccurrence('Frame_2', FakeComponent('Frame_2'))])
    disc = _make_discovery(root, find_attrs=find_attrs)

    _check(
        disc.find_frame_component() is tagged,
        "attribute-tagged Frame must win over scavenge",
        errors,
    )
    return errors


def test_frame_component_greedy_picks_highest_index():
    errors = []
    f1 = FakeComponent('Frame_1')
    f7 = FakeComponent('Frame_7')
    f3 = FakeComponent('Frame_3')
    root = FakeComponent('Root', occurrences=[
        FakeOccurrence('o1', f1),
        FakeOccurrence('o7', f7),
        FakeOccurrence('o3', f3),
    ])
    disc = _make_discovery(root)

    _check(
        disc.find_frame_component() is f7,
        "should pick the highest-numbered frame component",
        errors,
    )
    return errors


def test_frame_component_unnumbered_first_match():
    errors = []
    plain = FakeComponent('frame-holder')  # no digits
    other = FakeComponent('frame-back')    # no digits
    root = FakeComponent('Root', occurrences=[
        FakeOccurrence('o1', plain),
        FakeOccurrence('o2', other),
    ])
    disc = _make_discovery(root)

    _check(
        disc.find_frame_component() is plain,
        "unnumbered frame components fall back to first-match wins",
        errors,
    )
    return errors


def test_frame_component_root_fallback():
    errors = []
    root = FakeComponent('Root', occurrences=[
        FakeOccurrence('aesthetic_only', FakeComponent('B-Spline Set'))
    ])
    disc = _make_discovery(root)

    _check(
        disc.find_frame_component() is root,
        "no frame-named occurrence → root component fallback",
        errors,
    )
    return errors


# ---------------------------------------------------------------------------
# find_frame_sketch
# ---------------------------------------------------------------------------

def test_frame_sketch_targeted_enclosure_priority():
    """Even with a SHAPE OUTLINE present, FRAME ENCLOSURE wins
    because it's higher priority."""
    errors = []
    enclosure = FakeSketch('T1_3_frame-enclosure')
    outline = FakeSketch('T1_2_shape-outline')
    target = FakeComponent('Frame_4', sketches=[outline, enclosure])
    root = FakeComponent('Root')
    disc = _make_discovery(root, all_components=[root, target])

    sk, prefix = disc.find_frame_sketch(target)

    _check(sk is enclosure, f"FRAME ENCLOSURE must win, got {sk!r}", errors)
    _check(prefix == 't1', f"prefix should be 't1', got {prefix!r}", errors)
    return errors


def test_frame_sketch_targeted_frame_over_outline():
    """When FRAME ENCLOSURE is absent, FRAME SKETCH still beats
    SHAPE OUTLINE."""
    errors = []
    frame = FakeSketch('T2_frame')
    outline = FakeSketch('T2_2_shape-outline')
    target = FakeComponent('Frame_1', sketches=[outline, frame])
    root = FakeComponent('Root')
    disc = _make_discovery(root, all_components=[root, target])

    sk, prefix = disc.find_frame_sketch(target)

    _check(sk is frame, f"FRAME SKETCH must beat SHAPE OUTLINE, got {sk!r}", errors)
    _check(prefix == 't2', f"prefix should be 't2', got {prefix!r}", errors)
    return errors


def test_frame_sketch_deep_scavenge():
    """Targeted scan misses but a sibling component holds the sketch —
    the deep scan should find it."""
    errors = []
    enclosure = FakeSketch('T3_3_frame-enclosure')
    target = FakeComponent('Frame_5')                # no sketches
    sibling = FakeComponent('Stash', sketches=[enclosure])
    root = FakeComponent('Root')
    disc = _make_discovery(root, all_components=[root, target, sibling])

    sk, prefix = disc.find_frame_sketch(target)

    _check(sk is enclosure, f"deep scavenge should find the sketch, got {sk!r}", errors)
    _check(prefix == 't3', f"prefix should be 't3', got {prefix!r}", errors)
    return errors


def test_frame_sketch_total_miss_returns_default_prefix():
    errors = []
    target = FakeComponent('Frame_X')
    root = FakeComponent('Root')
    disc = _make_discovery(root, all_components=[root, target])

    sk, prefix = disc.find_frame_sketch(target)

    _check(sk is None, f"total miss should return None sketch, got {sk!r}", errors)
    _check(
        prefix == DEFAULT_SKETCH_PREFIX,
        f"miss prefix should equal DEFAULT_SKETCH_PREFIX={DEFAULT_SKETCH_PREFIX!r}, got {prefix!r}",
        errors,
    )
    return errors


def test_frame_sketch_handles_none_target():
    """``target_comp`` is allowed to be None — discovery must skip the
    targeted scan and go straight to the deep scavenge."""
    errors = []
    frame = FakeSketch('T9_frame')
    sibling = FakeComponent('Stash', sketches=[frame])
    root = FakeComponent('Root')
    disc = _make_discovery(root, all_components=[root, sibling])

    sk, prefix = disc.find_frame_sketch(None)

    _check(sk is frame, f"should find sketch via deep scavenge with no target, got {sk!r}", errors)
    _check(prefix == 't9', f"prefix should be 't9', got {prefix!r}", errors)
    return errors


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

TESTS = [
    # find_aesthetic_core_body
    test_aesthetic_core_via_attribute,
    test_aesthetic_core_attribute_skipped_when_no_bodies,
    test_aesthetic_core_via_legacy_named_occurrence,
    test_aesthetic_core_via_name_hint,
    test_aesthetic_core_drills_into_clean_solid_child,
    test_aesthetic_core_falls_back_to_root_body,
    test_aesthetic_core_returns_none_when_empty,
    # find_frame_component
    test_frame_component_via_attribute,
    test_frame_component_greedy_picks_highest_index,
    test_frame_component_unnumbered_first_match,
    test_frame_component_root_fallback,
    # find_frame_sketch
    test_frame_sketch_targeted_enclosure_priority,
    test_frame_sketch_targeted_frame_over_outline,
    test_frame_sketch_deep_scavenge,
    test_frame_sketch_total_miss_returns_default_prefix,
    test_frame_sketch_handles_none_target,
]


def main():
    all_errors = []
    for test in TESTS:
        print(f"== running {test.__name__} ==")
        try:
            errs = test()
        except Exception as e:
            errs = [
                f"{test.__name__} raised {type(e).__name__}: {e}\n"
                f"{traceback.format_exc()}"
            ]
        if errs:
            print(f"  FAIL ({len(errs)} error(s)):")
            for e in errs:
                print(f"    - {e}")
        else:
            print("  OK")
        all_errors.extend(errs)

    print()
    if all_errors:
        print(f"FAILED -- {len(all_errors)} total error(s)")
        return 1
    print(f"PASSED ({len(TESTS)} tests)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
