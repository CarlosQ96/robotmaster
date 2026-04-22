/**
 * RemotePlayer.ts — Presentation-only sprite for a networked player.
 *
 * This class is deliberately NOT a subclass of `Player`.  Player owns
 * simulation state: input reading, physics, timers, HP, damage, charge,
 * animation-frame event emissions that spawn bullets.  All of those are
 * host-only concerns.
 *
 * RemotePlayer is a dumb sprite.  Its only behaviour is:
 *   - Hold the same texture / scale / body-origin as the real Player so it
 *     looks identical on screen.
 *   - Reconcile its position / animation / tint / alpha from a
 *     `PlayerSyncState` each time the client receives an authoritative
 *     snapshot from the host.
 *
 * Because it has no update(), no input, no listeners, it cannot accidentally
 * spawn bullets on the client or mutate any other game state.
 *
 * Created per remote user on client scenes.  One-per-user, not pooled.
 */
import * as Phaser from 'phaser';
import { PLAYER } from '../config/gameConfig';

export interface PlayerSyncState {
  x:        number;
  y:        number;
  flipX:    boolean;
  animKey:  string;
  alpha:    number;
  tint:     number;
  tintMode: number;       // Phaser.TintModes.MULTIPLY | FILL
  visible:  boolean;
  /** Authoritative display HP (client shows in HUD; not used for combat). */
  hp:       number;
  /** Player state tag — forwarded for debug / HUD conveniences. */
  stateTag: string;
}

export class RemotePlayer extends Phaser.GameObjects.Sprite {
  /** User id of the player this sprite represents. */
  readonly userId:   string;
  /** Most recent HP we were told about; HUD reads this. */
  displayHp: number = PLAYER.maxHealth;
  /** Last state tag — consumers can branch on this for UI overlays. */
  stateTag: string = 'idle';

  private lastAnimKey = '';

  constructor(scene: Phaser.Scene, userId: string, textureKey: string) {
    super(scene, 0, 0, textureKey);
    this.userId = userId;

    scene.add.existing(this);
    this.setScale(PLAYER.scale);
    // Sub-pixel snap — same as the real Player.
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';
    this.setVisible(false);
  }

  /**
   * Apply the authoritative state from the host snapshot.  Cheap enough to
   * call every frame (~20 Hz snapshot rate, client interpolates on top).
   */
  applyState(s: PlayerSyncState): void {
    this.setPosition(s.x, s.y);
    this.setFlipX(s.flipX);
    this.setAlpha(s.alpha);
    this.setTintMode(s.tintMode);
    if (s.tint === 0xffffff && s.tintMode === Phaser.TintModes.MULTIPLY) {
      this.clearTint();
    } else {
      this.setTint(s.tint);
    }
    this.setVisible(s.visible);

    if (s.animKey && s.animKey !== this.lastAnimKey) {
      this.lastAnimKey = s.animKey;
      // `true` = ignore if already playing; since we just checked it's not,
      // this safely starts the new clip.
      this.play(s.animKey, true);
    }

    this.displayHp = s.hp;
    this.stateTag  = s.stateTag;
  }
}
