/**
 * gymWorld.ts — Shared world definition for the hand-authored gym level.
 *
 * GymScene (solo) and MpGymScene (networked) both build the same platform
 * layout + hard-coded enemy roster from this file.  Keeps the two scenes
 * in sync without duplicating the data.
 */
import * as Phaser from 'phaser';
import { WORLD } from '../config/gameConfig';
import type { EnemyPlacement } from '../utils/TilemapLoader';

export interface PlatformDef {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

/** World-space rectangles that serve as static Arcade bodies. */
export const GYM_PLATFORMS: PlatformDef[] = [
  // Floor
  { x: 0,    y: 508, w: 1920, h: 32, label: 'FLOOR' },
  // Left side
  { x: 208,  y: 460, w: 72,  h: 16 },
  { x: 96,   y: 384, w: 208, h: 16, label: 'ZONE A' },
  // Left-center
  { x: 352,  y: 320, w: 208, h: 16, label: 'ZONE B' },
  { x: 624,  y: 392, w: 72,  h: 16 },
  // Center apex
  { x: 720,  y: 240, w: 480, h: 16, label: 'ZONE C — APEX' },
  // Right-center (mirror)
  { x: 1248, y: 392, w: 72,  h: 16 },
  { x: 1360, y: 320, w: 208, h: 16, label: 'ZONE D' },
  // Right side (mirror)
  { x: 1616, y: 384, w: 208, h: 16, label: 'ZONE E' },
  { x: 1640, y: 460, w: 72,  h: 16 },
];

/** Fixed spawn position used by GymScene and MpGymScene's host roster. */
export const GYM_SPAWN = { x: 128, y: 400 };

/** Hard-coded enemy roster — shape matches LevelData.enemies so MpPlayScene's
 *  spawnEnemiesFromLevel can consume it directly. */
export const GYM_ENEMIES: EnemyPlacement[] = [
  { id: 'gym-penguin-1', type: 'penguin_bot', x: 400, y: 460, patrolL: 300,  patrolR: 560  },
  { id: 'gym-penguin-2', type: 'penguin_bot', x: 800, y: 460, patrolL: 700,  patrolR: 960  },
  { id: 'gym-walrus',    type: 'walrus_bot',  x: 1460, y: 460, patrolL: 1360, patrolR: 1568 },
  { id: 'gym-jetpack',   type: 'jetpack_bot', x: 960,  y: 180 },
  { id: 'gym-roller',    type: 'roller_bot',  x: 180,  y: 460, patrolL: 100,  patrolR: 304  },
  { id: 'gym-toxic',     type: 'toxic_barrel_bot', x: 380,  y: 278 },
  { id: 'gym-atmb',      type: 'atmb_bot',    x: 1080, y: 460, patrolL: 1000, patrolR: 1200 },
  { id: 'gym-monkey',    type: 'nuclear_monkey_boss', x: 1760, y: 430 },
];

export const GYM_WORLD_SIZE = { width: WORLD.width, height: WORLD.height };

/**
 * Build all gym platform bodies on a scene and return an array of the
 * invisible static Rectangle game-objects.  Caller then collides
 * entities against each body.  Visual rendering (colored outlines, labels)
 * is left to the solo GymScene — MpGymScene skips it.
 */
export function buildGymPlatformBodies(scene: Phaser.Scene): Phaser.GameObjects.Rectangle[] {
  const bodies: Phaser.GameObjects.Rectangle[] = [];
  for (const def of GYM_PLATFORMS) {
    const rect = scene.add
      .rectangle(def.x + def.w / 2, def.y + def.h / 2, def.w, def.h, 0x000000, 0)
      .setOrigin(0.5);
    scene.physics.add.existing(rect, true); // static body
    bodies.push(rect);
  }
  return bodies;
}
