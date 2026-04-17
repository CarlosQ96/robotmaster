/**
 * EditorScene — in-game tile painter for the Reactor Man tileset.
 *
 * Runs against the same level data structure as the gameplay scenes (see
 * TilemapLoader + public/levels/*.json).  Saves go through the Vite dev
 * middleware in vite.config.ts → POST /api/levels/:name, which writes the
 * file straight back into public/levels so a reload picks up the new layout.
 *
 * Controls (desktop):
 *   LMB            paint selected tile at hovered cell
 *   RMB            erase tile at hovered cell
 *   Middle drag    pan the camera
 *   Arrow / WASD   pan the camera (keyboard)
 *   1-9            quick-select palette slots
 *   [ / ]          cycle selected tile index
 *   G              toggle grid overlay
 *   S / Ctrl+S     save level
 *   E / ESC        exit back to GymScene
 *
 * The palette sidebar shows every tile in the tileset at 2× scale.  Left-click
 * a palette slot to select it.  The hovered world cell previews the selected
 * tile at 50% alpha so placement is predictable.
 */
import * as Phaser from 'phaser';
import { DISPLAY, WORLD } from '../config/gameConfig';
import { loadTilemap, type LoadedLevel, type LevelData } from '../utils/TilemapLoader';

// ─── Editor constants ───────────────────────────────────────────────────────
const LEVEL_KEY        = 'level-gym';      // JSON cache key (re-fetched each open)
const LEVEL_NAME       = 'gym';             // filename stem in public/levels/
const TILESET_IMG_KEY  = 'castle_tiles';
const SAVE_URL         = `/api/levels/${LEVEL_NAME}`;

const PALETTE_WIDTH    = 232;  // camera-fixed sidebar width (px)
const PALETTE_TILE_PX  = 48;   // palette tile display size (3× source 16 → 48)
const PALETTE_COLS     = 4;    // 4 cols × 48 + padding fits inside 232
const PALETTE_GAP      = 4;
const PALETTE_PAD_X    = 16;
const PALETTE_PAD_Y    = 48;   // top margin so header fits

const DEPTH_WORLD_GRID  = 5;
const DEPTH_HOVER       = 6;
const DEPTH_UI_BG       = 90;
const DEPTH_UI_CONTENT  = 91;
const DEPTH_UI_HILITE   = 92;

// ─── Scene ──────────────────────────────────────────────────────────────────
export class EditorScene extends Phaser.Scene {
  // Loaded level + map state
  private level!: LoadedLevel;
  private tileWidth  = 16;
  private tileHeight = 16;
  private displayScale = 2;   // displayScale copied from the level data

  // Editor state
  private selectedTile = 0;
  private dirty        = false;

  // UI
  private paletteBg!:    Phaser.GameObjects.Rectangle;
  private paletteHilite!: Phaser.GameObjects.Rectangle;
  private hoverGhost!:   Phaser.GameObjects.Image;
  private infoText!:     Phaser.GameObjects.Text;
  private statusText!:   Phaser.GameObjects.Text;
  private helpText!:     Phaser.GameObjects.Text;
  private gridGfx!:      Phaser.GameObjects.Graphics;
  private showGrid       = true;

  // Palette scroll — the tile grid can be taller than the viewport, so we
  // translate every palette image by paletteScrollY and hide those pushed
  // outside the visible sidebar window.
  private paletteTiles:     Phaser.GameObjects.Image[] = [];
  private paletteScrollY    = 0;
  private paletteMaxScrollY = 0;

  // Pan state
  private panActive   = false;
  private panStartX   = 0;
  private panStartY   = 0;
  private panScrollX  = 0;
  private panScrollY  = 0;

  // Keyboard pan speed
  private static readonly PAN_SPEED = 480; // px/s

  constructor() { super({ key: 'EditorScene' }); }

  // ── lifecycle ────────────────────────────────────────────────────────────
  create(): void {
    // Reload the JSON on every open so the cache reflects the latest save.
    // preload() would cache once per boot; we explicitly re-fetch here.
    this.load.json(LEVEL_KEY + '-edit', `levels/${LEVEL_NAME}.json?t=${Date.now()}`);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      // Shadow the cache under the shared key so TilemapLoader picks it up.
      const fresh = this.cache.json.get(LEVEL_KEY + '-edit');
      this.cache.json.add(LEVEL_KEY, fresh);
      this.buildScene();
    });
    this.load.start();
  }

  private buildScene(): void {
    const camMain = this.cameras.main;
    camMain.setBounds(0, 0, WORLD.width, WORLD.height);
    camMain.setBackgroundColor(0x0a0d14);

    // World tilemap (same loader as gameplay — single source of truth).
    this.level = loadTilemap(this, LEVEL_KEY, TILESET_IMG_KEY);
    this.tileWidth  = this.level.data.tileWidth;
    this.tileHeight = this.level.data.tileHeight;
    this.displayScale = this.level.data.displayScale;

    // Grid overlay at world-tile boundaries (re-rendered on toggle).
    this.gridGfx = this.add.graphics().setDepth(DEPTH_WORLD_GRID);
    this.drawGrid();

    // Hover preview — an Image pointed at the selected spritesheet FRAME.
    // Frame-based rendering avoids the setCrop-on-scaled-image offset trap
    // (cropped pixels appear at source-offset * displayScale inside the sprite's
    // bounding box rather than at its origin).
    this.hoverGhost = this.add
      .image(0, 0, TILESET_IMG_KEY, this.selectedTile)
      .setOrigin(0, 0)
      .setScale(this.displayScale)
      .setAlpha(0.55)
      .setDepth(DEPTH_HOVER)
      .setVisible(false);

    this.buildUI();
    this.buildInput();
  }

  // ── UI layout (camera-fixed sidebar + status bars) ───────────────────────
  private buildUI(): void {
    // Sidebar background pinned via scrollFactor 0.
    this.paletteBg = this.add
      .rectangle(0, 0, PALETTE_WIDTH, DISPLAY.height, 0x0a1020, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1a3355)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_BG);

    // Header
    this.add.text(8, 8, 'TILE PALETTE', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#2a5a7a',
      letterSpacing: 2,
    }).setScrollFactor(0).setDepth(DEPTH_UI_CONTENT);

    this.add.text(8, 24, `${LEVEL_NAME.toUpperCase()}.JSON`, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#446688',
    }).setScrollFactor(0).setDepth(DEPTH_UI_CONTENT);

    // Palette tiles — one Image per tile index, drawn inside the sidebar.
    // Frame-based: each tile is frame N of the spritesheet, scaled up so the
    // 16-px art reads clearly. No setCrop anywhere.
    const totalTiles = this.countTilesetTiles();
    const scale = PALETTE_TILE_PX / this.tileWidth; // 48 / 16 = 3×
    for (let i = 0; i < totalTiles; i++) {
      const col = i % PALETTE_COLS;
      const row = Math.floor(i / PALETTE_COLS);
      const x = PALETTE_PAD_X + col * (PALETTE_TILE_PX + PALETTE_GAP);
      const y = PALETTE_PAD_Y + row * (PALETTE_TILE_PX + PALETTE_GAP);

      const img = this.add
        .image(x, y, TILESET_IMG_KEY, i)
        .setOrigin(0, 0)
        .setScale(scale)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_CONTENT)
        .setInteractive({ useHandCursor: true });

      img.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.leftButtonDown()) {
          this.selectTile(i);
        }
      });

      this.paletteTiles.push(img);
    }

    // Max scroll = total palette height - visible band (header above, help
    // hint at bottom).  Wheel + PgUp/PgDn clamp to [0, paletteMaxScrollY].
    const totalRows    = Math.ceil(totalTiles / PALETTE_COLS);
    const totalHeight  = PALETTE_PAD_Y + totalRows * (PALETTE_TILE_PX + PALETTE_GAP);
    const visibleBand  = DISPLAY.height - PALETTE_PAD_Y - 24; // -24 for help bar
    this.paletteMaxScrollY = Math.max(0, totalHeight - PALETTE_PAD_Y - visibleBand);

    // Selection highlight — sits on top of the active palette tile.
    this.paletteHilite = this.add
      .rectangle(0, 0, PALETTE_TILE_PX + 4, PALETTE_TILE_PX + 4)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x00ff99)
      .setFillStyle()
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_HILITE);
    this.updateSelectionHighlight();

    // Status bar (top-right) — selected tile + dirty flag.
    this.infoText = this.add
      .text(DISPLAY.width - 8, 8, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#00ff99',
        align: 'right',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT);

    // Save/status toast
    this.statusText = this.add
      .text(DISPLAY.width - 8, 24, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffcc00',
        align: 'right',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT);

    // Controls hint (bottom)
    this.helpText = this.add
      .text(PALETTE_WIDTH + 8, DISPLAY.height - 6,
        'LMB PAINT  RMB ERASE  MMB/WASD PAN  WHEEL/PGUP-PGDN SCROLL PALETTE  1-9 QUICK  [ ] CYCLE  G GRID  S SAVE  E EXIT', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#446688',
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT);

    this.refreshHud();
  }

  // ── Input ────────────────────────────────────────────────────────────────
  private buildInput(): void {
    this.input.mouse?.disableContextMenu(); // enable RMB events

    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_UP,   this.onPointerUp,   this);

    // Palette wheel scroll — only when cursor is over the sidebar.  Otherwise
    // the wheel is reserved for future world-zoom (currently a no-op).
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
        if (!this.isOverSidebar(pointer)) return;
        this.scrollPalette(dy);
      },
    );

    const kb = this.input.keyboard!;
    kb.on('keydown-S', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
      this.saveLevel();
    });
    kb.on('keydown-G', () => this.toggleGrid());
    kb.on('keydown-E',   () => this.exit());
    kb.on('keydown-ESC', () => this.exit());
    kb.on('keydown-OPEN_BRACKET',   () => this.cycleSelected(-1));
    kb.on('keydown-CLOSED_BRACKET', () => this.cycleSelected(+1));

    // Paging through the palette — useful when the tile you want is scrolled off.
    const pageStep = PALETTE_TILE_PX * 4; // ~4 rows per page
    kb.on('keydown-PAGE_UP',   () => this.scrollPalette(-pageStep));
    kb.on('keydown-PAGE_DOWN', () => this.scrollPalette(+pageStep));
    kb.on('keydown-HOME',      () => { this.paletteScrollY = 0; this.applyPaletteScroll(); });
    kb.on('keydown-END',       () => { this.paletteScrollY = this.paletteMaxScrollY; this.applyPaletteScroll(); });

    // Digit hotkeys — Phaser keydown uses the literal digit name.
    for (let n = 1; n <= 9; n++) {
      kb.on(`keydown-${n}`, () => this.selectTile(n - 1));
    }

    // Cache pan keys so update() doesn't re-register each frame.
    this.panKeys = {
      left:  kb.addKey('A'),
      right: kb.addKey('D'),
      up:    kb.addKey('W'),
      aLeft: kb.addKey('LEFT'),
      aRight: kb.addKey('RIGHT'),
      aUp:    kb.addKey('UP'),
      aDown:  kb.addKey('DOWN'),
    };
  }

  // Cached keys for per-frame pan — populated in buildInput.
  private panKeys!: {
    left:  Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up:    Phaser.Input.Keyboard.Key;
    aLeft:  Phaser.Input.Keyboard.Key;
    aRight: Phaser.Input.Keyboard.Key;
    aUp:    Phaser.Input.Keyboard.Key;
    aDown:  Phaser.Input.Keyboard.Key;
  };

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    // Pan (middle button held)
    if (this.panActive) {
      const cam = this.cameras.main;
      cam.scrollX = this.panScrollX - (pointer.x - this.panStartX);
      cam.scrollY = this.panScrollY - (pointer.y - this.panStartY);
      return;
    }

    // Position hover ghost on the hovered cell (world coords).
    if (this.isOverSidebar(pointer)) {
      this.hoverGhost.setVisible(false);
      return;
    }
    const { tx, ty, wx, wy } = this.worldCellAt(pointer);
    if (this.outOfBounds(tx, ty)) {
      this.hoverGhost.setVisible(false);
      return;
    }
    this.hoverGhost.setPosition(wx, wy).setVisible(true);

    // Continuous paint / erase while dragging.
    if (pointer.leftButtonDown())  this.paintAt(tx, ty);
    if (pointer.rightButtonDown()) this.eraseAt(tx, ty);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (pointer.middleButtonDown()) {
      this.panActive  = true;
      this.panStartX  = pointer.x;
      this.panStartY  = pointer.y;
      this.panScrollX = this.cameras.main.scrollX;
      this.panScrollY = this.cameras.main.scrollY;
      return;
    }
    if (this.isOverSidebar(pointer)) return; // palette handles its own clicks
    const { tx, ty } = this.worldCellAt(pointer);
    if (this.outOfBounds(tx, ty)) return;
    if (pointer.leftButtonDown())  this.paintAt(tx, ty);
    if (pointer.rightButtonDown()) this.eraseAt(tx, ty);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!pointer.middleButtonDown()) this.panActive = false;
  }

  // ── per-frame: keyboard pan ──────────────────────────────────────────────
  // Note: S is bound to SAVE (see buildInput), so only the DOWN arrow pans down.
  update(_time: number, delta: number): void {
    if (!this.panKeys) return;
    const cam = this.cameras.main;
    const step = EditorScene.PAN_SPEED * (delta / 1000);
    if (this.panKeys.left.isDown  || this.panKeys.aLeft.isDown)  cam.scrollX -= step;
    if (this.panKeys.right.isDown || this.panKeys.aRight.isDown) cam.scrollX += step;
    if (this.panKeys.up.isDown    || this.panKeys.aUp.isDown)    cam.scrollY -= step;
    if (this.panKeys.aDown.isDown)                                cam.scrollY += step;
  }

  // ── Edit operations ──────────────────────────────────────────────────────
  private paintAt(tx: number, ty: number): void {
    const current = this.level.groundLayer.getTileAt(tx, ty);
    if (current && current.index === this.selectedTile) return; // no-op
    this.level.groundLayer.putTileAt(this.selectedTile, tx, ty);
    // Re-apply collision for the newly-placed index (idempotent).
    if (this.level.data.solidTiles.includes(this.selectedTile)) {
      this.level.groundLayer.setCollision(this.level.data.solidTiles);
    }
    // Mirror into the source grid so the save write-out reflects the edit.
    this.writeCell(tx, ty, this.selectedTile);
    this.markDirty();
  }

  private eraseAt(tx: number, ty: number): void {
    const current = this.level.groundLayer.getTileAt(tx, ty);
    if (!current) return;
    this.level.groundLayer.removeTileAt(tx, ty);
    this.writeCell(tx, ty, -1);
    this.markDirty();
  }

  private writeCell(tx: number, ty: number, idx: number): void {
    const row = this.level.data.layers.ground[ty];
    if (!row) return;
    row[tx] = idx;
  }

  private selectTile(idx: number): void {
    if (idx < 0 || idx >= this.countTilesetTiles()) return;
    this.selectedTile = idx;
    this.updateSelectionHighlight();
    this.updateHoverGhostFrame();
    this.refreshHud();
  }

  private cycleSelected(dir: 1 | -1): void {
    const total = this.countTilesetTiles();
    this.selectTile((this.selectedTile + dir + total) % total);
  }

  private toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.drawGrid();
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  private async saveLevel(): Promise<void> {
    this.showStatus('SAVING...', '#ffcc00');
    try {
      const payload: LevelData = this.level.data;
      const res = await fetch(SAVE_URL, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.dirty = false;
      this.showStatus('SAVED', '#00ff99');
      this.refreshHud();
    } catch (err) {
      this.showStatus(`SAVE FAILED: ${(err as Error).message}`, '#ff3344');
    }
  }

  // ── Exit ─────────────────────────────────────────────────────────────────
  private exit(): void {
    if (this.dirty) {
      this.showStatus('UNSAVED — PRESS S TO SAVE, E AGAIN TO DISCARD', '#ff3344');
      this.dirty = false; // next E will exit even with pending change
      return;
    }
    this.scene.start('GymScene');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private worldCellAt(pointer: Phaser.Input.Pointer): { tx: number; ty: number; wx: number; wy: number } {
    const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const cellPx = this.tileWidth * this.displayScale;
    const tx = Math.floor(wp.x / cellPx);
    const ty = Math.floor(wp.y / cellPx);
    const wx = tx * cellPx;
    const wy = ty * cellPx;
    return { tx, ty, wx, wy };
  }

  private outOfBounds(tx: number, ty: number): boolean {
    return tx < 0 || ty < 0 || tx >= this.level.data.widthTiles || ty >= this.level.data.heightTiles;
  }

  private isOverSidebar(p: Phaser.Input.Pointer): boolean {
    return p.x < PALETTE_WIDTH;
  }

  private countTilesetTiles(): number {
    const tex = this.textures.get(TILESET_IMG_KEY);
    const src = tex.source[0];
    const cols = Math.floor(src.width  / this.tileWidth);
    const rows = Math.floor(src.height / this.tileHeight);
    return cols * rows;
  }

  private updateHoverGhostFrame(): void {
    this.hoverGhost.setFrame(this.selectedTile);
  }

  private updateSelectionHighlight(): void {
    const col = this.selectedTile % PALETTE_COLS;
    const row = Math.floor(this.selectedTile / PALETTE_COLS);
    const x = PALETTE_PAD_X + col * (PALETTE_TILE_PX + PALETTE_GAP) - 2;
    const baseY = PALETTE_PAD_Y + row * (PALETTE_TILE_PX + PALETTE_GAP) - 2;
    const y = baseY - this.paletteScrollY;
    this.paletteHilite.setPosition(x, y);
    this.paletteHilite.setVisible(this.isYInPaletteBand(y, PALETTE_TILE_PX + 4));
  }

  /**
   * Apply `dy` to the palette scroll, clamped to [0, paletteMaxScrollY].
   * Positive dy scrolls DOWN (content moves up, revealing tiles further in).
   */
  private scrollPalette(dy: number): void {
    const next = Phaser.Math.Clamp(
      this.paletteScrollY + dy,
      0,
      this.paletteMaxScrollY,
    );
    if (next === this.paletteScrollY) return;
    this.paletteScrollY = next;
    this.applyPaletteScroll();
  }

  /** Reposition all palette tiles after a scroll change and toggle visibility
   *  for rows pushed above the header or below the help hint. */
  private applyPaletteScroll(): void {
    for (let i = 0; i < this.paletteTiles.length; i++) {
      const img = this.paletteTiles[i];
      const row = Math.floor(i / PALETTE_COLS);
      const baseY = PALETTE_PAD_Y + row * (PALETTE_TILE_PX + PALETTE_GAP);
      const y = baseY - this.paletteScrollY;
      img.setY(y);
      img.setVisible(this.isYInPaletteBand(y, PALETTE_TILE_PX));
    }
    this.updateSelectionHighlight();
  }

  /** Is [y, y+height] at least partly inside the visible palette band? */
  private isYInPaletteBand(y: number, height: number): boolean {
    const top    = PALETTE_PAD_Y - 2;
    const bottom = DISPLAY.height - 20; // above the help-hint row
    return (y + height) > top && y < bottom;
  }

  private drawGrid(): void {
    this.gridGfx.clear();
    if (!this.showGrid) return;
    const cellPx = this.tileWidth * this.displayScale;
    this.gridGfx.lineStyle(1, 0x3355aa, 0.25);
    for (let x = 0; x <= WORLD.width; x += cellPx) {
      this.gridGfx.lineBetween(x, 0, x, WORLD.height);
    }
    for (let y = 0; y <= WORLD.height; y += cellPx) {
      this.gridGfx.lineBetween(0, y, WORLD.width, y);
    }
  }

  private markDirty(): void {
    if (!this.dirty) {
      this.dirty = true;
      this.refreshHud();
    }
  }

  private refreshHud(): void {
    const dirtyFlag = this.dirty ? ' *' : '';
    this.infoText.setText(`TILE  ${this.selectedTile.toString().padStart(3, '0')}${dirtyFlag}`);
  }

  private showStatus(text: string, color: string): void {
    this.statusText.setColor(color);
    this.statusText.setText(text);
    this.time.delayedCall(2000, () => {
      if (this.statusText.text === text) this.statusText.setText('');
    });
  }
}
