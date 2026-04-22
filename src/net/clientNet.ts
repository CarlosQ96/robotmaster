/**
 * clientNet.ts — Non-host network layer for multiplayer gameplay.
 *
 * Active ONLY when the local user is not the lobby host.
 *
 * Responsibilities:
 *   - Send an InputPacket every frame on NET_CHANNEL.INPUT (unreliable).
 *     Bitfield is derived from the local Phaser keyboard.
 *   - Drain WorldSnapshots from NET_CHANNEL.SNAPSHOT; buffer the two most
 *     recent so MpPlayScene can interpolate between them.
 *   - Drain EventFrames from NET_CHANNEL.EVENT; expose via an event emitter
 *     so the scene can react to one-shot server events (shots fired, etc.).
 *
 * No prediction / reconciliation in v1 — pure snapshot interpolation.
 * Apparent input latency ≈ host RTT; acceptable for the hackathon.
 */
import * as Phaser from 'phaser';
import { WavedashBridge } from './WavedashBridge';
import {
  INPUT_BIT,
  NET_CHANNEL,
  PROTOCOL_VERSION,
  SNAPSHOT_MS,
  decodeEvent,
  decodeSnapshot,
  encodeInput,
  type InputPacket,
  type WorldSnapshot,
  type EventFrame,
} from './protocol';

export class ClientNet {
  readonly events = new Phaser.Events.EventEmitter();

  private hostId = '';
  private seq    = 0;

  /** Rolling buffer of the two most recent snapshots for interpolation. */
  private newer: WorldSnapshot | null = null;
  private older: WorldSnapshot | null = null;
  /** When we received `newer` (wall-clock ms) — used to schedule interpolation. */
  private newerLocalMs = 0;

  /** If no snapshot has arrived for this many ms the host is considered
   *  dropped — ClientNet fires `'host-lost'` exactly once per session. */
  private static readonly HOST_TIMEOUT_MS = 3000;
  private hostLostEmitted = false;
  /** When we last saw ANY message from the host.  Reset on every decoded
   *  snapshot and event.  Seeded when the host is set. */
  private lastSeenMs = 0;

  /** Kept for the MpPlayScene's input-building hot path.  Keys live on
   *  the scene-level keyboard so we don't double-register. */
  private keys?: {
    left:  Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    up:    Phaser.Input.Keyboard.Key;
    down:  Phaser.Input.Keyboard.Key;
    shoot: Phaser.Input.Keyboard.Key;
    jump:  Phaser.Input.Keyboard.Key;
    slide: Phaser.Input.Keyboard.Key;
  };

  setHost(hostId: string): void {
    this.hostId = hostId;
    this.lastSeenMs = performance.now();
    this.hostLostEmitted = false;
  }

  bindKeys(kb: Phaser.Input.Keyboard.KeyboardPlugin): void {
    this.keys = {
      left:  kb.addKey('LEFT'),
      right: kb.addKey('RIGHT'),
      up:    kb.addKey('UP'),
      down:  kb.addKey('DOWN'),
      shoot: kb.addKey('Z'),
      jump:  kb.addKey('SPACE'),
      slide: kb.addKey('X'),
    };
  }

  /** Read local keyboard → build button bitfield → send to host. */
  sendInput(): void {
    const api = WavedashBridge.getApi();
    if (!api || !this.hostId || !this.keys) return;

    let bits = 0;
    if (this.keys.left.isDown)  bits |= INPUT_BIT.LEFT;
    if (this.keys.right.isDown) bits |= INPUT_BIT.RIGHT;
    if (this.keys.up.isDown)    bits |= INPUT_BIT.UP;
    if (this.keys.down.isDown)  bits |= INPUT_BIT.DOWN;
    if (this.keys.shoot.isDown) bits |= INPUT_BIT.SHOOT;
    if (this.keys.jump.isDown)  bits |= INPUT_BIT.JUMP;
    if (this.keys.slide.isDown) bits |= INPUT_BIT.SLIDE;

    // Always send — even on no-change — so the host doesn't stale out on
    // packet loss.  20-frame drop at 60 FPS = 333ms lag, acceptable.
    this.seq++;
    const pkt: InputPacket = { v: PROTOCOL_VERSION, seq: this.seq, btn: bits };
    api.sendP2PMessage(this.hostId, encodeInput(pkt), NET_CHANNEL.INPUT, false);
  }

  /** Drain inbound snapshots and events from the SDK.  Call once per frame. */
  drain(): void {
    const api = WavedashBridge.getApi();
    if (!api) return;

    for (const msg of api.drainP2PChannel(NET_CHANNEL.SNAPSHOT)) {
      const snap = decodeSnapshot(msg.payload);
      if (!snap) continue;
      // Discard out-of-order snapshots — trust the most recent tick.
      if (this.newer && snap.tick <= this.newer.tick) continue;
      this.older = this.newer;
      this.newer = snap;
      this.newerLocalMs = performance.now();
      this.lastSeenMs   = this.newerLocalMs;
    }

    for (const msg of api.drainP2PChannel(NET_CHANNEL.EVENT)) {
      const evt: EventFrame | null = decodeEvent(msg.payload);
      if (!evt) continue;
      this.lastSeenMs = performance.now();
      this.events.emit(evt.type, evt);
    }

    // Stale-host check — if the host hasn't sent anything in HOST_TIMEOUT_MS,
    // we assume the connection is dead.  Emit once; the scene routes the
    // user back to the lobby with a message.
    if (!this.hostLostEmitted && this.hostId) {
      if (performance.now() - this.lastSeenMs > ClientNet.HOST_TIMEOUT_MS) {
        this.hostLostEmitted = true;
        this.events.emit('host-lost', { reason: 'timeout' });
      }
    }
  }

  /** Explicit host-lost trigger — called by MpPlayScene when the lobby SDK
   *  reports the host peer disconnected.  Matches the path `drain()` takes
   *  on a silent-timeout so scene code only has one handler to wire. */
  notifyHostLost(reason: 'disconnected' | 'timeout' = 'disconnected'): void {
    if (this.hostLostEmitted) return;
    this.hostLostEmitted = true;
    this.events.emit('host-lost', { reason });
  }

  /**
   * Return the most recent two snapshots + the current interpolation
   * parameter `t` (0..1).  Scene code lerps between `older` (t=0) and
   * `newer` (t=1).
   *
   * We intentionally render ~1 snapshot behind live: when a fresh `newer`
   * arrives we start at t=0 and ramp to t=1 over the next SNAPSHOT_MS so
   * motion is always visibly moving.  If a snapshot is lost, `t` clamps at
   * 1 (we hold at `newer` until the next one arrives).
   */
  getInterpolated(): { older: WorldSnapshot | null; newer: WorldSnapshot | null; t: number } {
    if (!this.newer || !this.older) {
      return { older: this.older, newer: this.newer, t: 1 };
    }
    const span = this.newer.tick - this.older.tick;
    if (span <= 0) return { older: this.older, newer: this.newer, t: 1 };

    // Blend across one snapshot interval (SNAPSHOT_MS).  t=0 the moment
    // `newer` arrives, t=1 after SNAPSHOT_MS has elapsed.
    const rawMs = performance.now() - this.newerLocalMs;
    const t = Math.max(0, Math.min(1, rawMs / SNAPSHOT_MS));
    return { older: this.older, newer: this.newer, t };
  }

  /** Clear buffers on scene shutdown. */
  reset(): void {
    this.newer = null;
    this.older = null;
    this.seq   = 0;
  }
}
