/**
 * RollerBullet.ts — Pooled horizontal projectile fired by RollerBot.
 *
 * Same pool-enable strategy as Bullet.ts / WalrusSnowball.ts — toggles
 * body.enable + parks off-screen instead of disableBody, so kill/fire
 * is safe to call from inside overlap callbacks.
 *
 * On impact (wall / tilemap / player), plays the jetpack ice-burst puff
 * as the impact FX — per the feature brief, reusing existing assets for
 * a consistent "ice magic" palette across enemy projectiles.
 */
import * as Phaser from 'phaser';
import { JETPACK_BOT, ROLLER_BULLET } from '../config/enemyConfig';

const POOL_PARK = -10000;

export class RollerBullet extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'roller_bullet', 0);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(ROLLER_BULLET.scale);
    // Sub-pixel snap — prevents trailing-pixel line at fractional scales.
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';

    const b = this.arcadeBody;
    b.setAllowGravity(false);
    b.setSize(ROLLER_BULLET.body.width, ROLLER_BULLET.body.height);
    b.setOffset(ROLLER_BULLET.body.offsetX, ROLLER_BULLET.body.offsetY);

    this.setActive(false).setVisible(false);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /** Launch horizontally; sign of `vx` picks direction. */
  fire(x: number, y: number, vx: number): void {
    this.setActive(true).setVisible(true);
    this.setFlipX(vx < 0 ? false : true);   // sheet faces LEFT

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(false);
    b.setVelocity(vx, 0);

    // Start the spin anim on every fire (idempotent — if the anim is
    // already playing, Phaser no-ops).
    this.play('roller_bullet_spin', true);
  }

  /** Return to pool — silent.  For visual-kill use impact(). */
  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  /**
   * Impact — spawns the jetpack ice-burst puff (same asset the jetpack
   * uses for its muzzle / impact) and kills the bullet.  Per-user brief:
   * "same bullet effect as the jetpack when it clashes".
   */
  impact(): void {
    if (!this.active) return;
    const puff = this.scene.add
      .sprite(this.x, this.y, 'jetpack_shoot_fx', 0)
      .setScale(JETPACK_BOT.scale)
      .setDepth(6);
    puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
    puff.play('jetpack_shoot_fx');
    this.kill();
  }
}
