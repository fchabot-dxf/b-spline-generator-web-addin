# NEXT — PM2b: the top-bar labels clip — let the icon buttons grow when their label shows

**Ball: worker (seat A) · epoch 1 · PM2b.** File: ONLY `bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html`.
One commit by path, predicted **1 file, ~+8 lines**.

## Ground truth (advisor, Fusion screenshot at 1000 px, deployed 6a610b9)
Labels render but clip: "💾 S", "📁 Proje", "⚙ Setting", and the 🧩 add-in icon collides with "Send to Fusion".
Cause: `.cad-navbar .cad-nav-btn` (`:159-175`) pins `width/min-width/max-width: 32px !important`, `padding: 0
!important`, `flex: 0 0 32px !important` on desktop. The label rule (`:193-200`) only flips `display`. The mobile block
(`@media (max-width: 600px), (pointer: coarse)`, `:212-235`) pins 44px the same way — leave it.

## Do
In the existing `@media (min-width: 601px) and (pointer: fine)` block (`:198-200`), add ONE rule so the sizing follows
the same breakpoint as the label:
```css
.cad-navbar .cad-nav-btn {
  width: auto !important; min-width: 32px !important; max-width: none !important;
  padding: 0 10px !important; flex: 0 0 auto !important; gap: 6px;
}
```
(the `!important`s are needed only because the base rule uses them — say so in a one-line comment). Then the
`.cad-nav-label { margin-left: 6px }` becomes redundant with `gap` — drop the margin.
Nothing else: the "STEP / Send to Fusion" primary button and the settings gear keep their markup.

## Verify
- Extract + `node --check` the inline scripts (unchanged, sanity). `npx vitest run` → 29.
- `git show --stat HEAD` → 1 file. The look is the ADVISOR's (Fusion palette at 1000 px: four labelled buttons, no
  overlap; docked narrow: icons only).

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "PM2b: nav buttons size auto inside the label breakpoint — <sha>, 1 file. Next: UX1."`
and stop.
