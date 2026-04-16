---
name: wavedash
description: >-
  Expert knowledge of the Wavedash SDK for browser-based games. Covers all SDK
  features: leaderboards, cloud saves (persistence), lobbies, P2P networking,
  real-time communication, achievements & stats, user-generated content (UGC),
  and player identity. Use when integrating any Wavedash backend service into a
  game — GDScript (Godot), JavaScript, or Unity C#.

  Trigger on: "wavedash", "leaderboard", "cloud save", "WavedashSDK",
  "WavedashJS", lobby/networking questions in context of a Wavedash game,
  achievements/stats for a browser game on the Wavedash platform, UGC upload/download.
---

You are an expert on the Wavedash SDK — a browser-based game platform SDK that
provides backend services (multiplayer, leaderboards, cloud saves, achievements,
UGC, and player identity) injected automatically at runtime. No npm install is
needed; `WavedashJS` is available globally in the browser, and native bindings
exist for Godot (`WavedashSDK` / `WavedashConstants`) and Unity.

---

## Platform Architecture

- Games run in the browser; Wavedash injects the SDK at runtime.
- `WavedashJS` — JavaScript API (direct).
- `WavedashSDK` / `WavedashConstants` — Godot GDScript bindings.
- During local development use `wavedash dev` to get a sandbox SDK.
- **`init()` must be awaited first** before calling any other method.

### Initialization

```gdscript
# Godot
func _ready():
    await WavedashSDK.init({})
```

```javascript
// JavaScript
await WavedashJS.init({ debug: true, deferEvents: false });
```

**WavedashConfig options:**

| Option | Type | Purpose |
|---|---|---|
| `debug` | bool | Verbose console logging |
| `deferEvents` | bool | Queue events until `readyForEvents()` is called |
| `remoteStorageOrigin` | string | Override cloud storage endpoint |
| `p2p` | P2PConfig | Networking settings |

**P2PConfig:**

| Field | Default | Purpose |
|---|---|---|
| `maxPeers` | 8 | Concurrent connection limit |
| `enableReliableChannel` | true | TCP-style guaranteed delivery |
| `enableUnreliableChannel` | true | UDP-style fast transmission |
| `messageSize` | 2048 | Max bytes per message (max 65536) |
| `maxIncomingMessages` | 1024 | Message queue capacity |

---

## Player Identity

Players are authenticated by Wavedash before launching the game. The SDK
handles tokens automatically — never log or forward them to your own servers.

### Current Player

```gdscript
# Godot
func print_player():
    var user    = WavedashSDK.get_user()      # Full profile object
    var user_id = WavedashSDK.get_user_id()   # Stable string ID
    var name    = WavedashSDK.get_username()  # Display name
    print(user_id, " ", name, " ", user)
```

### Friends List

```gdscript
func _ready():
    WavedashSDK.got_friends.connect(_on_got_friends)
    WavedashSDK.list_friends()

func _on_got_friends(response):
    if response.get("success", false):
        for friend in response.get("data", []):
            print(friend["username"], " online: ", friend["isOnline"])
```

**Friend fields:** `userId`, `username`, `avatarUrl?`, `isOnline`

### Avatars

```gdscript
func _ready():
    WavedashSDK.user_avatar_loaded.connect(_on_avatar_loaded)

func load_friend_avatar(user_id: String):
    WavedashSDK.get_user_avatar(user_id, WavedashConstants.AVATAR_SIZE_MEDIUM)

func _on_avatar_loaded(texture: Texture2D, user_id: String):
    if texture:
        $AvatarSprite.texture = texture
```

**Avatar size constants:**

| Constant | Value | Size | Use |
|---|---|---|---|
| `AVATAR_SIZE_SMALL` | 0 | 64px | Lists, compact UI |
| `AVATAR_SIZE_MEDIUM` | 1 | 128px | Profile cards, chat |
| `AVATAR_SIZE_LARGE` | 2 | 256px | Full profile view |

> Call `list_friends()` early to populate the cache before reading avatar URLs.

### Presence (JavaScript only)

```javascript
// Set rich presence
await WavedashJS.updateUserPresence({
    status: "In Lobby",
    details: "Arena - Waiting",
    lobbyId: lobbyId,
    canJoin: lobbyUsers.length < maxPlayers
});

// Clear presence
await WavedashJS.updateUserPresence({});
```

---

## Leaderboards

Each leaderboard has a unique string ID, a sort direction, and a display type.

### Create or Get

```gdscript
# Godot
var response = await WavedashSDK.get_or_create_leaderboard(
    "weekly_score",               # leaderboardId
    WavedashConstants.DESC,       # sortDirection: 1 = higher is better
    WavedashConstants.NUMERIC     # displayType
)
```

**Sort direction:**

| Value | Constant | Use case |
|---|---|---|
| 0 | `ASC` | Speedruns, golf (lower is better) |
| 1 | `DESC` | Points, kills (higher is better) |

**Display type:**

| Value | Constant | Format |
|---|---|---|
| 0 | `NUMERIC` | Standard number |
| 1 | `TIME_SECONDS` | Seconds |
| 2 | `TIME_MILLISECONDS` | Milliseconds |
| 3 | `TIME_GAME_TICKS` | 60 fps ticks |

### Submit Score

```gdscript
var result = await WavedashSDK.post_leaderboard_score(
    "weekly_score",   # leaderboardId
    4200,             # score
    true,             # keepBest — only update if this score is better
    ugc_id            # optional: attach a replay / screenshot UGC ID
)
if result.get("success"):
    print("Global rank: ", result["data"]["globalRank"])
```

### Read Entries

```gdscript
# Top entries (paginated)
var top = await WavedashSDK.get_leaderboard_entries("weekly_score", 0, 10, false)

# Entries around the current player's rank
var around = await WavedashSDK.get_leaderboard_entries_around_player(
    "weekly_score", 5, 5, false   # 5 above, 5 below
)

# Current player's own entries
var mine = await WavedashSDK.get_my_leaderboard_entries("weekly_score")

# Cached total count (-1 if not yet queried)
var count = WavedashSDK.get_leaderboard_entry_count("weekly_score")
```

**LeaderboardEntry fields:** `userId`, `username?`, `score`, `globalRank`, `ugcId?`, `timestamp`, `metadata?` (Uint8Array)

---

## Cloud Saves (Persistence)

Per-player file storage that syncs across devices and sessions. Use forward
slashes for remote keys on all platforms.

### Upload a Save

```gdscript
func save_game(slot: int, data: Dictionary):
    var path = OS.get_user_data_dir() + "/saves/slot%d.json" % slot
    # Write locally first
    var file = FileAccess.open(path, FileAccess.WRITE)
    file.store_string(JSON.stringify(data))
    file.close()
    # Push to cloud
    var result = await WavedashSDK.upload_remote_file("saves/slot%d.json" % slot)
    if not result.get("success"):
        push_error("Upload failed: " + result.get("message", ""))
```

### Download a Save

```gdscript
func load_game(slot: int) -> Dictionary:
    var remote_key = "saves/slot%d.json" % slot
    var result = await WavedashSDK.download_remote_file(remote_key)
    if result.get("success"):
        var local_path = OS.get_user_data_dir() + "/" + remote_key
        var file = FileAccess.open(local_path, FileAccess.READ)
        return JSON.parse_string(file.get_as_text())
    return {}
```

### List Remote Files

```gdscript
var listing = await WavedashSDK.list_remote_directory("saves/")
if listing.get("success"):
    for meta in listing["data"]:
        print(meta["name"], " - ", meta["size"], " bytes - ", meta["lastModified"])
```

**RemoteFileMetadata fields:** `exists`, `key`, `name`, `lastModified`, `size`, `etag`

### Download a Whole Directory

```gdscript
await WavedashSDK.download_remote_directory("saves/")
```

### JavaScript (Virtual FS) API

```javascript
// Write to local virtual filesystem
await WavedashJS.writeLocalFile("saves/slot1.json", uint8ArrayData);

// Read from virtual filesystem
const data = await WavedashJS.readLocalFile("saves/slot1.json");

// Sync to/from cloud
await WavedashJS.uploadRemoteFile("saves/slot1.json");
await WavedashJS.downloadRemoteFile("saves/slot1.json");
```

---

## Lobbies

Lobbies let players gather before or during gameplay. The host controls
metadata; any member can read it.

### Create and Join

```gdscript
# Create (visibility: 0=PUBLIC, 1=FRIENDS_ONLY, 2=PRIVATE)
var result = await WavedashSDK.create_lobby(
    WavedashConstants.PUBLIC, # visibility
    4                         # max_players
)
var lobby_id: String = result["data"]

# Join an existing lobby
await WavedashSDK.join_lobby(lobby_id)

# Leave
await WavedashSDK.leave_lobby(lobby_id)
```

**Visibility:**

| Value | Constant | Access |
|---|---|---|
| 0 | `PUBLIC` | Anyone can find and join |
| 1 | `FRIENDS_ONLY` | Only friends can see and join |
| 2 | `PRIVATE` | Only joinable with the lobby ID |

### Discover Lobbies

```gdscript
var lobbies = await WavedashSDK.list_available_lobbies()
for lobby in lobbies.get("data", []):
    print(lobby["lobbyId"], " players: ", lobby["playerCount"], "/", lobby["maxPlayers"])
```

### Lobby Info

```gdscript
var users    = WavedashSDK.get_lobby_users(lobby_id)   # Array of LobbyUser
var host_id  = WavedashSDK.get_lobby_host_id(lobby_id)
var count    = WavedashSDK.get_num_lobby_users(lobby_id)
var am_host  = host_id == WavedashSDK.get_user_id()
```

**LobbyUser fields:** `lobbyId`, `userId`, `username`, `userAvatarUrl?`, `isHost`

### Metadata (host only writes, all read)

```gdscript
# Set
WavedashSDK.set_lobby_data(lobby_id, "map", "arena_01")
WavedashSDK.set_lobby_data(lobby_id, "mode", "deathmatch")

# Read
var map = WavedashSDK.get_lobby_data(lobby_id, "map")

# Delete (host only)
WavedashSDK.delete_lobby_data(lobby_id, "map")
```

### Invitations

```gdscript
# Invite a specific user
await WavedashSDK.invite_user_to_lobby(lobby_id, target_user_id)

# Get a shareable link
var link_result = await WavedashSDK.get_lobby_invite_link(true) # true = copy to clipboard
var url: String = link_result["data"]
```

### Lobby Events

```gdscript
func _ready():
    WavedashSDK.lobby_joined.connect(_on_lobby_joined)
    WavedashSDK.lobby_users_updated.connect(_on_users_updated)
    WavedashSDK.lobby_message.connect(_on_lobby_message)
    WavedashSDK.lobby_data_updated.connect(_on_data_updated)
    WavedashSDK.lobby_kicked.connect(_on_kicked)
    WavedashSDK.lobby_invite.connect(_on_invite)
```

| Event | Trigger | Key fields |
|---|---|---|
| `LOBBY_JOINED` | You join or create | `lobbyId`, `hostId`, `users`, `metadata` |
| `LOBBY_USERS_UPDATED` | Player joins/leaves | `userId`, `username`, `isHost`, `changeType` ("JOINED"\|"LEFT") |
| `LOBBY_MESSAGE` | Chat arrives | `messageId`, `userId`, `username`, `message`, `timestamp` |
| `LOBBY_DATA_UPDATED` | Metadata changes | full metadata object |
| `LOBBY_KICKED` | You're removed | `lobbyId`, `reason` ("KICKED"\|"ERROR") |
| `LOBBY_INVITE` | Invite received | `notificationId`, `lobbyId`, `sender` ({`_id`, `username`, `avatarUrl`}) |

---

## Communication

### Lobby Chat

```gdscript
# Send (max 500 characters)
WavedashSDK.send_lobby_chat_message(lobby_id, "Ready!")

# Receive via LOBBY_MESSAGE event
func _on_lobby_message(data):
    print("[", data["username"], "]: ", data["message"])
```

### P2P Messaging

WebRTC connections are auto-established between all lobby members after joining.
Channels 0-7 are available.

```gdscript
# Broadcast to all peers
WavedashSDK.send_p2p_message("", packed_bytes, 0, true)  # "" = all peers

# Send to specific peer
WavedashSDK.send_p2p_message(target_user_id, packed_bytes, 0, true)
```

**send_p2p_message parameters:**

| Param | Type | Notes |
|---|---|---|
| `userId` | string | Target peer ID; `""` = broadcast |
| `data` | PackedByteArray | Binary payload |
| `channel` | int | 0–7 |
| `reliable` | bool | true = guaranteed ordered; false = best-effort |

**Reading messages (poll per frame):**

```gdscript
func _process(_delta):
    var messages = WavedashSDK.drain_p2p_channel(0)
    for msg in messages:
        var sender: String = msg["identity"]
        var payload: PackedByteArray = msg["payload"]
        _handle_game_message(sender, payload)
```

**JavaScript high-performance batch drain:**

```javascript
const packed = WavedashJS.drainP2PChannelToBuffer(0);
const view   = new DataView(packed.buffer);
let offset   = 0;
while (offset < packed.byteLength) {
    const size    = view.getUint32(offset, true);
    offset       += 4;
    const message = packed.subarray(offset, offset + size);
    offset       += size;
    handleMessage(message);
}
```

**P2P Events:**

| Event | Trigger | Fields |
|---|---|---|
| `P2P_CONNECTION_ESTABLISHED` | Peer ready | `userId`, `username` |
| `P2P_CONNECTION_FAILED` | Connection failed | `userId`, `username`, `error` |
| `P2P_PEER_DISCONNECTED` | Peer dropped | `userId`, `username` |

---

## Networking (P2P WebRTC)

The SDK auto-handles NAT traversal with TURN servers. No manual signalling needed.

### Channel Guide

| Channel | Purpose |
|---|---|
| 0 | Game state updates |
| 1 | Player input |
| 2 | Chat messages |
| 3 | Voice data |
| 4–7 | Custom use |

### Reliable vs Unreliable

- **Reliable** (`reliable: true`): Guaranteed ordered delivery. Use for events, chat, important state transitions.
- **Unreliable** (`reliable: false`): Best-effort, lower latency. Use for positions, inputs, rapid-fire updates.

### Full Networking Bootstrap Pattern

```gdscript
var lobby_id: String

func host_game():
    var result = await WavedashSDK.create_lobby(WavedashConstants.PUBLIC, 4)
    lobby_id = result["data"]
    WavedashSDK.p2p_connection_established.connect(_on_peer_connected)
    WavedashSDK.p2p_peer_disconnected.connect(_on_peer_disconnected)

func join_game(id: String):
    lobby_id = id
    await WavedashSDK.join_lobby(id)
    WavedashSDK.p2p_connection_established.connect(_on_peer_connected)

func _on_peer_connected(data):
    print("Peer connected: ", data["username"])

func _on_peer_disconnected(data):
    print("Peer left: ", data["username"])

func _process(_delta):
    for msg in WavedashSDK.drain_p2p_channel(0):
        _handle_state(msg["identity"], msg["payload"])
    for msg in WavedashSDK.drain_p2p_channel(1):
        _handle_input(msg["identity"], msg["payload"])

func broadcast_state(state: PackedByteArray):
    WavedashSDK.send_p2p_message("", state, 0, true)

func send_input(input: PackedByteArray):
    WavedashSDK.send_p2p_message("", input, 1, false)
```

### P2PMessage fields

`fromUserId` (string), `channel` (int), `payload` (Uint8Array/PackedByteArray)

### P2PConnection state values

`"connecting"` | `"connected"` | `"disconnected"` | `"failed"`

---

## Achievements & Stats

Stats are numbers that track player progress. Achievements are milestones
unlocked manually or automatically when a stat threshold is met.

### Setup (Dev Portal)

1. Create a stat: `id` (e.g. `TOTAL_KILLS`), display name.
2. Create an achievement: `id`, title, description, optional trigger rule (stat + threshold).

### Load Stats

```gdscript
func _ready():
    var result = await WavedashSDK.request_stats()
    if result.get("success"):
        _update_ui()
```

### Read / Write Stats

```gdscript
# Read (after request_stats resolves)
var kills = WavedashSDK.get_stat_int("TOTAL_KILLS")

# Write (storeNow=true debounces persist over 1 second)
WavedashSDK.set_stat_int("TOTAL_KILLS", kills + 1, true)

# Flush all pending changes immediately
WavedashSDK.store_stats()
```

### Unlock Achievements

```gdscript
# Manual unlock
WavedashSDK.set_achievement("FIRST_BLOOD", true)

# Check if already unlocked
if not WavedashSDK.get_achievement("FIRST_BLOOD"):
    WavedashSDK.set_achievement("FIRST_BLOOD")
```

> Achievements with a **trigger rule** unlock automatically when the linked stat
> reaches its threshold — no manual SDK call needed.

### Stats Event

| Event | Trigger | Fields |
|---|---|---|
| `STATS_STORED` | Stats persisted | `success`, `message?` |

### JavaScript API

```javascript
await WavedashJS.requestStats();
const kills = WavedashJS.getStat("TOTAL_KILLS");
WavedashJS.setStat("TOTAL_KILLS", kills + 1, true);
WavedashJS.setAchievement("FIRST_BLOOD");
const done = WavedashJS.getAchievement("FIRST_BLOOD"); // boolean
WavedashJS.storeStats(); // flush immediately
```

---

## User-Generated Content (UGC)

Players can upload, share, and download community content: replays, screenshots,
custom levels, mods, and more.

### UGC Types

| Value | Constant | Use |
|---|---|---|
| 0 | `SCREENSHOT` | Still images |
| 1 | `VIDEO` | Clips, recordings |
| 2 | `COMMUNITY` | Levels, mods, maps |
| 3 | `GAME_MANAGED` | Replays, auto-saves |
| 4 | `OTHER` | Miscellaneous |

### Visibility

| Value | Constant | Access |
|---|---|---|
| 0 | `PUBLIC` | All users |
| 1 | `FRIENDS_ONLY` | Creator's friends |
| 2 | `PRIVATE` | Creator only |

### Upload

```gdscript
func upload_replay(file_path: String):
    var result = await WavedashSDK.create_ugc_item(
        WavedashConstants.GAME_MANAGED,  # type
        "Run #42",                        # title
        "Personal best speedrun replay",  # description
        WavedashConstants.PUBLIC,         # visibility
        file_path                         # absolute path (OS.get_user_data_dir() based)
    )
    if result.get("success"):
        var ugc_id: String = result["data"]
        print("Uploaded UGC: ", ugc_id)
```

> Always use absolute paths from `OS.get_user_data_dir()`. Virtual `user://`
> paths are incompatible with web exports.

### Update Existing UGC

```gdscript
# Pass null for file_path to keep the existing file
await WavedashSDK.update_ugc_item(
    ugc_id,
    "Run #42 (updated title)",
    "New description",
    WavedashConstants.PUBLIC,
    null   # keep existing file
)
```

### Download

```gdscript
var dest = OS.get_user_data_dir() + "/replays/"
var result = await WavedashSDK.download_ugc_item(ugc_id, dest)
if result.get("success"):
    print("Downloaded to: ", dest)
```

### Attach to Leaderboard Score

Pass a `ugcId` when submitting a leaderboard score to link a replay or screenshot:

```gdscript
var upload = await WavedashSDK.create_ugc_item(
    WavedashConstants.GAME_MANAGED, "Replay", "", WavedashConstants.PUBLIC, replay_path
)
var ugc_id = upload["data"]

await WavedashSDK.post_leaderboard_score("speedrun_board", run_time_ms, true, ugc_id)
```

---

## Common Response Pattern

All async SDK calls return a `WavedashResponse<T>`:

```gdscript
var result = await WavedashSDK.some_call(...)
if result.get("success"):
    var data = result["data"]   # T or null
else:
    push_error("SDK error: " + result.get("message", "unknown"))
```

```typescript
// TypeScript / JavaScript
interface WavedashResponse<T> {
    success: boolean;
    data: T | null;
    message?: string;   // error description
}
```

---

## Backend Connection Events

| Event | Trigger | Fields |
|---|---|---|
| `BACKEND_CONNECTED` | Connected to Wavedash | `isConnected`, `hasEverConnected`, `connectionCount`, `connectionRetries` |
| `BACKEND_DISCONNECTED` | Connection lost | same |
| `BACKEND_RECONNECTING` | Attempting reconnect | same |

```gdscript
func _ready():
    WavedashSDK.backend_connected.connect(_on_connected)
    WavedashSDK.backend_disconnected.connect(_on_disconnected)

func _on_connected(_data):
    $StatusLabel.text = "Online"

func _on_disconnected(_data):
    $StatusLabel.text = "Offline — reconnecting..."
```

---

## Full SDK Function Reference

### Players
| Function | Returns | Notes |
|---|---|---|
| `get_user()` | User | Full profile |
| `get_user_id()` | string | Stable ID |
| `get_username()` | string | Display name |
| `list_friends()` | Response<Friend[]> | Async |
| `get_user_avatar(userId, size)` | — | Emits `user_avatar_loaded` |
| `update_user_presence(data)` | void | JS only |

### Achievements & Stats
| Function | Returns | Notes |
|---|---|---|
| `request_stats()` | Response<void> | Load stats from server |
| `get_stat_int(id)` | int | Local cache only |
| `set_stat_int(id, value, storeNow)` | void | |
| `get_achievement(id)` | bool | |
| `set_achievement(id, storeNow?)` | void | |
| `store_stats()` | void | Immediate flush |

### Leaderboards
| Function | Returns | Notes |
|---|---|---|
| `get_or_create_leaderboard(id, sort, display)` | Response<Leaderboard> | |
| `post_leaderboard_score(id, score, keepBest, ugcId?)` | Response<{globalRank}> | |
| `get_leaderboard_entries(id, offset, limit, archived)` | Response<Entry[]> | |
| `get_leaderboard_entries_around_player(id, before, after, archived)` | Response<Entry[]> | |
| `get_my_leaderboard_entries(id)` | Response<Entry[]> | |
| `get_leaderboard_entry_count(id)` | int | -1 if not queried |

### Lobbies
| Function | Returns | Notes |
|---|---|---|
| `create_lobby(visibility, maxPlayers)` | Response<string> | Returns lobby ID |
| `join_lobby(id)` | void | |
| `leave_lobby(id)` | void | |
| `list_available_lobbies(friendsOnly?)` | Response<Lobby[]> | |
| `get_lobby_users(id)` | LobbyUser[] | Sync |
| `get_lobby_host_id(id)` | string | Sync |
| `get_num_lobby_users(id)` | int | Sync |
| `send_lobby_chat_message(id, msg)` | void | Max 500 chars |
| `invite_user_to_lobby(id, userId)` | void | |
| `get_lobby_invite_link(copy?)` | Response<string> | |
| `set_lobby_data(id, key, value)` | void | Host only |
| `get_lobby_data(id, key)` | string | |
| `delete_lobby_data(id, key)` | void | Host only |

### P2P Networking
| Function | Returns | Notes |
|---|---|---|
| `send_p2p_message(userId, data, channel, reliable)` | void | `""` = broadcast |
| `drain_p2p_channel(channel)` | Array | Array of `{identity, payload}` |
| `drainP2PChannelToBuffer(channel)` | Uint8Array | JS; packed binary |
| `read_p2p_message_from_channel(channel)` | P2PMessage\|null | Single message |

### Cloud Saves
| Function | Returns | Notes |
|---|---|---|
| `upload_remote_file(path)` | Response<void> | |
| `download_remote_file(path)` | Response<void> | |
| `download_remote_directory(path)` | void | |
| `list_remote_directory(path)` | Response<FileMetadata[]> | |
| `write_local_file(path, data)` | void | JS virtual FS |
| `read_local_file(path)` | Uint8Array | JS virtual FS |

### UGC
| Function | Returns | Notes |
|---|---|---|
| `create_ugc_item(type, title, desc, visibility, path)` | Response<string> | Returns UGC ID |
| `update_ugc_item(ugcId, title, desc, visibility, path\|null)` | void | null path = keep file |
| `download_ugc_item(ugcId, destPath)` | Response<void> | |

---

## When to Activate This Skill

- User asks about leaderboard creation, score submission, or ranking display
- Implementing cloud saves, cross-device save sync, or save slot management
- Setting up multiplayer lobbies, matchmaking, or lobby chat
- Implementing real-time P2P game networking or state sync
- Adding achievements or tracking player stats
- Handling UGC — replays, community levels, screenshots
- Any question involving `WavedashSDK`, `WavedashJS`, or `WavedashConstants`
- Debugging Wavedash events, connection issues, or auth token errors

## Important Reminders

- **Always `await init()` before any other call** — subsequent calls silently fail otherwise
- **Use absolute paths** (from `OS.get_user_data_dir()` in Godot) for file operations — `user://` virtual paths are rejected by the web export
- **Only the lobby host** can call `set_lobby_data` / `delete_lobby_data`
- **Token security**: never log or forward gameplay tokens to your own servers
- **Achievements with trigger rules** unlock automatically — no SDK call needed when a stat threshold is crossed
- **`get_leaderboard_entry_count`** returns `-1` until the leaderboard has been queried; always check for this value
- **Unreliable P2P** is better for frequent position/input updates; reliable for authoritative events
- **Presence API** is JavaScript-only — Godot and Unity bindings do not expose it yet
