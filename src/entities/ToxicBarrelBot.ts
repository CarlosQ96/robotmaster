/**
 * ToxicBarrelBot.ts — Stationary turret that fires toxic goop.  Alternates
 * between a LOWER-hatch attack and an UPPER-hatch attack; only the upper
 * cycle exposes the bot to damage.
 *
 * Spritesheet: Toxic_Barrel_Bot.png  (264 × 48 px | 11 frames × 24 × 48)
 *   0       — closed / armored (idle between attacks; invulnerable)
 *   1-5     — LOWER hatch cycle (open 1-4, close 5); shoots on frame 3
 *   6-10    — UPPER hatch cycle (yoyo'd, 6→10→6); shoots on frame 10.
 *             VULNERABILITY WINDOW — takeDamage only succeeds here.
 *
 * Behaviour:
 *   - speed = 0 (no patrol); the barrel doesn't move.
 *   - Turns to face the player on each attack entry.
 *   - Cooldown expires → alternate lower / upper attacks forever.
 *
 * Events emitted:
 *   'toxic-shoot' → ToxicShootEvent { x, y, vx, port }
 *     port = 'lower' | 'upper' (consumed by combatSetup to spawn the shot)
 */
import * as Phaser from 'phaser';
import { Enemy, EnemyState } from './Enemy';
import { TOXIC_BARREL_BOT, TOXIC_GOOP } from '../config/enemyConfig';

export interface ToxicShootEvent {
  x: number;
  y: number;
  vx: number;
  port: 'lower' | 'upper';
}

const ANIM = {
  CLOSED: 'toxic_closed',
  LOWER:  'toxic_lower',
  UPPER:  'toxic_upper',
  GOOP:   'toxic_goop_wobble',
} as const;

export class ToxicBarrelBot extends Enemy {
  /** Which hatch the NEXT attack will open.  Toggled after each fire. */
  private nextAttack: 'lower' | 'upper' = 'lower';
  /** Which hatch is currently open (valid only while state === 'attack'). */
  private currentAttack: 'lower' | 'upper' = 'lower';
  /** One-shot gate — upper yoyo renders frame 10 twice; we fire once. */
  private shotFired = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'toxic_barrel_bot', {
      speed:            TOXIC_BARREL_BOT.speed,
      aggroRadius:      TOXIC_BARREL_BOT.aggroRadius,
      attackCooldownMs: TOXIC_BARREL_BOT.attackCooldownMs,
      health:           TOXIC_BARREL_BOT.health,
      contactDamage:    TOXIC_BARREL_BOT.contactDamage,
      hurtKnockback:    TOXIC_BARREL_BOT.hurtKnockback,
    });
    this.setScale(TOXIC_BARREL_BOT.scale);
    // Stationary turret — disable gravity and lock the body so tile separation
    // (or stray collider nudges) can never drift it off the authored spot.
    this.arcadeBody.setAllowGravity(false);
    this.arcadeBody.setImmovable(true);
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  protected setupBody(): void {
    this.arcadeBody.setSize(TOXIC_BARREL_BOT.body.width, TOXIC_BARREL_BOT.body.height);
    this.arcadeBody.setOffset(TOXIC_BARREL_BOT.body.offsetX, TOXIC_BARREL_BOT.body.offsetY);
  }

  // ── Animations ───────────────────────────────────────────────────────────

  protected buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = TOXIC_BARREL_BOT;

    if (!anims.exists(ANIM.CLOSED)) {
      anims.create({
        key:       ANIM.CLOSED,
        frames:    anims.generateFrameNumbers('toxic_barrel_bot', {
          start: def.closed.start, end: def.closed.end,
        }),
        frameRate: def.closed.frameRate,
        repeat:    -1,
      });
    }

    if (!anims.exists(ANIM.LOWER)) {
      anims.create({
        key:       ANIM.LOWER,
        frames:    anims.generateFrameNumbers('toxic_barrel_bot', {
          start: def.lower.start, end: def.lower.end,
        }),
        frameRate: def.lower.frameRate,
        repeat:    0,
      });
    }

    // Upper cycle yoyos: 6→10→6 — the hatch opens and closes in one anim.
    // Frame 10 renders twice (apex + first reversed frame) so the
    // shotFired flag gates the bullet emission to one per cycle.
    if (!anims.exists(ANIM.UPPER)) {
      anims.create({
        key:       ANIM.UPPER,
        frames:    anims.generateFrameNumbers('toxic_barrel_bot', {
          start: def.upper.start, end: def.upper.end,
        }),
        frameRate: def.upper.frameRate,
        repeat:    0,
        yoyo:      true,
      });
    }

    if (!anims.exists(ANIM.GOOP)) {
      anims.create({
        key:       ANIM.GOOP,
        frames:    anims.generateFrameNumbers('toxic_goop', {
          start: TOXIC_GOOP.anims.wobble.start, end: TOXIC_GOOP.anims.wobble.end,
        }),
        frameRate: TOXIC_GOOP.anims.wobble.frameRate,
        repeat:    -1,
      });
    }
  }

  // ── Animation listeners ──────────────────────────────────────────────────

  protected setupAnimListeners(): void {
    // Either attack anim complete → back to closed.
    const onDone = () => this.transition('walk');
    this.on(`${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.LOWER}`, onDone);
    this.on(`${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.UPPER}`, onDone);

    // Fire on the configured apex frame for the active hatch.
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: unknown, frame: Phaser.Animations.AnimationFrame) => {
        if (this.enemyState !== 'attack' || this.shotFired) return;
        const fn = Number(frame.frame.name);
        const triggerFrame = this.currentAttack === 'lower'
          ? TOXIC_BARREL_BOT.lowerShootFrame
          : TOXIC_BARREL_BOT.upperShootFrame;
        if (fn !== triggerFrame) return;

        this.shotFired = true;
        const dirSign = this.facingRight ? 1 : -1;
        const ox = this.currentAttack === 'lower'
          ? TOXIC_BARREL_BOT.lowerShootOffsetX
          : TOXIC_BARREL_BOT.upperShootOffsetX;
        const oy = this.currentAttack === 'lower'
          ? TOXIC_BARREL_BOT.lowerShootOffsetY
          : TOXIC_BARREL_BOT.upperShootOffsetY;
        const spawnX = this.x + dirSign * ox * TOXIC_BARREL_BOT.scale;
        const spawnY = this.y + oy * TOXIC_BARREL_BOT.scale;
        const vx     = dirSign * TOXIC_GOOP.speed;

        this.emit('toxic-shoot', {
          x: spawnX, y: spawnY, vx, port: this.currentAttack,
        } as ToxicShootEvent);
      },
    );
  }

  // ── Attack entry — pick hatch, face player, play the right anim ──────────
  //
  // getAnimKey('attack') returns null so Enemy.transition doesn't pick an
  // animation for us; doAttack() has full control over which hatch opens.

  protected doAttack(): void {
    this.shotFired = false;
    this.currentAttack = this.nextAttack;
    this.nextAttack = this.nextAttack === 'lower' ? 'upper' : 'lower';

    if (this.playerRef) this.setFacing(this.playerRef.x > this.x);
    this.arcadeBody.setVelocityX(0);

    this.play(this.currentAttack === 'lower' ? ANIM.LOWER : ANIM.UPPER, true);
  }

  // ── Patrol (no-op — stationary turret) ───────────────────────────────────

  protected patrol(): void {
    this.arcadeBody.setVelocityX(0);
    // Face the player even when idle — makes the next attack aim correctly
    // without a one-cycle delay.
    if (this.playerRef) this.setFacing(this.playerRef.x > this.x);
  }

  // ── Damage gating — only vulnerable during UPPER attack ──────────────────
  /**
   * Upper hatch open → vulnerable; everything else → armored (damage
   * silently dropped).  Matches the brief: "can be damaged only in the
   * upper part".  We treat the upper-attack window as the hurtbox.
   */
  takeDamage(amount: number, sourceX?: number): void {
    const vulnerable =
      this.enemyState === 'attack' && this.currentAttack === 'upper';
    if (!vulnerable) {
      // Optional visual: brief tint to show the hit was absorbed.  Keep
      // it lightweight — just a 60ms gray fill.
      this.setTintMode(Phaser.TintModes.FILL);
      this.setTint(0x666666);
      this.scene.time.delayedCall(60, () => {
        if (this.enemyState === 'dead') return;
        this.setTintMode(Phaser.TintModes.MULTIPLY);
        this.clearTint();
      });
      return;
    }
    super.takeDamage(amount, sourceX);
  }

  // ── State → anim key ─────────────────────────────────────────────────────

  protected getAnimKey(state: EnemyState): string | null {
    switch (state) {
      case 'idle':
      case 'walk':   return ANIM.CLOSED;
      case 'attack': return null;      // doAttack plays the chosen hatch anim
      default:       return null;
    }
  }
}
