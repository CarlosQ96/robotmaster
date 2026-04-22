/**
 * WavedashBridge.ts — Single entry point to the Wavedash SDK.
 *
 * Responsibilities:
 *   - Detect if `window.WavedashJS` is present (not all dev environments inject it).
 *   - Await `init()` exactly once; subsequent callers receive the same resolved promise.
 *   - Expose a typed `getApi()` that returns the raw SDK or `null` when absent.
 *
 * Design rules:
 *   - Never throw on missing SDK.  Solo mode must keep working in a plain
 *     `vite dev` without the Wavedash injection.
 *   - Never call SDK methods before `init()` resolves — they silently fail.
 *   - Keep this file thin.  Higher-level features (lobbies, UGC, netcode)
 *     live in their own modules and consume `getApi()`.
 */
import type { WavedashJSAPI, WavedashConstantsAPI } from './wavedash.d';

/** Read the SDK off the window with a narrow cast — the declaration file
 *  marks these optional, so TS treats access as `API | undefined`. */
function readWavedash(): WavedashJSAPI | undefined {
  return (globalThis as unknown as { WavedashJS?: WavedashJSAPI }).WavedashJS;
}

function readConstants(): WavedashConstantsAPI | undefined {
  return (globalThis as unknown as { WavedashConstants?: WavedashConstantsAPI }).WavedashConstants;
}

let readyPromise: Promise<boolean> | null = null;

export const WavedashBridge = {
  /**
   * Initialise the SDK.  Idempotent — callers may invoke this from multiple
   * entry points (main.ts, first scene, etc.) without side-effects.
   *
   * Resolves to `true` if the SDK was found AND `init()` succeeded,
   * `false` otherwise.  A `false` result is not an error — the app should
   * continue into solo mode.
   */
  init(): Promise<boolean> {
    if (readyPromise) return readyPromise;

    readyPromise = (async () => {
      const api = readWavedash();
      if (!api) {
        console.info('[Wavedash] SDK not injected — running in solo-only mode.');
        return false;
      }
      try {
        // messageSize is raised from the 2 KB default so JSON-encoded world
        // snapshots (players + enemies + projectiles) don't get truncated.
        await api.init({
          debug: false,
          deferEvents: false,
          p2p: {
            maxPeers:    8,
            messageSize: 16384,
          },
        });
        console.info('[Wavedash] SDK ready.  User:', api.getUsername?.() ?? '?');
        return true;
      } catch (err) {
        console.warn('[Wavedash] init() failed:', err);
        return false;
      }
    })();

    return readyPromise;
  },

  /**
   * Returns the raw SDK handle, or `null` if unavailable.  Callers must
   * null-check.  The handle is only valid after `init()` has resolved true.
   */
  getApi(): WavedashJSAPI | null {
    return readWavedash() ?? null;
  },

  /** Constants namespace — stable numeric enum values for visibility, UGC type, etc. */
  getConstants(): WavedashConstantsAPI | null {
    return readConstants() ?? null;
  },

  /** Convenience — has the SDK been loaded AND successfully initialised? */
  async isReady(): Promise<boolean> {
    return await (readyPromise ?? Promise.resolve(false));
  },

  /** Synchronous check — use AFTER awaiting `init()` somewhere upstream. */
  isPresent(): boolean {
    return readWavedash() !== undefined;
  },
};
