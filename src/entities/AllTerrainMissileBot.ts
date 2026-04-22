/**
 * AllTerrainMissileBot.ts — Tank that patrols horizontally and lobs
 * cannon balls in a ballistic arc.
 *
 * Spritesheet: All_Terrain_Missile_Bot.png  (384 × 40 px | 8 frames × 48 × 40)
 *   0-3 — walk (tread loop; sprite faces LEFT by default)
 *   4-7 — turn pivot (one-shot); plays before the sprite's flipX toggles
 *         at a patrol boundary.
 *
 * Behaviour:
 *   - Patrols between patrolLeft / patrolRight.  On hitting either edge:
 *       1. Stop moving (isTurning=true gates patrol).
 *       2. Play the turn anim.
 *       3. ANIMATION_COMPLETE listener flips the sprite, clears the gate,
 *          and resumes the walk loop.
 *   - On aggro + cooldown, fires a cannon ball in an arc from the cannon
 *     muzzle on top of the tank.  Fires in the current facing direction;
 *     the arc does the aiming.
 *
 * Events emitted:
 *   'atmb-shoot' → AtmbShootEvent { x, y, vx, vy }
 */
import * as Phaser from 'phaser';
import { Enemy, EnemyState } from './Enemy';
import { ATMB_BOT } from '../config/enemyConfig';

export interface AtmbShootEvent {
  x:  number;
  y:  number;
  vx: number;
  vy: number;
}

const ANIM = {
  WALK: 'atmb_walk',
  TURN: 'atmb_turn',
} as const;

export class AllTerrainMissileBot extends Enemy {
  /**
   * True while the turn animation is playing.  `patrol()` checks this to
   * freeze horizontal velocity; the ANIMATION_COMPLETE listener clears it.
   */
  private isTurning = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'atmb_bot', {
      speed:            ATMB_BOT.speed,
      aggroRadius:      ATMB_BOT.aggroRadius,
      attackCooldownMs: ATMB_BOT.attackCooldownMs,
      health:           ATMB_BOT.health,
      contactDamage:    ATMB_BOT.contactDamage,
    });
    this.setScale(ATMB_BOT.scale);
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  protected setupBody(): void {
    this.arcadeBody.setSize(ATMB_BOT.body.width, ATMB_BOT.body.height);
    this.arcadeBody.setOffset(ATMB_BOT.body.offsetX, ATMB_BOT.body.offsetY);
  }

  // ── Animations ───────────────────────────────────────────────────────────

  protected buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = ATMB_BOT;

    if (!anims.exists(ANIM.WALK)) {
      anims.create({
        key:       ANIM.WALK,
        frames:    anims.generateFrameNumbers('atmb_bot', {
          start: def.walk.start, end: def.walk.end,
        }),
        frameRate: def.walk.frameRate,
        repeat:    -1,
      });
    }

    if (!anims.exists(ANIM.TURN)) {
      anims.create({
        key:       ANIM.TURN,
        frames:    anims.generateFrameNumbers('atmb_bot', {
          start: def.turn.start, end: def.turn.end,
        }),
        frameRate: def.turn.frameRate,
        repeat:    0,
      });
    }
  }

  // ── Animation listeners ──────────────────────────────────────────────────

  protected setupAnimListeners(): void {
    // Turn anim complete → flip facing + resume walking.
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.TURN}`,
      () => {
        this.setFacing(!this.facingRight);
        this.isTurning = false;
        this.play(ANIM.WALK, true);
      },
    );
  }

  // ── Attack ───────────────────────────────────────────────────────────────
  // We use the Enemy base's brief 'attack' state: doAttack fires the shot
  // and immediately transitions back to 'walk'.  No separate attack anim —
  // the tank keeps its walk pose and the cannon visually does the work.

  protected doAttack(): void {
    const dirSign = this.facingRight ? 1 : -1;
    const spawnX  = this.x + dirSign * ATMB_BOT.shootOffsetX * ATMB_BOT.scale;
    const spawnY  = this.y + ATMB_BOT.shootOffsetY * ATMB_BOT.scale;
    const vx      = dirSign * ATMB_BOT.shootVelX;
    const vy      = ATMB_BOT.shootVelY;

    this.emit('atmb-shoot', { x: spawnX, y: spawnY, vx, vy } as AtmbShootEvent);

    // Snap back to 'walk' — the tank doesn't freeze during a shot.
    this.transition('walk');
  }

  // ── Patrol — walk / turn-at-edge / flip ──────────────────────────────────

  protected patrol(): void {
    const body = this.arcadeBody;
    if (this.isTurning) {
      body.setVelocityX(0);
      return;
    }

    if (this.facingRight) {
      body.setVelocityX(this.cfg.speed);
      if (this.x >= this.patrolRight) this.beginTurn();
    } else {
      body.setVelocityX(-this.cfg.speed);
      if (this.x <= this.patrolLeft) this.beginTurn();
    }
  }

  private beginTurn(): void {
    this.isTurning = true;
    this.arcadeBody.setVelocityX(0);
    this.play(ANIM.TURN, true);
  }

  // ── State → anim key ─────────────────────────────────────────────────────
  // 'attack' returns null — doAttack() fires the shot and transitions back
  // to 'walk' in the same tick, so no attack animation is needed.

  protected getAnimKey(state: EnemyState): string | null {
    switch (state) {
      case 'idle':   return ANIM.WALK;
      case 'walk':   return ANIM.WALK;
      case 'attack': return null;
      default:       return null;
    }
  }
}
