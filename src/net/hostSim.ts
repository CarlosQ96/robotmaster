/**
 * hostSim.ts — Host-side network layer for multiplayer gameplay.
 *
 * Responsibilities (ONLY when the local user is the lobby host):
 *   - Drain input packets from NET_CHANNEL.INPUT each frame.
 *   - Compute edge events (just-pressed / just-released) from consecutive
 *     button bitfields per peer.
 *   - Provide `getInputFor(userId)` so MpPlayScene can feed each Player's
 *     update() with network-derived input.
 *   - Broadcast a full world snapshot every SNAPSHOT_MS.
 *   - Broadcast discrete event frames on NET_CHANNEL.EVENT (reliable).
 *
 * Integrity (Phase 5 will harden these):
 *   - Reject packets whose `v` doesn't match PROTOCOL_VERSION (decoder does this).
 *   - Reject packets with seq <= last-seen seq for that user (replay protection).
 *   - TODO: rate-limit packets per user (> 120/s = drop).
 */
import { WavedashBridge } from './WavedashBridge';
import {
  INPUT_BIT,
  NET_CHANNEL,
  PROTOCOL_VERSION,
  SNAPSHOT_MS,
  bitsToPlayerInput,
  decodeInput,
  encodeSnapshot,
  encodeEvent,
  type InputPacket,
  type WorldSnapshot,
  type SnapshotPlayer,
  type SnapshotEnemy,
  type SnapshotProjectile,
  type EventFrame,
} from './protocol';
import type { PlayerInput } from '../entities/Player';

/** Mask of all legally-defined input bits.  Packets with other bits set are
 *  sanitised — unknown bits get stripped before entering the sim. */
const VALID_BUTTONS_MASK =
  INPUT_BIT.LEFT | INPUT_BIT.RIGHT | INPUT_BIT.UP | INPUT_BIT.DOWN |
  INPUT_BIT.SHOOT | INPUT_BIT.JUMP | INPUT_BIT.SLIDE;

/** Per-peer 1-second rolling cap on input packets.  60 fps * 2 safety factor. */
const MAX_INPUTS_PER_SEC = 120;

interface PeerInputState {
  lastSeq:   number;
  prevBits:  number;
  currBits:  number;
  /** Derived PlayerInput — edges set when currBits != prevBits.  Reset after
   *  each read so edges only fire once per tick. */
  derived:   PlayerInput;
  /** Rate-limit bucket — count of accepted packets in the current 1-second
   *  window.  Packets that would push the count above MAX_INPUTS_PER_SEC
   *  are silently dropped; `droppedRate` tracks how many so the HUD / logs
   *  can surface suspected floods. */
  bucketStartMs: number;
  bucketCount:   number;
  droppedRate:   number;
  /** Packets rejected for failing sequence / version / shape validation. */
  droppedInvalid: number;
}

function freshInput(): PlayerInput {
  return {
    left: false, right: false, up: false, down: false,
    shootHeld: false, shootJustReleased: false,
    jumpJustPressed: false, slideJustPressed: false,
  };
}

export class HostSim {
  private peers = new Map<string, PeerInputState>();
  private tick  = 0;
  private broadcastAccumMs = 0;

  /**
   * Ensure the host has a peer input slot for this user.  Call once when a
   * user joins the lobby so `getInputFor` doesn't return the default input
   * (which would simulate a player holding nothing).
   */
  registerPeer(userId: string): void {
    if (!this.peers.has(userId)) {
      this.peers.set(userId, {
        lastSeq:  -1,
        prevBits: 0,
        currBits: 0,
        derived:  freshInput(),
        bucketStartMs: performance.now(),
        bucketCount:   0,
        droppedRate:   0,
        droppedInvalid: 0,
      });
    }
  }

  removePeer(userId: string): void {
    this.peers.delete(userId);
  }

  /**
   * Drain all pending input packets from the SDK.  Call once per frame,
   * BEFORE any Player.update() calls.  Updates each peer's derived input.
   */
  drainInputs(): void {
    const api = WavedashBridge.getApi();
    if (!api) return;

    const now = performance.now();
    const msgs = api.drainP2PChannel(NET_CHANNEL.INPUT);
    for (const msg of msgs) {
      const peer = this.peers.get(msg.identity);
      if (!peer) continue; // unknown sender — ignore

      // Rolling 1-second rate-limit window.  Reset bucket when the window
      // ages out, then reject anything above the cap.
      if (now - peer.bucketStartMs >= 1000) {
        peer.bucketStartMs = now;
        peer.bucketCount   = 0;
      }
      if (peer.bucketCount >= MAX_INPUTS_PER_SEC) {
        peer.droppedRate++;
        continue;
      }
      peer.bucketCount++;

      const pkt: InputPacket | null = decodeInput(msg.payload);
      if (!pkt) { peer.droppedInvalid++; continue; }

      // Replay protection: sequence numbers must strictly increase.
      if (pkt.seq <= peer.lastSeq) { peer.droppedInvalid++; continue; }
      peer.lastSeq = pkt.seq;

      // Sanitise button bits — anything outside the declared mask is
      // stripped so a malformed / malicious client can't toggle behaviour
      // we didn't account for.
      const cleanBits = pkt.btn & VALID_BUTTONS_MASK;

      // Promote the current bits to previous (this frame's "prev" is last
      // frame's "curr") then record the cleaned new bits.
      peer.prevBits = peer.currBits;
      peer.currBits = cleanBits;
    }

    // After all messages absorbed, materialise derived input for every peer
    // so callers get stable edge events this tick.
    for (const peer of this.peers.values()) {
      peer.derived = {
        ...freshInput(),
        ...bitsToPlayerInput(peer.currBits, peer.prevBits),
      };
      // Roll prevBits forward so edge events only fire for one tick.  Without
      // this, a button held across frames would re-fire jumpJustPressed on
      // every subsequent tick.
      peer.prevBits = peer.currBits;
    }
  }

  /** Return the PlayerInput for the given peer.  Safe to call each frame. */
  getInputFor(userId: string): PlayerInput {
    const peer = this.peers.get(userId);
    return peer ? peer.derived : freshInput();
  }

  /** Diagnostic snapshot of drop counters, for HUD / logs. */
  getDropStats(userId: string): { rate: number; invalid: number } {
    const peer = this.peers.get(userId);
    return {
      rate:    peer?.droppedRate   ?? 0,
      invalid: peer?.droppedInvalid ?? 0,
    };
  }

  /**
   * Advance the host's broadcast timer.  When SNAPSHOT_MS has elapsed the
   * caller's `buildSnapshotFn` is invoked and its return value is
   * serialised + broadcast on NET_CHANNEL.SNAPSHOT (unreliable).
   */
  tickBroadcast(
    deltaMs: number,
    buildSnapshotFn: (tick: number) => Omit<WorldSnapshot, 'v' | 'tick' | 'sentAtMs'>,
  ): void {
    const api = WavedashBridge.getApi();
    if (!api) return;

    this.broadcastAccumMs += deltaMs;
    if (this.broadcastAccumMs < SNAPSHOT_MS) return;
    this.broadcastAccumMs = 0;
    this.tick++;

    const body = buildSnapshotFn(this.tick);
    const snap: WorldSnapshot = {
      v: PROTOCOL_VERSION,
      tick: this.tick,
      sentAtMs: performance.now(),
      ...body,
    };

    const bytes = encodeSnapshot(snap);
    // "" = broadcast to all peers, unreliable (channel 0 / snapshot).
    api.sendP2PMessage('', bytes, NET_CHANNEL.SNAPSHOT, false);
  }

  /**
   * Broadcast a discrete game event on NET_CHANNEL.EVENT (reliable).
   */
  broadcastEvent(evt: Omit<EventFrame, 'v'>): void {
    const api = WavedashBridge.getApi();
    if (!api) return;
    const full = { v: PROTOCOL_VERSION, ...evt } as EventFrame;
    api.sendP2PMessage('', encodeEvent(full), NET_CHANNEL.EVENT, true);
  }

  // Convenience helpers for scene code building snapshots.

  static buildPlayerEntry(userId: string, state: SnapshotPlayer['state']): SnapshotPlayer {
    return { userId, state };
  }
  static buildEnemyEntry(id: string, state: SnapshotEnemy['state']): SnapshotEnemy {
    return { id, state };
  }
  static buildProjectileEntry(id: string, state: SnapshotProjectile['state']): SnapshotProjectile {
    return { id, state };
  }
}
