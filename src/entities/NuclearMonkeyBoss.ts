/**
 * NuclearMonkeyBoss.ts — Stationary boss that throws a bouncing monkey
 * ball at the player.
 *
 * Spritesheet: Nuclear_Monkey_Boss.png  (608 × 160 px | 4 frames × 152 × 160)
 *   0    — idle (single frame)
 *   1-3  — attack (grab → stance → throw).  Monkey ball spawns on frame 3.
 *
 * Behaviour:
 *   - `speed = 0`, gravity disabled, body immovable — the boss never moves.
 *   - Cooldown expires → attack anim plays, on frame 3 the scene spawns a
 *     monkey ball, ANIMATION_COMPLETE returns to idle.
 *   - Faces the player on each attack entry.
 *
 * Events emitted:
 *   'monkey-throw' → MonkeyThrowEvent { x, y, vx, vy }
 */
import * as Phaser from 'phaser';
import { Enemy, EnemyState } from './Enemy';
import { NUCLEAR_MONKEY } from '../config/enemyConfig';

export interface MonkeyThrowEvent {
  x:  number;
  y:  number;
  vx: number;
  vy: number;
}

const ANIM = {
  IDLE:   'monkey_idle',
  ATTACK: 'monkey_attack',
} as const;

export class NuclearMonkeyBoss extends Enemy {
  /** One-shot gate so frame 3 fires a single ball per attack cycle. */
  private shotFired = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'nuclear_monkey_boss', {
      speed:            NUCLEAR_MONKEY.speed,
      aggroRadius:      NUCLEAR_MONKEY.aggroRadius,
      attackCooldownMs: NUCLEAR_MONKEY.attackCooldownMs,
      health:           NUCLEAR_MONKEY.health,
      contactDamage:    NUCLEAR_MONKEY.contactDamage,
      hurtKnockback:    NUCLEAR_MONKEY.hurtKnockback,
    });
    this.setScale(NUCLEAR_MONKEY.scale);

    // Stationary: disable gravity + lock body immovable.
    this.arcadeBody.setAllowGravity(false);
    this.arcadeBody.setImmovable(true);
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  protected setupBody(): void {
    this.arcadeBody.setSize(NUCLEAR_MONKEY.body.width, NUCLEAR_MONKEY.body.height);
    this.arcadeBody.setOffset(NUCLEAR_MONKEY.body.offsetX, NUCLEAR_MONKEY.body.offsetY);
  }

  // ── Animations ───────────────────────────────────────────────────────────

  protected buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = NUCLEAR_MONKEY;

    if (!anims.exists(ANIM.IDLE)) {
      anims.create({
        key:       ANIM.IDLE,
        frames:    anims.generateFrameNumbers('nuclear_monkey_boss', {
          start: def.idle.start, end: def.idle.end,
        }),
        frameRate: def.idle.frameRate,
        repeat:    -1,
      });
    }

    if (!anims.exists(ANIM.ATTACK)) {
      anims.create({
        key:       ANIM.ATTACK,
        frames:    anims.generateFrameNumbers('nuclear_monkey_boss', {
          start: def.attack.start, end: def.attack.end,
        }),
        frameRate: def.attack.frameRate,
        repeat:    0,
      });
    }
  }

  // ── Animation listeners ──────────────────────────────────────────────────

  protected setupAnimListeners(): void {
    // Attack complete → back to idle.
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.ATTACK}`,
      () => {
        this.transition('walk');
      },
    );

    // Throw on the configured peak frame (gated so it fires once).
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: unknown, frame: Phaser.Animations.AnimationFrame) => {
        if (
          this.enemyState !== 'attack' ||
          this.shotFired ||
          Number(frame.frame.name) !== NUCLEAR_MONKEY.throwFrame
        ) return;

        this.shotFired = true;
        const dirSign = this.facingRight ? 1 : -1;
        const spawnX = this.x + dirSign * NUCLEAR_MONKEY.throwOffsetX * NUCLEAR_MONKEY.scale;
        const spawnY = this.y + NUCLEAR_MONKEY.throwOffsetY * NUCLEAR_MONKEY.scale;
        const vx     = dirSign * NUCLEAR_MONKEY.throwVelX;
        const vy     = NUCLEAR_MONKEY.throwVelY;

        this.emit('monkey-throw', { x: spawnX, y: spawnY, vx, vy } as MonkeyThrowEvent);
      },
    );
  }

  // ── Attack entry — face player, reset shot gate ──────────────────────────

  protected doAttack(): void {
    this.shotFired = false;
    if (this.playerRef) this.setFacing(this.playerRef.x > this.x);
    this.arcadeBody.setVelocity(0, 0);
  }

  // ── Patrol (no-op — boss doesn't move) ───────────────────────────────────

  protected patrol(): void {
    this.arcadeBody.setVelocity(0, 0);
    if (this.playerRef) this.setFacing(this.playerRef.x > this.x);
  }

  // ── State → anim key ─────────────────────────────────────────────────────

  protected getAnimKey(state: EnemyState): string | null {
    switch (state) {
      case 'idle':   return ANIM.IDLE;
      case 'walk':   return ANIM.IDLE;
      case 'attack': return ANIM.ATTACK;
      default:       return null;
    }
  }
}
