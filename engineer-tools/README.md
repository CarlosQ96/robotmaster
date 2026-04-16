# Engineer Tools

Scripts used during development of Robot Lords to make data-driven decisions
about sprites, physics bodies, and asset configuration.  Run from the project
root directory.

---

## measure_frames.py

**What it does**  
Reads a spritesheet PNG and prints the exact bounding box of non-transparent
pixels for each requested frame.  Output is used to set `body.offsetX/Y` and
`body.width/height` in `src/config/gameConfig.ts`.

**Requires**
```
pip install Pillow
```

**Usage**
```bash
# Inspect all frames of the default player sheet
python3 engineer-tools/measure_frames.py

# Inspect specific frames only
python3 engineer-tools/measure_frames.py --frames 0 2 12 15 16

# Different sheet or frame size
python3 engineer-tools/measure_frames.py \
  --sheet public/assets/Glacier_Man_Asset_Pack/.../Sheet.png \
  --fw 48
```

**Output columns**

| Column | Meaning |
|--------|---------|
| Frame  | 0-based frame index |
| x-range | min–max x of visible pixels (local to frame) |
| y-range | min–max y of visible pixels |
| w / h  | width / height of visible area |
| L / R  | transparent pixels on left / right edge |
| T / B  | transparent pixels on top / bottom edge |
| cx / cy | visual centre of character within frame |

**How to use output in `gameConfig.ts`**

```
Standing body (from frame 0 idle measurement):
  character at x=16-39, y=16-39.  Feet at y=39 (B=8 px).

  body.height  = feet_y - desired_top  = 39 - 9  = 30
  body.offsetY = desired_top           = 9
  body.offsetX = char_center_x - body.width/2 = 27 - 10 = 17
  body.width   = 20   (tighter than actual 24 for fair hitbox)

Mirror offsetX when facing right (handled automatically by Player.syncBodyOffset):
  mirroredOffsetX = frameWidth - offsetX - bodyWidth = 48 - 17 - 20 = 11
```

**When to re-run**
- After changing `PLAYER.frameWidth` in `gameConfig.ts`
- After swapping the player spritesheet
- Whenever the body feels misaligned (floating, hitbox too big/small)

---

## Adding new tools

Drop any `.py`, `.ts`, or shell script here with a matching entry in this
README.  Keep tools runnable from the project root so paths resolve cleanly.
