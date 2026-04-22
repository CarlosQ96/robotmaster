# Multiplayer Plan — Wavedash SDK (v2)

Status: **DRAFT, AWAITING APPROVAL.** No gameplay networking code has been written yet. The only existing net file is [src/net/wavedash.d.ts](../src/net/wavedash.d.ts) (type declarations, zero runtime).

This is a rewrite of the original plan after an audit identified five concrete problems. Each fix is called out inline so you can see what changed and why.

---

## 1. Authority model and what "integrity" actually means here

**Host-authoritative, with a clarified integrity scope.**

The host runs the full simulation. Clients send keyboard input only and render snapshots. That part is unchanged.

### What this protects against

- A **non-host client** cannot cheat. They can lie about their own position or try to flood inputs, but:
  - The host overwrites their position with the authoritative value.
  - The host rate-limits and range-validates input packets.
  - The host owns all HP, damage, kill counts, bullet spawns, and enemy state.
  - Replay attacks are blocked by a monotonically-increasing sequence number in each input packet.

### What this does NOT protect against (fix for audit item #5)

- A **malicious host** can cheat freely. They're running the sim; they can set their own HP to ∞, give themselves infinite ammo, or kill enemies at will.
- In P2P architectures this is unavoidable without a dedicated authoritative server.
- **The word "integrity" in this plan means "joiners cannot cheat." It does NOT mean "no participant can cheat."** For a hackathon this is standard and acceptable — don't host lobbies with people you don't trust, same as every other P2P multiplayer game.

### No client-side prediction in v1 (fix for audit item #4)

The original plan said "input on tick 1234" and "client-side prediction with reconciliation." That requires a fixed-step simulation layer, which the current code does NOT have — Player, Enemy, and PlayScene all run on Phaser's variable `delta`.

Rather than add a fixed-step rewrite as a prerequisite, v1 scales back to **pure interpolation**:

- Host simulates at whatever rate Phaser runs it (variable delta, same as now).
- Host broadcasts a full snapshot every 50ms (20 Hz).
- Clients buffer the two most recent snapshots and lerp positions between them, rendering ~100ms behind "live."
- Apparent latency from input-press to your own character moving = round-trip time (50–200ms typical).

**Tradeoff:** movement feels less responsive than a AAA shooter (your own character has perceptible input lag). This is acceptable for a co-op platformer at hackathon scope. A follow-up pass can add fixed-step + prediction once we have a working baseline.

### Data flow

```
Client input (~every frame) ─────►  Host receives input
     channel 1, unreliable           validates, records

                                     Host advances its normal sim loop
                                     (existing PlayScene update())

                                     Host broadcasts full snapshot @ 20 Hz
Client receives snapshot  ◄──────    channel 0, unreliable
Client interpolates between
last two snapshots, renders

                                     Host emits discrete events
Client receives event    ◄──────     channel 2, reliable
(spawn/die/hit/game-over)
```

---

## 2. Simulation vs Presentation split (fix for audit item #2)

The original plan said "add `remoteMode: boolean` to Player / Enemy / Bullet." The audit correctly pointed out this is not enough:

- `Player.update()` drives invuln/shoot-cooldown/charge/jump-shoot-settle timers.
- Animation frame callbacks emit `player-shoot` events (if these fire on a client, the client spawns ghost bullets).
- `takeDamage()` mutates local `_health`.
- `transition()` owns body size changes and animation playback.
- `Enemy` has the same surface area plus AI in `patrol()`.

Flipping a flag would not silence all of these side effects. The correct solution is a **code split between simulation state and on-screen presentation**, so clients only ever run the presentation half.

### The split, concretely

**`Player` / `Enemy` / `Bullet` etc. today** = simulation (input reading, physics, damage, timers) + presentation (sprite position, animation, tint).

**After the refactor**, two types of object exist in the scene:

1. **Simulation entity** — the existing `Player`, `Enemy`, `Bullet` classes, used only on the host. Unchanged from today except they gain a tiny `getSyncState()` helper that returns a plain object: `{ x, y, vx, vy, flipX, animKey, animFrame, tintMode, tint, alpha, stateTag, hp }`. No behavioral change, just a state export.
2. **Remote view** — new `RemotePlayer`, `RemoteEnemy`, `RemoteBullet` classes. These are dumb sprites. They have **no** `update()`, **no** timers, **no** input wiring, **no** damage logic. Their only API is `applyState(syncState)` which sets position, plays the named animation, applies the tint. Clients create these for **every** entity — including a `RemotePlayer` for themselves, because clients are pure observers in v1 (no local prediction per section 1).

The existing `Player` / `Enemy` classes are **not** modified to support a "remote mode." They stay purely single-player, used only on the host. This keeps the solo code path untouched and avoids the trap the audit identified (local side-effects leaking through a boolean flag).

### Why this works for the specific side-effects called out

- **Animation frame callbacks emit shots** — `RemotePlayer` never registers those listeners. The host still has them and emits to its own event bus; the net layer turns those emissions into `shoot` events on channel 2 that each client receives and spawns a `RemoteBullet` for.
- **Damage mutates local HP** — clients don't have HP. They have a `displayHp` number set from each snapshot. The HUD reads that.
- **Transition owns body size** — clients don't have physics bodies. `RemotePlayer` is a plain sprite, not an arcade-physics sprite.
- **Timers drive state** — clients don't have timers. `stateTag` in each snapshot tells the client "you should be rendering the slide animation right now."

### Projectiles

Bullets are the worst case because they're pooled and spawned on-the-fly. On the host, everything is unchanged. On the client, a `RemoteBulletPool` listens for `bullet-spawn` events on channel 2 and per-snapshot position updates on channel 0.

---

## 3. Phasing (fix for audit item #1 — Phase 3 collapsed with Phase 4)

The original plan had Phase 3 = "sync players only, enemies stay local per-client." The audit correctly called this out: with local enemies and synced players, the host's enemy attacks the host's player, the client's enemy patrols its own path, damage and aggro diverge immediately. There is no playable intermediate state.

The rewritten phasing merges what used to be Phase 3 + 4 into a single "host simulation, client presentation" checkpoint. You either have a networked game or you don't.

### Phase 1 — Foundation (~300 LOC, low risk)

- SDK type declarations (already done: [src/net/wavedash.d.ts](../src/net/wavedash.d.ts))
- `WavedashBridge` — awaits `init()` once; returns `null` cleanly if SDK absent so solo dev still works
- `identity` — SDK username or locally-prompted name
- New **MULTIPLAYER** item in TitleScene menu
- Stub `LobbyBrowserScene` with three buttons (no networking yet)

**Verifiable:** menu routing works, solo mode unaffected.

### Phase 2 — Lobbies + UGC (~600 LOC, low–medium risk)

- `lobbyManager` — host / join-by-id / list public / invite link / metadata / chat
- `LobbyBrowserScene` — all three buttons functional
- `LobbyScene` — player list with avatars, chat, map picker for host, ready button for joiners
- `mapPublisher` — editor `PUBLISH` button uploads current level as UGC (see section 4 for the concrete flow)
- Host picks a map → lobby metadata → joiners download → every client logs "ready to start" — **no gameplay netcode yet.**

**Verifiable:** two browsers can meet in a lobby, chat, agree on a map, and have that map's JSON sit in each client's cache.

### Phase 3 — Presentation split (~400 LOC, **medium risk, no networking**)

Pre-work for Phase 4. Zero multiplayer features ship here.

- Add `RemotePlayer`, `RemoteEnemy`, `RemoteBullet` presentation classes with one method: `applyState(s)`.
- Add `getSyncState()` on existing `Player`, `Enemy`, `Bullet` classes (~10 lines each).
- In `PlayScene`, extract the build-world code so both `PlayScene` (solo) and the forthcoming `MpPlayScene` (mp) can use it.
- Unit-check: on any frame in solo mode, `new RemotePlayer().applyState(player.getSyncState())` produces a sprite that visually matches the real player.

**Verifiable:** solo mode still works identically; no visible change for the user; but the scene now has the primitives needed to render remote entities.

### Phase 4 — Networked gameplay (~700 LOC, **high risk**)

This is where the game becomes multiplayer. Everything or nothing.

- Binary snapshot format: single packet containing all players + all enemies + all bullets. Sized envelope; fits in one Wavedash message if we stay under 2 KB.
- Host runs its existing `PlayScene` loop unchanged. A new net layer hooks the loop: `preUpdate` drains input packets and writes them into "virtual controller" objects the host's own `Player` entities read; `postUpdate` serializes all `getSyncState()` results and broadcasts.
- Clients run `MpPlayScene`, which creates `RemotePlayer` / `RemoteEnemy` / `RemoteBullet` objects and calls `applyState()` each frame with interpolated values from the last two received snapshots.
- Host-spawned events (bullet fired, enemy died, player hit) go on channel 2 (reliable) and trigger one-shot visual effects on clients.

**Verifiable:** two browsers can see each other move, fight the same enemies, and have identical HP / death / win-condition results.

### Phase 5 — Integrity pass + disconnect handling (~200 LOC, medium risk)

- Input validation + rate limiting on host.
- Sequence numbers + replay protection.
- Host-disconnect → everyone returned to lobby with a toast.
- Peer disconnect → host marks that player as disconnected, snapshots no longer include them.

**Verifiable:** a misbehaving client cannot affect others; disconnects don't crash the game.

**Total estimate: ~2200 LOC across 12 new files + 5 modified files (down from 7 modified — solo entities stay untouched per section 2).**

---

## 4. UGC staging and the load path (fix for audit item #3)

The original plan glossed over where a downloaded UGC map actually lands and how `PlayScene` consumes it. Here's the explicit flow that matches the current code.

### Current load path (existing code)

- Editor saves: `POST /api/levels/<name>` (Vite dev middleware writes `public/levels/<name>.json`).
- PlayScene consumes either:
  - **In-memory path**: `scene.start('PlayScene', { levelName, levelData })` — we added this recently to bypass HTTP round-trips from the editor.
  - **HTTP path**: `this.load.json(...)` from `levels/<name>.json` — used by direct launches and level picker.

### New UGC flow

**Publishing from the editor** ([src/scenes/EditorScene.ts](../src/scenes/EditorScene.ts) gets a `PUBLISH` button):

1. The editor already has `this.level.data` (a full `LevelData` object) in memory.
2. Serialize: `const bytes = new TextEncoder().encode(JSON.stringify(this.level.data))`.
3. Stage into Wavedash's virtual FS: `await WavedashJS.writeLocalFile('ugc-staging/<name>.json', bytes)`.
4. Upload: `const ugcId = await WavedashJS.createUgcItem(COMMUNITY, title, desc, PUBLIC, 'ugc-staging/<name>.json')`.
5. Store the returned `ugcId` locally (in localStorage under the map's name) so future publishes of the same map can update the same UGC entry.

**Picking a map in the lobby** (host only):

1. `LobbyScene` loads `this.publishedMaps = readPublishedMapsFromLocalStorage()` — the list of UGC IDs the host has ever published.
2. Host chooses one → `lobbyManager.setLobbyData('mapUgcId', id)` and `setLobbyData('mapTitle', title)`.

**Joining and loading the map** (every client, including host):

1. Read the lobby metadata: `const ugcId = getLobbyData('mapUgcId')`.
2. Download: `await WavedashJS.downloadUgcItem(ugcId, 'ugc-cache/<ugcId>/')`. This writes into the virtual FS.
3. Read the JSON back: `const bytes = await WavedashJS.readLocalFile('ugc-cache/<ugcId>/<name>.json')`, `const levelData = JSON.parse(new TextDecoder().decode(bytes))`.
4. Hand off to PlayScene via the **existing in-memory path**: `scene.start('MpPlayScene', { levelName: ugcId, levelData, hostId })`.

This path reuses `PlayScene`'s existing in-memory `levelData` entry point. No changes to `TilemapLoader` or its fetch logic. The HTTP path is only used by direct launches (solo).

### Open concern

UGC files are stored via Wavedash's virtual FS on web. We need to confirm `downloadUgcItem` on web writes to a path that `readLocalFile` can then read — the SDK docs show both APIs exist but the exact path semantics for web vs native will be validated during Phase 2 with a one-off smoke test before building the rest of the flow. If the paths don't interoperate cleanly, fallback is to have `downloadUgcItem` return the bytes directly via a future SDK call — same end result, different plumbing.

---

## 5. File Layout

### New files

| Path | Role |
|---|---|
| `src/net/wavedash.d.ts` | SDK type declarations. **Already exists.** |
| `src/net/WavedashBridge.ts` | Singleton init, capability probe, returns `null` if SDK absent. |
| `src/net/identity.ts` | `getPlayerName()` — SDK name or locally-saved fallback. |
| `src/net/protocol.ts` | Binary snapshot + event packet layouts. Versioned. |
| `src/net/hostSim.ts` | Host-only net hook: drains input packets, writes virtual inputs, serializes + broadcasts state. |
| `src/net/clientNet.ts` | Non-host: sends input, buffers snapshots, interpolates, calls `applyState` on remote entities. |
| `src/net/lobbyManager.ts` | Lobby lifecycle, metadata, chat, invite. |
| `src/net/mapPublisher.ts` | Editor UGC upload + lobby UGC download + JSON staging. |
| `src/entities/RemotePlayer.ts` | Presentation-only. One method: `applyState()`. |
| `src/entities/RemoteEnemy.ts` | Presentation-only. |
| `src/entities/RemoteBullet.ts` | Presentation-only. |
| `src/scenes/LobbyBrowserScene.ts` | QUICK HOST / JOIN BY ID / BROWSE PUBLIC. |
| `src/scenes/LobbyScene.ts` | Pre-game room. |
| `src/scenes/MpPlayScene.ts` | Multiplayer play scene. Builds world with `TilemapLoader` same as `PlayScene`. Host runs `PlayScene`'s normal sim + a `hostSim` hook; clients run only remote-entity rendering. |

### Modified files

| Path | Change |
|---|---|
| `src/main.ts` | Await `WavedashBridge.init()` before `new Phaser.Game(...)`. Register new scenes. |
| `src/scenes/TitleScene.ts` | Add **MULTIPLAYER** menu item. |
| `src/scenes/EditorScene.ts` | Add **PUBLISH** button next to SAVE. |
| `src/entities/Player.ts` | Add `getSyncState()`. No other changes. |
| `src/entities/Enemy.ts` | Add `getSyncState()`. No other changes. |
| `src/entities/Bullet.ts` etc. | Add `getSyncState()`. No other changes. |
| `src/scenes/PlayScene.ts` | Extract `buildWorld()` into a reusable method. No behavior change. |

**No `remoteMode` flag anywhere.** Solo entities stay pristine.

---

## 6. Out of scope (unchanged)

- Host migration. Host leaves → everyone back to lobby.
- Collaborative editing.
- Voice chat.
- Multiplayer respawn mechanics beyond "host decides when and where."
- Leaderboards & achievements.
- Client-side prediction (deferred; pure interpolation for v1 per section 1).
- Fixed-step simulation rewrite (deferred).

---

## 7. Follow-up questions from audit addressed

| # | Audit finding | Where addressed |
|---|---|---|
| 1 | Phase 3 contradicts authority model (local enemies) | Section 3: Phase 3 is refactor-only (no netcode); Phase 4 is "all-or-nothing" host sim + client presentation. |
| 2 | `remoteMode` is too small | Section 2: introduce `RemotePlayer` / `RemoteEnemy` / `RemoteBullet` as presentation-only classes. Solo entities not modified. |
| 3 | UGC flow vague | Section 4: concrete `writeLocalFile` → `createUgcItem` publish path, `downloadUgcItem` → `readLocalFile` → JSON.parse → in-memory `levelData` load path. |
| 4 | Tick-based prediction premature | Section 1: drop prediction entirely for v1. Variable-delta host sim + pure snapshot interpolation on clients. 20 Hz broadcast rate. |
| 5 | Integrity overstated | Section 1: explicitly scoped to "clients cannot cheat." A cheating host is out of reach for P2P at hackathon scope. |

---

## 8. Go/no-go

Tell me to proceed with **Phase 1** (foundation + menu stubs — zero runtime risk, reversible) or call out anything that needs more discussion.
