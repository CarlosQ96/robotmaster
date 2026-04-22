/**
 * TitleScene.ts — Main title screen.
 *
 * Flow:
 *   Boot → Title → CharacterSelectScene (carries destination key)
 *
 * Controls:
 *   ↑ / ↓      Navigate menu
 *   Z / ENTER  Confirm selection
 *
 * Menu items:
 *   TRAINING GYM   → destination 'GymScene'
 *   MAIN GAME      → destination 'GameScene' (placeholder — not yet implemented)
 */
import * as Phaser from 'phaser';
import { getAudio } from '../audio/AudioManager';

interface MenuItem {
  label: string;
  destination: string;
  available: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'TRAINING GYM', destination: 'GymScene',           available: true  },
  { label: 'MULTIPLAYER',  destination: 'LobbyBrowserScene',  available: true  },
  { label: 'LEVEL EDITOR', destination: 'LevelPickerScene',   available: true  },
];

const STYLE_BASE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  fontSize: '18px',
};

export class TitleScene extends Phaser.Scene {
  private selectedIndex = 0;
  private menuTexts: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width  / 2;
    const cy = height / 2;

    this.selectedIndex = 0;
    this.menuTexts     = [];

    this.buildBackground(width, height, cx, cy);
    this.buildTitle(cx, cy);
    this.buildMenu(cx, cy);
    this.buildHint(cx, height);
    this.registerKeys();

    getAudio(this).playMusic('title');
  }

  // ── Background ─────────────────────────────────────────────────────────────
  private buildBackground(w: number, h: number, cx: number, cy: number): void {
    this.add.rectangle(cx, cy, w, h, 0x0d0f14);

    // Subtle horizontal scan-lines
    for (let y = 0; y < h; y += 4) {
      this.add.rectangle(cx, y, w, 1, 0x000000, 0.15);
    }

    // Decorative corner accents (NES border style)
    const g = this.add.graphics();
    g.lineStyle(1, 0x1a3355, 0.6);
    g.strokeRect(16, 16, w - 32, h - 32);
    g.lineStyle(1, 0x0d2040, 0.4);
    g.strokeRect(20, 20, w - 40, h - 40);
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  private buildTitle(cx: number, cy: number): void {
    // Shadow layer
    this.add.text(cx + 3, cy - 115, 'ROBOT LORDS', {
      fontFamily: 'monospace',
      fontSize: '52px',
      color: '#001122',
    }).setOrigin(0.5);

    // Main title
    this.add.text(cx, cy - 118, 'ROBOT LORDS', {
      fontFamily: 'monospace',
      fontSize: '52px',
      color: '#00ff99',
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(cx, cy - 70, 'A RETRO ACTION PLATFORMER', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#2a5a7a',
      letterSpacing: 4,
    }).setOrigin(0.5);

    // Divider
    this.add.rectangle(cx, cy - 50, 320, 1, 0x1a3355);
  }

  // ── Menu ───────────────────────────────────────────────────────────────────
  private buildMenu(cx: number, cy: number): void {
    MENU_ITEMS.forEach((_item, i) => {
      const y = cy - 10 + i * 44;
      const text = this.add.text(cx, y, '', STYLE_BASE).setOrigin(0.5);
      this.menuTexts.push(text);
    });

    this.refreshDisplay();
  }

  private refreshDisplay(): void {
    MENU_ITEMS.forEach((item, i) => {
      const selected  = i === this.selectedIndex;
      const available = item.available;
      const prefix    = selected ? '▶  ' : '   ';
      const suffix    = available ? '' : '   (COMING SOON)';

      this.menuTexts[i].setText(prefix + item.label + suffix);

      if (!available) {
        this.menuTexts[i].setColor('#223344');
      } else if (selected) {
        this.menuTexts[i].setColor('#00ff99');
      } else {
        this.menuTexts[i].setColor('#446688');
      }
    });
  }

  // ── Hint ───────────────────────────────────────────────────────────────────
  private buildHint(cx: number, height: number): void {
    this.add.text(cx, height - 28, '↑ ↓  NAVIGATE     Z / ENTER  SELECT', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#1a3355',
      letterSpacing: 2,
    }).setOrigin(0.5);
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  private registerKeys(): void {
    this.input.keyboard!.on('keydown-UP',    () => this.navigate(-1));
    this.input.keyboard!.on('keydown-DOWN',  () => this.navigate(1));
    this.input.keyboard!.on('keydown-ENTER', () => this.confirm());
    this.input.keyboard!.on('keydown-Z',     () => this.confirm());
  }

  private navigate(dir: number): void {
    const count = MENU_ITEMS.length;
    // Skip unavailable items when cycling
    let next = (this.selectedIndex + dir + count) % count;
    let tries = 0;
    while (!MENU_ITEMS[next].available && tries < count) {
      next = (next + dir + count) % count;
      tries++;
    }
    if (MENU_ITEMS[next].available) {
      this.selectedIndex = next;
      this.refreshDisplay();
    }
  }

  private confirm(): void {
    const item = MENU_ITEMS[this.selectedIndex];
    if (!item.available) return;
    // Editor + multiplayer lobby skip the character select — they have their
    // own entry flow (editor picks palette from its own UI; multiplayer uses
    // the host's map/palette metadata).
    if (item.destination === 'LevelPickerScene' ||
        item.destination === 'LobbyBrowserScene') {
      this.scene.start(item.destination);
      return;
    }
    this.scene.start('CharacterSelectScene', { destination: item.destination });
  }
}
