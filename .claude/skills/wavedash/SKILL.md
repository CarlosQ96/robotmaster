---
name: wavedash
description: >-
  Expert knowledge of the Wavedash JavaScript SDK (`WavedashJS`) for
  browser-based games. Covers init + launch params, player identity, friends,
  avatars, presence, leaderboards, cloud saves, lobbies, P2P networking,
  achievements & stats, UGC, events, the `wavedash` CLI, `wavedash.toml`, and
  the publishing flow.

  Trigger on: "wavedash", "WavedashJS", "leaderboard", "cloud save", lobby /
  P2P / networking questions in a Wavedash game, achievements/stats, UGC
  upload/download, `wavedash dev`, `wavedash build push`, `wavedash.toml`,
  publishing to the Wavedash store.
---

You are an expert on the **Wavedash JavaScript SDK** — a browser-based game
platform SDK that provides backend services (multiplayer, leaderboards, cloud
saves, achievements, UGC, player identity) injected automatically at runtime.

**Scope**: this skill covers JavaScript / TypeScript usage only. Godot and
Unity bindings exist but are out of scope here.

**Canonical docs root**: https://docs.wavedash.com/ — every fact in this skill
includes a `(src: <url>)` citation. When the docs contradict themselves, this
skill prefers the `/sdk/functions` page as the canonical function reference
and flags the conflict in the "Known inconsistencies" section.

---

## 1. Platform & injection

- Wavedash runs games in the browser. The platform injects a global
  `window.WavedashJS` before the game script starts — no npm install
  (src: https://docs.wavedash.com/engines/javascript).
- `window.WavedashJS` is a **Promise** that resolves to the SDK object
  (src: https://docs.wavedash.com/engines/javascript). Standard entry:

```js
const WavedashJS = await window.WavedashJS;
```

- In TypeScript, declare the global ambiently
  (src: https://docs.wavedash.com/engines/typescript):

```ts
declare global {
  interface Window {
    WavedashJS: Promise<WavedashSDK>;
  }
}
```

- `init()` must be awaited before any other call — "subsequent calls silently
  fail otherwise" (src: https://docs.wavedash.com/sdk/setup).
- Local sandbox: `wavedash dev` serves `upload_dir` at `https://localhost:7777`
  with the SDK injected. First run installs a self-signed cert
  (src: https://docs.wavedash.com/cli/commands).

### HTML shell

Some engine integrations require a specific container id. Three.js example
renders into `#wavedash-target`
(src: https://docs.wavedash.com/engines/threejs):

```js
const target = document.getElementById('wavedash-target');
const canvas = document.createElement('canvas');
canvas.style.width = '100%';
canvas.style.height = '100%';
target.appendChild(canvas);
```

---

## 2. Initialization

```ts
init(config: WavedashConfig): Promise<void>
```
(src: https://docs.wavedash.com/sdk/functions)

Minimal usage (src: https://docs.wavedash.com/engines/threejs):

```js
await WavedashJS.init({ debug: true });
```

`WavedashConfig` fields (src: https://docs.wavedash.com/sdk/types):

| Field | Type | Purpose |
|---|---|---|
| `debug` | `boolean` | Verbose console logging |
| `deferEvents` | `boolean` | Queue lobby/multiplayer events until `readyForEvents()` is called |
| `remoteStorageOrigin` | `string` | Override cloud file storage origin |
| `p2p` | `Partial<P2PConfig>` | P2P networking config |

`P2PConfig` fields (src: https://docs.wavedash.com/sdk/types):

| Field | Type | Default | Purpose |
|---|---|---|---|
| `maxPeers` | `number` | 8 | Concurrent peer limit |
| `enableReliableChannel` | `boolean` | true | TCP-style ordered delivery |
| `enableUnreliableChannel` | `boolean` | true | UDP-style best-effort |
| `messageSize` | `number` | 2048 | Max bytes per message (max 65536) |
| `maxIncomingMessages` | `number` | 1024 | Inbound queue capacity |

### Load progress & completion (browser host expects these)

- `WavedashJS.updateLoadProgressZeroToOne(progress: number): void` — call
  during async loading with 0..1 values
  (src: https://docs.wavedash.com/engines/javascript).
- `WavedashJS.loadComplete(): void` — call when gameplay becomes interactive
  (src: https://docs.wavedash.com/engines/threejs).

### Event deferral

If you need listeners set up before any events fire, pass `deferEvents: true`
to `init()`, wire your `addEventListener` calls, then flush the queue
(src: https://docs.wavedash.com/sdk/events):

```js
await WavedashJS.init({ deferEvents: true });
// ...register listeners...
WavedashJS.readyForEvents();   // flush
```

---

## 3. Launch params & URL conventions

```ts
getLaunchParams(): GameLaunchParams
```
(src: https://docs.wavedash.com/sdk/functions)

```ts
interface GameLaunchParams {
  lobby?: string;                     // from wvdsh_lobby
  [key: string]: string | undefined;  // any other wvdsh_-prefixed param
}
```
(src: https://docs.wavedash.com/sdk/types)

- **Only URL query parameters prefixed with `wvdsh_` are forwarded** to the
  game (src: https://docs.wavedash.com/sdk/setup). The prefix is stripped,
  so `wvdsh_lobby` → `params.lobby`.
- The only explicitly documented `wvdsh_*` key is `wvdsh_lobby` (lobby ID
  from an invite link) (src: https://docs.wavedash.com/multiplayer/lobbies).
  Other custom keys pass through via the index signature.

Deep-link join flow (src: https://docs.wavedash.com/multiplayer/lobbies):

```js
const params = WavedashJS.getLaunchParams();
if (params.lobby) {
  await WavedashJS.joinLobby(params.lobby);
}
```

---

## 4. Player identity

```ts
getUser(): User           // full profile
getUserId(): string       // stable ID
getUsername(): string     // display name
```
(src: https://docs.wavedash.com/sdk/functions, https://docs.wavedash.com/sdk/players)

> The `User` interface shape is **not published** on `/sdk/types` — treat it as
> opaque except for ID + username fields you can get via the dedicated helpers
> (src: https://docs.wavedash.com/sdk/types).

### Friends

```ts
listFriends(): Promise<WavedashResponse<Friend[]>>
```

```ts
interface Friend {
  userId: string;
  username: string;
  avatarUrl?: string;
  isOnline: boolean;
}
```
(src: https://docs.wavedash.com/sdk/types)

### Avatars

```ts
getUserAvatarUrl(userId: string, size: 0 | 1 | 2): string | null
```

- Returns null until the user is cached (e.g. after `listFriends()` or joining
  a lobby with that user) (src: https://docs.wavedash.com/sdk/players).
- Sizes: `0 = SMALL`, `1 = MEDIUM`, `2 = LARGE`
  (src: https://docs.wavedash.com/sdk/players). Exact pixel dimensions per
  size are not published in the reachable docs.

### Presence (JS-only)

```ts
updateUserPresence(data: Record<string, unknown>): Promise<void>
```
(src: https://docs.wavedash.com/sdk/functions)

Documented keys: `status`, `details`, `lobbyId`, `canJoin` — schema is not
enforced; pass `{}` to clear (src: https://docs.wavedash.com/sdk/presence):

```js
await WavedashJS.updateUserPresence({
  status:  'In Lobby',
  details: 'Arena — waiting',
  lobbyId,
  canJoin: players.length < maxPlayers,
});

await WavedashJS.updateUserPresence({}); // clear
```

---

## 5. Leaderboards

```ts
getOrCreateLeaderboard(
  id: string,
  sortOrder: 0 | 1,
  displayType: 0 | 1 | 2 | 3,
): Promise<WavedashResponse<Leaderboard>>

uploadLeaderboardScore(
  leaderboardId: string,
  score: number,
  keepBest: boolean,
  ugcId?: string,
): Promise<WavedashResponse<{ globalRank: number }>>

listLeaderboardEntries(
  leaderboardId: string,
  start: number,
  count: number,
  friendsOnly?: boolean,
): Promise<WavedashResponse<LeaderboardEntry[]>>

listLeaderboardEntriesAroundUser(
  leaderboardId: string,
  countAhead: number,
  countBehind: number,
  friendsOnly?: boolean,
): Promise<WavedashResponse<LeaderboardEntry[]>>

getMyLeaderboardEntries(
  leaderboardId: string,
): Promise<WavedashResponse<LeaderboardEntry[]>>

// Synchronous. Returns -1 until the leaderboard has been queried once.
getLeaderboardEntryCount(leaderboardId: string): number
```
(src: https://docs.wavedash.com/sdk/functions, https://docs.wavedash.com/sdk/leaderboards)

Types (src: https://docs.wavedash.com/sdk/types):

```ts
interface Leaderboard {
  id: string;
  name: string;
  sortOrder: 0 | 1;
  displayType: 0 | 1 | 2 | 3;
  totalEntries: number;
}
interface LeaderboardEntry {
  userId: string;
  username?: string;
  score: number;
  globalRank: number;
  ugcId?: string;
  timestamp: number;
  metadata?: Uint8Array;
}
```

Enums (src: https://docs.wavedash.com/sdk/leaderboards):

| `sortOrder` | | `displayType` | |
|---|---|---|---|
| 0 | ASC (lower is better) | 0 | NUMERIC |
| 1 | DESC (higher is better) | 1 | TIME_SECONDS |
| | | 2 | TIME_MILLISECONDS |
| | | 3 | TIME_GAME_TICKS |

**Attach a replay to a score** via `ugcId` (see UGC section):

```js
const ugc = await WavedashJS.createUGCItem(3, 'Run', '', 0, 'replays/run.dat');
if (ugc.success) {
  await WavedashJS.uploadLeaderboardScore(
    'speedrun_board', timeMs, true, ugc.data,
  );
}
```
(src: https://docs.wavedash.com/sdk/ugc)

---

## 6. Cloud saves / virtual FS

```ts
writeLocalFile(path: string, data: Uint8Array): Promise<void>
readLocalFile(path: string): Promise<Uint8Array>
uploadRemoteFile(path: string): Promise<WavedashResponse<void>>
downloadRemoteFile(path: string): Promise<WavedashResponse<void>>
downloadRemoteDirectory(path: string): Promise<void>
listRemoteDirectory(path: string): Promise<WavedashResponse<RemoteFileMetadata[]>>
```
(src: https://docs.wavedash.com/sdk/functions)

```ts
interface RemoteFileMetadata {
  exists: boolean;
  key: string;
  name: string;
  lastModified: number;
  size: number;
  etag: string;
}
```
(src: https://docs.wavedash.com/sdk/cloud-saves)

Conventions (src: https://docs.wavedash.com/sdk/cloud-saves):

- **Forward slashes only** in remote keys, even on Windows builds.
- Keys are player-relative (e.g. `saves/slot1.json`, `settings.json`).
- Flow: write locally → `uploadRemoteFile(...)` → on another session,
  `downloadRemoteFile(...)` → `readLocalFile(...)`.

---

## 7. Lobbies

```ts
createLobby(visibility: 0 | 1 | 2, maxPlayers: number): Promise<WavedashResponse<string>>
joinLobby(lobbyId: string): Promise<void>
leaveLobby(lobbyId: string): Promise<void>
listAvailableLobbies(friendsOnly?: boolean): Promise<WavedashResponse<Lobby[]>>

// Synchronous
getLobbyUsers(lobbyId: string): LobbyUser[]
getLobbyHostId(lobbyId: string): string
getNumLobbyUsers(lobbyId: string): number
getLobbyData(lobbyId: string, key: string): string

// Host only
setLobbyData(lobbyId: string, key: string, value: string): void
deleteLobbyData(lobbyId: string, key: string): void

sendLobbyMessage(lobbyId: string, message: string): void  // max 500 chars
inviteUserToLobby(lobbyId: string, userId: string): Promise<void>
getLobbyInviteLink(copyToClipboard?: boolean): Promise<WavedashResponse<string>>
```
(src: https://docs.wavedash.com/sdk/functions, https://docs.wavedash.com/multiplayer/lobbies)

> **Name inconsistency**: `/multiplayer/lobbies` shows usage as
> `WavedashJS.sendLobbyChatMessage(...)`, while the canonical function
> reference `/sdk/functions` lists `sendLobbyMessage`. Prefer
> `sendLobbyMessage` (the reference) and fall back to `sendLobbyChatMessage`
> if the SDK runtime rejects it. (src: https://docs.wavedash.com/sdk/functions,
> https://docs.wavedash.com/multiplayer/lobbies)

Visibility enum (src: https://docs.wavedash.com/multiplayer/lobbies):

| Value | Meaning |
|---|---|
| 0 | `PUBLIC` — anyone can find and join |
| 1 | `FRIENDS_ONLY` — only friends can see and join |
| 2 | `PRIVATE` — joinable only by lobby ID |

Types (src: https://docs.wavedash.com/sdk/types):

```ts
interface Lobby {
  lobbyId: string;
  visibility: 0 | 1 | 2;
  maxPlayers: number;
  playerCount: number;
  metadata: Record<string, unknown>;
}
interface LobbyUser {
  lobbyId: string;
  userId: string;
  username: string;
  userAvatarUrl?: string;
  isHost: boolean;
}
interface LobbyMessage {
  messageId: string;
  lobbyId: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}
interface LobbyInvite {
  notificationId: string;
  lobbyId: string;
  sender: { _id: string; username: string; avatarUrl?: string };
  _creationTime: number;
}
```

---

## 8. P2P networking

WebRTC data channels, TURN-backed NAT traversal, auto-established between
lobby members (src: https://docs.wavedash.com/multiplayer/networking).

```ts
broadcastP2PMessage(channel: number, reliable: boolean, payload: Uint8Array): void
sendP2PMessage(userId: string, channel: number, reliable: boolean, payload: Uint8Array): void
readP2PMessageFromChannel(channel: number): P2PMessage | null
drainP2PChannelToBuffer(channel: number): Uint8Array
```
(src: https://docs.wavedash.com/sdk/functions)

Types (src: https://docs.wavedash.com/sdk/types):

```ts
interface P2PMessage { fromUserId: string; channel: number; payload: Uint8Array; }
interface P2PPeer    { userId: string; username: string; }
interface P2PConnection {
  lobbyId: string;
  peers: Record<string, P2PPeer>;
  state: 'connecting' | 'connected' | 'disconnected' | 'failed';
}
```

Channel conventions (src: https://docs.wavedash.com/multiplayer/networking):

| Channel | Suggested use |
|---|---|
| 0 | Game state updates |
| 1 | Player input |
| 2 | Chat messages |
| 3 | Voice data |
| 4–7 | Custom |

Reliable vs unreliable (src: https://docs.wavedash.com/multiplayer/networking):

- **Reliable** = guaranteed ordered — events, chat, critical state transitions.
- **Unreliable** = best-effort lower-latency — positions, inputs, frequent updates.

### High-performance drain (binary packed buffer)

`drainP2PChannelToBuffer(channel)` returns a tightly packed `Uint8Array` where
each message is preceded by a 4-byte little-endian uint32 length
(src: https://docs.wavedash.com/multiplayer/networking):

```js
const packed = WavedashJS.drainP2PChannelToBuffer(0);
const view   = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
let offset   = 0;
while (offset < packed.byteLength) {
  const size    = view.getUint32(offset, true);
  offset       += 4;
  const message = packed.subarray(offset, offset + size);
  offset       += size;
  handleMessage(message);
}
```

---

## 9. Achievements & stats

Stats are registered in the Developer Portal under "In-Game Stats"
(id + display name). Achievements are registered under "Achievements" with
optional trigger rules (e.g. "unlock when stat X hits N")
(src: https://docs.wavedash.com/sdk/achievements).

```ts
requestStats(): Promise<WavedashResponse<void>>
getStat(statId: string): number
setStat(statId: string, value: number, storeNow?: boolean): void
getAchievement(achievementId: string): boolean
setAchievement(achievementId: string, storeNow?: boolean): void
storeStats(): void      // flush immediately
```
(src: https://docs.wavedash.com/sdk/functions)

Debounce behaviour: `storeNow: true` schedules a persist debounced over 1s;
`storeStats()` forces an immediate flush
(src: https://docs.wavedash.com/sdk/achievements):

```js
await WavedashJS.requestStats();
const kills = WavedashJS.getStat('total_kills');
WavedashJS.setStat('total_kills', kills + 1, true);
WavedashJS.setAchievement('first_blood');
WavedashJS.storeStats();
```

Achievements with a **trigger rule unlock automatically** when the linked stat
hits its threshold — no manual `setAchievement` call needed
(src: https://docs.wavedash.com/sdk/achievements).

---

## 10. User-Generated Content (UGC)

```ts
createUGCItem(
  type: 0 | 1 | 2 | 3 | 4,
  title: string,
  description: string,
  visibility: 0 | 1 | 2,
  localPath: string,
): Promise<WavedashResponse<string>>    // returns ugcId

updateUGCItem(
  ugcId: string,
  title: string,
  description: string,
  visibility: 0 | 1 | 2,
  filePath: string | null,              // null = keep existing file
): Promise<void>

downloadUGCItem(ugcId: string, localPath: string): Promise<WavedashResponse<void>>
```
(src: https://docs.wavedash.com/sdk/functions, https://docs.wavedash.com/sdk/ugc)

UGC type enum (src: https://docs.wavedash.com/sdk/ugc):

| Value | Constant | Use |
|---|---|---|
| 0 | `SCREENSHOT` | Still images |
| 1 | `VIDEO` | Clips, recordings |
| 2 | `COMMUNITY` | Levels, mods, maps |
| 3 | `GAME_MANAGED` | Replays, auto-saves |
| 4 | `OTHER` | Misc |

Visibility enum (src: https://docs.wavedash.com/sdk/ugc):

| Value | Access |
|---|---|
| 0 | `PUBLIC` — all users |
| 1 | `FRIENDS_ONLY` — creator's friends |
| 2 | `PRIVATE` — creator only |

---

## 11. Events

JS subscription — `addEventListener` is documented as part of the function
reference (src: https://docs.wavedash.com/sdk/functions):

```ts
WavedashJS.addEventListener(eventName: string, handler: (e: CustomEvent) => void): void
```

Event-name string constants live on `WavedashJS.Events`; the payload lands on
`e.detail` (src: https://docs.wavedash.com/sdk/events).

> The `/sdk/events` page currently does not show an explicit JS
> `addEventListener` code sample — only Godot-signal patterns — so the exact
> object on which to call `addEventListener` isn't verified by a JS example
> on that page. Prefer `WavedashJS.addEventListener(...)` per the function
> reference. (src: https://docs.wavedash.com/sdk/events,
> https://docs.wavedash.com/sdk/functions)

### Full event table

All `(src: https://docs.wavedash.com/sdk/events)`:

| Event | `e.detail` fields |
|---|---|
| `LobbyJoined` | `lobbyId, hostId, users, metadata` |
| `LobbyUsersUpdated` | `lobbyId, userId, username, userAvatarUrl, isHost, changeType` |
| `LobbyMessage` | `messageId, lobbyId, userId, username, message, timestamp` |
| `LobbyDataUpdated` | full metadata object |
| `LobbyKicked` | `lobbyId, reason` |
| `LobbyInvite` | `notificationId, lobbyId, sender, _creationTime` |
| `P2PConnectionEstablished` | `userId, username` |
| `P2PConnectionFailed` | `userId, username, error` |
| `P2PPeerDisconnected` | `userId, username` |
| `StatsStored` | `success, message` |
| `BackendConnected` | `isConnected, hasEverConnected, connectionCount, connectionRetries` |
| `BackendDisconnected` | same shape as `BackendConnected` |
| `BackendReconnecting` | same shape as `BackendConnected` |

---

## 12. Error handling (`WavedashResponse<T>`)

All async SDK calls resolve (do not reject) with this envelope
(src: https://docs.wavedash.com/sdk/types):

```ts
interface WavedashResponse<T> {
  success: boolean;
  data: T | null;
  message?: string;   // error description when success === false
}
```

```js
const res = await WavedashJS.listLeaderboardEntries('weekly', 0, 10);
if (!res.success) {
  console.error('Wavedash:', res.message);
  return;
}
renderEntries(res.data!);
```

---

## 13. Full JS function reference (canonical)

All (src: https://docs.wavedash.com/sdk/functions):

| Category | Function | Notes |
|---|---|---|
| Setup | `init(config)` | Await first |
| Setup | `readyForEvents()` | Flushes deferred event queue |
| Setup | `getLaunchParams()` | Returns `GameLaunchParams` |
| Setup | `updateLoadProgressZeroToOne(p)` | Loader hook |
| Setup | `loadComplete()` | Interactive-ready signal |
| Events | `addEventListener(name, handler)` | See event list |
| Players | `getUser()`, `getUserId()`, `getUsername()` | Sync |
| Players | `listFriends()` | Async |
| Players | `getUserAvatarUrl(userId, size)` | Sync, may return null |
| Players | `updateUserPresence(data)` | JS only |
| Stats | `requestStats()`, `getStat(id)`, `setStat(id, v, storeNow?)` | |
| Stats | `getAchievement(id)`, `setAchievement(id, storeNow?)`, `storeStats()` | |
| Leaderboards | `getOrCreateLeaderboard`, `uploadLeaderboardScore` | |
| Leaderboards | `listLeaderboardEntries`, `listLeaderboardEntriesAroundUser`, `getMyLeaderboardEntries` | |
| Leaderboards | `getLeaderboardEntryCount` | Sync, -1 until queried |
| Lobbies | `createLobby`, `joinLobby`, `leaveLobby`, `listAvailableLobbies` | |
| Lobbies | `getLobbyUsers`, `getLobbyHostId`, `getNumLobbyUsers` | Sync |
| Lobbies | `setLobbyData`, `getLobbyData`, `deleteLobbyData` | Host only for set/delete |
| Lobbies | `sendLobbyMessage`, `inviteUserToLobby`, `getLobbyInviteLink` | |
| P2P | `broadcastP2PMessage(channel, reliable, payload)` | |
| P2P | `sendP2PMessage(userId, channel, reliable, payload)` | |
| P2P | `readP2PMessageFromChannel(channel)` | Sync |
| P2P | `drainP2PChannelToBuffer(channel)` | Packed `Uint8Array` |
| Saves | `writeLocalFile`, `readLocalFile` | Virtual FS |
| Saves | `uploadRemoteFile`, `downloadRemoteFile`, `downloadRemoteDirectory`, `listRemoteDirectory` | |
| UGC | `createUGCItem`, `updateUGCItem`, `downloadUGCItem` | |

---

## 14. CLI

### Install (src: https://docs.wavedash.com/cli/installation)

```bash
curl -fsSL https://wavedash.com/cli/install.sh | bash
wavedash --version
wavedash update     # upgrade in-place
```

Supported on macOS, Linux, and Windows.

### Auth (src: https://docs.wavedash.com/cli/authentication)

```bash
wavedash auth login                 # OAuth browser flow
wavedash auth login --token API_KEY # headless / CI
wavedash auth status
wavedash auth logout                # does NOT unset env vars
```

- **`WAVEDASH_TOKEN` env var takes priority** over the credentials file.
- Credentials file lives in the user's home directory; exact path not
  documented.

### Commands (src: https://docs.wavedash.com/cli/commands)

| Command | Purpose |
|---|---|
| `wavedash init` | Scaffold `wavedash.toml` interactively |
| `wavedash team create --name <NAME>` | Create a team, prints team ID |
| `wavedash project create --title <T> --team-id <ID>` | Create a project |
| `wavedash dev` | Local HTTPS server at `https://localhost:7777` with SDK injection; flags: `--config <PATH>`, `--no-open` |
| `wavedash build push` | Upload new immutable build; flags: `--config <PATH>`, `-m, --message <TEXT>` |
| Global | `--version`, `--help`, `--verbose` |

> Publishing a build is NOT available via CLI — it happens in the Developer
> Portal (src: https://docs.wavedash.com/cli/commands,
> https://docs.wavedash.com/publishing/publish).

### `wavedash.toml` (src: https://docs.wavedash.com/cli/configuration)

| Field | Required | Purpose |
|---|---|---|
| `game_id` | yes | Game ID from the Developer Portal |
| `upload_dir` | yes | Path to the built game (relative to the toml) |
| `entrypoint` | no | First file loaded inside `upload_dir`; defaults to `index.html`. "Point it at your HTML shell, not a bundled script." |

Minimal JS example (derived from the same page):

```toml
game_id    = "YOUR_GAME_ID_HERE"
upload_dir = "./dist"
entrypoint = "index.html"
```

Engine-specific sections like `[godot]` or `[unity]` pin engine version; not
needed for pure JS projects.

---

## 15. Publishing flow

Six stages (src: https://docs.wavedash.com/publishing):

1. **Metadata** (src: https://docs.wavedash.com/publishing/metadata) — title,
   description, **3–5 screenshots** (PNG or JPG at native resolution, lead
   with gameplay), optional trailer, tags.
2. **Pricing** (src: https://docs.wavedash.com/publishing/pricing) — free
   publishing is free. Paid games pay a **10% marketplace fee** + possible
   payment-processor fees. Price can be changed anytime in the Portal.
3. **Upload** (src: https://docs.wavedash.com/publishing/upload) —
   `wavedash build push`. Builds are **immutable** and numbered — you can't
   patch files in place.
4. **Publish** (src: https://docs.wavedash.com/publishing/publish) — happens
   in the **Developer Portal only** (CLI cannot publish). Select a build →
   confirm.
5. **Verify** — load the live public game URL in a clean browser, not
   `wavedash dev` (src: https://docs.wavedash.com/publishing/publish).
6. **Rollback** — re-publish any prior build from the Portal; all previous
   builds remain available (src: https://docs.wavedash.com/publishing/publish).

### Content guidelines (src: https://docs.wavedash.com/publishing/content-guidelines)

- Cover art must NOT feature calls to action (e.g. "PLAY NOW").
- Cover art must NOT feature price information (e.g. the word "FREE").

---

## 16. JS browser gotchas (pre-launch checklist)

All (src: https://docs.wavedash.com/publishing/best-practices):

- **Escape + fullscreen**: Pressing Escape exits fullscreen / releases pointer
  lock *before* your keypress handler sees it. Don't bind Escape to pause;
  listen to `fullscreenchange`:

  ```js
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) game.pause();
  });
  ```

- **Safari audio context**: Requires a user gesture. Resume on first click:

  ```js
  document.addEventListener('click', () => {
    if (audioContext.state === 'suspended') audioContext.resume();
  }, { once: true });
  ```

  Also prefer AAC / M4A over OGG — Safari lacks native OGG support.
- **WebAssembly memory**: WASM memory can only grow, never shrink. Long
  sessions with repeated asset load/unload cause fragmentation. Load assets
  in unloadable groups and test 30+ minute sessions.
- **Shader compile stutter**: Warm up shaders during loading rather than on
  first draw.
- **Cross-browser test** on the live wavedash.com URL, not just `wavedash dev`
  (Chrome + Firefox + Safari).

---

## 17. Important reminders

- **Always `await init()` first** — other calls silently fail otherwise
  (src: https://docs.wavedash.com/sdk/setup).
- **Only `wvdsh_`-prefixed URL params reach the game** via `getLaunchParams()`
  (src: https://docs.wavedash.com/sdk/setup).
- **Host-only mutations**: `setLobbyData`, `deleteLobbyData`
  (src: https://docs.wavedash.com/multiplayer/lobbies).
- **Never log tokens** — the SDK attaches auth automatically; don't forward
  gameplay tokens to your own servers
  (src: https://docs.wavedash.com/sdk/players).
- **`getLeaderboardEntryCount` returns -1** until the leaderboard has been
  queried once (src: https://docs.wavedash.com/sdk/leaderboards).
- **Unreliable P2P** for position/input spam; **reliable** for events/chat
  (src: https://docs.wavedash.com/multiplayer/networking).
- **`drainP2PChannelToBuffer`** returns a length-prefixed packed buffer — see
  §8 for the parse pattern
  (src: https://docs.wavedash.com/multiplayer/networking).
- **Forward slashes** in remote file keys, even on Windows
  (src: https://docs.wavedash.com/sdk/cloud-saves).
- **Achievements with trigger rules** unlock automatically — no SDK call
  needed (src: https://docs.wavedash.com/sdk/achievements).

---

## 18. Known doc inconsistencies (verify at runtime)

- **Leaderboard entry methods**: `/sdk/leaderboards` uses
  `getLeaderboardEntries` / `getLeaderboardEntriesAroundPlayer` with
  `(offset, limit, includeMetadata)` / `(aboveCount, belowCount, includeMetadata)`,
  while the canonical `/sdk/functions` reference uses `listLeaderboardEntries`
  / `listLeaderboardEntriesAroundUser` with `(start, count, friendsOnly)` /
  `(countAhead, countBehind, friendsOnly)`. Prefer the canonical names; fall
  back if runtime rejects them
  (src: https://docs.wavedash.com/sdk/leaderboards,
  https://docs.wavedash.com/sdk/functions).
- **Lobby chat method**: `sendLobbyMessage` (functions reference) vs
  `sendLobbyChatMessage` (lobbies page usage example). Prefer
  `sendLobbyMessage` (src: https://docs.wavedash.com/sdk/functions,
  https://docs.wavedash.com/multiplayer/lobbies).
- **`User` type**: referenced but not published on `/sdk/types`. Treat as
  opaque; read fields only via `getUserId()` / `getUsername()`
  (src: https://docs.wavedash.com/sdk/types).
- **JS event subscription target**: `WavedashJS.addEventListener` is in the
  function reference, but `/sdk/events` still shows only Godot-signal
  examples. If `WavedashJS.addEventListener` fails at runtime, try
  `document.addEventListener(eventName, handler)`
  (src: https://docs.wavedash.com/sdk/functions,
  https://docs.wavedash.com/sdk/events).

---

## 19. Source index (pages crawled)

**200 OK:**

- https://docs.wavedash.com/ — top-level nav
- https://docs.wavedash.com/getting-started/introduction — platform overview
- https://docs.wavedash.com/getting-started/quickstart — engine guide index
- https://docs.wavedash.com/getting-started/glossary — term definitions
- https://docs.wavedash.com/sdk/overview — links to github SDK
- https://docs.wavedash.com/sdk/setup — init, WavedashConfig, `wvdsh_` note
- https://docs.wavedash.com/sdk/functions — canonical JS function reference
- https://docs.wavedash.com/sdk/types — all TS interfaces + type aliases
- https://docs.wavedash.com/sdk/events — full event list + payloads
- https://docs.wavedash.com/sdk/players — identity, friends, avatars
- https://docs.wavedash.com/sdk/friends — friends API + Friend type
- https://docs.wavedash.com/sdk/presence — presence (JS-only)
- https://docs.wavedash.com/sdk/leaderboards — leaderboard methods + enums
- https://docs.wavedash.com/sdk/cloud-saves — `RemoteFileMetadata`, paths
- https://docs.wavedash.com/sdk/achievements — stats/achievements concepts
- https://docs.wavedash.com/sdk/ugc — UGC methods + enums
- https://docs.wavedash.com/engines/javascript — `window.WavedashJS` Promise
- https://docs.wavedash.com/engines/typescript — ambient declare global
- https://docs.wavedash.com/engines/threejs — `#wavedash-target`, `loadComplete`
- https://docs.wavedash.com/multiplayer/lobbies — lobby methods + invite links
- https://docs.wavedash.com/multiplayer/networking — P2P channels + drain
- https://docs.wavedash.com/cli — CLI overview
- https://docs.wavedash.com/cli/installation — install/upgrade
- https://docs.wavedash.com/cli/authentication — login + env var
- https://docs.wavedash.com/cli/configuration — `wavedash.toml` fields
- https://docs.wavedash.com/cli/commands — full command list
- https://docs.wavedash.com/publishing — publishing flow overview
- https://docs.wavedash.com/publishing/metadata — title, screenshots, tags
- https://docs.wavedash.com/publishing/pricing — 10% marketplace fee
- https://docs.wavedash.com/publishing/upload — `wavedash build push`
- https://docs.wavedash.com/publishing/publish — Portal-only publish
- https://docs.wavedash.com/publishing/best-practices — JS browser gotchas
- https://docs.wavedash.com/publishing/content-guidelines — cover-art rules
- https://docs.wavedash.com/reference — reference hub

**404 (intentionally probed — not part of the docs):**

- https://docs.wavedash.com/getting-started/concepts
- https://docs.wavedash.com/sdk/launch-params
- https://docs.wavedash.com/sdk/url-params
- https://docs.wavedash.com/sdk/avatars
- https://docs.wavedash.com/sdk/voice
- https://docs.wavedash.com/sdk/errors
- https://docs.wavedash.com/sdk/iap
- https://docs.wavedash.com/sdk/analytics
- https://docs.wavedash.com/sdk/moderation
- https://docs.wavedash.com/multiplayer/invites
- https://docs.wavedash.com/multiplayer/deeplinks
- https://docs.wavedash.com/multiplayer/matchmaking
- https://docs.wavedash.com/developer-portal
- https://docs.wavedash.com/billing
- https://docs.wavedash.com/reference/functions
- https://docs.wavedash.com/reference/types
- https://docs.wavedash.com/reference/events
