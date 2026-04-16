/**
 * Bullet.ts — Pool-friendly projectile for the player's small shot.
 *
 * Enable/disable strategy:
 *   We NEVER call world.disableBody / world.enableBody — both mutate
 *   world.tree (RBush) and world.bodies (Set), which Arcade iterates during
 *   overlap/collider callbacks.  Mutating those mid-step (e.g. killing a
 *   bullet inside an overlap callback) corrupts iteration and crashes.
 *
 *   Instead we toggle `body.enable` directly.  `World.separate` bails when
 *   either body has `enable === false` (see World.js L1363), so disabled
 *   bullets participate in no collisions — fully synchronous, safe anywhere.
 *
 *   The body stays in world.bodies, so the debug renderer iterates it.  To
 *   avoid drawing a ghost outline at the hit spot, kill() parks the body far
 *   off-screen; any stale debug line is invisible.
 */
import * as Phaser from 'phaser';
import { PROJECTILE } from '../config/gameConfig';

/** Off-screen parking coordinate for killed bullets (body remains in tree). */
const POOL_PARK = -10000;

export class Bullet extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bullet_small');

    scene.add.existing(this);
    scene.physics.add.existing(this);

    const b = this.arcadeBody;
    b.setAllowGravity(false);
    b.setSize(PROJECTILE.small.bodyWidth, PROJECTILE.small.bodyHeight);
    b.setOffset(PROJECTILE.small.bodyOffsetX, PROJECTILE.small.bodyOffsetY);

    // Start parked + disabled — no collisions, no visible debug outline.
    this.setActive(false).setVisible(false);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  fire(x: number, y: number, facingRight: boolean): void {
    this.setActive(true).setVisible(true);
    this.setFlipX(facingRight);

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(false);
    b.setVelocity(
      facingRight ? PROJECTILE.small.speed : -PROJECTILE.small.speed,
      0,
    );
  }

  /**
   * Return to pool — synchronous, safe to call from inside overlap callbacks.
   * Flips body.enable off so separate() skips this body for the rest of the
   * physics step, and parks off-screen so no debug ghost is visible.
   */
  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }
}
