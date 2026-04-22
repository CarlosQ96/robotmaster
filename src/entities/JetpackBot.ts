/**
 * JetpackBot.ts — Hovering aerial enemy that locks onto the player and fires
 * aimed icicle projectiles.
 *
 * Spritesheet: Jetpack_Ice_Blaster_Bot.png  (240 × 40 px | 6 frames × 40 × 40)
 *   0-1 : aim SHALLOW (arm angled slightly downward — player roughly level)
 *   2-3 : aim DEEP    (arm angled ~45° — player well below)
 *   4-5 : aim DOWN    (arm pointing straight down — player directly below)
 *
 * Each pair is a 2-frame loop that doubles as the idle pose for that aim.
 * The bot picks the right loop every frame based on the angle to the player,
 * and fires on cooldown.  Projectile + muzzle-flash sheets are 3-frame
 * sprites indexed 0/1/2 in the same SHALLOW/DEEP/DOWN order.
 *
 * Behaviour:
 *   - Gravity disabled — hovers via manual velocity.
 *   - When aggroed, steers toward (player.x, player.y + hoverOffsetY) —
 *     i.e. hovers ABOVE the player with soft proportional thrust.
 *   - Fires on attackCooldownMs; projectile velocity matches the aim angle.
 *
 * Events emitted (scene spawns projectile + flash):
 *   'jetpack-shoot' → JetpackShootEvent { x, y, vx, vy, angleIdx, facingRight }
 */
import * as Phaser from 'phaser';
import { Enemy, EnemyState } from './Enemy';
import { JETPACK_BOT, JETPACK_BULLET } from '../config/enemyConfig';

/** Aim-angle index — maps 1:1 to the bullet + flash spritesheet frames. */
export type JetpackAngleIdx = 0 | 1 | 2;   // 0 = shallow, 1 = deep, 2 = down

export interface JetpackShootEvent {
  x:  number;
  y:  number;
  vx: number;
  vy: number;
  /** Frame index on both `jetpack_bullet` and `jetpack_shoot_fx` sheets. */
  angleIdx:    JetpackAngleIdx;
  facingRight: boolean;
}

const ANIM = {
  AIM_SHALLOW: 'jetpack_aim_shallow',
  AIM_DEEP:    'jetpack_aim_deep',
  AIM_DOWN:    'jetpack_aim_down',
  FX:          'jetpack_shoot_fx',
} as const;

export class JetpackBot extends Enemy {

  /** Current aim pose — changes only when the computed angle crosses a threshold. */
  private aimIdx: JetpackAngleIdx = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'jetpack_bot', {
      speed:            JETPACK_BOT.maxSpeed,
      aggroRadius:      JETPACK_BOT.aggroRadius,
      attackCooldownMs: JETPACK_BOT.attackCooldownMs,
      health:           JETPACK_BOT.health,
      contactDamage:    JETPACK_BOT.contactDamage,
    });
    this.setScale(JETPACK_BOT.scale);
    // The jetpack hovers with continuous sub-pixel velocity (no gravity,
    // proportional thrust), so 'safe' rounding isn't tight enough — at
    // 1.75× scale we still see occasional edge-column bleed from adjacent
    // frames.  'full' snaps every vertex to whole screen pixels, which
    // kills the artifact entirely.  Cost is a tiny visual jitter when
    // velocity is low, acceptable for a flying enemy.
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'full';
    // Belt + braces: ensure the GPU samples the texture nearest-neighbour
    // (the game-wide antialias:false already does this globally, but a
    // per-texture setFilter locks it in regardless of driver quirks).
    this.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  // ── Body ─────────────────────────────────────────────────────────────────

  protected setupBody(): void {
    const b = this.arcadeBody;
    b.setSize(JETPACK_BOT.body.width, JETPACK_BOT.body.height);
    b.setOffset(JETPACK_BOT.body.offsetX, JETPACK_BOT.body.offsetY);
    // Floats — no gravity.  Cap velocity so the hover chase doesn't overshoot.
    b.setAllowGravity(false);
    b.setMaxVelocity(JETPACK_BOT.maxSpeed, JETPACK_BOT.maxSpeed);
    // Drag so the bot decelerates naturally when close to target.
    b.setDrag(120, 120);
  }

  // ── Animations ───────────────────────────────────────────────────────────

  protected buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = JETPACK_BOT;

    const makeAim = (key: string, range: { start: number; end: number; frameRate: number }) => {
      if (anims.exists(key)) return;
      anims.create({
        key,
        frames:    anims.generateFrameNumbers('jetpack_bot', { start: range.start, end: range.end }),
        frameRate: range.frameRate,
        repeat:    -1,
      });
    };
    makeAim(ANIM.AIM_SHALLOW, def.aimShallow);
    makeAim(ANIM.AIM_DEEP,    def.aimDeep);
    makeAim(ANIM.AIM_DOWN,    def.aimDown);

    if (!anims.exists(ANIM.FX)) {
      anims.create({
        key:       ANIM.FX,
        // Full 3-frame muzzle-flash anim (puff grows + fades).  Plays once
        // on the throwaway flash sprite; ANIMATION_COMPLETE destroys it.
        frames:    anims.generateFrameNumbers('jetpack_shoot_fx', { start: 0, end: 2 }),
        frameRate: JETPACK_BOT.shootFx.frameRate,
        repeat:    0,
      });
    }
  }

  // ── Attack — fire and immediately return to hover ────────────────────────
  //
  // Unlike PenguinBot/WalrusBot which have a dedicated attack ANIMATION, the
  // jetpack bot's aim pose IS its idle.  So the 'attack' state is a one-frame
  // event: emit the shoot event, then transition back to 'walk' so the aim
  // loop continues rendering.

  protected doAttack(): void {
    if (!this.playerRef) {
      this.transition('walk');
      return;
    }
    const dirSign = this.facingRight ? 1 : -1;
    const spawnX  = this.x + dirSign * JETPACK_BOT.shootOffsetX * JETPACK_BOT.scale;
    const spawnY  = this.y + JETPACK_BOT.shootOffsetY * JETPACK_BOT.scale;

    const angleIdx = this.aimIdx;
    const spd = angleIdx === 0
      ? JETPACK_BULLET.speedByAngle.shallow
      : angleIdx === 1
        ? JETPACK_BULLET.speedByAngle.deep
        : JETPACK_BULLET.speedByAngle.down;
    const vx = dirSign * spd.vx;
    const vy = spd.vy;

    this.emit('jetpack-shoot', {
      x: spawnX,
      y: spawnY,
      vx,
      vy,
      angleIdx,
      facingRight: this.facingRight,
    } as JetpackShootEvent);

    // Snap back to hover immediately — no attack anim to wait out.
    this.transition('walk');
  }

  // ── Hover chase — replaces the default bounce patrol ─────────────────────

  protected patrol(): void {
    const b = this.arcadeBody;
    if (!this.playerRef) {
      b.setVelocity(0, 0);
      return;
    }

    // Face the player.
    this.setFacing(this.playerRef.x > this.x);

    // Target point: directly above the player at hoverOffsetY.
    const tx = this.playerRef.x;
    const ty = this.playerRef.y + JETPACK_BOT.hoverOffsetY;

    // Proportional thrust — velocity scales with distance, capped by body.maxVelocity.
    const dx = tx - this.x;
    const dy = ty - this.y;
    const g  = JETPACK_BOT.thrustGain;
    const cap = JETPACK_BOT.maxSpeed;
    const vxTarget = Math.max(-cap, Math.min(cap, dx * g * 60));
    let   vyTarget = Math.max(-cap, Math.min(cap, dy * g * 60));
    // Make the bot feel heavy when climbing — upward velocity is scaled
    // down so the player gets a window to hit it after dropping below.
    if (vyTarget < 0) vyTarget *= JETPACK_BOT.riseSlowdown;
    b.setVelocity(vxTarget, vyTarget);

    // Refresh aim pose per frame based on the downward angle ratio.
    this.aimIdx = this.computeAimIdx(this.playerRef.x, this.playerRef.y);
    const animKey = this.animKeyForAim(this.aimIdx);
    if (this.anims.currentAnim?.key !== animKey) {
      this.play(animKey, true);
    }
  }

  /**
   * Pick the SHALLOW/DEEP/DOWN pose based on |dy|/|dx|.  Bot hovers above
   * the player so dy is typically positive (player is below) — we use abs
   * anyway in case of overshoot.
   */
  private computeAimIdx(px: number, py: number): JetpackAngleIdx {
    const dx = Math.max(1, Math.abs(px - this.x));   // avoid div-by-zero
    const dy = Math.abs(py - this.y);
    const r  = dy / dx;
    if (r < JETPACK_BOT.shallowRatio) return 0;
    if (r < JETPACK_BOT.deepRatio)    return 1;
    return 2;
  }

  private animKeyForAim(idx: JetpackAngleIdx): string {
    switch (idx) {
      case 0: return ANIM.AIM_SHALLOW;
      case 1: return ANIM.AIM_DEEP;
      case 2: return ANIM.AIM_DOWN;
    }
  }

  // ── State → anim key ─────────────────────────────────────────────────────
  // getAnimKey is called by Enemy.transition — for 'walk' we return the
  // CURRENT aim pose so scene startup plays something reasonable even
  // before the first patrol() tick runs.  Subsequent patrol() ticks handle
  // pose switching directly.

  protected getAnimKey(state: EnemyState): string | null {
    switch (state) {
      case 'idle':   return this.animKeyForAim(this.aimIdx);
      case 'walk':   return this.animKeyForAim(this.aimIdx);
      case 'attack': return null;   // aim pose stays — see doAttack()
      default:       return null;
    }
  }
}
