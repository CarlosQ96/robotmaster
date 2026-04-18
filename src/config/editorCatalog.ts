/**
 * editorCatalog.ts — Registry consumed by EditorScene.
 *
 * Append to the arrays below to expose new tilesets / enemy prototypes
 * without touching editor code.  The editor re-renders the palettes from
 * these arrays at scene create().
 */

// ─── Tilesets ───────────────────────────────────────────────────────────────

export interface TilesetEntry {
  /** Texture cache key — must match what BootScene loaded as a spritesheet. */
  key:        string;
  /** Human label shown in the tileset dropdown. */
  name:       string;
  tileWidth:  number;
  tileHeight: number;
  /** Grid dims (cols × rows) — used to size the scrollable palette. */
  cols:       number;
  rows:       number;
}

export const TILESETS: TilesetEntry[] = [
  {
    key:        'castle_tiles',
    name:       'CASTLE',
    tileWidth:  16,
    tileHeight: 16,
    cols:       16,
    rows:       9,
  },
  // Add new tilesets here; BootScene needs a matching `load.spritesheet`.
];

// ─── Enemies + spawners ─────────────────────────────────────────────────────

export type AttrKind = 'int' | 'float' | 'bool';

export interface AttrSpec {
  /** Field name on the placement object (e.g. 'health'). */
  key:   string;
  /** Label shown in the attribute editor. */
  label: string;
  kind:  AttrKind;
  /** Default value when an entity is first placed. */
  def:   number | boolean;
  /** Stepper delta applied per `-`/`+` click. */
  step?: number;
  min?:  number;
  max?:  number;
}

export interface EnemyPrototype {
  /** Catalog id — persisted as `type` on the placement. */
  id:          string;
  /** Human label shown in the palette. */
  label:       string;
  /** Icon texture + optional frame index — rendered in the palette + world. */
  iconKey:     string;
  iconFrame?:  number;
  /** Editable attributes — the editor renders a stepper per entry. */
  attrs:       AttrSpec[];
}

export const ENEMY_PROTOTYPES: EnemyPrototype[] = [
  {
    id:        'penguin_bot',
    label:     'PENGUIN BOT',
    iconKey:   'penguin_bot',
    iconFrame: 0,
    attrs: [
      { key: 'health',  label: 'HP',      kind: 'int',   def: 3,   step: 1, min: 1, max: 20 },
      { key: 'speed',   label: 'SPEED',   kind: 'int',   def: 60,  step: 10, min: 10, max: 300 },
      { key: 'patrolL', label: 'PATROL←', kind: 'int',   def: 0,   step: 16 },
      { key: 'patrolR', label: 'PATROL→', kind: 'int',   def: 0,   step: 16 },
    ],
  },
  // Add future enemy types (walrus, roller, etc.) here.
];

/** Attributes common to every spawner. */
export const SPAWNER_ATTRS: AttrSpec[] = [
  { key: 'intervalMs',     label: 'EVERY',  kind: 'int', def: 2500, step: 250, min: 250, max: 20000 },
  { key: 'maxAlive',       label: 'MAX',    kind: 'int', def: 3,    step: 1,   min: 1,   max: 20 },
  { key: 'initialDelayMs', label: 'DELAY',  kind: 'int', def: 0,    step: 250, min: 0,   max: 10000 },
];

export function enemyProto(id: string): EnemyPrototype | undefined {
  return ENEMY_PROTOTYPES.find((e) => e.id === id);
}

/** Make a fresh placement object using catalog defaults. */
export function defaultEnemy(id: string, x: number, y: number, type: string): Record<string, unknown> {
  const proto = enemyProto(type);
  const obj: Record<string, unknown> = { id, type, x, y };
  if (!proto) return obj;
  for (const a of proto.attrs) obj[a.key] = a.def;
  return obj;
}

export function defaultSpawner(id: string, x: number, y: number, enemyType: string): Record<string, unknown> {
  const obj: Record<string, unknown> = { id, enemyType, x, y };
  for (const a of SPAWNER_ATTRS) obj[a.key] = a.def;
  return obj;
}
