/**
 * LobbyBrowserScene.ts — Multiplayer entry screen.
 *
 * Phase 1 STUB.  The three buttons exist, the scene routes to them, but no
 * actual networking happens yet.  Phase 2 fills in the bodies of
 * `quickHost`, `joinById`, `browsePublic` by calling the forthcoming
 * `lobbyManager` module.
 *
 * Flow:
 *   TitleScene  ──MULTIPLAYER──►  LobbyBrowserScene
 *                                  ├── QUICK HOST         → (TBD Phase 2)
 *                                  ├── JOIN BY CODE       → (TBD Phase 2)
 *                                  ├── BROWSE PUBLIC      → (TBD Phase 2)
 *                                  └── BACK               → TitleScene
 *
 * Keys:  ↑↓ navigate, ENTER / Z confirm, ESC back.
 */
import * as Phaser from 'phaser';
import { WavedashBridge } from '../net/WavedashBridge';
import { LobbyManager } from '../net/lobbyManager';
import { getPlayerName } from '../net/identity';

interface MenuItem {
  label: string;
  action: 'quickHost' | 'joinById' | 'browsePublic' | 'back';
}

const MENU: MenuItem[] = [
  { label: 'QUICK HOST',    action: 'quickHost'    },
  { label: 'JOIN BY CODE',  action: 'joinById'     },
  { label: 'BROWSE PUBLIC', action: 'browsePublic' },
  { label: 'BACK',          action: 'back'         },
];

export class LobbyBrowserScene extends Phaser.Scene {
  private selectedIndex = 0;
  private menuTexts: Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'LobbyBrowserScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width  / 2;
    const cy = height / 2;

    this.selectedIndex = 0;
    this.menuTexts     = [];

    this.buildBackground(width, height, cx, cy);
    this.buildHeader(cx, cy);
    this.buildMenu(cx, cy);
    this.buildHint(cx, height);
    this.registerKeys();
    this.maybeAutoJoinFromUrl();
  }

  /** When this page was opened with `?join=<lobbyId>` (e.g. an invite link),
   *  skip the menu and route straight into that lobby.  We strip the query
   *  param after reading so refreshing the tab doesn't re-join automatically. */
  private maybeAutoJoinFromUrl(): void {
    if (typeof window === 'undefined' || !WavedashBridge.isPresent()) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('join');
    if (!id) return;
    // Clear the param so successive reloads / browser back don't retrigger.
    params.delete('join');
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
    this.toast(`Joining invited lobby ${id}…`);
    void this.doJoin(id);
  }

  // ── Background ─────────────────────────────────────────────────────────────
  private buildBackground(w: number, h: number, cx: number, cy: number): void {
    this.add.rectangle(cx, cy, w, h, 0x0d0f14);
    const g = this.add.graphics();
    g.lineStyle(1, 0x1a3355, 0.6);
    g.strokeRect(16, 16, w - 32, h - 32);
    g.lineStyle(1, 0x0d2040, 0.4);
    g.strokeRect(20, 20, w - 40, h - 40);
  }

  // ── Header + identity ──────────────────────────────────────────────────────
  private buildHeader(cx: number, cy: number): void {
    this.add.text(cx, cy - 140, 'MULTIPLAYER', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#00ff99',
    }).setOrigin(0.5);

    this.add.rectangle(cx, cy - 110, 280, 1, 0x1a3355);

    const playerName = getPlayerName(false);
    const sdkLabel = WavedashBridge.isPresent() ? 'ONLINE' : 'OFFLINE (dev)';
    const sdkColor = WavedashBridge.isPresent() ? '#00ff99' : '#ffaa44';

    this.add.text(cx, cy - 88, `PILOT: ${playerName}`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#446688',
    }).setOrigin(0.5);

    this.add.text(cx, cy - 70, sdkLabel, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: sdkColor,
      letterSpacing: 3,
    }).setOrigin(0.5);

    // Status line used for Phase-1 "not yet implemented" toasts.
    this.statusText = this.add.text(cx, cy + 140, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffcc00',
    }).setOrigin(0.5);
  }

  // ── Menu ───────────────────────────────────────────────────────────────────
  private buildMenu(cx: number, cy: number): void {
    MENU.forEach((_item, i) => {
      const y = cy - 20 + i * 34;
      const text = this.add.text(cx, y, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
      }).setOrigin(0.5);
      this.menuTexts.push(text);
    });
    this.refreshDisplay();
  }

  private refreshDisplay(): void {
    MENU.forEach((item, i) => {
      const selected = i === this.selectedIndex;
      const prefix   = selected ? '▶  ' : '   ';
      this.menuTexts[i].setText(prefix + item.label);
      this.menuTexts[i].setColor(selected ? '#00ff99' : '#446688');
    });
  }

  // ── Hint ───────────────────────────────────────────────────────────────────
  private buildHint(cx: number, height: number): void {
    this.add.text(cx, height - 28,
      '↑ ↓  NAVIGATE     ENTER / Z  SELECT     ESC  BACK', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#1a3355',
        letterSpacing: 2,
      }).setOrigin(0.5);
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  private registerKeys(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.navigate(-1));
    kb.on('keydown-DOWN',  () => this.navigate( 1));
    kb.on('keydown-ENTER', () => this.confirm());
    kb.on('keydown-Z',     () => this.confirm());
    kb.on('keydown-ESC',   () => this.back());
  }

  private navigate(dir: number): void {
    const n = MENU.length;
    this.selectedIndex = (this.selectedIndex + dir + n) % n;
    this.refreshDisplay();
  }

  private confirm(): void {
    const action = MENU[this.selectedIndex].action;
    switch (action) {
      case 'back':         this.back();               break;
      case 'quickHost':    void this.quickHost();     break;
      case 'joinById':     this.joinById();           break;
      case 'browsePublic': this.browsePublic();       break;
    }
  }

  private back(): void {
    this.scene.start('TitleScene');
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private async quickHost(): Promise<void> {
    if (!WavedashBridge.isPresent()) {
      this.toast('SDK not available — run this from wavedash.com to host.');
      return;
    }
    this.toast('Creating lobby…');
    const id = await LobbyManager.quickHost('public', 4);
    if (!id) {
      this.toast('Failed to create lobby.');
      return;
    }
    this.scene.start('LobbyScene', { lobbyId: id });
  }

  private joinById(): void {
    if (!WavedashBridge.isPresent()) {
      this.toast('SDK not available — run this from wavedash.com to join.');
      return;
    }
    // Simple prompt-based entry — good enough for hackathon.  Upgrade to a
    // proper in-scene input later.
    const code = typeof prompt === 'function' ? prompt('Enter lobby code:', '') : null;
    if (!code) return;
    this.toast(`Joining ${code}…`);
    void this.doJoin(code);
  }

  private async doJoin(code: string): Promise<void> {
    const ok = await LobbyManager.joinById(code);
    if (!ok) {
      this.toast(`Join failed — lobby '${code}' not found.`);
      return;
    }
    this.scene.start('LobbyScene', { lobbyId: code });
  }

  private browsePublic(): void {
    if (!WavedashBridge.isPresent()) {
      this.toast('SDK not available — run this from wavedash.com to browse.');
      return;
    }
    // Hand off to the dedicated list scene; it owns the refresh + selection UX.
    this.scene.start('PublicLobbyListScene');
  }

  private toast(message: string): void {
    this.statusText.setText(message);
    this.time.delayedCall(3000, () => {
      if (this.statusText.text === message) this.statusText.setText('');
    });
  }
}
