#!/usr/bin/env python3
"""Tempo — trace an isolated (transparent-background) character pose PNG into
a real vector Lottie animation, instead of embedding the raster image.

Why this exists: an early "Tempo Coach" pass embedded a cropped PNG straight
into a Lottie file and just animated its transform. The founder correctly
pointed out that animating a raster image can't fix a soft/low-res source —
motion doesn't add resolution. This script traces the flat-color silhouette
into actual vector shape paths instead, which render crisp at any size and
happen to clean up JPEG compression noise along the edges as a side effect of
the simplification step.

Requires (not part of the mobile app's own dependencies — this is a one-off
build-time tool, run manually, not from JS/Metro):
    pip install pillow numpy scipy scikit-image

Input: a PNG with the pose already isolated on a transparent background (see
assets/lottie/README.md for how the current `coach/*.json` poses were cut out
of the founder's reference sheet — color-distance classification + a
connected-component size filter to strip stray marks/artifacts, tuned by eye
per source image; that step isn't generalized here since crop boxes and color
thresholds are source-image-specific).

Usage:
    python scripts/vectorize-coach-pose.py <input.png> <bob|pop> <output.json>

Styles:
    bob — a continuous, seamless idle loop (gentle vertical bob + slight
          rotation sway). Frame 0 and the last frame are identical, so
          `loop={true}` in TempoLottie never stutters.
    pop — a one-shot scale-up entrance with a small overshoot, then holds.
          Use with `loop={false}`.
"""

import json
import sys

import numpy as np
from PIL import Image
from skimage import measure

TEMPO_BLUE = [0.0, 0.404, 0.965]  # 0-1 range — Tempo's dark-mode primary, #4E8BFF

def trace_pose(path, tolerance=1.6, min_len=8):
    """Isolated-PNG alpha mask -> a list of simplified (x, y) point-loops, one per
    disconnected silhouette piece (head, torso, each limb, etc.)."""
    im = Image.open(path)
    arr = np.array(im)
    alpha = arr[..., 3]
    mask = alpha > 128
    contours = measure.find_contours(mask.astype(float), 0.5)
    polys = []
    for c in contours:
        if len(c) < min_len:
            continue
        simplified = measure.approximate_polygon(c, tolerance=tolerance)
        pts = [(float(p[1]), float(p[0])) for p in simplified]  # (row,col) -> (x,y)
        if len(pts) >= 2 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) >= 3:
            polys.append(pts)
    return im.size, polys

def catmull_rom_tangents(pts, smooth=1 / 6):
    """Symmetric in/out tangent handles per vertex so straight polygon segments
    render as smooth curves (round heads/hands) instead of visible facets."""
    n = len(pts)
    tangents = []
    for i in range(n):
        prev = np.array(pts[(i - 1) % n])
        nxt = np.array(pts[(i + 1) % n])
        t = (nxt - prev) * smooth
        tangents.append((float(t[0]), float(t[1])))
    return tangents

def poly_to_lottie_path(pts, smooth=1 / 6):
    """Bodymovin 'sh' path shape: v=vertices, i/o=relative in/out tangent handles."""
    tangents = catmull_rom_tangents(pts, smooth)
    n = len(pts)
    v = [[round(x, 2), round(y, 2)] for x, y in pts]
    o = [[round(tangents[i][0], 2), round(tangents[i][1], 2)] for i in range(n)]
    i_ = [[round(-tangents[i][0], 2), round(-tangents[i][1], 2)] for i in range(n)]
    return {"c": True, "i": i_, "o": o, "v": v}

def build_pose_shape_group(polys, nm="pose"):
    items = []
    for idx, poly in enumerate(polys):
        path = poly_to_lottie_path(poly)
        items.append({"ty": "sh", "nm": f"path{idx}", "ks": {"a": 0, "k": path}})
    items.append({
        "ty": "fl", "nm": "fill",
        "c": {"a": 0, "k": TEMPO_BLUE + [1]},
        "o": {"a": 0, "k": 100},
    })
    items.append({
        "ty": "tr",
        "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]},
        "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 100},
    })
    return {"ty": "gr", "nm": nm, "it": items}

def bob_loop_layer(w, h, shape_group, op=60):
    """Continuous, seamless idle bob + slight sway — frame 0 state == frame op state."""
    cx, cy = w / 2, h / 2
    return {
        "ddd": 0, "ind": 1, "ty": 4, "nm": "coach", "sr": 1,
        "ks": {
            "o": {"a": 0, "k": 100},
            "r": {"a": 1, "k": [
                {"t": 0, "s": [0], "e": [-3]},
                {"t": op * 0.5, "s": [-3], "e": [0]},
                {"t": op, "s": [0]},
            ]},
            "p": {"a": 1, "k": [
                {"t": 0, "s": [cx, cy], "e": [cx, cy - h * 0.035]},
                {"t": op * 0.5, "s": [cx, cy - h * 0.035], "e": [cx, cy]},
                {"t": op, "s": [cx, cy]},
            ]},
            "a": {"a": 0, "k": [cx, cy, 0]},
            "s": {"a": 0, "k": [100, 100, 100]},
        },
        "ao": 0,
        "shapes": [shape_group],
        "ip": 0, "op": op, "st": 0, "bm": 0,
    }

def pop_celebrate_layer(w, h, shape_group, op=50):
    """One-shot scale-up entrance with a small overshoot, then holds — no loop."""
    cx, cy = w / 2, h / 2
    return {
        "ddd": 0, "ind": 1, "ty": 4, "nm": "coach", "sr": 1,
        "ks": {
            "o": {"a": 1, "k": [{"t": 0, "s": [0], "e": [100]}, {"t": 8, "s": [100]}]},
            "r": {"a": 0, "k": 0},
            "p": {"a": 0, "k": [cx, cy]},
            "a": {"a": 0, "k": [cx, cy, 0]},
            "s": {"a": 1, "k": [
                {"t": 0, "s": [55, 55, 100], "e": [115, 115, 100]},
                {"t": 16, "s": [115, 115, 100], "e": [100, 100, 100]},
                {"t": 26, "s": [100, 100, 100]},
            ]},
        },
        "ao": 0,
        "shapes": [shape_group],
        "ip": 0, "op": op, "st": 0, "bm": 0,
    }

def build_lottie(w, h, layer, fr=30, nm="TempoCoach"):
    return {
        "v": "5.9.6", "fr": fr, "ip": 0, "op": layer["op"], "w": w, "h": h,
        "nm": nm, "ddd": 0, "assets": [], "layers": [layer], "markers": [],
    }

def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    src, style, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    if style not in ("bob", "pop"):
        print("style must be 'bob' or 'pop'")
        sys.exit(1)
    (w, h), polys = trace_pose(src)
    print(src, "size", (w, h), "components", len(polys), [len(p) for p in polys])
    shape_group = build_pose_shape_group(polys, nm="pose")
    layer = bob_loop_layer(w, h, shape_group) if style == "bob" else pop_celebrate_layer(w, h, shape_group)
    doc = build_lottie(w, h, layer, nm="TempoCoach")
    with open(out_path, "w") as f:
        json.dump(doc, f)
    print("wrote", out_path)

if __name__ == "__main__":
    main()
