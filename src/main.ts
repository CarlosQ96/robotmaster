/**
 * main.ts — Phaser 4 game entry point.
 *
 * Phaser 4 is WebGL-first. Canvas is a fallback only.
 * roundPixels is false by default in P4 — pixel rounding is applied
 * per-object via vertexRoundMode where needed (see Player.ts).
 */
import * as Phaser from 'phaser';
import { DISPLAY, PHYSICS, DEBUG } from './config/gameConfig';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { CharacterSelectScene } from './scenes/CharacterSelectScene';
import { GymScene } from './scenes/GymScene';
import { LevelPickerScene } from './scenes/LevelPickerScene';
import { EditorScene } from './scenes/EditorScene';
import { PlayScene } from './scenes/PlayScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,           // WebGL-first — Phaser 4 default
  width: DISPLAY.width,
  height: DISPLAY.height,
  backgroundColor: DISPLAY.backgroundColor,
  parent: 'game-container',

  // Nearest-neighbour texture filtering — keeps pixel art crisp at any integer scale.
  // antialias:false → gl.NEAREST instead of gl.LINEAR for all textures.
  // roundPixels stays false; per-object vertexRoundMode:'safe' handles sub-pixel snapping.
  antialias: false,
  roundPixels: false,

  // Fit the canvas to the browser viewport, preserving the 16:9 aspect ratio.
  // Nearest-neighbour filtering (antialias:false above) keeps pixel art readable
  // even at fractional scales; any leftover space becomes a black letterbox.
  scale: {
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: PHYSICS.gravityY },
      // debug:true creates world.debugGraphic; drawDebug controls whether it draws.
      // Always create the graphic in debug mode so the [P] toggle works at runtime.
      debug: DEBUG.enabled,
    },
  },

  scene: [BootScene, TitleScene, CharacterSelectScene, GymScene, LevelPickerScene, EditorScene, PlayScene],
};

new Phaser.Game(config);
