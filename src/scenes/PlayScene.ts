/**
 * PlayScene — playtest the level currently open in the editor.
 *
 * Unlike GymScene (a hand-authored training arena), PlayScene is tilemap-
 * aware: it loads `public/levels/<name>.json` at scene start, builds the
 * tilemap via TilemapLoader, spawns the player, and collides them against
 * the tilemap layer.  Pre-placed enemies/spawners from the level JSON are
 * deliberately NOT spawned yet — this scene is for verifying geometry
 * first.  (Enemy playback can layer on here later without touching Gym.)
 *
 * Flow:
 *   EditorScene ──[R]──► PlayScene ──[ESC / E]──► EditorScene
 *
 * Accepts via scene.start:
 *   { levelName: string, paletteKey?: string }
 *
 * PlayScene is entirely separate from GymScene — the training gym stays
 * hardcoded and reliable for gameplay testing.
 */
import * as Phaser from 'phaser';
import { CAMERA } from '../config/gameConfig';
import { PLAYER_ANIMS, ANIM_KEY } from '../config/animConfig';
import { DEFAULT_PALETTE } from '../config/paletteConfig';
import { Player } from '../entities/Player';
import { PenguinBot } from '../entities/PenguinBot';
import { PenguinBomb } from '../entities/PenguinBomb';
import { Bullet } from '../entities/Bullet';
import { ChargedBullet } from '../entities/ChargedBullet';
import { loadTilemap, type LoadedLevel, type EnemyPlacement } from '../utils/TilemapLoader';
import { cullOffscreen } from '../utils/outOfView';
import { getAudio } from '../audio/AudioManager';
import {
  registerBulletAnims,
  createBulletSystem,
  createBombPool,
  wirePenguinBombs,
  wireBulletEnemyCollisions,
  wirePlayerEnemyCollisions,
  wireBombPlayer,
  type BulletSystem,
  type BombPool,
} from '../utils/combatSetup';

const TILESET_IMAGE_KEY = 'castle_tiles'; // matches BootScene preload

export class PlayScene extends Phaser.Scene {
  private levelName  = 'gym';
  private paletteKey = DEFAULT_PALETTE.textureKey;
  private player!:   Player;
  private level!:    LoadedLevel;
  private bullets!:  BulletSystem;
  private bombs!:    BombPool;
  private penguins:  PenguinBot[] = [];

  constructor() { super({ key: 'PlayScene' }); }

  init(data: { levelName?: string; paletteKey?: string } = {}): void {
    this.levelName  = data.levelName  ?? 'gym';
    this.paletteKey = data.paletteKey ?? DEFAULT_PALETTE.textureKey;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x0d0f14);

    // Always re-fetch the JSON — the editor may have saved since last load.
    const cacheKey = `play-${this.levelName}`;
    this.cache.json.remove(cacheKey);
    this.load.json(cacheKey, `levels/${this.levelName}.json?t=${Date.now()}`);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.buildScene(cacheKey));
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (file.key === cacheKey) {
        this.showFatal(`Level not found: ${this.levelName}`);
      }
    });
    this.load.start();
  }

  // ── Build ────────────────────────────────────────────────────────────────
  private buildScene(cacheKey: string): void {
    try {
      this.level = loadTilemap(this, cacheKey, TILESET_IMAGE_KEY);
    } catch (err) {
      this.showFatal(`Level load failed: ${(err as Error).message}`);
      return;
    }

    const { widthPx, heightPx, groundLayer } = this.level;

    // World + camera bounds track the level size so the camera can follow
    // the player without exposing black void past the edges.
    this.physics.world.setBounds(0, 0, widthPx, heightPx);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, widthPx, heightPx);

    this.buildPlayerAnims(this.paletteKey);
    registerBulletAnims(this);
    this.spawnPlayer(widthPx, heightPx);

    // Player ↔ tilemap collision — the loader already flagged solid tile
    // indices via groundLayer.setCollision(...).  If the author didn't
    // declare any solidTiles the player falls through (expected — toggle
    // tiles solid in the editor's palette).
    this.physics.add.collider(this.player, groundLayer);

    // Bullets (routes player-shoot events to pooled bullet groups with SFX).
    this.bullets = createBulletSystem(this, this.player);

    // Enemies from the level JSON.  Skipped for levels authored before
    // enemy placement was implemented (enemies?: undefined).
    this.spawnEnemiesFromLevel(groundLayer);

    // Bombs land on the tilemap layer and bounce off it the same way the
    // player does — no separate collider code needed here.
    this.bombs = createBombPool(this);
    this.physics.add.collider(this.bombs.group, groundLayer);
    wirePenguinBombs(this.penguins, this.bombs);

    // Combat colliders — identical wiring to GymScene.
    wireBulletEnemyCollisions(this, this.bullets, this.penguins);
    wirePlayerEnemyCollisions(this, this.player, this.penguins);
    wireBombPlayer(this, this.bombs, this.player);

    // Follow + deadzone, same feel as GymScene.
    cam.startFollow(this.player, true, CAMERA.lerpX, CAMERA.lerpY);
    cam.setDeadzone(CAMERA.deadzoneW, CAMERA.deadzoneH);
    cam.setFollowOffset(0, CAMERA.offsetY);

    this.registerKeys();
    this.buildHud();

    getAudio(this).playMusic('gym');
  }

  /**
   * Materialize `level.data.enemies[]` into live PenguinBot instances.
   * Currently only penguin_bot is supported — add more types here as
   * the catalog expands.  Non-penguin types are silently skipped so an
   * older JSON with unknown `type` strings doesn't crash playtest.
   */
  private spawnEnemiesFromLevel(groundLayer: Phaser.Tilemaps.TilemapLayer): void {
    const defs: EnemyPlacement[] = this.level.data.enemies ?? [];
    for (const e of defs) {
      if (e.type !== 'penguin_bot') continue;
      const penguin = new PenguinBot(this, e.x, e.y).setPlayer(this.player) as PenguinBot;
      // Patrol bounds only kick in if the editor wrote a range (patrolL < patrolR);
      // otherwise leave the penguin to its default roaming logic.
      if (
        typeof e.patrolL === 'number' && typeof e.patrolR === 'number' &&
        e.patrolR > e.patrolL
      ) {
        penguin.setPatrol(e.patrolL, e.patrolR);
      }
      this.physics.add.collider(penguin, groundLayer);
      this.penguins.push(penguin);
    }
  }

  private buildPlayerAnims(textureKey: string): void {
    // Mirrors GymScene.buildPlayerAnims — re-registers anims for the active
    // palette, tearing down any stale ones bound to a different texture.
    for (const [key, def] of Object.entries(PLAYER_ANIMS)) {
      if (this.anims.exists(key)) {
        const existing = this.anims.get(key);
        if (existing.frames[0]?.textureKey === textureKey) continue;
        this.anims.remove(key);
      }
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(textureKey, {
          start: def.start,
          end:   def.end,
        }),
        frameRate: def.frameRate,
        repeat:    def.repeat,
      });
    }
  }

  private spawnPlayer(widthPx: number, heightPx: number): void {
    // Default spawn: 2 tiles from the left, 3 tiles from the bottom.  If the
    // ground isn't where we expect, the player will just fall.  Later we
    // can add a dedicated "spawn point" entity authored in the editor.
    const cellPx = this.level.data.tileWidth * this.level.data.displayScale;
    const x = cellPx * 2;
    const y = heightPx - cellPx * 3;
    void widthPx; // (kept around in case we need to clamp later)
    this.player = new Player(this, x, y, this.paletteKey);
    this.player.play(ANIM_KEY.IDLE, true);
  }

  // ── Input ────────────────────────────────────────────────────────────────
  private registerKeys(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => this.exitToEditor());
    kb.on('keydown-E',   () => this.exitToEditor());
  }

  private exitToEditor(): void {
    this.scene.start('EditorScene', { levelName: this.levelName, isNew: false });
  }

  // ── HUD ──────────────────────────────────────────────────────────────────
  private buildHud(): void {
    this.add
      .text(8, 8, `PLAYTEST: ${this.levelName.toUpperCase()}`, {
        fontFamily: 'monospace',
        fontSize:   '12px',
        color:      '#00ff99',
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.add
      .text(8, 24, 'ESC / E  RETURN TO EDITOR', {
        fontFamily: 'monospace',
        fontSize:   '10px',
        color:      '#446688',
      })
      .setScrollFactor(0)
      .setDepth(1000);
  }

  private showFatal(msg: string): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, msg, {
        fontFamily: 'monospace',
        fontSize:   '14px',
        color:      '#ff3344',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000);
    // ESC / E still work — bounce back to editor.
    this.registerKeys();
  }

  // ── Update ───────────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    if (!this.player) return;

    this.player.update(delta);

    // Cull bullets that left the viewport.
    cullOffscreen<Bullet>(this.bullets.small, this.cameras.main, b => b.kill());
    cullOffscreen<ChargedBullet>(this.bullets.charged,     this.cameras.main, b => b.kill());
    cullOffscreen<ChargedBullet>(this.bullets.fullCharged, this.cameras.main, b => b.kill());

    // Update active enemies.
    for (const p of this.penguins) {
      if (!p.active) continue;
      p.update(delta);
    }

    // Tick bomb fuses + cull any that left the viewport.
    for (const child of this.bombs.group.getChildren()) {
      const bomb = child as PenguinBomb;
      if (bomb.active) bomb.update(delta);
    }
    cullOffscreen<PenguinBomb>(this.bombs.group, this.cameras.main, b => b.kill(), 64);

    // Fall-off-the-world safeguard — respawn at start if the player drops
    // below the level instead of tunneling forever.
    if (this.player.y > this.level.heightPx + 200) {
      const cellPx = this.level.data.tileWidth * this.level.data.displayScale;
      this.player.respawn(cellPx * 2, this.level.heightPx - cellPx * 3);
    }
  }
}
