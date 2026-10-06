"""Toolpath generation order for the deferred TPGen pass (cam-builder.py _DeferredTPGenHandler).

ONE SETUP AT A TIME, each awaited before the next (Fred, "5 ok"; CAM_BUILDER_CONTEXT.md "Toolpath generation API --
collection-of-ops vs per-setup"): that leaves every op green and keeps the cross-setup stock chain (B-spline Back
completes before B-spline Top reads it).

H23 item 95 -- the doc's FIRST generation after BUILD leaves ops without a toolpath (measured live, seat A,
2026-10-06, two boards, main as deployed, no setup attribute -- item 91's cause is gone): 'B-spline Back'
"generated in 0.3 s", 3-4 of 7 ops missing, "Generation failed" with no message. A single op as the doc's first
generation fails the same way; with that one-op warm-up first, 2 of 7 still failed (the Morphed Spirals). Forcing
the Manufacturing Models' geometry to evaluate first did not help. Every SECOND generation succeeded: regenerating
the failed ops (4/4 valid) or fresh ops re-applied in the same doc (7/7). So a setup that comes out of a pass with
an op lacking a valid toolpath is generated again, in setup order, up to MAX_GENERATION_PASSES. Checked when the
setup is reached, so a later setup made stale by an earlier one's regeneration (the stock chain) is redone too,
and a complete one (e.g. Frame) is not.
"""

# Declared: how many times, at most, a setup is generated in one TPGen pass (1 = the old single pass).
MAX_GENERATION_PASSES = 2
# Declared: how long one setup may generate before the pass moves on.
PER_SETUP_TIMEOUT_S = 900.0


def missing_ops(setup):
    """The names of `setup`'s operations without a valid toolpath."""
    out = []
    for j in range(setup.operations.count):
        op = setup.operations.item(j)
        if not (op.hasToolpath and op.isToolpathValid):
            out.append(op.name)
    return out


def generate_setups(cam, wait, log, timeout_s=PER_SETUP_TIMEOUT_S, passes=MAX_GENERATION_PASSES):
    """Generate every setup that has operations, one at a time; then, up to `passes` in all, generate again each
    setup still holding an op without a valid toolpath (in setup order, checked when reached).

    `wait(future, timeout_s)` blocks (pumping Fusion's events) until the future completes or the timeout passes and
    returns True if it completed; `log(msg, level='INFO')`. Returns [(pass, setup name, seconds, completed)]."""
    import time
    out = []
    for p in range(1, passes + 1):
        regenerated = 0
        for i in range(cam.setups.count):
            setup = cam.setups.item(i)
            if setup.operations.count == 0:
                continue
            if p > 1:
                gone = missing_ops(setup)
                if not gone:
                    continue
                log(f"DEFERRED TPGEN: pass {p}: '{setup.name}' has no valid toolpath for {gone} -- generating it "
                    f"again (the doc's first generation leaves ops empty, H23 item 95)")
            t0 = time.time()
            try:
                fs = cam.generateToolpath(setup)
            except Exception as e:
                log(f"DEFERRED TPGEN: generateToolpath('{setup.name}') raised: {type(e).__name__}: {e}", "WARNING")
                continue
            done = wait(fs, timeout_s)
            if not done:
                log(f"DEFERRED TPGEN: '{setup.name}' still generating after {timeout_s:.0f}s -- moving on", "WARNING")
            log(f"DEFERRED TPGEN: setup '{setup.name}' generated in {time.time() - t0:.1f}s"
                + (f" (pass {p})" if p > 1 else ""))
            out.append((p, setup.name, round(time.time() - t0, 1), bool(done)))
            regenerated += 1
        if p > 1 and regenerated == 0:
            break
        if not any(missing_ops(cam.setups.item(i)) for i in range(cam.setups.count)):
            break
    return out
