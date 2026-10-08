// The Brick panel's picker icons as DECLARED data (bspline-frame-builder/b-spline-gen/html/data/brick-icons.js), laid by
// the brick engine's own icon functions. One code path with the freshness test (tests/brick-icons-fresh.test.js runs
// them under the DOM the editor module needs):
//     node tools/gen_brick_icons.mjs           # (re)write the data
//     node tools/gen_brick_icons.mjs --check   # exit 1 if it is stale
import { spawnSync } from 'node:child_process';
const check = process.argv.includes('--check');
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', 'tests/brick-icons-fresh.test.js'],
  { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, BRICK_ICONS_WRITE: check ? '' : '1' } });
if (r.status === 0) console.log(check ? 'brick icons: fresh' : 'brick icons: written');
process.exit(r.status ?? 1);
