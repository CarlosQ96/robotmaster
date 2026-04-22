/**
 * protocol.ts — Wire format for multiplayer packets.
 *
 * v1 uses JSON-over-UTF8 for simplicity.  Wavedash's P2P messageSize
 * default is 2 KB; we initialize with 16 KB (see main.ts) so a snapshot
 * carrying ~2 players + ~10 enemies + ~20 bullets fits comfortably.
 *
 * Future: switch to a packed binary format once the payload gets tight.
 * Versioned `V` byte in every packet so old builds refuse to decode new
 * packets rather than silently misinterpret them.
 *
 * Channels:
 *   0 = snapshots (unreliable, ~20 Hz)
 *   1 = inputs    (unreliable, per-frame)
 *   2 = events    (reliable)
 */
import type { PlayerSyncState }     from '../entities/RemotePlayer';
import type { EnemySyncState }      from '../entities/RemoteEnemy';
import type { ProjectileSyncState } from '../entities/RemoteProjectile';

export const PROTOCOL_VERSION = 1;

export const NET_CHANNEL = {
  SNAPSHOT: 0,
  INPUT:    1,
  EVENT:    2,
} as const;

/** Target broadcast rate for snapshots (Hz).  50ms between packets. */
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_MS = 1000 / SNAPSHOT_HZ;

/**
 * Input packet sent by each client every frame.  Uses a bitfield for the
 * button states; edge events (JustPressed/JustReleased) are computed on
 * the host by comparing consecutive `buttons` values per user.
 *
 * Button bit layout:
 *   bit 0: LEFT
 *   bit 1: RIGHT
 *   bit 2: UP
 *   bit 3: DOWN
 *   bit 4: SHOOT   (Z held)
 *   bit 5: JUMP    (SPACE held)
 *   bit 6: SLIDE   (X held)
 */
export interface InputPacket {
  v:    number;   // protocol version
  seq:  number;   // monotonically-increasing sequence number (replay protection)
  btn:  number;   // button bitfield
}

export const INPUT_BIT = {
  LEFT:  1 << 0,
  RIGHT: 1 << 1,
  UP:    1 << 2,
  DOWN:  1 << 3,
  SHOOT: 1 << 4,
  JUMP:  1 << 5,
  SLIDE: 1 << 6,
} as const;

/** One entry in the snapshot's player list. */
export interface SnapshotPlayer {
  userId: string;
  state:  PlayerSyncState;
}

/** One entry in the snapshot's enemy list. */
export interface SnapshotEnemy {
  id:    string;
  state: EnemySyncState;
}

/** One entry in the snapshot's projectile list. */
export interface SnapshotProjectile {
  id:    string;
  state: ProjectileSyncState;
}

/**
 * Full world snapshot broadcast by the host on NET_CHANNEL.SNAPSHOT.
 *
 * `tick` is the host's monotonic tick counter used for interpolation
 * ordering.  Clients discard packets whose tick is < the highest tick
 * they've already applied.
 */
export interface WorldSnapshot {
  v:           number;
  tick:        number;
  sentAtMs:    number;            // host wall-clock at broadcast
  players:     SnapshotPlayer[];
  enemies:     SnapshotEnemy[];
  projectiles: SnapshotProjectile[];
}

/** Reliable event frame on NET_CHANNEL.EVENT. */
export type EventFrame =
  | { v: number; type: 'shot-fired';     userId: string; x: number; y: number; facingRight: boolean; shotType: 'small' | 'charged' | 'full_charged' }
  | { v: number; type: 'enemy-died';     id: string }
  | { v: number; type: 'player-died';    userId: string; x: number; y: number }
  | { v: number; type: 'player-respawn'; userId: string; x: number; y: number }
  | { v: number; type: 'game-over';      winnerId?: string }
  | { v: number; type: 'game-start';     hostId: string; tickStartMs: number };

// ─── Encoding ──────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeInput(packet: InputPacket): Uint8Array {
  return enc.encode(JSON.stringify(packet));
}

export function decodeInput(bytes: Uint8Array): InputPacket | null {
  try {
    const obj = JSON.parse(dec.decode(bytes)) as InputPacket;
    if (obj.v !== PROTOCOL_VERSION) return null;
    return obj;
  } catch {
    return null;
  }
}

export function encodeSnapshot(snap: WorldSnapshot): Uint8Array {
  return enc.encode(JSON.stringify(snap));
}

export function decodeSnapshot(bytes: Uint8Array): WorldSnapshot | null {
  try {
    const obj = JSON.parse(dec.decode(bytes)) as WorldSnapshot;
    if (obj.v !== PROTOCOL_VERSION) return null;
    return obj;
  } catch {
    return null;
  }
}

export function encodeEvent(evt: EventFrame): Uint8Array {
  return enc.encode(JSON.stringify(evt));
}

export function decodeEvent(bytes: Uint8Array): EventFrame | null {
  try {
    const obj = JSON.parse(dec.decode(bytes)) as EventFrame;
    if (obj.v !== PROTOCOL_VERSION) return null;
    return obj;
  } catch {
    return null;
  }
}

// ─── Input bitfield helpers ────────────────────────────────────────────────

/**
 * Turn a raw button bitfield + the previous-tick bitfield into a full
 * PlayerInput object with edge events.  Used by the host-sim when
 * translating client packets; also used by the local client to project
 * its own input into the sim for snappier visuals while the host loop
 * catches up.
 */
export function bitsToPlayerInput(
  current:  number,
  previous: number,
): {
  left: boolean; right: boolean; up: boolean; down: boolean;
  shootHeld: boolean; shootJustReleased: boolean;
  jumpJustPressed: boolean; slideJustPressed: boolean;
} {
  const held    = (mask: number) => (current  & mask) !== 0;
  const wasHeld = (mask: number) => (previous & mask) !== 0;
  return {
    left:              held(INPUT_BIT.LEFT),
    right:             held(INPUT_BIT.RIGHT),
    up:                held(INPUT_BIT.UP),
    down:              held(INPUT_BIT.DOWN),
    shootHeld:         held(INPUT_BIT.SHOOT),
    shootJustReleased: !held(INPUT_BIT.SHOOT) &&  wasHeld(INPUT_BIT.SHOOT),
    jumpJustPressed:    held(INPUT_BIT.JUMP)  && !wasHeld(INPUT_BIT.JUMP),
    slideJustPressed:   held(INPUT_BIT.SLIDE) && !wasHeld(INPUT_BIT.SLIDE),
  };
}
