import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.keyboard.press('ArrowDown');  // skip disabled MAIN GAME
await page.keyboard.press('ArrowDown');
await page.keyboard.press('KeyZ');       // open editor
await page.waitForTimeout(1500);

// Hover somewhere interesting in the world so we see the ghost
const canvas = await page.$('canvas');
const box = await canvas.boundingBox();
await page.mouse.move(box.x + 500, box.y + 300);
await page.waitForTimeout(150);
await page.screenshot({ path: '/tmp/editor.png' });

// Move cursor over sidebar + scroll to bottom to confirm full coverage
await page.mouse.move(box.x + 100, box.y + 300);
await page.waitForTimeout(80);
await page.keyboard.press('End');
await page.waitForTimeout(150);
await page.screenshot({ path: '/tmp/editor_scrolled.png' });
console.log('screenshot /tmp/editor.png; errors:', errors.length);
for (const e of errors) console.log(e.message);
await browser.close();
