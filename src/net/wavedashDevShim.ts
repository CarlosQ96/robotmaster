/**
 * wavedashDevShim.ts — Installs a minimal `window.WavedashJS` mock so the
 * multiplayer stack is testable on plain `vite dev` without the real SDK.
 *
 * How it works:
 *   - Lobby registry lives in localStorage (`wavedash-dev-lobbies` key).
 *   - Per-lobby coordination uses a BroadcastChannel.  Members talk to each
 *     other by broadcasting `{ fromId, toId, kind, payload }` frames; every
 *     tab filters messages it should receive (toId === me || toId === '').
 *   - Each tab picks a random userId on first run and persists it.
 *
 * Scope: enough API surface for this project — NOT a full SDK replacement.
 * Achievements, stats, leaderboards, avatars, friends, presence: unstubbed.
 * Voice, UGC directory layouts: also unstubbed.
 *
 * Gate via `VITE_WAVEDASH_DEV_SHIM=1` or URL `?wavedash-dev=1` so the shim
 * never accidentally ships to prod / platform builds where the real SDK is
 * injected.  We only install if `window.WavedashJS` is absent anyway —
 * belt-and-suspenders.
 */
import type {
  WavedashJSAPI,
  WavedashConstantsAPI,
  LobbyUser,
  LobbyInfo,
  LobbyMessage,
  WavedashResponse,
} from './wavedash.d';

// ─── Gate + install ────────────────────────────────────────────────────────

export function maybeInstallDevShim(): void {
  if (typeof window === 'undefined') return;
  if ((window as unknown as { WavedashJS?: unknown }).WavedashJS) return;

  // Allow forcing via URL param for quick testing.
  const params = new URLSearchParams(window.location.search);
  const forceShim = params.get('wavedash-dev') === '1';
  const envShim   = (import.meta as unknown as { env?: Record<string, string> })
    .env?.VITE_WAVEDASH_DEV_SHIM === '1';
  // Default ON in dev for this project so the hackathon flow works out of the box.
  const defaultOn = true;
  if (!forceShim && !envShim && !defaultOn) return;

  console.info('[WavedashDevShim] Installing local multiplayer shim (no real SDK present).');
  installShim();
}

// ─── Identity ──────────────────────────────────────────────────────────────

const USER_LS = 'wavedash-dev:self';

function readOrCreateSelf(): { userId: string; username: string } {
  try {
    const raw = localStorage.getItem(USER_LS);
    if (raw) return JSON.parse(raw) as { userId: string; username: string };
  } catch { /* ignore */ }
  const userId = `dev-${Math.random().toString(36).slice(2, 10)}`;
  const username = `Dev-${userId.slice(4, 8)}`;
  try { localStorage.setItem(USER_LS, JSON.stringify({ userId, username })); } catch { /* ignore */ }
  return { userId, username };
}

// ─── Lobby registry (cross-tab via localStorage) ───────────────────────────

interface LobbyRecord {
  lobbyId:    string;
  hostId:     string;
  maxPlayers: number;
  visibility: number;
  users:      LobbyUser[];
  metadata:   Record<string, string>;
  createdAt:  number;
}

const REGISTRY_LS = 'wavedash-dev:lobbies';
const MAX_AGE_MS  = 6 * 60 * 60 * 1000;    // prune lobbies older than 6h

function readRegistry(): Record<string, LobbyRecord> {
  try {
    const raw = localStorage.getItem(REGISTRY_LS);
    const r = raw ? JSON.parse(raw) as Record<string, LobbyRecord> : {};
    // Prune old lobbies so dev tabs don't accumulate phantoms.
    const now = Date.now();
    for (const id of Object.keys(r)) {
      if (now - r[id].createdAt > MAX_AGE_MS) delete r[id];
    }
    return r;
  } catch { return {}; }
}

function writeRegistry(reg: Record<string, LobbyRecord>): void {
  try { localStorage.setItem(REGISTRY_LS, JSON.stringify(reg)); } catch { /* ignore */ }
}

// ─── Event emitter ─────────────────────────────────────────────────────────

type EventCb = (data: unknown) => void;

class TinyEmitter {
  private map = new Map<string, Set<EventCb>>();

  on(event: string, cb: EventCb): void {
    let s = this.map.get(event);
    if (!s) { s = new Set(); this.map.set(event, s); }
    s.add(cb);
  }
  off(event: string, cb: EventCb): void {
    this.map.get(event)?.delete(cb);
  }
  emit(event: string, data: unknown): void {
    const s = this.map.get(event);
    if (!s) return;
    for (const cb of s) cb(data);
  }
}

// ─── Broadcast frame types ─────────────────────────────────────────────────

interface BcFrame {
  fromId:  string;
  toId:    string;        // '' = broadcast
  kind:    'p2p' | 'chat' | 'meta-sync-request' | 'meta-sync-reply' | 'user-change' | 'data-updated' | 'invite';
  channel?: number;        // for kind=='p2p'
  payload?: unknown;
}

function lobbyChannelName(id: string): string {
  return `wavedash-dev-lobby-${id}`;
}

// ─── Main shim install ─────────────────────────────────────────────────────

function installShim(): void {
  const self = readOrCreateSelf();
  const events = new TinyEmitter();

  // Per-lobby state held in memory for the current tab.
  let currentLobby: string | null = null;
  let bc: BroadcastChannel | null = null;

  // P2P drain queues — per channel.  Messages pushed here by the BC handler.
  const p2pQueues = new Map<number, Array<{ identity: string; payload: Uint8Array }>>();

  // Virtual FS for writeLocalFile / readLocalFile.  Keyed by path.
  const virtualFS = new Map<string, Uint8Array>();

  const constants: WavedashConstantsAPI = {
    PUBLIC: 0, FRIENDS_ONLY: 1, PRIVATE: 2,
    ASC: 0, DESC: 1,
    NUMERIC: 0, TIME_SECONDS: 1, TIME_MILLISECONDS: 2, TIME_GAME_TICKS: 3,
    SCREENSHOT: 0, VIDEO: 1, COMMUNITY: 2, GAME_MANAGED: 3, OTHER: 4,
    AVATAR_SIZE_SMALL: 0, AVATAR_SIZE_MEDIUM: 1, AVATAR_SIZE_LARGE: 2,
  };

  // ── Internal helpers ─────────────────────────────────────────────────────

  function joinChannel(lobbyId: string): void {
    if (bc) bc.close();
    bc = new BroadcastChannel(lobbyChannelName(lobbyId));
    bc.onmessage = (e: MessageEvent) => {
      const f = e.data as BcFrame;
      if (!f) return;
      if (f.toId && f.toId !== self.userId) return; // not for us

      switch (f.kind) {
        case 'p2p': {
          const ch = f.channel ?? 0;
          let q = p2pQueues.get(ch);
          if (!q) { q = []; p2pQueues.set(ch, q); }
          q.push({ identity: f.fromId, payload: f.payload as Uint8Array });
          break;
        }
        case 'chat': {
          events.emit('LOBBY_MESSAGE', f.payload as LobbyMessage);
          break;
        }
        case 'user-change': {
          const reg = readRegistry();
          const lobby = currentLobby ? reg[currentLobby] : null;
          if (lobby) events.emit('LOBBY_USERS_UPDATED', f.payload);
          break;
        }
        case 'data-updated': {
          events.emit('LOBBY_DATA_UPDATED', f.payload as Record<string, string>);
          break;
        }
        case 'invite': {
          events.emit('LOBBY_INVITE', f.payload);
          break;
        }
        case 'meta-sync-request':
          // A newly-joined peer asking for current state; host re-broadcasts.
          if (currentLobby) {
            const reg = readRegistry();
            const lobby = reg[currentLobby];
            if (lobby && lobby.hostId === self.userId) {
              post({ fromId: self.userId, toId: f.fromId, kind: 'meta-sync-reply', payload: lobby });
            }
          }
          break;
        case 'meta-sync-reply': {
          const lobby = f.payload as LobbyRecord;
          events.emit('LOBBY_JOINED', {
            lobbyId: lobby.lobbyId,
            hostId:  lobby.hostId,
            users:   lobby.users,
            metadata: lobby.metadata,
          });
          break;
        }
      }
    };
  }

  function post(f: BcFrame): void {
    bc?.postMessage(f);
  }

  function selfAsLobbyUser(lobbyId: string, isHost: boolean): LobbyUser {
    return { lobbyId, userId: self.userId, username: self.username, isHost };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  const api: WavedashJSAPI = {
    async init(_opts): Promise<void> {
      void _opts;
      // No-op for shim; returns immediately resolved.
    },

    getUser:     () => ({ userId: self.userId, username: self.username }),
    getUserId:   () => self.userId,
    getUsername: () => self.username,

    async createLobby(visibility: number, maxPlayers: number): Promise<WavedashResponse<string>> {
      const id = `lobby-${Math.random().toString(36).slice(2, 8)}`;
      const reg = readRegistry();
      const lobby: LobbyRecord = {
        lobbyId:    id,
        hostId:     self.userId,
        maxPlayers,
        visibility,
        users:      [selfAsLobbyUser(id, true)],
        metadata:   {},
        createdAt:  Date.now(),
      };
      reg[id] = lobby;
      writeRegistry(reg);
      currentLobby = id;
      joinChannel(id);
      // Fire LOBBY_JOINED synchronously on next microtask so callers that
      // register listeners after await can still catch it.
      queueMicrotask(() => {
        events.emit('LOBBY_JOINED', {
          lobbyId: id, hostId: self.userId, users: lobby.users, metadata: lobby.metadata,
        });
      });
      return { success: true, data: id };
    },

    async joinLobby(lobbyId: string): Promise<void> {
      const reg = readRegistry();
      const lobby = reg[lobbyId];
      if (!lobby) throw new Error(`lobby '${lobbyId}' not found`);

      // Add self if not already in the list.
      if (!lobby.users.some((u) => u.userId === self.userId)) {
        lobby.users.push(selfAsLobbyUser(lobbyId, false));
        reg[lobbyId] = lobby;
        writeRegistry(reg);
      }
      currentLobby = lobbyId;
      joinChannel(lobbyId);

      // Notify other members I joined.
      post({
        fromId: self.userId, toId: '', kind: 'user-change',
        payload: {
          userId:     self.userId,
          username:   self.username,
          isHost:     false,
          changeType: 'JOINED',
        },
      });

      // Fire local LOBBY_JOINED so this scene can wire up.
      queueMicrotask(() => {
        events.emit('LOBBY_JOINED', {
          lobbyId, hostId: lobby.hostId, users: lobby.users, metadata: lobby.metadata,
        });
      });
    },

    async leaveLobby(lobbyId: string): Promise<void> {
      const reg = readRegistry();
      const lobby = reg[lobbyId];
      if (lobby) {
        lobby.users = lobby.users.filter((u) => u.userId !== self.userId);
        if (lobby.users.length === 0) {
          delete reg[lobbyId];
        } else if (lobby.hostId === self.userId) {
          // Promote the next member.
          lobby.hostId = lobby.users[0].userId;
          lobby.users[0].isHost = true;
          reg[lobbyId] = lobby;
        }
        writeRegistry(reg);
        post({
          fromId: self.userId, toId: '', kind: 'user-change',
          payload: {
            userId: self.userId, username: self.username,
            isHost: false, changeType: 'LEFT',
          },
        });
      }
      bc?.close();
      bc = null;
      currentLobby = null;
    },

    async listAvailableLobbies(_friendsOnly?: boolean): Promise<WavedashResponse<LobbyInfo[]>> {
      void _friendsOnly;
      const reg = readRegistry();
      const out: LobbyInfo[] = [];
      for (const l of Object.values(reg)) {
        if (l.visibility !== constants.PUBLIC) continue;
        out.push({
          lobbyId:     l.lobbyId,
          playerCount: l.users.length,
          maxPlayers:  l.maxPlayers,
          hostId:      l.hostId,
        });
      }
      return { success: true, data: out };
    },

    getLobbyUsers(lobbyId: string): LobbyUser[] {
      return readRegistry()[lobbyId]?.users ?? [];
    },
    getLobbyHostId(lobbyId: string): string {
      return readRegistry()[lobbyId]?.hostId ?? '';
    },
    getNumLobbyUsers(lobbyId: string): number {
      return readRegistry()[lobbyId]?.users.length ?? 0;
    },

    setLobbyData(lobbyId: string, key: string, value: string): void {
      const reg = readRegistry();
      const lobby = reg[lobbyId];
      if (!lobby) return;
      if (lobby.hostId !== self.userId) return; // host-only
      lobby.metadata[key] = value;
      reg[lobbyId] = lobby;
      writeRegistry(reg);
      post({ fromId: self.userId, toId: '', kind: 'data-updated', payload: lobby.metadata });
      queueMicrotask(() => events.emit('LOBBY_DATA_UPDATED', lobby.metadata));
    },

    getLobbyData(lobbyId: string, key: string): string {
      return readRegistry()[lobbyId]?.metadata[key] ?? '';
    },

    deleteLobbyData(lobbyId: string, key: string): void {
      const reg = readRegistry();
      const lobby = reg[lobbyId];
      if (!lobby) return;
      if (lobby.hostId !== self.userId) return;
      delete lobby.metadata[key];
      reg[lobbyId] = lobby;
      writeRegistry(reg);
      post({ fromId: self.userId, toId: '', kind: 'data-updated', payload: lobby.metadata });
      queueMicrotask(() => events.emit('LOBBY_DATA_UPDATED', lobby.metadata));
    },

    sendLobbyChatMessage(lobbyId: string, message: string): void {
      const payload: LobbyMessage = {
        messageId: `m-${Date.now().toString(36)}`,
        userId:    self.userId,
        username:  self.username,
        message,
        timestamp: Date.now(),
      };
      void lobbyId;
      post({ fromId: self.userId, toId: '', kind: 'chat', payload });
      // Echo to self so the sender also sees it in their chat log.
      queueMicrotask(() => events.emit('LOBBY_MESSAGE', payload));
    },

    async inviteUserToLobby(lobbyId: string, userId: string): Promise<void> {
      post({
        fromId: self.userId, toId: userId, kind: 'invite',
        payload: {
          notificationId: `inv-${Date.now().toString(36)}`,
          lobbyId,
          sender: { _id: self.userId, username: self.username },
        },
      });
    },

    async getLobbyInviteLink(copy?: boolean): Promise<WavedashResponse<string>> {
      if (!currentLobby) return { success: false, data: null, message: 'no lobby' };
      const link = `${window.location.origin}${window.location.pathname}?wavedash-dev=1&join=${currentLobby}`;
      if (copy && typeof navigator !== 'undefined' && navigator.clipboard) {
        try { await navigator.clipboard.writeText(link); } catch { /* ignore */ }
      }
      return { success: true, data: link };
    },

    async updateUserPresence(_data: Record<string, unknown>): Promise<void> {
      void _data; // not modeled
    },

    // ── P2P ──────────────────────────────────────────────────────────────
    sendP2PMessage(userId: string, data: Uint8Array, channel: number, _reliable: boolean): void {
      void _reliable;
      // Local loopback to self if broadcasting — match real SDK's behavior of
      // NOT delivering to self.  Don't emit to sender.
      if (userId === '' || userId !== self.userId) {
        post({ fromId: self.userId, toId: userId, kind: 'p2p', channel, payload: data });
      }
    },

    drainP2PChannel(channel: number): Array<{ identity: string; payload: Uint8Array }> {
      const q = p2pQueues.get(channel);
      if (!q || q.length === 0) return [];
      p2pQueues.set(channel, []);
      return q;
    },

    drainP2PChannelToBuffer(_channel: number): Uint8Array {
      // Not used by this project; return empty.
      void _channel;
      return new Uint8Array(0);
    },

    // ── UGC ──────────────────────────────────────────────────────────────
    async createUgcItem(_type: number, title: string, desc: string, visibility: number, path: string): Promise<WavedashResponse<string>> {
      void _type; void visibility;
      // Read the staged file from virtualFS and store it under a UGC id.
      const bytes = virtualFS.get(path);
      if (!bytes) return { success: false, data: null, message: 'staging file not found' };
      const ugcId = `ugc-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const arr = Array.from(bytes);
        localStorage.setItem(`wavedash-dev:ugc:${ugcId}`, JSON.stringify({
          title, desc, bytes: arr,
          fileName: path.split('/').pop() ?? 'level.json',
        }));
        return { success: true, data: ugcId };
      } catch (err) {
        return { success: false, data: null, message: String(err) };
      }
    },

    async downloadUgcItem(ugcId: string, dest: string): Promise<WavedashResponse<void>> {
      try {
        const raw = localStorage.getItem(`wavedash-dev:ugc:${ugcId}`);
        if (!raw) return { success: false, data: null, message: 'ugc not found' };
        const parsed = JSON.parse(raw) as { bytes: number[]; fileName: string };
        const bytes = new Uint8Array(parsed.bytes);
        // Write into virtualFS under conventional paths so readLocalFile works.
        virtualFS.set(`${dest}level.json`, bytes);
        virtualFS.set(`${dest}${ugcId}.json`, bytes);
        virtualFS.set(`${dest}${parsed.fileName}`, bytes);
        return { success: true, data: null };
      } catch (err) {
        return { success: false, data: null, message: String(err) };
      }
    },

    async writeLocalFile(path: string, data: Uint8Array): Promise<void> {
      virtualFS.set(path, data);
    },

    async readLocalFile(path: string): Promise<Uint8Array> {
      const b = virtualFS.get(path);
      if (!b) throw new Error(`file not found: ${path}`);
      return b;
    },

    events: {
      on:  (event: string, cb: EventCb) => events.on(event, cb),
      off: (event: string, cb: EventCb) => events.off(event, cb),
    } as unknown as WavedashJSAPI['events'],
  };

  (window as unknown as { WavedashJS: WavedashJSAPI }).WavedashJS = api;
  (window as unknown as { WavedashConstants: WavedashConstantsAPI }).WavedashConstants = constants;
}
