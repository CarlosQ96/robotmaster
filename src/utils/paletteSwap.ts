/**
 * paletteSwap.ts — Canvas-based body-colour swap for player palette variants.
 *
 * What gets swapped
 * ─────────────────
 *   SRC_BLUE (#0078F8) → palette.color   (armour / body fill)
 *
 * What stays the same
 * ───────────────────
 *   Black outlines (#000000) — untouched
 *   White highlights (#FCFCFC) — untouched (body shine + glasses reflection)
 *   Transparent pixels — untouched
 *
 * Keeping white unchanged gives the classic NES flat-palette look:
 * one body colour + white highlights + black outlines.  No two-tone shading.
 *
 * Call once per palette in BootScene.create() after assets are loaded.
 * applyPalette() is idempotent — early-exits if the texture already exists.
 */
import * as Phaser from 'phaser';
import { PLAYER } from '../config/gameConfig';
import type { PaletteDef } from '../config/paletteConfig';

// Source body colour — exact value from the spritesheet (verified by pixel analysis)
const SRC_BLUE = [0x00, 0x78, 0xF8] as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
}

function buildPaletteCanvas(
  src: HTMLImageElement,
  toColor: [number, number, number],
): HTMLCanvasElement {
  const w = src.naturalWidth;
  const h = src.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Only swap the exact source blue — everything else is untouched.
    if (
      data[i]     === SRC_BLUE[0] &&
      data[i + 1] === SRC_BLUE[1] &&
      data[i + 2] === SRC_BLUE[2] &&
      data[i + 3] > 0
    ) {
      data[i]     = toColor[0];
      data[i + 1] = toColor[1];
      data[i + 2] = toColor[2];
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Generate and register a palette-swapped player spritesheet texture.
 *
 * - 'default' palette is a no-op (player_default already loaded by BootScene).
 * - Safe to call multiple times; bails if texture key already registered.
 */
export function applyPalette(scene: Phaser.Scene, palette: PaletteDef): void {
  if (palette.key === 'default') return;
  if (scene.textures.exists(palette.textureKey)) return;

  const src    = scene.textures.get('player_default').source[0].image as HTMLImageElement;
  const canvas = buildPaletteCanvas(src, hexToRgb(palette.color));

  // addCanvas registers the canvas as a WebGL-uploaded Phaser texture.
  const texMgr = scene.textures as Phaser.Textures.TextureManager & {
    addCanvas: (key: string, source: HTMLCanvasElement) => Phaser.Textures.CanvasTexture | null;
  };
  const tex = texMgr.addCanvas(palette.textureKey, canvas);
  if (!tex) return;

  // Register spritesheet frames (same grid as player_default).
  const fw   = PLAYER.frameWidth;
  const fh   = PLAYER.frameHeight;
  const cols = Math.floor(canvas.width  / fw);
  const rows = Math.floor(canvas.height / fh);
  let fi = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tex.add(fi, 0, c * fw, r * fh, fw, fh);
      fi++;
    }
  }
}

/** Generate all non-default palette textures. Call once in BootScene.create(). */
export function applyAllPalettes(
  scene: Phaser.Scene,
  palettes: readonly PaletteDef[],
): void {
  for (const palette of palettes) {
    applyPalette(scene, palette);
  }
}
