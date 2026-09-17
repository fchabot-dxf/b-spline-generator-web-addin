# NEXT — UX2: one status line for all Fusion traffic (Fred's ruling)

**Ball: worker (seat A) · epoch 1 · UX2.** Files (under `bspline-frame-builder/b-spline-gen/html/`): `core/fusion-bridge.js`,
`main/main.js`, `bspline_gen_palette.html`. One commit by path, predicted **3 files**.

## Ground truth (advisor-verified)
- Today three things compete for attention in three places: import progress rewrites the Send-to-Fusion BUTTON label
  (`main.js:154-159` via `setFusionActionState`); the build stamp lives in the header badge `#build-badge`
  (`main.js:163-182`: ✓ ok / ⚠ stale-or-dirty, detail only in a tooltip); toasts from the Project Manager pop
  bottom-right (`cloud-project-manager.js:1240 showToast`, module-local). Ruling: one thin status line under the
  header carries Fusion traffic. (The inspector's "bridge pulse" is a different palette — out of scope.)
- The header is `<header class="cad-navbar">…</header>` (`:281-3xx`); `.cad-main-content` follows.

## Do
1. **Declare the line once** — in `core/fusion-bridge.js` (it owns host feedback):
   ```js
   /** The one status line for Fusion traffic (UX2). kind: 'info' | 'busy' | 'ok' | 'warn'. Empty text hides it;
    *  'ok' auto-clears after 3 s. */
   export function setFusionStatus(text, kind = 'info') { … find #fusion-status; set textContent + data-kind; el.hidden = !text; ok → setTimeout clear (guard against a newer message) … }
   ```
2. Markup: right after `</header>`, `<div id="fusion-status" class="fusion-status" hidden role="status" aria-live="polite"></div>`.
   Style in the palette `<style>`, tokens only (no new colours beyond the existing `--cad-*` ones): thin bar, 11px,
   `[data-kind="busy"]` muted, `[data-kind="ok"]` green, `[data-kind="warn"]` amber; `[hidden]` collapses it.
3. Route the traffic:
   - `import_progress` → `setFusionStatus(msg, 'busy')`; the BUTTON stays `'Baking...'`/disabled (set once at send
     start in export-flow.js:140, untouched) — it no longer flickers through each message.
   - `import_success` → `setFusionStatus('Imported into Fusion ✓', 'ok')`; `import_ready` → button idle (as today) +
     `setFusionStatus('', 'info')` is NOT needed (ok auto-clears) — leave the line to clear itself.
   - `build_info` with status ≠ ok → `setFusionStatus(info.message || 'Deployed add-in is stale', 'warn')` (the badge
     keeps its glyph/tooltip). Status ok → nothing.
   - Polling timeout in `startFusionPolling` (bridge :~90) → `setFusionStatus('Fusion did not confirm the import — check
     the Fusion log', 'warn')`.
4. Nothing else moves: `showToast` stays for Project Manager saves (not Fusion traffic).

## Verify
- `node --check` ×2 JS + extracted inline scripts; `npx vitest run` → 29.
- Greps: `setFusionStatus(` → 1 def + 4 call sites; `fusion-status` → html 1 + css rules + js 1.
- `git show --stat HEAD` → 3 files. Look is the ADVISOR's (Send to Fusion on a scratch design: progress lines appear
  under the header, button stays Baking..., then "Imported ✓" fades).

## Do NOT
Touch the inspector palette, showToast, or the badge's own rendering.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UX2: setFusionStatus declared in the bridge; #fusion-status line under the header; progress/success/stale/timeout routed to it; button no longer flickers — <sha>, 3 files; vitest 29. Next: FB3."`
and stop.
