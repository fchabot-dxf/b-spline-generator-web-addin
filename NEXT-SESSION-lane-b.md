# NEXT (lane-b) — T42: fix the font override at its SOURCE (covers opened + imported files)

**Ball: worker (seat B) · epoch 2 · T42.** NO FUSION for workers. T40 part 2 + T41 reviewed and merged (668 green) —
great root-cause work: the advisor confirmed t41-text-fixed2.png sits exactly on the glyphs.

## Gap
T41 adds an inline `font-family` style at the 3 places the editor SETS a font. But the cause is a CSS rule, and every
`<text>` that arrives any OTHER way still renders in Inter: a saved document re-opened (editor-io restore), an imported
/pasted SVG, undo/redo snapshots restored from markup, stamp-editor pages. The bug lives in `base.css`'s
`* { font-family: inherit; }` beating SVG presentation attributes.

## Do (declare the rule once, then sweep the patches)
1. Fix the cascade: scope the reset so it never applies inside SVG — e.g. `*:not(svg *) { font-family: inherit; }`
   (or `svg text, svg tspan { font-family: revert-layer }` if you put the reset in a layer) — whatever MEASURES
   correct; SVG text then gets its own presentation attribute, and UI text still inherits Inter.
2. Then REMOVE the now-redundant inline `.css({'font-family'})` writes from T41 AND the older insertSymbol workaround
   (`node.style.fontFamily = …`) — one mechanism, not two. Keep the regression tests but retarget them at the real
   thing (computed font-family of a text element created from markup with only the attribute).
3. Check nothing in the UI relied on the reset reaching into SVG (e.g. icons/labels inside svg) — screenshot the
   sidebar + editor chrome before/after.

## Verify (live, CDP)
- A `<text font-family="Arial">` injected from MARKUP (not via the font picker), a re-opened saved doc, and an imported
  SVG: computed font-family = the attribute; per-glyph x vs opentype within 0.01".
- Symbol fonts (Wingdings/Webdings) still render as symbols.
- `npx vitest run` green.

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T42: font cascade fixed at source — <sha>, vitest N, screenshots"`
and stop.
