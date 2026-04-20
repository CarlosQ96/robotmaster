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
import { PENGUIN_BOMB, PENGUIN_BOT } from '../config/enemyConfig';
import { Bullet } from '../entities/Bullet';
import { ChargedBullet } from '../entities/ChargedBullet';
import { PenguinBomb } from '../entities/PenguinBomb';
import { PenguinBot, PenguinThrowEvent } from '../entities/PenguinBot';
import { Player, ShootEvent } from '../entities/Player';
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
    } else {
      fireCharged(evt.x, evt.y, evt.facingRight, evt.type);
      getAudio(scene).playSfx('shootFull');
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

// ─── Combat colliders ──────────────────────────────────────────────────────
/**
 * bullet → enemy overlap for all three bullet tiers, with the right damage
 * and SFX per tier.  See GymScene comment: Phaser's collideSpriteVsGroup
 * calls the callback as (sprite, groupChild) — that means when we pass
 * (group, array) the group side comes SECOND.
 */
export function wireBulletEnemyCollisions(
  scene: Phaser.Scene,
  bullets: BulletSystem,
  enemies: PenguinBot[],
): void {
  scene.physics.add.overlap(bullets.small, enemies, (enemy, bullet) => {
    const e = enemy  as PenguinBot;
    const b = bullet as Bullet;
    if (!b.active || e.currentState === 'dead') return;
    e.takeDamage(PROJECTILE.small.damage, b.x);
    b.kill();
    getAudio(scene).playSfx('enemyHit');
  });
  scene.physics.add.overlap(bullets.charged, enemies, (enemy, bullet) => {
    const e = enemy  as PenguinBot;
    const b = bullet as ChargedBullet;
    if (!b.active || e.currentState === 'dead') return;
    e.takeDamage(PROJECTILE.charged.damage, b.x);
    b.kill();
    getAudio(scene).playSfx('hit');
  });
  scene.physics.add.overlap(bullets.fullCharged, enemies, (enemy, bullet) => {
    const e = enemy  as PenguinBot;
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
 * Player ↔ enemy solid collision with contact damage.  Invuln window inside
 * Player.takeDamage prevents per-frame damage stacking.
 */
export function wirePlayerEnemyCollisions(
  scene: Phaser.Scene,
  player: Player,
  enemies: PenguinBot[],
): void {
  scene.physics.add.collider(player, enemies, (_p, enemy) => {
    const e = enemy as PenguinBot;
    if (e.currentState === 'dead') return;
    player.takeDamage(PENGUIN_BOT.contactDamage, e.x);
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
