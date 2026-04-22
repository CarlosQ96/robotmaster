/**
 * TilemapLoader — reusable level JSON → Phaser tilemap + collision.
 *
 * Level JSON format (hand-authored or saved by the in-game editor):
 *
 *   {
 *     "name": "gym",
 *     "tileWidth": 16,              // source tile size in the tileset image
 *     "tileHeight": 16,
 *     "displayScale": 2,            // render scale applied to the layer
 *     "widthTiles": 60,             // world size in tiles
 *     "heightTiles": 17,
 *     "tileset": "reactor",         // key used when loading the tileset image
 *     "solidTiles": [1, 2, 3],      // tile indices that block the player
 *     "layers": {
 *       "ground": [ [-1, -1, 0, ...], ... ]   // -1 = empty cell
 *     }
 *   }
 *
 * Usage:
 *
 *   // preload:
 *   this.load.spritesheet('castle_tiles', 'assets/castle/castle_tiles.png',
 *                          { frameWidth: 16, frameHeight: 16 });
 *   this.load.image('castle_bg', 'assets/castle/castle_bg.png');
 *   this.load.json('level-gym', 'levels/gym.json');
 *
 *   // create:
 *   const level = TilemapLoader.load(this, 'level-gym');
 *   this.physics.add.collider(this.player, level.groundLayer);
 *
 * The loader treats the level as authoritative — tile indices are 0-based into
 * the tileset image, `-1` means no tile (empty cell).  Phaser internally uses
 * 1-based indices (+1 firstgid), but putTileAt/getTileAt accept 0-based which
 * we pass straight through.
 */
import * as Phaser from 'phaser';

// ─── Placed entities ────────────────────────────────────────────────────────
// Authored in the editor, stored in the level JSON, consumed at runtime by a
// future spawning system.  Coordinates are in WORLD pixels (post-scale),
// snapped to tile-cell centers by the editor.

/** A single pre-placed enemy instance. */
export interface EnemyPlacement {
  id:           string;   // unique per level (editor-generated)
  type:         string;   // catalog key (e.g. 'penguin_bot')
  x:            number;   // world px
  y:            number;
  facingRight?: boolean;
  // Per-placement attribute overrides (defaults come from the catalog).
  health?:      number;
  speed?:       number;
  patrolL?:     number;
  patrolR?:     number;
}

/** A spawner that emits enemies on a timer. */
export interface SpawnerPlacement {
  id:               string;
  enemyType:        string; // catalog key of the enemy it spawns
  x:                number;
  y:                number;
  intervalMs:       number;
  maxAlive?:        number;
  initialDelayMs?:  number;
  totalSpawns?:     number;  // -1 or missing = infinite
}

export interface LevelData {
  name:         string;
  tileWidth:    number;
  tileHeight:   number;
  displayScale: number;
  widthTiles:   number;
  heightTiles:  number;
  tileset:      string;            // matches the image key (e.g. 'tileset-castle')
  solidTiles:   number[];          // tile indices that participate in collision
  /** Tile indices that the player can climb.  Do NOT collide the player. */
  ladderTiles?: number[];
  layers:       Record<string, number[][]>;
  /** Optional image cache key rendered behind the ground layer (scrolls with
   *  a 0.3 parallax factor).  Set to the same key used in this.load.image. */
  background?:  string;
  /** Pre-placed enemies (authored in the editor). */
  enemies?:     EnemyPlacement[];
  /** Timer-based spawners (authored in the editor). */
  spawners?:    SpawnerPlacement[];
}

/**
 * Either a stretched full-world Image (background ≥ world dims) or a
 * TileSprite that tiles a smaller source image across the world with
 * horizontal/vertical parallax (see createBackground).
 */
export type BackgroundObject =
  | Phaser.GameObjects.Image
  | Phaser.GameObjects.TileSprite;

export interface LoadedLevel {
  data:          LevelData;
  map:           Phaser.Tilemaps.Tilemap;
  tileset:       Phaser.Tilemaps.Tileset;
  groundLayer:   Phaser.Tilemaps.TilemapLayer;
  background?:   BackgroundObject;
  widthPx:       number;           // world width in pixels (post-scale)
  heightPx:      number;
  /** Tile indices the player can climb (from LevelData.ladderTiles ?? []). */
  ladderTiles:   number[];
}

/**
 * Build the background game object for a level.
 *
 *   - Image ≥ world in both axes → stretch to world, scrollFactor 0.3
 *     (original behavior: one backdrop spans the whole level with mild
 *     parallax).
 *   - Image < world in either axis → TileSprite locked to the camera,
 *     texture scrolled via `tilePositionX/Y` at 0.5 × camera scroll for
 *     true parallax tiling of small art across a large world.
 *
 * Returns undefined if the key is missing or the texture isn't loaded —
 * caller decides whether to fall back.
 */
export function createBackground(
  scene:    Phaser.Scene,
  bgKey:    string | undefined,
  widthPx:  number,
  heightPx: number,
): BackgroundObject | undefined {
  if (!bgKey || !scene.textures.exists(bgKey)) return undefined;

  const src  = scene.textures.get(bgKey).getSourceImage(0) as {
    width?: number; height?: number;
  };
  const imgW = src.width  ?? widthPx;
  const imgH = src.height ?? heightPx;

  if (imgW < widthPx || imgH < heightPx) {
    // Small art → TileSprite that covers the camera viewport.  The texture
    // is scaled up to fill the camera height (tileScale preserves aspect),
    // then tiles horizontally only.  scrollFactor=0 locks the sprite to the
    // viewport; tilePositionX is driven from camera scrollX so the tiled
    // texture parallaxes across the world without ever "running out" of
    // art at world edges.  No vertical parallax — the image already fills
    // the view top-to-bottom.
    const cam = scene.cameras.main;
    const ts = scene.add
      .tileSprite(0, 0, cam.width, cam.height, bgKey)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-1);
    const tileScale = cam.height / imgH;
    ts.setTileScale(tileScale, tileScale);
    const onUpdate = () => {
      ts.tilePositionX = scene.cameras.main.scrollX * 0.5;
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    // Must detach on destroy — rebuildBackground in the editor churns
    // these, and scene events survive game-object death.
    ts.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    });
    return ts;
  }

  return scene.add
    .image(0, 0, bgKey)
    .setOrigin(0, 0)
    .setDisplaySize(widthPx, heightPx)
    .setScrollFactor(0.3)
    .setDepth(-1);
}

/**
 * Build a Phaser tilemap in-memory from pre-loaded JSON + tileset image.
 * Mutates the scene by adding a layer game object.  Caller owns the return.
 */
export function loadTilemap(
  scene:          Phaser.Scene,
  levelKey:       string,                // cache key of the preloaded JSON
  tilesetImageKey: string,               // cache key of the preloaded tileset image
): LoadedLevel {
  const data = scene.cache.json.get(levelKey) as LevelData;
  if (!data) throw new Error(`TilemapLoader: level '${levelKey}' not in cache`);

  const { tileWidth, tileHeight, widthTiles, heightTiles, displayScale } = data;
  const widthPx  = widthTiles  * tileWidth  * displayScale;
  const heightPx = heightTiles * tileHeight * displayScale;

  // Optional background — createBackground picks stretched vs parallax-tiling
  // based on the source image's natural size vs the world dimensions.
  const background = createBackground(scene, data.background, widthPx, heightPx);

  // Build a blank tilemap and copy ground-layer indices into it.
  const map = scene.make.tilemap({
    tileWidth, tileHeight,
    width:  widthTiles,
    height: heightTiles,
  });

  const tileset = map.addTilesetImage(
    data.tileset,          // the "name" used to reference this tileset inside the map
    tilesetImageKey,       // the cache key of the loaded image
    tileWidth, tileHeight,
  );
  if (!tileset) throw new Error(`TilemapLoader: tileset '${data.tileset}' failed to resolve`);

  const groundLayer = map.createBlankLayer('ground', tileset, 0, 0, widthTiles, heightTiles);
  if (!groundLayer) throw new Error(`TilemapLoader: createBlankLayer failed for 'ground'`);
  groundLayer.setScale(displayScale);

  // Fill cells from the 2D array; -1 == empty (skip).
  const grid = data.layers.ground ?? [];
  for (let ty = 0; ty < heightTiles; ty++) {
    const row = grid[ty] ?? [];
    for (let tx = 0; tx < widthTiles; tx++) {
      const idx = row[tx] ?? -1;
      if (idx >= 0) groundLayer.putTileAt(idx, tx, ty);
    }
  }

  // Collision: mark the declared solid tiles so Arcade physics separates on them.
  // Ladder tiles are explicitly NOT collided — even if the author accidentally
  // put a ladder index in solidTiles, the player must be able to walk through
  // them to climb.
  const ladderTiles = data.ladderTiles ?? [];
  const solids = data.solidTiles.filter((idx) => !ladderTiles.includes(idx));
  if (solids.length > 0) {
    groundLayer.setCollision(solids);
  }

  return {
    data,
    map,
    tileset,
    groundLayer,
    background,
    widthPx,
    heightPx,
    ladderTiles,
  };
}

/**
 * Produce a fresh empty LevelData block sized to the given world.  Used by
 * the editor when creating a new level from scratch.
 */
export function blankLevel(params: {
  name:         string;
  tileset:      string;
  tileWidth?:   number;
  tileHeight?:  number;
  displayScale?: number;
  widthTiles:   number;
  heightTiles:  number;
  solidTiles?:  number[];
}): LevelData {
  const tileWidth   = params.tileWidth   ?? 16;
  const tileHeight  = params.tileHeight  ?? 16;
  const displayScale = params.displayScale ?? 1;
  const ground: number[][] = [];
  for (let y = 0; y < params.heightTiles; y++) {
    ground.push(new Array(params.widthTiles).fill(-1));
  }
  return {
    name:         params.name,
    tileWidth,
    tileHeight,
    displayScale,
    widthTiles:   params.widthTiles,
    heightTiles:  params.heightTiles,
    tileset:      params.tileset,
    solidTiles:   params.solidTiles ?? [],
    layers:       { ground },
  };
}
