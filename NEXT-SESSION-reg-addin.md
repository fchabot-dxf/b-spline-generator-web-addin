# NEXT (reg-addin, Asus) — R1: FORMULA-FIELDS stage 1 (shared parser + autocomplete widget)

**Ball: worker (reg-addin) · epoch 1 · R1.** NO FUSION this turn. Plan of record = HANDOFF-REG-ADDIN.md §3 + ROADMAP.md
"FORMULA-FIELDS". Your log = **WORK-LOG-reg-addin.md** (create it; NOT WORK-LOG.md / NEXT-SESSION.md — those are seat A's).
Start each work-commit subject with the item tag ("R1 item 2: …").

## Hands off (conflict zones — other machines push to main)
- Seat A (UI5, uncommitted on home PC): `editor-lattice-pattern.js`, `editor-ui.js`, `editor.js`, `editor-piece-override.js`,
  and treat `properties-lattice.js` / `properties-shape-lattice.js` as frozen this turn too (UI5 shows override
  controls in the Select properties). Wiring into the lattice panels is R2, after UI5 lands.
- Seat C / fb-app: `editor-shape-lattice-generator.js` (silhouette solver) and anything on branch fb-app.

## Checklist
- [ ] [R1-item-1] ONE shared pure module (e.g. `html/core/formula.js`): tokenizer + recursive-descent parser for
      + - * / ( ), unary minus, decimals, and NAMES resolved from a passed-in scope. NEVER eval / new Function / Function().
      Returns `{ok, value}` or `{ok:false, error, pos}`. Division by zero / unknown name / trailing junk = error.
- [ ] [R1-item-2] DECLARED names, one source for parser + dropdown: a scope is a declaration
      `[{name, label?, get: () => number, unit?}]` (the panel declares it; the module never knows about lattices).
      Names case-insensitive; exported helper to filter by prefix for the dropdown.
- [ ] [R1-item-3] ONE shared UI binder (e.g. `html/core/formula-field.js`): `attachFormula(input, scopeDecl)` — makes the
      input accept text (switch type=number → text + inputmode="decimal" as needed), evaluates on Enter/blur, writes the
      NUMBER back and fires the input's normal change/input events so existing handlers run unchanged; bad formula →
      inline error, old value kept; live result preview beside the field while typing; typing letters opens a dropdown of
      matching names with CURRENT values (e.g. `height  6.000"`), arrows + Enter/Tab insert, Esc closes, tap works on mobile.
      Idempotent (attaching twice is harmless). Plain numbers behave exactly as today.
- [ ] [R1-item-4] Tests (vitest): precedence, parentheses, unary minus, names, every error kind, a static check that the
      modules contain no `eval(` / `new Function` / `Function(`; binder: Enter commits number + fires change, bad formula
      keeps old value, dropdown filters + inserts from the declared names, Esc closes, plain number unchanged.
- [ ] [R1-item-5] Prove it on ONE non-frozen field so it's visible: pick a stock-dimension or similar sidebar number field
      whose handler is outside the frozen files, declare a small scope (e.g. width, height), screenshot desktop + mobile
      with the dropdown open (tools/serve_app.py). Say in the WORK-LOG which field and why.

## Gate (fast tier)
`npx vitest run` for touched/new specs + a smoke of the full vitest run if quick. No Fusion.

## Finish
Commit by path. `git pull --rebase` (the home PC pushes merges to main), then push main. Then, FROM THE REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R1 — <shas>"`.
