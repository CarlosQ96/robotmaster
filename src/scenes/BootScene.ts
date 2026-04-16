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
    this.load.spritesheet(
      'player_default',
      'assets/Reactor_Man_Asset_Pack/Reactor_Man_Player/PNG/Playable_Character_Default_Colors.png',
      { frameWidth: PLAYER.frameWidth, frameHeight: PLAYER.frameHeight },
    );

    // Player projectiles
    this.load.image(
      'bullet_small',
      'assets/Reactor_Man_Asset_Pack/Reactor_Man_Player/PNG/Playable_Projectile_Small.png',
    );

    // Charged shot — 32×16, 2 frames × 16×16
    this.load.spritesheet(
      'bullet_charged',
      'assets/Reactor_Man_Asset_Pack/Reactor_Man_Player/PNG/Playable_Projectile_Charged.png',
      { frameWidth: 16, frameHeight: 16 },
    );

    // Full-charge shot — 32×16, 2 frames × 16×16
    this.load.spritesheet(
      'bullet_full_charged',
      'assets/Reactor_Man_Asset_Pack/Reactor_Man_Player/PNG/Playable_Projectile_Full_Charge.png',
      { frameWidth: 16, frameHeight: 16 },
    );

    // ── Enemies ───────────────────────────────────────────────────────────
    // Penguin Bot — 480 × 40 px | 12 frames × 40 px
    this.load.spritesheet(
      'penguin_bot',
      'assets/Glacier_Man_Asset_Pack/Glacier_Man_Enemies/PNG/Penguin_Bot.png',
      { frameWidth: PENGUIN_BOT.frameWidth, frameHeight: PENGUIN_BOT.frameHeight },
    );

    // Penguin Bomb — 320 × 32 px | 10 frames × 32 px
    this.load.spritesheet(
      'penguin_bot_bomb',
      'assets/Glacier_Man_Asset_Pack/Glacier_Man_Enemies/PNG/Penguin_Bot_Bomb.png',
      { frameWidth: PENGUIN_BOMB.frameWidth, frameHeight: PENGUIN_BOMB.frameHeight },
    );
  }

  create(): void {
    // Generate all non-default palette textures (canvas pixel-swap).
    // Must run after preload() so player_default HTMLImageElement is available.
    applyAllPalettes(this, PALETTES);

    this.scene.start('TitleScene');
  }
}
