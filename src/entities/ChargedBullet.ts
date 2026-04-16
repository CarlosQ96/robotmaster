/**
 * ChargedBullet.ts — Pool-friendly projectile for charged and full-charged shots.
 *
 * Same enable/disable strategy as Bullet.ts — we toggle body.enable rather than
 * mutating world.bodies, so kill() is safe to call inside overlap callbacks.
 */
import * as Phaser from 'phaser';
import { PROJECTILE } from '../config/gameConfig';

export type ChargedBulletType = 'charged' | 'full_charged';

const ANIM_KEYS: Record<ChargedBulletType, string> = {
  charged:      'bullet_anim_charged',
  full_charged: 'bullet_anim_full_charged',
};

const CFG = {
  charged:      PROJECTILE.charged,
  full_charged: PROJECTILE.fullCharged,
} as const;

const POOL_PARK = -10000;

export class ChargedBullet extends Phaser.Physics.Arcade.Sprite {
  private readonly bulletType: ChargedBulletType;

  constructor(scene: Phaser.Scene, x: number, y: number, bulletType: ChargedBulletType) {
    super(scene, x, y, bulletType === 'charged' ? 'bullet_charged' : 'bullet_full_charged');

    this.bulletType = bulletType;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    const cfg = CFG[bulletType];
    const b = this.arcadeBody;
    b.setAllowGravity(false);
    b.setSize(cfg.bodyWidth, cfg.bodyHeight);
    b.setOffset(cfg.bodyOffsetX, cfg.bodyOffsetY);

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

    const cfg = CFG[this.bulletType];
    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(false);
    b.setVelocity(facingRight ? cfg.speed : -cfg.speed, 0);

    this.play(ANIM_KEYS[this.bulletType], true);
  }

  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }
}
