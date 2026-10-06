// item 67 (test infra): yield ONE real macrotask after every test. MEASURED (heap snapshots of
// tests/brick-discrete-controls-regen.test.js): every detached test fixture -- ~4,000 engine-drawn icon polygons a test
// -- was retained from V8's "weak_refs_keep_during_job" root through happy-dom's querySelectorAll NodeLists (held by
// WeakRefs). V8 keeps a WeakRef's target alive until the current JOB ends, and a file whose tests never yield to the
// event loop is one job: the heap grew ~50 MB a test (165 MB -> 4-5.6 GB by test 101, an OOM even alone). With this
// yield the same file saws between ~200 and ~750 MB. Not an app leak: the app yields to the event loop constantly.
// The real setTimeout is captured here, before any test installs fake timers.
import { afterEach } from 'vitest';

const realSetTimeout = globalThis.setTimeout;
afterEach(() => new Promise((resolve) => realSetTimeout(resolve, 0)));
