/**
 * LevelPickerScene — pick an existing level or create a new one before
 * entering the editor.
 *
 * Flow:
 *   Title → LevelPicker → EditorScene (with { levelName, isNew? } init data)
 *
 * Populated via `GET /api/levels` (dev-only endpoint defined in vite.config.ts).
 *
 * Controls:
 *   ↑ / ↓      Navigate
 *   Z / ENTER  Open selected level (or prompt for new name on [ NEW LEVEL ])
 *   ESC / X    Back to Title
 *
 * The "[ NEW LEVEL ]" row prompts for a name and starts the editor with
 * { levelName, isNew: true } — the editor creates a blank in-memory level
 * and saves it on first [S]/Ctrl-S, at which point the dev server writes
 * the new file under public/levels/.
 */
import * as Phaser from 'phaser';
import { DISPLAY } from '../config/gameConfig';

interface LevelEntry {
  name:  string;
  size:  number;
  mtime: number;
}

const NEW_ROW: LevelEntry = { name: '[ NEW LEVEL ]', size: 0, mtime: 0 };

const ROW_HEIGHT = 22;
const LIST_TOP   = 140;

export class LevelPickerScene extends Phaser.Scene {
  private entries: LevelEntry[] = [NEW_ROW];
  private selectedIndex = 0;
  private rowTexts:    Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;

  constructor() { super({ key: 'LevelPickerScene' }); }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    this.buildBackground(width, height, cx);
    this.buildTitle(cx);
    this.buildStatus(cx, height);
    this.buildHint(cx, height);
    this.registerKeys();

    this.rebuildList();
    this.fetchLevels();
  }

  // ── Chrome ────────────────────────────────────────────────────────────────
  private buildBackground(w: number, h: number, cx: number): void {
    this.add.rectangle(cx, h / 2, w, h, 0x0d0f14);
    for (let y = 0; y < h; y += 4) {
      this.add.rectangle(cx, y, w, 1, 0x000000, 0.15);
    }
    const g = this.add.graphics();
    g.lineStyle(1, 0x1a3355, 0.6);
    g.strokeRect(16, 16, w - 32, h - 32);
  }

  private buildTitle(cx: number): void {
    this.add.text(cx, 48, 'SELECT LEVEL', {
      fontFamily: 'monospace',
      fontSize:   '28px',
      color:      '#00ff99',
    }).setOrigin(0.5);

    this.add.text(cx, 84, 'CHOOSE A LEVEL TO EDIT OR CREATE A NEW ONE', {
      fontFamily: 'monospace',
      fontSize:   '10px',
      color:      '#2a5a7a',
      letterSpacing: 3,
    }).setOrigin(0.5);

    this.add.rectangle(cx, 108, 320, 1, 0x1a3355);
  }

  private buildStatus(cx: number, height: number): void {
    this.statusText = this.add
      .text(cx, height - 60, 'LOADING...', {
        fontFamily: 'monospace',
        fontSize:   '10px',
        color:      '#446688',
      })
      .setOrigin(0.5);
  }

  private buildHint(cx: number, height: number): void {
    this.add.text(cx, height - 28,
      '↑ ↓  NAVIGATE     Z / ENTER  OPEN     ESC  BACK',
      {
        fontFamily: 'monospace',
        fontSize:   '10px',
        color:      '#1a3355',
        letterSpacing: 2,
      },
    ).setOrigin(0.5);
  }

  private registerKeys(): void {
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.navigate(-1));
    kb.on('keydown-DOWN',  () => this.navigate(1));
    kb.on('keydown-ENTER', () => this.confirm());
    kb.on('keydown-Z',     () => this.confirm());
    kb.on('keydown-ESC',   () => this.scene.start('TitleScene'));
    kb.on('keydown-X',     () => this.scene.start('TitleScene'));
  }

  // ── List rendering ───────────────────────────────────────────────────────
  private async fetchLevels(): Promise<void> {
    try {
      const res = await fetch('/api/levels');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LevelEntry[];
      this.entries = [NEW_ROW, ...data];
      this.statusText.setText(`${data.length} SAVED LEVEL${data.length === 1 ? '' : 'S'}`);
      this.rebuildList();
    } catch (err) {
      this.statusText
        .setText(`LIST FAILED: ${(err as Error).message}`)
        .setColor('#ff3344');
    }
  }

  private rebuildList(): void {
    for (const t of this.rowTexts) t.destroy();
    this.rowTexts = [];

    const cx = DISPLAY.width / 2;
    this.entries.forEach((entry, i) => {
      const label = this.rowLabel(entry);
      const text = this.add
        .text(cx, LIST_TOP + i * ROW_HEIGHT, label, {
          fontFamily: 'monospace',
          fontSize:   '14px',
        })
        .setOrigin(0.5);
      this.rowTexts.push(text);
    });

    if (this.selectedIndex >= this.entries.length) {
      this.selectedIndex = 0;
    }
    this.refreshDisplay();
  }

  private rowLabel(entry: LevelEntry): string {
    if (entry === NEW_ROW) return entry.name;
    return entry.name;
  }

  private refreshDisplay(): void {
    this.rowTexts.forEach((text, i) => {
      const selected = i === this.selectedIndex;
      const entry    = this.entries[i];
      const prefix   = selected ? '▶  ' : '   ';
      text.setText(prefix + this.rowLabel(entry));
      text.setColor(selected ? '#00ff99' : '#446688');
    });
  }

  // ── Input handlers ───────────────────────────────────────────────────────
  private navigate(dir: number): void {
    const count = this.entries.length;
    if (count === 0) return;
    this.selectedIndex = (this.selectedIndex + dir + count) % count;
    this.refreshDisplay();
  }

  private confirm(): void {
    const entry = this.entries[this.selectedIndex];
    if (!entry) return;

    if (entry === NEW_ROW) {
      const raw = window.prompt('Level name (letters, digits, _ or -)');
      if (raw === null) return;
      const name = raw.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        this.statusText.setText('INVALID NAME — A-Z, 0-9, _ and - ONLY').setColor('#ff3344');
        return;
      }
      const clash = this.entries.some((e) => e !== NEW_ROW && e.name === name);
      if (clash) {
        this.statusText.setText(`ALREADY EXISTS: ${name}`).setColor('#ff3344');
        return;
      }
      this.scene.start('EditorScene', { levelName: name, isNew: true });
      return;
    }

    this.scene.start('EditorScene', { levelName: entry.name, isNew: false });
  }
}
