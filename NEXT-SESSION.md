# NEXT — IN3: HUNT — the Frame Inspector page is laid out wider than its palette window

**Ball: worker (seat A) · epoch 1 · IN3.** Files: `bspline-frame-builder/frame-inspector/inspector_palette.html` and, only if
the cause is there, `bspline-frame-builder/styles/base.css` (shared by every palette — a change there must be proven
harmless to the b-spline palette, which renders correctly today). One commit by path, predicted **1-2 files**.

## Evidence (advisor, live Fusion, deployed d8a32ea) — read these three PNGs first
- `/c/Users/danse/AppData/Local/Temp/claude/c--Users-danse-APPS-b-spline-generator-web-addin/3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e/scratchpad/pal_0.png` — palette 320×600: rows wrap at ~300 px, but the right column is cut.
- `/c/Users/danse/AppData/Local/Temp/claude/c--Users-danse-APPS-b-spline-generator-web-addin/3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e/scratchpad/inspector-screen.png` — 520×760: page content ~100-150 px wider than the window; "Copy Name" cut, ⧉ buttons off-screen.
- `/c/Users/danse/AppData/Local/Temp/claude/c--Users-danse-APPS-b-spline-generator-web-addin/3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e/scratchpad/inspector-700.png` — 700×760: same overflow at a larger size → it is NOT a fixed min-width; the page tracks the
  window but exceeds it by a roughly constant amount. The header (title left, `#build-badge` + `#pulse-box` right)
  is also cut on the right.
The b-spline palette (`b-spline-gen/html/bspline_gen_palette.html`, same `styles/base.css`) fits its window exactly at
1000 px (`/c/Users/danse/AppData/Local/Temp/claude/c--Users-danse-APPS-b-spline-generator-web-addin/3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e/scratchpad/palette2.png`) — so the shared stylesheet is not broken in general; the difference is in the inspector's
own markup/styles or in how it uses the shared classes.

## Ground truth (advisor)
- `base.css:37` `body { width:100%; overflow:hidden }`; `:29` global `box-sizing: border-box`; `.cad-dialog-content`
  `overflow-x:hidden` (:1096). `.inspector-container { padding:8px; display:flex; flex-direction:column; flex:1; overflow-y:auto }`
  (inspector :13). `.cad-sidebar-panel { width:100% }` (:1043).
- Fusion palettes render in Chromium at the OS scale (this machine: 125-150 %) — CSS px ≠ window px, but the overflow
  is proportional, so scaling alone is not the cause.

## Do (hunt, then fix — small)
1. Reproduce headless: open `inspector_palette.html` in a browser (or happy-dom is NOT enough — a real browser via
   `start` / any Chromium) at 320 and 520 px wide, DevTools → find the first element whose `scrollWidth` exceeds the
   viewport; walk up to the rule that sets it. Candidates the advisor did NOT check: `.cad-app-shell` / `.cad-navbar`
   `min-width`, `.cad-nav-group` `flex-shrink:0` + fixed widths, the `#pulse-box` / badge `white-space:nowrap` in a
   non-shrinking flex header, the `.linked-list` padding-left 24px inside a 100 %-width panel, and the E7c
   `.linked-list li { display:flex }` (a flex row whose text item cannot shrink below its min-content).
2. Fix at the ROOT rule (one declaration), not with `overflow:hidden` on the container (that hides, it does not fix).
   If the root is in `base.css`, show by screenshot/diff that the b-spline palette is unchanged.
3. Name the cause in the commit message with the rule and line.

## Verify
- Headless: at 320 and 520 px viewport, `document.documentElement.scrollWidth <= innerWidth` (say how you checked).
- `node --check` the extracted script (unchanged) if you touch the file; `git show --stat HEAD` → 1-2 files.
- Fusion look is the ADVISOR's (deploy through the bridge, recapture at 320/520/700).

## Do NOT
Touch `fusion-inspector.py`, fb_shared, or the copy pump. Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "IN3: cause = <rule file:line>; fix = <one line>; headless scrollWidth check at 320/520 OK; b-spline palette unaffected — <sha>, <n> files. Next: CW1."`
and stop.
