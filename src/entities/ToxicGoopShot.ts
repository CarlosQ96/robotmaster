/**
 * ToxicGoopShot.ts — Pooled horizontal projectile fired by ToxicBarrelBot.
 *
 * 3-frame wobble anim loops while alive.  Same pool-enable strategy as the
 * other projectiles — toggles body.enable + parks off-screen for safe
 * recycle from inside overlap callbacks.
 *
 * On impact reuses the `walrus_shoot_fx` puff — reads as a matching "goo
 * splat" across enemy elemental projectiles without requiring a new asset.
 */
import * as Phaser from 'phaser';
import { TOXIC_GOOP, WALRUS_BOT } from '../config/enemyConfig';

const POOL_PARK = -10000;

export class ToxicGoopShot extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'toxic_goop', 0);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(TOXIC_GOOP.scale);
    // Sub-pixel snap — prevents trailing-pixel line at fractional scales.
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';

    const b = this.arcadeBody;
    b.setAllowGravity(false);
    b.setSize(TOXIC_GOOP.body.width, TOXIC_GOOP.body.height);
    b.setOffset(TOXIC_GOOP.body.offsetX, TOXIC_GOOP.body.offsetY);

    this.setActive(false).setVisible(false);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  fire(x: number, y: number, vx: number): void {
    this.setActive(true).setVisible(true);
    this.setFlipX(vx >= 0);   // sheet faces LEFT by default

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(false);
    b.setVelocity(vx, 0);

    this.play('toxic_goop_wobble', true);
  }

  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  /** Reuse the walrus ice-puff as a generic "splat" effect on impact. */
  impact(): void {
    if (!this.active) return;
    const puff = this.scene.add
      .sprite(this.x, this.y, 'walrus_shoot_fx', 0)
      .setScale(WALRUS_BOT.scale)
      .setTint(0x99ff66)           // greenish tint — reads as toxic
      .setDepth(6);
    puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
    puff.play('walrus_shoot_fx');
    this.kill();
  }

  /** Snapshot for network broadcast (host-only). */
  getSyncState() {
    return {
      type:       'toxic_goop' as const,
      textureKey: 'toxic_goop',
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
