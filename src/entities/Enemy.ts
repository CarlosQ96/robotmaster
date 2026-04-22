/**
 * Enemy.ts — Abstract base class for all enemies.
 *
 * State machine:
 *
 *   IDLE   ──(scene / timer)──► WALK
 *   WALK   ──(aggro)──────────► ATTACK
 *   WALK   ──(hit)────────────► HURT
 *   ATTACK ──(anim done)──────► WALK      (subclass drives via setupAnimListeners)
 *   HURT   ──(timer done)─────► WALK
 *   WALK   ──(health = 0)─────► DEAD
 *
 * Subclasses MUST implement:
 *   setupBody()            — setSize / setOffset for this enemy's hitbox
 *   buildAnims()           — register Phaser animation keys
 *   getAnimKey(state)      — map EnemyState → Phaser animation key (null = no change)
 *   doAttack()             — called once on entering 'attack' (stop, orient, etc.)
 *
 * Subclasses MAY override:
 *   setupAnimListeners()   — hook ANIMATION_COMPLETE / ANIMATION_UPDATE events
 *   shouldAttack()         — custom aggro logic (default: player proximity radius)
 *   patrol()               — custom movement (default: horizontal bounce in bounds)
 */
import * as Phaser from 'phaser';

export type EnemyState = 'idle' | 'walk' | 'attack' | 'hurt' | 'dead';

export interface EnemyCfg {
  speed:            number;
  aggroRadius:      number;   // world px; set 0 to disable auto-aggro
  attackCooldownMs: number;
  health:           number;
  /** Damage dealt on body contact with the player (default 1). */
  contactDamage?:   number;
  /**
   * Multiplier applied to the default hurt-state knockback impulse
   * (both X and Y).  Default 1 (normal knockback).  Set to 0 to disable
   * knockback entirely — used by stationary bosses that shouldn't flinch.
   */
  hurtKnockback?:   number;
}

export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {

  protected enemyState: EnemyState = 'idle';

  // Sprite faces LEFT by default — facingRight=false means no flip
  protected facingRight = false;

  // Patrol bounds (world px)
  protected patrolLeft  = 0;
  protected patrolRight = 0;

  protected playerRef?: Phaser.Physics.Arcade.Sprite;

  private attackCooldownTimer = 0;
  private hurtTimer = 0;
  private static readonly HURT_DURATION     = 500; // ms locked in hurt state
  private static readonly HURT_BLINK_PERIOD = 60;  // ms — rapid red/white silhouette flash
  private static readonly HURT_KNOCKBACK_X  = 180; // px/s away from damage source
  private static readonly HURT_KNOCKBACK_Y  = -140; // px/s upward bump

  /** Sign of the knockback applied when entering hurt (-1 = left, +1 = right). */
  private hurtKnockbackDir: -1 | 1 = 1;

  private _health: number;

  // ── Constructor ──────────────────────────────────────────────────────────
  constructor(
    scene:      Phaser.Scene,
    x:          number,
    y:          number,
    textureKey: string,
    protected readonly cfg: EnemyCfg,
  ) {
    super(scene, x, y, textureKey);

    this._health = cfg.health;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Phaser 4 per-object pixel snap.  Non-integer render scales (we use 1.75)
    // can bleed the edge row of an adjacent spritesheet frame into the
    // current frame — that's the "phantom trail" behind the walrus when it
    // moves.  'safe' rounds quad vertices to whole pixels without touching
    // rotation / scale math.
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';

    const b = this.arcadeBody;
    b.setAllowGravity(true);
    b.setCollideWorldBounds(true);

    // Subclass hooks — safe to call here because they only use module-level
    // constants and Phaser APIs, not subclass constructor-body state.
    this.setupBody();
    this.buildAnims();
    this.setupAnimListeners();

    // Cache the left-facing body offset (sprite default) so setFacing() can
    // mirror it across the frame center when the enemy flips.
    this.baseOffsetX = this.arcadeBody.offset.x;

    // Default patrol: ±100 px around spawn
    this.patrolLeft  = x - 100;
    this.patrolRight = x + 100;

    this.transition('walk');
  }

  /** Body offsetX measured when facing LEFT (unflipped). */
  protected baseOffsetX = 0;

  // ── Abstract ─────────────────────────────────────────────────────────────

  /** Configure the arcade body (setSize, setOffset). */
  protected abstract setupBody(): void;

  /** Register all Phaser animation keys for this enemy type. */
  protected abstract buildAnims(): void;

  /**
   * Map an EnemyState to a Phaser animation key.
   * Return null if no animation change is needed for that state.
   */
  protected abstract getAnimKey(state: EnemyState): string | null;

  /**
   * Called exactly once when the state machine enters 'attack'.
   * Typical use: stop horizontal movement, orient toward player.
   */
  protected abstract doAttack(): void;

  // ── Virtual ──────────────────────────────────────────────────────────────

  /** Override to register ANIMATION_COMPLETE / ANIMATION_UPDATE handlers. */
  protected setupAnimListeners(): void { /* default: no listeners */ }

  /**
   * Override to customise aggro logic.
   * Default: attack when player is within aggroRadius (squared-distance check).
   */
  protected shouldAttack(): boolean {
    if (!this.playerRef || this.cfg.aggroRadius <= 0) return false;
    const dx = this.x - this.playerRef.x;
    const dy = this.y - this.playerRef.y;
    const r  = this.cfg.aggroRadius;
    return (dx * dx + dy * dy) <= r * r;
  }

  /**
   * Default patrol: walk between patrolLeft / patrolRight, flip on edge.
   * Override for more complex movement (edge detection, waypoints, etc.).
   */
  protected patrol(): void {
    const body = this.arcadeBody;
    if (this.facingRight) {
      body.setVelocityX(this.cfg.speed);
      if (this.x >= this.patrolRight) this.setFacing(false);
    } else {
      body.setVelocityX(-this.cfg.speed);
      if (this.x <= this.patrolLeft) this.setFacing(true);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Provide the player sprite so this enemy can track/aggro it. */
  setPlayer(player: Phaser.Physics.Arcade.Sprite): this {
    this.playerRef = player;
    return this;
  }

  /** Set explicit patrol bounds (world px). Fluent. */
  setPatrol(left: number, right: number): this {
    this.patrolLeft  = left;
    this.patrolRight = right;
    return this;
  }

  /**
   * Apply damage.  Triggers 'hurt' or 'dead' state.
   * `sourceX` (world x of the damage source) decides knockback direction —
   * the enemy is pushed AWAY from the source.  Defaults to facing-based.
   */
  takeDamage(amount: number, sourceX?: number): void {
    if (this.enemyState === 'dead') return;
    this._health -= amount;
    this.hurtKnockbackDir = sourceX !== undefined
      ? (this.x >= sourceX ? 1 : -1)
      : (this.facingRight ? -1 : 1);
    this.transition(this._health <= 0 ? 'dead' : 'hurt');
  }

  get currentState(): EnemyState { return this.enemyState; }

  /** Damage this enemy deals on body contact with the player. */
  get contactDamage(): number { return this.cfg.contactDamage ?? 1; }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  // ── State machine ────────────────────────────────────────────────────────

  protected transition(next: EnemyState): void {
    if (this.enemyState === next) return;

    this.enemyState = next;

    const key = this.getAnimKey(next);
    if (key) this.play(key, true);

    if (next === 'attack') this.doAttack();
    if (next === 'hurt') {
      this.hurtTimer = Enemy.HURT_DURATION;
      // FILL tint paints a solid silhouette — update() blinks red/white for the
      // duration so the hit reads instantly even at small sprite sizes.
      this.setTintMode(Phaser.TintModes.FILL);
      this.setTint(0xff0000);
      // Knockback impulse — hurt state locks the update() loop, so the patrol
      // velocity won't overwrite this until hurtTimer expires.  `hurtKnockback`
      // cfg scales the default impulse; 0 disables knockback (stationary bosses).
      const kb = this.cfg.hurtKnockback ?? 1;
      this.arcadeBody.setVelocity(
        this.hurtKnockbackDir * Enemy.HURT_KNOCKBACK_X * kb,
        Enemy.HURT_KNOCKBACK_Y * kb,
      );
    }
    if (next === 'dead') {
      this.setTintMode(Phaser.TintModes.MULTIPLY);
      this.clearTint();
      this.arcadeBody.setVelocity(0, 0);
      this.arcadeBody.enable = false;  // no more collisions, no more damage
      this.scene.tweens.add({
        targets:  this,
        alpha:    0,
        duration: 300,
        onComplete: () => this.destroy(),
      });
    }
  }

  // ── Facing ───────────────────────────────────────────────────────────────

  protected setFacing(right: boolean): void {
    if (this.facingRight === right) return;
    this.facingRight = right;
    this.setFlipX(right);
    // Mirror body offset across frame center so the hitbox tracks the sprite.
    //   flipped offsetX = frameWidth - baseOffsetX - bodyWidth
    // this.width is the unscaled source frame width (40 for penguin_bot).
    const b = this.arcadeBody;
    b.offset.x = right ? (this.width - this.baseOffsetX - b.width) : this.baseOffsetX;
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  update(delta: number): void {
    if (this.enemyState === 'dead') return;

    // Timers
    if (this.attackCooldownTimer > 0) this.attackCooldownTimer -= delta;

    // Hurt recovery — rapid red/white fill-tint flash reads as a solid hit.
    if (this.enemyState === 'hurt') {
      this.hurtTimer -= delta;
      const flashOn = Math.floor(this.hurtTimer / Enemy.HURT_BLINK_PERIOD) % 2 === 0;
      this.setTint(flashOn ? 0xff0000 : 0xffffff);
      if (this.hurtTimer <= 0) {
        this.setTintMode(Phaser.TintModes.MULTIPLY);
        this.clearTint();
        this.transition('walk');
      }
      return;
    }

    // Attack animation plays out — update() hands off control to listeners
    if (this.enemyState === 'attack') return;

    // Aggro check
    if (this.attackCooldownTimer <= 0 && this.shouldAttack()) {
      this.attackCooldownTimer = this.cfg.attackCooldownMs;
      this.transition('attack');
      return;
    }

    // Movement
    if (this.enemyState === 'walk') this.patrol();
    // idle: stays still, no velocity change
  }
}
