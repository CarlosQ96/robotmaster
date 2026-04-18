# Audio System

Composable, reusable audio service built on Phaser 4's WebAudio sound manager.
Three volume buses, one global `AudioManager` singleton, scene-agnostic access.

## Files

| File | Role |
|------|------|
| [src/config/gameConfig.ts](../src/config/gameConfig.ts) | `AUDIO` catalog (sfx + music) and mute keys in `DEBUG.keys` |
| [src/audio/AudioManager.ts](../src/audio/AudioManager.ts) | Singleton with master/music/sfx buses, crossfade, `localStorage` persistence, `[M]` / `[N]` mute keybinds |
| [src/scenes/BootScene.ts](../src/scenes/BootScene.ts) | Auto-preloads every catalog key (webm + mp3 fallback), swallows 404s, installs manager on `game.registry` |
| [src/scenes/TitleScene.ts](../src/scenes/TitleScene.ts) | Plays `music-title` |
| [src/scenes/GymScene.ts](../src/scenes/GymScene.ts) | Plays `music-gym`; wires shoot / charged / full-charged / hit SFX |
| [src/entities/Player.ts](../src/entities/Player.ts) | Plays `jump` (3 sites), `slide` (2 sites), `hurt` in `takeDamage` |

## Asset layout

Drop files here. The preload expects both formats and auto-picks per browser
(webm on Chrome/Firefox, mp3 on Safari — provide either or both).

```text
public/assets/audio/
  sfx/
    sfx-jump.webm          sfx-jump.mp3
    sfx-slide.webm         sfx-slide.mp3
    sfx-shoot.webm         sfx-shoot.mp3
    sfx-shoot-charged.*    sfx-shoot-full.*
    sfx-hit.*              sfx-enemy-hit.*
    sfx-hurt.*
  music/
    music-title.webm       music-title.mp3
    music-gym.webm         music-gym.mp3
```

Until a file exists, every call silently no-ops and logs one
`[audio] missing asset (<key>)` warning per boot — no crashes, no behavior
change. Drop the file in, reload, it just works.

## Volume model

```text
effective volume  =  master  ×  bus[music|sfx]  ×  clip.volume
```

- **Per-clip defaults** (`clip.volume`) live in
  [`AUDIO.sfx[...]`](../src/config/gameConfig.ts) / `AUDIO.music[...]` — tune
  these until raw playback sounds even before the player touches anything.
- **Bus volumes + mute state** persist under
  `localStorage['robot-lords:audio']` and are loaded on construction.

## API

```ts
import { getAudio } from '../audio/AudioManager';

getAudio(scene).playSfx('jump');
getAudio(scene).playSfx('slide', { rate: 1.1 });     // per-call overrides
getAudio(scene).playMusic('title');                   // crossfades from prior
getAudio(scene).stopMusic(250);                       // fade-out ms

getAudio(scene).setMasterVolume(0.8);
getAudio(scene).setMusicVolume(0.6);
getAudio(scene).setSfxVolume(0.9);

getAudio(scene).toggleMusicMute();
getAudio(scene).toggleSfxMute();
```

`getAudio()` returns a safe no-op stub before `BootScene.create()` runs, so
call sites never need null checks.

## Debug keybinds

Active only when `DEBUG.enabled`. Installed on `window` by the manager, so
they work across every scene with no per-scene wiring.

| Key | Action |
|-----|--------|
| `M` | Toggle music bus mute |
| `N` | Toggle SFX bus mute |

## Design notes

- **One sound manager.** `scene.sound` is a plugin reference to the single
  `game.sound` instance — there's no per-scene audio state in Phaser. We own
  the bus/crossfade layer ourselves; everything routes through `game.sound`.
- **Music is tracked, SFX is fire-and-forget.** `playMusic` keeps a handle to
  the current looping track so it can tween-fade out when a new track starts.
  `playSfx` builds a one-shot and destroys it on `COMPLETE`.
- **Mobile unlock is automatic.** Phaser resumes the WebAudio context on the
  first canvas touch/click. The title screen requires a keypress anyway, so
  this is free.
- **Missing assets don't break builds.** The loader's `FILE_LOAD_ERROR`
  handler filters audio files to warnings, and `playSfx` / `playMusic`
  both check `game.cache.audio.exists(key)` before playing. This lets hooks
  be wired before the audio files exist.
- **Bus changes apply live.** Setting master/music/sfx volume iterates every
  currently-playing sound and recomputes its effective volume from the tag
  stored on the sound instance at play time.

## Adding a new sound

1. Add an entry to `AUDIO.sfx` or `AUDIO.music` in
   [gameConfig.ts](../src/config/gameConfig.ts) with a unique `key` and
   per-clip default `volume`.
2. Drop `<key>.webm` and/or `<key>.mp3` into `public/assets/audio/sfx/` (or
   `music/`).
3. Call `getAudio(scene).playSfx('<entryName>')` at the trigger site. The
   `SfxKey` / `MusicKey` types are derived from the catalog — TypeScript will
   catch typos at compile time.

No loader changes needed — BootScene iterates the catalog.
