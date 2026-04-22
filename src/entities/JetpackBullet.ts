/**
 * JetpackBullet.ts — Pooled aimed projectile fired by JetpackBot.
 *
 * Same pool-enable strategy as Bullet.ts / WalrusSnowball.ts.
 *
 * Unlike the snowball (horizontal-only), this projectile has a per-shot
 * velocity vector and a per-shot spritesheet frame: 0 = shallow, 1 = deep,
 * 2 = down — the `angleIdx` supplied by JetpackBot maps to both.
 *
 * Gravity is disabled — the velocity itself already encodes the downward
 * component, and a straight-line travel reads more "laser-ish" than an arc.
 */
import * as Phaser from 'phaser';
import { JETPACK_BOT, JETPACK_BULLET } from '../config/enemyConfig';

const POOL_PARK = -10000;

export class JetpackBullet extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'jetpack_bullet', 0);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(JETPACK_BULLET.scale);
    // Sub-pixel snap — prevents trailing-pixel line at fractional scales.
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';

    const b = this.arcadeBody;
    b.setAllowGravity(false);
    b.setSize(JETPACK_BULLET.body.width, JETPACK_BULLET.body.height);
    b.setOffset(JETPACK_BULLET.body.offsetX, JETPACK_BULLET.body.offsetY);

    this.setActive(false).setVisible(false);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /**
   * Launch from (x, y) with the given velocity and visual frame.  Flip is
   * derived from the sign of vx — bullet art faces LEFT by default.
   */
  fire(x: number, y: number, vx: number, vy: number, frameIdx: 0 | 1 | 2): void {
    this.setActive(true).setVisible(true);
    this.setFrame(frameIdx);
    this.setFlipX(vx >= 0);   // rightward → mirror

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(false);
    b.setVelocity(vx, vy);
  }

  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  /**
   * Spawn a 3-frame ice-burst puff at the current position, then kill().
   * Re-uses `jetpack_shoot_fx` (registered by JetpackBot.buildAnims) so
   * the impact reads as the same "icicle magic" as the muzzle flash.
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

  /** Snapshot for network broadcast (host-only). */
  getSyncState() {
    return {
      type:       'jetpack_bullet' as const,
      textureKey: 'jetpack_bullet',
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
