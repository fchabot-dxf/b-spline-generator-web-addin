# Sketches Import and Template Structure

This document explains how the `bspline-frame-builder/frame-builder/sketches` tree is organized and how sketch templates are discovered, imported, and wired into the engine.

## Folder layout

Each template lives in its own folder under `frame-builder/sketches`:

- `template_1/`
- `template_2/`

Inside each template folder the minimum canonical layout is:

- `template_data.py`
- `template_loader.py`
- `sketch_1_...py`, `sketch_2_...py`, `sketch_3_...py`
- `phases/`
  - `pNN_MM_*.py`

The engine also supports the older legacy pattern where the template data file was named `template_data_N.py`, but the new canonical name is `template_data.py`.

## `template_loader.py`

`template_loader.py` is the discovery layer for a template folder. It performs these jobs:

1. Scan the current template folder for sketch wrapper modules named using the pattern:
   - `sketch_<N>_<token>.py`

2. Sort the discovered sketch files by their numeric sketch index (`<N>`), so:
   - `sketch_1_...py` becomes sketch 1
   - `sketch_2_...py` becomes sketch 2
   - `sketch_3_...py` becomes sketch 3

3. For each sketch wrapper, import it and collect the returned phase block definitions.

4. Expose helper functions such as:
   - `load_all_sketches(ui_data)`
   - `reload_all()`
   - `load_phase_blocks()`

This means the template folder is mostly declarative: sketch wrappers and phase blocks are discovered automatically, not hand-registered.

## `template_data.py`

`template_data.py` is the template entry point. Its role is:

- call `load_all_sketches(ui_data)` from `template_loader.py`
- assign the returned sketches into the top-level template structure
- optionally customize sketch labels and parameter lists

A typical `template_data.py` looks like this:

- Discover sketches automatically using `template_loader`
- Bind the sketches into a dictionary list:
  - `"Sketches": [s1, s2, s3]`

That list is what the runtime engine consumes.

## Sketch wrapper files

Each sketch wrapper is a small module named by convention:

- `sketch_1_bounding_box.py`
- `sketch_2_shape_outline.py`
- `sketch_3_frame_enclosure.py`

These wrapper modules import `load_phase_blocks` from `template_loader` and expose whatever metadata the template needs for that sketch:

- sketch label
- sketch-level parameters
- phase block definitions

The wrapper file itself is not the phase implementation; it is a container that loads the phases from `phases/`.

## Phase files and `PhaseID`

Phase files now use the naming pattern:

- `p01_01_bb_layout.py`
- `p02_05_chain.py`
- `p03_02_encl_offset.py`

Each phase file contains a block that includes a `PhaseID` string. The current convention is:

- `PhaseID` should match the filename stem exactly
- Example: filename `p02_05_chain.py` contains `"PhaseID": "p02_05_chain"`

This means the on-disk filename and the internal `PhaseID` are in sync.

### Why this matters

The new phase naming scheme is no longer the old single-number style like `p04_anatomy`.
The current convention is the two-part scheme `pNN_MM_<token>`.
This is the form the loader and template engine now expect for clean ordering and phase identity.

## How the engine uses the template structure

The runtime engine loads templates through the `fb_engine` path.
In particular:

- `fb_engine/frame_engine.py` discovers each template folder like `template_1` and `template_2`
- it looks for `template_data.py` or legacy `template_data_N.py`
- it imports the template module and reads the `"Sketches"` list

Once the template is loaded, `fb_engine/parametric_engine.py` iterates the sketches and their phases and builds the Fusion sketch geometry in the right order.

## Adding or updating sketches

To add a new sketch:

1. create a new wrapper named `sketch_<N>_<token>.py`
2. add that file next to `template_data.py` and `template_loader.py`
3. create the sketch phases in the `phases/` subfolder
4. ensure each phase file uses a `PhaseID` that matches its filename stem

The loader will automatically discover the new sketch and include it in the template order.

## Summary

- `template_loader.py` auto-discovers sketches and phase files
- `template_data.py` is the template entry point that exposes `"Sketches"`
- sketch wrappers are named `sketch_<N>_<token>.py`
- phase files are named `pNN_MM_<token>.py`
- `PhaseID` should match the filename stem
- `fb_engine` supports both `template_data.py` and legacy `template_data_N.py`

This file is intended to clarify the import chain and naming conventions used by the sketch templates system.