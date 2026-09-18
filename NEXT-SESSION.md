# LANE B — T4: SE3b STYLE-control overlap (CSS, declared rule) + BUGS_OPEN entry B12 for SE3a

**Seat B · epoch 1 · T4.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b`. Files:
`bspline-frame-builder/styles/base.css`, `bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html` (lines
1263-1275 ONLY — seat A is editing the same file further down, tool rail ~1312+ and the modal script; stay out of
those regions), `BUGS_OPEN.md`, + WORK-LOG-lane-b.md. One commit by path, predicted **3 files** + log.

## 1. SE3b — the STYLE segmented control renders "ROKELBOTH" (live, 2026-09-18 08:20)
Cause: the three buttons `#editorFillModeStroke/Fill/Both` (palette :1267-1275) carry `class="cad-icon-btn small
editor-fillmode-btn"`; `.cad-icon-btn` is a 16 px ICON button (`styles/base.css:1304-1313`, `width:16px`), so three
text labels are squeezed into 48 px and overlap. Fix by DECLARING the control instead of piling inline styles:
- Drop `cad-icon-btn small` from the three buttons; keep `editor-fillmode-btn` (+ `active`).
- Move their inline `style="…"` into ONE rule set in `styles/base.css` next to `.cad-icon-btn`:
  `.editor-fillmode-btn { border:none; background:transparent; color:#555; padding:0 8px; height:100%;
  font-size:10px; font-weight:700; letter-spacing:0.04em; cursor:pointer; }`,
  `.editor-fillmode-btn + .editor-fillmode-btn { border-left:1px solid #ddd; }`,
  `.editor-fillmode-btn.active { background:#e8f0ff; color:#1a55b8; }`.
  Check `editor/properties-panels.js` / wherever `.active` is toggled on these buttons: if it sets inline
  background/color too, remove that hand-rolled styling so the rule is the only source.
- No width anywhere: the label sets the width.

## 2. B12 — record SE3a in BUGS_OPEN.md as OPEN (the advisor found it live; you own that file now)
Title: "SVG editor Cancel does not revert; Apply of an emptied canvas keeps the stale mask". Status OPEN, proof lines:
`main/app-init.js:118-127` (Cancel restores the legacy `P.stampLayers[idx]` fields, not `P.editorSvg` nor the editor
document), `main/stamp/svg-source.js:91-97` (snapshot reads `.svg` off an EDITOR layer → `undefined`),
`main/stamp-mask-manager.js:40-76` (`updateStampMasks` returns early on an empty work list and never nulls the mask
of a layer that lost its content). Add it to the summary table. Fix is queued as SE3a on main (seat A), not yours.

## Verify
- Extract the palette's inline script + `node --check` (untouched, sanity); `npx vitest run` → 36 green.
- Greps: `cad-icon-btn small editor-fillmode-btn` → 0; `editor-fillmode-btn` → 3 in the html, ≥3 rules in base.css;
  the three buttons have NO `style=` attribute.
- `git show --stat HEAD` → 3 files + log. Look is the ADVISOR's (deploy + capture).

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T4: SE3b fillmode rule + B12 entry — <sha>, 3 files"`
and stop.
