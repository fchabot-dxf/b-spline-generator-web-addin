# NEXT — PM1 Project Manager: restore the lost Load/Rename/Delete bar + remove the sidebar Load button

**Ball: worker · epoch 1 · PM1 (human ruling 2026-09-17, see ROADMAP "PM1").** Files: ONLY
`bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html` and
`bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js`. One commit, by path, predicted **2 files**.

## Ground truth (advisor-verified)
- Commit `91b624d` (2026-05-23) accidentally deleted, from the Project Manager modal in
  `bspline_gen_palette.html`, the block that starts `<!-- Bottom selection bar -->` and ends with
  `<input type="hidden" id="fmProjectName">` (selection bar with `fmSelbarInfo` / `fmBtnLoad` / `fmBtnRename` /
  `fmBtnDelete`, then the `pm-status-bar` with `fmProjectStatus` / `fmProjectMsg`, then the hidden input).
  The CSS for all of it is still in HEAD (`.pm-selbar` :1806, `.pm-status-bar` :1836) and the JS still looks every id
  up (`cloud-project-manager.js:231-243`, null-guarded) — so restoring the markup is the whole fix.
- The sidebar `📂 Load` button (`btnQuickLoad`, html ~:322-331 incl. its HTML comment) is wired at
  `cloud-project-manager.js:166-169` to `export async function quickLoad()` (~:966-980). `quickLoad` is imported
  NOWHERE else (repo grep). The sidebar `📁 Projects` button (~:316-321) and the navbar `btnOpenProjectManager`
  (:285) both open the manager and STAY. Quick Save (navbar 💾) STAYS.
- Node is v24 → `node --check` understands the ES-module file directly.

## Do
1. **Restore the deleted block verbatim.** Source of truth:
   `git show 91b624d^:bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html` — copy from the line
   `<!-- Bottom selection bar -->` through the line `<input type="hidden" id="fmProjectName">` (inclusive).
   Insert it immediately AFTER the `</div>` that closes `<div id="fmProjectList" class="pm-content" …>` (:1952-1957)
   and BEFORE the `</div>` that closes `.pm-dialog`. Do not edit the block's contents.
2. **Remove the sidebar Load chain** — every link, nothing more:
   (a) html: the `btnQuickLoad` `<button>…</button>` AND the `<!-- Quick Load: … -->` comment above it;
   (b) js :166-169: the "Sidebar Quick-Load button" comment + `const btnQuickLoad …` + its `addEventListener`;
   (c) js: the whole `export async function quickLoad() { … }` and its `/** Quick Load from outside the modal … */`
   doc comment;
   (d) js ~:940-944: the `_loadFrom` doc comment says "Shared by the modal Load button and the sidebar Quick-Load" —
   reword to "Used by the modal Load button and row double-click." (a comment that names a deleted thing is a lie).
3. Leave the `📁 Projects` button in place; if its row was a two-button flex row, it simply spans alone now — no
   style edits beyond deleting the Load button.

## Verify (fast tier)
- `node --check bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js` → clean.
- Each of `fmSelbarInfo fmBtnLoad fmBtnRename fmBtnDelete fmProjectStatus fmProjectMsg fmProjectName` occurs
  **exactly once** in the html (`grep -c`).
- `grep -rnE "btnQuickLoad|quickLoad|Quick.?Load" bspline-frame-builder/b-spline-gen/html --include=*.html --include=*.js`
  → **0 hits** (the inverse sweep: no door without a room, no room without a door).
- `git show --stat HEAD` → 2 files. If anything else changed, say so.
- The visual check (modal shows Load/Rename/Delete + status line; sidebar shows Projects only) is the ADVISOR's:
  it deploys + screenshots. You do not deploy.

## Do NOT
Touch `dist/` (generated, untracked), `index.html`, any other palette, `quickSave`, `_loadFrom`, `onLoad`,
`btnOpenProjectManager`. Don't "improve" the restored markup. Don't run the full vitest suite (no spec imports this
module; if you find one that does, run only that spec and say so).

## When done
Append WORK-LOG, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "PM1: restored selbar+status+hidden input from 91b624d^, removed sidebar Load chain (button+comment+wiring+quickLoad export+doc comment) — <sha>, 2 files. node --check clean; ids ×1 each; Quick-Load grep 0. Next: E7b."`
and stop.
