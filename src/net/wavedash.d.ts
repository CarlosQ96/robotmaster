/**
 * wavedash.d.ts — Ambient type declarations for the WavedashJS SDK.
 *
 * Wavedash is injected at runtime by the platform when the game runs on
 * wavedash.com.  In local dev (vite dev) it may be absent entirely —
 * WavedashBridge.ts probes for this and gates multiplayer features.
 *
 * We only model the subset of the API we actually use from the bridge;
 * return types use `unknown` where the shape is implementation-detail.
 */

export interface WavedashResponse<T> {
  success: boolean;
  data:    T | null;
  message?: string;
}

export interface WavedashUser {
  userId:     string;
  username:   string;
  avatarUrl?: string;
}

export interface LobbyUser {
  lobbyId:        string;
  userId:         string;
  username:       string;
  userAvatarUrl?: string;
  isHost:         boolean;
}

export interface LobbyInfo {
  lobbyId:     string;
  playerCount: number;
  maxPlayers:  number;
  hostId?:     string;
}

export interface LobbyMessage {
  messageId: string;
  userId:    string;
  username:  string;
  message:   string;
  timestamp: number;
}

export interface P2PMessage {
  fromUserId: string;
  channel:    number;
  payload:    Uint8Array;
}

/** A minimal event-emitter shape covering the handful of signals we listen for. */
export interface WavedashEvents {
  on(event: 'LOBBY_JOINED',        cb: (data: { lobbyId: string; hostId: string; users: LobbyUser[]; metadata: Record<string, string> }) => void): void;
  on(event: 'LOBBY_USERS_UPDATED', cb: (data: { userId: string; username: string; isHost: boolean; changeType: 'JOINED' | 'LEFT' }) => void): void;
  on(event: 'LOBBY_MESSAGE',       cb: (data: LobbyMessage) => void): void;
  on(event: 'LOBBY_DATA_UPDATED',  cb: (data: Record<string, string>) => void): void;
  on(event: 'LOBBY_KICKED',        cb: (data: { lobbyId: string; reason: 'KICKED' | 'ERROR' }) => void): void;
  on(event: 'LOBBY_INVITE',        cb: (data: { notificationId: string; lobbyId: string; sender: { _id: string; username: string; avatarUrl?: string } }) => void): void;
  on(event: 'P2P_CONNECTION_ESTABLISHED', cb: (data: { userId: string; username: string }) => void): void;
  on(event: 'P2P_CONNECTION_FAILED',      cb: (data: { userId: string; username: string; error: string }) => void): void;
  on(event: 'P2P_PEER_DISCONNECTED',      cb: (data: { userId: string; username: string }) => void): void;
  on(event: 'BACKEND_CONNECTED',    cb: (data: { isConnected: boolean }) => void): void;
  on(event: 'BACKEND_DISCONNECTED', cb: (data: { isConnected: boolean }) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
}

/** Subset of the WavedashJS runtime API the bridge uses. */
export interface WavedashJSAPI {
  init(opts: {
    debug?: boolean;
    deferEvents?: boolean;
    p2p?: {
      maxPeers?:               number;
      enableReliableChannel?:  boolean;
      enableUnreliableChannel?: boolean;
      /** Max bytes per P2P message.  Default 2048, max 65536.  Raise for JSON snapshots. */
      messageSize?:            number;
      maxIncomingMessages?:    number;
    };
  }): Promise<void>;

  // Identity
  getUser():     WavedashUser;
  getUserId():   string;
  getUsername(): string;

  // Lobbies
  createLobby(visibility: number, maxPlayers: number): Promise<WavedashResponse<string>>;
  joinLobby(lobbyId: string): Promise<void>;
  leaveLobby(lobbyId: string): Promise<void>;
  listAvailableLobbies(friendsOnly?: boolean): Promise<WavedashResponse<LobbyInfo[]>>;
  getLobbyUsers(lobbyId: string): LobbyUser[];
  getLobbyHostId(lobbyId: string): string;
  getNumLobbyUsers(lobbyId: string): number;
  setLobbyData(lobbyId: string, key: string, value: string): void;
  getLobbyData(lobbyId: string, key: string): string;
  deleteLobbyData(lobbyId: string, key: string): void;
  sendLobbyChatMessage(lobbyId: string, message: string): void;
  inviteUserToLobby(lobbyId: string, userId: string): Promise<void>;
  getLobbyInviteLink(copy?: boolean): Promise<WavedashResponse<string>>;
  updateUserPresence(data: Record<string, unknown>): Promise<void>;

  // P2P
  sendP2PMessage(userId: string, data: Uint8Array, channel: number, reliable: boolean): void;
  drainP2PChannel(channel: number): Array<{ identity: string; payload: Uint8Array }>;
  drainP2PChannelToBuffer(channel: number): Uint8Array;

  // UGC
  createUgcItem(
    type:       number,
    title:      string,
    desc:       string,
    visibility: number,
    path:       string,
  ): Promise<WavedashResponse<string>>;
  downloadUgcItem(ugcId: string, dest: string): Promise<WavedashResponse<void>>;

  // Cloud files (we use these for UGC staging since we need a local path to
  // hand to createUgcItem on web).
  writeLocalFile(path: string, data: Uint8Array): Promise<void>;
  readLocalFile(path: string): Promise<Uint8Array>;

  // Events
  events: WavedashEvents;
}

/** Constants namespace mirrored from the Godot bindings for parity. */
export interface WavedashConstantsAPI {
  // Lobby visibility
  PUBLIC:        0;
  FRIENDS_ONLY:  1;
  PRIVATE:       2;
  // Sort directions
  ASC:  0;
  DESC: 1;
  // Leaderboard display
  NUMERIC:           0;
  TIME_SECONDS:      1;
  TIME_MILLISECONDS: 2;
  TIME_GAME_TICKS:   3;
  // UGC types
  SCREENSHOT:   0;
  VIDEO:        1;
  COMMUNITY:    2;
  GAME_MANAGED: 3;
  OTHER:        4;
  // Avatar sizes
  AVATAR_SIZE_SMALL:  0;
  AVATAR_SIZE_MEDIUM: 1;
  AVATAR_SIZE_LARGE:  2;
}

declare global {
  interface Window {
    WavedashJS?:        WavedashJSAPI;
    WavedashConstants?: WavedashConstantsAPI;
  }
}

export {};
