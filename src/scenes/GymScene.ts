/**
 * GymScene.ts — Training / debug level.
 *
 * Layout (1920 × 540 world, 960 × 540 viewport):
 *
 *   y=0   ┌────────────────────────────────────┐  ceiling
 *         │  ceiling strip                      │
 *   y=240 │         [── ZONE C APEX ──]         │  highest
 *   y=320 │  [ZONE B]           [ZONE D]        │  mid
 *   y=384 │[ZONE A]     steps        [ZONE E]   │  low
 *   y=460 │  ▓  step                  step  ▓  │
 *   y=508 └════════════════════════════════════┘  floor
 *
 * Debug features:
 *   [P]       Toggle physics body outlines
 *   [G]       Toggle world grid
 *   [D]       Toggle debug info panel
 *   [F]       Toggle frame-step mode (pauses player animations)
 *   [.] [,]   Frame-step next / previous  (while paused)
 *
 * Phaser 4 notes:
 *   - Physics debug is set in main.ts arcade config; toggled at runtime via
 *     physics.world.drawDebug.
 *   - Static platforms use physics.add.existing(rect, true) — no group needed.
 *   - setScrollFactor(0) pins HUD elements to the camera instead of the world.
 *   - Camera follow uses lerp + deadzone (from CAMERA config).
 */
import * as Phaser from 'phaser';
import { DISPLAY, WORLD, DEBUG, CAMERA, TILE, PROJECTILE } from '../config/gameConfig';
import { getAudio } from '../audio/AudioManager';
import { PLAYER_ANIMS } from '../config/animConfig';
import { DEFAULT_PALETTE } from '../config/paletteConfig';
import { Player } from '../entities/Player';
import { Bullet } from '../entities/Bullet';
import { ChargedBullet } from '../entities/ChargedBullet';
import { PenguinBot } from '../entities/PenguinBot';
import { PenguinBomb } from '../entities/PenguinBomb';
import { PENGUIN_BOMB } from '../config/enemyConfig';
import {
  registerBulletAnims,
  createBulletSystem,
  createBombPool,
  wirePenguinBombs,
  wireBulletEnemyCollisions,
  wirePlayerEnemyCollisions,
  wireBombPlayer,
  type BulletSystem,
  type BombPool,
} from '../utils/combatSetup';
import { cullOffscreen } from '../utils/outOfView';
import { RespawnController } from '../utils/RespawnController';

// ─── Platform layout data ───────────────────────────────────────────────────
interface PlatformDef {
  x: number;  // top-left x in world pixels
  y: number;  // top-left y in world pixels
  w: number;
  h: number;
  label?: string;
}

// ─── Spawn point (shared by initial spawn + respawn) ────────────────────────
const PLAYER_SPAWN_X    = 120;
const PLAYER_SPAWN_Y    = 440;
const RESPAWN_DELAY_MS  = 5000;

const GYM_PLATFORMS: PlatformDef[] = [
  // Floor (full width)
  { x: 0,    y: 508, w: 1920, h: 32, label: 'FLOOR' },

  // Left side
  { x: 208,  y: 460, w: 72,  h: 16 },                          // step up to A
  { x: 96,   y: 384, w: 208, h: 16, label: 'ZONE A' },

  // Left-center
  { x: 352,  y: 320, w: 208, h: 16, label: 'ZONE B' },
  { x: 624,  y: 392, w: 72,  h: 16 },                          // step up to C

  // Center apex
  { x: 720,  y: 240, w: 480, h: 16, label: 'ZONE C — APEX' },

  // Right-center (mirror of left)
  { x: 1248, y: 392, w: 72,  h: 16 },                          // step down from C
  { x: 1360, y: 320, w: 208, h: 16, label: 'ZONE D' },

  // Right side (mirror of left)
  { x: 1616, y: 384, w: 208, h: 16, label: 'ZONE E' },
  { x: 1640, y: 460, w: 72,  h: 16 },                          // step down to floor
];

// ─── GymScene ───────────────────────────────────────────────────────────────
export class GymScene extends Phaser.Scene {
  private player!: Player;
  private physicsBodies: Phaser.GameObjects.Rectangle[] = [];
  private bullets!: BulletSystem;

  // Enemies
  private penguins: PenguinBot[] = [];
  private bombs!: BombPool;

  // Debug UI (camera-fixed)
  private debugPanel!: Phaser.GameObjects.Text;
  private debugPanelBg!: Phaser.GameObjects.Rectangle;
  private fpsText!: Phaser.GameObjects.Text;
  private mouseText!: Phaser.GameObjects.Text;
  // Debug toggles (runtime state — explicit boolean to avoid `as const` literal narrowing)
  private showPanel: boolean = DEBUG.showPlayerInfo;
  private showGrid: boolean = DEBUG.showGrid;
  private frameStepMode: boolean = false;

  // Throttle debug text updates — setText re-renders a canvas texture every call
  private debugUpdateTimer: number = 0;
  private static readonly DEBUG_UPDATE_MS = 80; // ~12 refreshes/s, imperceptible lag

  // Grid — baked once to a RenderTexture so it's a static GPU quad, not dynamic geometry
  private gridDisplay!: Phaser.GameObjects.RenderTexture;

  // Selected palette texture key
  private paletteKey: string = DEFAULT_PALETTE.textureKey;

  // Respawn flow — countdown HUD + timed reset; listens for player's 'player-died' event.
  private respawn!: RespawnController;

  constructor() {
    super({ key: 'GymScene' });
  }

  // ── init ───────────────────────────────────────────────────────────────
  init(data: { paletteKey?: string }): void {
    this.paletteKey = data?.paletteKey ?? DEFAULT_PALETTE.textureKey;
  }

  // ── create ─────────────────────────────────────────────────────────────
  create(): void {
    this.physicsBodies = [];

    this.buildWorldBounds();
    this.buildBackground();
    this.buildPlatforms();
    this.buildPlayerAnims(this.paletteKey);
    registerBulletAnims(this);
    this.spawnPlayer();

    this.bullets = createBulletSystem(this, this.player);
    this.spawnEnemies();
    this.bombs = createBombPool(this);
    for (const body of this.physicsBodies) {
      this.physics.add.collider(this.bombs.group, body);
    }
    wirePenguinBombs(this.penguins, this.bombs);
    wireBulletEnemyCollisions(this, this.bullets, this.penguins);
    wirePlayerEnemyCollisions(this, this.player, this.penguins);
    wireBombPlayer(this, this.bombs, this.player);

    this.setupCamera();

    getAudio(this).playMusic('gym');

    if (DEBUG.enabled) {
      // debugGraphic was created (debug:true in main.ts), but start with drawing off.
      // [P] toggles it at runtime without crashing.
      this.physics.world.drawDebug = false;
      this.buildGrid();
      this.buildDebugHUD();
      this.registerDebugKeys();
    }

    this.buildControlsHint();
  }

  // ── World ──────────────────────────────────────────────────────────────
  private buildWorldBounds(): void {
    this.physics.world.setBounds(0, 0, WORLD.width, WORLD.height);
  }

  private buildBackground(): void {
    // Sky background
    this.add.rectangle(
      WORLD.width / 2, WORLD.height / 2,
      WORLD.width, WORLD.height,
      0x0d0f14,
    );

    // Ceiling strip
    this.add.rectangle(WORLD.width / 2, 8, WORLD.width, 16, 0x151c28);

    // Subtle vertical wall separators (every 192 px)
    for (let wx = 192; wx < WORLD.width; wx += 192) {
      this.add.rectangle(wx, WORLD.height / 2, 1, WORLD.height, 0x1a2438, 0.6);
    }

    // Horizontal depth lines (upper half only)
    for (let wy = 64; wy < 480; wy += 64) {
      this.add.rectangle(WORLD.width / 2, wy, WORLD.width, 1, 0x1a2030, 0.3);
    }

    // Title / branding
    this.add.text(WORLD.width / 2, 22, 'TRAINING FACILITY — GYM', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#243350',
    }).setOrigin(0.5, 0.5);

    // World origin marker (0, 0)
    const og = this.add.graphics();
    og.lineStyle(1, 0xff3344, 0.7);
    og.lineBetween(0, 0, 24, 0);  // x-axis  (red)
    og.lineStyle(1, 0x33ff44, 0.7);
    og.lineBetween(0, 0, 0, 24);  // y-axis  (green)
    this.add.text(4, 4, '(0,0)', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#445566',
    });

    // Spawn indicator
    const sx = 120;
    const sy = 440;
    this.add.triangle(sx, sy - 52, -6, 0, 6, 0, 0, 10, 0x00ff99, 0.5);
    this.add.text(sx, sy - 66, 'SPAWN', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#006633',
    }).setOrigin(0.5);

    // Target circles on some platforms (decorative practice targets)
    this.buildDecorativeTargets();
  }

  private buildDecorativeTargets(): void {
    const targets = [
      { x: 200,  y: 374 },  // Zone A
      { x: 456,  y: 310 },  // Zone B
      { x: 960,  y: 230 },  // Zone C center
      { x: 1464, y: 310 },  // Zone D
      { x: 1720, y: 374 },  // Zone E
    ];
    for (const t of targets) {
      const g = this.add.graphics();
      g.lineStyle(2, 0x336688, 0.5);
      g.strokeCircle(t.x, t.y, 16);
      g.lineStyle(1, 0x224455, 0.35);
      g.strokeCircle(t.x, t.y, 8);
      // Crosshair
      g.lineStyle(1, 0x334466, 0.4);
      g.lineBetween(t.x - 20, t.y, t.x + 20, t.y);
      g.lineBetween(t.x, t.y - 20, t.x, t.y + 20);
    }
  }

  // ── Platforms ──────────────────────────────────────────────────────────
  private buildPlatforms(): void {
    for (const def of GYM_PLATFORMS) {
      const cx = def.x + def.w / 2;
      const cy = def.y + def.h / 2;

      const isFloor = def.label === 'FLOOR';

      // Drop shadow
      this.add.rectangle(cx + 2, cy + 3, def.w, def.h, 0x000000, 0.4);

      // Platform body fill
      this.add.rectangle(cx, cy, def.w, def.h, isFloor ? 0x1a2535 : 0x1e2d3f);

      // Top highlight edge (gives it depth)
      this.add.rectangle(cx, def.y + 1, def.w, 2, 0x4a80c4, isFloor ? 0.5 : 0.9);

      // Bottom shadow edge
      this.add.rectangle(cx, def.y + def.h - 1, def.w, 2, 0x0a1020, 0.8);

      // Zone label (above platform, not on floor)
      if (def.label && !isFloor) {
        this.add.text(cx, def.y - 11, def.label, {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#2a4060',
        }).setOrigin(0.5);
      }

      // Tile-coord label on the floor every 320 px
      if (isFloor) {
        for (let mx = 0; mx < WORLD.width; mx += 320) {
          this.add.text(mx + 4, def.y + 10, `x:${mx}`, {
            fontFamily: 'monospace',
            fontSize: '7px',
            color: '#1e3050',
          });
        }
      }

      // ── Physics body ───────────────────────────────────────────────────
      // Invisible rectangle that carries the static arcade body.
      // Only the TOP surface matters for platformer collision.
      // We align the body to the top 16px of each platform so the player
      // lands flush against the visual edge.
      const physH = isFloor ? def.h : 16;
      const physCy = def.y + physH / 2;

      const physRect = this.add.rectangle(cx, physCy, def.w, physH, 0x000000, 0);
      this.physics.add.existing(physRect, true /* static */);
      this.physicsBodies.push(physRect);
    }
  }

  // ── Player ─────────────────────────────────────────────────────────────

  /**
   * Pre-register all player animations with the selected palette texture key.
   * If an animation already exists but references a different texture (e.g. the
   * user switched palettes between sessions), it is removed and recreated so the
   * Player sprite always shows the correct colour variant.
   * Player.buildAnims() then skips every key it finds already registered here.
   */
  private buildPlayerAnims(textureKey: string): void {
    for (const [key, def] of Object.entries(PLAYER_ANIMS)) {
      if (this.anims.exists(key)) {
        const existing = this.anims.get(key);
        // Recreate only when texture changed — avoids redundant work on restart.
        if (existing.frames[0]?.textureKey === textureKey) continue;
        this.anims.remove(key);
      }
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(textureKey, {
          start: def.start,
          end:   def.end,
        }),
        frameRate: def.frameRate,
        repeat:    def.repeat,
      });
    }
  }

  private spawnPlayer(): void {
    this.player = new Player(this, PLAYER_SPAWN_X, PLAYER_SPAWN_Y, this.paletteKey);

    // Add one collider per static body (reliable vs passing raw array)
    for (const body of this.physicsBodies) {
      this.physics.add.collider(this.player, body);
    }

    // Reusable respawn flow — owns the countdown HUD + timed reset.
    // Player emits 'player-died' on 0 HP; controller shows label then calls
    // Player.respawn() which restores HP/position/state.
    this.respawn = new RespawnController({
      scene:     this,
      target:    this.player,
      delayMs:   RESPAWN_DELAY_MS,
      onRespawn: () => this.player.respawn(PLAYER_SPAWN_X, PLAYER_SPAWN_Y),
    });
  }

  // ── Enemies ────────────────────────────────────────────────────────────

  /** Spawn PenguinBots and attach platform colliders. */
  private spawnEnemies(): void {
    const spawnDefs = [
      { x: 400, y: 460, patrolL: 300, patrolR: 560 },
      { x: 800, y: 460, patrolL: 700, patrolR: 960 },
    ];

    this.penguins = spawnDefs.map(({ x, y, patrolL, patrolR }) => {
      const penguin = new PenguinBot(this, x, y)
        .setPatrol(patrolL, patrolR)
        .setPlayer(this.player) as PenguinBot;

      for (const body of this.physicsBodies) {
        this.physics.add.collider(penguin, body);
      }
      return penguin;
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  private setupCamera(): void {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD.width, WORLD.height);
    cam.startFollow(this.player, true, CAMERA.lerpX, CAMERA.lerpY);
    cam.setFollowOffset(0, CAMERA.offsetY);
    cam.setDeadzone(CAMERA.deadzoneW, CAMERA.deadzoneH);
  }

  // ── Grid overlay (world-space) ─────────────────────────────────────────
  private buildGrid(): void {
    // Draw into a temporary Graphics object, then bake to a RenderTexture.
    // A RenderTexture renders as a single GPU texture quad every frame —
    // much cheaper than re-submitting 79 line primitives each frame.
    const g = this.add.graphics();
    const gs = DEBUG.gridSize;
    g.lineStyle(1, DEBUG.gridColor, DEBUG.gridAlpha);

    for (let wx = 0; wx <= WORLD.width; wx += gs) {
      g.lineBetween(wx, 0, wx, WORLD.height);
    }
    for (let wy = 0; wy <= WORLD.height; wy += gs) {
      g.lineBetween(0, wy, WORLD.width, wy);
    }

    // Bake to texture — origin (0,0) so it covers exactly (0,0)→(WORLD.width, WORLD.height)
    this.gridDisplay = this.add.renderTexture(0, 0, WORLD.width, WORLD.height);
    this.gridDisplay.setOrigin(0, 0);
    this.gridDisplay.draw(g, 0, 0);
    this.gridDisplay.render();
    this.gridDisplay.setDepth(1);
    this.gridDisplay.setVisible(this.showGrid);

    g.destroy(); // Graphics only needed for the bake step
  }

  // ── Debug HUD (camera-fixed) ───────────────────────────────────────────
  private buildDebugHUD(): void {
    // ── Player info panel (top-left) ─────────────────────────────────────
    this.debugPanelBg = this.add
      .rectangle(6, 6, 244, 268, DEBUG.panelBg, DEBUG.panelAlpha)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(200);

    this.debugPanel = this.add
      .text(12, 10, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: DEBUG.textColor,
        lineSpacing: 2,
      })
      .setScrollFactor(0)
      .setDepth(201);

    this.debugPanel.setVisible(this.showPanel);
    this.debugPanelBg.setVisible(this.showPanel);

    // ── FPS (top-right) ──────────────────────────────────────────────────
    this.fpsText = this.add
      .text(DISPLAY.width - 6, 6, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: DEBUG.warnColor,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(201);

    // ── Mouse world + tile coords (bottom-right) ─────────────────────────
    this.mouseText = this.add
      .text(DISPLAY.width - 6, DISPLAY.height - 24, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: DEBUG.labelColor,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(201);
  }

  private buildControlsHint(): void {
    const lines = DEBUG.enabled
      ? '← → MOVE   ↑ JUMP   ↓ CROUCH   Z SHOOT  X SLIDE  (hold Z = CHARGE)  |  [P] PHYS  [G] GRID  [D] HUD  [F] STEP  [.][,] FRAMES'
      : '← → MOVE   ↑ JUMP   ↓ CROUCH   Z SHOOT  X SLIDE  (hold Z = CHARGE)';

    this.add
      .text(DISPLAY.width / 2, DISPLAY.height - 6, lines, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#1e3050',
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(201);
  }

  // ── Debug key bindings ─────────────────────────────────────────────────
  private registerDebugKeys(): void {
    const kb = this.input.keyboard!;

    // [G] grid
    kb.on(`keydown-${DEBUG.keys.toggleGrid}`, () => {
      this.showGrid = !this.showGrid;
      this.gridDisplay.setVisible(this.showGrid);
    });

    // [D] debug panel
    kb.on(`keydown-${DEBUG.keys.togglePanel}`, () => {
      this.showPanel = !this.showPanel;
      this.debugPanel.setVisible(this.showPanel);
      this.debugPanelBg.setVisible(this.showPanel);
    });

    // [P] physics body outlines
    kb.on(`keydown-${DEBUG.keys.togglePhysics}`, () => {
      const world = this.physics.world as Phaser.Physics.Arcade.World;
      world.drawDebug = !world.drawDebug;
      // Clear stale outlines when turning off
      if (!world.drawDebug && world.debugGraphic) {
        world.debugGraphic.clear();
      }
    });

    // [F] frame-step toggle
    kb.on(`keydown-${DEBUG.keys.frameStep}`, () => {
      this.frameStepMode = !this.frameStepMode;
      if (this.frameStepMode) {
        this.player.anims.pause();
      } else {
        this.player.anims.resume();
      }
    });

    // [.] next frame  (only in step mode)
    kb.on(`keydown-${DEBUG.keys.frameNext}`, () => {
      if (!this.frameStepMode) return;
      this.stepPlayerFrame(1);
    });

    // [,] previous frame  (only in step mode)
    kb.on(`keydown-${DEBUG.keys.framePrev}`, () => {
      if (!this.frameStepMode) return;
      this.stepPlayerFrame(-1);
    });
  }

  /**
   * Advance or rewind the player's animation by one frame while paused.
   * Falls back to a manual setFrame() if nextFrame/previousFrame are absent
   * (API difference between Phaser versions).
   */
  private stepPlayerFrame(dir: 1 | -1): void {
    const animState = this.player.anims;
    if (!animState.currentAnim) return;

    // Try the Phaser 3/4 AnimationState helpers first (cast through unknown to avoid index-signature error)
    const animAny = animState as unknown as Record<string, unknown>;
    if (dir > 0 && typeof animAny['nextFrame'] === 'function') {
      (animAny['nextFrame'] as () => void)();
    } else if (dir < 0 && typeof animAny['previousFrame'] === 'function') {
      (animAny['previousFrame'] as () => void)();
    } else {
      // Manual fallback: calculate next index and call setFrame
      const frames = animState.currentAnim.frames;
      if (!frames.length) return;
      const cur = frames.findIndex(f => f === animState.currentFrame);
      const next = (cur + dir + frames.length) % frames.length;
      this.player.setFrame(frames[next].frame.name);
    }
  }

  // ── update ─────────────────────────────────────────────────────────────
  update(_time: number, delta: number): void {
    // Respawn countdown (no-op while idle). Runs regardless of frame-step mode
    // so the HUD keeps ticking even if player animation is paused.
    this.respawn.update(delta);

    // Player update is skipped in frame-step mode so you can inspect frames
    if (!this.frameStepMode) {
      this.player.update(delta);
    }

    // Return any bullet that has left the camera viewport to the pool.
    // margin=0: kill immediately on leaving the visible area.
    cullOffscreen<Bullet>(this.bullets.small, this.cameras.main, b => b.kill());
    cullOffscreen<ChargedBullet>(this.bullets.charged,     this.cameras.main, b => b.kill());
    cullOffscreen<ChargedBullet>(this.bullets.fullCharged, this.cameras.main, b => b.kill());

    // Update enemies. Skip destroyed ones (dead penguins fade + destroy();
    // once destroyed, .active is false and calling update() is unsafe).
    for (const p of this.penguins) {
      if (!p.active) continue;
      p.update(delta);
    }

    // Tick active bomb fuse timers; cull any that left the viewport
    for (const child of this.bombs.group.getChildren()) {
      const bomb = child as PenguinBomb;
      if (bomb.active) bomb.update(delta);
    }
    cullOffscreen<PenguinBomb>(this.bombs.group, this.cameras.main, b => b.kill(), 64);

    if (!DEBUG.enabled) return;

    // Throttle: setText() re-renders + re-uploads a canvas texture each call.
    // Running it every frame at 120fps is the main cause of FPS drops in debug mode.
    this.debugUpdateTimer += delta;
    if (this.debugUpdateTimer < GymScene.DEBUG_UPDATE_MS) return;
    this.debugUpdateTimer -= GymScene.DEBUG_UPDATE_MS;

    // FPS counter
    this.fpsText.setText(`FPS  ${this.game.loop.actualFps.toFixed(0)}`);

    // Mouse world coordinates + tile grid coords
    const ptr = this.input.activePointer;
    const wx = ptr.worldX;
    const wy = ptr.worldY;
    const tx = Math.floor(wx / DEBUG.gridSize);
    const ty = Math.floor(wy / DEBUG.gridSize);
    this.mouseText.setText(
      `MOUSE  (${wx.toFixed(0)}, ${wy.toFixed(0)})   TILE [${tx}, ${ty}]`,
    );

    // Debug panel
    if (this.showPanel) {
      this.updateDebugPanel();
    }
  }

  private updateDebugPanel(): void {
    const info = this.player.getDebugInfo();
    const stepLabel = this.frameStepMode ? '  STEP' : '';

    const camX = this.cameras.main.scrollX.toFixed(0);
    const camY = this.cameras.main.scrollY.toFixed(0);
    const tileX = Math.floor(this.player.x / TILE.size);
    const tileY = Math.floor(this.player.y / TILE.size);

    // ── Bullet pool memory stats ─────────────────────────────────────────
    const bulletsActive = this.bullets.small.countActive(true);

    const bulletsCap    = PROJECTILE.small.poolSize;
    // Color-code: yellow when pool is half full, red when at cap
    const poolWarn = bulletsActive >= bulletsCap
      ? ' !!!'
      : bulletsActive >= bulletsCap / 2
        ? ' !'
        : '';

    const lines = [
      `ROBOT LORDS — DEBUG${stepLabel}`,
      '─'.repeat(26),
      `STATE   ${info.state.toUpperCase().padEnd(10)}`,
      `ANIM    ${info.anim.padEnd(10)}`,
      `FRAME   ${info.frame}`,
      `HP      ${info.hp}`,
      '─'.repeat(26),
      `POS     (${info.x}, ${info.y})`,
      `VEL     (${info.vx}, ${info.vy})`,
      `TILE    [${tileX}, ${tileY}]`,
      '─'.repeat(26),
      `GRND    ${info.grounded}`,
      `FLIP    ${info.flip}`,
      `CAM     (${camX}, ${camY})`,
      '─'.repeat(26),
      'BULLETS',
      `  SM  ${bulletsActive}/${bulletsCap}${poolWarn}   CH  ${this.bullets.charged.countActive(true)}/${PROJECTILE.charged.poolSize}   FC  ${this.bullets.fullCharged.countActive(true)}/${PROJECTILE.fullCharged.poolSize}`,
      `  SHOT CD  ${info.cooldown}   CHARGE  ${info.charge}`,
      '─'.repeat(26),
      'ENEMIES',
      ...this.penguins.map((p, i) =>
        `  P${i + 1}  ${p.active ? p.currentState.toUpperCase().padEnd(7) : 'GONE   '}  BOMB ${this.bombs.group.countActive(true)}/${PENGUIN_BOMB.poolSize}`
      ),
      '─'.repeat(26),
      '[P] PHYS  [G] GRID  [D] HUD',
      '[F] STEP  [.] NEXT  [,] PREV',
    ];

    this.debugPanel.setText(lines.join('\n'));
  }
}
