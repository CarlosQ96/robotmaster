/**
 * paletteConfig.ts — Player colour palette definitions.
 *
 * Each palette replaces the body colour (#0078F8) with a single flat colour.
 * White highlights (#FCFCFC) and black outlines are never touched, giving the
 * classic NES one-colour-swap look: body + white sheen + black outlines.
 *
 * All hex values use the NES master palette for retro authenticity.
 * The 'default' entry is a pass-through — player_default is used as-is.
 */

export interface PaletteDef {
  /** Internal key used in scene data and texture key derivation */
  key: string;
  /** Display name shown in the character select screen */
  name: string;
  /** Phaser texture key for the swapped spritesheet */
  textureKey: string;
  /** Hex colour that replaces #0078F8 (body fill / armour) */
  color: string;
}

export const PALETTES: readonly PaletteDef[] = [
  //  key        name        textureKey           body replaces #0078F8
  { key: 'default', name: 'DEFAULT', textureKey: 'player_default', color: '#0078F8' },
  { key: 'crimson', name: 'CRIMSON', textureKey: 'player_crimson', color: '#CC1000' },
  { key: 'forest',  name: 'FOREST',  textureKey: 'player_forest',  color: '#007800' },
  { key: 'shadow',  name: 'SHADOW',  textureKey: 'player_shadow',  color: '#6800B0' },
  { key: 'gold',    name: 'GOLD',    textureKey: 'player_gold',    color: '#B07800' },
] as const;

export const DEFAULT_PALETTE = PALETTES[0];
