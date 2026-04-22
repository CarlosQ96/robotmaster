/**
 * RollerBot.ts — Ground ball that rolls, pops open to shoot, then tucks
 * back in to roll again.
 *
 * Spritesheet: Roller_Bot.png  (528 × 40 px | 11 frames × 48 × 40)
 *   0-7  : rolling ball (8-frame loop)
 *   8-10 : opening up (3 frames forward, then reversed via yoyo to close)
 *
 * Behaviour:
 *   - walk state → plays the rolling loop and uses the default bounce patrol.
 *   - When the player is within aggroRadius and the attack cooldown clears,
 *     the bot transitions to 'attack' — velocity zeros, open anim plays
 *     (8→9→10→10→9→8 via Phaser yoyo).  On frame 10 the bot emits
 *     'roller-shoot'; ANIMATION_COMPLETE then transitions back to 'walk'
 *     and rolling resumes.
 *   - `shotFired` gates frame 10: with yoyo Phaser renders frame 10 twice
 *     (apex + first reversed frame) so we'd otherwise fire two bullets.
 *
 * Events emitted:
 *   'roller-shoot' → RollerShootEvent { x, y, vx, facingRight }
 */
import * as Phaser from 'phaser';
import { Enemy, EnemyState } from './Enemy';
import { ROLLER_BOT, ROLLER_BULLET } from '../config/enemyConfig';

export interface RollerShootEvent {
  x: number;
  y: number;
  vx: number;
  facingRight: boolean;
}

const ANIM = {
  ROLL:   'roller_roll',
  ATTACK: 'roller_attack',
  BULLET: 'roller_bullet_spin',
} as const;

export class RollerBot extends Enemy {
  /** One-shot gate so the yoyo'd apex (frame 10 renders twice) fires once. */
  private shotFired = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'roller_bot', {
      speed:            ROLLER_BOT.speed,
      aggroRadius:      ROLLER_BOT.aggroRadius,
      attackCooldownMs: ROLLER_BOT.attackCooldownMs,
      health:           ROLLER_BOT.health,
      contactDamage:    ROLLER_BOT.contactDamage,
    });
    this.setScale(ROLLER_BOT.scale);
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  protected setupBody(): void {
    this.arcadeBody.setSize(ROLLER_BOT.body.width, ROLLER_BOT.body.height);
    this.arcadeBody.setOffset(ROLLER_BOT.body.offsetX, ROLLER_BOT.body.offsetY);
  }

  // ── Animations ───────────────────────────────────────────────────────────

  protected buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = ROLLER_BOT;

    if (!anims.exists(ANIM.ROLL)) {
      anims.create({
        key:       ANIM.ROLL,
        frames:    anims.generateFrameNumbers('roller_bot', {
          start: def.roll.start, end: def.roll.end,
        }),
        frameRate: def.roll.frameRate,
        repeat:    -1,
      });
    }

    // Attack uses yoyo: plays 8→9→10 then reversed 10→9→8 as one unit.
    // Phaser renders the apex frame twice (once forward, once at the start
    // of the reverse) — the shotFired gate keeps us from firing twice.
    if (!anims.exists(ANIM.ATTACK)) {
      anims.create({
        key:       ANIM.ATTACK,
        frames:    anims.generateFrameNumbers('roller_bot', {
          start: def.attack.start, end: def.attack.end,
        }),
        frameRate: def.attack.frameRate,
        repeat:    0,
        yoyo:      true,
      });
    }

    // Bullet spin — registered here (instead of on RollerBullet) so all
    // roller-related anims live with the bot definition.  Idempotent.
    if (!anims.exists(ANIM.BULLET)) {
      anims.create({
        key:       ANIM.BULLET,
        frames:    anims.generateFrameNumbers('roller_bullet', {
          start: ROLLER_BULLET.anims.spin.start, end: ROLLER_BULLET.anims.spin.end,
        }),
        frameRate: ROLLER_BULLET.anims.spin.frameRate,
        repeat:    -1,
      });
    }
  }

  // ── Animation listeners ──────────────────────────────────────────────────

  protected setupAnimListeners(): void {
    // Attack anim complete (post-yoyo return to frame 8) → resume rolling.
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.ATTACK}`,
      () => this.transition('walk'),
    );

    // Fire on the apex frame.  Offset is source pixels → scale for render.
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: unknown, frame: Phaser.Animations.AnimationFrame) => {
        if (
          this.enemyState === 'attack' &&
          !this.shotFired &&
          Number(frame.frame.name) === ROLLER_BOT.shootFrame
        ) {
          this.shotFired = true;
          const dirSign = this.facingRight ? 1 : -1;
          const spawnX  = this.x + dirSign * ROLLER_BOT.shootOffsetX * ROLLER_BOT.scale;
          const spawnY  = this.y + ROLLER_BOT.shootOffsetY * ROLLER_BOT.scale;
          const vx      = dirSign * ROLLER_BULLET.speed;

          this.emit('roller-shoot', {
            x: spawnX, y: spawnY, vx, facingRight: this.facingRight,
          } as RollerShootEvent);
        }
      },
    );
  }

  // ── Attack entry — stop rolling, orient toward player, reset shot gate ───

  protected doAttack(): void {
    this.shotFired = false;
    if (this.playerRef) {
      this.setFacing(this.playerRef.x > this.x);
    }
    this.arcadeBody.setVelocityX(0);
  }

  // ── State → anim key ─────────────────────────────────────────────────────

  protected getAnimKey(state: EnemyState): string | null {
    switch (state) {
      case 'idle':   return ANIM.ROLL;
      case 'walk':   return ANIM.ROLL;
      case 'attack': return ANIM.ATTACK;
      default:       return null;
    }
  }
}
