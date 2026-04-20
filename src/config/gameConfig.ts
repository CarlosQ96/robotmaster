/**
 * gameConfig.ts — Central, composable game configuration.
 *
 * Import named exports where needed.
 * Change a value here and it propagates everywhere automatically.
 * Nothing game-critical should be hard-coded in scenes or entities.
 */

// ─── Display ────────────────────────────────────────────────────────────────
export const DISPLAY = {
  /** Logical canvas resolution (before browser scaling via Phaser.Scale.FIT) */
  width: 960,
  height: 540,
  backgroundColor: '#0d0f14',
} as const;

// ─── Tile ───────────────────────────────────────────────────────────────────
export const TILE = {
  /**
   * NES source tile size (the PNG is drawn at 8px/tile).
   * Used for texture/tileset loading references.
   */
  sourceSize: 8,

  /**
   * Effective display tile size in world pixels.
   * 32 = 4× NES scale.  Change this one number to re-scale the whole world.
   *
   * At 32px tiles:
   *   - Player renders at ~48×96 px (24×2, 48×2) → ~1.5 × 3 tiles tall
   *   - Scene is 1920×540 → 60 × 16.9 tiles
   */
  size: 32,

  /** Computed: how many times bigger display is vs source */
  get scale(): number {
    return this.size / this.sourceSize; // 4 at default settings
  },
} as const;

// ─── World ──────────────────────────────────────────────────────────────────
export const WORLD = {
  /** Total scrollable world size (wider than the viewport for side-scrolling) */
  width: 1920,
  height: 540,
} as const;

// ─── Physics ────────────────────────────────────────────────────────────────
export const PHYSICS = {
  /** Downward gravity in px/s² */
  gravityY: 980,
} as const;

// ─── Player ─────────────────────────────────────────────────────────────────
export const PLAYER = {
  /**
   * Native frame dimensions — measured from the PNG.
   * Sheet: Playable_Character_Default_Colors.png → 1200×48 px
   * 25 frames × 48 px = 1200 px wide.  Each frame is square (48×48).
   */
  frameWidth: 48,
  frameHeight: 48,

  /**
   * Visual render scale applied to the sprite at runtime.
   *   1    → 48×48 on screen (character body ≈ 0.6×0.8 tiles — tiny).
   *   1.5  → 72×72 — fractional; 3 source px → 4 or 5 screen px.
   *   1.8  → 86.4×86.4 — fractional; slight shearing, but reads well in-world.
   *   2    → 96×96 — classic NES ratio; cleanest pixels.
   *
   * Phaser's setScale also scales the physics body, so body.width/height
   * stay in SOURCE pixels and render scaled.  Anything that adds source-
   * pixel offsets to `sprite.x/y` (projectile muzzle positions) must
   * multiply by this scale manually — see Player.emit*Shot.
   *
   * Bullets, enemies, and enemy projectiles all track this value so sprite
   * sizes stay consistent — see PENGUIN_BOT.scale, Bullet.ts, ChargedBullet.ts.
   */
  scale: 1.75,

  /**
   * Standing arcade body (LOCAL / pre-scale pixels, measured from actual PNG).
   * idle frame:  pixels at x=16-39, y=16-39 in the 48×48 frame.
   * Feet sit at frame y=39 across all frames (8px transparent below).
   */
  body: {
    width:   20,   // tight fit around torso
    height:  25,   // y=14→39: top sits 1px above character head (min top=15 across idle+run frames)
    offsetX: 17,   // centers body on character center x≈27 (left-facing)
    offsetY: 14,   // was 9 — previous value left 6px phantom hitbox above the head
  },

  /**
   * Crouching / sliding body — reduces upper collision so the player can
   * pass under low obstacles.
   * crouch frame (15): pixels at x=8-40, y=19-39 (character is centered).
   * slide  frame (16): pixels at x=11-38, y=21-39 (similar profile).
   * We use the crouch dimensions for both states.
   */
  crouchBody: {
    width:   24,  // crouched pose is wider (arms out); character center x=24
    height:  18,  // y=21→39: ~40% less height than standing
    offsetX: 12,  // (48−12−24)/2 = 6 right margin — character is centered so both flips = 12
    offsetY: 21,
  },

  /** Horizontal walk/run speed in world px/s */
  speed: 200,

  /** Slide speed in world px/s — higher = longer distance (duration set by animConfig slide.frameRate) */
  slideSpeed: 480,

  /**
   * Vertical jump impulse (negative = upward).
   * Tune together with PHYSICS.gravityY to get the feel right.
   * Rule of thumb: jumpVelocity ≈ -sqrt(2 * gravity * desiredApexHeight)
   */
  jumpVelocity: -480,

  maxHealth: 5,

  /**
   * Hurt knockback (px/s).  Kept small + short so the impulse can't combine
   * with gravity to tunnel through the 16-px-thick platform bodies in GymScene.
   * At 60fps with a 100-ms take_damage lock, max travel is ~14 px horizontal
   * and ~13 px vertical — well inside a single platform's physics body.
   */
  hurtKnockbackX: 100,
  hurtKnockbackY: -140,
  invulnMs: 1000,
} as const;

// ─── Camera ─────────────────────────────────────────────────────────────────
export const CAMERA = {
  /**
   * Follow lerp: 0 = never catches up, 1 = instant snap.
   * Lower X for smooth horizontal pan, slightly tighter Y.
   */
  lerpX: 0.1,
  lerpY: 0.12,

  /**
   * Deadzone: the player can move this many px in each axis
   * before the camera starts chasing.
   */
  deadzoneW: 120,
  deadzoneH: 60,

  /**
   * Camera vertical offset in world pixels.
   * Negative = camera looks slightly above the player's feet,
   * giving a better view of what's above.
   */
  offsetY: -40,
} as const;

// ─── Projectile ─────────────────────────────────────────────────────────────
export const PROJECTILE = {
  small: {
    /** Horizontal travel speed in world px/s */
    speed: 600,

    /**
     * Horizontal distance from the player's world-center (x) to the gun muzzle tip.
     * Measured from spritesheet: gun tip at frame x=7, sprite center at x=24 → 17 px.
     * Set to 16 (1px inside the tip) so the bullet visually emerges from the barrel
     * rather than spawning ahead of it — especially noticeable at high bullet speed.
     */
    muzzleOffsetX: 16,

    /**
     * Vertical offset from the player's world-center (y) to the gun barrel center.
     * Measured per shooting frame (muzzle at col 7, sprite center y=24):
     *   shoot (frame 7)     → barrel rows 26-27, cy=26.5, offset=+2.5
     *   shoot_run (frame 9) → barrel rows 26-27, cy=26.5, offset=+2.5
     *   jump_shoot (frame 13) → barrel rows 21-22, cy=21.5, offset=-2.5
     * Using +3 (rounds +2.5 up) so the bullet aligns with standing/run-shoot barrel.
     * jump_shoot uses a different pose so its offset naturally differs.
     */
    muzzleOffsetY: 3,

    /**
     * Physics body — derived from Playable_Projectile_Small.png (16×16).
     * Opaque pixels: (4,5)→(12,11) — 8 × 6 px, centered in the 16×16 texture.
     */
    bodyWidth:   8,
    bodyHeight:  6,
    bodyOffsetX: 4,
    bodyOffsetY: 5,

    /**
     * Vertical muzzle offset for crouching/sliding states.
     * Crouch frame (15): leftmost arm at col 8, rows 28-29, cy=28.5 → offset = +4.5 → 5.
     * (vs standing: col 7, cy=26.5, offset=+2.5 → 3 used by muzzleOffsetY above)
     */
    crouchMuzzleOffsetY: 5,

    /**
     * Maximum bullets that can exist at once (active + pooled).
     * New bullets are created on demand up to this cap; excess shots are silently dropped.
     */
    poolSize: 20,

    damage: 1,

    /**
     * Minimum delay between spawned bullets in milliseconds.
     * Exposed as a public property on Player so it can be tuned at runtime.
     * Set to 0 to remove rate limiting entirely.
     */
    shootCooldownMs: 100,
  },

  /**
   * Charged shot — Playable_Projectile_Charged.png
   * Sheet: 32×16 | 2 frames × 16×16
   * Opaque bounds per frame: x≈3–13, y=4–11  →  body 10×7 @ (3,4)
   */
  charged: {
    speed:      750,
    muzzleOffsetX:       16,
    muzzleOffsetY:        3,
    crouchMuzzleOffsetY:  5,
    bodyWidth:   10,
    bodyHeight:   7,
    bodyOffsetX:  3,
    bodyOffsetY:  4,
    poolSize:     5,
    animFps:      6,   // 2 frames @ 6fps → ~333ms cycle
    damage:       2,
  },

  /**
   * Full-charge shot — Playable_Projectile_Full_Charge.png
   * Sheet: 32×16 | 2 frames × 16×16
   * Opaque bounds per frame: x≈1–14, y=3–12  →  body 13×9 @ (1,3)
   */
  fullCharged: {
    speed:      900,
    muzzleOffsetX:       16,
    muzzleOffsetY:        3,
    crouchMuzzleOffsetY:  5,
    bodyWidth:   13,
    bodyHeight:   9,
    bodyOffsetX:  1,
    bodyOffsetY:  3,
    poolSize:     3,
    animFps:      4,   // 2 frames @ 4fps → ~500ms cycle (slower, more imposing)
    damage:       3,
  },

  /** Timing thresholds for the charge system (in milliseconds). */
  chargeTime: {
    /**
     * Minimum Z hold to fire a charged shot instead of a small one.
     * Below this the player barely tapped → small bullet via animation.
     * Must be > Player.CHARGE_VISUAL_DELAY (500ms) so the white-blink
     * visual appears BEFORE the charge threshold is crossed — giving
     * the player a clear warning window.
     */
    minCharge:  800,
    /**
     * Hold time that triggers a full-charge shot.
     * Character blinks once this threshold is crossed.
     */
    fullCharge: 3000,
  },
} as const;

// ─── Audio ──────────────────────────────────────────────────────────────────
/**
 * Audio system — three volume buses (master, music, sfx) and two catalogs.
 *
 * Effective playback volume per sound =
 *   bus[category] × master × sound.volume
 *
 * BootScene iterates the `sfx` / `music` entries to auto-preload every
 * declared key.  The AudioManager gracefully no-ops if a key isn't in the
 * cache yet — so you can wire call sites before the audio files exist.
 *
 * File convention under public/assets/audio/:
 *   sfx/<key>.{webm,mp3}     music/<key>.{webm,mp3}
 * Provide BOTH formats — browsers auto-pick; webm on Firefox/Chrome, mp3 on Safari.
 */
export const AUDIO = {
  /** localStorage key for persisted volume / mute settings. */
  persistKey: 'robot-lords:audio',

  /** Crossfade duration when swapping music tracks (ms). */
  crossfadeMs: 500,

  /** Volume buses.  `defaultVolume` seeds persisted state on first run. */
  buses: {
    master: { defaultVolume: 0.8 },
    music:  { defaultVolume: 0.6 },
    sfx:    { defaultVolume: 0.9 },
  },

  /**
   * One-shot sound effects.  `volume` is the per-clip default (0–1) multiplied
   * in on top of the bus volumes.  Keep these tuned so raw playback is even
   * before the user touches master/sfx.
   */
  sfx: {
    jump:         { key: 'sfx-jump',          volume: 0.6 },
    slide:        { key: 'sfx-slide',         volume: 0.7 },
    shoot:        { key: 'sfx-shoot',         volume: 0.4 },
    shootCharged: { key: 'sfx-shoot-charged', volume: 0.55 },
    shootFull:    { key: 'sfx-shoot-full',    volume: 0.7 },
    hit:          { key: 'sfx-hit',           volume: 0.6 },  // projectile → enemy
    hurt:         { key: 'sfx-hurt',          volume: 0.8 },  // player damaged
    enemyHit:     { key: 'sfx-enemy-hit',     volume: 0.6 },
  },

  /** Looping background tracks.  Only one plays at a time (crossfade on swap). */
  music: {
    title: { key: 'music-title', volume: 1.0 },
    gym:   { key: 'music-gym',   volume: 1.0 },
  },
} as const;

/** Derived types for compile-time checking of sfx / music call sites. */
export type SfxKey   = keyof typeof AUDIO.sfx;
export type MusicKey = keyof typeof AUDIO.music;

// ─── Debug ──────────────────────────────────────────────────────────────────
export const DEBUG = {
  /** Master on/off — set false for a clean build */
  enabled: true,

  /** Show Arcade physics body outlines (expensive — toggle with [P] at runtime) */
  showPhysicsBodies: false,
  /** World-space grid overlay */
  showGrid: true,
  /** Mouse world-coord / tile-coord label */
  showMouseCoords: true,
  /** Player state, velocity, position panel */
  showPlayerInfo: true,
  /** FPS counter */
  showFPS: true,

  /** Grid cell size (defaults to TILE.size so the grid = tilemap grid) */
  gridSize: TILE.size,

  gridColor: 0x2244aa as number,
  gridAlpha: 0.18,

  panelBg: 0x000000 as number,
  panelAlpha: 0.7,
  textColor: '#00ff99',
  labelColor: '#6688aa',
  warnColor: '#ffcc00',
  accentColor: '#4488ff',

  /**
   * Runtime keyboard shortcuts (all toggleable without reloading).
   * Using string literals so they match Phaser keydown-KEY event names.
   */
  keys: {
    togglePhysics: 'P',
    toggleGrid: 'G',
    togglePanel: 'D',
    /**
     * Frame-step mode:
     *   [F]       → pause/resume player animations
     *   [.]       → advance one frame  (while paused)
     *   [,]       → go back one frame   (while paused)
     */
    frameStep: 'F',
    frameNext: 'PERIOD',
    framePrev: 'COMMA',
    /** [M] mute/unmute music bus; [N] mute/unmute sfx bus. */
    toggleMusicMute: 'M',
    toggleSfxMute:   'N',
  },
} as const;
