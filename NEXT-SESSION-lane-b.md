# NEXT (lane-b) — T54: generator fixes from the advisor's render, then SE14 Slice 2 (fillets)

**Ball: worker (seat B) · epoch 2 · T54.** NO FUSION. T53 merged. Advisor rendered 8 seeds (42, 7, 1234, 999, 31337,
2026, 555, 8261) on a 7x9 region: C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\silh-t53.png
(renderer: scratchpad\silh.mjs — reuse it). Mirrors are exact, L+A only, variety is good. Fix first:
1. **Seeds 42 and 7 render nearly IDENTICAL** — the per-salt draw isn't mixing the seed enough (a weak hash of
   seed+salt?). Use a proper integer hash (e.g. splitmix/mulberry of (seed, salt)); test: 50 consecutive seeds give
   pairwise-distinct fullW/fullH/segment styles (no two seeds share all draws).
2. **The base is curved** (bows up/down) — the reference keeps the base ALWAYS straight (utils.js resolveGenerator:
   `// Base - always sharp`, bulge 0). A flat base also matters for carving (sits on an edge). Make it straight and
   exclude it from per-segment styling (declare it: base = fixed straight).
3. **Shapes sit small and low** — several use only the bottom ~55% of the region; seed 42's top is near 40% height.
   Check fullH/bottomY/proportion math so a silhouette spans most of the region height (declared range, e.g. top at
   6–15% from the region top) and width uses the region sensibly. Re-render the same 8 seeds after the fix.
Then continue with your §10 Slice 2 (fillets) as designed.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T54: generator fixes + slice 2 fillets — <sha>, vitest N, render: <png>"`
and stop.
