# NEXT — COS1: the last two cosmetic nits (FB3b chip + CAM1d header) — final task of this cycle

**Ball: worker (seat A) · epoch 1 · COS1.** Files: `bspline-frame-builder/frame-builder/ui/html/sketch_builder_palette.html`,
`bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html`. One commit by path, predicted **2 files**, CSS/markup
only, no behaviour change.

## Ground truth (advisor, live captures)
- **FB3b:** the `new` chip is `display:inline-block` (`sketch_builder_palette.html:49-53`) yet renders stretched across
  the whole label column: it sits as a direct child of a grid/flex cell (`.cad-field-row` is a 2-column grid), so the
  cell stretches it. Fix at the chip: `width: max-content; justify-self: start; align-self: start;` — or wrap name +
  chip in one `<span class="param-meta">` inline container. Pick the one that needs no new element if it works.
- **CAM1d:** the merged CAM header (`cam_builder_palette.html:339-354`) puts tabs + `#build-badge` + the mode's
  `#status-summary-*` + the mode's action button on ONE row; at the docked 460 px the status wraps and PREVIEW is
  clipped. Fix: keep row 1 = title + tabs + the action button (right-aligned, never clipped); move `#build-badge` and both
  `#status-summary-*` spans into a NEW second row `<div class="cam-header-meta">` under the tabs (10 px, muted, `gap`,
  `flex-wrap: wrap`). The `data-mode` show/hide logic must keep working for the status spans (check `switchMode`'s
  selector — if it targets `.cam-tab-header-item` regardless of parent, nothing else changes).

## Verify
- Extract + `node --check` both palettes' scripts (unchanged logic; sanity).
- Greps: `param-new` rule contains `max-content` or `justify-self`; `cam-header-meta` → 1 div + 1 rule;
  `#build-badge`, `#status-summary-bspline`, `#status-summary-generic` still exactly once each.
- `git show --stat HEAD` → 2 files. Look is the ADVISOR's (deploy + captures at docked width).

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "COS1: FB3b chip sized to content; CAM1d header split into tabs+action / meta rows — <sha>, 2 files. Task list exhausted."`
and stop.
