# NEXT — UI1b: responsive column count + a line-ending guard

**Ball: worker (seat A) · epoch 2 · UI1b.** NO FUSION. UI1 merged + pushed (23ed3c6, 1007 green). Advisor checked
live: desktop unified segmented style ✓, layer names full ✓, landscape editor panel now shows all sections ✓.

## Fix
1. In the LANDSCAPE side column (≈450px wide) the 3-column row "Spacing | Horizontal/Vertical | Count/Every" is too
   tight: "Horizonta", "Count E…" clip (scratchpad\ui-landscape-3col-tight.png). Make the column count respond to
   the PANEL's own width, not the viewport: container queries (@container) or a declared min cell width (e.g.
   grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))) so a row drops to 2 columns / wraps instead of
   clipping. No text ellipsis on segmented labels. Check portrait 390, landscape 844x390, desktop.
2. Line endings: your UI1 commit rewrote ALL 2,784 line endings of bspline_gen_palette.html (the repo blob had
   CRLF; autocrlf normalized it to LF on your commit). That's now the normalized form — keep it — but make sure
   your editing path doesn't flip endings on other files (edit with the Edit tool / preserve endings; check
   `git diff --stat` vs `git diff -w --ignore-cr-at-eol --stat` before committing; if they differ wildly, stop).
   Add a `.gitattributes` declaring `* text=auto` + `*.html text eol=lf`, `*.js text eol=lf`, `*.css text eol=lf`,
   `*.py text eol=lf` so every seat stores the same form — then `git add --renormalize .` in ONE separate commit and
   report how many files it touched.
## When done
Append WORK-LOG.md, commit by path, push, then
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI1b: responsive columns + eol guard — <sha>, renormalized N files"`
and stop.
