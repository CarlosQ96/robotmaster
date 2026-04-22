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
import { AUDIO, PLAYER } from '../config/gameConfig';
import {
  PENGUIN_BOT, PENGUIN_BOMB,
  WALRUS_BOT,
  JETPACK_BOT, JETPACK_BULLET,
  ROLLER_BOT, ROLLER_BULLET,
  TOXIC_BARREL_BOT, TOXIC_GOOP,
  ATMB_BOT,
  NUCLEAR_MONKEY,
} from '../config/enemyConfig';
import { BACKGROUNDS } from '../config/editorCatalog';
import { PALETTES } from '../config/paletteConfig';
import { applyAllPalettes } from '../utils/paletteSwap';
import { AudioManager } from '../audio/AudioManager';

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

    // Walrus Bot — 512 × 40 px | 8 frames × 64 px
    this.load.spritesheet(
      'walrus_bot',
      'assets/glacier_man_enemies/Walrus_Bot.png',
      { frameWidth: WALRUS_BOT.frameWidth, frameHeight: WALRUS_BOT.frameHeight },
    );

    // Walrus snowball projectile — 16 × 16 single frame
    this.load.image(
      'walrus_snowball',
      'assets/glacier_man_enemies/Walrus_Bot_Snow_Ball.png',
    );

    // Walrus muzzle-flash — 24 × 16 px | 3 frames × 8 px.  A short "puff"
    // anim played at the mouth position on the shoot frame.
    this.load.spritesheet(
      'walrus_shoot_fx',
      'assets/glacier_man_enemies/Walrus_Bot_Shoot_FX.png',
      { frameWidth: WALRUS_BOT.shootFx.frameWidth, frameHeight: WALRUS_BOT.shootFx.frameHeight },
    );

    // Jetpack Ice Blaster Bot — 240 × 40 px | 6 frames × 40 px (3 aim poses × 2 frames)
    this.load.spritesheet(
      'jetpack_bot',
      'assets/glacier_man_enemies/Jetpack_Ice_Blaster_Bot.png',
      { frameWidth: JETPACK_BOT.frameWidth, frameHeight: JETPACK_BOT.frameHeight },
    );

    // Jetpack bullet — 48 × 16 | 3 frames × 16 (one frame per aim angle).
    this.load.spritesheet(
      'jetpack_bullet',
      'assets/glacier_man_enemies/Jetpack_Ice_Blaster_Bot_Projectile.png',
      { frameWidth: JETPACK_BULLET.frameWidth, frameHeight: JETPACK_BULLET.frameHeight },
    );

    // Jetpack muzzle-flash — 48 × 16 | 3 frames × 16 (matches aim angles 1:1).
    this.load.spritesheet(
      'jetpack_shoot_fx',
      'assets/glacier_man_enemies/Jetpack_Ice_Blaster_Bot_Muzzle_Flash.png',
      { frameWidth: JETPACK_BOT.shootFx.frameWidth, frameHeight: JETPACK_BOT.shootFx.frameHeight },
    );

    // Roller Bot — 528 × 40 px | 11 frames × 48 × 40 (rolling ball 0-7; opening bot 8-10).
    this.load.spritesheet(
      'roller_bot',
      'assets/reactor_man_enemies/Roller_Bot.png',
      { frameWidth: ROLLER_BOT.frameWidth, frameHeight: ROLLER_BOT.frameHeight },
    );

    // Roller bullet — 32 × 8 | 4 frames × 8 × 8 (spinning loop).
    this.load.spritesheet(
      'roller_bullet',
      'assets/reactor_man_enemies/Roller_Bot_Bullet.png',
      { frameWidth: ROLLER_BULLET.frameWidth, frameHeight: ROLLER_BULLET.frameHeight },
    );

    // Toxic Barrel Bot — 264 × 48 | 11 frames × 24 × 48 (closed / lower / upper).
    this.load.spritesheet(
      'toxic_barrel_bot',
      'assets/reactor_man_enemies/Toxic_Barrel_Bot.png',
      { frameWidth: TOXIC_BARREL_BOT.frameWidth, frameHeight: TOXIC_BARREL_BOT.frameHeight },
    );

    // Toxic goop shot — 48 × 16 | 3 frames × 16 × 16 (wobble loop).
    this.load.spritesheet(
      'toxic_goop',
      'assets/reactor_man_enemies/Toxic_Goop_Shot.png',
      { frameWidth: TOXIC_GOOP.frameWidth, frameHeight: TOXIC_GOOP.frameHeight },
    );

    // All-Terrain Missile Bot — 384 × 40 | 8 frames × 48 × 40 (walk + turn).
    this.load.spritesheet(
      'atmb_bot',
      'assets/reactor_man_enemies/All_Terrain_Missile_Bot.png',
      { frameWidth: ATMB_BOT.frameWidth, frameHeight: ATMB_BOT.frameHeight },
    );

    // Cannon ball projectile — 16 × 16 single frame.
    this.load.image(
      'cannon_ball',
      'assets/reactor_man_enemies/Cannon_Ball.png',
    );

    // Nuclear Monkey Boss — 608 × 160 | 4 frames × 152 × 160 (idle + attack).
    this.load.spritesheet(
      'nuclear_monkey_boss',
      'assets/reactor_man_enemies/Monkey_Boss/Nuclear_Monkey_Boss.png',
      { frameWidth: NUCLEAR_MONKEY.frameWidth, frameHeight: NUCLEAR_MONKEY.frameHeight },
    );

    // Monkey ball — 64 × 64 single frame (thrown, bounces, rolls).
    this.load.image(
      'monkey_ball',
      'assets/reactor_man_enemies/Monkey_Boss/Monkey_Ball.png',
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
    // Backgrounds — catalog-driven so the BG palette, TilemapLoader, and
    // BootScene share one source of truth.
    for (const bg of BACKGROUNDS) this.load.image(bg.key, bg.path);
    this.load.json('level-gym', 'levels/gym.json');

    // ── Audio ─────────────────────────────────────────────────────────────
    // Swallow 404s so missing files don't break boot while the audio
    // catalog is still being filled in.  AudioManager's playSfx/playMusic
    // gracefully no-op for any key that never landed in the cache.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.type === 'audio') {
        console.warn(`[audio] missing asset (${file.key}) — call will be silent`);
      }
    });

    for (const entry of Object.values(AUDIO.sfx)) {
      this.load.audio(entry.key, [
        `assets/audio/sfx/${entry.key}.webm`,
        `assets/audio/sfx/${entry.key}.mp3`,
      ]);
    }
    for (const entry of Object.values(AUDIO.music)) {
      this.load.audio(entry.key, [
        `assets/audio/music/${entry.key}.webm`,
        `assets/audio/music/${entry.key}.mp3`,
      ]);
    }
  }

  create(): void {
    // Generate all non-default palette textures (canvas pixel-swap).
    // Must run after preload() so player_default HTMLImageElement is available.
    applyAllPalettes(this, PALETTES);

    // Install the global AudioManager.  Any scene reaches it via
    // getAudio(scene) from src/audio/AudioManager.ts.
    this.registry.set('audio', new AudioManager(this.game));

    this.scene.start('TitleScene');
  }
}
