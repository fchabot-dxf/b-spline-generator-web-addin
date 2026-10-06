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
    reporters: ['default', './tests/slow-test-reporter.js'], // item 67: lists tests over 5 s, never fails
  },
});
