# NEXT — SE1: SVG editor, batch 1 — declared tool shortcuts + Circle button + snap stub + dead Clear handler

**Ball: worker (seat A) · epoch 1 · SE1.** Scope: `bspline-frame-builder/b-spline-gen/html/` only —
`bspline_gen_palette.html`, `editor/tools/mode-tools.js`, `editor/tools/action-tools.js`, `editor/editor.js`,
`editor/editor-ui.js`, `editor/editor-controls.js`, `editor/editor-interaction.js` (+ `main/global-events.js` or
`editor/dom.js` if you move the typing guard). One commit by path (never `git add -A`). Predicted **6–8 files**.
Series context: ROADMAP "SVG editor series (SE)" — SE2 (zoom/pan) follows after review.

## Ground truth (advisor, from the code — Fusion is blocked by a Session-Suspended dialog, no live capture yet)
1. **Shortcuts are advertised but do not exist.** Every tool button's `title` says "(V)", "(A)", "(P)", "(T)", "(L)",
   "(R)", "(E)" (`bspline_gen_palette.html:1312-1324`), but `_handleEditorKeydown` (`editor-interaction.js:64`) only
   handles Delete/Backspace and Ctrl+C / Ctrl+V / Ctrl+A. Single letters do nothing. Ctrl+Z/Y are routed by
   `main/global-events.js` and stay there.
2. **Circle mode is implemented with no button.** `mode-tools.js:11` binds `toolCircle`; `editor-interaction.js:487/576/601`
   implement the drawing handler; the modal has no `#toolCircle` element (`bindClick` null-guards, so it silently does
   nothing).
3. **Snap is a stub.** `#editorSnapToggle` is a hidden button (`bspline_gen_palette.html:1449`, `display:none`);
   `editor-controls.js:20` wires it to `toggleSnapping()` (`editor.js:186`); `editor.js:101-102` init `_isSnapping` /
   `_snapSize`; `editor-ui.js:162-163` mirrors `.active`. **Nothing in the drag / hit / draw code reads `_isSnapping`.**
   It is a dead feature: delete the whole chain (removal is a sweep — every link above accounted for).
4. **Dead duplicate handler.** `action-tools.js:15` binds `toolClear` with the same body as `editorClear` (:23); only
   `#editorClear` exists. Remove the `toolClear` binding.

## Build — DECLARE the shortcut map, do not hand-roll a key switch
- Put the key on the button, next to the tooltip that advertises it: add `data-key="v"` … to each tool button in the
  modal (`toolSelect v, toolNode a, toolDraw p, toolText t, toolLine l, toolRect r, toolCircle c, toolErase e`). The
  markup is the single source: tooltip text and key live on the same element, so they cannot drift again.
- Add the **Circle** button after Rect: `<button id="toolCircle" class="tool-btn" title="Circle (C)" data-key="c">` with
  an inline SVG icon in the same style/size as the Rect icon (`<circle cx="12" cy="12" r="8"/>`).
- In `_handleEditorKeydown`, BEFORE the `if (!ctrl) return;` line: when there is no ctrl/meta/alt modifier and the
  event target is not a typing target, look up `#svgEditorModal [data-key="<e.key.toLowerCase()>"]`; if found,
  `preventDefault()` and `.click()` it (so the existing click binding + active-state styling do the work), then return.
  Typing guard: `main/global-events.js` already has `_isTypingTarget(target)` — **reuse it**, don't write a second one:
  either export it from there, or (cleaner) move it into `editor/dom.js` (or `core/`) and import it from both sites.
  The text tool's `<input>` and the layers rename `<input>` must keep receiving letters — that is what the guard is for.
- Snap removal chain: the hidden button (html :1449), `editor-controls.js:20`, `toggleSnapping()` + the two fields in
  `editor.js`, the "Sync Snap Toggle UI" block in `editor-ui.js`, any `.editorSnapToggle`/`snap` CSS rule, any test.
  Grep `snap` case-insensitively under `editor/` and the modal's CSS afterwards — it should be zero (except unrelated
  words like "snapshot").
- Remove the `toolClear` binding in `action-tools.js`.

## Verify
- Extract the palette's inline script + `node --check` it; `node --check` every touched module; `npm test` (vitest,
  existing 4 specs) still green.
- Greps: `data-key=` → exactly 8 in the palette; `toolCircle` → 1 in html + 1 in mode-tools; `toolClear` → 0;
  `_isSnapping|toggleSnapping|editorSnapToggle|_snapSize` → 0 anywhere under `html/`; `_isTypingTarget` defined ONCE.
- `git show --stat HEAD` → within the predicted file count. Live look (keys, circle draw, text input still types) is the
  ADVISOR's once Fusion is back — say in WORK-LOG which you could not exercise.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE1: data-key shortcuts + Circle button + snap stub + toolClear removed — <sha>, N files"`
and stop.
