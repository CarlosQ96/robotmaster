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
