# NEXT — BG1b: BG1 regression — `cloud-project-manager.js` still uses `P` but no longer imports it

**Ball: worker (seat A) · epoch 1 · BG1b.** File: ONLY `bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js`.
One commit by path, predicted **1 file, 1 line**. BG1 is otherwise accepted; it is NOT pushed until this lands.

## Ground truth (advisor-verified)
BG1 changed line 17 to `import { preDelta, postDelta, extraThickenThinMask, persistableP } from '../core/state.js';`
— dropping `P`. But `P` is still read at `:664-668` (`stockW: P.widthIn`, `stockH`, `resolution`, `noiseType`,
`hasStamps: … P.stampLayers …`) inside the project-metadata builder. In a browser that is a `ReferenceError: P is not
defined` the first time a project is saved. `node --check` cannot see it (syntax only) and no vitest imports this file.

## Do
Line 17 → `import { P, preDelta, postDelta, extraThickenThinMask, persistableP } from '../core/state.js';`
Nothing else.

## Verify
- `node --check` the file.
- **Undefined-import sweep for every JS file BG1 touched** (this is the check BG1 lacked) — from `b-spline-gen/html/`:
  for each of `core/history.js`, `core/state.js`, `main/cloud-project-manager.js`, `core/fusion-bridge.js`,
  `main/export-flow.js`, `core/stepWriter.js`: list the identifiers used as `X.` or `X(` at top level that are neither
  declared in the file nor in its `import {...}` lists nor globals (`document`, `window`, `JSON`, `Math`, `console`,
  `adsk`, `localStorage`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `fetch`, `Float32Array`,
  `Array`, `Object`, `Number`, `String`, `Date`, `Promise`, `Error`). Report the list per file; it must be empty.
  (`npx eslint --no-eslintrc --env browser,es2022 --parser-options=sourceType:module --rule 'no-undef:2' <files>` does
  this if eslint is available under `node_modules/.bin`; if not, do it by grep and say so.)
- `git show --stat HEAD` → 1 file.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "BG1b: P re-imported in cloud-project-manager.js — <sha>, 1 file; no-undef sweep on the 6 BG1 files: <empty|list>. Next: BG3."`
and stop.
