// item 67 (advisor): detection only -- after a run, list every test that took longer than SLOW_TEST_REPORT_MS, slowest
// first, with its time. Never fails the run: the suite's timeout is HEAVY_TEST_MS (vitest.config.js), and this keeps a
// test that is getting slow visible long before it reaches that.
import { SLOW_TEST_REPORT_MS } from './heavy-test-timeout.js';

export default class SlowTestReporter {
  onTestRunEnd(testModules) {
    const slow = [];
    for (const mod of testModules || []) {
      for (const test of mod.children.allTests()) {
        const ms = test.diagnostic()?.duration ?? 0;
        if (ms > SLOW_TEST_REPORT_MS) slow.push({ ms, name: `${mod.moduleId.split('\\').join('/').replace(/^.*\/tests\//, 'tests/')} > ${test.fullName}` });
      }
    }
    if (!slow.length) return;
    slow.sort((a, b) => b.ms - a.ms);
    console.log(`
SLOW TESTS (> ${SLOW_TEST_REPORT_MS} ms; detection only, not a failure): ${slow.length}`);
    for (const s of slow) console.log(`  ${String(Math.round(s.ms)).padStart(7)} ms  ${s.name}`);
  }
}
