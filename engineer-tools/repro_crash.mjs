/**
 * repro_crash.mjs — Headless reproduction of the bullet-hit crash.
 *
 * Launches the running Vite dev server in Chromium, navigates through the
 * menus into GymScene, fires bullets, and dumps any console error + the
 * associated stack trace.
 *
 * Usage:
 *   npm run dev           # in another terminal
 *   node engineer-tools/repro_crash.mjs
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

  const errors = [];
  const logs = [];

  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    errors.push({ message: err.message, stack: err.stack });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Title scene → Z confirms "TRAINING GYM"
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(400);

  // Character select → Z confirms default palette
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(800);

  // Move right to approach penguin, fire repeatedly
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('KeyZ');   // fire
    await page.waitForTimeout(80);
    if (errors.length) break;
  }
  await page.keyboard.up('ArrowRight');

  await page.waitForTimeout(1000);

  console.log('=== CONSOLE LOGS (last 20) ===');
  console.log(logs.slice(-20).join('\n'));
  console.log('\n=== ERRORS ===');
  if (errors.length === 0) {
    console.log('(no errors captured)');
  } else {
    for (const e of errors) {
      console.log('MESSAGE:', e.message);
      console.log('STACK:');
      console.log(e.stack);
      console.log('---');
    }
  }

  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
