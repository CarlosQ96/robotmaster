/**
 * build_gym_level.mjs — emits public/levels/gym.json from the hardcoded
 * GYM_PLATFORMS layout in GymScene.ts so the tilemap version visually matches
 * the current level on first load.
 *
 * One-time use: after this runs, the editor is the source of truth.
 *
 * Coords: world px are converted to tile coords at (source tile 16 × scale 2 = 32 per tile).
 * Platform rectangles become horizontal runs of tiles.  We pick a simple
 * index per purpose (floor vs platform top vs ceiling) — indices here are
 * placeholders and can be re-painted in the editor.
 */
import { writeFile, mkdir } from 'node:fs/promises';

const TILE_SIZE       = 32;   // world pixels per tile (source 16 × displayScale 2)
const WIDTH_PX        = 1920;
const HEIGHT_PX       = 544;  // 17 rows * 32 (world height rounded up from 540)
const WIDTH_TILES     = WIDTH_PX  / TILE_SIZE;   // 60
const HEIGHT_TILES    = HEIGHT_PX / TILE_SIZE;   // 17

// Placeholder tile indices — picked from the 10x10 condensed tileset.
// These can be re-painted in the editor; logic uses solidTiles below.
const TILE_FLOOR       = 30;   // floor surface
const TILE_PLATFORM    = 25;   // platform top
const TILE_CEILING     = 20;   // ceiling strip

// Current GYM_PLATFORMS data (copied from GymScene) — rectangles in world px.
const PLATFORMS = [
  { x: 0,    y: 508, w: 1920, h: 32, kind: 'floor' },

  { x: 208,  y: 460, w: 72,  h: 16, kind: 'platform' },
  { x: 96,   y: 384, w: 208, h: 16, kind: 'platform' },

  { x: 352,  y: 320, w: 208, h: 16, kind: 'platform' },
  { x: 624,  y: 392, w: 72,  h: 16, kind: 'platform' },

  { x: 720,  y: 240, w: 480, h: 16, kind: 'platform' },

  { x: 1248, y: 392, w: 72,  h: 16, kind: 'platform' },
  { x: 1360, y: 320, w: 208, h: 16, kind: 'platform' },

  { x: 1616, y: 384, w: 208, h: 16, kind: 'platform' },
  { x: 1640, y: 460, w: 72,  h: 16, kind: 'platform' },
];

const ground = Array.from({ length: HEIGHT_TILES }, () =>
  new Array(WIDTH_TILES).fill(-1),
);

// Ceiling strip (2-tile-thick top)
for (let x = 0; x < WIDTH_TILES; x++) ground[0][x] = TILE_CEILING;

for (const p of PLATFORMS) {
  const tx0 = Math.floor(p.x / TILE_SIZE);
  const tx1 = Math.ceil((p.x + p.w) / TILE_SIZE);
  const ty0 = Math.floor(p.y / TILE_SIZE);
  const ty1 = Math.ceil((p.y + p.h) / TILE_SIZE);
  const tile = p.kind === 'floor' ? TILE_FLOOR : TILE_PLATFORM;
  for (let ty = ty0; ty < ty1 && ty < HEIGHT_TILES; ty++) {
    for (let tx = tx0; tx < tx1 && tx < WIDTH_TILES; tx++) {
      ground[ty][tx] = tile;
    }
  }
}

const level = {
  name: 'gym',
  tileWidth: 16,
  tileHeight: 16,
  displayScale: 2,
  widthTiles: WIDTH_TILES,
  heightTiles: HEIGHT_TILES,
  tileset: 'reactor',
  // Every non-empty tile is treated as solid until the editor lets users
  // designate otherwise.  This matches current behaviour (everything collides).
  solidTiles: Array.from(new Set([TILE_FLOOR, TILE_PLATFORM, TILE_CEILING])),
  layers: { ground },
};

await mkdir('public/levels', { recursive: true });
await writeFile('public/levels/gym.json', JSON.stringify(level, null, 2), 'utf8');
console.log(`wrote public/levels/gym.json (${WIDTH_TILES}x${HEIGHT_TILES} tiles, ${level.solidTiles.length} solid indices)`);
