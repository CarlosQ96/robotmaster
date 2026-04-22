/**
 * identity.ts — Player identity resolver.
 *
 * Priority order:
 *   1. Wavedash SDK's `getUsername()` — authoritative when the game runs on
 *      the wavedash.com platform.
 *   2. Locally-persisted name in localStorage — survives across dev sessions.
 *   3. A `prompt()` dialog on first run, defaulting to a random "Player-####"
 *      so CI / headless contexts still get a stable name without interaction.
 *
 * The returned name is a presentation string; uniqueness is not guaranteed.
 * For networking IDs, always use `WavedashBridge.getApi().getUserId()` —
 * that's the stable userId Wavedash issues.
 */
import { WavedashBridge } from './WavedashBridge';

const LS_KEY = 'robot-lords:playerName';
const MAX_NAME_LEN = 20;

function randomFallback(): string {
  return `Player-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function sanitise(raw: string): string {
  return raw.trim().slice(0, MAX_NAME_LEN) || randomFallback();
}

/**
 * Resolve the player's display name.
 *
 * @param allowPrompt when true, a missing local name triggers a `prompt()` —
 *   fine from a menu scene, NEVER pass true from a hot path like update().
 */
export function getPlayerName(allowPrompt = false): string {
  // 1. Prefer the SDK username when available.
  const api = WavedashBridge.getApi();
  const sdkName = api?.getUsername?.();
  if (sdkName && sdkName.trim().length > 0) return sdkName;

  // 2. Fallback to localStorage.
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && stored.trim().length > 0) return stored;
  } catch {
    // localStorage unavailable (private mode / SSR) — continue to prompt/fallback.
  }

  // 3. First run — either ask or use the random fallback.
  let chosen: string;
  if (allowPrompt && typeof prompt === 'function') {
    const suggestion = randomFallback();
    chosen = sanitise(prompt('Enter your pilot name:', suggestion) ?? suggestion);
  } else {
    chosen = randomFallback();
  }

  setPlayerName(chosen);
  return chosen;
}

/** Persist a chosen name to localStorage.  Ignored gracefully if LS is unavailable. */
export function setPlayerName(name: string): void {
  const clean = sanitise(name);
  try {
    localStorage.setItem(LS_KEY, clean);
  } catch {
    // Non-fatal — the name still applies for this session.
  }
}

/**
 * Stable user id for networking.  SDK userId if present, otherwise a
 * locally-persisted random UUID-ish string so solo dev can still simulate
 * peer identities in tests.
 */
export function getPlayerId(): string {
  const api = WavedashBridge.getApi();
  const sdkId = api?.getUserId?.();
  if (sdkId && sdkId.trim().length > 0) return sdkId;

  const LS_ID_KEY = 'robot-lords:playerId';
  try {
    const existing = localStorage.getItem(LS_ID_KEY);
    if (existing) return existing;
    const fresh = `local-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LS_ID_KEY, fresh);
    return fresh;
  } catch {
    return `local-${Math.random().toString(36).slice(2, 10)}`;
  }
}
