/**
 * fxSystem.ts — Reusable particle + screen-shake FX for charged-shot feedback.
 *
 * Nothing here is gameplay-critical; it's pure juice for the charge / fire
 * sequence.  Textures are generated at runtime so this module doesn't rely
 * on any preloaded asset beyond what Phaser itself ships with.
 *
 * Public API:
 *   ensureFxTextures(scene)                      — creates 'fx_spark' once.
 *   attachChargeEmitter(scene, player)           — follows the player and
 *       ramps emission rate / color with player.chargeRatio.
 *   fireMuzzleFlash(scene, x, y, facingRight, tier) — one-shot burst at the
 *       muzzle + proportional camera shake.
 */
import * as Phaser from 'phaser';
import type { Player } from '../entities/Player';

const SPARK_KEY = 'fx_spark';

/** Charge tint thresholds (matches Player.updateChargeVisual colors). */
const CHARGE_COLOR = {
  low:  0x88ccff,   // cool blue as the charge becomes visible
  full: 0xffee66,   // warm yellow at full
};

/**
 * Generate the shared white-circle spark texture the first time it's needed.
 * Safe to call repeatedly — the key check prevents duplicate textures.
 */
export function ensureFxTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(SPARK_KEY)) return;
  const size = 8;
  const g = scene.add.graphics({ x: 0, y: 0 });
  g.fillStyle(0xffffff, 1);
  g.fillCircle(size / 2, size / 2, size / 2);
  g.generateTexture(SPARK_KEY, size, size);
  g.destroy();
}

/**
 * Particle ring that follows the player.  We emit from points on a circle
 * around the player ("inhaled into" the player via moveTo) so the visual
 * reads as energy gathering at the muzzle before a charged shot.
 *
 * The caller is responsible for ticking this via the returned `update()`
 * each frame so emission rate / tint stay in sync with the charge ratio.
 */
export function attachChargeEmitter(
  scene:  Phaser.Scene,
  player: Player,
): { emitter: Phaser.GameObjects.Particles.ParticleEmitter; update: () => void; destroy: () => void } {
  ensureFxTextures(scene);

  const emitter = scene.add.particles(0, 0, SPARK_KEY, {
    lifespan: 350,
    scale:    { start: 0.9, end: 0 },
    alpha:    { start: 0.9, end: 0 },
    blendMode: 'ADD',
    tint:      CHARGE_COLOR.low,
    // Emit on a circle around the player and draw inward toward center so
    // particles read as energy being gathered.  moveToX/Y set to (0,0) =
    // emitter-local origin = player center (after startFollow).
    emitZone: {
      type: 'edge',
      source: new Phaser.Geom.Circle(0, 0, 22),
      quantity: 32,
      seamless: true,
      yoyo: false,
    },
    moveToX: 0,
    moveToY: 0,
    frequency: -1, // manually control via flow/stop + setFrequency
    emitting: false,
  });
  emitter.setDepth(50); // above the player sprite
  emitter.startFollow(player, 0, 0, true);

  let emittingState = false;

  const update = (): void => {
    const r = player.chargeRatio; // 0..1
    if (r < 0.15) {
      // Below visual threshold — ensure emitter is silent.
      if (emittingState) {
        emitter.stop();
        emittingState = false;
      }
      return;
    }

    // Fade in emission rate as we charge up.
    // Freq in ms between emissions — lower = more particles per second.
    const freq = Phaser.Math.Linear(80, 20, Math.min(1, r));
    emitter.setFrequency(freq, 1);

    // Tint shifts to warm-yellow when we cross the full-charge line.
    emitter.setParticleTint(r >= 1 ? CHARGE_COLOR.full : CHARGE_COLOR.low);

    if (!emittingState) {
      emitter.start();
      emittingState = true;
    }
  };

  const destroy = (): void => {
    emitter.stop(true);
    emitter.destroy();
  };

  return { emitter, update, destroy };
}

/**
 * One-shot burst of sparks + camera shake when a charged / full-charged
 * bullet is fired.  Burst cone is aimed in the facing direction so the
 * particles shoot forward (+ lingering radial spread for drama).
 *
 * Re-uses a pooled emitter per (scene, tier) to avoid alloc churn on rapid fire.
 */
const MUZZLE_POOL = new WeakMap<
  Phaser.Scene,
  Record<'charged' | 'full_charged', Phaser.GameObjects.Particles.ParticleEmitter>
>();

function getMuzzleEmitter(
  scene: Phaser.Scene,
  tier:  'charged' | 'full_charged',
): Phaser.GameObjects.Particles.ParticleEmitter {
  let cache = MUZZLE_POOL.get(scene);
  if (!cache) {
    cache = {} as Record<'charged' | 'full_charged', Phaser.GameObjects.Particles.ParticleEmitter>;
    MUZZLE_POOL.set(scene, cache);
  }
  if (cache[tier]) return cache[tier];

  ensureFxTextures(scene);
  const isFull = tier === 'full_charged';
  const emitter = scene.add.particles(0, 0, SPARK_KEY, {
    lifespan: isFull ? 500 : 350,
    speed:    isFull ? { min: 80, max: 280 } : { min: 50, max: 180 },
    scale:    { start: isFull ? 1.6 : 1.2, end: 0 },
    alpha:    { start: 1, end: 0 },
    blendMode: 'ADD',
    tint:      isFull ? CHARGE_COLOR.full : CHARGE_COLOR.low,
    frequency: -1,
    emitting:  false,
  });
  emitter.setDepth(55);
  cache[tier] = emitter;
  return emitter;
}

/**
 * Slide dust — small puff of particles kicked out behind the player while
 * sliding.  Only emits when `player.currentState === 'slide'`; the caller
 * ticks via the returned `update()` each frame.
 */
export function attachSlideDust(
  scene:  Phaser.Scene,
  player: Player,
): { emitter: Phaser.GameObjects.Particles.ParticleEmitter; update: () => void; destroy: () => void } {
  ensureFxTextures(scene);

  const emitter = scene.add.particles(0, 0, SPARK_KEY, {
    lifespan: 300,
    // Travels opposite the slide direction — angle + speedX flipped each
    // emit based on player.flipX (see update()).
    speed:    { min: 30, max: 70 },
    scale:    { start: 0.6, end: 0 },
    alpha:    { start: 0.7, end: 0 },
    tint:     0xb8a070,      // dusty tan
    blendMode: 'NORMAL',
    frequency: -1,
    emitting:  false,
  });
  emitter.setDepth(15);       // above the ground, below the player sprite
  // Offset: feet of the player (player origin is center; feet ≈ +16 in source px × scale).
  emitter.startFollow(player, 0, 18, true);

  let sliding = false;

  const update = (): void => {
    const isSliding = player.currentState === 'slide';

    if (isSliding) {
      // Dust trails BEHIND the slide.  flipX=true means facing right and
      // sliding right; the dust should fly left (angle 180).
      const forwardDeg = player.flipX ? 180 : 0;
      emitter.setEmitterAngle({ min: forwardDeg - 15, max: forwardDeg + 15 });
      if (!sliding) {
        emitter.setFrequency(40, 1); // small, steady stream
        emitter.start();
        sliding = true;
      }
    } else if (sliding) {
      emitter.stop();
      sliding = false;
    }
  };

  const destroy = (): void => {
    emitter.stop(true);
    emitter.destroy();
  };

  return { emitter, update, destroy };
}

export function fireMuzzleFlash(
  scene:       Phaser.Scene,
  x:           number,
  y:           number,
  facingRight: boolean,
  tier:        'charged' | 'full_charged',
): void {
  const emitter = getMuzzleEmitter(scene, tier);
  const isFull  = tier === 'full_charged';

  // Aim cone: narrow spread around the facing direction.
  const forwardDeg = facingRight ? 0 : 180;
  const spreadDeg  = isFull ? 55 : 40;
  emitter.setEmitterAngle({
    min: forwardDeg - spreadDeg / 2,
    max: forwardDeg + spreadDeg / 2,
  });

  emitter.emitParticleAt(x, y, isFull ? 22 : 14);

  // Camera shake — proportional to tier.  Duration is short so it doesn't
  // fight with gameplay readability.
  scene.cameras.main.shake(
    isFull ? 220 : 120,
    isFull ? 0.009 : 0.004,
  );
}
