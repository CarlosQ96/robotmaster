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

export interface LevelData {
  name:         string;
  tileWidth:    number;
  tileHeight:   number;
  displayScale: number;
  widthTiles:   number;
  heightTiles:  number;
  tileset:      string;            // matches the image key (e.g. 'tileset-castle')
  solidTiles:   number[];          // tile indices that participate in collision
  layers:       Record<string, number[][]>;
  /** Optional image cache key rendered behind the ground layer (scrolls with
   *  a 0.3 parallax factor).  Set to the same key used in this.load.image. */
  background?:  string;
}

export interface LoadedLevel {
  data:          LevelData;
  map:           Phaser.Tilemaps.Tilemap;
  tileset:       Phaser.Tilemaps.Tileset;
  groundLayer:   Phaser.Tilemaps.TilemapLayer;
  background?:   Phaser.GameObjects.Image;
  widthPx:       number;           // world width in pixels (post-scale)
  heightPx:      number;
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

  // Optional background — stretched to fill the world so the scene (sky,
  // mountains, etc.) reads once end-to-end without visual tiling seams.
  // Mild parallax (scrollFactor 0.3) gives depth as the camera follows the
  // player.  Scaling up pixel art is lossless with nearest-neighbour filtering
  // (see main.ts antialias:false).
  let background: Phaser.GameObjects.Image | undefined;
  if (data.background && scene.textures.exists(data.background)) {
    background = scene.add
      .image(0, 0, data.background)
      .setOrigin(0, 0)
      .setDisplaySize(widthPx, heightPx)
      .setScrollFactor(0.3)
      .setDepth(-1);
  }

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
  if (data.solidTiles.length > 0) {
    groundLayer.setCollision(data.solidTiles);
  }

  return {
    data,
    map,
    tileset,
    groundLayer,
    background,
    widthPx,
    heightPx,
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
  const displayScale = params.displayScale ?? 2;
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
