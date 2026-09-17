# NEXT — UX3: Undo/Redo leave the sidebar; they join the top bar next to Save (Fred's ruling)

**Ball: worker (seat A) · epoch 1 · UX3.** File: ONLY `bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html`.
One commit by path, predicted **1 file**. No JS changes: `core/history.js:75 updateGlobalButtons` finds the buttons
by id (`btnGlobalUndo` / `btnGlobalRedo`), and the click wiring + Ctrl+Z/Y shortcuts stay as they are.

## Ground truth (advisor-verified)
- Sidebar sticky header (`:322-334`): `#btnRandomSeed` ("🎲 Generate New Seed") then a flex row with `#btnGlobalUndo`
  / `#btnGlobalRedo` (both `disabled` at load; enabled by history.js).
- Top bar (`:281-300`): `btnQuickSave` (💾 + `#btnQuickSaveLabel.cad-nav-label`), `btnOpenProjectManager` (📁 Projects),
  `btnDownloadAddin` (🧩 Add-in, hidden in Fusion), `btnDownload` (STEP / Send to Fusion), `settings-btn` (⚙ Settings).
  PM2/PM2b declared `.cad-nav-label` + the `min-width:601px and pointer:fine` block that shows labels and lets
  `.cad-navbar .cad-nav-btn` size to content.

## Do
1. Delete the flex row holding the two buttons from the sidebar sticky header (`:329-333`) and the `margin-top`
   wrapper it lived in. "Generate New Seed" stays, alone, in that header.
2. Insert BEFORE `btnQuickSave` in the top bar, same markup shape as the other nav buttons:
   ```html
   <button class="cad-btn cad-btn-secondary cad-nav-btn" id="btnGlobalUndo" title="Undo (Ctrl+Z)" disabled>
     <span style="font-size:18px; line-height:1;">↶</span><span class="cad-nav-label">Undo</span>
   </button>
   <button class="cad-btn cad-btn-secondary cad-nav-btn" id="btnGlobalRedo" title="Redo (Ctrl+Y)" disabled>
     <span style="font-size:18px; line-height:1;">↷</span><span class="cad-nav-label">Redo</span>
   </button>
   ```
   (keep the `disabled` initial state; `updateGlobalButtons` flips it). If the icon glyphs fall back to a monochrome
   font that looks wrong next to the emoji, use `⟲` / `⟳` instead and say so.
3. Nothing else. Check the mobile block (`:212-235`) still fits seven 44 px buttons in the bar at 600 px; if it wraps,
   report it, don't fix it here.

## Verify
- Extract + `node --check` the inline scripts (unchanged). `npx vitest run` → 29.
- Greps: `btnGlobalUndo` → 1 in html (top bar), 1 in history.js; the sidebar header contains only `btnRandomSeed`.
- `git show --stat HEAD` → 1 file. Look is the ADVISOR's (Fusion 1000 px: ↶ Undo · ↷ Redo · Save… · Projects · Send to
  Fusion · Settings; make an edit → Undo enables).

## Do NOT
Touch history.js, global-events.js, or the sidebar panels below the sticky header.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UX3: Undo/Redo moved to the top bar (ids kept), sidebar header keeps Generate New Seed — <sha>, 1 file; vitest 29. Next: UX2."`
and stop.
