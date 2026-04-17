/**
 * repro_editor.mjs — smoke test for EditorScene.
 * Navigates title → LEVEL EDITOR, paints a tile, saves, checks status.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const URL = 'http://localhost:5173/';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

  const errors = [];
  page.on('pageerror', (err) => errors.push(err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(new Error(msg.text()));
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Title: navigate down past "TRAINING GYM" and "MAIN GAME" to "LEVEL EDITOR"
  await page.keyboard.press('ArrowDown'); // MAIN GAME (disabled, should skip)
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowDown'); // LEVEL EDITOR
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyZ');      // confirm
  await page.waitForTimeout(1200);        // scene transition + async JSON load

  // Paint a tile somewhere in the middle of the canvas (away from palette sidebar)
  const canvas = await page.$('canvas');
  const box = await canvas.boundingBox();
  const paintX = box.x + Math.round(box.width * 0.6);
  const paintY = box.y + Math.round(box.height * 0.5);
  await page.mouse.move(paintX, paintY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(100);

  // Save
  await page.keyboard.press('KeyS');
  await page.waitForTimeout(800);

  // Confirm the level JSON changed
  const levelRaw = await readFile('public/levels/gym.json', 'utf8');
  const level = JSON.parse(levelRaw);
  const cellCount = level.layers.ground.flat().filter((x) => x >= 0).length;

  console.log('=== RESULT ===');
  console.log('Errors:', errors.length);
  for (const e of errors) console.log(' -', e.message);
  console.log(`Level non-empty cells: ${cellCount}`);
  console.log(`Level dims: ${level.widthTiles}x${level.heightTiles}`);

  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
