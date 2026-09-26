# WORK-LOG — reg-addin (Asus) — worker, APPEND ONLY

## 2026-09-26 — turn 1 — R1 FORMULA-FIELDS stage 1 (items 1-5)

**Landed:**
- `html/core/formula.js` (items 1+2): tokenizer + recursive-descent parser for + - * / ( ), unary +/-,
  decimals (`7`, `7.5`, `.5`, `3.`) and declared NAMES. `evaluate(src, scope)` returns `{ok, value}` or
  `{ok:false, error, code, pos}`, with `code` from `FORMULA_ERRORS`: empty, bad-char, unexpected, missing-paren,
  unknown-name, bad-name-value, div-zero, trailing, not-finite. The scope is the declaration
  `[{name, label?, get, unit?}]`; names are case-insensitive and `get()` is read at evaluation time. The same
  declaration feeds the dropdown (`namesMatching(scope, prefix)`), so the parser and the dropdown share one source.
  There is no eval / Function anywhere, and a static test enforces it (comments are stripped first, so the doc
  text that states the rule doesn't trip it).
- `html/core/formula-field.js` (item 3): `attachFormula(input, scope|() => scope)`. It is idempotent: a second
  call only swaps the scope.
- `html/main/formula-fields.js` (item 5): the DECLARED list `FORMULA_FIELDS` (field id -> scope) plus
  `STOCK_SCOPE` (width, height, depth, read live from P). It is attached from `main/ui-bindings.js` right after
  `attachNumberSteppers()`.
- `tests/formula.test.js` (item 4): 36 tests covering precedence, parens, unary, names, every error kind + pos,
  the static no-eval check, and the binder. The binder tests use a listener shaped like `bind()` (parseFloat on
  input + change) as "the existing handler". They cover: Enter commits the number and fires input + change; blur
  commits; a bad formula keeps the old value; div0; the dropdown filters and inserts with arrows / Enter / Tab /
  Esc / tap; a fully typed name closes the dropdown; attach twice is harmless; plain numbers pass through.
- `tools/repro/formula_field_shots.mjs`: the real-gesture check, kept as a test. Headless Chrome drives the real
  stock Width field with CDP key events (desktop) and touch taps (mobile), then reads `P.widthIn` back from the
  app's own `core/state.js`.

**Key decisions (the WHY):**
1. **Holding back half-typed formulas.** `bind()` (core/ui-utils.js) handles `input` with `parseFloat`, so a live
   "7+1" would apply 7 in the middle of typing. The binder installs ONE document-level CAPTURE listener for
   input + change. For attached fields whose text is NOT a plain number, it calls `stopPropagation()` before the
   event reaches the field's own listeners, and does the preview / dropdown work itself. Plain numbers (and
   empty text, which bind() already ignores) pass through untouched, so they behave exactly as before. The commit
   writes the number and dispatches ordinary input + change events. These are now plain numbers, so the existing
   handlers run unchanged, and so does the undo snapshot on change. The mutation check confirms the tests catch
   this: removing the `stopPropagation` fails 5 of them.
2. **Blur commits through the native `change`,** which the browser fires before blur. A formula `change` is
   intercepted and evaluated there. Enter with a bad formula keeps the text so it can be fixed; blur with a bad
   formula reverts to the last good value. Either way no event reaches the handler, so the old value is kept.
3. **type=number becomes text with NO inputmode.** A number input cannot hold "width/2". `inputmode="decimal"`
   (the dispatch said "as needed") shows a keypad with no letters and no `*` / `(` on mobile, which would make
   names untypeable. Trade-off: mobile now shows the full keyboard for these two fields. The min/max/step
   attributes stay, so the steppers still use them. **Advisor/Fred call** if the decimal keypad matters more; a
   "fx" toggle could switch the keypad later.
4. **Order matters in ui-bindings.** `attachNumberSteppers` queries `input[type="number"]`, so the formula fields
   are attached AFTER it. The +/- buttons still exist and work, and the real-browser run checks them (stepper
   8 -> 9).
5. **A mid-name is not an error.** While the dropdown offers a match ("heig" -> height), the preview shows "= …"
   instead of `✕ unknown name`. A fully typed name closes the dropdown so that Enter commits instead of
   re-inserting.
6. **Preview + dropdown are `position:fixed` on body.** The stepper wrapper is a flex row, and inserting into it
   would break the layout. A document scroll listener (capture) moves them with the sidebar. The styles are
   injected once by the module (id `formula-field-style`) and use the `--cad-*` tokens.

**Item 5 — which field and why:** STOCK DIMENSIONS Width + Height (`#widthIn`, `#heightIn`). Their handler is the
generic `bind() -> applyParam` path in main/ui-bindings.js, which is outside every frozen file (lattice panels,
editor*, properties-*). They also have natural names to reference each other (width, height, depth).
`height-height/3` -> Width 6 is the demo.

**Verified (real surface):** `node tools/repro/formula_field_shots.mjs <prefix> http://127.0.0.1:8780/b-spline-gen/html/bspline_gen_palette.html desktop|mobile`
gives `ok:true` on BOTH desktop and mobile. The checks: dropdown open with `height 9.000"`; "height-h" did not
change P; Enter (desktop) or a touch tap (mobile) inserted `height`; `/3` + Enter committed P.widthIn = 6; "wdth/2"
+ Enter kept 6 with the error shown; plain 8 applied; stepper + gave 9; zero console exceptions.
Screenshots: `C:\Users\danse\.bspline-status\shots\reg-addin\r1_{desktop,mobile}_{dropdown,committed}.png`.

**Gate:** `npx vitest run tests/formula.test.js` 36/36. Full smoke `npx vitest run`: 77 files / 1471 passed.
No Fusion.

**Environment note (Asus):** node_modules was missing. `npm ci` refuses to install because package-lock.json is
out of sync with package.json (it lacks the `@emnapi/core` / `@emnapi/runtime` 1.11.3 optional deps). I used
`npm install --no-save`, so the lockfile is untouched. Someone should regenerate the lockfile on one machine.

**Hands off, respected:** none of the frozen files were touched (editor-*, properties-*lattice*, shape-lattice
generator, fb-app).
