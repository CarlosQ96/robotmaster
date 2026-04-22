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
import { LobbyBrowserScene } from './scenes/LobbyBrowserScene';
import { LobbyScene } from './scenes/LobbyScene';
import { PublicLobbyListScene } from './scenes/PublicLobbyListScene';
import { MpPlayScene } from './scenes/MpPlayScene';
import { MpGymScene } from './scenes/MpGymScene';
import { WavedashBridge } from './net/WavedashBridge';
import { maybeInstallDevShim } from './net/wavedashDevShim';

// Install the local multiplayer shim when the real Wavedash SDK isn't
// injected.  Lets two `vite dev` browser tabs find each other via
// BroadcastChannel + localStorage for hackathon iteration.  Skipped
// automatically when the real SDK is present.
maybeInstallDevShim();

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

  scene: [
    BootScene,
    TitleScene,
    CharacterSelectScene,
    GymScene,
    LevelPickerScene,
    EditorScene,
    PlayScene,
    LobbyBrowserScene,
    LobbyScene,
    PublicLobbyListScene,
    MpPlayScene,
    MpGymScene,
  ],
};

// Kick off Wavedash SDK init in parallel with Phaser boot.  The bridge is
// idempotent and returns `false` cleanly when the SDK isn't injected (i.e.
// local `vite dev` without the platform wrapper), so solo mode keeps working.
// We don't await here — subsequent scenes call `WavedashBridge.isReady()`
// if they need the result.
WavedashBridge.init();

new Phaser.Game(config);
