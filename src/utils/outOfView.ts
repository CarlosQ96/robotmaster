/**
 * outOfView.ts — Reusable off-screen cull utility.
 *
 * Usage (call once per update):
 *
 *   import { cullOffscreen } from '../utils/outOfView';
 *
 *   // Kill any active bullet that leaves the camera viewport
 *   cullOffscreen<Bullet>(bulletGroup, this.cameras.main, b => b.kill());
 *
 *   // Despawn enemies with a generous 128px buffer so they don't pop on entry
 *   cullOffscreen<Enemy>(enemyGroup, this.cameras.main, e => e.despawn(), 128);
 *
 * Works with any Phaser.GameObjects.Group whose members have numeric x/y.
 * Only active members are checked, so pooled/inactive objects are free.
 */
import * as Phaser from 'phaser';

/**
 * Scan `group` and call `onLeave(member)` for every active member whose
 * world position falls outside the camera's current worldView rectangle.
 *
 * @param group   Any Phaser group (Physics.Arcade.Group, plain Group, etc.)
 * @param camera  The camera defining the viewport — typically `cameras.main`
 * @param onLeave Callback invoked per member that has left the view
 * @param margin  Extra world-px buffer around the viewport (default 0)
 *                Use a positive value to let objects travel slightly off-screen
 *                before being culled (avoids visible pop-out at screen edges).
 */
export function cullOffscreen<T extends Phaser.GameObjects.GameObject>(
  group: Phaser.GameObjects.Group,
  camera: Phaser.Cameras.Scene2D.Camera,
  onLeave: (member: T) => void,
  margin = 0,
): void {
  const { x, y, width, height } = camera.worldView;
  const left   = x - margin;
  const right  = x + width  + margin;
  const top    = y - margin;
  const bottom = y + height + margin;

  for (const child of group.getChildren()) {
    if (!child.active) continue;
    const s = child as unknown as { x: number; y: number };
    if (s.x < left || s.x > right || s.y < top || s.y > bottom) {
      onLeave(child as T);
    }
  }
}
