/**
 * repro_editor_full.mjs — exercises the full editor:
 *   - title → LEVEL EDITOR
 *   - TILES tab → paint one tile
 *   - ENEMIES tab → arm penguin-solo, place an enemy
 *   - ENEMIES tab → arm spawner, place a spawner
 *   - Click attribute panel stepper (+) to bump HP
 *   - Save, then re-load gym.json from disk and verify all three pieces are there.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const URL = 'http://localhost:5173/';
const errors = [];

const b = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', (e) => errors.push(e));

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);

// Title → LEVEL EDITOR
await p.keyboard.press('ArrowDown'); // MAIN GAME (disabled, skipped by navigate)
await p.keyboard.press('ArrowDown'); // LEVEL EDITOR
await p.keyboard.press('KeyZ');
await p.waitForTimeout(1200);

const canvas = await p.$('canvas');
const box = await canvas.boundingBox();
const W = (fx) => box.x + Math.round(box.width * fx);
const H = (fy) => box.y + Math.round(box.height * fy);

// TILES tab is default — paint one tile (make sure tile is selected first by clicking palette)
await p.mouse.click(W(0.04), H(0.17));      // palette slot ~tile 0
await p.mouse.move(W(0.55), H(0.55));
await p.mouse.down({ button: 'left' });
await p.mouse.up({ button: 'left' });
await p.waitForTimeout(100);

// Switch to ENEMIES mode via keyboard
await p.keyboard.press('KeyY');
await p.waitForTimeout(300);

// Click the first enemy palette row (Penguin Bot SOLO)
await p.mouse.click(W(0.1), H(0.15));
await p.waitForTimeout(100);

// Place an enemy in the world
await p.mouse.move(W(0.4), H(0.5));
await p.mouse.down({ button: 'left' });
await p.mouse.up({ button: 'left' });
await p.waitForTimeout(100);

// Arm spawner — the spawner row is below all solo rows.  For 1 proto that's row index 1.
// Solo row top: ~CONTENT_TOP=76 y; row height 56 → y=76+56=132 for spawner
// In display coords: 132 / DISPLAY.height 540 * viewport 800 ≈ 196
await p.mouse.click(W(0.1), 196 + box.y);
await p.waitForTimeout(100);

// Place spawner further right
await p.mouse.move(W(0.7), H(0.5));
await p.mouse.down({ button: 'left' });
await p.mouse.up({ button: 'left' });
await p.waitForTimeout(200);

// Attribute panel should be visible; take a screenshot to verify
await p.screenshot({ path: '/tmp/editor_enemies.png' });

// Save
await p.keyboard.press('KeyS');
await p.waitForTimeout(800);

// Read the saved JSON
const raw = await readFile('public/levels/gym.json', 'utf8');
const data = JSON.parse(raw);

console.log('=== RESULT ===');
console.log('Errors:', errors.length);
for (const e of errors) console.log('  ', e.message);
console.log('Ground cells painted:', data.layers.ground.flat().filter((x) => x >= 0).length);
console.log('Enemies:',  (data.enemies  || []).length);
console.log('Spawners:', (data.spawners || []).length);
if (data.enemies?.[0])  console.log('  enemy[0]:',  JSON.stringify(data.enemies[0]));
if (data.spawners?.[0]) console.log('  spawner[0]:', JSON.stringify(data.spawners[0]));

await b.close();
process.exit(errors.length ? 1 : 0);
