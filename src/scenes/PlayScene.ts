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
import { WalrusBot } from '../entities/WalrusBot';
import { WalrusSnowball } from '../entities/WalrusSnowball';
import { JetpackBot } from '../entities/JetpackBot';
import { JetpackBullet } from '../entities/JetpackBullet';
import { RollerBot } from '../entities/RollerBot';
import { RollerBullet } from '../entities/RollerBullet';
import { ToxicBarrelBot } from '../entities/ToxicBarrelBot';
import { ToxicGoopShot } from '../entities/ToxicGoopShot';
import { AllTerrainMissileBot } from '../entities/AllTerrainMissileBot';
import { CannonBall } from '../entities/CannonBall';
import { NuclearMonkeyBoss } from '../entities/NuclearMonkeyBoss';
import { MonkeyBall } from '../entities/MonkeyBall';
import { Bullet } from '../entities/Bullet';
import { ChargedBullet } from '../entities/ChargedBullet';
import { loadTilemap, type LoadedLevel, type EnemyPlacement } from '../utils/TilemapLoader';
import { cullOffscreen, killBlockedProjectiles } from '../utils/outOfView';
import { attachChargeEmitter, attachSlideDust } from '../utils/fxSystem';
import { getAudio } from '../audio/AudioManager';
import {
  registerBulletAnims,
  registerEnemyFxAnims,
  createBulletSystem,
  createBombPool,
  createSnowballPool,
  createJetpackBulletPool,
  createRollerBulletPool,
  createToxicGoopPool,
  createCannonBallPool,
  createMonkeyBallPool,
  wirePenguinBombs,
  wireWalrusShots,
  wireSnowballPlayer,
  wireJetpackShots,
  wireJetpackBulletPlayer,
  wireRollerShots,
  wireRollerBulletPlayer,
  wireToxicShots,
  wireToxicGoopPlayer,
  wireAtmbShots,
  wireCannonBallPlayer,
  wireMonkeyThrows,
  wireMonkeyBallPlayer,
  wireBulletEnemyCollisions,
  wirePlayerEnemyCollisions,
  wireBombPlayer,
  type BulletSystem,
  type BombPool,
  type SnowballPool,
  type JetpackBulletPool,
  type RollerBulletPool,
  type ToxicGoopPool,
  type CannonBallPool,
  type MonkeyBallPool,
} from '../utils/combatSetup';

const TILESET_IMAGE_KEY = 'castle_tiles'; // matches BootScene preload

export class PlayScene extends Phaser.Scene {
  private levelName  = 'gym';
  private paletteKey = DEFAULT_PALETTE.textureKey;
  private player!:   Player;
  private level!:    LoadedLevel;
  private bullets!:        BulletSystem;
  private bombs!:          BombPool;
  private snowballs!:      SnowballPool;
  private jetpackBullets!: JetpackBulletPool;
  private rollerBullets!:  RollerBulletPool;
  private toxicGoop!:      ToxicGoopPool;
  private cannonBalls!:    CannonBallPool;
  private monkeyBalls!:    MonkeyBallPool;
  private penguins:  PenguinBot[]        = [];
  private walruses:  WalrusBot[]         = [];
  private jetpacks:  JetpackBot[]        = [];
  private rollers:   RollerBot[]         = [];
  private toxicBots: ToxicBarrelBot[]    = [];
  private atmbs:     AllTerrainMissileBot[] = [];
  private monkeys:   NuclearMonkeyBoss[] = [];
  private chargeFx?: ReturnType<typeof attachChargeEmitter>;
  private slideDust?: ReturnType<typeof attachSlideDust>;

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
    registerEnemyFxAnims(this);
    this.spawnPlayer(widthPx, heightPx);

    // Player ↔ tilemap collision — the loader already flagged solid tile
    // indices via groundLayer.setCollision(...).  If the author didn't
    // declare any solidTiles the player falls through (expected — toggle
    // tiles solid in the editor's palette).
    this.physics.add.collider(this.player, groundLayer);

    // Ladder probe: Player.update() samples this layer at its center each
    // frame to decide whether up/down enters the climb state.  Ladder tile
    // indices were already stripped from the solids list by TilemapLoader.
    this.player.setLadder(groundLayer, this.level.ladderTiles);

    // Charge-up FX: particle ring collapses into the player while holding Z.
    this.chargeFx  = attachChargeEmitter(this, this.player);
    this.slideDust = attachSlideDust(this, this.player);

    // Bullets (routes player-shoot events to pooled bullet groups with SFX).
    this.bullets = createBulletSystem(this, this.player);

    // Enemies from the level JSON.  Skipped for levels authored before
    // enemy placement was implemented (enemies?: undefined).
    this.spawnEnemiesFromLevel(groundLayer);

    // Bombs land on the tilemap layer and bounce off it the same way the
    // player does — no separate collider code needed here.
    this.bombs          = createBombPool(this);
    this.snowballs      = createSnowballPool(this);
    this.jetpackBullets = createJetpackBulletPool(this);
    this.rollerBullets  = createRollerBulletPool(this);
    this.toxicGoop      = createToxicGoopPool(this);
    this.cannonBalls    = createCannonBallPool(this);
    this.monkeyBalls    = createMonkeyBallPool(this);
    // Bombs KEEP bouncing; other projectiles die on tile contact.
    // Check both callback args since arg order differs between
    // collideSpriteVsGroup and collideGroupVsTilemapLayer.  Prefer impact()
    // so the projectile's burst FX plays; fall back to kill() otherwise.
    const impactOnHit = (a: unknown, b: unknown): void => {
      const fire = (o: unknown) => {
        const p = o as { impact?: () => void; kill?: () => void };
        if (p.impact) p.impact();
        else          p.kill?.();
      };
      fire(a);
      fire(b);
    };
    this.physics.add.collider(this.bombs.group,          groundLayer);
    this.physics.add.collider(this.snowballs.group,      groundLayer, impactOnHit);
    this.physics.add.collider(this.jetpackBullets.group, groundLayer, impactOnHit);
    this.physics.add.collider(this.rollerBullets.group,  groundLayer, impactOnHit);
    this.physics.add.collider(this.toxicGoop.group,      groundLayer, impactOnHit);
    // Cannon balls KEEP colliding (bounce + land); their own timer kills them.
    this.physics.add.collider(this.cannonBalls.group,    groundLayer);
    // Monkey balls bounce + roll on tiles; lifetime timer handles death.
    this.physics.add.collider(this.monkeyBalls.group,    groundLayer);
    wirePenguinBombs(this.penguins, this.bombs);
    wireWalrusShots (this, this.walruses, this.snowballs);
    wireJetpackShots(this, this.jetpacks,  this.jetpackBullets);
    wireRollerShots (this.rollers, this.rollerBullets);
    wireToxicShots  (this.toxicBots, this.toxicGoop);
    wireAtmbShots   (this.atmbs, this.cannonBalls);
    wireMonkeyThrows(this.monkeys, this.monkeyBalls);

    // Combat colliders — all enemy types combined (helpers accept `Enemy[]`).
    const enemies = [
      ...this.penguins, ...this.walruses, ...this.jetpacks,
      ...this.rollers, ...this.toxicBots, ...this.atmbs,
      ...this.monkeys,
    ];
    wireBulletEnemyCollisions(this, this.bullets, enemies);
    wirePlayerEnemyCollisions(this, this.player, enemies);
    wireBombPlayer         (this, this.bombs,          this.player);
    wireSnowballPlayer     (this, this.snowballs,      this.player);
    wireJetpackBulletPlayer(this, this.jetpackBullets, this.player);
    wireRollerBulletPlayer (this, this.rollerBullets,  this.player);
    wireToxicGoopPlayer    (this, this.toxicGoop,      this.player);
    wireCannonBallPlayer   (this, this.cannonBalls,    this.player);
    wireMonkeyBallPlayer   (this, this.monkeyBalls,    this.player);

    // Follow + deadzone, same feel as GymScene.
    cam.startFollow(this.player, true, CAMERA.lerpX, CAMERA.lerpY);
    cam.setDeadzone(CAMERA.deadzoneW, CAMERA.deadzoneH);
    cam.setFollowOffset(0, CAMERA.offsetY);

    this.registerKeys();
    this.buildHud();

    getAudio(this).playMusic('gym');
  }

  /**
   * Materialize `level.data.enemies[]` into live enemy instances based on
   * `type`.  Unknown types are skipped so an older JSON doesn't crash.
   */
  private spawnEnemiesFromLevel(groundLayer: Phaser.Tilemaps.TilemapLayer): void {
    const defs: EnemyPlacement[] = this.level.data.enemies ?? [];
    const hasPatrol = (e: EnemyPlacement) =>
      typeof e.patrolL === 'number' && typeof e.patrolR === 'number' && e.patrolR > e.patrolL;

    for (const e of defs) {
      if (e.type === 'penguin_bot') {
        const penguin = new PenguinBot(this, e.x, e.y).setPlayer(this.player) as PenguinBot;
        if (hasPatrol(e)) penguin.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(penguin, groundLayer);
        this.penguins.push(penguin);
      } else if (e.type === 'walrus_bot') {
        const walrus = new WalrusBot(this, e.x, e.y).setPlayer(this.player) as WalrusBot;
        if (hasPatrol(e)) walrus.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(walrus, groundLayer);
        this.walruses.push(walrus);
      } else if (e.type === 'jetpack_bot') {
        // Jetpack bots float — gravity is disabled in setupBody, so they
        // do NOT collide with the tilemap layer.  They lock onto the player
        // in the air and chase via their own hover logic.
        const jet = new JetpackBot(this, e.x, e.y).setPlayer(this.player) as JetpackBot;
        this.jetpacks.push(jet);
      } else if (e.type === 'roller_bot') {
        const roller = new RollerBot(this, e.x, e.y).setPlayer(this.player) as RollerBot;
        if (hasPatrol(e)) roller.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(roller, groundLayer);
        this.rollers.push(roller);
      } else if (e.type === 'toxic_barrel_bot') {
        // Stationary turret — no patrol; sits on the tilemap.
        const toxic = new ToxicBarrelBot(this, e.x, e.y).setPlayer(this.player) as ToxicBarrelBot;
        this.physics.add.collider(toxic, groundLayer);
        this.toxicBots.push(toxic);
      } else if (e.type === 'atmb_bot') {
        const tank = new AllTerrainMissileBot(this, e.x, e.y).setPlayer(this.player) as AllTerrainMissileBot;
        if (hasPatrol(e)) tank.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(tank, groundLayer);
        this.atmbs.push(tank);
      } else if (e.type === 'nuclear_monkey_boss') {
        // Boss floats — gravity disabled in its constructor.  No ground
        // collider; the idle tween handles the vertical bob.
        const boss = new NuclearMonkeyBoss(this, e.x, e.y).setPlayer(this.player) as NuclearMonkeyBoss;
        this.monkeys.push(boss);
      }
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
    this.chargeFx?.update();
    this.slideDust?.update();

    // Cull bullets that left the viewport.
    cullOffscreen<Bullet>(this.bullets.small, this.cameras.main, b => b.kill());
    cullOffscreen<ChargedBullet>(this.bullets.charged,     this.cameras.main, b => b.kill());
    cullOffscreen<ChargedBullet>(this.bullets.fullCharged, this.cameras.main, b => b.kill());

    // Update active enemies.
    for (const p of this.penguins) {
      if (!p.active) continue;
      p.update(delta);
    }
    for (const w of this.walruses) {
      if (!w.active) continue;
      w.update(delta);
    }
    for (const j of this.jetpacks) {
      if (!j.active) continue;
      j.update(delta);
    }
    for (const r of this.rollers) {
      if (!r.active) continue;
      r.update(delta);
    }
    for (const t of this.toxicBots) {
      if (!t.active) continue;
      t.update(delta);
    }
    for (const a of this.atmbs) {
      if (!a.active) continue;
      a.update(delta);
    }
    for (const m of this.monkeys) {
      if (!m.active) continue;
      m.update(delta);
    }

    // Cannon balls own a landed → blink → kill timer; tick each one.
    for (const child of this.cannonBalls.group.getChildren()) {
      const ball = child as CannonBall;
      if (ball.active) ball.update(delta);
    }
    // Monkey balls age to a self-kill timeout — tick them too.
    for (const child of this.monkeyBalls.group.getChildren()) {
      const ball = child as MonkeyBall;
      if (ball.active) ball.update(delta);
    }

    // Tick bomb fuses + cull any that left the viewport.
    for (const child of this.bombs.group.getChildren()) {
      const bomb = child as PenguinBomb;
      if (bomb.active) bomb.update(delta);
    }
    cullOffscreen<PenguinBomb>   (this.bombs.group,          this.cameras.main, b => b.kill(), 64);
    cullOffscreen<WalrusSnowball>(this.snowballs.group,      this.cameras.main, b => b.kill(), 32);
    cullOffscreen<JetpackBullet >(this.jetpackBullets.group, this.cameras.main, b => b.kill(), 32);
    cullOffscreen<RollerBullet  >(this.rollerBullets.group,  this.cameras.main, b => b.kill(), 32);
    cullOffscreen<ToxicGoopShot >(this.toxicGoop.group,      this.cameras.main, b => b.kill(), 32);
    cullOffscreen<CannonBall    >(this.cannonBalls.group,    this.cameras.main, b => b.kill(), 96);
    cullOffscreen<MonkeyBall    >(this.monkeyBalls.group,    this.cameras.main, b => b.kill(), 96);

    // Belt-and-braces: straight-line projectiles that are pinned against
    // any tile or platform die on contact — covers cases where the
    // collider callback didn't fire before physics separation.
    // NOTE: cannon balls intentionally SKIP this — they're supposed to
    // land and sit.  Their own timer handles death.
    killBlockedProjectiles(this.snowballs.group);
    killBlockedProjectiles(this.jetpackBullets.group);
    killBlockedProjectiles(this.rollerBullets.group);
    killBlockedProjectiles(this.toxicGoop.group);

    // Fall-off-the-world safeguard — respawn at start if the player drops
    // below the level instead of tunneling forever.
    if (this.player.y > this.level.heightPx + 200) {
      const cellPx = this.level.data.tileWidth * this.level.data.displayScale;
      this.player.respawn(cellPx * 2, this.level.heightPx - cellPx * 3);
    }
  }
}
