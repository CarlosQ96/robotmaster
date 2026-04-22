/**
 * WalrusBot.ts — Walrus enemy that fires a horizontal snowball at the player.
 *
 * Spritesheet: Walrus_Bot.png  (512 × 40 px | 8 frames × 64 × 40 px)
 *   0       — idle (single hold frame)
 *   1-3     — shoot (snowball spawns on the middle frame)
 *   4-7     — walk loop (propulsor trail behind the body)
 *
 * Muzzle flash: Walrus_Bot_Shoot_FX.png  (24 × 16 px | 3 frames × 8 × 16)
 *   Plays once on the shoot frame at the mouth position, then destroys itself.
 *
 * Behaviour:
 *   - Chases the player when playerRef is set (overrides bounce patrol).
 *   - Stops, faces, and shoots when player is within aggroRadius and cooldown clears.
 *   - Resumes chasing after the attack animation completes.
 *
 * Events emitted (scene spawns the snowball + flash):
 *   'walrus-shoot' → WalrusShootEvent { x, y, vx }
 *     fired on the `shootFrame` of the attack animation.
 *     vx already encodes the facing direction (negative = leftward).
 */
import * as Phaser from 'phaser';
import { Enemy, EnemyState } from './Enemy';
import { WALRUS_BOT, WALRUS_SNOWBALL } from '../config/enemyConfig';

export interface WalrusShootEvent {
  x:  number;
  y:  number;
  vx: number;
  /** Optional hint for the flash sprite — lets the scene flip the muzzle glyph. */
  facingRight: boolean;
}

const ANIM = {
  IDLE:   'walrus_idle',
  ATTACK: 'walrus_attack',
  WALK:   'walrus_walk',
  FX:     'walrus_shoot_fx',
} as const;

export class WalrusBot extends Enemy {

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'walrus_bot', {
      speed:            WALRUS_BOT.speed,
      aggroRadius:      WALRUS_BOT.aggroRadius,
      attackCooldownMs: WALRUS_BOT.attackCooldownMs,
      health:           WALRUS_BOT.health,
      contactDamage:    WALRUS_BOT.contactDamage,
    });
    this.setScale(WALRUS_BOT.scale);
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  protected setupBody(): void {
    this.arcadeBody.setSize(WALRUS_BOT.body.width, WALRUS_BOT.body.height);
    this.arcadeBody.setOffset(WALRUS_BOT.body.offsetX, WALRUS_BOT.body.offsetY);
  }

  // ── Animations ───────────────────────────────────────────────────────────

  protected buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = WALRUS_BOT;

    if (!anims.exists(ANIM.IDLE)) {
      anims.create({
        key:       ANIM.IDLE,
        frames:    anims.generateFrameNumbers('walrus_bot', {
          start: def.idle.start, end: def.idle.end,
        }),
        frameRate: def.idle.frameRate,
        repeat:    -1,
      });
    }

    if (!anims.exists(ANIM.WALK)) {
      anims.create({
        key:       ANIM.WALK,
        frames:    anims.generateFrameNumbers('walrus_bot', {
          start: def.walk.start, end: def.walk.end,
        }),
        frameRate: def.walk.frameRate,
        repeat:    -1,
      });
    }

    if (!anims.exists(ANIM.ATTACK)) {
      anims.create({
        key:       ANIM.ATTACK,
        frames:    anims.generateFrameNumbers('walrus_bot', {
          start: def.attack.start, end: def.attack.end,
        }),
        frameRate: def.attack.frameRate,
        repeat:    0,
      });
    }

    // Muzzle-flash anim — registered once; the scene plays it on a throwaway
    // sprite spawned at the mouth position.  Kept here (rather than in the
    // scene) so all walrus-related assets are wired from one place.
    if (!anims.exists(ANIM.FX)) {
      anims.create({
        key:       ANIM.FX,
        frames:    anims.generateFrameNumbers('walrus_shoot_fx', {
          start: 0, end: WALRUS_BOT.shootFx.frames - 1,
        }),
        frameRate: WALRUS_BOT.shootFx.frameRate,
        repeat:    0,
      });
    }
  }

  // ── Animation listeners ──────────────────────────────────────────────────

  protected setupAnimListeners(): void {
    // Attack anim complete → resume walking / chasing.
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.ATTACK}`,
      () => this.transition('walk'),
    );

    // Snowball spawn — fire on the exact shoot frame.  Offsets are in
    // SOURCE pixels; scale so the projectile leaves the rendered mouth.
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: unknown, frame: Phaser.Animations.AnimationFrame) => {
        if (
          this.enemyState === 'attack' &&
          Number(frame.frame.name) === WALRUS_BOT.shootFrame
        ) {
          const dirSign = this.facingRight ? 1 : -1;
          const spawnX  = this.x + dirSign * WALRUS_BOT.shootOffsetX * WALRUS_BOT.scale;
          const spawnY  = this.y + WALRUS_BOT.shootOffsetY * WALRUS_BOT.scale;
          const vx      = dirSign * WALRUS_SNOWBALL.speed;

          this.emit('walrus-shoot', {
            x: spawnX,
            y: spawnY,
            vx,
            facingRight: this.facingRight,
          } as WalrusShootEvent);
        }
      },
    );
  }

  // ── Attack entry — stop, face player ─────────────────────────────────────

  protected doAttack(): void {
    if (this.playerRef) {
      this.setFacing(this.playerRef.x > this.x);
    }
    this.arcadeBody.setVelocityX(0);
  }

  // ── Chase the player (same pattern as PenguinBot) ────────────────────────

  protected patrol(): void {
    if (this.playerRef) {
      const dx = this.playerRef.x - this.x;
      const CHASE_DEADZONE = 8;
      if (Math.abs(dx) < CHASE_DEADZONE) {
        this.arcadeBody.setVelocityX(0);
        return;
      }
      const goRight = dx > 0;
      this.setFacing(goRight);
      this.arcadeBody.setVelocityX(goRight ? this.cfg.speed : -this.cfg.speed);
    } else {
      super.patrol();
    }
  }

  // ── State → anim key ─────────────────────────────────────────────────────

  protected getAnimKey(state: EnemyState): string | null {
    switch (state) {
      case 'idle':   return ANIM.IDLE;
      case 'walk':   return ANIM.WALK;
      case 'attack': return ANIM.ATTACK;
      default:       return null;
    }
  }
}
