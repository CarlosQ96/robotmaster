/**
 * mapPublisher.ts — Level ↔ Wavedash UGC bridge.
 *
 * Publishing:
 *   1. Serialise the editor's in-memory LevelData to JSON bytes.
 *   2. Stage it in Wavedash's virtual FS via writeLocalFile.
 *   3. createUgcItem(COMMUNITY, …) with the staging path.
 *   4. Persist the returned UGC id locally so subsequent re-publishes of
 *      the same map name can update the existing entry.
 *
 * Downloading (for lobby joiners):
 *   1. downloadUgcItem(id, destDir).
 *   2. readLocalFile(destDir + filename) — the download writes to dest.
 *   3. JSON.parse into LevelData and hand it to MpPlayScene via the
 *      existing in-memory `levelData` entry point we added earlier.
 *
 * No SDK?  publish() returns null and logs; download() returns null.
 */
import { WavedashBridge } from './WavedashBridge';
import type { LevelData } from '../utils/TilemapLoader';

const LS_REGISTRY_KEY = 'robot-lords:publishedMaps';

export interface PublishedMapRecord {
  /** Local level name (filename minus .json). */
  name:      string;
  /** Wavedash UGC id. */
  ugcId:     string;
  /** Title shown to other players in the lobby picker. */
  title:     string;
  /** When we published (ms epoch). */
  publishedAt: number;
}

/** Encoded/decoded registry of "maps I have published" so we can show a list in the lobby. */
function readRegistry(): Record<string, PublishedMapRecord> {
  try {
    const raw = localStorage.getItem(LS_REGISTRY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PublishedMapRecord>;
  } catch {
    return {};
  }
}

function writeRegistry(reg: Record<string, PublishedMapRecord>): void {
  try {
    localStorage.setItem(LS_REGISTRY_KEY, JSON.stringify(reg));
  } catch {
    // Non-fatal — registry is cosmetic, UGC ids are also on the Wavedash side.
  }
}

/** Return the list of maps the current user has published (sorted newest first). */
export function listPublishedMaps(): PublishedMapRecord[] {
  return Object.values(readRegistry()).sort((a, b) => b.publishedAt - a.publishedAt);
}

/** Look up a previously-published UGC id by local map name. */
export function getPublishedRecord(name: string): PublishedMapRecord | null {
  return readRegistry()[name] ?? null;
}

/**
 * Publish a level to UGC.  Returns the UGC id on success, `null` on any
 * failure path (SDK missing, write failed, upload failed).  Safe to call
 * multiple times for the same level — we do not attempt `update_ugc_item`
 * in this first version; each publish creates a new UGC entry.  A follow-up
 * can wire update-in-place once the basic flow is verified.
 */
export async function publishMap(
  data:        LevelData,
  title:       string,
  description: string,
  visibility:  'public' | 'friends' | 'private' = 'public',
): Promise<string | null> {
  const api   = WavedashBridge.getApi();
  const constants = WavedashBridge.getConstants();
  if (!api || !constants) {
    console.warn('[mapPublisher] SDK not present — publish skipped.');
    return null;
  }

  const visCode =
    visibility === 'friends' ? constants.FRIENDS_ONLY :
    visibility === 'private' ? constants.PRIVATE :
    constants.PUBLIC;

  // Stage the bytes in the virtual FS.  Path is stable across publishes of
  // the same map so the UGC metadata has a predictable name.
  const stagingPath = `ugc-staging/${data.name}.json`;
  const bytes = new TextEncoder().encode(JSON.stringify(data));

  try {
    await api.writeLocalFile(stagingPath, bytes);
  } catch (err) {
    console.warn('[mapPublisher] writeLocalFile failed:', err);
    return null;
  }

  const res = await api.createUgcItem(
    constants.COMMUNITY,
    title,
    description,
    visCode,
    stagingPath,
  );
  if (!res.success || !res.data) {
    console.warn('[mapPublisher] createUgcItem failed:', res.message);
    return null;
  }

  const reg = readRegistry();
  reg[data.name] = {
    name:       data.name,
    ugcId:      res.data,
    title,
    publishedAt: Date.now(),
  };
  writeRegistry(reg);

  return res.data;
}

/**
 * Download a published map and return its parsed LevelData.
 * Returns null on failure.
 *
 * We download into a per-ugc cache directory then read the first .json
 * back out.  The SDK docs don't guarantee a single filename layout across
 * platforms, so we list the directory and pick the first .json we see.
 * If the layout surprises us in practice, the fallback is small + isolated
 * here.
 */
export async function downloadMap(ugcId: string): Promise<LevelData | null> {
  const api = WavedashBridge.getApi();
  if (!api) {
    console.warn('[mapPublisher] SDK not present — download skipped.');
    return null;
  }

  const destDir = `ugc-cache/${ugcId}/`;

  const dlRes = await api.downloadUgcItem(ugcId, destDir);
  if (!dlRes.success) {
    console.warn('[mapPublisher] downloadUgcItem failed:', dlRes.message);
    return null;
  }

  // The uploaded filename is `<mapName>.json`, but we don't know mapName at
  // this site — try a few candidate paths in order.  First try a conventional
  // `level.json` (the common SDK example), then fall back to listing the dir
  // (which the JS SDK doesn't expose cleanly yet — if that path shape fails
  // we log a clear error).
  const candidates = [`${destDir}level.json`];
  let payload: Uint8Array | null = null;

  for (const path of candidates) {
    try {
      payload = await api.readLocalFile(path);
      if (payload && payload.byteLength > 0) break;
    } catch {
      // try next
    }
  }

  if (!payload) {
    // Last resort: try to read by the UGC id as filename
    try {
      payload = await api.readLocalFile(`${destDir}${ugcId}.json`);
    } catch {
      // still nothing
    }
  }

  if (!payload || payload.byteLength === 0) {
    console.warn('[mapPublisher] downloaded UGC but could not locate JSON payload inside', destDir);
    return null;
  }

  try {
    const text = new TextDecoder().decode(payload);
    return JSON.parse(text) as LevelData;
  } catch (err) {
    console.warn('[mapPublisher] failed to parse downloaded map JSON:', err);
    return null;
  }
}
