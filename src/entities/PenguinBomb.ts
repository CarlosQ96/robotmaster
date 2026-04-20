/**
 * PenguinBomb.ts — Pool-friendly bomb thrown by PenguinBot.
 *
 * Lifecycle:
 *   inactive ──fire()──► fuse  (arcs through air; animation plays once, holds on last frame)
 *            ──land────► rolls toward target  (still counting fuse timer)
 *            ──detonate()──► explode  (one-shot anim, large hitbox)
 *            ──anim complete──► kill() → inactive
 *
 * Phases:
 *   fuse     frames 0-2 (play once, hold frame 2)  — arcs then rolls on ground
 *   explode  frames 3-9 one-shot                   — explosion; hitbox expands
 *
 * Events emitted:
 *   'bomb-explode'  { x, y }  — start of explosion; use for area damage checks
 */
import * as Phaser from 'phaser';
import { PENGUIN_BOMB } from '../config/enemyConfig';

const ANIM = {
  FUSE:    'penguin_bomb_fuse',
  EXPLODE: 'penguin_bomb_explode',
} as const;

type BombPhase = 'inactive' | 'fuse' | 'explode';

export class PenguinBomb extends Phaser.Physics.Arcade.Sprite {

  private phase: BombPhase = 'inactive';
  private fuseTimer = 0;


  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'penguin_bot_bomb');

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(PENGUIN_BOMB.scale);
    this.buildAnims();
    this.setupListeners();

    // Pool: start parked + disabled (see Bullet.ts for the rationale behind
    // toggling body.enable instead of mutating world.bodies).
    this.setActive(false).setVisible(false);
    this.arcadeBody.enable = false;
    this.arcadeBody.reset(PenguinBomb.POOL_PARK, PenguinBomb.POOL_PARK);
  }

  private static readonly POOL_PARK = -10000;

  // ── Animations ───────────────────────────────────────────────────────────

  private buildAnims(): void {
    const { anims } = this.scene;
    const { anims: def } = PENGUIN_BOMB;

    if (!anims.exists(ANIM.FUSE)) {
      anims.create({
        key:       ANIM.FUSE,
        frames:    anims.generateFrameNumbers('penguin_bot_bomb', {
          start: def.fuse.start,
          end:   def.fuse.end,
        }),
        frameRate: def.fuse.frameRate,
        repeat:    0,   // play once → hold on last frame (burning fuse)
      });
    }

    if (!anims.exists(ANIM.EXPLODE)) {
      anims.create({
        key:       ANIM.EXPLODE,
        frames:    anims.generateFrameNumbers('penguin_bot_bomb', {
          start: def.explode.start,
          end:   def.explode.end,
        }),
        frameRate: def.explode.frameRate,
        repeat:    0,
      });
    }
  }

  private setupListeners(): void {
    this.on(
      `${Phaser.Animations.Events.ANIMATION_COMPLETE_KEY}${ANIM.EXPLODE}`,
      () => this.kill(),
    );
  }

  // ── Pool API ─────────────────────────────────────────────────────────────

  /**
   * Launch with explicit velocities (caller is responsible for aim calculation).
   */
  fire(x: number, y: number, vx: number, vy: number): void {
    this.setActive(true).setVisible(true);

    const b = this.arcadeBody;
    b.enable = true;
    b.reset(x, y);
    b.setSize(PENGUIN_BOMB.fuseBody.width,   PENGUIN_BOMB.fuseBody.height);
    b.setOffset(PENGUIN_BOMB.fuseBody.offsetX, PENGUIN_BOMB.fuseBody.offsetY);
    b.setAllowGravity(true);
    b.setVelocity(vx, vy);

    this.phase     = 'fuse';
    this.fuseTimer = PENGUIN_BOMB.fuseMs;
    this.play(ANIM.FUSE, true);
  }

  /**
   * Trigger the explosion — called by fuse timer or externally
   * (e.g. player shoots the bomb mid-air).
   */
  detonate(): void {
    if (this.phase !== 'fuse') return;
    this.phase = 'explode';

    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.setAllowGravity(false);
    b.setSize(PENGUIN_BOMB.explodeBody.width,   PENGUIN_BOMB.explodeBody.height);
    b.setOffset(PENGUIN_BOMB.explodeBody.offsetX, PENGUIN_BOMB.explodeBody.offsetY);

    this.play(ANIM.EXPLODE, true);
    this.emit('bomb-explode', { x: this.x, y: this.y });
  }

  /**
   * Return to pool — defers world.disableBody so it's safe to call inside
   * an overlap/collider callback (see Bullet.kill() for the full rationale).
   */
  kill(): void {
    if (!this.active) return;
    this.phase = 'inactive';
    this.setActive(false).setVisible(false);
    const b = this.arcadeBody;
    b.setVelocity(0, 0);
    b.enable = false;
    b.reset(PenguinBomb.POOL_PARK, PenguinBomb.POOL_PARK);
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  update(delta: number): void {
    if (this.phase !== 'fuse') return;

    this.fuseTimer -= delta;
    if (this.fuseTimer <= 0) { this.detonate(); return; }

    // Stop horizontal movement once the bomb lands
    if (this.arcadeBody.blocked.down) {
      this.arcadeBody.setVelocityX(0);
    }
  }

  // ── State accessors ───────────────────────────────────────────────────────

  get isExploding(): boolean { return this.phase === 'explode'; }

  get arcadeBody(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }
}
