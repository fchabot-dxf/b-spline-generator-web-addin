// The per-test timeout for the heavy geometry sweeps (every template x several depths / scales, or thousands of
// generated cases). vitest's default 5 s is fine on a quiet machine (each sweep test takes ~0.3-1 s) but MEASURED
// timing out under the fleet's load (~110 node / chrome / python processes from every seat): different sweep tests
// timed out on each run while the same suite passed whole moments later. One declared value, set per sweep file
// with vi.setConfig({ testTimeout: HEAVY_TEST_MS }).
export const HEAVY_TEST_MS = 30000;

// item 67 (advisor, option A): HEAVY_TEST_MS is the WHOLE suite's default (vitest.config.js) -- under the fleet's load
// the same test MEASURED 429 ms and 4370 ms a minute apart, so the 5 s default timed out tests that were never slow.
// Slowness stays visible instead of failing: tests/slow-test-reporter.js lists every test over SLOW_TEST_REPORT_MS
// after each run (detection only). Per-file setConfig / per-test timeouts still apply where a file declares them.
export const SLOW_TEST_REPORT_MS = 5000;
