"""
DocumentDiscovery — single source of truth for the Fusion document
queries that the frame pipeline runs (find aesthetic core body, find
frame component, find frame-outline sketch).

Why consolidate?
----------------
Three separate places used to hand-roll their own attribute-search +
name-pattern fallback ladder:

* ``FrameBuilder._discover_aesthetic_core`` (in ``frame_engine.py``) —
  hunts for the source body to extrude / cut / clad.
* ``SolidCoordinator._resolve_component`` — hunts for the previously-built
  ``Frame_N`` component to drop bars into.
* ``SolidCoordinator._find_sketch`` — hunts for the right outline sketch
  inside a frame component.

They all leaned on the same ``FrameBuilder`` attribute namespace, the
same name-substring scavenge style, and the same "root component as
last resort" failsafe. Forking these conventions across two modules
made it easy for one to drift (e.g. tagging the aesthetic core but not
checking that tag in the solid coordinator).

This module owns the conventions:

* :py:data:`ATTR_NAMESPACE` = ``"FrameBuilder"`` — the attribute
  namespace used by both pipelines.
* :py:data:`ATTR_KEY` = ``"ComponentType"`` — the attribute key.
* Component types currently in use: ``"AestheticCore"`` and ``"Frame"``.

Every method preserves the original log lines so existing log analyses
keep working unchanged.
"""

import re

import adsk.core
import adsk.fusion


ATTR_NAMESPACE = "FrameBuilder"
ATTR_KEY = "ComponentType"

CORE_OCCURRENCE_NAME = "AESTHETIC_CORE"
CORE_NAME_HINTS = ("b-spline set", "terrain")
CORE_SUBCOMP_HINT = "clean solid"

# Sketch-name patterns ordered by category priority. The first hit
# in the highest-priority category wins, matching the behavior of the
# original SolidCoordinator._find_sketch.
SKETCH_CATEGORY_PATTERNS = [
    ("FRAME ENCLOSURE", [
        "_3_frame-enclosure", "_3_frame_enclosure", "_3_frame enclosure",
        "3_frame-enclosure", "3_frame_enclosure", "3_frame enclosure",
        "_frame-enclosure", "_frame_enclosure", "frame-enclosure",
        "frame_enclosure", "frame enclosure",
    ]),
    ("FRAME SKETCH", [
        "_3_frame", "_frame", "frame",
    ]),
    ("SHAPE OUTLINE", [
        "_2_shape-outline", "_2_shape_outline", "_2_shape outline",
        "2_shape-outline", "2_shape_outline", "2_shape outline",
        "shape-outline", "shape_outline", "shape outline",
    ]),
]

DEFAULT_SKETCH_PREFIX = "T1"


class DocumentDiscovery:
    """Locate frame-pipeline objects (bodies, components, sketches) in
    the active Fusion document.

    Stateless apart from a logger handle — every method re-reads the
    design tree, so callers can re-use a single instance across phases.
    Construct once per build (``FrameBuilder`` and ``SolidCoordinator``
    each own one).

    The logger argument is duck-typed: any object with a ``.log(msg,
    level=None)`` method works. ``None`` is allowed for tests / silent
    runs.
    """

    def __init__(self, app, design, logger=None):
        self.app = app
        self.design = design
        self.root = design.rootComponent if design else None
        self.logger = logger

    # ------------------------------------------------------------------
    # Logging
    # ------------------------------------------------------------------
    def _log(self, msg, level=None):
        if self.logger is None:
            return
        try:
            if level:
                self.logger.log(msg, level)
            else:
                self.logger.log(msg)
        except Exception:
            # Never let a misbehaving logger take down discovery.
            pass

    # ------------------------------------------------------------------
    # Aesthetic core body
    # ------------------------------------------------------------------
    def find_aesthetic_core_body(self):
        """Return the source body the frame is built around, or ``None``.

        Search ladder (preserves the original FrameBuilder behavior):

        1. Attribute tag ``FrameBuilder.ComponentType == 'AestheticCore'``
           on a component that has at least one BRep body.
        2. Occurrence named ``AESTHETIC_CORE`` (legacy convention).
        3. Occurrence whose component name contains ``b-spline set`` or
           ``terrain``; if that container has no bodies, drill into a
           ``clean solid`` child occurrence.
        4. First body on the root component.
        """
        self._log("Discovering aesthetic core body")

        if not self.design or not self.root:
            self._log("  DISCOVERY: no active design / root")
            return None

        # 1. Attribute search
        try:
            attrs = self.design.findAttributes(ATTR_NAMESPACE, ATTR_KEY)
            for attr in attrs:
                if attr.value == "AestheticCore":
                    comp = adsk.fusion.Component.cast(attr.parent)
                    if comp and comp.bRepBodies.count > 0:
                        self._log(
                            f"Aesthetic core found via Attribute on component: {comp.name}"
                        )
                        return comp.bRepBodies.item(0)
        except Exception as attr_err:
            self._log(f"  DISCOVERY: aesthetic-core attribute search failed: {attr_err}", "DEBUG")

        # 2. Legacy named occurrence
        existing_occ = self.root.occurrences.itemByName(CORE_OCCURRENCE_NAME)
        if existing_occ and existing_occ.component.bRepBodies.count > 0:
            self._log(f"Found {CORE_OCCURRENCE_NAME} occurrence")
            return existing_occ.component.bRepBodies.item(0)

        # 3. Name-pattern scavenge (with clean-solid drill-down)
        for occ in self.root.occurrences:
            try:
                c_name = occ.component.name.lower()
            except Exception:
                continue
            if not any(hint in c_name for hint in CORE_NAME_HINTS):
                continue

            self._log(f"Candidate component found: {occ.component.name}")
            target_comp = occ.component

            if target_comp.bRepBodies.count == 0:
                # Look deeper if it's a container
                for sub_occ in occ.childOccurrences:
                    try:
                        if CORE_SUBCOMP_HINT in sub_occ.component.name.lower():
                            target_comp = sub_occ.component
                            break
                    except Exception:
                        continue

            if target_comp.bRepBodies.count > 0:
                self._log(f"Aesthetic core body found in: {target_comp.name}")
                return target_comp.bRepBodies.item(0)

        # 4. Root-component fallback
        if self.root.bRepBodies.count > 0:
            self._log("Using first body in root component as aesthetic core")
            return self.root.bRepBodies.item(0)

        self._log("No aesthetic core found")
        return None

    # ------------------------------------------------------------------
    # Frame component
    # ------------------------------------------------------------------
    def find_frame_component(self):
        """Return the frame component to drop bars into, or ``None``.

        Search ladder (preserves the original SolidCoordinator behavior):

        1. Attribute tag ``FrameBuilder.ComponentType == 'Frame'``.
        2. Greedy scavenge — every occurrence whose component name
           contains ``frame`` (case-insensitive) is a candidate; the one
           with the highest trailing numeric index wins.
        3. Root component as ultimate failsafe.
        """
        if not self.root:
            self._log("  DISCOVERY ERROR: design root is missing.")
            return None

        # 1. Attribute search
        try:
            attrs = self.design.findAttributes(ATTR_NAMESPACE, ATTR_KEY)
            for attr in attrs:
                if attr.value == "Frame":
                    comp = adsk.fusion.Component.cast(attr.parent)
                    if comp:
                        self._log(f"  DISCOVERY HIT (Tag): '{comp.name}'")
                        return comp
        except Exception as attr_err:
            self._log(f"  DISCOVERY: attribute search failed: {attr_err}", "DEBUG")

        # 2. Greedy scavenge — pick the highest-numbered Frame_N
        self._log("  DISCOVERY: Attributes failed. Greedy scavenging...")
        best_comp = None
        max_idx = -1

        for occ in self.root.occurrences:
            try:
                cname = occ.component.name.lower()
            except Exception:
                continue
            if "frame" not in cname:
                continue

            try:
                match = re.search(r"\d+", cname)
                if match:
                    idx = int(match.group())
                    if idx > max_idx:
                        max_idx = idx
                        best_comp = occ.component
                elif not best_comp:
                    best_comp = occ.component
            except Exception:
                if not best_comp:
                    best_comp = occ.component

        if best_comp:
            self._log(f"  SCAVENGE HIT: Using frame-like component '{best_comp.name}'")
            return best_comp

        # 3. Root fallback
        self._log(f"  DISCOVERY FALLBACK: Using Root Component '{self.root.name}'")
        return self.root

    # ------------------------------------------------------------------
    # Frame outline sketch
    # ------------------------------------------------------------------
    def find_frame_sketch(self, target_comp):
        """Return ``(sketch, prefix)`` or ``(None, DEFAULT_SKETCH_PREFIX)``.

        Search order matches the original SolidCoordinator._find_sketch:

        1. Targeted scan inside ``target_comp``, walking categories in
           priority order (``FRAME ENCLOSURE`` > ``FRAME SKETCH`` >
           ``SHAPE OUTLINE``).
        2. Deep scan across ``design.allComponents`` using the same
           category priority.

        ``prefix`` is the ``snake_case_first_token`` of the matched
        sketch name (e.g. ``T1`` from ``T1_3_frame-enclosure``).
        """
        # 1. Targeted scan (with diagnostic enumeration first)
        if target_comp:
            self._log(f"  DISCOVERY: Searching project sketches in '{target_comp.name}'...")

            # Diagnostic: log every candidate sketch in the target component.
            for i in range(target_comp.sketches.count):
                sk = target_comp.sketches.item(i)
                self._log(
                    f"    SKETCH CANDIDATE: component='{target_comp.name}' sketch='{sk.name}'"
                )

            for category, patterns in SKETCH_CATEGORY_PATTERNS:
                for i in range(target_comp.sketches.count):
                    sk = target_comp.sketches.item(i)
                    sk_name = (sk.name or "").lower()
                    for pattern in patterns:
                        if pattern in sk_name:
                            self._log(
                                f"  SKETCH HIT: component='{target_comp.name}' "
                                f"sketch='{sk_name}' category='{category}' pattern='{pattern}'"
                            )
                            prefix = sk_name.split("_")[0]
                            return sk, prefix

        # 2. Deep scavenge across all components
        self._log("  SKETCH: Targeted search failed. Deep-scanning assembly by priority...")
        try:
            all_comps = self.design.allComponents
        except Exception as ac_err:
            self._log(f"  SKETCH: allComponents lookup failed: {ac_err}", "WARNING")
            return None, DEFAULT_SKETCH_PREFIX

        for category, patterns in SKETCH_CATEGORY_PATTERNS:
            for comp in all_comps:
                for i in range(comp.sketches.count):
                    sk = comp.sketches.item(i)
                    sk_name = (sk.name or "").lower()
                    for pattern in patterns:
                        if pattern in sk_name:
                            self._log(
                                f"  SKETCH HIT (Deep): Found '{sk_name}' in '{comp.name}' [{category}]"
                            )
                            prefix = sk_name.split("_")[0]
                            return sk, prefix

        return None, DEFAULT_SKETCH_PREFIX
