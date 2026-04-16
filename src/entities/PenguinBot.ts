/**
 * PenguinBot.ts — Penguin enemy that throws bombs at the player.
 *
 * Spritesheet: Penguin_Bot.png
 *   480 × 40 px | 12 frames | frameWidth: 40 | frameHeight: 40
 *   0-4  : walk  (left-facing by default; 5 frames)
 *   5-7  : attack (grab ball → balance → throw)
 *   8-11 : reserved
 *
 * Events emitted (scene listens and spawns projectile):
 *   'penguin-throw'  →  PenguinThrowEvent { x, y, vx, vy }
 *                       fired on frame 7 (throw pose) with ballistic velocity
 *                       pre-calculated to arc toward the player's position.
 *
 * Behaviour:
 *   - Chases the player when playerRef is set (overrides bounce patrol).
 *   - Stops, faces, and attacks when player is within aggroRadius and cooldown is clear.
 *   - After the attack animation completes, resumes chasing.
 */
import * as Phaser from 'phaser';
import { Enemy, EnemyState } from './Enemy';
import { PENGUIN_BOT, PENGUIN_BOMB } from '../config/enemyConfig';
import { PHYSICS } from '../config/gameConfig';

export interface PenguinThrowEvent {
  x:  number;
  y:  number;
  vx: number;   // pre-calculated horizontal velocity for the bomb
  vy: number;   // pre-calculated vertical velocity for the bomb
}

const ANIM = {
  WALK:   'penguin_walk',
  ATTACK: 'penguin_attack',
} as const;

export class PenguinBot extends Enemy {

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'penguin_bot', {
      speed:            PENGUIN_BOT.speed,
      aggroRadius:      PENGUIN_BOT.aggroRadius,
      attackCooldownMs: PENGUIN_BOT.attackCooldownMs,
      health:           PENGUIN_BOT.health,
    });
    this.setScale(PENGUIN_BOT.scale);
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  protected setupBody(): void {
    this.arcadeBody.setSize(PENGUIN_BOT.body.width, PENGUIN_BOT.body.height);
    this.arcadeBody.setOffset(PENGUIN_BOT.body.offsetX, PENGUIN_BOT.body.offsetY);
  }

  // ── Animations ───────────────────────────────────────────────────────────

  protected buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = PENGUIN_BOT;

    if (!anims.exists(ANIM.WALK)) {
      anims.create({
        key:       ANIM.WALK,
        frames:    anims.generateFrameNumbers('penguin_bot', {
          start: def.walk.start,
          end:   def.walk.end,
        }),
        frameRate: def.walk.frameRate,
        repeat:    -1,
      });
    }

    if (!anims.exists(ANIM.ATTACK)) {
      anims.create({
        key:       ANIM.ATTACK,
        frames:    anims.generateFrameNumbers('penguin_bot', {
          start: def.attack.start,
          end:   def.attack.end,
        }),
        frameRate: def.attack.frameRate,
        repeat:    0,
      });
    }
  }

  // ── Animation listeners ──────────────────────────────────────────────────

  protected setupAnimListeners(): void {
    // Attack animation complete → resume chasing
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.ATTACK}`,
      () => this.transition('walk'),
    );

    // Fire the throw event on the exact "throw" frame (frame 8) with
    // ballistic velocity pre-aimed at the player's current position.
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: unknown, frame: Phaser.Animations.AnimationFrame) => {
        if (
          this.enemyState === 'attack' &&
          Number(frame.frame.name) === PENGUIN_BOT.throwFrame
        ) {
          const spawnX = this.x + (this.facingRight
            ?  PENGUIN_BOT.throwOffsetX
            : -PENGUIN_BOT.throwOffsetX);
          const spawnY = this.y + PENGUIN_BOT.throwOffsetY;
          const { vx, vy } = this.calcThrowVelocity(spawnX, spawnY);

          this.emit('penguin-throw', { x: spawnX, y: spawnY, vx, vy } as PenguinThrowEvent);
        }
      },
    );
  }

  // ── Attack ───────────────────────────────────────────────────────────────

  protected doAttack(): void {
    // Orient toward the player before the throw animation begins
    if (this.playerRef) {
      this.setFacing(this.playerRef.x > this.x);
    }
    this.arcadeBody.setVelocityX(0);
  }

  // ── Patrol — chase the player ─────────────────────────────────────────────
  /**
   * Override: move directly toward the player whenever playerRef is set.
   * Falls back to the default bounce patrol when no player is assigned.
   */
  protected patrol(): void {
    if (this.playerRef) {
      const goRight = this.playerRef.x > this.x;
      this.setFacing(goRight);
      this.arcadeBody.setVelocityX(goRight ? this.cfg.speed : -this.cfg.speed);
    } else {
      super.patrol();
    }
  }

  // ── Anim key map ─────────────────────────────────────────────────────────

  protected getAnimKey(state: EnemyState): string | null {
    switch (state) {
      case 'idle':   return ANIM.WALK;
      case 'walk':   return ANIM.WALK;
      case 'attack': return ANIM.ATTACK;
      default:       return null;
    }
  }

  // ── Ballistic aim ─────────────────────────────────────────────────────────
  /**
   * Calculate throw velocity to arc the bomb so it lands at or near the
   * player's current position.
   *
   * Horizontal component uses a fixed speed (PENGUIN_BOMB.throwVelX) so
   * the bomb always travels at a predictable rate; vertical component is
   * derived from the projectile motion equations:
   *
   *   t  = |dx| / hSpeed
   *   vy = (dy - 0.5 * g * t²) / t
   *
   * Result is clamped to keep the arc visible and non-degenerate.
   */
  private calcThrowVelocity(spawnX: number, spawnY: number): { vx: number; vy: number } {
    const hSpeed = PENGUIN_BOMB.throwVelX;
    const g      = PHYSICS.gravityY;

    if (!this.playerRef) {
      return {
        vx: this.facingRight ? hSpeed : -hSpeed,
        vy: PENGUIN_BOMB.throwVelY,
      };
    }

    const dx = this.playerRef.x - spawnX;
    const dy = this.playerRef.y - spawnY;

    const vx  = dx >= 0 ? hSpeed : -hSpeed;
    const t   = Math.max(0.1, Math.abs(dx) / hSpeed);
    const vy  = (dy - 0.5 * g * t * t) / t;

    return {
      vx,
      // Clamp: never throw too flat (≥ -80) or so fast it's unfair (≤ -700)
      vy: Math.max(-700, Math.min(-80, vy)),
    };
  }
}
