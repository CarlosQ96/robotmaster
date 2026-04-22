/**
 * WalrusSnowball.ts — Pool-friendly horizontal projectile fired by WalrusBot.
 *
 * Same "toggle body.enable + park off-screen" pool pattern as Bullet.ts —
 * see the class docstring there for the rationale (avoiding
 * world.disableBody while iterating overlaps).
 *
 * Unlike the penguin's bomb, the snowball travels in a straight horizontal
 * line with gravity disabled.  The scene culls stale instances offscreen
 * via utils/outOfView cullOffscreen().
 */
import * as Phaser from 'phaser';
import { WALRUS_BOT, WALRUS_SNOWBALL } from '../config/enemyConfig';

const POOL_PARK = -10000;

export class WalrusSnowball extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'walrus_snowball');

    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Match other entities' render scale for visual consistency.
    this.setScale(WALRUS_SNOWBALL.scale);
    // Sub-pixel snap — prevents trailing-pixel line at fractional scales.
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';

    const b = this.arcadeBody;
    b.setAllowGravity(false);
    b.setSize(WALRUS_SNOWBALL.body.width, WALRUS_SNOWBALL.body.height);
    b.setOffset(WALRUS_SNOWBALL.body.offsetX, WALRUS_SNOWBALL.body.offsetY);

    // Start parked + disabled — see Bullet.ts for the pool-enable strategy.
    this.setActive(false).setVisible(false);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  /**
   * Launch from (x, y) with horizontal velocity `vx`.  Sign of `vx` encodes
   * direction — negative = leftward.  Flips the sprite to match facing.
   */
  fire(x: number, y: number, vx: number): void {
    this.setActive(true).setVisible(true);
    this.setFlipX(vx < 0 ? false : true);  // sheet faces LEFT by default

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(false);
    b.setVelocity(vx, 0);
  }

  /** Return to pool — safe to call from inside overlap callbacks. */
  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  /**
   * Spawn a short impact puff at the current position, then kill().
   * The puff re-uses `walrus_shoot_fx` (already registered as an anim by
   * WalrusBot) — reads as a matching "ice burst" both at the muzzle and
   * on impact.  Safe to call from overlap / collider callbacks.
   */
  impact(): void {
    if (!this.active) return;
    const puff = this.scene.add
      .sprite(this.x, this.y, 'walrus_shoot_fx', 0)
      .setScale(WALRUS_BOT.scale)
      .setDepth(6);
    puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
    puff.play('walrus_shoot_fx');
    this.kill();
  }

  /** Snapshot for network broadcast (host-only). */
  getSyncState() {
    return {
      type:       'walrus_snowball' as const,
      textureKey: 'walrus_snowball',
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
