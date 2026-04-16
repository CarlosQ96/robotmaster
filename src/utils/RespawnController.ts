/**
 * RespawnController — reusable countdown + reset flow for any "death" event.
 *
 * Listens for a named event on a target EventEmitter (typically the player),
 * pins a countdown label to the camera for `delayMs` milliseconds, then fires
 * `onRespawn`.  The caller owns the actual reset logic — this controller just
 * orchestrates the wait and the HUD.
 *
 * Usage:
 *
 *   // In scene.create():
 *   this.respawn = new RespawnController({
 *     scene: this,
 *     target: this.player,
 *     delayMs: 5000,
 *     onRespawn: () => this.player.respawn(spawnX, spawnY),
 *   });
 *
 *   // In scene.update(_, delta):
 *   this.respawn.update(delta);
 *
 * Multiple controllers can coexist (e.g. different death events).  The HUD
 * uses camera-fixed Text, so it survives world scroll.  Label is regenerated
 * per death, so it always reflects the current camera size.
 */
import * as Phaser from 'phaser';

export interface RespawnConfig {
  /** Scene that owns the HUD — receives add.text / add.rectangle calls. */
  scene: Phaser.Scene;
  /** Emitter to listen on (usually the player). */
  target: Phaser.Events.EventEmitter;
  /** Milliseconds between death and respawn. */
  delayMs: number;
  /** Called when the timer expires — caller resets the target. */
  onRespawn: () => void;
  /** Event name emitted on the target.  Default: 'player-died'. */
  deathEvent?: string;
  /** Label prefix shown in the HUD.  Default: 'RESPAWNING'. */
  label?: string;
  /** Depth for HUD rendering (above gameplay, below modal UIs).  Default: 500. */
  depth?: number;
}

export class RespawnController {
  private readonly scene:      Phaser.Scene;
  private readonly delayMs:    number;
  private readonly onRespawn:  () => void;
  private readonly labelText:  string;
  private readonly depth:      number;

  /** ms remaining on the current countdown, or null if idle. */
  private timer: number | null = null;
  private lastSecondShown = -1;

  private labelObj?: Phaser.GameObjects.Text;
  private labelBg?:  Phaser.GameObjects.Rectangle;

  constructor(cfg: RespawnConfig) {
    this.scene     = cfg.scene;
    this.delayMs   = cfg.delayMs;
    this.onRespawn = cfg.onRespawn;
    this.labelText = cfg.label ?? 'RESPAWNING';
    this.depth     = cfg.depth ?? 500;

    cfg.target.on(cfg.deathEvent ?? 'player-died', this.start, this);

    // Auto-cleanup: if the scene shuts down mid-countdown, don't leak HUD.
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY,  this.teardown, this);
  }

  /** Manually trigger the countdown.  Normally called via the death event. */
  start(): void {
    if (this.timer !== null) return; // already running
    this.timer = this.delayMs;
    this.lastSecondShown = -1;
    this.showHud();
  }

  /** Call from the owning scene's update loop with the frame `delta` in ms. */
  update(delta: number): void {
    if (this.timer === null) return;
    this.timer -= delta;
    if (this.timer <= 0) {
      this.complete();
      return;
    }
    // Throttle setText to once per second — canvas re-upload is expensive.
    const secs = Math.ceil(this.timer / 1000);
    if (secs !== this.lastSecondShown) {
      this.lastSecondShown = secs;
      this.labelObj?.setText(`${this.labelText} IN ${secs}`);
    }
  }

  /** True while a countdown is running. */
  get isActive(): boolean { return this.timer !== null; }

  // ── internal ─────────────────────────────────────────────────────────────

  private showHud(): void {
    const cam = this.scene.cameras.main;
    const cx  = cam.width  / 2;
    const cy  = cam.height / 2;

    this.labelBg = this.scene.add
      .rectangle(cx, cy, 320, 72, 0x000000, 0.75)
      .setStrokeStyle(2, 0xff3344, 0.9)
      .setScrollFactor(0)
      .setDepth(this.depth);

    this.labelObj = this.scene.add
      .text(cx, cy, this.labelText, {
        fontFamily:   'monospace',
        fontSize:     '22px',
        color:        '#ff3344',
        letterSpacing: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(this.depth + 1);
  }

  private complete(): void {
    this.hideHud();
    this.timer = null;
    this.onRespawn();
  }

  private hideHud(): void {
    this.labelObj?.destroy();
    this.labelBg?.destroy();
    this.labelObj = undefined;
    this.labelBg  = undefined;
  }

  private teardown(): void {
    this.hideHud();
    this.timer = null;
  }
}
