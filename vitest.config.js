import { defineConfig } from 'vitest/config';
import { HEAVY_TEST_MS } from './tests/heavy-test-timeout.js';

// Minimal config for the JS editor-serialization suite (F11a). happy-dom
// supplies DOMParser / innerHTML / btoa so the real editor modules run
// headless. Tests live in tests/ and import the shipping source directly.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.js'],
    // item 41: the paint step is immediate in tests; item 67: one real macrotask after every test (see each file)
    setupFiles: ['tests/setup-paint.js', 'tests/setup-release-weakrefs.js'],
    testTimeout: HEAVY_TEST_MS, // item 67: the suite default (see tests/heavy-test-timeout.js)
    // seat D (2026-10-07): hooks too -- a beforeAll that sets the REAL palette body and runs initBrickPanel takes 1.8-2.8 s
    // alone (measured, brick-fresh-boot-defaults); under the gate's load two such files hit vitest's 10 s hook default
    // ("Hook timed out in 10000ms", vitest-20261007-180116.log) while their tests have HEAVY_TEST_MS
    hookTimeout: HEAVY_TEST_MS,
    reporters: ['default', './tests/slow-test-reporter.js'], // item 67: lists tests over 5 s, never fails
  },
});
