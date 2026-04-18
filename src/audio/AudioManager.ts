/**
 * AudioManager.ts — Composable, scene-agnostic audio service.
 *
 * Single instance lives on `game.registry['audio']`.  Any scene reaches it via
 * `getAudio(this)` (see helper below).
 *
 * Three volume buses, multiplied together:
 *   master   × music|sfx   × sound.defaultVolume = playback volume
 *
 * Music: one looping track at a time.  `playMusic(key)` crossfades from the
 * current track to the new one over AUDIO.crossfadeMs.
 * SFX:   fire-and-forget one-shots via Phaser's sound manager.  Cached
 *        BaseSound instances are tagged with a bus so live bus-volume changes
 *        can re-apply to whatever is currently playing.
 *
 * Missing assets never throw — `playSfx` / `playMusic` silently skip if the
 * audio cache doesn't have the key yet.  This lets call sites be wired before
 * audio files exist.
 */
import * as Phaser from 'phaser';
import { AUDIO, DEBUG, type SfxKey, type MusicKey } from '../config/gameConfig';

type BusName = 'music' | 'sfx';

interface BusState {
  volume: number;
  muted:  boolean;
}

interface PersistedState {
  master: number;
  music:  BusState;
  sfx:    BusState;
}

const SOUND_BUS_KEY = '__rlBus';

export class AudioManager {
  private readonly game: Phaser.Game;

  private masterVolume: number;
  private musicBus:     BusState;
  private sfxBus:       BusState;

  /** Currently-playing music instance, if any. */
  private currentMusic:    Phaser.Sound.BaseSound | null = null;
  private currentMusicKey: MusicKey | null               = null;

  constructor(game: Phaser.Game) {
    this.game = game;

    const persisted = AudioManager.loadPersisted();
    this.masterVolume = persisted?.master ?? AUDIO.buses.master.defaultVolume;
    this.musicBus = persisted?.music ?? {
      volume: AUDIO.buses.music.defaultVolume,
      muted:  false,
    };
    this.sfxBus = persisted?.sfx ?? {
      volume: AUDIO.buses.sfx.defaultVolume,
      muted:  false,
    };

    if (DEBUG.enabled) this.installMuteKeybinds();
  }

  /**
   * Global keydown listener for the [M] (music) and [N] (sfx) mute toggles.
   * Attached to window so it works across all scenes without per-scene wiring.
   * Only installed when DEBUG.enabled — shipping builds have no bindings.
   */
  private installMuteKeybinds(): void {
    const musicKey = DEBUG.keys.toggleMusicMute;
    const sfxKey   = DEBUG.keys.toggleSfxMute;
    window.addEventListener('keydown', (ev) => {
      const pressed = ev.key.toUpperCase();
      if (pressed === musicKey) {
        const muted = this.toggleMusicMute();
        console.info(`[audio] music ${muted ? 'muted' : 'unmuted'}`);
      } else if (pressed === sfxKey) {
        const muted = this.toggleSfxMute();
        console.info(`[audio] sfx ${muted ? 'muted' : 'unmuted'}`);
      }
    });
  }

  // ── SFX ──────────────────────────────────────────────────────────────────

  /**
   * Play a one-shot SFX by catalog key.  No-op if the asset hasn't loaded.
   * `config` overrides (rate, detune) are applied on top of bus volumes.
   */
  playSfx(
    key: SfxKey,
    config: Pick<Phaser.Types.Sound.SoundConfig, 'rate' | 'detune'> = {},
  ): void {
    const cfg    = AUDIO.sfx[key];
    const cached = this.cache().exists(cfg.key);
    if (!cached) return;

    const sound = this.game.sound.add(cfg.key);
    (sound as unknown as Record<string, unknown>)[SOUND_BUS_KEY] = 'sfx';
    // Auto-release: Phaser cleans up one-shots on COMPLETE if we pass a
    // SoundConfig to .play(), but chaining gives us per-clip volume too.
    sound.once(Phaser.Sound.Events.COMPLETE, () => sound.destroy());
    sound.play({
      volume: this.effectiveVolume('sfx', cfg.volume),
      ...config,
    });
  }

  // ── Music ────────────────────────────────────────────────────────────────

  /**
   * Start (or crossfade to) the given music track.  Calling with the same
   * key as the currently-playing track is a no-op.
   */
  playMusic(key: MusicKey): void {
    if (this.currentMusicKey === key && this.currentMusic?.isPlaying) return;

    const cfg = AUDIO.music[key];
    if (!this.cache().exists(cfg.key)) return;

    const incoming = this.game.sound.add(cfg.key, {
      loop: true,
      volume: 0,
    });
    (incoming as unknown as Record<string, unknown>)[SOUND_BUS_KEY] = 'music';

    const targetVolume = this.effectiveVolume('music', cfg.volume);
    incoming.play();
    this.fadeSound(incoming, targetVolume, AUDIO.crossfadeMs);

    // Crossfade out the previous track.
    const outgoing = this.currentMusic;
    if (outgoing) {
      this.fadeSound(outgoing, 0, AUDIO.crossfadeMs, () => {
        outgoing.stop();
        outgoing.destroy();
      });
    }

    this.currentMusic    = incoming;
    this.currentMusicKey = key;
  }

  /** Stop the current music with an optional fade-out. */
  stopMusic(fadeMs = AUDIO.crossfadeMs): void {
    const music = this.currentMusic;
    if (!music) return;
    this.currentMusic    = null;
    this.currentMusicKey = null;
    if (fadeMs <= 0) {
      music.stop();
      music.destroy();
      return;
    }
    this.fadeSound(music, 0, fadeMs, () => {
      music.stop();
      music.destroy();
    });
  }

  // ── Bus controls ─────────────────────────────────────────────────────────

  setMasterVolume(v: number): void {
    this.masterVolume = clamp01(v);
    this.refreshLiveVolumes();
    this.persist();
  }
  setMusicVolume(v: number): void {
    this.musicBus.volume = clamp01(v);
    this.refreshLiveVolumes();
    this.persist();
  }
  setSfxVolume(v: number): void {
    this.sfxBus.volume = clamp01(v);
    this.refreshLiveVolumes();
    this.persist();
  }

  toggleMusicMute(): boolean {
    this.musicBus.muted = !this.musicBus.muted;
    this.refreshLiveVolumes();
    this.persist();
    return this.musicBus.muted;
  }
  toggleSfxMute(): boolean {
    this.sfxBus.muted = !this.sfxBus.muted;
    this.refreshLiveVolumes();
    this.persist();
    return this.sfxBus.muted;
  }

  isMusicMuted(): boolean { return this.musicBus.muted; }
  isSfxMuted():   boolean { return this.sfxBus.muted; }

  // ── Internals ────────────────────────────────────────────────────────────

  private effectiveVolume(bus: BusName, clipVolume: number): number {
    const state = bus === 'music' ? this.musicBus : this.sfxBus;
    if (state.muted) return 0;
    return this.masterVolume * state.volume * clipVolume;
  }

  /**
   * Recompute volume on every active sound when a bus or master changes.
   * Looks up each sound's bus tag (set on play) to pick the right clip
   * default from the catalog.
   */
  private refreshLiveVolumes(): void {
    const allSounds = (this.game.sound as unknown as {
      sounds: Phaser.Sound.BaseSound[];
    }).sounds;

    for (const sound of allSounds) {
      const bus = (sound as unknown as Record<string, unknown>)[SOUND_BUS_KEY] as BusName | undefined;
      if (!bus) continue;
      const clipVolume = this.clipVolumeFor(bus, sound.key);
      const target = this.effectiveVolume(bus, clipVolume);
      (sound as unknown as { volume: number }).volume = target;
    }
  }

  /**
   * Recover the catalog `volume` field for a live sound by reverse-looking-up
   * its Phaser cache key in AUDIO.sfx / AUDIO.music.  Returns 1 if not found
   * (safe default — bus volumes still apply).
   */
  private clipVolumeFor(bus: BusName, phaserKey: string): number {
    const catalog = bus === 'music' ? AUDIO.music : AUDIO.sfx;
    for (const entry of Object.values(catalog)) {
      if (entry.key === phaserKey) return entry.volume;
    }
    return 1;
  }

  private fadeSound(
    sound: Phaser.Sound.BaseSound,
    to: number,
    duration: number,
    onComplete?: () => void,
  ): void {
    const scene = this.firstActiveScene();
    if (!scene) {
      (sound as unknown as { volume: number }).volume = to;
      onComplete?.();
      return;
    }
    scene.tweens.add({
      targets:  sound,
      volume:   to,
      duration,
      onComplete,
    });
  }

  private firstActiveScene(): Phaser.Scene | null {
    const scenes = this.game.scene.getScenes(true);
    return scenes.length > 0 ? scenes[0] : null;
  }

  private cache(): Phaser.Cache.BaseCache {
    return this.game.cache.audio;
  }

  private persist(): void {
    try {
      const data: PersistedState = {
        master: this.masterVolume,
        music:  { ...this.musicBus },
        sfx:    { ...this.sfxBus },
      };
      window.localStorage.setItem(AUDIO.persistKey, JSON.stringify(data));
    } catch {
      // Private browsing / disabled storage — settings just won't survive reload.
    }
  }

  private static loadPersisted(): PersistedState | null {
    try {
      const raw = window.localStorage.getItem(AUDIO.persistKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedState;
      // Minimal shape validation — trust numbers, default bools.
      return {
        master: clamp01(parsed.master ?? AUDIO.buses.master.defaultVolume),
        music: {
          volume: clamp01(parsed.music?.volume ?? AUDIO.buses.music.defaultVolume),
          muted:  Boolean(parsed.music?.muted),
        },
        sfx: {
          volume: clamp01(parsed.sfx?.volume ?? AUDIO.buses.sfx.defaultVolume),
          muted:  Boolean(parsed.sfx?.muted),
        },
      };
    } catch {
      return null;
    }
  }
}

// ─── Scene helper ───────────────────────────────────────────────────────────

/**
 * Fetch the AudioManager from the game registry.  Returns a null-object stub
 * if the manager hasn't been installed yet (pre-BootScene.create), so call
 * sites never have to null-check.
 */
export function getAudio(scene: Phaser.Scene): AudioManager {
  const mgr = scene.registry.get('audio') as AudioManager | undefined;
  return mgr ?? STUB_AUDIO;
}

/** No-op fallback used before BootScene installs the real manager. */
const STUB_AUDIO: AudioManager = Object.freeze({
  playSfx:          () => {},
  playMusic:        () => {},
  stopMusic:        () => {},
  setMasterVolume:  () => {},
  setMusicVolume:   () => {},
  setSfxVolume:     () => {},
  toggleMusicMute:  () => false,
  toggleSfxMute:    () => false,
  isMusicMuted:     () => false,
  isSfxMuted:       () => false,
}) as unknown as AudioManager;

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
