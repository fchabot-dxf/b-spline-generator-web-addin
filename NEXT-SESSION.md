# NEXT — E7c: Frame Inspector per-row copy on the Details list [F]

**Ball: worker (seat A) · epoch 1 · E7c.** File: ONLY `bspline-frame-builder/frame-inspector/inspector_palette.html`.
One commit by path, predicted **1 file, ~+30**.

## Ground truth (advisor-verified)
- `renderLinkedList(data, useExpr)` builds one `<li>` per entry with `li.textContent = entries[i]` (the batch list
  `name | coord | meta`, or a single entity's connections). The bottom buttons copy everything (`copyToClipboard`) or
  names only (`copyShort`).
- Copying MUST go through `performCopy(text, btn)`: it queues `_pendingCopy` for the poll tick because
  `adsk.fusionSendData` is unreliable from a DOM click handler (comment above `_pendingCopy`). `flashBtn` gives the
  click feedback. Do not call `fusionSendData` from the row button directly.
- `styles/base.css` declares `.cad-btn`; the palette's own `<style>` block is the place for one small local rule.

## Do
1. Declare one factory next to `renderLinkedList`:
   ```js
   // One declared row-copy affordance (E7c): every Details row gets the same button.
   function makeRowCopyButton(text) {
       var b = document.createElement('button');
       b.type = 'button'; b.className = 'cad-btn row-copy'; b.title = 'Copy this line'; b.textContent = '⧉';
       b.addEventListener('click', function (ev) { ev.stopPropagation(); performCopy(text, b); });
       return b;
   }
   ```
2. In `renderLinkedList`, after setting the row text, `li.appendChild(makeRowCopyButton(entries[i]))`. Nothing else
   in the function changes (the expr/raw toggle re-renders rows, so buttons follow the displayed text).
3. One local style rule in the palette's `<style>` block:
   `.row-copy { margin-left: 6px; padding: 0 4px; font-size: 10px; line-height: 14px; vertical-align: middle; }`
   `.linked-list li { display: flex; align-items: center; gap: 4px; }` — keep the existing `.linked-list li` margin rule.
4. `flashBtn` restores `originalText` after the flash — confirm it works with a one-glyph label (it should; it saves
   `btn.textContent`). If the flash text ('Copied!') is too wide for the small button, use `flashBtn(b, '✓', …)` by
   passing a shorter message from the row handler: change step 1's click to
   `performCopy(text, b)` only if `performCopy` accepts a custom flash; otherwise leave the default — say which in the
   commit.

## Verify (fast tier)
- Extract the palette's `<script>` and `node --check` it (e.g. `sed -n '/<script>/,/<\/script>/p' … > /tmp/x.js`,
  strip the tags, `node --check`). Grep: `makeRowCopyButton` → 2 (def + use); `fusionSendData(` count unchanged.
- `git show --stat HEAD` → 1 file.
- Fusion look is the ADVISOR's (deploy via the bridge, select two entities, click a row's ⧉, paste).

## Do NOT
Touch `fusion-inspector.py`, `copyToClipboard`/`copyShort`, the poll pump, or fb_shared.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "E7c: makeRowCopyButton declared + one per Details row via performCopy; 2 local style rules — <sha>, 1 file; node --check on the extracted script OK. Next: HY3."`
and stop.
