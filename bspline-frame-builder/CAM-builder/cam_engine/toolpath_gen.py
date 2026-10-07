"""Toolpath generation order for the deferred TPGen pass (cam-builder.py _DeferredTPGenHandler).

ONE SETUP AT A TIME, each awaited before the next (Fred, "5 ok"; CAM_BUILDER_CONTEXT.md "Toolpath generation API --
collection-of-ops vs per-setup"): that leaves every op green and keeps the cross-setup stock chain (B-spline Back
completes before B-spline Top reads it).

H23 item 95 -- the doc's FIRST generation after BUILD leaves ops without a toolpath (measured live, seat A,
2026-10-06, two boards, main as deployed, no setup attribute -- item 91's cause is gone): 'B-spline Back'
"generated in 0.3 s", 3-4 of 7 ops missing, "Generation failed" with no message. A single op as the doc's first
generation fails the same way; forcing the Manufacturing Models' geometry to evaluate first did not help. A LATER
generation succeeds when the op's upstream (the op before it in its setup, whose stock it reads) is already valid
as it starts: the 4 empty ops regenerated together after the Pockets were valid -> 4/4; Back's Morphed Spiral
alone, its Pocket valid -> valid. Regenerating the WHOLE setup again did not always do it: its Pocket came back
but the Morphed Spiral, started while the Pocket was still empty, failed again (ok=6 missing=1, live).
So: pass 1 generates setup by setup (as before); each later pass, up to MAX_GENERATION_PASSES, generates OP BY OP,
in setup and op order, each op that has no valid toolpath when it is reached (so an op made stale by an earlier
regeneration -- the stock chain -- is redone, and a valid one is not), each awaited before the next.
"""

# Declared: how many passes, at most, one TPGen run makes (1 = the old single per-setup pass). Live: 2 in item 95's
# runs, 3 in one of item 96's three (both Morphed Spirals empty again in pass 2); one spare beyond that.
MAX_GENERATION_PASSES = 4
# Declared: how long one setup (or one op, in a later pass) may generate before the pass moves on.
PER_SETUP_TIMEOUT_S = 900.0


def _ops(setup):
    return [setup.operations.item(j) for j in range(setup.operations.count)]


def _valid(op):
    return bool(op.hasToolpath and op.isToolpathValid)


def why_empty(op):
    """What Fusion itself says about an op left without a toolpath: the first line of its error and of its warning,
    '' when it says nothing (H23 item 98 -- after a long session the empty ops' op.error read 'Out of memory.' while
    the audit logged only 'MISSING'). Never raises."""
    parts = []
    for attr in ('error', 'warning'):
        try:
            text = (getattr(op, attr) or '').strip()
        except Exception:
            text = ''
        if text:
            parts.append(f"{attr}: {text.splitlines()[0].strip()}")
    return '; '.join(parts)


def missing_ops(setup):
    """The names of `setup`'s operations without a valid toolpath."""
    return [op.name for op in _ops(setup) if not _valid(op)]


def _generate(cam, target, label, wait, log, timeout_s, suffix=''):
    import time
    t0 = time.time()
    try:
        future = cam.generateToolpath(target)
    except Exception as e:
        log(f"DEFERRED TPGEN: generateToolpath('{label}') raised: {type(e).__name__}: {e}", "WARNING")
        return None
    done = wait(future, timeout_s)
    if not done:
        log(f"DEFERRED TPGEN: '{label}' still generating after {timeout_s:.0f}s -- moving on", "WARNING")
    log(f"DEFERRED TPGEN: {label} generated in {time.time() - t0:.1f}s{suffix}")
    return round(time.time() - t0, 1), bool(done)


def generate_setups(cam, wait, log, timeout_s=PER_SETUP_TIMEOUT_S, passes=MAX_GENERATION_PASSES, on_pass=None):
    """Pass 1: every setup with operations, one at a time. Passes 2..`passes`: op by op, in order, every op with no
    valid toolpath when reached. Stops as soon as a pass leaves nothing missing.

    `wait(future, timeout_s)` blocks (pumping Fusion's events) until the future completes or the timeout passes and
    returns True if it completed; `log(msg, level='INFO')`; `on_pass(p)`, when given, is told each LATER pass as it
    starts (Fred, 2026-10-07: the loading card's step list grows live). Returns [(pass, label, seconds, completed)]."""
    out = []
    setups = [cam.setups.item(i) for i in range(cam.setups.count)]
    for s in setups:
        if s.operations.count:
            r = _generate(cam, s, f"setup '{s.name}'", wait, log, timeout_s)
            if r:
                out.append((1, s.name) + r)
    for p in range(2, passes + 1):
        gone = [f"{s.name}/{n}" for s in setups for n in missing_ops(s)]
        if not gone:
            break
        if on_pass:
            on_pass(p)
        log(f"DEFERRED TPGEN: pass {p}: no valid toolpath for {gone} -- generating them again op by op, in order "
            f"(the doc's first generation leaves ops empty, H23 item 95)")
        for s in setups:
            for op in _ops(s):
                if _valid(op):
                    continue
                r = _generate(cam, op, f"op '{s.name}/{op.name}'", wait, log, timeout_s, f" (pass {p})")
                if r:
                    out.append((p, f"{s.name}/{op.name}") + r)
    return out
