/**
 * RemoteProjectile.ts — Presentation-only sprite for a networked projectile.
 *
 * Handles every projectile class on the client side uniformly.  The real
 * simulation (Bullet / ChargedBullet / PenguinBomb / CannonBall / MonkeyBall
 * / JetpackBullet / RollerBullet / ToxicGoopShot / WalrusSnowball) runs on
 * the host only — they own physics, bouncing, lifetimes, and damage
 * callbacks.  The host re-exports each projectile's state in a common
 * shape (`ProjectileSyncState`) and clients reify them as these sprites.
 *
 * We intentionally *don't* give this class a physics body.  Bullet paths
 * arrive at the client already kinematically resolved by the host.  If
 * prediction is added later, this file will grow a `velocity` field and a
 * local update() — for v1 it's pure reconciliation.
 */
import * as Phaser from 'phaser';

export type ProjectileType =
  | 'small'            // Bullet
  | 'charged'
  | 'full_charged'
  | 'penguin_bomb'
  | 'cannon_ball'
  | 'monkey_ball'
  | 'jetpack_bullet'
  | 'roller_bullet'
  | 'toxic_goop'
  | 'walrus_snowball';

export interface ProjectileSyncState {
  type:     ProjectileType;
  /** Texture cache key — lets clients render any type with one class. */
  textureKey: string;
  x:        number;
  y:        number;
  flipX:    boolean;
  rotation: number;           // for rolling monkey/cannon balls
  /** Optional anim key (wobbling goop etc.).  Empty string = no anim. */
  animKey:  string;
  alpha:    number;
  visible:  boolean;
  scale:    number;
}

export class RemoteProjectile extends Phaser.GameObjects.Sprite {
  readonly entityId: string;
  readonly type:     ProjectileType;

  private lastAnimKey = '';

  constructor(scene: Phaser.Scene, entityId: string, state: ProjectileSyncState) {
    super(scene, state.x, state.y, state.textureKey);
    this.entityId = entityId;
    this.type     = state.type;

    scene.add.existing(this);
    this.setScale(state.scale);
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';
    this.applyState(state);
  }

  applyState(s: ProjectileSyncState): void {
    this.setPosition(s.x, s.y);
    this.setFlipX(s.flipX);
    this.setRotation(s.rotation);
    this.setAlpha(s.alpha);
    this.setVisible(s.visible);

    if (s.animKey && s.animKey !== this.lastAnimKey) {
      this.lastAnimKey = s.animKey;
      this.play(s.animKey, true);
    }
  }
}
