"""
measure_frames.py — Sprite frame pixel-bounds analyser for Robot Lords.

Reads a spritesheet PNG and reports, for each requested frame index,
the exact bounding box of non-transparent pixels.  Output is used to
set physics body size/offset values in gameConfig.ts.

Requires: Pillow  (pip install Pillow)

Usage
-----
  python3 engineer-tools/measure_frames.py [options]

Options
-------
  --sheet   PATH     Path to the spritesheet PNG.
                     Default: public/assets/Reactor_Man_Asset_Pack/
                              Reactor_Man_Player/PNG/
                              Playable_Character_Default_Colors.png
  --fw      N        Frame width in pixels.  Default: 48
  --fh      N        Frame height in pixels. Default: 48 (full image height)
  --frames  N N ...  Frame indices to inspect.  Default: all frames.
  --alpha   N        Alpha threshold for "non-transparent". Default: 10

Examples
--------
  # Inspect all frames of the default sheet
  python3 engineer-tools/measure_frames.py

  # Inspect only frames 0, 2, 12, 15, 16 of a specific sheet
  python3 engineer-tools/measure_frames.py --frames 0 2 12 15 16

  # Inspect a different sheet with 24px-wide frames
  python3 engineer-tools/measure_frames.py --sheet public/assets/.../Other.png --fw 24

Output columns
--------------
  Frame  : 0-based frame index
  x      : min-x .. max-x of non-transparent pixels within the frame (local)
  y      : min-y .. max-y  (local, 0 = top of image)
  w / h  : pixel dimensions of the visible area
  L/R/T/B: transparent margins on each edge

How to use the numbers in gameConfig.ts
----------------------------------------
Standing body example (frame 0):
  Character at x=16-39, y=16-39 in a 48×48 frame.
  Feet at y=39 (8px transparent below).

  body.height  = feet_y - desired_top  = 39 - 9  = 30
  body.offsetY = desired_top           = 9
  body.width   = approx character width (tighter than actual for fair hitbox)
  body.offsetX = center the body on character center
               = char_center_x - body.width/2
               = 27 - 10 = 17

Mirror offsetX when sprite is flipped (setFlipX=true):
  mirroredOffsetX = frameWidth - offsetX - bodyWidth
                  = 48 - 17 - 20 = 11

This is what Player.ts:syncBodyOffset() computes automatically.
"""

import sys
import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not installed.  Run: pip install Pillow", file=sys.stderr)
    sys.exit(1)

DEFAULT_SHEET = (
    "public/assets/Reactor_Man_Asset_Pack/"
    "Reactor_Man_Player/PNG/"
    "Playable_Character_Default_Colors.png"
)


def measure(img: Image.Image, frame_idx: int, fw: int, fh: int, alpha_thresh: int) -> dict:
    pixels = img.load()
    fx = frame_idx * fw
    min_x = fw;  max_x = -1
    min_y = fh;  max_y = -1

    for y in range(fh):
        for x in range(fx, fx + fw):
            if pixels[x, y][3] > alpha_thresh:
                lx = x - fx
                if lx < min_x: min_x = lx
                if lx > max_x: max_x = lx
                if y < min_y:  min_y = y
                if y > max_y:  max_y = y

    if max_x < 0:
        return {"frame": frame_idx, "empty": True}

    return {
        "frame":   frame_idx,
        "empty":   False,
        "x_min":   min_x,
        "x_max":   max_x,
        "y_min":   min_y,
        "y_max":   max_y,
        "w":       max_x - min_x + 1,
        "h":       max_y - min_y + 1,
        "left":    min_x,
        "right":   fw - 1 - max_x,
        "top":     min_y,
        "bottom":  fh - 1 - max_y,
        "cx":      (min_x + max_x) / 2,
        "cy":      (min_y + max_y) / 2,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure sprite frame pixel bounds.")
    parser.add_argument("--sheet",  default=DEFAULT_SHEET)
    parser.add_argument("--fw",     type=int, default=48, metavar="N")
    parser.add_argument("--fh",     type=int, default=None, metavar="N")
    parser.add_argument("--frames", type=int, nargs="*", metavar="N")
    parser.add_argument("--alpha",  type=int, default=10, metavar="N")
    args = parser.parse_args()

    path = Path(args.sheet)
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        sys.exit(1)

    img = Image.open(path).convert("RGBA")
    img_w, img_h = img.size
    fh = args.fh if args.fh is not None else img_h
    num_frames = img_w // args.fw

    print(f"Sheet : {path}")
    print(f"Size  : {img_w} × {img_h} px")
    print(f"Frames: {num_frames}  ({args.fw} × {fh} px each)")
    print()

    frame_list = args.frames if args.frames is not None else list(range(num_frames))

    header = f"{'Frame':>6}  {'x-range':>12}  {'y-range':>12}  {'w':>4}  {'h':>4}  {'L':>4}  {'R':>4}  {'T':>4}  {'B':>4}  {'cx':>6}  {'cy':>6}"
    print(header)
    print("─" * len(header))

    for fi in frame_list:
        if fi < 0 or fi >= num_frames:
            print(f"{fi:>6}  (out of range)")
            continue
        r = measure(img, fi, args.fw, fh, args.alpha)
        if r["empty"]:
            print(f"{fi:>6}  (empty)")
        else:
            print(
                f"{fi:>6}  "
                f"{r['x_min']:>4}-{r['x_max']:<4}      "
                f"{r['y_min']:>4}-{r['y_max']:<4}      "
                f"{r['w']:>4}  {r['h']:>4}  "
                f"{r['left']:>4}  {r['right']:>4}  "
                f"{r['top']:>4}  {r['bottom']:>4}  "
                f"{r['cx']:>6.1f}  {r['cy']:>6.1f}"
            )


if __name__ == "__main__":
    main()
