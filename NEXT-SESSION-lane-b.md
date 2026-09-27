# NEXT (lane-b) — T78: FILTER REWORK — Moon, Mars, Wind Dunes, Coral Reef (Fred)

**Ball: worker (seat B) · epoch 6 · T78.** You're back on (the regular add-in is home; seat A = the header/stepper pass + frame
handle reach; seat C is stood down). Your files ONLY: core/noise/{moon,mars,dunes,reef}.js (+ their tweaks, tests, a render
tool). NO FUSION. PROGRESS automatic ("T78 item N: …"); shots -> shots\seatB\ as each filter lands; push each item.

Fred (seeing them next to Simplex, which he likes): "I don't like Wind Dune, Moon Surface, Mars Surface, Coral Reef; these all
need adjusting" / "the planet ones aren't planet-like at all, craters don't look like craters either". Advisor's diagnosis
(same seed, same board): all four have far less relief + detail than Simplex; Moon = near-flat shallow dents; Mars = soft
blobby lumps; Dunes = a low flat slab with fine ripples, no real crests; Reef = large FLAT-TOPPED plateaus (clipped heights).

## Checklist
- [ ] [T78-item-1] A render tool first: tools/repro/filter_shots.mjs (headless, the #noiseType select, same seed, 3D iso) so every
      change gets a before/after pair; commit the BEFORE set.
- [ ] [T78-item-2] MOON: real crater morphology: bowl-shaped floor, RAISED RIM, ejecta apron fading outward; big craters get a
      central peak + terraced/slumped walls; a power-law size distribution (few large, many small); overlap with newer craters
      cutting older ones and older ones softened; highland roughness between. Tweaks for crater density / max size / rim height.
- [ ] [T78-item-3] MARS: the same crater model but dust-softened, plus dry CHANNELS/valleys, flat-topped MESAS with cliff edges
      (layered steps), and faint wind streaks. Distinct from Moon at a glance.
- [ ] [T78-item-4] WIND DUNES: real dune profile: gentle windward (stoss) slope, STEEP slip face (lee), sharp crest, enough height
      to carve; keep the fine cross-ripples on the flanks + curving crests.
- [ ] [T78-item-5] CORAL REEF: remove the clipping (no flat plateaus): a height histogram test proves no large mass at the max;
      structure continues on top.
- [ ] [T78-item-6] Keep each filter's existing tweak KEYS (saved projects load; new keys get defaults); deterministic per seed;
      output range normalised like the others; relief comparable to Simplex (state a measured std-dev/detail metric vs Simplex).
      Before/after shots for all four, same seed, in shots\seatB\.
- [ ] [T78-item-7] ANATOMICAL (chest.js): skin-and-bone lean torso per Fred's reference (shotsrednatomical_reference_lean_torso.jpg):
      clavicles, ribs down the flanks, sternum line, sunken abdomen, iliac crest, thin skin; keep the tweak keys. Before/after shots.
Pass back from the lane-b root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 6 — T78 — <shas>"`.
