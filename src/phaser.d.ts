/**
 * phaser.d.ts — Module shim for Phaser 4 TypeScript types.
 *
 * Phaser 4 ESM has only NAMED exports (no default export).
 * We re-declare the module so TypeScript accepts `import * as Phaser from 'phaser'`
 * and maps each named export to the corresponding global Phaser namespace member.
 *
 * Runtime: Vite's pre-bundler provides the actual named exports from phaser.esm.js.
 * Types:   Each `const X: typeof Phaser.X` below pins the type to the global namespace.
 */

declare module 'phaser' {
  // ── Constants ────────────────────────────────────────────────────────────
  const AUTO: typeof Phaser.AUTO;
  const CANVAS: typeof Phaser.CANVAS;
  const HEADLESS: typeof Phaser.HEADLESS;
  const NONE: typeof Phaser.NONE;
  const WEBGL: typeof Phaser.WEBGL;
  const LEFT: typeof Phaser.LEFT;
  const RIGHT: typeof Phaser.RIGHT;
  const UP: typeof Phaser.UP;
  const DOWN: typeof Phaser.DOWN;
  const FOREVER: typeof Phaser.FOREVER;
  const VERSION: typeof Phaser.VERSION;

  // ── Top-level class ───────────────────────────────────────────────────────
  const Game: typeof Phaser.Game;
  const Scene: typeof Phaser.Scene;

  // ── Namespaces ────────────────────────────────────────────────────────────
  const Actions: typeof Phaser.Actions;
  const Animations: typeof Phaser.Animations;
  const BlendModes: typeof Phaser.BlendModes;
  const Cache: typeof Phaser.Cache;
  const Cameras: typeof Phaser.Cameras;
  const Core: typeof Phaser.Core;
  const Curves: typeof Phaser.Curves;
  const Data: typeof Phaser.Data;
  const Display: typeof Phaser.Display;
  const Events: typeof Phaser.Events;
  const Filters: typeof Phaser.Filters;
  const GameObjects: typeof Phaser.GameObjects;
  const Geom: typeof Phaser.Geom;
  const Input: typeof Phaser.Input;
  const Loader: typeof Phaser.Loader;
  const Math: typeof Phaser.Math;
  const Physics: typeof Phaser.Physics;
  const Plugins: typeof Phaser.Plugins;
  const Renderer: typeof Phaser.Renderer;
  const Scale: typeof Phaser.Scale;
  const ScaleModes: typeof Phaser.ScaleModes;
  const Scenes: typeof Phaser.Scenes;
  const Sound: typeof Phaser.Sound;
  const Structs: typeof Phaser.Structs;
  const Textures: typeof Phaser.Textures;
  const Tilemaps: typeof Phaser.Tilemaps;
  const Time: typeof Phaser.Time;
  const TintModes: typeof Phaser.TintModes;
  const Tweens: typeof Phaser.Tweens;
  const Utils: typeof Phaser.Utils;
  const DOM: typeof Phaser.DOM;
  const Types: typeof Phaser.Types;

  export {
    AUTO, CANVAS, HEADLESS, NONE, WEBGL, LEFT, RIGHT, UP, DOWN, FOREVER, VERSION,
    Game, Scene,
    Actions, Animations, BlendModes, Cache, Cameras, Core, Curves, Data, Display,
    DOM, Events, Filters, GameObjects, Geom, Input, Loader, Math, Physics,
    Plugins, Renderer, Scale, ScaleModes, Scenes, Sound, Structs, Textures,
    Tilemaps, Time, TintModes, Tweens, Utils, Types,
  };
}
