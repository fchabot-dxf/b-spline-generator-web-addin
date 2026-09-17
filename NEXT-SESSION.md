# NEXT — PM2: one door to the Project Manager, and labelled top-bar buttons on wide screens (Fred's ruling)
n**Note:** DEC1's folder deletion is being done by the advisor (your classifier refused it — correct call to stop). Your 7 comment fixes are accepted.

**Ball: worker (seat A) · epoch 1 · PM2.** Files: `bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html`,
`bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js`. One commit by path, predicted **2 files**.

## Ground truth (advisor-verified)
- Sidebar: the whole first panel (`:314-323`, `<div class="panel" …>` → `<button … data-open-projects …>📁 Projects</button>`)
  now holds only that button (Load left in PM1). Ruling: **drop it**; the top-bar folder icon is the one door.
- JS: `cloud-project-manager.js:154` wires `document.querySelectorAll('#btnOpenProjectManager, [data-open-projects]')`.
  After the removal `[data-open-projects]` matches nothing → a door with no room; narrow the selector to
  `#btnOpenProjectManager` (and any other `data-open-projects` grep hit → 0).
- Top bar (`:281-294`): `btnQuickSave` already has a hidden label span (`#btnQuickSaveLabel`, toggled by
  `updateNavbarSaveLabel` in cloud-project-manager.js — read it and keep its behaviour); `btnOpenProjectManager`,
  `btnDownloadAddin`, `settings-btn` are icon-only with `title=`. The palette's own `<style>` declares
  `.cad-navbar .cad-nav-btn` (`:159`) and `.cad-nav-btn > span` (`:182`) with a mobile block at
  `@media (max-width: 600px), (pointer: coarse)` (`:212-230`). Ruling note: "make them use labels too on desktop or
  wide screen ui".

## Do
1. Delete the sidebar panel `:314-323` (the enclosing `<div class="panel">` … `</div>` — nothing else in it).
2. `cloud-project-manager.js:154`: selector → `'#btnOpenProjectManager'` only; comment updated.
3. **Declare the label once.** Add to each of the three icon-only nav buttons a `<span class="cad-nav-label">Projects</span>`
   / `Add-in` / `Settings` after the icon span (keep the `title`s). In the palette `<style>`, next to `.cad-nav-btn > span`,
   declare: `.cad-nav-label { display: none; margin-left: 6px; font-size: 12px; }` and
   `@media (min-width: 601px) and (pointer: fine) { .cad-nav-label { display: inline; } }` — the exact complement of
   the existing mobile block, so the two can never overlap. Give `#btnQuickSaveLabel` the same class so its JS-toggled
   text follows the same rule (check `updateNavbarSaveLabel`: if it sets `display` inline, switch it to toggling
   `hidden` on the span so CSS keeps ownership of the breakpoint — say which).
4. Nothing else. STEP / Send to Fusion (`btnDownload`) is already a labelled button.

## Verify
- `node --check main/cloud-project-manager.js`; extract + `node --check` the palette's inline scripts (as E7c).
- `npx vitest run` → 29. Greps: `data-open-projects` → 0; `cad-nav-label` → 4 spans + 2 rules.
- `git show --stat HEAD` → 2 files. Web look (Pages rebuild) + Fusion look (palette at 1000 px shows labels; the
  Fusion palette at narrow width hides them) are the ADVISOR's.

## Do NOT
Touch the modal, Quick Save's behaviour, or any other panel.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "PM2: sidebar Projects panel removed; selector narrowed; cad-nav-label declared on 4 top-bar buttons, shown ≥601px + fine pointer — <sha>, 2 files; vitest 29. Next: IN4."`
and stop.
