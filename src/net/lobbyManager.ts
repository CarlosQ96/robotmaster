/**
 * lobbyManager.ts — Thin event-hub wrapper around WavedashJS lobby APIs.
 *
 * Responsibilities:
 *   - Expose ergonomic async methods for create / join / list / leave.
 *   - Cache current lobby state (id, users, metadata, host).
 *   - Re-emit Wavedash events on a local EventEmitter with typed payloads
 *     so scenes can subscribe without touching the raw SDK.
 *   - Gracefully no-op when the SDK is absent (solo dev).
 *
 * Lifecycle assumption: only ONE lobby at a time per game instance.
 */
import * as Phaser from 'phaser';
import { WavedashBridge } from './WavedashBridge';
import type { LobbyUser, LobbyInfo, LobbyMessage } from './wavedash.d';

export type LobbyVisibility = 'public' | 'friends' | 'private';

export interface LobbyUsersUpdatedEvent {
  userId:     string;
  username:   string;
  isHost:     boolean;
  changeType: 'JOINED' | 'LEFT';
}

export interface ChatMessageEvent extends LobbyMessage {}

export interface LobbyKickedEvent {
  lobbyId: string;
  reason:  'KICKED' | 'ERROR';
}

/** Map visibility string → numeric SDK enum.  Defaults to PUBLIC. */
function visibilityCode(v: LobbyVisibility): number {
  const c = WavedashBridge.getConstants();
  if (!c) return 0; // PUBLIC fallback
  if (v === 'friends') return c.FRIENDS_ONLY;
  if (v === 'private') return c.PRIVATE;
  return c.PUBLIC;
}

class LobbyManagerImpl {
  readonly events = new Phaser.Events.EventEmitter();

  private _lobbyId: string | null         = null;
  private _users:   Map<string, LobbyUser> = new Map();
  private _hostId:  string                = '';
  private _metadata: Record<string, string> = {};
  private _wired = false;

  get lobbyId(): string | null { return this._lobbyId; }
  get hostId():  string        { return this._hostId;  }
  get metadata(): Record<string, string> { return { ...this._metadata }; }
  get users():   LobbyUser[]   { return Array.from(this._users.values()); }
  get inLobby(): boolean       { return this._lobbyId !== null; }

  isHost(): boolean {
    const api = WavedashBridge.getApi();
    if (!api) return false;
    return this._hostId === api.getUserId();
  }

  /** Attach SDK listeners exactly once.  Safe to call multiple times. */
  private wire(): void {
    const api = WavedashBridge.getApi();
    if (!api || this._wired) return;
    this._wired = true;

    api.events.on('LOBBY_JOINED', (d) => {
      this._lobbyId = d.lobbyId;
      this._hostId  = d.hostId;
      this._metadata = { ...d.metadata };
      this._users.clear();
      for (const u of d.users) this._users.set(u.userId, u);
      this.events.emit('joined', { lobbyId: d.lobbyId, hostId: d.hostId });
      this.events.emit('users', this.users);
      this.events.emit('metadata', this.metadata);
    });

    api.events.on('LOBBY_USERS_UPDATED', (d: LobbyUsersUpdatedEvent) => {
      if (d.changeType === 'JOINED') {
        this._users.set(d.userId, {
          lobbyId: this._lobbyId ?? '',
          userId:  d.userId,
          username: d.username,
          isHost:  d.isHost,
        });
      } else {
        this._users.delete(d.userId);
      }
      this.events.emit('users', this.users);
      this.events.emit('user-change', d);
    });

    api.events.on('LOBBY_MESSAGE', (d: LobbyMessage) => {
      this.events.emit('chat', d as ChatMessageEvent);
    });

    api.events.on('LOBBY_DATA_UPDATED', (d: Record<string, string>) => {
      this._metadata = { ...d };
      this.events.emit('metadata', this.metadata);
    });

    api.events.on('LOBBY_KICKED', (d: LobbyKickedEvent) => {
      this.reset();
      this.events.emit('kicked', d);
    });

    api.events.on('LOBBY_INVITE', (d) => {
      this.events.emit('invite', d);
    });

    // P2P lifecycle — scenes can subscribe to know when networking is ready.
    api.events.on('P2P_CONNECTION_ESTABLISHED', (d) => this.events.emit('peer-connected',    d));
    api.events.on('P2P_CONNECTION_FAILED',      (d) => this.events.emit('peer-failed',       d));
    api.events.on('P2P_PEER_DISCONNECTED',      (d) => this.events.emit('peer-disconnected', d));
  }

  private reset(): void {
    this._lobbyId  = null;
    this._hostId   = '';
    this._users.clear();
    this._metadata = {};
  }

  // ── Async API ────────────────────────────────────────────────────────────

  /** Create a new lobby.  Resolves to the lobby id (or null on failure / no SDK). */
  async quickHost(visibility: LobbyVisibility = 'public', maxPlayers = 4): Promise<string | null> {
    const api = WavedashBridge.getApi();
    if (!api) return null;
    this.wire();
    const res = await api.createLobby(visibilityCode(visibility), maxPlayers);
    if (!res.success || !res.data) return null;
    // The SDK fires LOBBY_JOINED on the creator too; our listener populates state.
    return res.data;
  }

  /** Join an existing lobby by id.  Returns true on success. */
  async joinById(id: string): Promise<boolean> {
    const api = WavedashBridge.getApi();
    if (!api) return false;
    this.wire();
    try {
      await api.joinLobby(id);
      return true;
    } catch (err) {
      console.warn('[Lobby] join failed:', err);
      return false;
    }
  }

  /** List public lobbies currently advertising availability. */
  async listPublic(): Promise<LobbyInfo[]> {
    const api = WavedashBridge.getApi();
    if (!api) return [];
    this.wire();
    const res = await api.listAvailableLobbies(false);
    return res.success && res.data ? res.data : [];
  }

  /** Leave the current lobby, if any. */
  async leave(): Promise<void> {
    const api = WavedashBridge.getApi();
    if (!api || !this._lobbyId) return;
    try {
      await api.leaveLobby(this._lobbyId);
    } finally {
      this.reset();
      this.events.emit('left');
    }
  }

  // ── Host-only metadata ───────────────────────────────────────────────────
  setMetadata(key: string, value: string): void {
    const api = WavedashBridge.getApi();
    if (!api || !this._lobbyId || !this.isHost()) return;
    api.setLobbyData(this._lobbyId, key, value);
    this._metadata[key] = value; // optimistic local echo
    this.events.emit('metadata', this.metadata);
  }

  getMetadata(key: string): string {
    return this._metadata[key] ?? '';
  }

  // ── Chat + invites ───────────────────────────────────────────────────────
  sendChat(message: string): void {
    const api = WavedashBridge.getApi();
    if (!api || !this._lobbyId) return;
    const trimmed = message.trim().slice(0, 500);
    if (!trimmed) return;
    api.sendLobbyChatMessage(this._lobbyId, trimmed);
  }

  async getInviteLink(copy = true): Promise<string | null> {
    const api = WavedashBridge.getApi();
    if (!api || !this._lobbyId) return null;
    const res = await api.getLobbyInviteLink(copy);
    return res.success && res.data ? res.data : null;
  }

  async inviteUser(userId: string): Promise<void> {
    const api = WavedashBridge.getApi();
    if (!api || !this._lobbyId) return;
    await api.inviteUserToLobby(this._lobbyId, userId);
  }
}

/** Process-wide singleton.  Scenes import this directly. */
export const LobbyManager = new LobbyManagerImpl();
