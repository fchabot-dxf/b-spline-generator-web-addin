// @vitest-environment node
/**
 * Item 74k (seat D, measured): the matrix setup flake "no bricks laid at baseline (none)" was a page whose app never
 * booted -- the stock `python -m http.server` (listen backlog 5) refused module requests under the gate's load, one failed
 * module kills the module graph, no editor. Measured: a 200-request burst -- stock 117 refused, tools/brick-matrix/serve.py
 * (backlog 128) 0; loaded pages: stock 4 of 27 stuck, serve.py 0 of 9 with a failed request. This pins serve.py with a
 * 40-request burst and a stock control (load-proof: the gate saw the 200 burst lose to the full suite once).
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

// The burst: 40 at once -- well past the stock backlog of 5 (measured: stock refused 17-23 of 40 every time, serve.py 0),
// and small enough that the full suite's own load cannot exhaust the client's sockets (the gate saw the old 200-request
// burst fail once under load; that was the CLIENT, ENOBUFS, which serve.py cannot prevent and does not claim to).
const BURST = 40;
async function burst(args) {
  const port = await freePort();
  const server = spawn('python', [...args, String(port)], { cwd: process.cwd(), stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) { await sleep(100); try { await fetch(`http://127.0.0.1:${port}/package.json`); break; } catch {} }
    const res = await Promise.all(Array.from({ length: BURST }, (_, i) => fetch(`http://127.0.0.1:${port}/package.json?${i}`)
      .then((r) => (r.ok ? r.arrayBuffer().then(() => 'ok') : `http ${r.status}`), (e) => e.cause?.code || e.message)));
    const count = (k) => res.filter((r) => r === k).length;
    return { ok: count('ok'), refused: count('ECONNREFUSED'), clientBuffers: count('ENOBUFS'), other: res.filter((r) => !['ok', 'ECONNREFUSED', 'ENOBUFS'].includes(r)) };
  } finally { server.kill(); }
}

describe('item 74k: the matrix server takes a burst of requests', () => {
  it(`the control: the stock http.server REFUSES part of a ${BURST}-request burst (so the burst proves something)`, async () => {
    const stock = await burst(['-m', 'http.server', '--bind', '127.0.0.1']);
    expect(stock.refused).toBeGreaterThan(0);
  }, 60000);
  it(`serve.py: the same ${BURST}-request burst, none refused`, async () => {
    const r = await burst(['tools/brick-matrix/serve.py']);
    expect(r.refused).toBe(0); // the property serve.py adds (its backlog)
    expect(r.other).toEqual([]);
    expect(r.ok + r.clientBuffers).toBe(BURST); // ENOBUFS = the client's own sockets under load, reported, not refused
  }, 60000);
  it('run.mjs serves through serve.py, and the baseline setup waits for the app\'s declared boot', () => {
    const src = readFileSync('tools/brick-matrix/run.mjs', 'utf8');
    expect(src).toMatch(/spawn\('python', \[path\.join\(HERE, 'serve\.py'\)/);
    expect(src).not.toMatch(/'-m', 'http\.server'/);
    expect(src).toMatch(/let boot = await waitApp\(\);/);
    expect(src).toMatch(/if \(!boot\.booted\) throw new Error\(`setup failed: the app never booted/);
    // the one measured reload: a module lost to the client's own socket exhaustion under load
    expect(src).toMatch(/const BOOT_RELOAD_ERRORS = \[[^\]]*'net::ERR_NO_BUFFER_SPACE'/);
  });
});
