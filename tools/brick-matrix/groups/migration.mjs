// Brick matrix group 'migration': a board saved before item 22 restores migrated.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { E, RED_SET } from './_shared.mjs';

// ---- migration (item 22, seat 37 fb-app 8fe50e2): a board saved BEFORE item 22 (a Bricks layer with the shared
// brickLaidKey, no records) restores migrated in place. fixtures/pre-item22-board.splineGenLastSession.json is seat 37's
// raw localStorage['splineGenLastSession'] saved at b75e836~1 (T1 7x9, Wall + Frame, Red Brick, Applied): 99 wall +
// 106 frame bricks, no records.
export const MIGRATION = {
  fixture: 'fixtures/pre-item22-board.splineGenLastSession.json', sessionKey: 'splineGenLastSession', wall: 99, frame: 106,
  setGroutWidthIn: RED_SET.grout.widthIn, // the fixture's wall/frame are Red Brick: groutByElement null = this
  // settings fields added since the fixture was saved, at the value that lays exactly as before. The migrated key
  // carries them, the old one did not. A value is: 'empty' (an empty list), an object/array (that exact value), or a
  // plain value every leaf must equal. Advisor: a commit adding a persisted brick field adds its neutral here too.
  neutralNewFields: {
    groutByElement: null, rusticByElement: 0, // per-element grout / rustic (37: 1404b72 / item 29)
    userPatterns: 'empty', // the pattern builder (b91d0f6)
    frameBandAccents: 'empty', brushAccent: { preset: 'none', levelIn: 0.0625, clicks: [] }, // per-element accents (ed618f3)
    frameCorner: null, // the Frame's corner pick (f0e3728): null = the preset's own
    patternParams: {}, // a pattern's declared params, per pattern (37: F35 item 14); {} = every pattern's defaults
    wallRotationDeg: 0, // the Wall pattern's rotation (37: F35 item 13); 0 = as laid
    wallAreaWidthIn: 1, // the Area brush's width (37: F35 item 22 slice 2); strokes only, never a lay
    groutPaint: { color: null, paintInsetIn: 0 }, groutPaintByElement: null, // the grout paint (seat E: F35 item 55); paint only, never a lay
  },
  introducedBy: 'b75e836',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let HERE, sleep, send, js, jsJSON, click, heightsSettled, editorOpen, apply, record, waitApp, checkRow, reloadWithSession, key;
export function bind(ctx) { ({ HERE, sleep, send, js, jsJSON, click, heightsSettled, editorOpen, apply, record, waitApp, checkRow, reloadWithSession, key } = ctx); }
export async function run() { await runMigration(); }

// A board saved by pre-item-22 code (fixtures/pre22-board.json: laid + saved by b75e836^ through the real Project
// Manager into the cloud stand-in) must load on today's code migrated in place: records added, owners stamped,
// the roster's shared key retired -- and nothing re-laid, nothing in the 3D changed, through a save + load too.
function migrationProbe() {
  return `(async()=>{ const ed=window.svgEditor; const layer=ed._sketchLayer.node; const L=await import('./editor/layers.js');
    const recs={}; for (const r of layer.querySelectorAll('[data-brick-record]')) recs[r.getAttribute('data-brick-record')]=r.getAttribute('data-brick-laid');
    const bricks=[...layer.querySelectorAll('[data-brick="wall"],[data-brick="frame"]')];
    const canon=(ns)=>ns.map((n)=>n.getAttribute('data-brick')+':'+(n.getAttribute('points')||'').trim()).sort().join('|');
    const bricksLayers=(ed._layers||[]).filter(L.isBricksLayer);
    const { lastResult } = await import('./core/state.js');
    return JSON.stringify({ wall: layer.querySelectorAll('[data-brick="wall"]').length, frame: layer.querySelectorAll('[data-brick="frame"]').length,
      records: recs, unowned: bricks.filter((n)=>!n.getAttribute('data-brick-owner')).length,
      roster: bricksLayers.map((l)=>({ holdsBricks: !!l.holdsBricks, key: l.brickLaidKey ?? null, kinds: l.brickLaidKinds ?? null })),
      polys: canon(bricks) }); })()`;
}
// '<settings JSON>#frame:<frame JSON>' -- equal lays: identical frame part, identical settings except grout,
// whose width is compared as the effective one (groutByElement null = the set's declared default)
function sameLay(oldKey, newKey, setGrout, neutral = MIGRATION.neutralNewFields || {}) {
  if (!oldKey || !newKey) return false;
  const split = (k) => { const i = k.indexOf('#'); return [k.slice(0, i < 0 ? k.length : i), i < 0 ? '' : k.slice(i)]; };
  const [os, of] = split(oldKey), [ns, nf] = split(newKey);
  if (of !== nf) return false;
  let o, n; try { o = JSON.parse(os); n = JSON.parse(ns); } catch { return os === ns; }
  const oldWidth = o.grout?.widthIn;
  const newWidth = n.groutByElement ? (n.groutByElement.wall ?? setGrout) : n.grout?.widthIn;
  for (const x of [o, n]) { delete x.grout; delete x.groutByElement; }
  // a field the old key lacks lays as before when every leaf of it is its declared neutral value
  const leaves = (v) => (v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [v]);
  const isNeutral = (v, value) => (value === 'empty' ? Array.isArray(v) && v.length === 0
    : value && typeof value === 'object' ? JSON.stringify(v) === JSON.stringify(value)
    : leaves(v).every((x) => x === value));
  for (const [k, value] of Object.entries(neutral)) if (!(k in o) && k in n && isNeutral(n[k], value)) delete n[k];
  return JSON.stringify(o) === JSON.stringify(n) && Math.abs((oldWidth ?? setGrout) - (newWidth ?? setGrout)) < 1e-9;
}

async function runMigration() {
  const M = MIGRATION;
  const body = readFileSync(path.join(HERE, M.fixture), 'utf8');
  // the OLD board, as it was saved: its bricks and its shared key, read from the fixture's own SVG in the page
  await send('Page.reload', {}); await waitApp();
  const old = (await jsJSON(`(()=>{ const body=${JSON.stringify(body)}; const svg=new DOMParser().parseFromString(JSON.parse(body).P.editorSvg, 'image/svg+xml');
    const layers=JSON.parse(svg.documentElement.getAttribute('data-editor-layers')||'[]'); const key=(layers.find((l)=>l.brickLaidKey)||{}).brickLaidKey||null;
    const bricks=[...svg.querySelectorAll('[data-brick="wall"],[data-brick="frame"]')];
    return JSON.stringify({ key, polys: bricks.map((n)=>n.getAttribute('data-brick')+':'+(n.getAttribute('points')||'').trim()).sort().join('|') }); })()`));
  if (!old.key) throw new Error('setup: the migration fixture holds no shared brickLaidKey (not a pre-item-22 board?)');
  // the app restores its last session on load: seed it with the old board, reload -> migrated in place. Seeded at the
  // NEXT document's start (reloadWithSession): seeding here, then reloading, let the old page's pagehide save its own
  // default board over the fixture (37, measured: it only showed once the default brick length moved off 1 in)
  await reloadWithSession(M.sessionKey, body);
  const z1 = await heightsSettled(null);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const a = (await jsJSON(migrationProbe()));
  const setGrout = M.setGroutWidthIn;
  const lay = (k) => sameLay(old.key, k, setGrout);
  checkRow('migration', 'Pre-item-22 board: records carry the old lay', lay(a.records['wall-full']) && lay(a.records.frame),
    `records ${JSON.stringify(Object.keys(a.records))}, same lay: wall ${lay(a.records['wall-full'])}, frame ${lay(a.records.frame)}${a.records['wall-full'] === old.key ? ' (byte-equal)' : ' -- differs in: ' + layDiff(old.key, a.records['wall-full'])}`);
  checkRow('migration', 'Pre-item-22 board: every brick owned', a.unowned === 0, `${a.unowned} of ${a.wall + a.frame} bricks without data-brick-owner`);
  const rosterOk = a.roster.length > 0 && a.roster.every((l) => l.holdsBricks && l.key === null && l.kinds === null);
  checkRow('migration', 'Pre-item-22 board: roster migrated', rosterOk, JSON.stringify(a.roster));
  checkRow('migration', 'Pre-item-22 board: nothing re-laid', a.wall === M.wall && a.frame === M.frame && a.polys === old.polys,
    `wall ${a.wall}/${M.wall}, frame ${a.frame}/${M.frame}, polygons ${a.polys === old.polys ? 'identical' : 'CHANGED'}`);
  // the migrated board through another save + restore: records kept, nothing re-laid, 3D identical
  if (await editorOpen()) await apply();
  await sleep(1500);
  await send('Page.reload', {}); await waitApp();
  const z2 = await heightsSettled(null);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const b = (await jsJSON(migrationProbe()));
  const keptOk = b.records['wall-full'] === a.records['wall-full'] && b.records.frame === a.records.frame;
  checkRow('migration', 'Migrated board: restore keeps records, bricks and 3D', keptOk && z1 === z2 && b.polys === a.polys,
    `records kept ${keptOk}, 3D ${z1 === z2 ? 'identical' : z1 + ' -> ' + z2}, polygons ${b.polys === a.polys ? 'identical' : 'CHANGED'}`);
  if (await editorOpen()) await apply();
}
// the settings fields that differ between two lay keys (for the report)
function layDiff(oldKey, newKey) {
  try {
    const o = JSON.parse(oldKey.split('#')[0]), n = JSON.parse((newKey || '').split('#')[0]);
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
    return keys.map((k) => `${k}: ${JSON.stringify(o[k])} -> ${JSON.stringify(n[k])}`).join('; ').slice(0, 300) + ((oldKey.split('#')[1] || '') !== ((newKey || '').split('#')[1] || '') ? '; FRAME PART differs' : '');
  } catch { return 'unparseable'; }
}
