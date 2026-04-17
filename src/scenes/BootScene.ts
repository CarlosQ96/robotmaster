/**
 * BootScene.ts — Asset loading + palette texture generation.
 *
 * Responsibilities:
 *   1. Load all shared assets (spritesheets, images).
 *   2. After loading, generate the 4 non-default player palette textures via
 *      canvas pixel-swap so CharacterSelectScene can preview them and
 *      GymScene / GameScene can use them without any extra loading step.
 *   3. Transition to TitleScene.
 *
 * Palette generation happens in create() (synchronously), not preload(),
 * because it reads pixel data from already-loaded HTMLImageElements.
 */
import * as Phaser from 'phaser';
import { PLAYER } from '../config/gameConfig';
import { PENGUIN_BOT, PENGUIN_BOMB } from '../config/enemyConfig';
import { PALETTES } from '../config/paletteConfig';
import { applyAllPalettes } from '../utils/paletteSwap';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    // ── Loading bar ───────────────────────────────────────────────────────
    this.add.rectangle(cx, cy, 324, 24, 0x1a2233);
    const fill = this.add
      .rectangle(cx - 160, cy, 0, 20, 0x00ff99)
      .setOrigin(0, 0.5);

    this.add.text(cx, cy - 28, 'ROBOT LORDS', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#334466',
    }).setOrigin(0.5);

    this.load.on('progress', (v: number) => {
      fill.setSize(320 * v, 20);
    });

    // ── Sprites ───────────────────────────────────────────────────────────
    // Player — default colour palette (source for all canvas-based swaps)
    // Sheet: 1200×48 px | 24×48 per frame | 50 frames
    // Assets reorganised into flat per-role folders under public/assets/.
    this.load.spritesheet(
      'player_default',
      'assets/player/Playable_Character_Default_Colors.png',
      { frameWidth: PLAYER.frameWidth, frameHeight: PLAYER.frameHeight },
    );

    // Player projectiles
    this.load.image(
      'bullet_small',
      'assets/player/Playable_Projectile_Small.png',
    );

    // Charged shot — 32×16, 2 frames × 16×16
    this.load.spritesheet(
      'bullet_charged',
      'assets/player/Playable_Projectile_Charged.png',
      { frameWidth: 16, frameHeight: 16 },
    );

    // Full-charge shot — 32×16, 2 frames × 16×16
    this.load.spritesheet(
      'bullet_full_charged',
      'assets/player/Playable_Projectile_Full_Charge.png',
      { frameWidth: 16, frameHeight: 16 },
    );

    // ── Enemies ───────────────────────────────────────────────────────────
    // Penguin Bot — 480 × 40 px | 12 frames × 40 px
    this.load.spritesheet(
      'penguin_bot',
      'assets/glacier_man_enemies/Penguin_Bot.png',
      { frameWidth: PENGUIN_BOT.frameWidth, frameHeight: PENGUIN_BOT.frameHeight },
    );

    // Penguin Bomb — 320 × 32 px | 10 frames × 32 px
    this.load.spritesheet(
      'penguin_bot_bomb',
      'assets/glacier_man_enemies/Penguin_Bot_Bomb.png',
      { frameWidth: PENGUIN_BOMB.frameWidth, frameHeight: PENGUIN_BOMB.frameHeight },
    );

    // ── Tilesets + levels ────────────────────────────────────────────────
    // Castle tileset — 256×144, 16×9 = 144 tiles at 16×16 source.  Split from
    // CastleTiles.png so the sky/mountain backdrop ships separately as
    // `castle_bg` (see below).  Loaded as a SPRITESHEET so per-tile frames
    // exist for the editor palette; Tilemap.addTilesetImage uses the same
    // underlying texture.
    this.load.spritesheet('castle_tiles', 'assets/castle/castle_tiles.png', {
      frameWidth:  16,
      frameHeight: 16,
    });
    this.load.image('castle_bg', 'assets/castle/castle_bg.png');
    this.load.json('level-gym', 'levels/gym.json');
  }

  create(): void {
    // Generate all non-default palette textures (canvas pixel-swap).
    // Must run after preload() so player_default HTMLImageElement is available.
    applyAllPalettes(this, PALETTES);

    this.scene.start('TitleScene');
  }
}
