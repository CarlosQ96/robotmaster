/**
 * Player.ts — Player entity.
 *
 * Movement state machine (Z / charge is DECOUPLED — see below):
 *
 *   IDLE       ──move──────► RUN
 *   IDLE       ──↑──────────► JUMP
 *   IDLE       ──↓──────────► CROUCH
 *   IDLE       ──X──────────► SLIDE
 *   RUN        ──stop───────► IDLE
 *   RUN        ──↑──────────► JUMP
 *   RUN        ──↓──────────► CROUCH
 *   RUN        ──X──────────► SLIDE
 *   SHOOT      ──anim done──► IDLE          (brief standing shot animation)
 *   SHOOT      ──move───────► SHOOT_RUN
 *   SHOOT      ──↑──────────► JUMP_SHOOT
 *   SHOOT_RUN  ──shot fired─► exit timer → RUN / IDLE
 *   SHOOT_RUN  ──airborne───► JUMP / FALL
 *   SHOOT_RUN  ──X──────────► SLIDE
 *   JUMP/FALL  ──land───────► RUN / IDLE
 *   JUMP_SHOOT ──anim done──► settle 0.15s → JUMP / FALL / ground
 *   JUMP_SHOOT ──landed─────► RUN / IDLE
 *   CROUCH     ──↓ release──► IDLE
 *   CROUCH     ──X──────────► SLIDE
 *   SLIDE      ──anim done──► IDLE / FALL
 *
 * Z / charge system (BACKGROUND — no state change, any movement works during charge):
 *   Z held     → chargeTimer accumulates each frame regardless of movement state
 *   Z released → fire based on chargeTimer:
 *                 < minCharge  → small bullet (via shoot / shoot_run / jump_shoot animation)
 *                 < fullCharge → charged bullet (immediate, no animation)
 *                 ≥ fullCharge → full-charged bullet (immediate, no animation)
 *   Visual     → white fill-tint on player ONLY after CHARGE_VISUAL_DELAY (500ms)
 *                 Blink speeds up when fullCharge threshold is reached.
 *
 * Sprite faces LEFT by default.
 *   setFacing(false) = left (no flip)   setFacing(true) = right (flip)
 */
import * as Phaser from 'phaser';
import { PLAYER, PROJECTILE } from '../config/gameConfig';
import { PLAYER_ANIMS, ANIM_KEY } from '../config/animConfig';
import { getAudio } from '../audio/AudioManager';

/** Event emitted on every shot. GymScene listens and spawns the right bullet. */
export interface ShootEvent {
  x: number;
  y: number;
  facingRight: boolean;
  type: 'small' | 'charged' | 'full_charged';
}

export type PlayerState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'shoot'
  | 'shoot_run'
  | 'jump_shoot'
  | 'crouch'
  | 'slide'
  | 'hurt'
  | 'dead';

/** States that use the reduced-height crouch hitbox */
const LOW_STATES = new Set<PlayerState>(['crouch', 'slide']);

/**
 * PlayerState → registered animation key.  Most states share a name with
 * their animation; 'hurt' and 'dead' map to the differently-named assets.
 */
const STATE_ANIM: Record<PlayerState, string> = {
  idle:       ANIM_KEY.IDLE,
  run:        ANIM_KEY.RUN,
  jump:       ANIM_KEY.JUMP,
  fall:       ANIM_KEY.FALL,
  shoot:      ANIM_KEY.SHOOT,
  shoot_run:  ANIM_KEY.SHOOT_RUN,
  jump_shoot: ANIM_KEY.JUMP_SHOOT,
  crouch:     ANIM_KEY.CROUCH,
  slide:      ANIM_KEY.SLIDE,
  hurt:       ANIM_KEY.TAKE_DAMAGE,
  dead:       ANIM_KEY.DEATH,
};

export class Player extends Phaser.Physics.Arcade.Sprite {
  private playerState: PlayerState = 'idle';

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private shootKey!: Phaser.Input.Keyboard.Key;
  private slideKey!: Phaser.Input.Keyboard.Key;

  // ── Shoot cooldown ────────────────────────────────────────────────────────
  /**
   * Rate-of-fire limiter for small bullets in ms.
   * Public — tune at runtime: player.shootCooldownMs = 300 (slower), 0 (unlimited).
   */
  shootCooldownMs: number = PROJECTILE.small.shootCooldownMs;
  private shootCooldownTimer = 0;

  // ── Charge system (background — decoupled from movement state) ────────────
  // chargeTimer counts up while Z is held, resets to 0 when released.
  // The movement state machine never reads or writes chargeTimer.
  private chargeTimer = 0;
  /** Hold time before the white-tint visual appears on the player (ms). */
  private static readonly CHARGE_VISUAL_DELAY = 500;

  // ── Shoot-run one-shot gate ───────────────────────────────────────────────
  // Prevents the looping shoot_run animation from firing multiple bullets
  // before the player re-taps Z.  Reset each time we (re-)enter shoot_run.
  private shootRunFired = false;

  // ── Charged-shot animation gate ───────────────────────────────────────────
  // When a charged/full-charged bullet has already been emitted we still play
  // the shoot animation for visual feedback, but block the animation's own
  // emitSmallShot() call so a second (small) bullet doesn't double-fire.
  private skipSmallShot = false;

  // ── Shoot-run exit timer ──────────────────────────────────────────────────
  private shootRunExitTimer = 0;
  private static readonly SHOOT_RUN_EXIT_DELAY = 200; // ms

  // ── Jump-shoot settle state ───────────────────────────────────────────────
  private jumpShootComplete    = false;
  private jumpShootSettleTimer = 0;
  private static readonly JUMP_SHOOT_SETTLE_DELAY = 150; // ms

  // ── Health / damage ──────────────────────────────────────────────────────
  private _health: number = PLAYER.maxHealth;
  private invulnTimer     = 0;

  // ── Public getters ───────────────────────────────────────────────────────
  get currentState(): PlayerState { return this.playerState; }
  get health(): number            { return this._health; }
  get maxHealth(): number         { return PLAYER.maxHealth; }
  get isInvulnerable(): boolean   { return this.invulnTimer > 0; }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  // ── Constructor ──────────────────────────────────────────────────────────
  constructor(scene: Phaser.Scene, x: number, y: number, textureKey = 'player_default') {
    super(scene, x, y, textureKey);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(PLAYER.scale);
    (this as unknown as Record<string, unknown>)['vertexRoundMode'] = 'safe';
    this.setCollideWorldBounds(true);

    this.arcadeBody.setSize(PLAYER.body.width, PLAYER.body.height);
    this.arcadeBody.setOffset(PLAYER.body.offsetX, PLAYER.body.offsetY);

    // Terminal velocity cap — gravity alone reaches 980 px/s after 1s of fall,
    // which at 60fps is ~16 px/frame.  Platform bodies are only 16 px tall, so
    // any higher Y speed risks tunneling through on a diagonal approach.
    // X cap comfortably clears slide (480) and hurt knockback (100).
    this.arcadeBody.setMaxVelocity(900, 800);

    this.cursors  = scene.input.keyboard!.createCursorKeys();
    this.shootKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.slideKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);

    this.buildAnims(scene, textureKey);
    this.setupAnimListeners();
  }

  // ── Animation registration ───────────────────────────────────────────────
  private buildAnims(scene: Phaser.Scene, textureKey: string): void {
    for (const [key, def] of Object.entries(PLAYER_ANIMS)) {
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(textureKey, {
          start: def.start,
          end:   def.end,
        }),
        frameRate: def.frameRate,
        repeat:    def.repeat,
      });
    }
    this.play(ANIM_KEY.IDLE, true);
  }

  // ── Animation event listeners ────────────────────────────────────────────
  private setupAnimListeners(): void {
    // shoot done → idle
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM_KEY.SHOOT}`,
      () => this.transition('idle'),
    );
    // slide done → idle or fall
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM_KEY.SLIDE}`,
      () => {
        this.arcadeBody.setVelocityX(0);
        this.transition(this.arcadeBody.blocked.down ? 'idle' : 'fall');
      },
    );
    // jump_shoot done → start settle timer (update handles the rest)
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM_KEY.JUMP_SHOOT}`,
      () => {
        this.jumpShootComplete    = true;
        this.jumpShootSettleTimer = Player.JUMP_SHOOT_SETTLE_DELAY;
      },
    );

    // Bullet spawn: fire on the exact frame the arm is extended.
    //   shoot     → frame 7   (arm out, muzzle at tip)
    //   shoot_run → frame 9   (same, one-shot gate via shootRunFired)
    this.on(
      Phaser.Animations.Events.ANIMATION_UPDATE,
      (_anim: unknown, frame: Phaser.Animations.AnimationFrame) => {
        const fn = Number(frame.frame.name);
        if (this.playerState === 'shoot' && fn === 7) {
          this.emitSmallShot();
        }
        if (this.playerState === 'shoot_run' && !this.shootRunFired && fn === 9) {
          this.shootRunFired = true;
          this.emitSmallShot();
        }
      },
    );

    // jump_shoot fires the moment the animation (re-)starts.
    this.on(
      Phaser.Animations.Events.ANIMATION_START,
      (anim: Phaser.Animations.Animation) => {
        if (anim.key === ANIM_KEY.JUMP_SHOOT) this.emitSmallShot();
      },
    );

    // take_damage done → resume normal gameplay state
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM_KEY.TAKE_DAMAGE}`,
      () => {
        if (this.playerState !== 'hurt') return;
        this.transition(this.arcadeBody.blocked.down ? 'idle' : 'fall');
      },
    );
  }

  // ── Damage ───────────────────────────────────────────────────────────────
  /**
   * Apply `amount` damage.  Ignored during invuln window or when dead.
   * `sourceX` (world x of the damage source) determines knockback direction —
   * the player is pushed AWAY from the source.  Falls back to facing direction.
   */
  takeDamage(amount: number, sourceX?: number): void {
    if (this.invulnTimer > 0 || this.playerState === 'dead') return;

    this._health = Math.max(0, this._health - amount);
    this.invulnTimer = PLAYER.invulnMs;

    getAudio(this.scene).playSfx('hurt');

    // Reset any charging state so we don't fire the moment we recover.
    this.chargeTimer = 0;
    this.skipSmallShot = false;
    this.setTintMode(Phaser.TintModes.MULTIPLY);
    this.clearTint();

    // Knockback: push AWAY from source. If source not given, push opposite facing.
    const pushRight = sourceX !== undefined ? (this.x >= sourceX) : !this.flipX;
    const dirX = pushRight ? 1 : -1;

    // Route through transition() so the body hitbox reverts to standing size
    // if we were sliding/crouching when hit.  A shorter body combined with a
    // thin (16-px) platform body is a tunneling recipe.  transition() also
    // plays the right anim via STATE_ANIM.
    if (this._health <= 0) {
      this.transition('dead');
      this.arcadeBody.setVelocity(dirX * PLAYER.hurtKnockbackX * 0.5, PLAYER.hurtKnockbackY);
      this.emit('player-died');
      return;
    }

    this.transition('hurt');
    this.arcadeBody.setVelocity(dirX * PLAYER.hurtKnockbackX, PLAYER.hurtKnockbackY);
  }

  /**
   * Restore the player to full health at (x, y) and resume normal control.
   * Clears death / hurt / invuln / charge visuals and grants a brief invuln
   * window so the player isn't instantly re-hit by a lingering bomb/enemy.
   */
  respawn(x: number, y: number): void {
    this._health = PLAYER.maxHealth;
    this.invulnTimer = PLAYER.invulnMs; // post-respawn grace period
    this.chargeTimer = 0;
    this.skipSmallShot = false;
    this.shootRunFired = false;
    this.jumpShootComplete = false;
    this.shootRunExitTimer = 0;
    this.jumpShootSettleTimer = 0;

    this.setTintMode(Phaser.TintModes.MULTIPLY);
    this.clearTint();
    this.setAlpha(1);

    const body = this.arcadeBody;
    body.enable = true;
    body.reset(x, y);
    body.setVelocity(0, 0);

    this.playerState = 'idle';
    this.play(ANIM_KEY.IDLE, true);
  }

  // ── Facing + body offset ─────────────────────────────────────────────────
  private setFacing(facingRight: boolean): void {
    if (this.flipX === facingRight) return;
    this.setFlipX(facingRight);
    this.syncBodyOffset();
  }

  private syncBodyOffset(): void {
    const def = LOW_STATES.has(this.playerState) ? PLAYER.crouchBody : PLAYER.body;
    const ox  = this.flipX
      ? PLAYER.frameWidth - def.offsetX - def.width
      : def.offsetX;
    this.arcadeBody.setOffset(ox, def.offsetY);
  }

  // ── Shoot helpers ────────────────────────────────────────────────────────

  /** Small bullet — called from animation-frame hooks. Rate-limited by cooldown. */
  private emitSmallShot(): void {
    // A charged shot was already fired this release — let the animation play
    // for visual feedback but suppress the extra small bullet.
    if (this.skipSmallShot) { this.skipSmallShot = false; return; }
    if (this.shootCooldownTimer > 0) return;
    this.shootCooldownTimer = this.shootCooldownMs;

    const facingRight = this.flipX;
    // Muzzle offsets are in SOURCE pixels; multiply by PLAYER.scale so the
    // bullet emerges from the rendered gun tip at any sprite scale.
    const ox = (facingRight ? PROJECTILE.small.muzzleOffsetX : -PROJECTILE.small.muzzleOffsetX) * PLAYER.scale;
    const oy = (LOW_STATES.has(this.playerState)
      ? PROJECTILE.small.crouchMuzzleOffsetY
      : PROJECTILE.small.muzzleOffsetY) * PLAYER.scale;
    this.emit('player-shoot', { x: this.x + ox, y: this.y + oy, facingRight, type: 'small' } as ShootEvent);
  }

  /** Charged / full-charged bullet — called on Z release, fires immediately. */
  private emitChargedShot(timer: number): void {
    const type: 'charged' | 'full_charged' =
      timer >= PROJECTILE.chargeTime.fullCharge ? 'full_charged' : 'charged';

    const cfg      = type === 'charged' ? PROJECTILE.charged : PROJECTILE.fullCharged;
    const facingRight = this.flipX;
    const ox = (facingRight ? cfg.muzzleOffsetX : -cfg.muzzleOffsetX) * PLAYER.scale;
    const oy = (LOW_STATES.has(this.playerState) ? cfg.crouchMuzzleOffsetY : cfg.muzzleOffsetY) * PLAYER.scale;
    this.emit('player-shoot', { x: this.x + ox, y: this.y + oy, facingRight, type } as ShootEvent);
  }

  // ── Z release handler ────────────────────────────────────────────────────
  /**
   * Decide what to fire based on how long Z was held, then play the
   * appropriate shoot animation regardless of bullet type.
   *
   *   < minCharge → small bullet via animation frame hook
   *   ≥ minCharge → charged / full-charged bullet emitted immediately;
   *                 skipSmallShot blocks the animation's hook from
   *                 firing a second (small) bullet on top.
   */
  private handleZRelease(
    savedTimer: number,
    onGround:   boolean,
    vx:         number,
    goDown:     boolean,
  ): void {
    const isCharged = savedTimer >= PROJECTILE.chargeTime.minCharge;

    if (isCharged) {
      this.emitChargedShot(savedTimer);
      // skipSmallShot is set below only for paths that trigger an animation
    }

    // ── Airborne ────────────────────────────────────────────────────────────
    if (!onGround) {
      if (isCharged) this.skipSmallShot = true;
      if (this.playerState === 'jump_shoot') {
        // Restart for rapid fire / charged repeat
        this.jumpShootComplete    = false;
        this.jumpShootSettleTimer = 0;
        this.play(ANIM_KEY.JUMP_SHOOT, false);
      } else {
        this.transition('jump_shoot');
      }
      return;
    }

    // ── Crouching ───────────────────────────────────────────────────────────
    if (goDown) {
      // No dedicated crouching shoot animation — fire immediately (small only)
      if (!isCharged) this.emitSmallShot();
      return;
    }

    // ── Running ─────────────────────────────────────────────────────────────
    if (vx !== 0) {
      if (isCharged) this.skipSmallShot = true;
      if (this.playerState === 'shoot_run') {
        this.shootRunFired = false; // allow next shot in existing animation
      } else {
        this.transition('shoot_run');
      }
      return;
    }

    // ── Standing ────────────────────────────────────────────────────────────
    if (isCharged) this.skipSmallShot = true;
    this.transition('shoot');
  }

  // ── Charge visual ────────────────────────────────────────────────────────
  /**
   * Apply white fill-tint to the player after CHARGE_VISUAL_DELAY ms of
   * holding Z.  Blink period shortens when full-charge threshold is reached.
   * Clears automatically when chargeTimer drops to 0 (Z released).
   */
  private updateChargeVisual(): void {
    // Invuln blink owns the tint + alpha while active — don't fight it.
    if (this.invulnTimer > 0) return;
    if (this.chargeTimer < Player.CHARGE_VISUAL_DELAY) {
      // Below threshold (or Z released this frame) — ensure clean state
      this.setTintMode(Phaser.TintModes.MULTIPLY);
      this.clearTint();
      this.setAlpha(1);
      return;
    }
    const full   = this.chargeTimer >= PROJECTILE.chargeTime.fullCharge;
    const period = full ? 100 : 350;
    if ((this.scene.time.now % period) < period / 2) {
      // Flash ON — white silhouette
      this.setTint(0xffffff);
      this.setTintMode(Phaser.TintModes.FILL);
      this.setAlpha(1);
    } else {
      // Flash OFF — normal palette
      this.setTintMode(Phaser.TintModes.MULTIPLY);
      this.clearTint();
      this.setAlpha(full ? 0.7 : 1.0);
    }
  }

  // ── State machine transition ─────────────────────────────────────────────
  private transition(next: PlayerState): void {
    if (this.playerState === next) return;

    const wasLow  = LOW_STATES.has(this.playerState);
    const willLow = LOW_STATES.has(next);

    this.playerState = next;
    this.play(STATE_ANIM[next], true);

    if (next === 'shoot_run') this.shootRunFired    = false;
    if (next === 'jump_shoot') {
      this.jumpShootComplete    = false;
      this.jumpShootSettleTimer = 0;
    }

    if (wasLow !== willLow) {
      const def = willLow ? PLAYER.crouchBody : PLAYER.body;
      this.arcadeBody.setSize(def.width, def.height);
    }
    this.syncBodyOffset();
  }

  // ── Per-frame update ─────────────────────────────────────────────────────
  update(delta: number): void {

    // ── Invuln blink ──────────────────────────────────────────────────────
    if (this.invulnTimer > 0) {
      this.invulnTimer -= delta;
      // ~80ms blink period — visible but not jarring
      this.setAlpha(Math.floor(this.invulnTimer / 80) % 2 === 0 ? 1 : 0.3);
      if (this.invulnTimer <= 0) {
        this.invulnTimer = 0;
        this.setAlpha(1);
      }
    }

    // Dead → lock out all input; let gravity finish the ragdoll arc.
    if (this.playerState === 'dead') {
      this.arcadeBody.setVelocityX(0);
      return;
    }

    // Hurt → locked until take_damage anim completes (see listener).
    if (this.playerState === 'hurt') return;

    // ── Timers ────────────────────────────────────────────────────────────
    if (this.shootCooldownTimer > 0) this.shootCooldownTimer -= delta;

    // ── Input ─────────────────────────────────────────────────────────────
    const body     = this.arcadeBody;
    const onGround = body.blocked.down;

    const goLeft  = this.cursors.left.isDown;
    const goRight = this.cursors.right.isDown;
    const goDown  = this.cursors.down.isDown;

    const jumpPressed   = Phaser.Input.Keyboard.JustDown(this.cursors.up);
    const shootHeld     = this.shootKey.isDown;
    const shootReleased = Phaser.Input.Keyboard.JustUp(this.shootKey);
    const slideTapped   = Phaser.Input.Keyboard.JustDown(this.slideKey);

    // ── Z / charge (background — runs every frame, independent of movement) ─
    //
    // chargeTimer accumulates while Z is held.  On release, savedChargeTimer
    // captures the accumulated value before the reset so handleZRelease can
    // determine bullet type even though chargeTimer will be 0 next line.
    const savedChargeTimer = this.chargeTimer;
    if (shootHeld) {
      this.chargeTimer += delta;
    } else {
      this.chargeTimer = 0; // not held → reset (also clears visual next line)
    }
    this.updateChargeVisual();

    // ── Horizontal velocity + facing ──────────────────────────────────────
    // Computed before state decisions so handleZRelease and all states share it.
    // Slide is the only state that must not have its velocity overridden, and
    // it returns before body.setVelocityX() in the normal movement section.
    if (!goDown) {
      if (goLeft)  this.setFacing(false);
      if (goRight) this.setFacing(true);
    }
    let vx = 0;
    if (goLeft)  vx = -PLAYER.speed;
    if (goRight) vx =  PLAYER.speed;
    if (goDown && onGround) vx = 0; // no walking while crouching

    // ── Z release → determine and fire bullet ─────────────────────────────
    if (shootReleased) {
      this.handleZRelease(savedChargeTimer, onGround, vx, goDown);
    }

    // ── Movement state machine ─────────────────────────────────────────────

    // SLIDE — locked: velocity already set at entry, animation complete exits
    if (this.playerState === 'slide') return;

    // SHOOT — brief standing animation; can escape to jump_shoot or shoot_run
    if (this.playerState === 'shoot') {
      if (jumpPressed && onGround) {
        body.setVelocityY(PLAYER.jumpVelocity);
        getAudio(this.scene).playSfx('jump');
        this.transition('jump_shoot');
        return;
      }
      if (vx !== 0) {
        body.setVelocityX(vx);
        this.transition('shoot_run');
        return;
      }
      body.setVelocityX(0);
      return;
    }

    // JUMP_SHOOT — semi-locked: can steer; settle after animation completes
    if (this.playerState === 'jump_shoot') {
      const jvx = goLeft ? -PLAYER.speed : goRight ? PLAYER.speed : 0;
      if (goLeft)  this.setFacing(false);
      if (goRight) this.setFacing(true);
      body.setVelocityX(jvx);

      if (this.jumpShootComplete) {
        this.jumpShootSettleTimer -= delta;
        if (this.jumpShootSettleTimer <= 0 || onGround) {
          this.jumpShootComplete = false;
          this.transition(
            onGround
              ? (jvx !== 0 ? 'run' : 'idle')
              : (body.velocity.y < 0 ? 'jump' : 'fall'),
          );
        }
      } else if (onGround) {
        this.transition(jvx !== 0 ? 'run' : 'idle');
      }
      return;
    }

    // SHOOT_RUN — one shot per Z release; exits after a brief delay post-fire
    if (this.playerState === 'shoot_run') {
      if (slideTapped && onGround) {
        body.setVelocityX(this.flipX ? PLAYER.slideSpeed : -PLAYER.slideSpeed);
        getAudio(this.scene).playSfx('slide');
        this.transition('slide');
        return;
      }
      if (jumpPressed && onGround && !goDown) {
        body.setVelocityY(PLAYER.jumpVelocity);
        getAudio(this.scene).playSfx('jump');
      }
      if (!onGround) {
        this.shootRunExitTimer = 0;
        this.transition(body.velocity.y < 0 ? 'jump' : 'fall');
        return;
      }
      body.setVelocityX(vx);
      if (this.shootRunFired) {
        this.shootRunExitTimer += delta;
        if (this.shootRunExitTimer >= Player.SHOOT_RUN_EXIT_DELAY) {
          this.shootRunExitTimer = 0;
          this.transition(vx !== 0 ? 'run' : 'idle');
        }
      } else {
        this.shootRunExitTimer = 0;
      }
      return;
    }

    // ── Normal movement ────────────────────────────────────────────────────

    body.setVelocityX(vx);

    if (slideTapped && onGround) {
      body.setVelocityX(this.flipX ? PLAYER.slideSpeed : -PLAYER.slideSpeed);
      getAudio(this.scene).playSfx('slide');
      this.transition('slide');
      return;
    }

    if (jumpPressed && onGround && !goDown) {
      body.setVelocityY(PLAYER.jumpVelocity);
      getAudio(this.scene).playSfx('jump');
    }

    if (!onGround) {
      this.transition(body.velocity.y < 0 ? 'jump' : 'fall');
      return;
    }

    if (goDown) {
      this.transition('crouch');
      return;
    }

    this.transition(vx !== 0 ? 'run' : 'idle');
  }

  // ── Debug info ────────────────────────────────────────────────────────────
  getDebugInfo(): Record<string, string> {
    const body = this.arcadeBody;
    return {
      state:    this.playerState,
      x:        this.x.toFixed(1),
      y:        this.y.toFixed(1),
      vx:       body.velocity.x.toFixed(0),
      vy:       body.velocity.y.toFixed(0),
      grounded: String(body.blocked.down),
      anim:     this.anims.currentAnim?.key ?? '—',
      frame:    String(this.anims.currentFrame?.index ?? '—'),
      flip:     String(this.flipX),
      cooldown: this.shootCooldownTimer > 0
        ? `${Math.ceil(this.shootCooldownTimer)}ms`
        : 'ready',
      charge: this.chargeTimer > 0
        ? `${(this.chargeTimer / 1000).toFixed(1)}s  ${Math.min(this.chargeTimer / PROJECTILE.chargeTime.fullCharge * 100, 100).toFixed(0)}%`
        : '—',
      hp: `${this._health}/${PLAYER.maxHealth}${this.invulnTimer > 0 ? ' (INV)' : ''}`,
    };
  }
}
