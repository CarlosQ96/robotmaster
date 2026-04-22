/**
 * enemyConfig.ts — Enemy and enemy-projectile configuration.
 *
 * All dimensions are in LOCAL / pre-scale world pixels unless noted.
 * Change a value here and it propagates to every scene automatically.
 */

// ─── Penguin Bot ─────────────────────────────────────────────────────────────
export const PENGUIN_BOT = {
  /** Source sheet: Penguin_Bot.png — 480 × 40 px | 12 frames × 40 px */
  frameWidth:  40,
  frameHeight: 40,
  /** Matches PLAYER.scale so sprite sizes stay consistent across entities. */
  scale:        1,

  /**
   * Arcade body (standing pose).
   *
   * Measured with `python3 engineer-tools/measure_frames.py --sheet … --fw 40 --fh 40`
   * on Penguin_Bot.png walk frames (0-4):
   *   pixels x=14-34 (w=21, cx=24), y=11-39 (h=29, feet at 39)
   *
   * body covers frame x 14-34 (center 24 — matches sprite cx) when facing
   * LEFT (default).  Enemy.setFacing mirrors offsetX for right-facing frames.
   */
  body: {
    width:   20,
    height:  28,
    offsetX: 14,
    offsetY: 11,
  },

  speed:            60,   // px/s patrol walk
  health:            3,   // hits to kill
  contactDamage:    1,    // damage dealt to player on body contact
  aggroRadius:     250,   // world px; 0 = never auto-attack
  attackCooldownMs: 3000, // ms between attacks

  /**
   * Absolute spritesheet frame index that triggers the bomb toss.
   * Frame 7 = throw pose (last frame of the attack animation).
   */
  throwFrame: 7,

  /** Offset from enemy world-center to bomb spawn point */
  throwOffsetX: 14,   // px in front of enemy (sign applied per facing direction)
  throwOffsetY: -6,   // px above center

  anims: {
    walk:   { start: 0, end: 4, frameRate:  8 },   // 5 frames
    attack: { start: 5, end: 7, frameRate:  6 },   // 3 frames: grab → balance → throw (frame 7)
  },
} as const;

// ─── Penguin Bomb ─────────────────────────────────────────────────────────────
export const PENGUIN_BOMB = {
  /** Source sheet: Penguin_Bot_Bomb.png — 320 × 32 px | 10 frames × 32 px */
  frameWidth:  32,
  frameHeight: 32,
  /** Matches PLAYER / PENGUIN_BOT scale for consistent sprite sizes. */
  scale:        1,

  /** Launch arc (px/s).  Horizontal sign is applied per throw direction. */
  throwVelX:  160,
  throwVelY: -250,   // negative = upward

  fuseMs:    2500,   // ms before auto-detonation
  poolSize:     4,   // max simultaneous live bombs
  rollSpeed:   80,   // px/s the bomb chases the player after landing

  fuseDamage:    1,  // damage if the live bomb touches the player (triggers detonation)
  explodeDamage: 2,  // damage from the explosion hitbox

  /** Physics body — fuse phase (tight around the sprite) */
  fuseBody: {
    width:   14,
    height:  14,
    offsetX:  9,
    offsetY:  9,
  },

  /**
   * Physics body — explosion phase (larger for damage detection).
   * Centered on the 32×32 frame.
   */
  explodeBody: {
    width:   28,
    height:  28,
    offsetX:  2,
    offsetY:  2,
  },

  anims: {
    fuse:    { start: 0, end: 2, frameRate:  6 },   // plays once, holds on frame 2
    explode: { start: 3, end: 9, frameRate: 18 },   // faster explosion
  },
} as const;

// ─── Walrus Bot ─────────────────────────────────────────────────────────────
export const WALRUS_BOT = {
  /** Source sheet: Walrus_Bot.png — 512 × 40 px | 8 frames × 64 px */
  frameWidth:  64,
  frameHeight: 40,
  /** Matches PLAYER / PENGUIN_BOT scale for consistent sprite sizes. */
  scale:        1,

  /**
   * Arcade body — the walrus art is wider than the penguin because the
   * propulsor trails behind the body in the walk frames (4-7).  Body is
   * measured around the solid torso, NOT including the trail.
   *
   * Default (left-facing): torso x≈18-46, feet at y=39.
   */
  body: {
    width:   28,
    height:  28,
    offsetX: 18,
    offsetY: 11,
  },

  speed:            50,   // slightly slower than penguin — heavier
  health:            4,   // tougher than penguin (3)
  contactDamage:    1,
  aggroRadius:     320,   // larger — snowball has horizontal range
  attackCooldownMs: 2200,

  /**
   * Frame ranges per user-supplied layout:
   *   0       — idle (single frame hold)
   *   1-3     — shoot (3-frame attack; snowball spawns on the middle frame)
   *   4-7     — walk with propulsor (4-frame loop)
   */
  anims: {
    idle:   { start: 0, end: 0, frameRate:  1 },
    attack: { start: 1, end: 3, frameRate:  8 },   // 3-frame shoot (~375ms)
    walk:   { start: 4, end: 7, frameRate: 10 },   // 4-frame walk cycle
  },

  /** Frame on which the snowball spawns + muzzle flash appears. */
  shootFrame: 2,

  /** Offset from walrus world-center to snowball spawn point (source pixels). */
  shootOffsetX: 18,  // in front of the mouth; sign applied by facing
  shootOffsetY: -4,  // slightly above center

  /** Source sheet for the muzzle flash: Walrus_Bot_Shoot_FX.png — 24 × 16 px | 3 frames × 8 px. */
  shootFx: {
    frameWidth:  8,
    frameHeight: 16,
    frames:      3,
    frameRate:   24,   // whole flash plays in ~125ms
  },
} as const;

// ─── Jetpack Ice Blaster Bot ────────────────────────────────────────────────
export const JETPACK_BOT = {
  /** Source sheet: Jetpack_Ice_Blaster_Bot.png — 240 × 40 px | 6 frames × 40 px */
  frameWidth:  40,
  frameHeight: 40,
  scale:        1,

  /**
   * Three aim poses, each a 2-frame loop.  The pose is chosen per frame based
   * on the angle to the player — the 2-frame loop also serves as the idle
   * animation while the bot hovers between shots.
   *
   *   0-1 : aim SHALLOW  — arm pointing slightly downward (player roughly level)
   *   2-3 : aim DEEP     — arm pointing ~45° down (player well below)
   *   4-5 : aim DOWN     — arm pointing straight down (player directly below)
   *
   * Projectile + muzzle-flash SHEETS are 3 frames × 16 × 16.  The bot picks
   * sheet frame 0 for SHALLOW, 1 for DEEP, 2 for DOWN — same ordering.
   */
  anims: {
    aimShallow: { start: 0, end: 1, frameRate: 6 },
    aimDeep:    { start: 2, end: 3, frameRate: 6 },
    aimDown:    { start: 4, end: 5, frameRate: 6 },
  },

  /** Body — the bot floats; gravity is disabled in setupBody. */
  body: {
    width:   22,
    height:  28,
    offsetX:  9,
    offsetY:  6,
  },

  health:            3,
  contactDamage:     1,
  aggroRadius:     420,   // air threat — wider than ground enemies
  attackCooldownMs: 1500,

  /** Per-axis hover thrust (px/s).  Capped via maxVelocity in setupBody. */
  maxSpeed:   120,
  /**
   * Hover target offset from the player (world pixels).  Negative = ABOVE.
   * 40 px keeps the bot just out of melee range but well within jump-shot
   * reach — the player can jump + fire a horizontal bullet and land hits.
   */
  hoverOffsetY: -40,
  /**
   * Proximity accel — velocity = clamp(diff * thrustGain, ±maxSpeed).
   * 0.08 → floaty drone, 0.2 → aggressive tracker.
   */
  thrustGain:  0.08,
  /**
   * Extra multiplier applied to UPWARD velocity only (negative vy).
   * Makes the bot feel heavier when climbing — it dives fast but rises slow,
   * so the player gets a window to hit it after dropping below.
   */
  riseSlowdown: 0.35,

  /**
   * Angle thresholds (abs(dy) / max(abs(dx), 1)) for aim-pose selection.
   * Below shallowRatio → SHALLOW; up to deepRatio → DEEP; above → DOWN.
   * Tuned so SHALLOW triggers when the player is roughly same-level, and
   * DOWN triggers when nearly-directly below the bot.
   */
  shallowRatio: 0.6,
  deepRatio:    1.8,

  /** Offset from bot world-center to projectile spawn point (source px). */
  shootOffsetX: 12,   // in front of the muzzle; sign applied per facing
  shootOffsetY: 6,    // slightly below center (arm is mid-torso)

  /** Source sheet for the muzzle flash: Jetpack_Ice_Blaster_Bot_Muzzle_Flash.png — 48 × 16 | 3 × 16. */
  shootFx: {
    frameWidth:  16,
    frameHeight: 16,
    frameRate:   20,   // one-shot ~150 ms
  },
} as const;

/** Projectile fired by the jetpack bot.  3 frames × 16×16 — one per aim angle. */
export const JETPACK_BULLET = {
  frameWidth:  16,
  frameHeight: 16,
  scale:        1,

  /**
   * Per-angle velocity vectors (px/s).  Horizontal sign is flipped at fire
   * time to match facing.  Vertical is always positive (downward).
   */
  speedByAngle: {
    shallow: { vx: 260, vy:   60 },
    deep:    { vx: 200, vy:  200 },
    down:    { vx:   0, vy:  320 },
  },

  damage:      1,
  poolSize:    6,

  /** Physics body — centered square, small so projectiles feel sharp. */
  body: {
    width:    8,
    height:   8,
    offsetX:  4,
    offsetY:  4,
  },
} as const;

// ─── Roller Bot ─────────────────────────────────────────────────────────────
export const ROLLER_BOT = {
  /** Source sheet: Roller_Bot.png — 528 × 40 px | 11 frames × 48 × 40 */
  frameWidth:  48,
  frameHeight: 40,
  scale:        1,

  /**
   * Arcade body — sized for the rolling-ball pose (the narrower footprint
   * of the two).  Works well enough for the brief open-up window too.
   */
  body: {
    width:   20,
    height:  28,
    offsetX: 14,
    offsetY: 11,
  },

  speed:            80,    // rolling patrol speed — fairly brisk
  health:            3,
  contactDamage:    1,
  aggroRadius:     280,
  attackCooldownMs: 2500,

  /**
   * Frame layout:
   *   0-7  — rolling ball (loops)
   *   8-10 — opening up (plays once forward, then reversed via yoyo on
   *          attack anim to close back into the ball)
   *
   * The attack anim is a single yoyo animation that plays 8→9→10→10→9→8.
   * Frame 10 is the peak where the bot shoots — gated by `shotFired` flag
   * so the double-hit on frame 10 (apex of yoyo) only fires one bullet.
   */
  anims: {
    roll:   { start: 0, end:  7, frameRate: 14 },
    attack: { start: 8, end: 10, frameRate: 10 },   // yoyo'd — see entity
  },

  /** Spritesheet frame that fires the bullet (and resets `shotFired`). */
  shootFrame: 10,
  /** Offset from bot center to bullet spawn point (source px). */
  shootOffsetX: 14,
  shootOffsetY:  0,
} as const;

/** Roller bot projectile — small spinning bullet (4-frame anim at 8×8). */
export const ROLLER_BULLET = {
  /** Source sheet: Roller_Bot_Bullet.png — 32 × 8 px | 4 frames × 8 × 8 */
  frameWidth:  8,
  frameHeight: 8,
  scale:        1,

  speed:      380,
  damage:       1,
  poolSize:     6,

  body: {
    width:   6,
    height:  4,
    offsetX: 1,
    offsetY: 2,
  },

  /** 4-frame spinning bullet — loops while the bullet is alive. */
  anims: {
    spin: { start: 0, end: 3, frameRate: 18 },
  },
} as const;

// ─── Toxic Barrel Bot ───────────────────────────────────────────────────────
export const TOXIC_BARREL_BOT = {
  /** Source sheet: Toxic_Barrel_Bot.png — 264 × 48 px | 11 frames × 24 × 48 */
  frameWidth:  24,
  frameHeight: 48,
  scale:        1,

  /**
   * Arcade body — the full barrel for contact damage & player collision.
   * The VULNERABILITY window (see ToxicBarrelBot.takeDamage) is gated by
   * the current attack phase, not by a second hitbox, so the physics body
   * stays stable across all frames.
   */
  body: {
    width:   18,
    height:  42,
    offsetX:  3,
    offsetY:  4,
  },

  speed:            0,    // stationary — setFacing tracks the player, no patrol
  health:            4,
  contactDamage:    1,
  aggroRadius:     300,
  attackCooldownMs: 1800,
  /** Stationary turret — no hit-reaction jump-back (would clip it off the floor). */
  hurtKnockback:    0,

  /**
   * Frame layout:
   *   0      — closed / armored (idle between attacks; invulnerable)
   *   1-5    — LOWER hatch opens (1-4 open, 5 close).  Bullet spawns on
   *            frame 3 (middle of the open window) from the LOWER port.
   *   6-10   — UPPER hatch opens.  Bullet spawns on frame 10 (apex) from
   *            the UPPER port.  Vulnerability window — only during this
   *            anim does takeDamage succeed.
   *
   * The bot alternates lower / upper every attack so the player has a
   * consistent rhythm: force an attack, wait for the upper cycle, punish.
   */
  anims: {
    closed: { start: 0, end: 0, frameRate:  1 },
    lower:  { start: 1, end: 5, frameRate:  8 },   // 5 frames ≈ 625 ms
    upper:  { start: 6, end: 10, frameRate: 8 },   // yoyo'd — see entity
  },

  /** Frame indices that trigger the corresponding bullet spawn. */
  lowerShootFrame: 3,
  upperShootFrame: 10,

  /** Source-px offset from bot center for each hatch's muzzle. */
  lowerShootOffsetX:  8,   // mid-barrel horizontally
  lowerShootOffsetY: 10,   // lower third of the sprite
  upperShootOffsetX:  8,
  upperShootOffsetY: -10,  // upper third (negative = above center)
} as const;

/** Toxic goop projectile — 3-frame wobble loop at 16×16. */
export const TOXIC_GOOP = {
  /** Source sheet: Toxic_Goop_Shot.png — 48 × 16 px | 3 frames × 16 × 16 */
  frameWidth:  16,
  frameHeight: 16,
  scale:        1,

  speed:      240,
  damage:       1,
  poolSize:     6,

  body: {
    width:    8,
    height:   8,
    offsetX:  4,
    offsetY:  4,
  },

  /** Wobble anim — loops while the shot is alive. */
  anims: {
    wobble: { start: 0, end: 2, frameRate: 10 },
  },
} as const;

// ─── All-Terrain Missile Bot ────────────────────────────────────────────────
export const ATMB_BOT = {
  /** Source sheet: All_Terrain_Missile_Bot.png — 384 × 40 px | 8 frames × 48 × 40 */
  frameWidth:  48,
  frameHeight: 40,
  scale:        1,

  /**
   * Body — sized for the tank's tread footprint (the wide lower section).
   * Feet (offsetY + height) intentionally equal the frame height (40) so
   * the sprite bottom aligns with the body bottom and the tank doesn't
   * clip into the floor tile.
   */
  body: {
    width:   36,
    height:  22,
    offsetX:  6,
    offsetY: 18,   // 18 + 22 = 40 (frame bottom) — no floor sink
  },

  speed:            55,
  health:            4,
  contactDamage:    1,
  aggroRadius:     360,
  attackCooldownMs: 2800,

  /**
   * Frame layout:
   *   0-3 — walk (4-frame tread loop; bot faces LEFT by default)
   *   4-7 — turn pivot (plays once at patrol edge before the sprite flips)
   *
   * Patrol override: on reaching a bound, ATMB plays the TURN anim (bot
   * stopped), then flips facing + resumes the walk loop.
   */
  anims: {
    walk: { start: 0, end: 3, frameRate:  8 },
    turn: { start: 4, end: 7, frameRate: 10 },
  },

  /**
   * Cannon muzzle offset (source pixels).  The cannon sits on TOP of the
   * tank, so Y is negative (above body center) and X is near-zero
   * (horizontally centered cannon).
   */
  shootOffsetX: 0,
  shootOffsetY: -12,

  /** Initial launch velocity (world px/s).  Gravity arcs it down. */
  shootVelX: 150,    // horizontal — sign flipped by facing at fire time
  shootVelY: -360,   // upward (negative = up)
} as const;

/**
 * Cannon ball fired by ATMB — ballistic arc, lands, sits, blinks, vanishes.
 * Damages the player on contact at any point in its life.
 */
export const CANNON_BALL = {
  frameWidth:  16,
  frameHeight: 16,
  /**
   * Slightly smaller than the 1.75 standard so the ball reads as a sub-
   * projectile not a main character.
   */
  scale:        1,

  damage:       1,
  poolSize:     4,

  /** Arcade body — tight circle-ish hitbox centered on the 16×16 frame. */
  body: {
    width:   10,
    height:  10,
    offsetX:  3,
    offsetY:  3,
  },

  /** Bounce coefficient on ground contact.  0 = thud, 0.3 = slight bounce. */
  bounce: 0.25,

  /** Horizontal drag (px/s²) applied once the ball touches the ground so it
   *  rolls a short distance then settles instead of skating forever. */
  landedDragX: 420,

  /** ms after landing before the fade-out blink starts. */
  landedStaticMs: 1500,
  /** ms the blink runs before the ball vanishes. */
  blinkMs:        1000,
  /** Alpha period for the blink (one on+off cycle). */
  blinkPeriodMs:  120,
  /** Alpha the ball fades to during the "off" phase of the blink. */
  blinkDimAlpha:  0.3,
} as const;

// ─── Nuclear Monkey Boss ────────────────────────────────────────────────────
export const NUCLEAR_MONKEY = {
  /** Source sheet: Nuclear_Monkey_Boss.png — 608 × 160 px | 4 frames × 152 × 160 */
  frameWidth:  152,
  frameHeight: 160,
  scale:         1,

  /**
   * Body — torso footprint only.  The boss is huge and stationary; the
   * body is sized so the player can stand nearby to shoot without being
   * perpetually damaged by contact.  Feet line up with frame bottom.
   */
  body: {
    width:   72,
    height:  104,
    offsetX: 40,
    offsetY: 56,   // 56 + 104 = 160 (frame bottom) — no floor sink
  },

  speed:            0,     // stationary — no patrol
  health:           12,    // boss HP
  contactDamage:    2,
  aggroRadius:     640,   // big presence
  attackCooldownMs: 2200,
  /** Stationary boss — no hit-reaction jump-back. */
  hurtKnockback:    0,

  /**
   * Frame layout:
   *   0    — idle (held; the "jumpy" bob is driven by a y-tween, not frames)
   *   1-3  — attack (grab → stance → throw).  Ball spawns on frame 3.
   */
  anims: {
    idle:   { start: 0, end: 0, frameRate: 1 },
    attack: { start: 1, end: 3, frameRate: 6 },
  },

  /** Frame that fires the ball — resets `shotFired` per attack. */
  throwFrame: 3,

  /**
   * Ball spawn offset from the boss' world-center (source px).  Positive X
   * is in front; sign flipped by facing.  Negative Y = above center (the
   * boss' arms).
   */
  throwOffsetX: 40,
  throwOffsetY: -40,

  /** Initial ball launch velocity.  Gravity arcs it naturally. */
  throwVelX: 220,
  throwVelY: -260,
} as const;

/** Monkey ball — big bouncy rolling projectile thrown by the Nuclear Monkey. */
export const MONKEY_BALL = {
  /** Source: Monkey_Ball.png — 64 × 64 single frame. */
  frameWidth:  64,
  frameHeight: 64,
  scale:        1,

  damage:       2,
  poolSize:     4,

  /** Tight-ish hitbox — circle inscribed in the 64×64 frame. */
  body: {
    width:   48,
    height:  48,
    offsetX:  8,
    offsetY:  8,
  },

  /** High bounce so the ball "rolls" after the initial throw arc. */
  bounceX: 1,      // no horizontal velocity loss → keeps rolling
  bounceY: 0.55,   // loses ~45 % per floor hit, settles in a few bounces

  /** Kill timer — ball self-destructs if it hasn't been cleaned up by then. */
  lifetimeMs: 6000,
} as const;

// ─── Walrus Snow Ball ───────────────────────────────────────────────────────
export const WALRUS_SNOWBALL = {
  /** Source: Walrus_Bot_Snow_Ball.png — 16 × 16 px, single frame. */
  frameWidth:  16,
  frameHeight: 16,
  scale:        1,

  /** Horizontal-only travel — gravity is disabled on the body. */
  speed:     260,   // px/s
  damage:      1,
  poolSize:    6,

  /** Physics body — small centered square. */
  body: {
    width:   10,
    height:  10,
    offsetX:  3,
    offsetY:  3,
  },
} as const;
