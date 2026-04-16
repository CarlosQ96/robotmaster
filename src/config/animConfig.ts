/**
 * animConfig.ts — Player animation frame definitions.
 *
 * Frame layout (verified by user):
 *
 *  Sheet: Playable_Character_Default_Colors.png
 *  1200 × 48 px | frameWidth: 24 | frameHeight: 48 | 50 frames (0 – 49)
 *
 *  ┌──────┬───────┬──────────────────────────────────────┐
 *  │ IDX  │ ANIM  │ DESCRIPTION                          │
 *  ├──────┼───────┼──────────────────────────────────────┤
 *  │  0-1 │ idle  │ breathing / blink cycle (loops)      │
 *  │  2-5 │ run   │ walk / run cycle (loops)              │
 *  │  6-7 │ shoot │ standing shoot (one-shot)             │
 *  │ 8-11 │ shoot_run │ shoot while running (loops)      │
 *  │   12 │ jump  │ airborne pose (single frame, holds)  │
 *  │   13 │ jump_shoot │ airborne + shoot (one-shot)     │
 *  │   14 │ take_damage │ hit reaction (one-shot)        │
 *  │   15 │ crouch │ crouching idle (holds)              │
 *  │   16 │ slide │ slide / dash (one-shot)              │
 *  │ 17-18│ climb │ stair-climb cycle (loops)            │
 *  │   19 │ climb_to_idle │ climb → stand (one-shot)    │
 *  │   20 │ climb_shoot_right │ shoot right from climb  │
 *  │   21 │ climb_shoot_left  │ shoot left from climb   │
 *  │ 22-24│ death │ death sequence; holds on frame 24   │
 *  └──────┴───────┴──────────────────────────────────────┘
 *
 *  Sprite faces LEFT by default.  Code flips when moving right.
 *  Tip: use [F] in-game to pause + step through frames.
 */

export interface AnimDef {
  /** First frame index (0-based, inclusive) */
  start: number;
  /** Last frame index (inclusive) */
  end: number;
  /** Frames per second */
  frameRate: number;
  /** -1 = loop forever, 0 = play once then stop on last frame */
  repeat: number;
}

/**
 * Keyed animation definitions for the player_default spritesheet.
 * Keys here become Phaser animation keys — keep them lowercase strings.
 */
export const PLAYER_ANIMS: Readonly<Record<string, AnimDef>> = {
  idle:              { start: 0,  end: 1,  frameRate: 6,  repeat: -1 },
  run:               { start: 2,  end: 5,  frameRate: 9,  repeat: -1 },
  shoot:             { start: 6,  end: 7,  frameRate: 5,  repeat: 0  },  // 2 frames @ 5fps = ~400ms
  shoot_run:         { start: 8,  end: 11, frameRate: 8,  repeat: -1 },  // 4 frames @ 8fps = 500ms/cycle
  jump:              { start: 12, end: 12, frameRate: 10, repeat: -1 },
  fall:              { start: 12, end: 12, frameRate: 10, repeat: -1 },
  jump_shoot:        { start: 13, end: 13, frameRate: 10, repeat: 0  },
  take_damage:       { start: 14, end: 14, frameRate: 10, repeat: 0  },
  crouch:            { start: 15, end: 15, frameRate: 8,  repeat: -1 },
  slide:             { start: 16, end: 16, frameRate: 5,  repeat: 0  },
  climb:             { start: 17, end: 18, frameRate: 8,  repeat: -1 },
  climb_to_idle:     { start: 19, end: 19, frameRate: 12, repeat: 0  },
  climb_shoot_right: { start: 20, end: 20, frameRate: 12, repeat: 0  },
  climb_shoot_left:  { start: 21, end: 21, frameRate: 12, repeat: 0  },
  death:             { start: 22, end: 24, frameRate: 8,  repeat: 0  },
  // ── Placeholder — replace with real charge frames when available ──────────
  // Hold-to-charge pose: reuses frame 6 (shoot start) as a visual stand-in.
  charge:            { start: 6,  end: 6,  frameRate: 4,  repeat: -1 },
} as const;

/** Type-safe animation key constants — import these instead of raw strings */
export const ANIM_KEY = {
  IDLE:              'idle',
  RUN:               'run',
  SHOOT:             'shoot',
  SHOOT_RUN:         'shoot_run',
  JUMP:              'jump',
  FALL:              'fall',
  JUMP_SHOOT:        'jump_shoot',
  TAKE_DAMAGE:       'take_damage',
  CROUCH:            'crouch',
  SLIDE:             'slide',
  CLIMB:             'climb',
  CLIMB_TO_IDLE:     'climb_to_idle',
  CLIMB_SHOOT_RIGHT: 'climb_shoot_right',
  CLIMB_SHOOT_LEFT:  'climb_shoot_left',
  DEATH:             'death',
  CHARGE:            'charge',
} as const;

export type AnimKey = (typeof ANIM_KEY)[keyof typeof ANIM_KEY];
