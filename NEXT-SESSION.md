# NEXT — BG3: Fusion import feedback goes to a button that no longer exists — retarget it, wire the dead sends, add the missing label

**Ball: worker (seat A) · epoch 1 · BG3.** Files (under `bspline-frame-builder/b-spline-gen/html/`): `main/main.js`,
`main/export-flow.js`, `core/fusion-bridge.js`, `bspline_gen_palette.html`. One commit by path, predicted **4 files**.

## Ground truth (advisor-verified 2026-09-17)
- `#btnFusionApply` was REMOVED from the palette HTML on 2026-04-09 (`4cc7907`). Four JS sites still target it, all
  null-guarded, so every state change lands nowhere: `main.js:122` (reset to 'OK' on load), `main.js:158`
  (`import_ready`/`reset_ui` → 'OK'), `export-flow.js:137-148` ('Baking...' → 'OK'), `export-flow.js:158-163` (same,
  in `executeExport`); `startFusionPolling(btnApply)` (`fusion-bridge.js:65-88`) re-enables it on timeout.
- The LIVE control in Fusion mode is the header button `#btnDownload`, relabelled 'Send to Fusion' by `main.js:118`
  (`header-controls.js:19` calls it "STEP / Send to Fusion (mode-aware)"). Its idle label in Fusion mode is
  **'Send to Fusion'**, never 'OK' — 'OK' was the vanished apply button's label.
- Python sends `import_progress` `{msg}` from 8 sites (`b-spline-gen.py:180-187` `_send_progress`) and `import_success`
  once (`:1319`); `handleFusionHandshake` (`main.js:153-`) handles neither. So a STEP import shows NOTHING.
- `cloud-project-manager.js:887` reads `#fmCurrentFileLabel` — never existed in the HTML (added JS-side 2026-05-02 only).
  The header title box is `bspline_gen_palette.html:261-268` (`.cad-nav-titlebox` → title span + `#build-badge`).

## Do
1. **Declare the one button once.** In `core/fusion-bridge.js` add and export:
   ```js
   /** The single control that reflects Fusion send/import state: the header 'Send to Fusion' button.
    *  (#btnFusionApply was removed from the HTML on 2026-04-09; this replaces four null-guarded lookups.) */
   export const FUSION_IDLE_LABEL = 'Send to Fusion';
   export function fusionActionButton() { return document.getElementById('btnDownload'); }
   export function setFusionActionState(text, disabled) {
     const b = fusionActionButton(); if (!b) return;
     b.textContent = text; b.disabled = !!disabled;
   }
   ```
2. Replace the four `getElementById('btnFusionApply')` sites with the helper, and every `'OK'` restore with
   `FUSION_IDLE_LABEL`: `main.js:122` → `setFusionActionState(FUSION_IDLE_LABEL, false)`; `main.js:158` (import_ready /
   reset_ui) → same; `export-flow.js:137-148` → `setFusionActionState('Baking...', true)` / finally
   `setFusionActionState(FUSION_IDLE_LABEL, false)`; `export-flow.js:158-163` → the `btn` local becomes
   `fusionActionButton()` in Fusion mode (keep the web `btnWizardExport` branch as is); `startFusionPolling` timeout →
   `setFusionActionState(FUSION_IDLE_LABEL, false)`. Grep `btnFusionApply` → 0 afterwards.
3. **Wire the dead sends** in `handleFusionHandshake` (`main.js`), before the `pong` line:
   ```js
   if (action === 'import_progress') {
       let msg = ''; try { msg = JSON.parse(ev.detail.data || '{}').msg || ''; } catch (e) {}
       if (msg) setFusionActionState(msg, true);
       return;
   }
   if (action === 'import_success') { setFusionActionState('Done ✓', true); return; }
   ```
   (`import_ready` follows `import_success` from Python and restores the idle label — verify that order in
   `b-spline-gen.py:1315-1325`; if `import_ready` is NOT sent after success, restore the idle label from
   `import_success` after a 1500 ms timeout instead, and say which you did.)
4. **Add the missing label:** in `bspline_gen_palette.html` inside `.cad-nav-titlebox`, right after the
   `#build-badge` span: `<span id="fmCurrentFileLabel" class="cad-nav-version" style="display:none"></span>`.
   (`updateHeaderFileIndicator` already fills and shows/hides it.)

## Verify (fast tier)
- `node --check` on the three `.js` files. `npx vitest run` → 29 (main/app-init.js is under test; main.js is not — fine).
- Greps: `btnFusionApply` → 0 across `html/`; `'OK'` in main.js/export-flow.js → 0 (Fusion mode never shows 'OK');
  `import_progress|import_success` → present in main.js once each; `fmCurrentFileLabel` → 1 in the HTML.
- `git show --stat HEAD` → 4 files.
- Fusion look is the ADVISOR's: Send to Fusion → button shows 'Baking...', then the Python progress messages, then
  'Done ✓', then back to 'Send to Fusion'; Project Manager load → header shows '· <name>'.

## Do NOT
Touch `b-spline-gen.py`, the polling interval, `btnWizardExport` (web), or the editor.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "BG3: fusionActionButton/setFusionActionState/FUSION_IDLE_LABEL declared in fusion-bridge; 4 btnFusionApply sites retargeted; import_progress/import_success wired; fmCurrentFileLabel added — <sha>, 4 files; vitest 29; greps clean. Next: E7c."`
and stop.
