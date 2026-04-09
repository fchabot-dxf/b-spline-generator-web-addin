#!/usr/bin/env node

globalThis.window = globalThis;
globalThis.console = console;

import { COORD_SYSTEM } from './coords.js';

console.log('=== coords.js helper test ===');

const points = [
  [0, 0],
  [600, 600],
  [300, 150],
  [123, 456]
];

points.forEach(([x, y]) => {
  const phys = COORD_SYSTEM.toPhysical(x, y);
  const ui = COORD_SYSTEM.toUI(phys.x, phys.y);
  console.log(`UI (${x},${y}) -> Physical (${phys.x},${phys.y}) -> UI back (${ui.x},${ui.y})`);
});

const rows = [
  [0, 5],
  [2, 5],
  [4, 5],
  [-1, 5],
  [5, 5],
  [3, 10]
];

rows.forEach(([row, rowsCount]) => {
  const rasterY = COORD_SYSTEM.gridRowToRasterY(row, rowsCount, 100);
  const roundTrip = COORD_SYSTEM.rasterYToGridRow(rasterY, rowsCount, 100);
  console.log(`row ${row}/${rowsCount} -> rasterY ${rasterY} -> gridRow ${roundTrip}`);
});

const gridTests = [
  [3, 3],
  [4, 2],
  [2, 5]
];

gridTests.forEach(([nx, nz]) => {
  const indices = COORD_SYSTEM.gridBoundaryIndices(nx, nz);
  console.log(`gridBoundaryIndices(${nx},${nz}) -> [${indices.join(', ')}]`);
});

console.log('coords.test.mjs completed successfully');
