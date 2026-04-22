/**
 * MonkeyBall.ts — Big bouncy rolling projectile thrown by NuclearMonkeyBoss.
 *
 * Has gravity ON, bounceY < 1 (so bouncing decays), bounceX = 1 (keeps
 * horizontal speed so the ball ROLLS along the floor after the initial arc).
 * Self-destructs after `lifetimeMs` so pool slots don't stay tied up.
 *
 * Pool pattern matches the other projectiles — body.enable toggle + park
 * off-screen for safe reuse from inside overlap callbacks.
 */
import * as Phaser from 'phaser';
import { MONKEY_BALL } from '../config/enemyConfig';

const POOL_PARK = -10000;

export class MonkeyBall extends Phaser.Physics.Arcade.Sprite {
  private lifeMs = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'monkey_ball');

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(MONKEY_BALL.scale);
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';

    const b = this.arcadeBody;
    b.setAllowGravity(true);
    b.setBounce(MONKEY_BALL.bounceX, MONKEY_BALL.bounceY);
    b.setSize(MONKEY_BALL.body.width, MONKEY_BALL.body.height);
    b.setOffset(MONKEY_BALL.body.offsetX, MONKEY_BALL.body.offsetY);

    this.setActive(false).setVisible(false);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  fire(x: number, y: number, vx: number, vy: number): void {
    this.setActive(true).setVisible(true);
    this.setAlpha(1);
    this.lifeMs = 0;
    this.setRotation(0);

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setAllowGravity(true);
    b.setBounce(MONKEY_BALL.bounceX, MONKEY_BALL.bounceY);
    b.setVelocity(vx, vy);
  }

  /** Scene ticks this every frame to age the ball toward its self-kill. */
  update(delta: number): void {
    if (!this.active) return;
    this.lifeMs += delta;
    if (this.lifeMs >= MONKEY_BALL.lifetimeMs) this.kill();

    // Roll: angular velocity = vx / radius.  Source sprite is 64×64, so
    // the physical radius in world px is 32 × displayScale.
    const radius = 32 * MONKEY_BALL.scale;
    this.rotation += (this.arcadeBody.velocity.x / radius) * (delta / 1000);
  }

  kill(): void {
    if (!this.active) return;
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(POOL_PARK, POOL_PARK);
  }

  /** Player-contact damage path.  No visual FX — the rolling ball IS the FX. */
  impact(): void {
    this.kill();
  }
}
