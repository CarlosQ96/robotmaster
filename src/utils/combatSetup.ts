/**
 * combatSetup.ts — Shared bullet + enemy + bomb wiring used by scenes that
 * host gameplay combat (GymScene, PlayScene, any future level scenes).
 *
 * These helpers keep the per-scene code tiny and ensure GymScene and
 * PlayScene cannot drift apart on combat behavior.  They do NOT own player
 * spawning, platform setup, or camera — those are scene-specific.
 *
 * Call order inside a scene's create():
 *
 *   registerBulletAnims(scene);
 *   const bullets = createBulletSystem(scene, player);
 *   const bombs   = createBombPool(scene);
 *
 *   // After enemies are spawned:
 *   wireBulletEnemyCollisions(scene, bullets, penguins);
 *   wirePlayerEnemyCollisions(scene, player, penguins);
 *   wireBombPlayer(scene, bombs, player);
 *
 *   // Per-entity platform colliders remain the scene's responsibility —
 *   // the shape of "platforms" differs (rect bodies vs tilemap layer).
 */
import * as Phaser from 'phaser';
import { PROJECTILE } from '../config/gameConfig';
import {
  PENGUIN_BOMB, WALRUS_BOT, WALRUS_SNOWBALL,
  JETPACK_BOT, JETPACK_BULLET,
  ROLLER_BULLET,
  TOXIC_GOOP,
  CANNON_BALL,
  MONKEY_BALL,
} from '../config/enemyConfig';
import { Bullet } from '../entities/Bullet';
import { ChargedBullet } from '../entities/ChargedBullet';
import { Enemy } from '../entities/Enemy';
import { PenguinBomb } from '../entities/PenguinBomb';
import { PenguinBot, PenguinThrowEvent } from '../entities/PenguinBot';
import { WalrusBot, WalrusShootEvent } from '../entities/WalrusBot';
import { WalrusSnowball } from '../entities/WalrusSnowball';
import { JetpackBot, JetpackShootEvent } from '../entities/JetpackBot';
import { JetpackBullet } from '../entities/JetpackBullet';
import { RollerBot, RollerShootEvent } from '../entities/RollerBot';
import { RollerBullet } from '../entities/RollerBullet';
import { ToxicBarrelBot, ToxicShootEvent } from '../entities/ToxicBarrelBot';
import { ToxicGoopShot } from '../entities/ToxicGoopShot';
import { AllTerrainMissileBot, AtmbShootEvent } from '../entities/AllTerrainMissileBot';
import { CannonBall } from '../entities/CannonBall';
import { NuclearMonkeyBoss, MonkeyThrowEvent } from '../entities/NuclearMonkeyBoss';
import { MonkeyBall } from '../entities/MonkeyBall';
import { Player, ShootEvent } from '../entities/Player';
import { fireMuzzleFlash } from './fxSystem';
import { getAudio } from '../audio/AudioManager';

export interface BulletSystem {
  small:       Phaser.Physics.Arcade.Group;
  charged:     Phaser.Physics.Arcade.Group;
  fullCharged: Phaser.Physics.Arcade.Group;
}

// ─── Animations ────────────────────────────────────────────────────────────
/**
 * Register looping animations for charged / full-charged bullets.
 * Idempotent — safe to call from every combat-hosting scene's create().
 */
export function registerBulletAnims(scene: Phaser.Scene): void {
  if (!scene.anims.exists('bullet_anim_charged')) {
    scene.anims.create({
      key:       'bullet_anim_charged',
      frames:    scene.anims.generateFrameNumbers('bullet_charged', { start: 0, end: 1 }),
      frameRate: PROJECTILE.charged.animFps,
      repeat:    -1,
    });
  }
  if (!scene.anims.exists('bullet_anim_full_charged')) {
    scene.anims.create({
      key:       'bullet_anim_full_charged',
      frames:    scene.anims.generateFrameNumbers('bullet_full_charged', { start: 0, end: 1 }),
      frameRate: PROJECTILE.fullCharged.animFps,
      repeat:    -1,
    });
  }
}

/**
 * Register every impact / FX animation a combat-hosting scene may need —
 * proactively, even if the enemy that "owns" the FX isn't in the current
 * level.  Otherwise a bullet calling `.play('walrus_shoot_fx')` in a level
 * with no walrus would show a static frame-0 sprite forever because
 * `ANIMATION_COMPLETE` never fires for a missing anim (and our impact()
 * destroys the sprite on that event).
 *
 * Idempotent — each `anims.create` is guarded by `anims.exists`.
 */
export function registerEnemyFxAnims(scene: Phaser.Scene): void {
  const mk = (
    key: string,
    texture: string,
    start: number,
    end: number,
    frameRate: number,
    repeat = 0,
  ) => {
    if (scene.anims.exists(key)) return;
    scene.anims.create({
      key,
      frames:    scene.anims.generateFrameNumbers(texture, { start, end }),
      frameRate,
      repeat,
    });
  };

  // Muzzle / impact puffs — `repeat: 0` so ANIMATION_COMPLETE fires and the
  // throwaway sprite self-destructs.
  mk('walrus_shoot_fx',  'walrus_shoot_fx',  0, 2, WALRUS_BOT.shootFx.frameRate);
  mk('jetpack_shoot_fx', 'jetpack_shoot_fx', 0, 2, JETPACK_BOT.shootFx.frameRate);

  // Looping projectile anims — `repeat: -1` so the bullet spins for as
  // long as it's alive.
  mk('roller_bullet_spin', 'roller_bullet',
     ROLLER_BULLET.anims.spin.start,
     ROLLER_BULLET.anims.spin.end,
     ROLLER_BULLET.anims.spin.frameRate,
     -1);
  mk('toxic_goop_wobble', 'toxic_goop',
     TOXIC_GOOP.anims.wobble.start,
     TOXIC_GOOP.anims.wobble.end,
     TOXIC_GOOP.anims.wobble.frameRate,
     -1);
}

// ─── Bullets ───────────────────────────────────────────────────────────────
/**
 * Build the three bullet pools and wire the player's `player-shoot` event to
 * route each shot type to the right pool (with the matching SFX).
 */
export function createBulletSystem(scene: Phaser.Scene, player: Player): BulletSystem {
  const small = scene.physics.add.group({
    classType:      Bullet,
    maxSize:        PROJECTILE.small.poolSize,
    runChildUpdate: false,
  });
  const charged = scene.physics.add.group({
    classType:      ChargedBullet,
    maxSize:        PROJECTILE.charged.poolSize,
    runChildUpdate: false,
  });
  const fullCharged = scene.physics.add.group({
    classType:      ChargedBullet,
    maxSize:        PROJECTILE.fullCharged.poolSize,
    runChildUpdate: false,
  });

  const fireSmall = (x: number, y: number, facingRight: boolean): void => {
    let bullet = small.getFirstDead(false) as Bullet | null;
    if (!bullet && small.getLength() < PROJECTILE.small.poolSize) {
      bullet = new Bullet(scene, x, y);
      small.add(bullet, false);
    }
    bullet?.fire(x, y, facingRight);
  };

  const fireCharged = (
    x: number, y: number, facingRight: boolean,
    type: 'charged' | 'full_charged',
  ): void => {
    const group    = type === 'charged' ? charged : fullCharged;
    const poolSize = type === 'charged' ? PROJECTILE.charged.poolSize : PROJECTILE.fullCharged.poolSize;
    let bullet = group.getFirstDead(false) as ChargedBullet | null;
    if (!bullet && group.getLength() < poolSize) {
      bullet = new ChargedBullet(scene, x, y, type);
      group.add(bullet, false);
    }
    bullet?.fire(x, y, facingRight);
  };

  player.on('player-shoot', (evt: ShootEvent) => {
    if (evt.type === 'small') {
      fireSmall(evt.x, evt.y, evt.facingRight);
      getAudio(scene).playSfx('shoot');
    } else if (evt.type === 'charged') {
      fireCharged(evt.x, evt.y, evt.facingRight, evt.type);
      getAudio(scene).playSfx('shootCharged');
      fireMuzzleFlash(scene, evt.x, evt.y, evt.facingRight, 'charged');
    } else {
      fireCharged(evt.x, evt.y, evt.facingRight, evt.type);
      getAudio(scene).playSfx('shootFull');
      fireMuzzleFlash(scene, evt.x, evt.y, evt.facingRight, 'full_charged');
    }
  });

  return { small, charged, fullCharged };
}

// ─── Bombs ─────────────────────────────────────────────────────────────────
/**
 * Pool of PenguinBombs.  Caller still has to collide the group with their
 * platforms (tilemap layer or static bodies) — that's scene-specific.
 *
 * Returns a `fire(x, y, vx, vy)` closure for convenience, so penguin throw
 * events can be routed to it without the scene needing to hold the group.
 */
export interface BombPool {
  group: Phaser.Physics.Arcade.Group;
  fire:  (x: number, y: number, vx: number, vy: number) => void;
}

export function createBombPool(scene: Phaser.Scene): BombPool {
  const group = scene.physics.add.group({
    classType:      PenguinBomb,
    maxSize:        PENGUIN_BOMB.poolSize,
    runChildUpdate: false,
  });

  const fire = (x: number, y: number, vx: number, vy: number): void => {
    let bomb = group.getFirstDead(false) as PenguinBomb | null;
    if (!bomb && group.getLength() < PENGUIN_BOMB.poolSize) {
      bomb = new PenguinBomb(scene, x, y);
      group.add(bomb, false);
    }
    bomb?.fire(x, y, vx, vy);
  };

  return { group, fire };
}

/** Wire each penguin's 'penguin-throw' event to spawn a bomb from the pool. */
export function wirePenguinBombs(penguins: PenguinBot[], bombs: BombPool): void {
  for (const p of penguins) {
    p.on('penguin-throw', (evt: PenguinThrowEvent) => {
      bombs.fire(evt.x, evt.y, evt.vx, evt.vy);
    });
  }
}

// ─── Walrus snowball ───────────────────────────────────────────────────────
/**
 * Straight-line horizontal projectile fired by WalrusBot.  Separate pool
 * from the penguin bomb since the physics (no gravity) and payload differ.
 */
export interface SnowballPool {
  group: Phaser.Physics.Arcade.Group;
  fire:  (x: number, y: number, vx: number) => void;
}

export function createSnowballPool(scene: Phaser.Scene): SnowballPool {
  const group = scene.physics.add.group({
    classType:      WalrusSnowball,
    maxSize:        WALRUS_SNOWBALL.poolSize,
    runChildUpdate: false,
  });

  const fire = (x: number, y: number, vx: number): void => {
    let ball = group.getFirstDead(false) as WalrusSnowball | null;
    if (!ball && group.getLength() < WALRUS_SNOWBALL.poolSize) {
      ball = new WalrusSnowball(scene, x, y);
      group.add(ball, false);
    }
    ball?.fire(x, y, vx);
  };

  return { group, fire };
}

/**
 * Wire each walrus's 'walrus-shoot' event to spawn a snowball + short
 * muzzle-flash sprite at the mouth position.  The flash is a throwaway
 * Sprite that auto-destroys on anim complete.
 */
export function wireWalrusShots(
  scene: Phaser.Scene,
  walruses: WalrusBot[],
  snowballs: SnowballPool,
): void {
  for (const w of walruses) {
    w.on('walrus-shoot', (evt: WalrusShootEvent) => {
      snowballs.fire(evt.x, evt.y, evt.vx);

      // Muzzle flash — plays 3-frame anim then destroys.  `walrus_shoot_fx`
      // anim is registered in WalrusBot.buildAnims.
      const flash = scene.add
        .sprite(evt.x, evt.y, 'walrus_shoot_fx', 0)
        .setScale(WALRUS_BOT.scale)
        .setFlipX(evt.facingRight)   // sheet faces LEFT by default
        .setDepth(6);
      flash.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => flash.destroy());
      flash.play('walrus_shoot_fx');
    });
  }
}

/**
 * Snowball → player overlap.  One hit = WALRUS_SNOWBALL.damage, and the
 * snowball is returned to the pool so it can't double-damage.
 */
export function wireSnowballPlayer(
  scene: Phaser.Scene,
  snowballs: SnowballPool,
  player: Player,
): void {
  scene.physics.add.overlap(player, snowballs.group, (_p, ball) => {
    const sb = ball as WalrusSnowball;
    if (!sb.active) return;
    player.takeDamage(WALRUS_SNOWBALL.damage, sb.x);
    sb.impact();
  });
}

// ─── Jetpack Ice Blaster ──────────────────────────────────────────────────
/**
 * Pool of aimed icicle projectiles fired by JetpackBot.  Separate from the
 * snowball pool because the frame index + velocity vector are per-shot.
 */
export interface JetpackBulletPool {
  group: Phaser.Physics.Arcade.Group;
  fire:  (x: number, y: number, vx: number, vy: number, frameIdx: 0 | 1 | 2) => void;
}

export function createJetpackBulletPool(scene: Phaser.Scene): JetpackBulletPool {
  const group = scene.physics.add.group({
    classType:      JetpackBullet,
    maxSize:        JETPACK_BULLET.poolSize,
    runChildUpdate: false,
  });

  const fire = (x: number, y: number, vx: number, vy: number, frameIdx: 0 | 1 | 2): void => {
    let b = group.getFirstDead(false) as JetpackBullet | null;
    if (!b && group.getLength() < JETPACK_BULLET.poolSize) {
      b = new JetpackBullet(scene, x, y);
      group.add(b, false);
    }
    b?.fire(x, y, vx, vy, frameIdx);
  };

  return { group, fire };
}

/**
 * Wire each jetpack bot's 'jetpack-shoot' event to spawn a projectile AND
 * a short single-frame muzzle flash.  The flash sprite picks the matching
 * `angleIdx` frame so the three poses read distinctly on screen.
 */
export function wireJetpackShots(
  scene: Phaser.Scene,
  bots: JetpackBot[],
  bullets: JetpackBulletPool,
): void {
  for (const bot of bots) {
    bot.on('jetpack-shoot', (evt: JetpackShootEvent) => {
      bullets.fire(evt.x, evt.y, evt.vx, evt.vy, evt.angleIdx);

      // Muzzle flash — throwaway sprite that plays the 3-frame puff anim
      // (frames 0→2) regardless of aim angle.  The PROJECTILE carries the
      // per-angle visual via its own frame index; the flash is pure VFX.
      const flash = scene.add
        .sprite(evt.x, evt.y, 'jetpack_shoot_fx', 0)
        .setScale(JETPACK_BOT.scale)
        .setFlipX(evt.facingRight)   // sheet faces LEFT
        .setDepth(6);
      flash.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => flash.destroy());
      flash.play('jetpack_shoot_fx');
    });
  }
}

/** Jetpack-bullet → player overlap. */
export function wireJetpackBulletPlayer(
  scene: Phaser.Scene,
  bullets: JetpackBulletPool,
  player: Player,
): void {
  scene.physics.add.overlap(player, bullets.group, (_p, bullet) => {
    const b = bullet as JetpackBullet;
    if (!b.active) return;
    player.takeDamage(JETPACK_BULLET.damage, b.x);
    b.impact();
  });
}

// ─── Roller Bot ────────────────────────────────────────────────────────────
/** Pool of roller-bot bullets (spinning horizontal shot). */
export interface RollerBulletPool {
  group: Phaser.Physics.Arcade.Group;
  fire:  (x: number, y: number, vx: number) => void;
}

export function createRollerBulletPool(scene: Phaser.Scene): RollerBulletPool {
  const group = scene.physics.add.group({
    classType:      RollerBullet,
    maxSize:        ROLLER_BULLET.poolSize,
    runChildUpdate: false,
  });

  const fire = (x: number, y: number, vx: number): void => {
    let b = group.getFirstDead(false) as RollerBullet | null;
    if (!b && group.getLength() < ROLLER_BULLET.poolSize) {
      b = new RollerBullet(scene, x, y);
      group.add(b, false);
    }
    b?.fire(x, y, vx);
  };

  return { group, fire };
}

/**
 * Wire each roller bot's 'roller-shoot' event to spawn a bullet.  No
 * muzzle flash — the art sells the "pop open and fire" moment itself,
 * and the bullet already plays a spin anim on fire.
 */
export function wireRollerShots(
  bots: RollerBot[],
  bullets: RollerBulletPool,
): void {
  for (const bot of bots) {
    bot.on('roller-shoot', (evt: RollerShootEvent) => {
      bullets.fire(evt.x, evt.y, evt.vx);
    });
  }
}

/** Roller-bullet → player overlap. */
export function wireRollerBulletPlayer(
  scene: Phaser.Scene,
  bullets: RollerBulletPool,
  player: Player,
): void {
  scene.physics.add.overlap(player, bullets.group, (_p, bullet) => {
    const b = bullet as RollerBullet;
    if (!b.active) return;
    player.takeDamage(ROLLER_BULLET.damage, b.x);
    b.impact();
  });
}

// ─── Toxic Barrel Bot ──────────────────────────────────────────────────────
/** Pool of toxic goop shots fired by ToxicBarrelBot. */
export interface ToxicGoopPool {
  group: Phaser.Physics.Arcade.Group;
  fire:  (x: number, y: number, vx: number) => void;
}

export function createToxicGoopPool(scene: Phaser.Scene): ToxicGoopPool {
  const group = scene.physics.add.group({
    classType:      ToxicGoopShot,
    maxSize:        TOXIC_GOOP.poolSize,
    runChildUpdate: false,
  });

  const fire = (x: number, y: number, vx: number): void => {
    let g = group.getFirstDead(false) as ToxicGoopShot | null;
    if (!g && group.getLength() < TOXIC_GOOP.poolSize) {
      g = new ToxicGoopShot(scene, x, y);
      group.add(g, false);
    }
    g?.fire(x, y, vx);
  };

  return { group, fire };
}

/**
 * Wire each toxic barrel's 'toxic-shoot' event to spawn a goop from the
 * pool.  No muzzle flash — the hatch opening animation sells the shot.
 */
export function wireToxicShots(
  bots: ToxicBarrelBot[],
  goop: ToxicGoopPool,
): void {
  for (const bot of bots) {
    bot.on('toxic-shoot', (evt: ToxicShootEvent) => {
      goop.fire(evt.x, evt.y, evt.vx);
    });
  }
}

/** Toxic goop → player overlap. */
export function wireToxicGoopPlayer(
  scene: Phaser.Scene,
  goop: ToxicGoopPool,
  player: Player,
): void {
  scene.physics.add.overlap(player, goop.group, (_p, ball) => {
    const g = ball as ToxicGoopShot;
    if (!g.active) return;
    player.takeDamage(TOXIC_GOOP.damage, g.x);
    g.impact();
  });
}

// ─── All-Terrain Missile Bot ───────────────────────────────────────────────
/**
 * Pool of cannon balls.  Different from other pools: cannon balls HAVE
 * gravity and stay alive after landing (they sit, blink, then vanish),
 * so the "kill on wall contact" pattern from snowballs doesn't apply —
 * the scene uses a plain collider (no callback) instead, and relies on
 * the ball's own update() to time out via landedStaticMs + blinkMs.
 */
export interface CannonBallPool {
  group: Phaser.Physics.Arcade.Group;
  fire:  (x: number, y: number, vx: number, vy: number) => void;
}

export function createCannonBallPool(scene: Phaser.Scene): CannonBallPool {
  const group = scene.physics.add.group({
    classType:      CannonBall,
    maxSize:        CANNON_BALL.poolSize,
    runChildUpdate: false,
  });

  const fire = (x: number, y: number, vx: number, vy: number): void => {
    let b = group.getFirstDead(false) as CannonBall | null;
    if (!b && group.getLength() < CANNON_BALL.poolSize) {
      b = new CannonBall(scene, x, y);
      group.add(b, false);
    }
    b?.fire(x, y, vx, vy);
  };

  return { group, fire };
}

/** Wire each missile bot's 'atmb-shoot' event to fire a cannon ball. */
export function wireAtmbShots(
  bots: AllTerrainMissileBot[],
  balls: CannonBallPool,
): void {
  for (const bot of bots) {
    bot.on('atmb-shoot', (evt: AtmbShootEvent) => {
      balls.fire(evt.x, evt.y, evt.vx, evt.vy);
    });
  }
}

/** Cannon ball → player overlap.  Damages + removes on contact. */
export function wireCannonBallPlayer(
  scene: Phaser.Scene,
  balls: CannonBallPool,
  player: Player,
): void {
  scene.physics.add.overlap(player, balls.group, (_p, ball) => {
    const b = ball as CannonBall;
    if (!b.active) return;
    player.takeDamage(CANNON_BALL.damage, b.x);
    b.impact();
  });
}

// ─── Nuclear Monkey Boss ───────────────────────────────────────────────────
/**
 * Pool of monkey balls.  Uses a plain platform collider (bouncy rolling),
 * has its own lifetime timer, and is ticked by the scene each frame.
 */
export interface MonkeyBallPool {
  group: Phaser.Physics.Arcade.Group;
  fire:  (x: number, y: number, vx: number, vy: number) => void;
}

export function createMonkeyBallPool(scene: Phaser.Scene): MonkeyBallPool {
  const group = scene.physics.add.group({
    classType:      MonkeyBall,
    maxSize:        MONKEY_BALL.poolSize,
    runChildUpdate: false,
  });

  const fire = (x: number, y: number, vx: number, vy: number): void => {
    let b = group.getFirstDead(false) as MonkeyBall | null;
    if (!b && group.getLength() < MONKEY_BALL.poolSize) {
      b = new MonkeyBall(scene, x, y);
      group.add(b, false);
    }
    b?.fire(x, y, vx, vy);
  };

  return { group, fire };
}

/** Wire each monkey boss' 'monkey-throw' event to fire a monkey ball. */
export function wireMonkeyThrows(
  bosses: NuclearMonkeyBoss[],
  balls: MonkeyBallPool,
): void {
  for (const boss of bosses) {
    boss.on('monkey-throw', (evt: MonkeyThrowEvent) => {
      balls.fire(evt.x, evt.y, evt.vx, evt.vy);
    });
  }
}

/** Monkey ball → player overlap.  The ball keeps rolling after a hit —
 *  subsequent overlaps during the same pass-through are absorbed by the
 *  player's invuln window, so the damage only lands once per pass. */
export function wireMonkeyBallPlayer(
  scene: Phaser.Scene,
  balls: MonkeyBallPool,
  player: Player,
): void {
  scene.physics.add.overlap(player, balls.group, (_p, ball) => {
    const b = ball as MonkeyBall;
    if (!b.active) return;
    player.takeDamage(MONKEY_BALL.damage, b.x);
  });
}

// ─── Combat colliders ──────────────────────────────────────────────────────
/**
 * bullet → enemy overlap for all three bullet tiers, with the right damage
 * and SFX per tier.  Works for any `Enemy[]` subclass (PenguinBot, WalrusBot,
 * ...) since `takeDamage` + `currentState` live on the base class.
 *
 * Callback arg order: `collideSpriteVsGroup` invokes (sprite, groupChild),
 * so for `overlap(group, array)` the group side comes SECOND.
 */
export function wireBulletEnemyCollisions(
  scene: Phaser.Scene,
  bullets: BulletSystem,
  enemies: Enemy[],
): void {
  scene.physics.add.overlap(bullets.small, enemies, (enemy, bullet) => {
    const e = enemy  as Enemy;
    const b = bullet as Bullet;
    if (!b.active || e.currentState === 'dead') return;
    e.takeDamage(PROJECTILE.small.damage, b.x);
    b.kill();
    getAudio(scene).playSfx('enemyHit');
  });
  scene.physics.add.overlap(bullets.charged, enemies, (enemy, bullet) => {
    const e = enemy  as Enemy;
    const b = bullet as ChargedBullet;
    if (!b.active || e.currentState === 'dead') return;
    e.takeDamage(PROJECTILE.charged.damage, b.x);
    b.kill();
    getAudio(scene).playSfx('hit');
  });
  scene.physics.add.overlap(bullets.fullCharged, enemies, (enemy, bullet) => {
    const e = enemy  as Enemy;
    const b = bullet as ChargedBullet;
    if (!b.active || e.currentState === 'dead') return;
    e.takeDamage(PROJECTILE.fullCharged.damage, b.x);
    b.kill();
    getAudio(scene).playSfx('hit');
  });
  // Enemy ↔ enemy — dynamic bodies bounce off each other, no stacking.
  scene.physics.add.collider(enemies, enemies);
}

/**
 * Player ↔ enemy solid collision with contact damage.  Damage per type is
 * read from the enemy instance (`e.contactDamage`), so WalrusBot hitting
 * for 1 and a future boss hitting for 2 both work via the same call.
 */
export function wirePlayerEnemyCollisions(
  scene: Phaser.Scene,
  player: Player,
  enemies: Enemy[],
): void {
  void scene;
  scene.physics.add.collider(player, enemies, (_p, enemy) => {
    const e = enemy as Enemy;
    if (e.currentState === 'dead') return;
    player.takeDamage(e.contactDamage, e.x);
  });
}

/**
 * Bomb → player overlap.  Fuse touch detonates AND deals fuse damage;
 * explosion deals its own (larger) damage while the explode body is active.
 */
export function wireBombPlayer(scene: Phaser.Scene, bombs: BombPool, player: Player): void {
  scene.physics.add.overlap(player, bombs.group, (_p, bomb) => {
    const bm = bomb as PenguinBomb;
    if (!bm.active) return;
    if (bm.isExploding) {
      player.takeDamage(PENGUIN_BOMB.explodeDamage, bm.x);
    } else {
      player.takeDamage(PENGUIN_BOMB.fuseDamage, bm.x);
      bm.detonate();
    }
  });
}
