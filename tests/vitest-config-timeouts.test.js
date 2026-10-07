/**
 * The suite's declared timeouts (vitest.config.js): tests (item 67) AND hooks (seat D, 2026-10-07) get HEAVY_TEST_MS. A
 * beforeAll that sets the real palette body and runs initBrickPanel takes 1.8-2.8 s alone; under the gate's load two such
 * files timed out at vitest's 10 s hook default while their tests had 30 s.
 */
import { it, expect } from 'vitest';
import config from '../vitest.config.js';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

it('tests and hooks share the declared heavy timeout', () => {
  expect(config.test.testTimeout).toBe(HEAVY_TEST_MS);
  expect(config.test.hookTimeout).toBe(HEAVY_TEST_MS);
});
