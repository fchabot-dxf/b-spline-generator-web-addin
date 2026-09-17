# NEXT — BG2: the last two P1 violations — route every host call through the bridge (B9 + B11)

**Ball: worker (seat A) · epoch 1 · BG2.** Files (under `bspline-frame-builder/b-spline-gen/html/`): `core/fusion-log.js`
(new, leaf), `core/fusion-bridge.js`, `core/coords.js`, `core/state.js`, `main/main.js`. One commit by path, predicted
**5 files (1 new)**.

## Ground truth (advisor-verified)
- Principle P1: host-specific behaviour lives ONLY in `core/fusion-bridge.js`. Three sites still call `adsk.fusionSendData`
  directly: `main/main.js:135` (`'get_design_params'`, B9) · `core/coords.js:14-15` (`'log'`, B11) ·
  `core/state.js:268-270` (`'log'`, B11). Each hand-rolls the same guarded `'log'` tunnel that `fusion-bridge.js:14-16`
  `fusLog` already declares.
- **Import cycle:** `fusion-bridge.js` imports `{P, isFusionMode, setIsFusionMode}` from `state.js` and `COORD_SYSTEM`
  from `coords.js`. So `coords.js`/`state.js` must NOT import from the bridge. The declared shape: a LEAF module
  `core/fusion-log.js` with no imports that owns `fusLog`; the bridge re-exports it so every existing
  `import { fusLog } from './fusion-bridge.js'` keeps working.

## Do
1. New `core/fusion-log.js`:
   ```js
   // The one Fusion log tunnel (P1: host calls live in the bridge layer; this leaf exists so core/ modules the
   // bridge itself imports can log without an import cycle). No imports.
   export function fusLog(msg) {
     try { if (typeof adsk !== 'undefined' && adsk.fusionSendData) adsk.fusionSendData('log', JSON.stringify({ msg: String(msg) })); } catch (_) { }
   }
   ```
2. `fusion-bridge.js`: delete its local `fusLog` (:14-16) and add `export { fusLog } from './fusion-log.js';` at the top
   (also `import { fusLog } from './fusion-log.js';` if the bridge calls it internally — it does).
3. `coords.js:14-15` and `state.js:268-270`: replace the inline guarded call with `fusLog(msg)` / `fusLog(JSON.stringify(session))`
   (import from `./fusion-log.js`). Keep the surrounding `if (isFusionMode…)`-style gating if any; drop the
   `typeof adsk` guards (the leaf owns them).
4. B9: add to `fusion-bridge.js` `export function requestDesignParams() { try { adsk.fusionSendData('get_design_params', '{}'); } catch (e) { fusLog('requestDesignParams FAILED: ' + e.message); } }`
   and call it from `main.js:135` (import it; the reply still arrives as the `sync_board` handshake — unchanged).
5. Grep afterwards: `fusionSendData(` outside `core/fusion-bridge.js` and `core/fusion-log.js` → 0 across `html/`
   (the inline `<script>` in the palette HTML is the named exception — leave it).

## Verify
- `node --check` ×5; `npx vitest run` → 29 (state.js and coords.js are under test — this is the byte-identity gate).
- Greps as in step 5; `fusLog` defined once (`fusion-log.js`), re-exported once.
- `git show --stat HEAD` → 5 files. Web look (the site rebuilds on push) + Fusion look are the ADVISOR's.

## Do NOT
Touch the palette HTML, `pollMode`, the chunked send, or any Python.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "BG2: fusion-log.js leaf owns fusLog (bridge re-exports); coords/state use it; requestDesignParams() in the bridge replaces main.js's direct call — <sha>, 5 files; fusionSendData outside bridge/log = 0; vitest 29. B9+B11 closed."`
and stop.
