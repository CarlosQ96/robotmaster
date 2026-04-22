/**
 * LobbyScene.ts — Pre-game room.
 *
 * Host's view:
 *   ┌─────────────────────────────────────────────────┐
 *   │   LOBBY: abc123                      [INVITE]   │
 *   │                                                 │
 *   │  PLAYERS                 CHAT                   │
 *   │  • Alice  (HOST)         [system] Alice created │
 *   │  • Bob                   Alice: yo              │
 *   │                                                 │
 *   │  MAP                     [ TYPE TO CHAT  ]      │
 *   │  ◀ MyLevel ▶                                    │
 *   │                                                 │
 *   │                [START GAME]    [LEAVE]          │
 *   └─────────────────────────────────────────────────┘
 *
 * Client (non-host) view is the same layout, but:
 *   - Map picker is read-only; shows the map title the host chose.
 *   - START GAME is replaced with READY / UNREADY toggle.
 *
 * Phase-2 scope: everything except the actual game start is wired.  Pressing
 * START prints "gameplay coming Phase 4" toast; joiners that toggle READY
 * update lobby metadata but no gameplay scene launches yet.
 *
 * Accepts via scene.start:
 *   { lobbyId: string }   — used only for display; LobbyManager holds truth.
 */
import * as Phaser from 'phaser';
import { LobbyManager } from '../net/lobbyManager';
import type { LobbyUser, LobbyMessage } from '../net/wavedash.d';
import {
  listPublishedMaps,
  downloadMap,
  type PublishedMapRecord,
} from '../net/mapPublisher';
import type { LevelData } from '../utils/TilemapLoader';

const CHAT_HISTORY_LIMIT = 12;

export class LobbyScene extends Phaser.Scene {
  private lobbyId = '';

  // Layout regions
  private playersList!: Phaser.GameObjects.Text;
  private chatLog!:     Phaser.GameObjects.Text;
  private mapDisplay!:  Phaser.GameObjects.Text;
  private statusText!:  Phaser.GameObjects.Text;
  private chatInputText!: Phaser.GameObjects.Text;

  private chatHistory: string[] = [];
  private chatBuffer  = '';

  // Host-side map picker state.  Index 0 is always the synthetic GYM entry
  // (built-in level, no UGC).  Indices 1..N are the host's published maps.
  private myMaps:      PublishedMapRecord[] = [];
  private mapIndex:    number = -1;
  /** Sentinel ugcId used for the built-in gym map.  The picker, metadata,
   *  and both the host and clients treat this as "route into MpGymScene". */
  private static readonly GYM_UGC_ID = '__gym__';
  private static readonly GYM_TITLE  = 'GYM (built-in)';

  // Cached map data (populated when lobby metadata advertises a mapUgcId).
  // On clients, this is downloaded automatically; on host it's already cached
  // after onPrimaryAction runs the first time.
  private cachedMapData: LevelData | null = null;
  private cachedUgcId:   string           = '';
  private hasTransitioned = false;

  // Bound handlers kept as members so we can off() on shutdown
  private onUsers    = (users: LobbyUser[]) => this.renderPlayers(users);
  private onChat     = (msg: LobbyMessage) => this.appendChat(`${msg.username}: ${msg.message}`);
  private onMetadata = (md: Record<string, string>) => {
    this.renderMetadata(md);
    void this.handleMetadataForGameStart(md);
  };
  private onKicked   = () => { this.toast('KICKED FROM LOBBY'); this.leaveToBrowser(); };

  constructor() {
    super({ key: 'LobbyScene' });
  }

  init(data: { lobbyId?: string } = {}): void {
    this.lobbyId = data.lobbyId ?? LobbyManager.lobbyId ?? '';
    this.chatHistory = [];
    this.chatBuffer  = '';
    this.mapIndex    = -1;
  }

  create(): void {
    const { width, height } = this.scale;
    this.buildBackground(width, height);
    this.buildHeader(width);
    this.buildPlayersColumn();
    this.buildChatColumn(width);
    this.buildMapPicker();
    this.buildButtons(width, height);
    this.registerKeys();

    // Hydrate from current LobbyManager state in case we joined while this
    // scene was inactive (events would have fired before we subscribed).
    this.renderPlayers(LobbyManager.users);
    this.renderMetadata(LobbyManager.metadata);

    // Subscribe to live updates.
    LobbyManager.events.on('users',    this.onUsers);
    LobbyManager.events.on('chat',     this.onChat);
    LobbyManager.events.on('metadata', this.onMetadata);
    LobbyManager.events.on('kicked',   this.onKicked);

    // Host-side map choices: built-in GYM is always the first option;
    // any published UGC maps follow.  Storing as PublishedMapRecord[] keeps
    // the picker uniform.
    this.myMaps = [
      {
        name:        '__gym__',
        ugcId:       LobbyScene.GYM_UGC_ID,
        title:       LobbyScene.GYM_TITLE,
        publishedAt: 0,
      },
      ...listPublishedMaps(),
    ];

    // If host + no map chosen yet, auto-select the first (GYM by default).
    if (LobbyManager.isHost()) {
      const current = LobbyManager.getMetadata('mapUgcId');
      if (!current && this.myMaps.length > 0) {
        this.mapIndex = 0;
        this.applyHostMapChoice();
      } else if (current) {
        this.mapIndex = this.myMaps.findIndex((m) => m.ugcId === current);
        if (this.mapIndex < 0) this.mapIndex = 0;
      }
      this.renderMapDisplay();
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      LobbyManager.events.off('users',    this.onUsers);
      LobbyManager.events.off('chat',     this.onChat);
      LobbyManager.events.off('metadata', this.onMetadata);
      LobbyManager.events.off('kicked',   this.onKicked);
    });
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  private buildBackground(w: number, h: number): void {
    this.add.rectangle(w / 2, h / 2, w, h, 0x0d0f14);
    const g = this.add.graphics();
    g.lineStyle(1, 0x1a3355, 0.6);
    g.strokeRect(16, 16, w - 32, h - 32);
  }

  private buildHeader(w: number): void {
    this.add.text(32, 28, 'LOBBY', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#00ff99',
    });

    this.add.text(32, 58, `ID: ${this.lobbyId || '(offline)'}`, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#446688',
    });

    // Invite button (right-aligned)
    const inviteBtn = this.add.text(w - 32, 36, '[ COPY INVITE LINK ]', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#88aacc',
    })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    inviteBtn.on('pointerdown', () => this.copyInviteLink());

    this.statusText = this.add.text(w / 2, 58, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffcc00',
    }).setOrigin(0.5, 0);
  }

  private buildPlayersColumn(): void {
    this.add.text(32, 100, 'PLAYERS', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#446688',
      letterSpacing: 2,
    });
    this.playersList = this.add.text(32, 122, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      lineSpacing: 6,
    });
  }

  private buildChatColumn(w: number): void {
    const chatX = w / 2 - 20;
    this.add.text(chatX, 100, 'CHAT', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#446688',
      letterSpacing: 2,
    });
    this.chatLog = this.add.text(chatX, 122, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#aabbcc',
      lineSpacing: 4,
      wordWrap: { width: w - chatX - 40 },
    });

    // Chat input row at the bottom of the chat area.
    this.chatInputText = this.add.text(chatX, this.scale.height - 110, '> _', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffffff',
      backgroundColor: '#15233a',
      padding: { left: 6, right: 6, top: 4, bottom: 4 },
    });
  }

  private buildMapPicker(): void {
    this.add.text(32, 300, 'MAP', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#446688',
      letterSpacing: 2,
    });
    this.mapDisplay = this.add.text(32, 322, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#00ff99',
    });
    this.renderMapDisplay();
  }

  private buildButtons(w: number, h: number): void {
    const startLabel = LobbyManager.isHost() ? '[ START GAME ]' : '[ READY ]';
    const startBtn = this.add.text(32, h - 60, startLabel, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#00ff99',
      backgroundColor: '#0a1020',
      padding: { left: 10, right: 10, top: 6, bottom: 6 },
    }).setInteractive({ useHandCursor: true });
    startBtn.on('pointerdown', () => this.onPrimaryAction());

    const leaveBtn = this.add.text(w - 32, h - 60, '[ LEAVE ]', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ff8888',
      backgroundColor: '#0a1020',
      padding: { left: 10, right: 10, top: 6, bottom: 6 },
    })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerdown', () => this.leaveLobby());
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private renderPlayers(users: LobbyUser[]): void {
    const lines = users.map((u) =>
      `• ${u.username}${u.isHost ? '  (HOST)' : ''}`,
    );
    if (users.length === 0) lines.push('(no players yet)');
    this.playersList.setText(lines.join('\n'));
  }

  private renderMetadata(md: Record<string, string>): void {
    if (!LobbyManager.isHost()) {
      // Non-host displays whatever the host picked.
      const title = md.mapTitle || '(waiting for host to pick map)';
      this.mapDisplay.setText(title);
    }
  }

  private renderMapDisplay(): void {
    if (LobbyManager.isHost()) {
      if (this.myMaps.length === 0) {
        this.mapDisplay.setText('(no published maps — publish one from the editor)');
        return;
      }
      const i = this.mapIndex >= 0 ? this.mapIndex : 0;
      const rec = this.myMaps[i];
      this.mapDisplay.setText(`◀  ${rec.title}  ▶`);
    } else {
      const title = LobbyManager.getMetadata('mapTitle') || '(waiting for host to pick map)';
      this.mapDisplay.setText(title);
    }
  }

  private appendChat(line: string): void {
    this.chatHistory.push(line);
    if (this.chatHistory.length > CHAT_HISTORY_LIMIT) {
      this.chatHistory.shift();
    }
    this.chatLog.setText(this.chatHistory.join('\n'));
  }

  // ── Interactions ───────────────────────────────────────────────────────────

  private registerKeys(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => this.leaveLobby());
    // Map cycling (host only)
    kb.on('keydown-LEFT',  () => this.cycleMap(-1));
    kb.on('keydown-RIGHT', () => this.cycleMap( 1));
    // Primary action
    kb.on('keydown-ENTER', () => this.onPrimaryAction());

    // Chat input — capture alphanumerics + space; backspace deletes.
    kb.on('keydown', (e: KeyboardEvent) => {
      // Ignore if already handled above
      if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;

      if (e.key === 'Backspace') {
        this.chatBuffer = this.chatBuffer.slice(0, -1);
        this.renderChatInput();
      } else if (e.key === 'Enter') {
        if (this.chatBuffer.trim().length > 0) {
          LobbyManager.sendChat(this.chatBuffer);
          this.chatBuffer = '';
          this.renderChatInput();
        }
      } else if (e.key.length === 1 && this.chatBuffer.length < 100) {
        this.chatBuffer += e.key;
        this.renderChatInput();
      }
    });
  }

  private renderChatInput(): void {
    this.chatInputText.setText('> ' + this.chatBuffer + '_');
  }

  private cycleMap(dir: number): void {
    if (!LobbyManager.isHost() || this.myMaps.length === 0) return;
    const n = this.myMaps.length;
    this.mapIndex = ((this.mapIndex < 0 ? 0 : this.mapIndex) + dir + n) % n;
    this.applyHostMapChoice();
    this.renderMapDisplay();
  }

  private applyHostMapChoice(): void {
    if (this.mapIndex < 0 || this.mapIndex >= this.myMaps.length) return;
    const rec = this.myMaps[this.mapIndex];
    LobbyManager.setMetadata('mapUgcId', rec.ugcId);
    LobbyManager.setMetadata('mapTitle', rec.title);
  }

  private async onPrimaryAction(): Promise<void> {
    if (!LobbyManager.isHost()) {
      this.toast('Waiting for host to start…');
      return;
    }
    const ugcId = LobbyManager.getMetadata('mapUgcId');
    if (!ugcId) {
      this.toast('Pick a map first (◀ / ▶).');
      return;
    }
    // GYM is a built-in level — no UGC download required on the host; the
    // metadata change alone is enough for every client to route into
    // MpGymScene.
    if (ugcId === LobbyScene.GYM_UGC_ID) {
      this.cachedUgcId   = ugcId;
      this.cachedMapData = null;
      LobbyManager.setMetadata('gameStarted', '1');
      return;
    }
    // UGC map — make sure it's cached locally before flipping the flag so
    // the host enters gameplay with the authoritative level bytes.
    if (!this.cachedMapData || this.cachedUgcId !== ugcId) {
      this.toast('Loading map…');
      const data = await downloadMap(ugcId);
      if (!data) {
        this.toast('Map download failed — see console.');
        return;
      }
      this.cachedMapData = data;
      this.cachedUgcId   = ugcId;
    }
    LobbyManager.setMetadata('gameStarted', '1');
  }

  /**
   * Reacts to lobby metadata changes.  Two jobs:
   *   1. If `mapUgcId` changes, pre-download the map in the background so
   *      clients have it ready before the host presses START.
   *   2. If `gameStarted === '1'` and the map is cached, transition into
   *      MpPlayScene.
   */
  private async handleMetadataForGameStart(md: Record<string, string>): Promise<void> {
    if (this.hasTransitioned) return;

    const ugcId = md.mapUgcId;

    // GYM has no UGC backing — route straight to MpGymScene when the host
    // flips gameStarted.  No download step required.
    if (ugcId === LobbyScene.GYM_UGC_ID) {
      if (md.gameStarted === '1') {
        this.hasTransitioned = true;
        this.scene.start('MpGymScene', {
          hostId: LobbyManager.hostId,
        });
      }
      return;
    }

    // UGC map — pre-download in the background so clients have the level
    // bytes by the time gameStarted flips.
    if (ugcId && ugcId !== this.cachedUgcId) {
      const data = await downloadMap(ugcId);
      if (data) {
        this.cachedMapData = data;
        this.cachedUgcId   = ugcId;
      }
    }

    if (md.gameStarted === '1' && this.cachedMapData) {
      this.hasTransitioned = true;
      this.scene.start('MpPlayScene', {
        levelName: md.mapTitle ?? 'mp',
        levelData: this.cachedMapData,
        hostId:    LobbyManager.hostId,
      });
    } else if (md.gameStarted === '1' && !this.cachedMapData) {
      this.toast('Waiting for map download…');
    }
  }

  private async copyInviteLink(): Promise<void> {
    const link = await LobbyManager.getInviteLink(true);
    if (link) this.toast('Invite link copied.');
    else      this.toast('Invite link unavailable.');
  }

  private async leaveLobby(): Promise<void> {
    await LobbyManager.leave();
    this.leaveToBrowser();
  }

  private leaveToBrowser(): void {
    this.scene.start('LobbyBrowserScene');
  }

  private toast(msg: string): void {
    this.statusText.setText(msg);
    this.time.delayedCall(3000, () => {
      if (this.statusText.text === msg) this.statusText.setText('');
    });
  }
}
