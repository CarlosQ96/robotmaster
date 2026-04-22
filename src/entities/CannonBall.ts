/**
 * CannonBall.ts — Arcing projectile fired by AllTerrainMissileBot.
 *
 * Lifecycle:
 *   1. `fire(x, y, vx, vy)` launches with gravity ON (scene physics gravity),
 *      so the trajectory curves naturally.
 *   2. The scene's per-frame tick calls `update(delta)`.  When the body
 *      reports `blocked.down` for the first time, we mark `hasLanded`.
 *   3. After `landedStaticMs`, the ball starts flashing its alpha between
 *      1.0 and `blinkDimAlpha` every `blinkPeriodMs` (one on + off cycle).
 *   4. After `landedStaticMs + blinkMs` total, the ball is killed.
 *
 * Damage:
 *   - Contact with the player at ANY phase (flying, static, blinking)
 *     deals damage; the scene wires the overlap + calls `impact()`.
 *
 * Pool pattern is identical to the other projectiles — toggle body.enable
 * + park off-screen, so kill/fire is safe from inside overlap callbacks.
 */
import * as Phaser from 'phaser';
import { CANNON_BALL } from '../config/enemyConfig';

const POOL_PARK = -10000;

export class CannonBall extends Phaser.Physics.Arcade.Sprite {
  private hasLanded = false;
  private landedMs  = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'cannon_ball');

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(CANNON_BALL.scale);
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';

    const b = this.arcadeBody;
    b.setAllowGravity(true);
    b.setBounce(CANNON_BALL.bounce, CANNON_BALL.bounce);
    b.setSize(CANNON_BALL.body.width, CANNON_BALL.body.height);
    b.setOffset(CANNON_BALL.body.offsetX, CANNON_BALL.body.offsetY);

    // Pool: start parked + disabled.
    this.setActive(false).setVisible(false);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /** Launch from (x, y) with an arc-shaped initial velocity. */
  fire(x: number, y: number, vx: number, vy: number): void {
    this.setActive(true).setVisible(true);
    this.setAlpha(1);
    this.setRotation(0);
    this.hasLanded = false;
    this.landedMs  = 0;

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(true);
    b.setDragX(0); // no drag while airborne — gravity shapes the arc
    b.setVelocity(vx, vy);
  }

  /**
   * Drives the "landed → wait → blink → disappear" lifecycle.  Must be
   * called every frame by the scene (the pool has `runChildUpdate: false`,
   * so automatic per-child updates are off — see bomb pool for the same
   * pattern).
   */
  update(delta: number): void {
    if (!this.active) return;

    const b = this.arcadeBody;

    // Roll: angular velocity = vx / radius.  Source sprite is 16×16 so the
    // world radius is 8 × displayScale.  Kept active for the whole life so
    // the ball keeps spinning mid-air and winds down with the drag on landing.
    const radius = 8 * CANNON_BALL.scale;
    if (radius > 0) {
      this.rotation += (b.velocity.x / radius) * (delta / 1000);
    }

    if (!this.hasLanded && b.blocked.down) {
      this.hasLanded = true;
      this.landedMs  = 0;
      // Kick in drag so the ball's forward roll eases to a stop.  Phaser
      // Arcade drag uses `allowDrag` implicitly via setDragX.
      b.setDragX(CANNON_BALL.landedDragX);
    }

    if (this.hasLanded) {
      // Once drag has bled the horizontal speed down below a threshold,
      // nail it to zero so the ball doesn't creep.
      if (b.blocked.down && Math.abs(b.velocity.x) < 6) {
        b.setVelocityX(0);
      }
    }

    if (!this.hasLanded) return;

    this.landedMs += delta;
    const total = CANNON_BALL.landedStaticMs + CANNON_BALL.blinkMs;

    if (this.landedMs >= total) {
      this.kill();
      return;
    }

    if (this.landedMs >= CANNON_BALL.landedStaticMs) {
      // Blink — flip alpha every half-period.
      const elapsedInBlink = this.landedMs - CANNON_BALL.landedStaticMs;
      const phase = Math.floor(elapsedInBlink / (CANNON_BALL.blinkPeriodMs / 2)) % 2;
      this.setAlpha(phase === 0 ? CANNON_BALL.blinkDimAlpha : 1);
    }
  }

  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    this.setAlpha(1);
    this.setRotation(0);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.setDragX(0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  /** Player-contact damage-kill.  No visual FX — the blink IS the FX. */
  impact(): void {
    this.kill();
  }

  /** Snapshot for network broadcast (host-only). */
  getSyncState() {
    return {
      type:       'cannon_ball' as const,
      textureKey: 'cannon_ball',
      x:          this.x,
      y:          this.y,
      flipX:      this.flipX,
      rotation:   this.rotation,
      animKey:    this.anims.currentAnim?.key ?? '',
      alpha:      this.alpha,
      visible:    this.visible,
      scale:      this.scaleX,
    };
  }
}
