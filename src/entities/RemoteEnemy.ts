/**
 * RemoteEnemy.ts — Presentation-only sprite for a networked enemy.
 *
 * Mirrors the contract of RemotePlayer.  The real `Enemy` class + its
 * subclasses (PenguinBot, JetpackBot, …) run on the host only; they own
 * AI, physics, HP, damage, and animation-frame callbacks that emit
 * projectile-spawn events.
 *
 * Every other peer sees enemies through this class: a plain Phaser
 * `Sprite` (no arcade body) whose position / animation / tint are driven
 * entirely by `applyState`.  Clients never run enemy AI, so cheaters on
 * clients cannot affect enemy state — the host is the only source of truth.
 */
import * as Phaser from 'phaser';

export interface EnemySyncState {
  /** Enemy-type key chosen by the host (e.g. 'penguin_bot').  Clients use
   *  this to build the right anim keys when the enemy first appears. */
  enemyType: string;
  /** Host-side sprite scale (e.g. 1, 1.75) — clients reproduce the same. */
  scale:     number;
  x:         number;
  y:         number;
  flipX:     boolean;
  animKey:   string;
  alpha:     number;
  tint:      number;
  tintMode:  number;
  visible:   boolean;
  /** Authoritative HP — HUD / debug overlays may show it, never for combat. */
  hp:        number;
  /** 'idle'|'walk'|'attack'|'hurt'|'dead' — consumers branch on this. */
  stateTag:  string;
}

export class RemoteEnemy extends Phaser.GameObjects.Sprite {
  /** Stable id assigned by the host snapshot (e.g. placement id or spawned-id). */
  readonly entityId: string;
  readonly enemyType: string;
  displayHp: number = 0;
  stateTag: string = 'idle';

  private lastAnimKey = '';

  constructor(scene: Phaser.Scene, entityId: string, enemyType: string, textureKey: string, scale = 1) {
    super(scene, 0, 0, textureKey);
    this.entityId  = entityId;
    this.enemyType = enemyType;

    scene.add.existing(this);
    this.setScale(scale);
    (this as unknown as { vertexRoundMode: string }).vertexRoundMode = 'safe';
    this.setVisible(false);
  }

  applyState(s: EnemySyncState): void {
    this.setPosition(s.x, s.y);
    this.setFlipX(s.flipX);
    if (this.scaleX !== s.scale) this.setScale(s.scale);
    this.setAlpha(s.alpha);
    this.setTintMode(s.tintMode);
    if (s.tint === 0xffffff && s.tintMode === Phaser.TintModes.MULTIPLY) {
      this.clearTint();
    } else {
      this.setTint(s.tint);
    }
    this.setVisible(s.visible);

    // Guard play() — clients only play anims whose keys are already
    // registered on the scene (done via `preregisterEnemyAnims` at startup).
    // A missing key would throw in Phaser; silently skip instead.
    if (s.animKey && s.animKey !== this.lastAnimKey) {
      if (this.scene.anims.exists(s.animKey)) {
        this.lastAnimKey = s.animKey;
        this.play(s.animKey, true);
      }
    }

    this.displayHp = s.hp;
    this.stateTag  = s.stateTag;
  }
}
