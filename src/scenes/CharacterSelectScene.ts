/**
 * CharacterSelectScene.ts — Palette selection before launching a game scene.
 *
 * Flow:
 *   TitleScene → CharacterSelectScene → destination (GymScene / GameScene)
 *
 * init() receives { destination: string } from TitleScene.
 * On confirm, starts destination scene with { paletteKey: string }.
 *
 * Controls:
 *   ◀ / ▶ (LEFT / RIGHT)   Cycle palette
 *   Z / ENTER              Confirm — launch game
 *   ESC / X                Back to TitleScene
 *
 * Palette system:
 *   Only the body colour (#0078F8) is swapped — white highlights and black
 *   outlines are untouched.  One solid colour per palette, no shading.
 *
 * Animation preview:
 *   A plain Sprite (no physics) plays a local 'idle_preview' animation.
 *   Recreated each palette change so it always references the selected texture.
 *   Never conflicts with global Player animation keys.
 */
import * as Phaser from 'phaser';
import { PALETTES, DEFAULT_PALETTE, type PaletteDef } from '../config/paletteConfig';

// Idle animation range (matches animConfig.ts idle definition)
const IDLE_START    = 0;
const IDLE_END      = 1;
const IDLE_FPS      = 6;

// Preview scale — 3× the native 48-px frame = 144-px display, crisp pixel art
const PREVIEW_SCALE = 3;
// Local animation key — never clashes with Player's global keys
const ANIM_PREVIEW  = 'idle_preview';

export class CharacterSelectScene extends Phaser.Scene {
  private destination  = 'GymScene';
  private paletteIndex = 0;

  private previewSprite!: Phaser.GameObjects.Sprite;
  private swatchColor!:   Phaser.GameObjects.Rectangle;
  private paletteName!:   Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'CharacterSelectScene' });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  init(data: { destination?: string }): void {
    this.destination  = data?.destination ?? 'GymScene';
    this.paletteIndex = 0;
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width  / 2;
    const cy = height / 2;

    this.buildBackground(width, height, cx, cy);
    this.buildHeader(cx, cy);
    this.buildPreviewPanel(cx, cy);
    this.buildSelectorPanel(cx, cy);
    this.buildHint(cx, height);
    this.registerKeys();

    this.applyPalette(PALETTES[this.paletteIndex]);
  }

  // ── Background ─────────────────────────────────────────────────────────────
  private buildBackground(w: number, h: number, cx: number, cy: number): void {
    this.add.rectangle(cx, cy, w, h, 0x0d0f14);
    for (let y = 0; y < h; y += 4) {
      this.add.rectangle(cx, y, w, 1, 0x000000, 0.12);
    }
    const g = this.add.graphics();
    g.lineStyle(1, 0x1a3355, 0.5);
    g.strokeRect(16, 16, w - 32, h - 32);
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  private buildHeader(cx: number, cy: number): void {
    this.add.text(cx, cy - 210, 'CHARACTER SELECT', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#2a5a7a',
      letterSpacing: 6,
    }).setOrigin(0.5);
    this.add.rectangle(cx, cy - 193, 480, 1, 0x1a3355);
  }

  // ── Preview panel (left half) ──────────────────────────────────────────────
  private buildPreviewPanel(cx: number, cy: number): void {
    const px = cx - 160;

    this.add.rectangle(px, cy, 200, 220, 0x0a1520, 1)
      .setStrokeStyle(1, 0x1a3355);

    // Plain Sprite — no physics
    this.previewSprite = this.add.sprite(px, cy, DEFAULT_PALETTE.textureKey, 0);
    this.previewSprite.setScale(PREVIEW_SCALE);
    (this.previewSprite as unknown as Record<string, unknown>)['vertexRoundMode'] = 'safe';

    this.rebuildPreviewAnim(DEFAULT_PALETTE.textureKey);
  }

  private rebuildPreviewAnim(textureKey: string): void {
    if (this.anims.exists(ANIM_PREVIEW)) {
      this.anims.remove(ANIM_PREVIEW);
    }
    this.anims.create({
      key:       ANIM_PREVIEW,
      frames:    this.anims.generateFrameNumbers(textureKey, { start: IDLE_START, end: IDLE_END }),
      frameRate: IDLE_FPS,
      repeat:    -1,
    });
    this.previewSprite.setTexture(textureKey, IDLE_START);
    this.previewSprite.play(ANIM_PREVIEW);
  }

  // ── Selector panel (right half) ────────────────────────────────────────────
  private buildSelectorPanel(cx: number, cy: number): void {
    const rx = cx + 140;

    this.add.rectangle(rx, cy, 300, 220, 0x0a1520, 1)
      .setStrokeStyle(1, 0x1a3355);

    // "PALETTE" section label
    this.add.text(rx, cy - 80, 'PALETTE', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#2a5a7a',
      letterSpacing: 4,
    }).setOrigin(0.5);

    // Navigation arrows + name row
    this.add.text(rx - 90, cy - 45, '◀', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#446688',
    }).setOrigin(0.5);

    this.paletteName = this.add.text(rx, cy - 45, '', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#00ff99',
    }).setOrigin(0.5);

    this.add.text(rx + 90, cy - 45, '▶', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#446688',
    }).setOrigin(0.5);

    this.add.rectangle(rx, cy - 20, 220, 1, 0x1a3355);

    // Colour label
    this.add.text(rx, cy + 10, 'COLOUR', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#2a5a7a',
    }).setOrigin(0.5);

    // Single body-colour swatch — updated on palette change
    this.swatchColor = this.add.rectangle(rx, cy + 40, 72, 36, 0x0078F8)
      .setStrokeStyle(1, 0x334455);

    this.buildDots(rx, cy);
  }

  private buildDots(rx: number, cy: number): void {
    const g = this.add.graphics();
    g.setName('dots');
    this.refreshDots(g, rx, cy);
  }

  private refreshDots(g: Phaser.GameObjects.Graphics, rx: number, cy: number): void {
    g.clear();
    const spacing = 14;
    const startX  = rx - ((PALETTES.length - 1) * spacing) / 2;
    for (let i = 0; i < PALETTES.length; i++) {
      const dotX = startX + i * spacing;
      const dotY = cy + 82;
      if (i === this.paletteIndex) {
        g.fillStyle(0x00ff99, 1);
        g.fillCircle(dotX, dotY, 4);
      } else {
        g.fillStyle(0x1a3355, 1);
        g.fillCircle(dotX, dotY, 3);
      }
    }
  }

  // ── Controls hint ──────────────────────────────────────────────────────────
  private buildHint(cx: number, height: number): void {
    this.add.text(cx, height - 28,
      '◀ / ▶  PALETTE     Z / ENTER  START     ESC / X  BACK', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#1a3355',
        letterSpacing: 1,
      }).setOrigin(0.5);
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  private registerKeys(): void {
    this.input.keyboard!.on('keydown-LEFT',  () => this.cycle(-1));
    this.input.keyboard!.on('keydown-RIGHT', () => this.cycle(1));
    this.input.keyboard!.on('keydown-ENTER', () => this.confirm());
    this.input.keyboard!.on('keydown-Z',     () => this.confirm());
    this.input.keyboard!.on('keydown-ESC',   () => this.back());
    this.input.keyboard!.on('keydown-X',     () => this.back());
  }

  private cycle(dir: number): void {
    this.paletteIndex = (this.paletteIndex + dir + PALETTES.length) % PALETTES.length;
    this.applyPalette(PALETTES[this.paletteIndex]);
  }

  private confirm(): void {
    this.scene.start(this.destination, { paletteKey: PALETTES[this.paletteIndex].textureKey });
  }

  private back(): void {
    this.scene.start('TitleScene');
  }

  // ── Palette application ────────────────────────────────────────────────────
  private applyPalette(palette: PaletteDef): void {
    this.rebuildPreviewAnim(palette.textureKey);
    this.paletteName.setText(palette.name);

    const bodyColor = parseInt(palette.color.replace('#', ''), 16);
    this.swatchColor.setFillStyle(bodyColor);

    const cx    = this.scale.width  / 2;
    const cy    = this.scale.height / 2;
    const dotsG = this.children.getByName('dots') as Phaser.GameObjects.Graphics | null;
    if (dotsG) this.refreshDots(dotsG, cx + 140, cy);
  }
}
