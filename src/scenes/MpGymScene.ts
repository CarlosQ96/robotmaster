/**
 * MpGymScene.ts — Multiplayer version of the hand-authored gym level.
 *
 * Structurally a sibling of MpPlayScene.  The key difference is the world:
 * instead of loading a LevelData tilemap, we build static platform bodies
 * from `gymWorld.ts` and spawn the gym's hard-coded enemy roster.  Netcode
 * (HostSim, ClientNet, snapshots, input, interpolation, death/respawn,
 * projectile sync) is identical.
 *
 * Accepted init data:
 *   { hostId: string; paletteKey?: string }
 */
import * as Phaser from 'phaser';
import { CAMERA } from '../config/gameConfig';
import { PLAYER_ANIMS, ANIM_KEY } from '../config/animConfig';
import { DEFAULT_PALETTE } from '../config/paletteConfig';

import { Player }                                  from '../entities/Player';
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
import { getPlayerId }    from '../net/identity';
import type { LobbyUser } from '../net/wavedash.d';

import {
  GYM_ENEMIES,
  GYM_SPAWN,
  GYM_WORLD_SIZE,
  buildGymPlatformBodies,
} from './gymWorld';

const OFF_SCREEN         = -99999;
const RESPAWN_DELAY_MS   = 3000;
const SPAWN_STRIDE_X     = 48;

interface EnemyWithMpId extends Enemy { __mpId?: string }
interface ProjectileLike extends Phaser.GameObjects.Sprite {
  active: boolean;
  getSyncState?: () => ProjectileSyncState;
}

export class MpGymScene extends Phaser.Scene {
  private hostId     = '';
  private myId       = '';
  private paletteKey = DEFAULT_PALETTE.textureKey;

  private platformBodies: Phaser.GameObjects.Rectangle[] = [];

  // Host-only
  private hostSim?: HostSim;
  private hostPlayers   = new Map<string, Player>();
  private ownPlayer?:   Player;
  private enemies:      EnemyWithMpId[] = [];
  private penguins:  PenguinBot[]           = [];
  private walruses:  WalrusBot[]            = [];
  private jetpacks:  JetpackBot[]           = [];
  private rollers:   RollerBot[]            = [];
  private toxicBots: ToxicBarrelBot[]       = [];
  private atmbs:     AllTerrainMissileBot[] = [];
  private monkeys:   NuclearMonkeyBoss[]    = [];
  private bulletSystems = new Map<string, BulletSystem>();
  private bombs?:          BombPool;
  private snowballs?:      SnowballPool;
  private jetpackBullets?: JetpackBulletPool;
  private rollerBullets?:  RollerBulletPool;
  private toxicGoop?:      ToxicGoopPool;
  private cannonBalls?:    CannonBallPool;
  private monkeyBalls?:    MonkeyBallPool;
  private spawnPoints  = new Map<string, { x: number; y: number }>();
  private deadTimers   = new Map<string, Phaser.Time.TimerEvent>();

  // Client-only
  private clientNet?:   ClientNet;
  private remotePlayers     = new Map<string, RemotePlayer>();
  private remoteEnemies     = new Map<string, RemoteEnemy>();
  private remoteProjectiles = new Map<string, RemoteProjectile>();

  constructor() {
    super({ key: 'MpGymScene' });
  }

  init(data: { hostId?: string; paletteKey?: string } = {}): void {
    this.hostId     = data.hostId     ?? '';
    this.paletteKey = data.paletteKey ?? DEFAULT_PALETTE.textureKey;
    this.myId       = getPlayerId();
    this.platformBodies = [];
    this.hostPlayers.clear();
    this.enemies = [];
    this.penguins = []; this.walruses = []; this.jetpacks = [];
    this.rollers = []; this.toxicBots = []; this.atmbs = []; this.monkeys = [];
    this.bulletSystems.clear();
    this.bombs = undefined; this.snowballs = undefined;
    this.jetpackBullets = undefined; this.rollerBullets = undefined;
    this.toxicGoop = undefined; this.cannonBalls = undefined;
    this.monkeyBalls = undefined;
    this.spawnPoints.clear();
    this.deadTimers.forEach((t) => t.remove(false));
    this.deadTimers.clear();
    this.remotePlayers.clear();
    this.remoteEnemies.clear();
    this.remoteProjectiles.clear();
  }

  create(): void {
    const { width, height } = GYM_WORLD_SIZE;
    this.physics.world.setBounds(0, 0, width, height);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, width, height);
    cam.setBackgroundColor(0x0d0f14);

    this.platformBodies = buildGymPlatformBodies(this);

    this.buildPlayerAnims(this.paletteKey);
    registerBulletAnims(this);
    registerEnemyFxAnims(this);

    const amHost = this.myId === this.hostId;
    if (amHost) {
      this.setupHost();
    } else {
      this.preregisterEnemyAnimsViaDummies();
      this.setupClient();
    }

    this.add.text(12, 12, amHost ? 'HOST · GYM' : 'CLIENT · GYM', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color:   amHost ? '#00ff99' : '#88aacc',
      backgroundColor: '#0a1020',
      padding: { left: 4, right: 4, top: 2, bottom: 2 },
    }).setScrollFactor(0).setDepth(1000);

    this.wireLifecycleEvents();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  // ── Lifecycle event wiring (same logic as MpPlayScene) ──────────────────

  private peerDisconnectHandler = (data: { userId: string }): void => this.onPeerDisconnected(data.userId);
  private hostLostHandler       = (evt: { reason: string }): void   => this.onHostLost(evt.reason);
  private lobbyKickedHandler    = (): void                           => this.onHostLost('kicked');

  private wireLifecycleEvents(): void {
    LobbyManager.events.on('peer-disconnected', this.peerDisconnectHandler);
    this.clientNet?.events.on('host-lost',      this.hostLostHandler);
    LobbyManager.events.on('kicked',            this.lobbyKickedHandler);
  }

  private onPeerDisconnected(userId: string): void {
    const player = this.hostPlayers.get(userId);
    if (player) { player.destroy(); this.hostPlayers.delete(userId); }
    this.hostSim?.removePeer(userId);
    this.bulletSystems.delete(userId);
    const remote = this.remotePlayers.get(userId);
    if (remote) { remote.destroy(); this.remotePlayers.delete(userId); }
    if (userId === this.hostId && this.clientNet) {
      this.clientNet.notifyHostLost('disconnected');
    }
  }

  private onHostLost(reason: string): void {
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
    this.time.delayedCall(1200, () => {
      void LobbyManager.leave();
      this.scene.start('LobbyBrowserScene');
    });
  }

  // ── Host setup ──────────────────────────────────────────────────────────

  private setupHost(): void {
    this.hostSim = new HostSim();
    const users = LobbyManager.users.length > 0 ? LobbyManager.users : [
      { lobbyId: '', userId: this.myId, username: 'local', isHost: true } as LobbyUser,
    ];

    users.forEach((u, index) => {
      this.hostSim!.registerPeer(u.userId);
      const spawnX = GYM_SPAWN.x + index * SPAWN_STRIDE_X;
      const spawnY = GYM_SPAWN.y;
      const player = new Player(this, spawnX, spawnY, this.paletteKey);
      for (const body of this.platformBodies) this.physics.add.collider(player, body);
      this.hostPlayers.set(u.userId, player);
      this.spawnPoints.set(u.userId, { x: spawnX, y: spawnY });
      if (u.userId === this.myId) this.ownPlayer = player;
    });

    this.spawnGymEnemies();

    for (const [userId, player] of this.hostPlayers) {
      const sys = createBulletSystem(this, player);
      this.bulletSystems.set(userId, sys);
      wireBulletEnemyCollisions(this, sys, this.enemies);
      for (const body of this.platformBodies) {
        this.physics.add.collider(sys.small,       body, (a, b) => this.killBulletOnHit(a, b));
        this.physics.add.collider(sys.charged,     body, (a, b) => this.killBulletOnHit(a, b));
        this.physics.add.collider(sys.fullCharged, body, (a, b) => this.killBulletOnHit(a, b));
      }
    }

    // Enemy projectile pools (same pattern as MpPlayScene).
    this.bombs          = createBombPool(this);
    this.snowballs      = createSnowballPool(this);
    this.jetpackBullets = createJetpackBulletPool(this);
    this.rollerBullets  = createRollerBulletPool(this);
    this.toxicGoop      = createToxicGoopPool(this);
    this.cannonBalls    = createCannonBallPool(this);
    this.monkeyBalls    = createMonkeyBallPool(this);

    const impactOnHit = (a: unknown, b: unknown): void => {
      const fire = (o: unknown) => {
        const p = o as { impact?: () => void; kill?: () => void };
        if (p.impact) p.impact(); else p.kill?.();
      };
      fire(a); fire(b);
    };
    for (const body of this.platformBodies) {
      this.physics.add.collider(this.bombs.group,          body);
      this.physics.add.collider(this.snowballs.group,      body, impactOnHit);
      this.physics.add.collider(this.jetpackBullets.group, body, impactOnHit);
      this.physics.add.collider(this.rollerBullets.group,  body, impactOnHit);
      this.physics.add.collider(this.toxicGoop.group,      body, impactOnHit);
      this.physics.add.collider(this.cannonBalls.group,    body);
      this.physics.add.collider(this.monkeyBalls.group,    body);
    }

    wirePenguinBombs(this.penguins,  this.bombs);
    wireWalrusShots (this, this.walruses,  this.snowballs);
    wireJetpackShots(this, this.jetpacks,  this.jetpackBullets);
    wireRollerShots (this.rollers,  this.rollerBullets);
    wireToxicShots  (this.toxicBots, this.toxicGoop);
    wireAtmbShots   (this.atmbs,    this.cannonBalls);
    wireMonkeyThrows(this.monkeys,  this.monkeyBalls);

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

  /** Spawn the hard-coded gym enemy roster, colliding with each platform body. */
  private spawnGymEnemies(): void {
    const targets = Array.from(this.hostPlayers.values()) as unknown as Phaser.Physics.Arcade.Sprite[];
    const push = (e: EnemyWithMpId, id: string) => { e.__mpId = id; this.enemies.push(e); };

    for (const e of GYM_ENEMIES) {
      if (e.type === 'penguin_bot') {
        const bot = new PenguinBot(this, e.x, e.y).setPlayers(targets) as PenguinBot;
        if (e.patrolL !== undefined && e.patrolR !== undefined) bot.setPatrol(e.patrolL, e.patrolR);
        for (const body of this.platformBodies) this.physics.add.collider(bot, body);
        this.penguins.push(bot); push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'walrus_bot') {
        const bot = new WalrusBot(this, e.x, e.y).setPlayers(targets) as WalrusBot;
        if (e.patrolL !== undefined && e.patrolR !== undefined) bot.setPatrol(e.patrolL, e.patrolR);
        for (const body of this.platformBodies) this.physics.add.collider(bot, body);
        this.walruses.push(bot); push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'jetpack_bot') {
        const bot = new JetpackBot(this, e.x, e.y).setPlayers(targets) as JetpackBot;
        this.jetpacks.push(bot); push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'roller_bot') {
        const bot = new RollerBot(this, e.x, e.y).setPlayers(targets) as RollerBot;
        if (e.patrolL !== undefined && e.patrolR !== undefined) bot.setPatrol(e.patrolL, e.patrolR);
        for (const body of this.platformBodies) this.physics.add.collider(bot, body);
        this.rollers.push(bot); push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'toxic_barrel_bot') {
        const bot = new ToxicBarrelBot(this, e.x, e.y).setPlayers(targets) as ToxicBarrelBot;
        for (const body of this.platformBodies) this.physics.add.collider(bot, body);
        this.toxicBots.push(bot); push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'atmb_bot') {
        const bot = new AllTerrainMissileBot(this, e.x, e.y).setPlayers(targets) as AllTerrainMissileBot;
        if (e.patrolL !== undefined && e.patrolR !== undefined) bot.setPatrol(e.patrolL, e.patrolR);
        for (const body of this.platformBodies) this.physics.add.collider(bot, body);
        this.atmbs.push(bot); push(bot as unknown as EnemyWithMpId, e.id);
      } else if (e.type === 'nuclear_monkey_boss') {
        const bot = new NuclearMonkeyBoss(this, e.x, e.y).setPlayers(targets) as NuclearMonkeyBoss;
        this.monkeys.push(bot); push(bot as unknown as EnemyWithMpId, e.id);
      }
    }
  }

  private killBulletOnHit(a: unknown, b: unknown): void {
    const tryKill = (o: unknown) => {
      const p = o as { kill?: () => void };
      p.kill?.();
    };
    tryKill(a); tryKill(b);
  }

  // ── Client setup ────────────────────────────────────────────────────────

  private setupClient(): void {
    this.clientNet = new ClientNet();
    this.clientNet.setHost(this.hostId);
    this.clientNet.bindKeys(this.input.keyboard!);

    for (const u of LobbyManager.users) {
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

  private preregisterEnemyAnimsViaDummies(): void {
    const ctors: Array<new (scene: Phaser.Scene, x: number, y: number) => Phaser.GameObjects.GameObject> = [
      PenguinBot, WalrusBot, JetpackBot, RollerBot,
      ToxicBarrelBot, AllTerrainMissileBot, NuclearMonkeyBoss,
    ];
    for (const C of ctors) {
      try { new C(this, OFF_SCREEN, OFF_SCREEN).destroy(); } catch (err) {
        console.warn('[MpGymScene] dummy enemy spawn failed:', err);
      }
    }
  }

  // ── Update + snapshot ───────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    if (this.hostSim) {
      this.hostSim.drainInputs();
      for (const [userId, player] of this.hostPlayers) {
        if (userId === this.myId) player.update(delta);
        else                      player.update(delta, this.hostSim.getInputFor(userId));
      }
      this.hostCheckDeathAndRespawn();
      for (const e of this.enemies) if (e.active) e.update(delta);
      this.tickPoolChildren(this.bombs?.group,       delta);
      this.tickPoolChildren(this.cannonBalls?.group, delta);
      this.tickPoolChildren(this.monkeyBalls?.group, delta);

      this.hostSim.tickBroadcast(delta, () => this.buildHostSnapshotBody());
    } else if (this.clientNet) {
      this.clientNet.sendInput();
      this.clientNet.drain();
      this.applyInterpolatedSnapshot();
    }
  }

  private tickPoolChildren(group: Phaser.Physics.Arcade.Group | undefined, delta: number): void {
    if (!group) return;
    for (const child of group.getChildren()) {
      const proj = child as unknown as { active: boolean; update?: (d: number) => void };
      if (proj.active && typeof proj.update === 'function') proj.update(delta);
    }
  }

  private hostCheckDeathAndRespawn(): void {
    if (!this.hostSim) return;
    for (const [userId, player] of this.hostPlayers) {
      if (player.currentState !== 'dead')   continue;
      if (this.deadTimers.has(userId))      continue;

      this.hostSim.broadcastEvent({
        type: 'player-died', userId, x: player.x, y: player.y,
      } as Parameters<HostSim['broadcastEvent']>[0]);

      const spawn = this.spawnPoints.get(userId);
      const timer = this.time.delayedCall(RESPAWN_DELAY_MS, () => {
        this.deadTimers.delete(userId);
        const p = this.hostPlayers.get(userId);
        if (!p || !spawn) return;
        p.respawn(spawn.x, spawn.y);
        this.hostSim?.broadcastEvent({
          type: 'player-respawn', userId, x: spawn.x, y: spawn.y,
        } as Parameters<HostSim['broadcastEvent']>[0]);
      });
      this.deadTimers.set(userId, timer);
    }
  }

  private buildHostSnapshotBody(): {
    players:     ReturnType<typeof HostSim.buildPlayerEntry>[];
    enemies:     ReturnType<typeof HostSim.buildEnemyEntry>[];
    projectiles: ReturnType<typeof HostSim.buildProjectileEntry>[];
  } {
    const players: ReturnType<typeof HostSim.buildPlayerEntry>[] = [];
    for (const [userId, player] of this.hostPlayers) {
      players.push(HostSim.buildPlayerEntry(userId, player.getSyncState()));
    }

    const enemies: ReturnType<typeof HostSim.buildEnemyEntry>[] = [];
    this.enemies.forEach((e, i) => {
      if (!e.active) return;
      enemies.push(HostSim.buildEnemyEntry(e.__mpId ?? `enemy-${i}`, e.getSyncState()));
    });

    const projectiles: ReturnType<typeof HostSim.buildProjectileEntry>[] = [];
    for (const [ownerId, sys] of this.bulletSystems) {
      this.collectGroup(sys.small,       `${ownerId}-small`,   projectiles);
      this.collectGroup(sys.charged,     `${ownerId}-charged`, projectiles);
      this.collectGroup(sys.fullCharged, `${ownerId}-full`,    projectiles);
    }
    if (this.bombs)          this.collectGroup(this.bombs.group,          'bomb',   projectiles);
    if (this.snowballs)      this.collectGroup(this.snowballs.group,      'snow',   projectiles);
    if (this.jetpackBullets) this.collectGroup(this.jetpackBullets.group, 'jet',    projectiles);
    if (this.rollerBullets)  this.collectGroup(this.rollerBullets.group,  'roller', projectiles);
    if (this.toxicGoop)      this.collectGroup(this.toxicGoop.group,      'goop',   projectiles);
    if (this.cannonBalls)    this.collectGroup(this.cannonBalls.group,    'cannon', projectiles);
    if (this.monkeyBalls)    this.collectGroup(this.monkeyBalls.group,    'monkey', projectiles);

    return { players, enemies, projectiles };
  }

  private collectGroup(
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

  // ── Client snapshot application ─────────────────────────────────────────

  private applyInterpolatedSnapshot(): void {
    const { older, newer, t } = this.clientNet!.getInterpolated();
    if (!newer) return;
    this.applyPlayers(older, newer, t);
    this.applyEnemies(newer.enemies);
    this.applyProjectiles(newer.projectiles);
  }

  private applyPlayers(
    older: { players: { userId: string; state: PlayerSyncState }[] } | null,
    newer: { players: { userId: string; state: PlayerSyncState }[] },
    t:     number,
  ): void {
    const seen = new Set<string>();
    const olderById = new Map<string, PlayerSyncState>();
    if (older) for (const e of older.players) olderById.set(e.userId, e.state);

    for (const entry of newer.players) {
      seen.add(entry.userId);
      let rp = this.remotePlayers.get(entry.userId);
      if (!rp) {
        rp = new RemotePlayer(this, entry.userId, this.paletteKey);
        this.remotePlayers.set(entry.userId, rp);
      }
      const cur  = entry.state;
      const prev = olderById.get(entry.userId);
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
        this.playClientImpactFx(rp.type, rp.x, rp.y);
        rp.destroy();
        this.remoteProjectiles.delete(id);
      }
    }
  }

  private playClientImpactFx(type: ProjectileSyncState['type'], x: number, y: number): void {
    const fxKey =
      type === 'walrus_snowball' || type === 'toxic_goop' ? 'walrus_shoot_fx' :
      type === 'jetpack_bullet'  || type === 'roller_bullet' ? 'jetpack_shoot_fx' :
      null;
    if (!fxKey || !this.anims.exists(fxKey)) return;
    const puff = this.add.sprite(x, y, fxKey, 0).setDepth(6);
    if (type === 'toxic_goop') puff.setTint(0x99ff66);
    puff.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => puff.destroy());
    puff.play(fxKey);
  }

  // ── Anims ───────────────────────────────────────────────────────────────

  private buildPlayerAnims(textureKey: string): void {
    for (const [key, def] of Object.entries(PLAYER_ANIMS)) {
      if (this.anims.exists(key)) {
        const existing = this.anims.get(key);
        if (existing.frames[0]?.textureKey === textureKey) continue;
        this.anims.remove(key);
      }
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(textureKey, { start: def.start, end: def.end }),
        frameRate: def.frameRate,
        repeat:    def.repeat,
      });
    }
    void ANIM_KEY;
  }

  private teardown(): void {
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
    this.deadTimers.forEach((t) => t.remove(false));
    this.deadTimers.clear();
    this.clientNet?.reset();
  }
}
