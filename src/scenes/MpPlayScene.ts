/**
 * MpPlayScene.ts — Multiplayer play scene (Phase 4b: players + enemies + player-bullets).
 *
 * Host runs the full authoritative simulation for every user, every enemy,
 * and every player bullet.  Clients are pure observers — they receive
 * snapshots, diff them against local `RemotePlayer` / `RemoteEnemy` /
 * `RemoteProjectile` sprites, and apply state.
 *
 * What's IN this pass:
 *   - Enemy AI + animations + sprites on the host, synced to clients.
 *   - Player bullets (small / charged / full-charged) spawned host-side
 *     when any host-owned Player emits `player-shoot`; also synced.
 *   - Bullet ↔ enemy damage runs host-side only.
 *
 * What's NOT in this pass (deferred to Phase 4c / 5):
 *   - Enemy projectiles (bombs, goop, cannon balls, …) — enemies still
 *     animate their attacks on the host, but their projectile pools are
 *     not wired, so no enemy damage is dealt on clients OR the host yet.
 *   - Player ↔ enemy contact damage.  Enemies can touch the host player
 *     without consequence in v1.
 *   - Respawn / win / lose flow.  Death just stops the simulation for that
 *     entity; we'll broadcast proper end-of-life events in Phase 5.
 *
 * Accepted init data:
 *   { levelName: string; levelData: LevelData; hostId: string; paletteKey?: string }
 */
import * as Phaser from 'phaser';
import { CAMERA } from '../config/gameConfig';
import { PLAYER_ANIMS, ANIM_KEY } from '../config/animConfig';
import { DEFAULT_PALETTE } from '../config/paletteConfig';
import {
  loadTilemap,
  type LoadedLevel,
  type LevelData,
  type EnemyPlacement,
} from '../utils/TilemapLoader';

import { Player }         from '../entities/Player';
import { RemotePlayer, type PlayerSyncState }      from '../entities/RemotePlayer';
import { RemoteEnemy,  type EnemySyncState }       from '../entities/RemoteEnemy';
import { RemoteProjectile, type ProjectileSyncState } from '../entities/RemoteProjectile';

import { Enemy }          from '../entities/Enemy';
import { PenguinBot }     from '../entities/PenguinBot';
import { WalrusBot }      from '../entities/WalrusBot';
import { JetpackBot }     from '../entities/JetpackBot';
import { RollerBot }      from '../entities/RollerBot';
import { ToxicBarrelBot } from '../entities/ToxicBarrelBot';
import { AllTerrainMissileBot } from '../entities/AllTerrainMissileBot';
import { NuclearMonkeyBoss }    from '../entities/NuclearMonkeyBoss';

import { Bullet }         from '../entities/Bullet';
import { ChargedBullet }  from '../entities/ChargedBullet';

import {
  registerBulletAnims,
  registerEnemyFxAnims,
  createBulletSystem,
  createBombPool,
  createSnowballPool,
  createJetpackBulletPool,
  createRollerBulletPool,
  createToxicGoopPool,
  createCannonBallPool,
  createMonkeyBallPool,
  wirePenguinBombs,
  wireWalrusShots,
  wireJetpackShots,
  wireRollerShots,
  wireToxicShots,
  wireAtmbShots,
  wireMonkeyThrows,
  wireBulletEnemyCollisions,
  wirePlayerEnemyCollisions,
  wireBombPlayer,
  wireSnowballPlayer,
  wireJetpackBulletPlayer,
  wireRollerBulletPlayer,
  wireToxicGoopPlayer,
  wireCannonBallPlayer,
  wireMonkeyBallPlayer,
  type BulletSystem,
  type BombPool,
  type SnowballPool,
  type JetpackBulletPool,
  type RollerBulletPool,
  type ToxicGoopPool,
  type CannonBallPool,
  type MonkeyBallPool,
} from '../utils/combatSetup';

import { LobbyManager }   from '../net/lobbyManager';
import { HostSim }        from '../net/hostSim';
import { ClientNet }      from '../net/clientNet';
import { WavedashBridge } from '../net/WavedashBridge';
import { getPlayerId }    from '../net/identity';
import type { LobbyUser } from '../net/wavedash.d';

const TILESET_IMAGE_KEY   = 'castle_tiles';
const SPAWN_STRIDE_TILES  = 2;
const OFF_SCREEN          = -99999;
/** ms between a host player hitting 0 HP and their automatic respawn. */
const RESPAWN_DELAY_MS    = 3000;

/** Narrow interface shared by Bullet + ChargedBullet for projectile harvesting. */
interface ProjectileLike extends Phaser.GameObjects.Sprite {
  active: boolean;
  getSyncState?: () => ProjectileSyncState;
}

/** Annotation placed on host Enemy instances to give them a stable MP id. */
interface EnemyWithMpId extends Enemy { __mpId?: string }

export class MpPlayScene extends Phaser.Scene {
  private levelName  = '';
  private levelData!: LevelData;
  private hostId     = '';
  private myId       = '';
  private paletteKey = DEFAULT_PALETTE.textureKey;

  private level!: LoadedLevel;

  // Host-only state
  private hostSim?: HostSim;
  private hostPlayers   = new Map<string, Player>();
  private ownPlayer?:   Player;
  private enemies:      EnemyWithMpId[] = [];
  // Per-type enemy arrays — the wire* helpers in combatSetup expect the
  // concrete subclass array, not the base Enemy[].  We mirror the union
  // array `enemies` above for snapshot purposes.
  private penguins:  PenguinBot[]            = [];
  private walruses:  WalrusBot[]             = [];
  private jetpacks:  JetpackBot[]            = [];
  private rollers:   RollerBot[]             = [];
  private toxicBots: ToxicBarrelBot[]        = [];
  private atmbs:     AllTerrainMissileBot[]  = [];
  private monkeys:   NuclearMonkeyBoss[]     = [];

  /** Per-host-player bullet pools.  Every `player-shoot` event from that
   *  player feeds its own pool; cross-player bullets still exist, just on
   *  different groups. */
  private bulletSystems = new Map<string, BulletSystem>();

  // Shared enemy-projectile pools (single instance per type, shared across
  // all host players for damage resolution).
  private bombs?:          BombPool;
  private snowballs?:      SnowballPool;
  private jetpackBullets?: JetpackBulletPool;
  private rollerBullets?:  RollerBulletPool;
  private toxicGoop?:      ToxicGoopPool;
  private cannonBalls?:    CannonBallPool;
  private monkeyBalls?:    MonkeyBallPool;

  /** Host-side respawn bookkeeping.  Maps userId → authoritative spawn
   *  position.  Death is detected from Player.currentState === 'dead';
   *  the host fires a `player-died` event (reliable) and schedules a
   *  respawn call after RESPAWN_DELAY_MS, followed by a `player-respawn`
   *  event so clients get to play death / respawn animations in sync. */
  private spawnPoints   = new Map<string, { x: number; y: number }>();
  private deadTimers    = new Map<string, Phaser.Time.TimerEvent>();

  // Client-only state
  private clientNet?:   ClientNet;
  private remotePlayers     = new Map<string, RemotePlayer>();
  private remoteEnemies     = new Map<string, RemoteEnemy>();
  private remoteProjectiles = new Map<string, RemoteProjectile>();

  constructor() {
    super({ key: 'MpPlayScene' });
  }

  init(data: { levelName?: string; levelData?: LevelData; hostId?: string; paletteKey?: string } = {}): void {
    this.levelName  = data.levelName  ?? 'mp';
    this.hostId     = data.hostId     ?? '';
    this.paletteKey = data.paletteKey ?? DEFAULT_PALETTE.textureKey;
    if (data.levelData) this.levelData = data.levelData;
    this.myId = getPlayerId();
    this.hostPlayers.clear();
    this.enemies = [];
    this.penguins = []; this.walruses = []; this.jetpacks = [];
    this.rollers = []; this.toxicBots = []; this.atmbs = []; this.monkeys = [];
    this.bulletSystems.clear();
    this.spawnPoints.clear();
    this.deadTimers.forEach((t) => t.remove(false));
    this.deadTimers.clear();
    this.bombs = undefined; this.snowballs = undefined;
    this.jetpackBullets = undefined; this.rollerBullets = undefined;
    this.toxicGoop = undefined; this.cannonBalls = undefined;
    this.monkeyBalls = undefined;
    this.remotePlayers.clear();
    this.remoteEnemies.clear();
    this.remoteProjectiles.clear();
  }

  create(): void {
    if (!this.levelData) {
      this.add.text(24, 24, 'MP LOAD FAILED: no level data.  Return to lobby.', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff3344',
      });
      return;
    }

    const cacheKey = `mp-${this.levelName}`;
    this.cache.json.remove(cacheKey);
    this.cache.json.add(cacheKey, this.levelData);
    this.level = loadTilemap(this, cacheKey, TILESET_IMAGE_KEY);

    const { widthPx, heightPx, groundLayer } = this.level;
    this.physics.world.setBounds(0, 0, widthPx, heightPx);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, widthPx, heightPx);
    cam.setBackgroundColor(0x0d0f14);

    this.buildPlayerAnims(this.paletteKey);
    // Register bullet + FX anims on both host and client so remote projectile
    // / enemy-death sprites have the animation keys they reference.
    registerBulletAnims(this);
    registerEnemyFxAnims(this);

    const amHost = this.myId === this.hostId;
    if (amHost) {
      this.setupHost(groundLayer);
    } else {
      this.preregisterEnemyAnimsViaDummies();
      this.setupClient();
    }

    this.add.text(12, 12, amHost ? 'HOST' : 'CLIENT', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color:   amHost ? '#00ff99' : '#88aacc',
      backgroundColor: '#0a1020',
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    }).setScrollFactor(0).setDepth(1000);

    this.wireLifecycleEvents();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  // ── Peer lifecycle + host-quit handling ──────────────────────────────────

  private peerDisconnectHandler = (data: { userId: string; username: string }): void => {
    this.onPeerDisconnected(data.userId);
  };

  private hostLostHandler = (evt: { reason: string }): void => {
    this.onHostLost(evt.reason);
  };

  private lobbyKickedHandler = (): void => {
    this.onHostLost('kicked');
  };

  private wireLifecycleEvents(): void {
    // Same handler on host + client: if a peer drops out, everyone removes
    // their remote visual; the host additionally tears down that peer's
    // authoritative Player / hostSim slot so no more input is accepted.
    LobbyManager.events.on('peer-disconnected', this.peerDisconnectHandler);

    // Client-only: stale-host detection fires on ClientNet.
    this.clientNet?.events.on('host-lost', this.hostLostHandler);

    // Either side: being kicked from the lobby (reason=ERROR/KICKED) also
    // routes us back to the browser scene.
    LobbyManager.events.on('kicked', this.lobbyKickedHandler);
  }

  private onPeerDisconnected(userId: string): void {
    // Host side — tear down the sim slot.
    const player = this.hostPlayers.get(userId);
    if (player) {
      player.destroy();
      this.hostPlayers.delete(userId);
    }
    this.hostSim?.removePeer(userId);
    // Detach the leaver's bullet pool from the map so its projectiles stop
    // appearing in snapshots.  Phaser cleans the group on scene shutdown.
    this.bulletSystems.delete(userId);

    // Everyone side — destroy the visual.
    const remote = this.remotePlayers.get(userId);
    if (remote) {
      remote.destroy();
      this.remotePlayers.delete(userId);
    }

    // If the user that dropped was the host itself, clients should route
    // back to the lobby — the underlying ClientNet will also timeout.
    if (userId === this.hostId && this.clientNet) {
      this.clientNet.notifyHostLost('disconnected');
    }
  }

  private onHostLost(reason: string): void {
    // Clients only.  Show a toast and return to the lobby browser.  We leave
    // the lobby so the user lands on a clean state; they can re-host / re-join.
    const msg = reason === 'kicked'
      ? 'KICKED FROM LOBBY'
      : `HOST LEFT (${reason}) — RETURNING TO LOBBY`;
    this.add.text(this.scale.width / 2, 36, msg, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ff3344',
      backgroundColor: '#0a1020',
      padding: { left: 6, right: 6, top: 4, bottom: 4 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1000);

    // Small delay so the toast is visible.
    this.time.delayedCall(1200, () => {
      void LobbyManager.leave();
      this.scene.start('LobbyBrowserScene');
    });
  }

  // ── Host setup ───────────────────────────────────────────────────────────

  private setupHost(groundLayer: Phaser.Tilemaps.TilemapLayer): void {
    this.hostSim = new HostSim();
    const users = LobbyManager.users.length > 0 ? LobbyManager.users : [
      { lobbyId: '', userId: this.myId, username: 'local', isHost: true } as LobbyUser,
    ];

    const { heightPx } = this.level;
    const cellPx = this.level.data.tileWidth * this.level.data.displayScale;
    const baseX = cellPx * 2;
    const baseY = heightPx - cellPx * 3;

    users.forEach((u, index) => {
      this.hostSim!.registerPeer(u.userId);
      const spawnX = baseX + index * cellPx * SPAWN_STRIDE_TILES;
      const player = new Player(this, spawnX, baseY, this.paletteKey);
      this.physics.add.collider(player, groundLayer);
      player.setLadder(groundLayer, this.level.ladderTiles);
      this.hostPlayers.set(u.userId, player);
      this.spawnPoints.set(u.userId, { x: spawnX, y: baseY });
      if (u.userId === this.myId) this.ownPlayer = player;
    });

    // Spawn all enemies the level declares.  Each gets a host-side MP id
    // (from its placement id) that the snapshot carries to clients.
    this.spawnEnemiesFromLevel(groundLayer);

    // Per-player bullet pool + bullet↔enemy damage wiring.  Each host player
    // still emits `player-shoot` from its own keyboard/network input; the
    // corresponding bullet system spawns the bullet and routes it into its
    // own group so projectile ids stay unique per owner.
    for (const [userId, player] of this.hostPlayers) {
      const sys = createBulletSystem(this, player);
      this.bulletSystems.set(userId, sys);
      wireBulletEnemyCollisions(this, sys, this.enemies);
      // Bullets die on tile contact — same collider setup as PlayScene.
      this.physics.add.collider(sys.small,       groundLayer, (a, b) => this.killBulletOnHit(a, b));
      this.physics.add.collider(sys.charged,     groundLayer, (a, b) => this.killBulletOnHit(a, b));
      this.physics.add.collider(sys.fullCharged, groundLayer, (a, b) => this.killBulletOnHit(a, b));
    }

    // ── Enemy projectile pools (shared across all host players) ────────────
    this.bombs          = createBombPool(this);
    this.snowballs      = createSnowballPool(this);
    this.jetpackBullets = createJetpackBulletPool(this);
    this.rollerBullets  = createRollerBulletPool(this);
    this.toxicGoop      = createToxicGoopPool(this);
    this.cannonBalls    = createCannonBallPool(this);
    this.monkeyBalls    = createMonkeyBallPool(this);

    // Tile colliders — match PlayScene's semantics:
    //   bombs & cannon balls & monkey balls KEEP bouncing (lifetime handles death)
    //   everything else dies on tile contact (impactOnHit)
    const impactOnHit = (a: unknown, b: unknown): void => {
      const fire = (o: unknown) => {
        const p = o as { impact?: () => void; kill?: () => void };
        if (p.impact) p.impact();
        else          p.kill?.();
      };
      fire(a); fire(b);
    };
    this.physics.add.collider(this.bombs.group,          groundLayer);
    this.physics.add.collider(this.snowballs.group,      groundLayer, impactOnHit);
    this.physics.add.collider(this.jetpackBullets.group, groundLayer, impactOnHit);
    this.physics.add.collider(this.rollerBullets.group,  groundLayer, impactOnHit);
    this.physics.add.collider(this.toxicGoop.group,      groundLayer, impactOnHit);
    this.physics.add.collider(this.cannonBalls.group,    groundLayer);
    this.physics.add.collider(this.monkeyBalls.group,    groundLayer);

    // Wire each enemy-type's attack events to the corresponding projectile pool.
    wirePenguinBombs(this.penguins,  this.bombs);
    wireWalrusShots (this, this.walruses,  this.snowballs);
    wireJetpackShots(this, this.jetpacks,  this.jetpackBullets);
    wireRollerShots (this.rollers,  this.rollerBullets);
    wireToxicShots  (this.toxicBots, this.toxicGoop);
    wireAtmbShots   (this.atmbs,    this.cannonBalls);
    wireMonkeyThrows(this.monkeys,  this.monkeyBalls);

    // Player ↔ enemy contact damage AND player ↔ enemy-projectile damage —
    // wired once per host player.  Each overlap helper uses `player` as the
    // damage recipient, so we repeat the wiring per host Player instance.
    for (const [, player] of this.hostPlayers) {
      wirePlayerEnemyCollisions(this, player, this.enemies);
      wireBombPlayer         (this, this.bombs,          player);
      wireSnowballPlayer     (this, this.snowballs,      player);
      wireJetpackBulletPlayer(this, this.jetpackBullets, player);
      wireRollerBulletPlayer (this, this.rollerBullets,  player);
      wireToxicGoopPlayer    (this, this.toxicGoop,      player);
      wireCannonBallPlayer   (this, this.cannonBalls,    player);
      wireMonkeyBallPlayer   (this, this.monkeyBalls,    player);
    }

    if (this.ownPlayer) {
      this.cameras.main
        .startFollow(this.ownPlayer, true, CAMERA.lerpX, CAMERA.lerpY)
        .setFollowOffset(0, CAMERA.offsetY)
        .setDeadzone(CAMERA.deadzoneW, CAMERA.deadzoneH);
    }
  }

  private killBulletOnHit(a: unknown, b: unknown): void {
    const tryKill = (o: unknown) => {
      const p = o as { kill?: () => void };
      p.kill?.();
    };
    tryKill(a); tryKill(b);
  }

  /** Manually tick children of a pool whose group disabled runChildUpdate.
   *  (Bombs, cannon balls, monkey balls all self-drive lifetime timers.) */
  private tickPoolChildren(group: Phaser.Physics.Arcade.Group | undefined, delta: number): void {
    if (!group) return;
    for (const child of group.getChildren()) {
      const proj = child as unknown as { active: boolean; update?: (d: number) => void };
      if (proj.active && typeof proj.update === 'function') proj.update(delta);
    }
  }

  /** Host-only: detect each tick whether any host-owned Player just entered
   *  the `dead` state, fire a reliable `player-died` event, and schedule an
   *  automatic respawn RESPAWN_DELAY_MS later (which fires a matching
   *  `player-respawn` event). */
  private hostCheckDeathAndRespawn(): void {
    if (!this.hostSim) return;
    for (const [userId, player] of this.hostPlayers) {
      const dead = player.currentState === 'dead';
      if (!dead) continue;
      if (this.deadTimers.has(userId)) continue; // already scheduled

      this.hostSim.broadcastEvent({
        type:   'player-died',
        userId,
        x:      player.x,
        y:      player.y,
      } as Parameters<HostSim['broadcastEvent']>[0]);

      const spawn = this.spawnPoints.get(userId);
      const timer = this.time.delayedCall(RESPAWN_DELAY_MS, () => {
        this.deadTimers.delete(userId);
        // The user may have disconnected while dead — bail if their Player
        // no longer exists.
        const p = this.hostPlayers.get(userId);
        if (!p || !spawn) return;
        p.respawn(spawn.x, spawn.y);
        this.hostSim?.broadcastEvent({
          type:   'player-respawn',
          userId,
          x:      spawn.x,
          y:      spawn.y,
        } as Parameters<HostSim['broadcastEvent']>[0]);
      });
      this.deadTimers.set(userId, timer);
    }
  }

  /** Materialise `level.data.enemies[]` into live Enemy instances, same as
   *  PlayScene but tagging each with its placement id so snapshots can
   *  reference it.  Uses the HOST's own player as the aggro target — a
   *  simpler model than per-player aggro for v1. */
  private spawnEnemiesFromLevel(groundLayer: Phaser.Tilemaps.TilemapLayer): void {
    const defs: EnemyPlacement[] = this.level.data.enemies ?? [];
    // Every enemy aggros against the full host-player roster.  Enemy.ts
    // picks the nearest each tick with sticky hysteresis so they commit to
    // a target and only switch when it leaves range.
    const targets = Array.from(this.hostPlayers.values()) as unknown as Phaser.Physics.Arcade.Sprite[];
    const hasPatrol = (e: EnemyPlacement) =>
      typeof e.patrolL === 'number' && typeof e.patrolR === 'number' && e.patrolR > e.patrolL;

    const push = (e: EnemyWithMpId, id: string) => {
      e.__mpId = id;
      this.enemies.push(e);
    };

    for (const e of defs) {
      if (e.type === 'penguin_bot') {
        const bot = new PenguinBot(this, e.x, e.y).setPlayers(targets) as PenguinBot;
        if (hasPatrol(e)) bot.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(bot, groundLayer);
        this.penguins.push(bot);
        push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'walrus_bot') {
        const bot = new WalrusBot(this, e.x, e.y).setPlayers(targets) as WalrusBot;
        if (hasPatrol(e)) bot.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(bot, groundLayer);
        this.walruses.push(bot);
        push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'jetpack_bot') {
        const bot = new JetpackBot(this, e.x, e.y).setPlayers(targets) as JetpackBot;
        this.jetpacks.push(bot);
        push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'roller_bot') {
        const bot = new RollerBot(this, e.x, e.y).setPlayers(targets) as RollerBot;
        if (hasPatrol(e)) bot.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(bot, groundLayer);
        this.rollers.push(bot);
        push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'toxic_barrel_bot') {
        const bot = new ToxicBarrelBot(this, e.x, e.y).setPlayers(targets) as ToxicBarrelBot;
        this.physics.add.collider(bot, groundLayer);
        this.toxicBots.push(bot);
        push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'atmb_bot') {
        const bot = new AllTerrainMissileBot(this, e.x, e.y).setPlayers(targets) as AllTerrainMissileBot;
        if (hasPatrol(e)) bot.setPatrol(e.patrolL!, e.patrolR!);
        this.physics.add.collider(bot, groundLayer);
        this.atmbs.push(bot);
        push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'nuclear_monkey_boss') {
        const bot = new NuclearMonkeyBoss(this, e.x, e.y).setPlayers(targets) as NuclearMonkeyBoss;
        this.monkeys.push(bot);
        push(bot as unknown as EnemyWithMpId, e.id);
      }
    }
  }

  // ── Client setup ────────────────────────────────────────────────────────

  private setupClient(): void {
    this.clientNet = new ClientNet();
    this.clientNet.setHost(this.hostId);
    this.clientNet.bindKeys(this.input.keyboard!);

    const users = LobbyManager.users;
    for (const u of users) {
      const rp = new RemotePlayer(this, u.userId, this.paletteKey);
      rp.setVisible(true);
      this.remotePlayers.set(u.userId, rp);
    }

    const mine = this.remotePlayers.get(this.myId);
    if (mine) {
      this.cameras.main
        .startFollow(mine, true, CAMERA.lerpX, CAMERA.lerpY)
        .setFollowOffset(0, CAMERA.offsetY)
        .setDeadzone(CAMERA.deadzoneW, CAMERA.deadzoneH);
    }
  }

  /** Clients don't spawn real Enemy instances (host-only), but the enemy
   *  classes' constructors register animation keys on `scene.anims` as a
   *  side-effect.  We instantiate one of each type off-screen and destroy
   *  it immediately so every animation key RemoteEnemy might receive
   *  already exists when applyState() tries to play it. */
  private preregisterEnemyAnimsViaDummies(): void {
    const ctors: Array<new (scene: Phaser.Scene, x: number, y: number) => Phaser.GameObjects.GameObject> = [
      PenguinBot, WalrusBot, JetpackBot, RollerBot,
      ToxicBarrelBot, AllTerrainMissileBot, NuclearMonkeyBoss,
    ];
    for (const C of ctors) {
      try {
        const dummy = new C(this, OFF_SCREEN, OFF_SCREEN);
        (dummy as unknown as Phaser.GameObjects.GameObject).destroy();
      } catch (err) {
        console.warn('[MpPlayScene] dummy enemy spawn failed for anim registration:', err);
      }
    }
  }

  // ── Frame update ────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.hostSim) {
      // HOST — drive full simulation + broadcast.
      this.hostSim.drainInputs();
      for (const [userId, player] of this.hostPlayers) {
        if (userId === this.myId) player.update(delta);
        else                      player.update(delta, this.hostSim.getInputFor(userId));
      }
      this.hostCheckDeathAndRespawn();
      for (const e of this.enemies) {
        if (e.active) e.update(delta);
      }
      // Projectile pools with runChildUpdate: false need manual ticking so
      // their lifetime timers + rolling rotation advance each frame.
      this.tickPoolChildren(this.bombs?.group,       delta);
      this.tickPoolChildren(this.cannonBalls?.group, delta);
      this.tickPoolChildren(this.monkeyBalls?.group, delta);

      this.hostSim.tickBroadcast(delta, () => this.buildHostSnapshotBody());
    } else if (this.clientNet) {
      // CLIENT — send input, drain snapshots, reconcile visuals.
      this.clientNet.sendInput();
      this.clientNet.drain();
      this.applyInterpolatedSnapshot();
    }
  }

  private buildHostSnapshotBody(): {
    players:     ReturnType<typeof HostSim.buildPlayerEntry>[];
    enemies:     ReturnType<typeof HostSim.buildEnemyEntry>[];
    projectiles: ReturnType<typeof HostSim.buildProjectileEntry>[];
  } {
    const players = [] as ReturnType<typeof HostSim.buildPlayerEntry>[];
    for (const [userId, player] of this.hostPlayers) {
      players.push(HostSim.buildPlayerEntry(userId, player.getSyncState()));
    }

    const enemies = [] as ReturnType<typeof HostSim.buildEnemyEntry>[];
    this.enemies.forEach((e, i) => {
      if (!e.active) return;
      const id = e.__mpId ?? `enemy-${i}`;
      enemies.push(HostSim.buildEnemyEntry(id, e.getSyncState()));
    });

    const projectiles = [] as ReturnType<typeof HostSim.buildProjectileEntry>[];
    for (const [ownerId, sys] of this.bulletSystems) {
      this.collectProjectilesFromGroup(sys.small,       `${ownerId}-small`,   projectiles);
      this.collectProjectilesFromGroup(sys.charged,     `${ownerId}-charged`, projectiles);
      this.collectProjectilesFromGroup(sys.fullCharged, `${ownerId}-full`,    projectiles);
    }
    // Enemy-side projectile pools — shared, prefixed by pool type so ids stay unique.
    if (this.bombs)          this.collectProjectilesFromGroup(this.bombs.group,          'bomb',    projectiles);
    if (this.snowballs)      this.collectProjectilesFromGroup(this.snowballs.group,      'snow',    projectiles);
    if (this.jetpackBullets) this.collectProjectilesFromGroup(this.jetpackBullets.group, 'jet',     projectiles);
    if (this.rollerBullets)  this.collectProjectilesFromGroup(this.rollerBullets.group,  'roller',  projectiles);
    if (this.toxicGoop)      this.collectProjectilesFromGroup(this.toxicGoop.group,      'goop',    projectiles);
    if (this.cannonBalls)    this.collectProjectilesFromGroup(this.cannonBalls.group,    'cannon',  projectiles);
    if (this.monkeyBalls)    this.collectProjectilesFromGroup(this.monkeyBalls.group,    'monkey',  projectiles);

    return { players, enemies, projectiles };
  }

  private collectProjectilesFromGroup(
    group:  Phaser.Physics.Arcade.Group,
    prefix: string,
    out:    ReturnType<typeof HostSim.buildProjectileEntry>[],
  ): void {
    let i = 0;
    for (const child of group.getChildren()) {
      const p = child as unknown as ProjectileLike;
      if (p.active && typeof p.getSyncState === 'function') {
        out.push(HostSim.buildProjectileEntry(`${prefix}-${i}`, p.getSyncState()));
      }
      i++;
    }
  }

  // ── Client-side snapshot apply ──────────────────────────────────────────

  private applyInterpolatedSnapshot(): void {
    const { older, newer, t } = this.clientNet!.getInterpolated();
    if (!newer) return;

    // Players get proper lerp between the last two snapshots so their
    // motion reads as continuous instead of stepping at the 20 Hz rate.
    // Enemies + projectiles snap to `newer` in this pass — entities come
    // and go more frequently and their visuals tolerate steppiness better.
    this.applyPlayers(older, newer, t);
    this.applyEnemies(newer.enemies);
    this.applyProjectiles(newer.projectiles);
  }

  /** Players get position + rotation interpolation between older/newer
   *  snapshots using clientNet's blend parameter.  Animation key, tint,
   *  flip, and HP always track the newer snapshot so state tags react
   *  instantly (a freshly-entered shoot state wouldn't interpolate away). */
  private applyPlayers(
    older: { players: { userId: string; state: PlayerSyncState }[] } | null,
    newer: { players: { userId: string; state: PlayerSyncState }[] },
    t:     number,
  ): void {
    const seen = new Set<string>();
    const olderById = new Map<string, PlayerSyncState>();
    if (older) {
      for (const e of older.players) olderById.set(e.userId, e.state);
    }

    for (const entry of newer.players) {
      seen.add(entry.userId);
      let rp = this.remotePlayers.get(entry.userId);
      if (!rp) {
        rp = new RemotePlayer(this, entry.userId, this.paletteKey);
        this.remotePlayers.set(entry.userId, rp);
      }

      const cur  = entry.state;
      const prev = olderById.get(entry.userId);
      // `t` runs 0..1 from older→newer.  When no older entry is known (e.g.
      // player just spawned in this snapshot), snap to `newer` directly;
      // otherwise lerp position so motion is visually continuous between
      // ticks of the 20 Hz snapshot stream.
      if (prev) {
        rp.applyState({
          ...cur,
          x: Phaser.Math.Linear(prev.x, cur.x, t),
          y: Phaser.Math.Linear(prev.y, cur.y, t),
        });
      } else {
        rp.applyState(cur);
      }
    }

    for (const [id, rp] of this.remotePlayers) {
      if (!seen.has(id)) { rp.destroy(); this.remotePlayers.delete(id); }
    }
  }

  private applyEnemies(entries: { id: string; state: EnemySyncState }[]): void {
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.id);
      let re = this.remoteEnemies.get(entry.id);
      if (!re) {
        re = new RemoteEnemy(this, entry.id, entry.state.enemyType, entry.state.enemyType, entry.state.scale);
        this.remoteEnemies.set(entry.id, re);
      }
      re.applyState(entry.state);
    }
    for (const [id, re] of this.remoteEnemies) {
      if (!seen.has(id)) { re.destroy(); this.remoteEnemies.delete(id); }
    }
  }

  private applyProjectiles(entries: { id: string; state: ProjectileSyncState }[]): void {
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.id);
      let rp = this.remoteProjectiles.get(entry.id);
      if (!rp) {
        rp = new RemoteProjectile(this, entry.id, entry.state);
        this.remoteProjectiles.set(entry.id, rp);
      }
      rp.applyState(entry.state);
    }
    for (const [id, rp] of this.remoteProjectiles) {
      if (!seen.has(id)) {
        // Projectile disappeared — the host either killed it (hit something)
        // or its lifetime expired.  Play a one-shot impact puff at its last
        // known position so clients get the same visual feedback as the host.
        this.playClientImpactFx(rp.type, rp.x, rp.y);
        rp.destroy();
        this.remoteProjectiles.delete(id);
      }
    }
  }

  /** Spawn a short impact animation keyed by projectile type.  Mirrors the
   *  host-side `impact()` behavior in the individual projectile classes —
   *  these use registered FX animations (registerEnemyFxAnims / bullet FX). */
  private playClientImpactFx(type: ProjectileSyncState['type'], x: number, y: number): void {
    const fxKey =
      type === 'walrus_snowball' || type === 'toxic_goop' ? 'walrus_shoot_fx' :
      type === 'jetpack_bullet'  || type === 'roller_bullet' ? 'jetpack_shoot_fx' :
      null;
    if (!fxKey) return;                      // small/charged/cannon/monkey/bomb: no puff
    if (!this.anims.exists(fxKey))  return;  // anim not registered on this client
    const puff = this.add.sprite(x, y, fxKey, 0).setDepth(6);
    if (type === 'toxic_goop') puff.setTint(0x99ff66);
    puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
    puff.play(fxKey);
  }

  // ── Anim registration (copy of PlayScene.buildPlayerAnims) ──────────────

  private buildPlayerAnims(textureKey: string): void {
    for (const [key, def] of Object.entries(PLAYER_ANIMS)) {
      if (this.anims.exists(key)) {
        const existing = this.anims.get(key);
        if (existing.frames[0]?.textureKey === textureKey) continue;
        this.anims.remove(key);
      }
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(textureKey, {
          start: def.start,
          end:   def.end,
        }),
        frameRate: def.frameRate,
        repeat:    def.repeat,
      });
    }
    void ANIM_KEY;
  }

  // ── Shutdown ────────────────────────────────────────────────────────────

  private teardown(): void {
    // Detach lifecycle listeners so next-scene events don't still route here.
    LobbyManager.events.off('peer-disconnected', this.peerDisconnectHandler);
    LobbyManager.events.off('kicked',            this.lobbyKickedHandler);
    this.clientNet?.events.off('host-lost',      this.hostLostHandler);

    this.enemies.forEach((e) => e.destroy());
    this.hostPlayers.forEach((p) => p.destroy());
    this.remotePlayers.forEach((rp) => rp.destroy());
    this.remoteEnemies.forEach((re) => re.destroy());
    this.remoteProjectiles.forEach((rp) => rp.destroy());
    this.enemies = [];
    this.hostPlayers.clear();
    this.remotePlayers.clear();
    this.remoteEnemies.clear();
    this.remoteProjectiles.clear();
    this.bulletSystems.clear();
    this.clientNet?.reset();
    void WavedashBridge;
  }
}

// Keep imports used only for typing/pools from being tree-shaken under strict builds.
void Bullet; void ChargedBullet;
