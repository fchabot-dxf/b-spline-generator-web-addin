# DEDUP-FINISH-DESIGN — classify the remaining `_shared_project_names` (E6)

**Status:** investigation / design pass (E6). No code. For advisor review.
**Author:** worker, turn 97.
**Question:** C4 consolidated the 2 genuinely-drifted modules (`expression_coords`, `entity_helpers`)
into `fb_shared`. Is there any de-dup left in the other 16 `_shared_project_names` entries — or are they
all single-palette (defensively wiped)?

## TL;DR — de-dup is DONE; the wipe is load-bearing, not dead

Classifying the 16 (post-S5) entries:

| bucket | meaning | count |
|---|---|---|
| **(A)** duplicated + drifted across 2+ palettes → consolidate into `fb_shared` | real de-dup candidate | **0** |
| **(B)** single-palette, only *defensively* wiped (dead no-op) → retire like S5 | dead wipe | **0** |
| **(C)** keep wiping (genuine reason) | hot-reload | **16** |

**Nothing is in (A):** every one of the 16 exists in exactly ONE palette folder — there are no drifted
duplicates left to merge. C4 already finished the real de-dup.

**Nothing is in (B) either:** unlike S5's two names (retired because their consumers had switched to
`from fb_shared.X import …`, so the *bare* name was never in `sys.modules` and wiping it was a proven
no-op), **all 16 remaining names have live production bare-name importers.** So the wipe is NOT dead —
it forces each sub-add-in's own modules to re-import from disk on every Stop→Start (**hot-reload**).
Retiring `_force_wipe(_shared_project_names)` would silently bind a re-bootstrapped sub to STALE cached
code — the S4-class regression, Fusion-visible, not headless-catchable.

**⇒ E6 has no (A) consolidation slice and no (B) cleanup slice.** The only defensible change is an
optional micro-simplification of the *repetition* (3× → 1×), below — low value, Fusion-gated.

---

## 1. Map — each name's single home + import surface (ground truth)

Every name resolves to ONE file (`find … -name <name>.py`, excl tests/pycache/dist):

| # | name | single home folder | live bare-import consumers (prod) | `import_module` |
|---|---|---|---|---|
| 1 | `entity_util` | `template-maker/core/` | relation_hints:32, ownership_gate:48, coincidence_clusters:61, offset_hint:48, variable_scan:48, template_payload:8 | — |
| 2 | `payload_builder` | `frame-inspector/` | fusion-inspector.py:23 | — |
| 3 | `phase_parser` | `template-maker/core/` | template_generator:3, template_payload_builder:15 | — |
| 4 | `role_points` | `template-maker/core/` | relation_hints:33, rename_selection:5 | — |
| 5 | `cc_proxy` | `template-maker/core/` | relation_hints:50, ownership_gate:57 | — |
| 6 | `fb_attributes` | `template-maker/core/` | coincidence_clusters:62, ownership_gate:65, rename_selection:12 | — |
| 7 | `ownership_gate` | `template-maker/core/` | template_payload:200 | — |
| 8 | `relation_hints` | `template-maker/core/` | dimension_hint:148, coincidence_clusters:63, ownership_gate:49, template_payload:17 | — |
| 9 | `coincidence_clusters` | `template-maker/core/` | template_generator:31 | — |
| 10 | `template_generator` | `template-maker/core/` | template_bridge:6 | template-maker.py:222 |
| 11 | `template_code` | `template-maker/core/` | template_payload_builder:14, template_generator:23 | template-maker.py:224 |
| 12 | `template_payload` | `template-maker/core/` | template_generator:8, template_payload_builder:1, template_naming:2, rename_selection:2 | template-maker.py:223 |
| 13 | `detect_projections` | `template-maker/core/` | template_bridge:8 | template-maker.py:234 |
| 14 | `rename_selection` | `template-maker/core/` | template_bridge:7 | template-maker.py:225 |
| 15 | `deferred_rebuild` | `template-maker/core/` | (self-reimport guard :35) | template-maker.py:226 |
| 16 | `exporter` | `fusion-exporter/` | fusion-exporter.py:15 (`from . import exporter` fallback :10) | — |

**Import-surface note (the S4b lesson — 3 places any move must sweep):**
- **bare `from X import` / `import X`** — the column above (14 template-maker/core + `payload_builder` in
  frame-inspector + `exporter` in fusion-exporter).
- **`importlib.import_module('X')`** — `template-maker.py:222-234` for 6 names (`template_generator`,
  `template_payload`, `template_code`, `rename_selection`, `deferred_rebuild`, `detect_projections`).
  This is the dynamic surface a `from X import` grep misses (S4b).
- **wipe-list** — all 16 in `_shared_project_names` (`bspline-frame-builder.py:251-262`), wiped 3×
  (`:264`, `:271`, `:278`).

## 2. Why (C) not (B) — the wipe is hot-reload, not dead

`_force_wipe` (`bspline-frame-builder.py:82`) deletes a name (and its sub-packages) from `sys.modules`
so the next import re-executes the file. On a Fusion Stop→Start, `_bootstrap()` reloads each sub-add-in
via `_load_submodule`; that sub then re-imports its own modules **by bare name**. If those names are
still cached from the previous session, Python returns the STALE module and the dev's edits don't take
effect. Because every one of the 16 has a live bare-name (or `import_module`) consumer, wiping them is a
real operation, not the dead no-op S5 removed. Hence **(C) keep** for all 16.

*(S5 contrast: `expression_coords`/`entity_helpers` consumers had moved to `from fb_shared.… import`, so
the bare names were never in `sys.modules` → wiping them did nothing → safe to retire. That condition
does NOT hold for any of these 16.)*

## 3. Slicing proposal

- **(A) consolidation slices: none.** No drifted duplicates remain — de-dup is complete.
- **(B) wipe-list retirement slice: none.** All 16 are live; retiring them breaks hot-reload.
- **Optional micro-cleanup (LOW priority, Fusion-gated) — reduce the 3× wipe to 1×:** the three
  wiped sub-add-ins use **disjoint** subsets of the 16 names —
  `fusion-exporter → {exporter}`, `frame-inspector → {payload_builder}`,
  `template-maker → {the other 14}` — with **zero overlap** post-C4. The per-sub repetition existed to
  stop one sub binding to a *sibling's* cached copy of a shared name; with no shared names left across
  subs, a single `_force_wipe(_shared_project_names)` before the first sub-load gives identical
  hot-reload behaviour. Alternatively, split into three per-sub lists so each sub wipes only what it
  imports (self-documenting). **This is behaviour-neutral only if verified carefully** (the S4b
  dynamic-import + wipe-list interaction is subtle) and its payoff is tiny (two redundant idempotent
  calls). Recommend leaving it unless the advisor wants the tidy-up; if taken, it's ONE Fusion-gated
  slice (Stop→Start both edited-and-reloaded to confirm hot-reload still works).

## 4. Recommendation

**Close E6 as "de-dup already complete."** No `fb_shared` consolidation and no wipe-list retirement are
warranted — the earlier suspicion (C4 §5) that "most are single-palette" is confirmed *and* they're
single-palette WITH live consumers, so the wipe stays. The only open item is the optional 3×→1×
micro-cleanup, which I'd defer unless you specifically want it.

---

*No code was modified in this pass — investigation/design only.*
