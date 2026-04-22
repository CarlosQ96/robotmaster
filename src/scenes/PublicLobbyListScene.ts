/**
 * PublicLobbyListScene.ts — Browsable list of public Wavedash lobbies.
 *
 * Replaces the original `prompt()`-based flow in LobbyBrowserScene.  This
 * scene fetches lobbies via LobbyManager, paints them as a scrollable list,
 * and lets the user pick one with the arrow keys + Enter / Z, or click a
 * row directly.  ESC returns to the browser menu.
 *
 * Keys:
 *   ↑ / ↓      navigate
 *   ENTER / Z  join the highlighted lobby
 *   R          refresh the list
 *   ESC        back to LobbyBrowserScene
 */
import * as Phaser from 'phaser';
import { LobbyManager } from '../net/lobbyManager';
import type { LobbyInfo } from '../net/wavedash.d';

const ROW_HEIGHT = 28;
const LIST_TOP   = 110;
const PAGE_SIZE  = 12;

export class PublicLobbyListScene extends Phaser.Scene {
  private lobbies:       LobbyInfo[] = [];
  private selectedIndex: number      = 0;
  private scrollOffset:  number      = 0;

  private rowTexts:      Phaser.GameObjects.Text[] = [];
  private statusText!:   Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'PublicLobbyListScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    this.buildBackground(width, height);
    this.buildHeader(width);
    this.buildList();
    this.buildHint(width, height);
    this.registerKeys();

    this.statusText = this.add.text(width / 2, 80, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffcc00',
    }).setOrigin(0.5, 0);

    void this.refresh();
  }

  // ── Layout ─────────────────────────────────────────────────────────────

  private buildBackground(w: number, h: number): void {
    this.add.rectangle(w / 2, h / 2, w, h, 0x0d0f14);
    const g = this.add.graphics();
    g.lineStyle(1, 0x1a3355, 0.6);
    g.strokeRect(16, 16, w - 32, h - 32);
  }

  private buildHeader(w: number): void {
    this.add.text(w / 2, 32, 'PUBLIC LOBBIES', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#00ff99',
    }).setOrigin(0.5, 0);
    this.add.rectangle(w / 2, 68, 280, 1, 0x1a3355);
  }

  private buildList(): void {
    for (let i = 0; i < PAGE_SIZE; i++) {
      const t = this.add.text(48, LIST_TOP + i * ROW_HEIGHT, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
      });
      t.setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        const idx = this.scrollOffset + i;
        if (idx < this.lobbies.length) {
          this.selectedIndex = idx;
          this.confirm();
        }
      });
      this.rowTexts.push(t);
    }
    this.renderRows();
  }

  private buildHint(w: number, h: number): void {
    this.add.text(w / 2, h - 28,
      '↑ ↓  NAVIGATE     ENTER / Z  JOIN     R  REFRESH     ESC  BACK', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#1a3355',
        letterSpacing: 2,
      }).setOrigin(0.5);
  }

  // ── Data ──────────────────────────────────────────────────────────────

  private async refresh(): Promise<void> {
    this.statusText.setText('FETCHING…');
    const lobbies = await LobbyManager.listPublic();
    this.lobbies = lobbies;
    this.selectedIndex = 0;
    this.scrollOffset  = 0;
    this.statusText.setText(
      lobbies.length === 0
        ? 'No public lobbies right now.  Try QUICK HOST.'
        : '',
    );
    this.renderRows();
  }

  private renderRows(): void {
    for (let i = 0; i < PAGE_SIZE; i++) {
      const idx = this.scrollOffset + i;
      const row = this.rowTexts[i];
      if (idx >= this.lobbies.length) {
        row.setText('');
        return;
      }
      const l = this.lobbies[idx];
      const selected = idx === this.selectedIndex;
      const prefix   = selected ? '▶  ' : '   ';
      const label    = `${l.lobbyId}  (${l.playerCount}/${l.maxPlayers})`;
      row.setText(prefix + label);
      row.setColor(selected ? '#00ff99' : '#88aacc');
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────

  private registerKeys(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.navigate(-1));
    kb.on('keydown-DOWN',  () => this.navigate( 1));
    kb.on('keydown-ENTER', () => this.confirm());
    kb.on('keydown-Z',     () => this.confirm());
    kb.on('keydown-R',     () => void this.refresh());
    kb.on('keydown-ESC',   () => this.back());
  }

  private navigate(dir: number): void {
    if (this.lobbies.length === 0) return;
    const n = this.lobbies.length;
    this.selectedIndex = Math.max(0, Math.min(n - 1, this.selectedIndex + dir));
    // Keep the selection inside the visible window.
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + PAGE_SIZE) {
      this.scrollOffset = this.selectedIndex - PAGE_SIZE + 1;
    }
    this.renderRows();
  }

  private async confirm(): Promise<void> {
    if (this.lobbies.length === 0) return;
    const target = this.lobbies[this.selectedIndex];
    if (!target) return;
    this.statusText.setText(`JOINING ${target.lobbyId}…`);
    const ok = await LobbyManager.joinById(target.lobbyId);
    if (ok) {
      this.scene.start('LobbyScene', { lobbyId: target.lobbyId });
    } else {
      this.statusText.setText('JOIN FAILED — lobby may have closed.');
    }
  }

  private back(): void {
    this.scene.start('LobbyBrowserScene');
  }
}
