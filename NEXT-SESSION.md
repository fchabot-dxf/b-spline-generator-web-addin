# NEXT — IN4: Inspector — collapse big selections, keep Full Copy whole, drop Copy Name (Fred's ruling)

**Ball: worker (seat A) · epoch 1 · IN4.** File: ONLY `bspline-frame-builder/frame-inspector/inspector_palette.html`.
One commit by path, predicted **1 file**.

## Ground truth (advisor-verified, current lines)
- Details list: `#linked-root` (:72) → header `#list-label` (:73, text set from `d.listLabel`) → `<ul id="linked-list">`
  (:74). `renderLinkedList(data, useExpr)` (:135-153) renders one `<li>` per entry (+ E7c's ⧉ button).
- Bottom row: `#copy-btn` "Full Copy" (:96) → `copyToClipboard` (copies the WHOLE batch list from `currentData.linked`,
  not from the DOM — must stay whole regardless of collapsing); `#copy-short-btn` "Copy Name" (:97) → `copyShort` (:330),
  wired at `:430-431`. Ruling: **drop Copy Name**; `normalizeEntityName` is used by `copyShort` — check whether anything
  else uses it (grep); if not, it dies with it.
- Ruling note on collapsing: "but allow to copy full list" → collapse only the DISPLAY.

## Do
1. **Declare the threshold once:** `var BATCH_COLLAPSE_AFTER = 5;` next to `META_FIELDS`.
2. In `renderLinkedList`: when `entries.length > BATCH_COLLAPSE_AFTER`, render the first `BATCH_COLLAPSE_AFTER` rows,
   then one `<li class="linked-more">` with a `cad-btn` reading `Show all N` that, on click, renders the remaining rows
   in place (replace the more-row; no re-fetch). Set `#list-label` to `<listLabel> (N)` whenever N > 0 (the count
   belongs in the header per the ruling). The expr/raw toggle re-renders → collapsed again; fine.
3. Remove the Copy Name chain: the `#copy-short-btn` element (:97), `copyShort` (:330-~345), its wiring (:430-431),
   and `normalizeEntityName` if it has no other caller. `#copy-btn` keeps `flex:1` and now spans the row alone.
4. `copyToClipboard` unchanged (already copies from data, not DOM) — verify by reading it, and say so.

## Verify
- Extract the `<script>` (as E7c did) → `node --check`.
- Greps: `copy-short-btn|copyShort|normalizeEntityName` → 0 (unless normalizeEntityName has another caller — then say
  which); `BATCH_COLLAPSE_AFTER` → 2+ (decl + use); `Show all` → 1.
- `git show --stat HEAD` → 1 file. Fusion look is the ADVISOR's (select 8 entities → 5 rows + "Show all 8", header
  shows (8), Full Copy pastes 8 lines).

## Do NOT
Touch `fusion-inspector.py`, the copy pump, folding, or fb_shared.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "IN4: BATCH_COLLAPSE_AFTER=5 + Show all N row + count in header; Copy Name chain removed (<n> lines) — <sha>, 1 file; node --check OK. Next: UX1."`
and stop.
