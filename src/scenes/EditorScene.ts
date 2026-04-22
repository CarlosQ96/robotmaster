/**
 * EditorScene — in-game level authoring tool.
 *
 * Two modes (switch with the tabs at the top of the sidebar):
 *
 *   TILES    — paint/erase tiles from the active tileset.
 *              Tileset dropdown shows registry entries from editorCatalog.
 *   ENEMIES  — place enemies and spawn points with editable attributes.
 *              Solo enemies spawn once; spawners emit on a timer.
 *
 * Saves go through the Vite dev middleware (POST /api/levels/:name) and
 * rewrite public/levels/<name>.json with the full LevelData payload —
 * ground layer, solids, enemies, spawners, optional background.
 *
 * Controls (desktop, mouse + keyboard):
 *   LMB          paint tile / place entity / select existing entity
 *   RMB          erase tile / delete hovered entity
 *   Middle drag  pan the camera
 *   WASD/arrows  pan the camera
 *   Wheel        scroll the active palette (over sidebar)
 *   PgUp/PgDn    scroll palette a page at a time
 *   Home/End     snap palette to top / bottom
 *   T / Y        switch to TILES / ENEMIES mode
 *   1-9          quick-select palette slot (mode-dependent)
 *   [ / ]        cycle palette selection
 *   G            toggle grid overlay
 *   S / Ctrl+S   save level
 *   Esc          deselect + disarm
 *   E            exit to LevelPickerScene (confirms if unsaved)
 */
import * as Phaser from 'phaser';
import { DISPLAY, WORLD } from '../config/gameConfig';
import {
  loadTilemap,
  createBackground,
  type LoadedLevel,
  type LevelData,
  type EnemyPlacement,
  type SpawnerPlacement,
} from '../utils/TilemapLoader';
import {
  TILESETS,
  ENEMY_PROTOTYPES,
  SPAWNER_ATTRS,
  BACKGROUNDS,
  defaultEnemy,
  defaultSpawner,
  enemyProto,
  type AttrSpec,
  type EnemyPrototype,
} from '../config/editorCatalog';

// ─── Editor constants ───────────────────────────────────────────────────────
/**
 * The editor was originally hardcoded to `level-gym`.  Now it accepts a
 * `levelName` via `scene.start('EditorScene', { levelName, isNew? })`, falling
 * back to 'gym' if no init data is provided (so direct-start still works).
 * Cache + save URLs are derived from the name at runtime.
 */
const DEFAULT_LEVEL_NAME = 'gym';

/** Blank-level template used when the picker requests `isNew: true`. */
function makeBlankLevel(name: string): LevelData {
  const widthTiles  = 60;
  const heightTiles = 17;
  const row = (): number[] => Array.from({ length: widthTiles }, () => -1);
  return {
    name,
    tileWidth:    16,
    tileHeight:   16,
    displayScale: 1,
    widthTiles,
    heightTiles,
    tileset:      'castle',
    background:   'castle_bg',
    solidTiles:   [],
    layers:       { ground: Array.from({ length: heightTiles }, row) },
    enemies:      [],
    spawners:     [],
  };
}

const PALETTE_WIDTH    = 232;
const PALETTE_TILE_PX  = 48;
const PALETTE_COLS     = 4;
const PALETTE_GAP      = 4;
const PALETTE_PAD_X    = 16;
const CONTENT_TOP      = 76;   // y where palette content starts (below tabs + dropdown)

const ATTR_PANEL_W     = 200;
const ATTR_PANEL_PAD   = 8;

const DEPTH_WORLD_GRID  = 5;
const DEPTH_HOVER       = 6;
const DEPTH_WORLD_ENTITY = 7;
const DEPTH_WORLD_SELECT = 8;
const DEPTH_UI_BG       = 90;
const DEPTH_UI_CONTENT  = 91;
const DEPTH_UI_HILITE   = 92;
const DEPTH_UI_PANEL    = 95;

type EditorMode = 'tiles' | 'enemies' | 'bg';

type ArmedTool =
  | null
  | { kind: 'tile';    index:   number }
  | { kind: 'enemy';   protoId: string }
  | { kind: 'spawner'; protoId: string };

type Selected =
  | null
  | { kind: 'enemy';   index: number } // index into level.data.enemies
  | { kind: 'spawner'; index: number };

// ─── Scene ──────────────────────────────────────────────────────────────────
export class EditorScene extends Phaser.Scene {
  // Loaded level + derived dims
  private level!: LoadedLevel;
  private tileWidth  = 16;
  private tileHeight = 16;
  private displayScale = 1;
  private tilesetKey: string = TILESETS[0].key;

  // Editor state
  private mode: EditorMode = 'tiles';
  private armed: ArmedTool = null;
  private selected: Selected = null;
  private dirty = false;

  // World: rendered entity containers, parallel to level.data.enemies/spawners
  private enemySprites:   Phaser.GameObjects.GameObject[] = [];
  private spawnerSprites: Phaser.GameObjects.Container[]   = [];
  private selectionRing!: Phaser.GameObjects.Rectangle;

  /**
   * Two-camera setup:
   *   - `cameras.main` renders the WORLD (tilemap, entities, grid, hover
   *     ghosts, selection ring).  Its viewport is inset by PALETTE_WIDTH
   *     so world content never draws behind the palette sidebar.
   *   - `uiCam` renders the UI (palette, tabs, HUD, attribute panel).
   *     Full-screen viewport, scroll locked at (0, 0).
   *
   * Partitioning is done with two Phaser Layers: every UI object goes
   * into `uiLayer`, everything else stays on the scene root.  The main
   * camera `ignore(uiLayer)`s, the UI camera `ignore(worldLayer)`s.
   * That way dynamic UI (attr panel rebuilds, tooltips, etc.) sorts
   * correctly without any per-object plumbing.
   */
  private uiCam!:     Phaser.Cameras.Scene2D.Camera;
  private uiLayer!:   Phaser.GameObjects.Layer;
  private worldLayer!: Phaser.GameObjects.Layer;

  // Shared UI
  private paletteBg!:    Phaser.GameObjects.Rectangle;
  private hoverGhost!:   Phaser.GameObjects.Image;
  private hoverEnemyGhost!: Phaser.GameObjects.Image;
  private hoverSpawnerGhost!: Phaser.GameObjects.Container;
  private infoText!:     Phaser.GameObjects.Text;
  private statusText!:   Phaser.GameObjects.Text;
  private helpText!:     Phaser.GameObjects.Text;
  private gridGfx!:      Phaser.GameObjects.Graphics;
  private showGrid       = true;

  // Tabs
  private tabTilesBg!:   Phaser.GameObjects.Rectangle;
  private tabEnemiesBg!: Phaser.GameObjects.Rectangle;
  private tabBgBg!:      Phaser.GameObjects.Rectangle;
  private tabTilesTxt!:  Phaser.GameObjects.Text;
  private tabEnemiesTxt!: Phaser.GameObjects.Text;
  private tabBgTxt!:     Phaser.GameObjects.Text;

  // Tileset dropdown (TILES mode)
  private tilesetLabel!: Phaser.GameObjects.Text;

  // Tiles palette
  private paletteTiles:         Phaser.GameObjects.Image[]     = [];
  /** Red outline overlays — one per palette tile; visible iff the tile is in data.solidTiles. */
  private paletteSolidOverlays: Phaser.GameObjects.Rectangle[] = [];
  private paletteHilite!:   Phaser.GameObjects.Rectangle;
  private selectedTile      = 0;
  private paletteScrollY    = 0;
  private paletteMaxScrollY = 0;

  // Enemies palette — buttons for each prototype + a single spawner row
  private enemyPaletteObjs:   Phaser.GameObjects.GameObject[] = [];
  private enemyPaletteHilite!: Phaser.GameObjects.Rectangle;
  private enemyArmedIndex     = -1; // palette row (enemy prototypes 0..N-1, then spawner proto N..)

  // Backgrounds palette — one row per BACKGROUNDS entry plus a 'NONE' row.
  // Selecting a row writes level.data.background and rebuilds the in-world
  // background immediately; there's no arming step.
  private bgPaletteObjs:     Phaser.GameObjects.GameObject[] = [];
  private bgPaletteHilite!:  Phaser.GameObjects.Rectangle;
  /** -1 means NONE (no background), 0..n-1 indexes into BACKGROUNDS. */
  private selectedBgIndex    = -1;

  // Attribute panel (right side, shown when selected != null)
  private attrPanelObjs: Phaser.GameObjects.GameObject[] = [];

  // Pan state
  private panActive   = false;
  private panStartX   = 0;
  private panStartY   = 0;
  private panScrollX  = 0;
  private panScrollY  = 0;
  private static readonly PAN_SPEED = 480;

  // Cached pan keys (populated in buildInput)
  private panKeys!: {
    left:  Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up:    Phaser.Input.Keyboard.Key;
    aLeft:  Phaser.Input.Keyboard.Key;
    aRight: Phaser.Input.Keyboard.Key;
    aUp:    Phaser.Input.Keyboard.Key;
    aDown:  Phaser.Input.Keyboard.Key;
  };

  // Active level — set in init(), read from cache in buildScene().
  private levelName = DEFAULT_LEVEL_NAME;
  private isNewLevel = false;

  constructor() { super({ key: 'EditorScene' }); }

  // ── lifecycle ────────────────────────────────────────────────────────────
  /**
   * Phaser reuses the scene instance across `scene.start('EditorScene', ...)`
   * calls, so any transient arrays or flags we collected last time we ran are
   * still sitting here — pointing at Phaser GameObjects that were destroyed
   * on scene shutdown.  Reset all per-run state here BEFORE create() rebuilds
   * the UI; otherwise e.g. `paletteTiles` contains dead refs at the expected
   * tile indices and armTile()/applyPaletteScroll() operate on corpses — the
   * symptom is a palette that looks populated but can't be selected.
   */
  init(data: { levelName?: string; isNew?: boolean } = {}): void {
    this.levelName  = data.levelName ?? DEFAULT_LEVEL_NAME;
    this.isNewLevel = Boolean(data.isNew);

    // Transient render arrays — reset, not reused.
    this.paletteTiles         = [];
    this.paletteSolidOverlays = [];
    this.enemyPaletteObjs     = [];
    this.bgPaletteObjs        = [];
    this.enemySprites         = [];
    this.spawnerSprites       = [];
    this.attrPanelObjs        = [];

    // Editing state — clean slate every enter.
    this.mode             = 'tiles';
    this.armed            = null;
    this.selected         = null;
    this.dirty            = false;
    this.paletteScrollY   = 0;
    this.paletteMaxScrollY = 0;
    this.selectedTile     = 0;
    this.enemyArmedIndex  = -1;
    this.selectedBgIndex  = -1;
    this.panActive        = false;
    this.showGrid         = true;
  }

  private get cacheKey(): string { return `level-${this.levelName}`; }
  private get saveUrl():  string { return `/api/levels/${this.levelName}`; }

  /** Tag a game object as world — rendered only by main camera, ignored by uiCam. */
  private world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.worldLayer.add(obj);
    return obj;
  }

  /**
   * Sweep every game object still at scene root into the correct layer:
   *   - `setScrollFactor(0)` → UI layer (HUD, palette, attr panel)
   *   - anything whose `depth >= DEPTH_UI_BG` → UI layer (belt and braces)
   *   - everything else → world layer
   *
   * Safe to call repeatedly — objects already in either layer are skipped.
   * Call after any code path that adds new game objects (initial build,
   * attr-panel rebuild, dynamic enemy placement).
   */
  private partitionByCamera(): void {
    // Clone — moving an object between display lists mutates the source.
    const roots = [...this.children.list];
    for (const obj of roots) {
      // Don't re-parent the layer objects themselves (they live at scene root).
      if ((obj as unknown) === this.uiLayer) continue;
      if ((obj as unknown) === this.worldLayer) continue;
      const go = obj as Phaser.GameObjects.GameObject & {
        scrollFactorX?: number;
        depth?:         number;
      };
      const scrollLocked = go.scrollFactorX === 0;
      const hiDepth      = (go.depth ?? 0) >= DEPTH_UI_BG;
      if (scrollLocked || hiDepth) this.uiLayer.add(obj);
      else                         this.worldLayer.add(obj);
    }
  }

  create(): void {
    // New level: seed a blank LevelData directly into cache — no fetch.
    if (this.isNewLevel) {
      this.cache.json.remove(this.cacheKey);
      this.cache.json.add(this.cacheKey, makeBlankLevel(this.levelName));
      this.buildScene();
      this.dirty = true;   // unsaved by construction
      this.refreshHud();
      return;
    }

    // Existing level: re-fetch every time the editor opens so the cache
    // reflects the latest saved edits (preload() only runs once per page load).
    const editKey = this.cacheKey + '-edit';
    this.load.json(editKey, `levels/${this.levelName}.json?t=${Date.now()}`);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      const fresh = this.cache.json.get(editKey);
      this.cache.json.remove(this.cacheKey);
      this.cache.json.add(this.cacheKey, fresh);
      this.buildScene();
    });
    this.load.start();
  }

  private buildScene(): void {
    // ── Two-camera setup ────────────────────────────────────────────────
    // Main camera renders WORLD only, viewport inset so the sidebar never
    // covers actual tiles.  UI camera renders UI only, full-screen.
    // See class-field comment above for the design rationale.
    this.worldLayer = this.add.layer();
    this.uiLayer    = this.add.layer();

    const camMain = this.cameras.main;
    camMain.setBackgroundColor(0x0a0d14);
    camMain.setViewport(
      PALETTE_WIDTH,
      0,
      DISPLAY.width - PALETTE_WIDTH,
      DISPLAY.height,
    );
    camMain.setBounds(0, 0, WORLD.width, WORLD.height);
    camMain.ignore(this.uiLayer);

    this.uiCam = this.cameras.add(0, 0, DISPLAY.width, DISPLAY.height);
    this.uiCam.setScroll(0, 0);
    this.uiCam.ignore(this.worldLayer);

    this.level = loadTilemap(this, this.cacheKey, this.tilesetKey);
    this.tileWidth    = this.level.data.tileWidth;
    this.tileHeight   = this.level.data.tileHeight;
    this.displayScale = this.level.data.displayScale;

    // TilemapLoader creates groundLayer + optional background at scene
    // root; move them into worldLayer so uiCam ignores them.
    this.worldLayer.add(this.level.groundLayer);
    if (this.level.background) this.worldLayer.add(this.level.background);

    // Ensure arrays exist on the loaded data so we can mutate freely.
    this.level.data.enemies  = this.level.data.enemies  ?? [];
    this.level.data.spawners = this.level.data.spawners ?? [];

    this.gridGfx = this.world(this.add.graphics().setDepth(DEPTH_WORLD_GRID));
    this.drawGrid();

    // Hover ghosts (one per armable kind — shown/hidden based on armed tool).
    this.hoverGhost = this.world(
      this.add
        .image(0, 0, this.tilesetKey, 0)
        .setOrigin(0, 0)
        .setScale(this.displayScale)
        .setAlpha(0.55)
        .setDepth(DEPTH_HOVER)
        .setVisible(false),
    );

    this.hoverEnemyGhost = this.world(
      this.add
        .image(0, 0, ENEMY_PROTOTYPES[0].iconKey, ENEMY_PROTOTYPES[0].iconFrame ?? 0)
        .setOrigin(0.5, 0.5)
        .setScale(this.displayScale)
        .setAlpha(0.5)
        .setDepth(DEPTH_HOVER)
        .setVisible(false),
    );

    this.hoverSpawnerGhost = this.world(
      this.makeSpawnerIcon(0, 0, '?', 0)
        .setDepth(DEPTH_HOVER)
        .setAlpha(0.55)
        .setVisible(false),
    );

    // Selection ring that tracks the currently-selected entity in-world.
    this.selectionRing = this.world(
      this.add
        .rectangle(0, 0, 56, 56)
        .setOrigin(0.5, 0.5)
        .setStrokeStyle(2, 0xffcc00, 1)
        .setFillStyle()
        .setDepth(DEPTH_WORLD_SELECT)
        .setVisible(false),
    );

    this.buildUI();
    this.buildInput();
    this.rebuildEntitySprites();
    this.setMode('tiles');

    // Sort every game object added by the build steps into the correct
    // layer.  After this call, the main camera will only draw world stuff
    // and the UI camera only draws UI.
    this.partitionByCamera();
  }

  // ── Sidebar UI ───────────────────────────────────────────────────────────
  private buildUI(): void {
    this.paletteBg = this.add
      .rectangle(0, 0, PALETTE_WIDTH, DISPLAY.height, 0x0a1020, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1a3355)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_BG);

    this.buildTabs();
    this.buildTilesPalette();
    this.buildEnemiesPalette();
    this.buildBgPalette();
    this.buildHud();
  }

  private buildTabs(): void {
    const makeTab = (x: number, w: number, label: string, onClick: () => void) => {
      const bg = this.add
        .rectangle(x, 6, w, 24, 0x142238, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0x1a3355)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_CONTENT)
        .setInteractive({ useHandCursor: true });
      const txt = this.add
        .text(x + w / 2, 18, label, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#446688',
          letterSpacing: 2,
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_CONTENT + 1);
      bg.on('pointerdown', onClick);
      return { bg, txt };
    };
    // Three equal tabs: 8px side margins, 4px gaps.
    const GAP = 4;
    const tabW = Math.floor((PALETTE_WIDTH - 16 - 2 * GAP) / 3);
    const xFor = (i: number) => 8 + i * (tabW + GAP);
    const tiles   = makeTab(xFor(0), tabW, 'TILES',   () => this.setMode('tiles'));
    const enemies = makeTab(xFor(1), tabW, 'ENEMIES', () => this.setMode('enemies'));
    const bgTab   = makeTab(xFor(2), tabW, 'BG',      () => this.setMode('bg'));
    this.tabTilesBg   = tiles.bg;   this.tabTilesTxt   = tiles.txt;
    this.tabEnemiesBg = enemies.bg; this.tabEnemiesTxt = enemies.txt;
    this.tabBgBg      = bgTab.bg;   this.tabBgTxt      = bgTab.txt;

    // Tileset name — only visible in TILES mode.
    const active = TILESETS.find((t) => t.key === this.tilesetKey) ?? TILESETS[0];
    this.tilesetLabel = this.add
      .text(8, 42, `TILESET: ${active.name}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#446688',
      })
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT);
  }

  private buildTilesPalette(): void {
    const totalTiles = this.countTilesetTiles();
    const scale = PALETTE_TILE_PX / this.tileWidth;
    for (let i = 0; i < totalTiles; i++) {
      const col = i % PALETTE_COLS;
      const row = Math.floor(i / PALETTE_COLS);
      const x = PALETTE_PAD_X + col * (PALETTE_TILE_PX + PALETTE_GAP);
      const y = CONTENT_TOP + row * (PALETTE_TILE_PX + PALETTE_GAP);

      const img = this.add
        .image(x, y, this.tilesetKey, i)
        .setOrigin(0, 0)
        .setScale(scale)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_CONTENT)
        .setInteractive({ useHandCursor: true });
      img.on('pointerdown', (p: Phaser.Input.Pointer) => {
        // Shift+LMB on a palette tile toggles solidity — doesn't overload
        // RMB (which is "delete" on the world canvas).  Plain LMB arms.
        // `p.event` can be a MouseEvent or TouchEvent depending on input
        // source; only MouseEvent/KeyboardEvent have shiftKey — guard it.
        if (p.leftButtonDown()) {
          const shift = (p.event as MouseEvent | undefined)?.shiftKey ?? false;
          if (shift) this.toggleTileSolid(i);
          else       this.armTile(i);
        }
      });
      this.paletteTiles.push(img);

      // Solid-tile marker — red-tinted box overlay sized to the palette
      // cell, with a thick red border.  Easier to spot at a glance than a
      // thin outline.  Visibility tracks data.solidTiles, repositioned
      // in applyPaletteScroll.
      const overlay = this.add
        .rectangle(x, y, PALETTE_TILE_PX, PALETTE_TILE_PX, 0xff3344, 0.25)
        .setOrigin(0, 0)
        .setStrokeStyle(3, 0xff3344, 1)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_HILITE)
        .setVisible(false);
      this.paletteSolidOverlays.push(overlay);
    }

    const totalRows    = Math.ceil(totalTiles / PALETTE_COLS);
    const totalHeight  = totalRows * (PALETTE_TILE_PX + PALETTE_GAP);
    const visibleBand  = DISPLAY.height - CONTENT_TOP - 24;
    this.paletteMaxScrollY = Math.max(0, totalHeight - visibleBand);

    this.paletteHilite = this.add
      .rectangle(0, 0, PALETTE_TILE_PX + 4, PALETTE_TILE_PX + 4)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x00ff99)
      .setFillStyle()
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_HILITE);
    this.updateTileHilite();
  }

  private buildEnemiesPalette(): void {
    // Each prototype gets a row: icon + label.  Then a SPAWNER row per type.
    const rowH = 56;
    let idx = 0;
    for (const proto of ENEMY_PROTOTYPES) {
      this.addEnemyPaletteRow(idx, proto, rowH, 'solo');
      idx++;
    }
    for (const proto of ENEMY_PROTOTYPES) {
      this.addEnemyPaletteRow(idx, proto, rowH, 'spawner');
      idx++;
    }

    this.enemyPaletteHilite = this.add
      .rectangle(4, CONTENT_TOP - 2, PALETTE_WIDTH - 8, rowH)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x00ff99)
      .setFillStyle()
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_HILITE)
      .setVisible(false);
    this.enemyPaletteObjs.push(this.enemyPaletteHilite);
  }

  /** Add one row to the ENEMIES palette; clicking arms the corresponding tool. */
  private addEnemyPaletteRow(
    row: number,
    proto: EnemyPrototype,
    rowH: number,
    kind: 'solo' | 'spawner',
  ): void {
    const y = CONTENT_TOP + row * rowH;

    // Clickable strip (covers the whole row)
    const strip = this.add
      .rectangle(4, y, PALETTE_WIDTH - 8, rowH - 4, 0x142238, 0.6)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1a3355)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT)
      .setInteractive({ useHandCursor: true });
    strip.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.armEnemyPaletteRow(row, proto, kind);
    });
    this.enemyPaletteObjs.push(strip);

    // Icon — small preview of the enemy sprite frame 0
    if (kind === 'solo') {
      const icon = this.add
        .image(24, y + rowH / 2 - 2, proto.iconKey, proto.iconFrame ?? 0)
        .setOrigin(0.5, 0.5)
        .setScale(1)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_CONTENT + 1);
      this.enemyPaletteObjs.push(icon);
    } else {
      // Spawner: use a circle + 'S' badge instead of the enemy sprite.
      const badge = this.makeSpawnerIcon(24, y + rowH / 2 - 2, 'S', 0).setDepth(DEPTH_UI_CONTENT + 1);
      badge.setScrollFactor(0);
      this.enemyPaletteObjs.push(badge);
    }

    // Label
    const label = this.add
      .text(56, y + 10, proto.label, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ccd6ea',
        letterSpacing: 1,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT + 1);
    const sublabel = this.add
      .text(56, y + 28, kind === 'solo' ? 'SOLO' : 'SPAWNER', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: kind === 'solo' ? '#00ff99' : '#ffcc00',
      })
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT + 1);
    this.enemyPaletteObjs.push(label, sublabel);
  }

  private buildBgPalette(): void {
    // Layout mirrors the enemies palette: one row per entry + a NONE row.
    // NONE sits at index -1 (row 0); BACKGROUNDS entries start at row 1.
    const rowH = 56;
    this.addBgPaletteRow(0, null, rowH);
    for (let i = 0; i < BACKGROUNDS.length; i++) {
      this.addBgPaletteRow(i + 1, BACKGROUNDS[i], rowH);
    }

    this.bgPaletteHilite = this.add
      .rectangle(4, CONTENT_TOP - 2, PALETTE_WIDTH - 8, rowH)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0x00ff99)
      .setFillStyle()
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_HILITE)
      .setVisible(false);
    this.bgPaletteObjs.push(this.bgPaletteHilite);

    // Seed selection from whatever the level already has.
    const curKey = this.level?.data.background;
    this.selectedBgIndex = curKey
      ? BACKGROUNDS.findIndex((b) => b.key === curKey)
      : -1;
  }

  /**
   * Add one row to the BG palette.  `entry === null` renders the NONE row
   * (removes any background); otherwise the row shows a tiny thumbnail of
   * the background image plus its label.
   */
  private addBgPaletteRow(
    row:   number,
    entry: typeof BACKGROUNDS[number] | null,
    rowH:  number,
  ): void {
    const y = CONTENT_TOP + row * rowH;

    const strip = this.add
      .rectangle(4, y, PALETTE_WIDTH - 8, rowH - 4, 0x142238, 0.6)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1a3355)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT)
      .setInteractive({ useHandCursor: true });
    strip.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.selectBg(entry ? row - 1 : -1);
    });
    this.bgPaletteObjs.push(strip);

    if (entry) {
      // Thumbnail — fit the natural image inside a 40×32 box without
      // upscaling past source pixels (setDisplaySize would blur sharper
      // than that on larger art; for our small backdrops this is fine).
      const thumb = this.add
        .image(28, y + rowH / 2 - 2, entry.key)
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_CONTENT + 1);
      const tw = thumb.width || 1;
      const th = thumb.height || 1;
      const scale = Math.min(40 / tw, 32 / th, 1);
      thumb.setScale(scale);
      this.bgPaletteObjs.push(thumb);
    } else {
      // NONE — draw a crossed square so it reads at a glance.
      const g = this.add
        .graphics()
        .setScrollFactor(0)
        .setDepth(DEPTH_UI_CONTENT + 1);
      g.lineStyle(1, 0x446688, 1);
      g.strokeRect(8, y + rowH / 2 - 14, 40, 24);
      g.lineBetween(8, y + rowH / 2 - 14, 48, y + rowH / 2 + 10);
      g.lineBetween(48, y + rowH / 2 - 14, 8, y + rowH / 2 + 10);
      this.bgPaletteObjs.push(g);
    }

    const label = this.add
      .text(60, y + 10, entry ? entry.label : 'NONE', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ccd6ea',
        letterSpacing: 1,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT + 1);
    const sublabel = this.add
      .text(60, y + 28, entry ? 'BACKGROUND' : 'NO BACKGROUND', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: entry ? '#00ff99' : '#88aacc',
      })
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT + 1);
    this.bgPaletteObjs.push(label, sublabel);
  }

  /**
   * Apply a background selection.
   *   index === -1 → NONE (clears level.data.background)
   *   index >= 0   → BACKGROUNDS[index]
   * Writes data, rebuilds the in-world background, and re-partitions so
   * the main camera picks up the new object.
   */
  private selectBg(index: number): void {
    this.selectedBgIndex = index;
    this.level.data.background = index >= 0 ? BACKGROUNDS[index].key : undefined;
    this.rebuildBackground();
    this.updateBgPaletteHilite();
    this.markDirty();
  }

  private rebuildBackground(): void {
    if (this.level.background) {
      this.level.background.destroy();
      this.level.background = undefined;
    }
    const bg = createBackground(
      this,
      this.level.data.background,
      this.level.widthPx,
      this.level.heightPx,
    );
    if (bg) {
      this.worldLayer.add(bg);
      this.level.background = bg;
    }
  }

  private updateBgPaletteHilite(): void {
    if (this.mode !== 'bg') {
      this.bgPaletteHilite.setVisible(false);
      return;
    }
    const rowH = 56;
    const row  = this.selectedBgIndex + 1; // NONE is row 0
    this.bgPaletteHilite.setPosition(4, CONTENT_TOP + row * rowH - 2);
    this.bgPaletteHilite.setSize(PALETTE_WIDTH - 8, rowH);
    this.bgPaletteHilite.setVisible(true);
  }

  private buildHud(): void {
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

    // Opaque hint bar — the old 9px text sat directly on the tilemap and was
    // unreadable against bright tiles.  Dark strip + higher-contrast text.
    const hintStripH = 18;
    this.add
      .rectangle(
        PALETTE_WIDTH,
        DISPLAY.height - hintStripH,
        DISPLAY.width - PALETTE_WIDTH,
        hintStripH,
        0x0a1020,
        0.92,
      )
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1a3355)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_BG);

    this.helpText = this.add
      .text(PALETTE_WIDTH + 8, DISPLAY.height - 4,
        'T/Y/B MODE   LMB PLACE   RMB DELETE   SHIFT+LMB PALETTE=SOLID   ARROWS PAN   [ ] CYCLE   G GRID   S SAVE   R PLAY   E LOAD', {
        fontFamily: 'monospace',
        fontSize:   '11px',
        color:      '#88aacc',
        letterSpacing: 1,
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_CONTENT);

    this.refreshHud();
  }

  // ── Input ────────────────────────────────────────────────────────────────
  private buildInput(): void {
    this.input.mouse?.disableContextMenu();

    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_UP,   this.onPointerUp,   this);

    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointer: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
        if (!this.isOverSidebar(pointer)) return;
        if (this.mode === 'tiles') this.scrollPalette(dy);
      },
    );

    const kb = this.input.keyboard!;
    kb.on('keydown-S', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
      this.saveLevel();
    });
    kb.on('keydown-G',   () => this.toggleGrid());
    kb.on('keydown-T',   () => this.setMode('tiles'));
    kb.on('keydown-Y',   () => this.setMode('enemies'));
    kb.on('keydown-B',   () => this.setMode('bg'));
    kb.on('keydown-E',   () => this.exit());
    kb.on('keydown-R',   () => this.playtest());
    kb.on('keydown-ESC', () => this.deselectAndDisarm());
    kb.on('keydown-OPEN_BRACKET',   () => this.cycleSelection(-1));
    kb.on('keydown-CLOSED_BRACKET', () => this.cycleSelection(+1));

    const pageStep = PALETTE_TILE_PX * 4;
    kb.on('keydown-PAGE_UP',   () => this.scrollPalette(-pageStep));
    kb.on('keydown-PAGE_DOWN', () => this.scrollPalette(+pageStep));
    kb.on('keydown-HOME',      () => { this.paletteScrollY = 0; this.applyPaletteScroll(); });
    kb.on('keydown-END',       () => { this.paletteScrollY = this.paletteMaxScrollY; this.applyPaletteScroll(); });

    for (let n = 1; n <= 9; n++) {
      kb.on(`keydown-${n}`, () => this.quickSelect(n - 1));
    }

    this.panKeys = {
      left:  kb.addKey('A'),
      right: kb.addKey('D'),
      up:    kb.addKey('W'),
      aLeft:  kb.addKey('LEFT'),
      aRight: kb.addKey('RIGHT'),
      aUp:    kb.addKey('UP'),
      aDown:  kb.addKey('DOWN'),
    };

    // Scene SHUTDOWN is fired on scene.start('OtherScene') — the scene
    // instance is reused on re-entry, so we must strip listeners we added
    // here, otherwise every re-entry stacks another copy on the keyboard
    // plugin and the input handlers fire N times per keypress.  The keys
    // registered via addKey are cleaned up by Phaser automatically.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
      this.input.off(Phaser.Input.Events.POINTER_UP,   this.onPointerUp,   this);
      this.input.off(Phaser.Input.Events.POINTER_WHEEL);
      this.input.keyboard?.removeAllListeners();
    });
  }

  // Pointer ──────────────────────────────────────────────────────────────
  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.panActive) {
      const cam = this.cameras.main;
      cam.scrollX = this.panScrollX - (pointer.x - this.panStartX);
      cam.scrollY = this.panScrollY - (pointer.y - this.panStartY);
      return;
    }

    if (this.isOverSidebar(pointer) || this.isOverAttrPanel(pointer)) {
      this.setGhostsVisible(false, false, false);
      return;
    }

    const { tx, ty, wx, wy } = this.worldCellAt(pointer);
    if (this.outOfBounds(tx, ty)) {
      this.setGhostsVisible(false, false, false);
      return;
    }

    // Update ghost for the armed tool
    if (this.armed?.kind === 'tile') {
      this.hoverGhost.setPosition(wx, wy);
      this.setGhostsVisible(true, false, false);
    } else if (this.armed?.kind === 'enemy') {
      this.hoverEnemyGhost.setPosition(wx + this.tileWidth  * this.displayScale / 2,
                                       wy + this.tileHeight * this.displayScale / 2);
      this.setGhostsVisible(false, true, false);
    } else if (this.armed?.kind === 'spawner') {
      this.hoverSpawnerGhost.setPosition(wx + this.tileWidth  * this.displayScale / 2,
                                         wy + this.tileHeight * this.displayScale / 2);
      this.setGhostsVisible(false, false, true);
    } else {
      this.setGhostsVisible(false, false, false);
    }

    // Continuous paint/erase only for tile mode
    if (this.armed?.kind === 'tile') {
      if (pointer.leftButtonDown())  this.paintAt(tx, ty);
      if (pointer.rightButtonDown()) this.eraseTileAt(tx, ty);
    }
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
    if (this.isOverSidebar(pointer) || this.isOverAttrPanel(pointer)) return;

    const { tx, ty, wx, wy } = this.worldCellAt(pointer);
    if (this.outOfBounds(tx, ty)) return;

    // Click on an existing entity (world-space hit test)?
    const hit = this.hitTestEntity(pointer);
    if (hit) {
      if (pointer.rightButtonDown()) {
        this.deleteEntity(hit);
      } else if (pointer.leftButtonDown()) {
        this.select(hit);
      }
      return;
    }

    // Empty cell — armed tool determines action
    if (this.armed?.kind === 'tile') {
      if (pointer.leftButtonDown())  this.paintAt(tx, ty);
      if (pointer.rightButtonDown()) this.eraseTileAt(tx, ty);
    } else if (this.armed?.kind === 'enemy' && pointer.leftButtonDown()) {
      const cx = wx + this.tileWidth  * this.displayScale / 2;
      const cy = wy + this.tileHeight * this.displayScale / 2;
      this.placeEnemy(this.armed.protoId, cx, cy);
    } else if (this.armed?.kind === 'spawner' && pointer.leftButtonDown()) {
      const cx = wx + this.tileWidth  * this.displayScale / 2;
      const cy = wy + this.tileHeight * this.displayScale / 2;
      this.placeSpawner(this.armed.protoId, cx, cy);
    } else if (pointer.leftButtonDown()) {
      // Clicked empty world space with nothing armed → deselect.
      this.deselect();
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!pointer.middleButtonDown()) this.panActive = false;
  }

  update(_time: number, delta: number): void {
    if (!this.panKeys) return;
    const cam = this.cameras.main;
    const step = EditorScene.PAN_SPEED * (delta / 1000);
    if (this.panKeys.left.isDown  || this.panKeys.aLeft.isDown)  cam.scrollX -= step;
    if (this.panKeys.right.isDown || this.panKeys.aRight.isDown) cam.scrollX += step;
    if (this.panKeys.up.isDown    || this.panKeys.aUp.isDown)    cam.scrollY -= step;
    if (this.panKeys.aDown.isDown)                                cam.scrollY += step;
  }

  // ── Mode switch ──────────────────────────────────────────────────────────
  private setMode(next: EditorMode): void {
    this.mode = next;
    this.deselectAndDisarm();

    // Tab visuals
    const activeCol = '#00ff99';
    const idleCol   = '#446688';
    this.tabTilesBg  .setFillStyle(next === 'tiles'   ? 0x1e3050 : 0x142238);
    this.tabEnemiesBg.setFillStyle(next === 'enemies' ? 0x1e3050 : 0x142238);
    this.tabBgBg     .setFillStyle(next === 'bg'      ? 0x1e3050 : 0x142238);
    this.tabTilesTxt  .setColor(next === 'tiles'   ? activeCol : idleCol);
    this.tabEnemiesTxt.setColor(next === 'enemies' ? activeCol : idleCol);
    this.tabBgTxt     .setColor(next === 'bg'      ? activeCol : idleCol);

    // TILES-mode objects
    const showTiles = next === 'tiles';
    this.tilesetLabel.setVisible(showTiles);
    this.paletteHilite.setVisible(showTiles);
    for (const img of this.paletteTiles) img.setVisible(false); // applyPaletteScroll re-evaluates
    if (showTiles) this.applyPaletteScroll();

    // ENEMIES-mode objects
    const showEnemies = next === 'enemies';
    for (const o of this.enemyPaletteObjs) {
      (o as unknown as { setVisible: (v: boolean) => void }).setVisible(showEnemies);
    }
    this.enemyPaletteHilite.setVisible(false); // only shown when a row is armed

    // BG-mode objects
    const showBg = next === 'bg';
    for (const o of this.bgPaletteObjs) {
      (o as unknown as { setVisible: (v: boolean) => void }).setVisible(showBg);
    }
    this.updateBgPaletteHilite();

    this.refreshHud();
  }

  // ── Tool arming ──────────────────────────────────────────────────────────
  private armTile(index: number): void {
    this.armed = { kind: 'tile', index };
    this.selectedTile = index;
    this.updateTileHilite();
    this.hoverGhost.setFrame(index);
    this.refreshHud();
  }

  private armEnemyPaletteRow(
    rowIdx: number,
    proto: EnemyPrototype,
    kind: 'solo' | 'spawner',
  ): void {
    this.enemyArmedIndex = rowIdx;
    if (kind === 'solo') {
      this.armed = { kind: 'enemy', protoId: proto.id };
      this.hoverEnemyGhost.setTexture(proto.iconKey, proto.iconFrame ?? 0);
    } else {
      this.armed = { kind: 'spawner', protoId: proto.id };
      this.rebuildSpawnerGhost(proto);
    }
    this.updateEnemyPaletteHilite();
    this.refreshHud();
  }

  private rebuildSpawnerGhost(proto: EnemyPrototype): void {
    this.hoverSpawnerGhost.removeAll(true);
    const fresh = this.makeSpawnerIcon(0, 0, 'S', 2500, proto.label);
    // Re-parent the fresh container's children onto the long-lived ghost.
    // IMPORTANT: Container.destroy() defaults to destroying its children too,
    // which would nuke the GameObjects we just re-parented.  Call
    // removeAll(false) first so the children are detached but alive, then
    // destroy the now-empty shell.
    fresh.list.forEach((child) => this.hoverSpawnerGhost.add(child));
    fresh.removeAll(false);
    fresh.destroy();
  }

  private updateEnemyPaletteHilite(): void {
    if (this.enemyArmedIndex < 0) {
      this.enemyPaletteHilite.setVisible(false);
      return;
    }
    const rowH = 56;
    const y = CONTENT_TOP + this.enemyArmedIndex * rowH - 2;
    this.enemyPaletteHilite.setPosition(4, y);
    this.enemyPaletteHilite.setSize(PALETTE_WIDTH - 8, rowH);
    this.enemyPaletteHilite.setVisible(this.mode === 'enemies');
  }

  private updateTileHilite(): void {
    const col = this.selectedTile % PALETTE_COLS;
    const row = Math.floor(this.selectedTile / PALETTE_COLS);
    const x = PALETTE_PAD_X + col * (PALETTE_TILE_PX + PALETTE_GAP) - 2;
    const baseY = CONTENT_TOP + row * (PALETTE_TILE_PX + PALETTE_GAP) - 2;
    const y = baseY - this.paletteScrollY;
    this.paletteHilite.setPosition(x, y);
    this.paletteHilite.setVisible(this.mode === 'tiles' && this.isYInPaletteBand(y, PALETTE_TILE_PX + 4));
  }

  private quickSelect(n: number): void {
    if (this.mode === 'tiles')  this.armTile(n);
    else if (this.mode === 'enemies') {
      const rows = ENEMY_PROTOTYPES.length * 2;
      if (n >= 0 && n < rows) {
        const proto = ENEMY_PROTOTYPES[n % ENEMY_PROTOTYPES.length];
        const kind: 'solo' | 'spawner' = n < ENEMY_PROTOTYPES.length ? 'solo' : 'spawner';
        this.armEnemyPaletteRow(n, proto, kind);
      }
    }
  }

  private cycleSelection(dir: 1 | -1): void {
    if (this.mode === 'tiles') {
      const total = this.countTilesetTiles();
      this.armTile((this.selectedTile + dir + total) % total);
    } else if (this.mode === 'enemies') {
      const total = ENEMY_PROTOTYPES.length * 2;
      const cur = Math.max(0, this.enemyArmedIndex);
      const next = (cur + dir + total) % total;
      const proto = ENEMY_PROTOTYPES[next % ENEMY_PROTOTYPES.length];
      const kind: 'solo' | 'spawner' = next < ENEMY_PROTOTYPES.length ? 'solo' : 'spawner';
      this.armEnemyPaletteRow(next, proto, kind);
    }
  }

  // ── Tile edit ───────────────────────────────────────────────────────────
  private paintAt(tx: number, ty: number): void {
    const current = this.level.groundLayer.getTileAt(tx, ty);
    if (current && current.index === this.selectedTile) return;
    this.level.groundLayer.putTileAt(this.selectedTile, tx, ty);
    if (this.level.data.solidTiles.includes(this.selectedTile)) {
      this.level.groundLayer.setCollision(this.level.data.solidTiles);
    }
    this.writeCell(tx, ty, this.selectedTile);
    this.markDirty();
  }

  private eraseTileAt(tx: number, ty: number): void {
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

  // ── Entity placement ────────────────────────────────────────────────────
  private placeEnemy(protoId: string, x: number, y: number): void {
    const placement = defaultEnemy(this.nextId('e'), x, y, protoId) as unknown as EnemyPlacement;
    this.level.data.enemies!.push(placement);
    const sprite = this.makeEnemySprite(placement);
    this.enemySprites.push(sprite);
    this.select({ kind: 'enemy', index: this.level.data.enemies!.length - 1 });
    this.markDirty();
  }

  private placeSpawner(protoId: string, x: number, y: number): void {
    const placement = defaultSpawner(this.nextId('s'), x, y, protoId) as unknown as SpawnerPlacement;
    this.level.data.spawners!.push(placement);
    const sprite = this.makeSpawnerSpriteFor(placement);
    this.spawnerSprites.push(sprite);
    this.select({ kind: 'spawner', index: this.level.data.spawners!.length - 1 });
    this.markDirty();
  }

  private makeEnemySprite(p: EnemyPlacement): Phaser.GameObjects.Image {
    const proto = enemyProto(p.type);
    const img = this.add
      .image(p.x, p.y, proto?.iconKey ?? 'penguin_bot', proto?.iconFrame ?? 0)
      .setOrigin(0.5, 0.5)
      .setScale(this.displayScale)
      .setDepth(DEPTH_WORLD_ENTITY);
    img.setData('entity', { kind: 'enemy', id: p.id });
    return img;
  }

  private makeSpawnerSpriteFor(p: SpawnerPlacement): Phaser.GameObjects.Container {
    const proto = enemyProto(p.enemyType);
    const c = this.makeSpawnerIcon(p.x, p.y, 'S', p.intervalMs, proto?.label ?? p.enemyType);
    c.setDepth(DEPTH_WORLD_ENTITY);
    c.setData('entity', { kind: 'spawner', id: p.id });
    return c;
  }

  /** Rebuilds all entity sprites from the current data arrays. */
  private rebuildEntitySprites(): void {
    for (const s of this.enemySprites)   s.destroy();
    for (const s of this.spawnerSprites) s.destroy();
    this.enemySprites = [];
    this.spawnerSprites = [];
    for (const e of (this.level.data.enemies ?? [])) this.enemySprites.push(this.makeEnemySprite(e));
    for (const s of (this.level.data.spawners ?? [])) this.spawnerSprites.push(this.makeSpawnerSpriteFor(s));
    // New sprites land at scene root; move them into the world layer.
    this.partitionByCamera();
  }

  /** Visual for a spawner: dashed-ish circle + label lines.  Used in-world AND
   *  as the palette/hover icon so the editor and output art match. */
  private makeSpawnerIcon(x: number, y: number, badge: string, intervalMs: number, sublabel = ''): Phaser.GameObjects.Container {
    const g = this.add.graphics();
    g.lineStyle(2, 0xffcc00, 0.9);
    g.strokeCircle(0, 0, 18);
    g.lineStyle(1, 0xffcc00, 0.5);
    g.strokeCircle(0, 0, 22);
    const letter = this.add.text(0, -2, badge, {
      fontFamily: 'monospace',
      fontSize:   '14px',
      color:      '#ffcc00',
    }).setOrigin(0.5);
    const timeText = intervalMs > 0
      ? this.add.text(0, 12, `${(intervalMs/1000).toFixed(1)}s`, {
          fontFamily: 'monospace', fontSize: '8px', color: '#ffcc00',
        }).setOrigin(0.5)
      : null;
    const subText = sublabel
      ? this.add.text(0, 26, sublabel, {
          fontFamily: 'monospace', fontSize: '7px', color: '#446688',
        }).setOrigin(0.5)
      : null;
    const members: Phaser.GameObjects.GameObject[] = [g, letter];
    if (timeText) members.push(timeText);
    if (subText)  members.push(subText);
    return this.add.container(x, y, members);
  }

  // ── Selection ───────────────────────────────────────────────────────────
  private select(sel: Exclude<Selected, null>): void {
    this.selected = sel;
    this.updateSelectionRing();
    this.buildAttrPanel();
  }

  private deselect(): void {
    this.selected = null;
    this.selectionRing.setVisible(false);
    this.destroyAttrPanel();
  }

  private deselectAndDisarm(): void {
    this.deselect();
    this.armed = null;
    this.enemyArmedIndex = -1;
    this.updateEnemyPaletteHilite();
    this.setGhostsVisible(false, false, false);
    this.refreshHud();
  }

  private updateSelectionRing(): void {
    if (!this.selected) { this.selectionRing.setVisible(false); return; }
    const pos = this.selectedPosition();
    if (!pos) return;
    this.selectionRing.setPosition(pos.x, pos.y).setVisible(true);
  }

  private selectedPosition(): { x: number; y: number } | null {
    if (!this.selected) return null;
    if (this.selected.kind === 'enemy') {
      const e = this.level.data.enemies?.[this.selected.index];
      return e ? { x: e.x, y: e.y } : null;
    }
    const s = this.level.data.spawners?.[this.selected.index];
    return s ? { x: s.x, y: s.y } : null;
  }

  /** Hit-test pointer against placed entity sprites; returns a Selected ref. */
  private hitTestEntity(p: Phaser.Input.Pointer): Selected {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const R = 24; // hit radius in world px
    // Enemies
    const enemies = this.level.data.enemies ?? [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (Math.abs(wp.x - e.x) <= R && Math.abs(wp.y - e.y) <= R) {
        return { kind: 'enemy', index: i };
      }
    }
    const spawners = this.level.data.spawners ?? [];
    for (let i = 0; i < spawners.length; i++) {
      const s = spawners[i];
      if (Math.abs(wp.x - s.x) <= R && Math.abs(wp.y - s.y) <= R) {
        return { kind: 'spawner', index: i };
      }
    }
    return null;
  }

  private deleteEntity(sel: Exclude<Selected, null>): void {
    if (sel.kind === 'enemy') {
      this.level.data.enemies!.splice(sel.index, 1);
      this.enemySprites[sel.index]?.destroy();
      this.enemySprites.splice(sel.index, 1);
    } else {
      this.level.data.spawners!.splice(sel.index, 1);
      this.spawnerSprites[sel.index]?.destroy();
      this.spawnerSprites.splice(sel.index, 1);
    }
    if (this.selected &&
        this.selected.kind === sel.kind &&
        this.selected.index === sel.index) {
      this.deselect();
    }
    this.markDirty();
  }

  // ── Attribute editor panel ──────────────────────────────────────────────
  private destroyAttrPanel(): void {
    for (const o of this.attrPanelObjs) o.destroy();
    this.attrPanelObjs = [];
  }

  private buildAttrPanel(): void {
    this.destroyAttrPanel();
    if (!this.selected) return;

    const isEnemy = this.selected.kind === 'enemy';
    const obj: Record<string, unknown> | undefined = isEnemy
      ? (this.level.data.enemies?.[this.selected.index] as unknown as Record<string, unknown>)
      : (this.level.data.spawners?.[this.selected.index] as unknown as Record<string, unknown>);
    if (!obj) return;

    // Build the attribute list from the prototype
    let attrs: AttrSpec[] = [];
    let titleText = '';
    if (isEnemy) {
      const proto = enemyProto((obj['type'] as string) ?? '');
      attrs = proto?.attrs ?? [];
      titleText = `${proto?.label ?? 'ENEMY'}  ${(obj['id'] as string).toUpperCase()}`;
    } else {
      attrs = SPAWNER_ATTRS;
      const proto = enemyProto((obj['enemyType'] as string) ?? '');
      titleText = `SPAWNER  ${proto?.label ?? ''}  ${(obj['id'] as string).toUpperCase()}`;
    }

    const panelX = DISPLAY.width - ATTR_PANEL_W;
    const panelH = 48 + attrs.length * 24 + 40; // title + rows + delete
    const bg = this.add
      .rectangle(panelX, 48, ATTR_PANEL_W, panelH, 0x0a1020, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x1a3355)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_PANEL);
    this.attrPanelObjs.push(bg);

    const title = this.add.text(panelX + ATTR_PANEL_PAD, 56, titleText, {
      fontFamily: 'monospace', fontSize: '10px', color: '#ffcc00', letterSpacing: 1,
    }).setScrollFactor(0).setDepth(DEPTH_UI_PANEL + 1);
    this.attrPanelObjs.push(title);

    // Position line (x, y)
    const pos = this.add.text(panelX + ATTR_PANEL_PAD, 72,
      `POS  ${Math.round(obj['x'] as number)}, ${Math.round(obj['y'] as number)}`, {
      fontFamily: 'monospace', fontSize: '9px', color: '#446688',
    }).setScrollFactor(0).setDepth(DEPTH_UI_PANEL + 1);
    this.attrPanelObjs.push(pos);

    // Attr rows
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      const rowY = 92 + i * 24;
      const label = this.add.text(panelX + ATTR_PANEL_PAD, rowY, a.label.padEnd(7), {
        fontFamily: 'monospace', fontSize: '10px', color: '#ccd6ea',
      }).setScrollFactor(0).setDepth(DEPTH_UI_PANEL + 1);

      const valueText = this.add.text(panelX + ATTR_PANEL_PAD + 72, rowY, `${obj[a.key] ?? a.def}`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#00ff99',
      }).setScrollFactor(0).setDepth(DEPTH_UI_PANEL + 1);

      const makeBtn = (x: number, glyph: string, delta: number) => {
        const btn = this.add
          .rectangle(panelX + x, rowY + 6, 18, 16, 0x1e3050, 1)
          .setOrigin(0, 0)
          .setStrokeStyle(1, 0x1a3355)
          .setScrollFactor(0)
          .setDepth(DEPTH_UI_PANEL + 1)
          .setInteractive({ useHandCursor: true });
        const glyphText = this.add.text(panelX + x + 9, rowY + 8, glyph, {
          fontFamily: 'monospace', fontSize: '10px', color: '#00ff99',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_UI_PANEL + 2);
        btn.on('pointerdown', () => this.adjustAttr(obj, a, delta, valueText));
        this.attrPanelObjs.push(btn, glyphText);
      };
      makeBtn(ATTR_PANEL_W - 52, '−', -(a.step ?? 1));
      makeBtn(ATTR_PANEL_W - 28, '+',  +(a.step ?? 1));

      this.attrPanelObjs.push(label, valueText);
    }

    // Delete button
    const delY = 92 + attrs.length * 24 + 6;
    const delBg = this.add
      .rectangle(panelX + ATTR_PANEL_PAD, delY, ATTR_PANEL_W - ATTR_PANEL_PAD * 2, 22, 0x3a1420, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0xff3344)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_PANEL + 1)
      .setInteractive({ useHandCursor: true });
    const delTxt = this.add
      .text(panelX + ATTR_PANEL_W / 2, delY + 11, 'DELETE', {
        fontFamily: 'monospace', fontSize: '10px', color: '#ff3344', letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH_UI_PANEL + 2);
    delBg.on('pointerdown', () => {
      if (this.selected) this.deleteEntity(this.selected);
    });
    this.attrPanelObjs.push(delBg, delTxt);

    // Dynamic attr panel objects were just added at scene root — move
    // them into the UI layer so uiCam renders them and main camera
    // doesn't leak them over the world.
    this.partitionByCamera();
  }

  private adjustAttr(
    obj: Record<string, unknown>,
    a: AttrSpec,
    delta: number,
    valueText: Phaser.GameObjects.Text,
  ): void {
    if (a.kind === 'bool') {
      obj[a.key] = !Boolean(obj[a.key]);
    } else {
      const cur = (obj[a.key] as number) ?? (a.def as number);
      let next = cur + delta;
      if (a.min !== undefined) next = Math.max(a.min, next);
      if (a.max !== undefined) next = Math.min(a.max, next);
      obj[a.key] = next;
    }
    valueText.setText(`${obj[a.key]}`);
    this.markDirty();
    // If we changed a spawner's interval, regen the in-world icon.
    if (this.selected?.kind === 'spawner') {
      const i = this.selected.index;
      const data = this.level.data.spawners?.[i];
      if (data) {
        this.spawnerSprites[i]?.destroy();
        this.spawnerSprites[i] = this.makeSpawnerSpriteFor(data);
      }
      this.updateSelectionRing();
    }
  }

  // ── Save / Exit ─────────────────────────────────────────────────────────
  private async saveLevel(): Promise<void> {
    this.showStatus('SAVING...', '#ffcc00');
    try {
      const payload: LevelData = this.level.data;
      const res = await fetch(this.saveUrl, {
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

  private exit(): void {
    if (this.dirty) {
      this.showStatus('UNSAVED — PRESS S TO SAVE, E AGAIN TO DISCARD', '#ff3344');
      this.dirty = false;
      return;
    }
    this.scene.start('LevelPickerScene');
  }

  /**
   * Jump into PlayScene with the current level.  If there are unsaved edits
   * we auto-save first so the playtest always reflects what's on screen.
   */
  private async playtest(): Promise<void> {
    if (this.dirty) {
      this.showStatus('SAVING BEFORE PLAYTEST...', '#ffcc00');
      await this.saveLevel();
      if (this.dirty) return;  // save failed — showStatus already reported
    }
    this.scene.start('PlayScene', { levelName: this.levelName });
  }

  // ── Palette scroll (TILES mode) ─────────────────────────────────────────
  private scrollPalette(dy: number): void {
    const next = Phaser.Math.Clamp(this.paletteScrollY + dy, 0, this.paletteMaxScrollY);
    if (next === this.paletteScrollY) return;
    this.paletteScrollY = next;
    this.applyPaletteScroll();
  }

  private applyPaletteScroll(): void {
    const showTiles = this.mode === 'tiles';
    const solidSet  = new Set(this.level?.data.solidTiles ?? []);
    for (let i = 0; i < this.paletteTiles.length; i++) {
      const img = this.paletteTiles[i];
      const row = Math.floor(i / PALETTE_COLS);
      const baseY = CONTENT_TOP + row * (PALETTE_TILE_PX + PALETTE_GAP);
      const y = baseY - this.paletteScrollY;
      const visible = showTiles && this.isYInPaletteBand(y, PALETTE_TILE_PX);
      img.setY(y);
      img.setVisible(visible);

      const overlay = this.paletteSolidOverlays[i];
      if (overlay) {
        overlay.setY(y);
        overlay.setVisible(visible && solidSet.has(i));
      }
    }
    this.updateTileHilite();
  }

  /**
   * Flip a tile's solidity (right-click on a palette cell).
   * A tile is "solid" when its index appears in level.data.solidTiles —
   * that's the array TilemapLoader hands to groundLayer.setCollision at
   * PlayScene load time, so toggling here is all that's needed for the
   * tile to block the player after a re-save.
   */
  private toggleTileSolid(index: number): void {
    try {
      const list = this.level.data.solidTiles ?? [];
      const pos  = list.indexOf(index);
      if (pos >= 0) list.splice(pos, 1);
      else          list.push(index);
      this.level.data.solidTiles = list;
      this.dirty = true;
      this.applyPaletteScroll();
      this.refreshHud();
      this.showStatus(
        pos >= 0 ? `TILE ${index} → NOT SOLID` : `TILE ${index} → SOLID`,
        pos >= 0 ? '#88aacc' : '#ff3344',
      );
    } catch (err) {
      // Surface the crash the user reported rather than swallowing it.
      console.error('[editor] toggleTileSolid failed:', err);
      this.showStatus(`SOLID TOGGLE ERROR — see console`, '#ff3344');
    }
  }

  private isYInPaletteBand(y: number, height: number): boolean {
    const top    = CONTENT_TOP - 2;
    const bottom = DISPLAY.height - 20;
    return (y + height) > top && y < bottom;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
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

  private isOverAttrPanel(p: Phaser.Input.Pointer): boolean {
    return this.selected !== null && p.x > DISPLAY.width - ATTR_PANEL_W;
  }

  private countTilesetTiles(): number {
    const tex = this.textures.get(this.tilesetKey);
    const src = tex.source[0];
    const cols = Math.floor(src.width  / this.tileWidth);
    const rows = Math.floor(src.height / this.tileHeight);
    return cols * rows;
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

  private toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.drawGrid();
  }

  private setGhostsVisible(tile: boolean, enemy: boolean, spawner: boolean): void {
    this.hoverGhost.setVisible(tile);
    this.hoverEnemyGhost.setVisible(enemy);
    this.hoverSpawnerGhost.setVisible(spawner);
  }

  private markDirty(): void {
    if (!this.dirty) {
      this.dirty = true;
      this.refreshHud();
    }
  }

  private refreshHud(): void {
    const dirtyFlag = this.dirty ? ' *UNSAVED' : '';
    const modeStr = this.mode.toUpperCase();
    let armedStr = '—';
    if (this.armed?.kind === 'tile')     armedStr = `TILE ${this.armed.index.toString().padStart(3,'0')}`;
    else if (this.armed?.kind === 'enemy')   armedStr = `${this.armed.protoId} SOLO`.toUpperCase();
    else if (this.armed?.kind === 'spawner') armedStr = `${this.armed.protoId} SPAWN`.toUpperCase();
    else if (this.mode === 'bg') {
      armedStr = this.selectedBgIndex >= 0
        ? BACKGROUNDS[this.selectedBgIndex].label
        : 'NONE';
    }
    this.infoText.setText(
      `[${this.levelName.toUpperCase()}]  ${modeStr}  ${armedStr}${dirtyFlag}`,
    );
  }

  private showStatus(text: string, color: string): void {
    this.statusText.setColor(color);
    this.statusText.setText(text);
    this.time.delayedCall(2000, () => {
      if (this.statusText.text === text) this.statusText.setText('');
    });
  }

  private _nextId = 0;
  private nextId(prefix: string): string {
    this._nextId++;
    return `${prefix}_${Date.now().toString(36)}_${this._nextId}`;
  }
}
