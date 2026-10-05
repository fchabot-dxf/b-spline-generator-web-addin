// The per-test timeout for the heavy geometry sweeps (every template x several depths / scales, or thousands of
// generated cases). vitest's default 5 s is fine on a quiet machine (each sweep test takes ~0.3-1 s) but MEASURED
// timing out under the fleet's load (~110 node / chrome / python processes from every seat): different sweep tests
// timed out on each run while the same suite passed whole moments later. One declared value, set per sweep file
// with vi.setConfig({ testTimeout: HEAVY_TEST_MS }).
export const HEAVY_TEST_MS = 30000;
