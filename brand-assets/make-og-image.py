"""Build web/og-image.png — the 1200x630 link preview card.

The site declares twitter:card = summary_large_image but pointed og:image at
tempo-logo.png, a 512x512 square. Every wide-card surface (Reddit, iMessage,
Slack, Twitter, LinkedIn) therefore rendered a cropped or letterboxed logo
instead of a preview. This builds a real card at the 1.91:1 ratio those surfaces
actually want.

Uses a REAL app capture, never a mockup — same rule as the store frames.

Run:  python brand-assets/make-og-image.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONTS = os.path.join(HERE, 'fonts')
# The raw app capture, NOT a store frame — store frames carry marketing
# headline text baked in, which would appear as stray words on this card.
SHOT = os.path.join(ROOT, 'web', 'img', 'shots', 'home.webp')
OUT = os.path.join(ROOT, 'web', 'og-image.png')

W, H = 1200, 630
SS = 2  # supersample, then downscale — keeps text and the device edge crisp

# Pulled from the app's own dark palette so the card matches the product.
BG = (15, 16, 22)
GLOW = (28, 46, 96)
INK = (243, 244, 247)
MUTED = (150, 158, 172)
BLUE = (78, 139, 255)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size * SS)


def main():
    card = Image.new('RGB', (W * SS, H * SS), BG)
    d = ImageDraw.Draw(card)

    # Soft radial-ish wash behind the device, drawn as concentric ellipses so it
    # reads as depth rather than a flat panel.
    cx, cy = int(W * 0.74) * SS, int(H * 0.52) * SS
    for i in range(60, 0, -1):
        r = int(i * 11 * SS)
        t = i / 60.0
        col = tuple(int(BG[c] + (GLOW[c] - BG[c]) * (1 - t) * 0.5) for c in range(3))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)

    # ── Left column: wordmark, headline, supporting line ──────────────────────
    x = 72 * SS
    d.text((x, 92 * SS), 'arclo', font=font('Inter-800.ttf', 40), fill=INK)
    d.ellipse([x + 128 * SS, 116 * SS, x + 144 * SS, 132 * SS], fill=BLUE)

    d.text((x, 196 * SS), 'Training that fits', font=font('Inter-800.ttf', 54), fill=INK)
    d.text((x, 262 * SS), 'your real week.', font=font('Inter-800.ttf', 54), fill=BLUE)

    body = [
        'Builds your plan, then schedules every',
        'session into a gap you actually have.',
    ]
    y = 352 * SS
    for line in body:
        d.text((x, y), line, font=font('Inter-400.ttf', 25), fill=MUTED)
        y += 38 * SS

    d.text((x, 468 * SS), 'Free on iPhone and Android',
           font=font('Inter-600.ttf', 22), fill=BLUE)

    # ── Right: the real capture inside a drawn bezel, tilted slightly ─────────
    shot = Image.open(SHOT).convert('RGB')
    target_h = int(500 * SS)
    ratio = target_h / shot.height
    shot = shot.resize((max(1, int(shot.width * ratio)), target_h), Image.LANCZOS)

    bezel = int(9 * SS)
    radius = int(34 * SS)
    dev_w, dev_h = shot.width + bezel * 2, shot.height + bezel * 2

    # Device drawn on its own transparent layer so the rotation antialiases the
    # whole phone — bezel, screen and corners — as one object.
    layer = Image.new('RGBA', card.size, (0, 0, 0, 0))
    dev = Image.new('RGBA', (dev_w, dev_h), (0, 0, 0, 0))
    ImageDraw.Draw(dev).rounded_rectangle(
        [0, 0, dev_w - 1, dev_h - 1], radius=radius, fill=(26, 28, 36, 255))

    # Round the screenshot's own corners so it sits inside the bezel cleanly.
    inner_r = radius - bezel
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, shot.width - 1, shot.height - 1], radius=max(2, inner_r), fill=255)
    dev.paste(shot, (bezel, bezel), mask)

    left = int(W * 0.575) * SS
    top = (H * SS - dev_h) // 2
    layer.paste(dev, (left, top), dev)
    layer = layer.rotate(
        -7, resample=Image.BICUBIC,
        center=(left + dev_w // 2, top + dev_h // 2))
    card.paste(layer, (0, 0), layer)

    card = card.resize((W, H), Image.LANCZOS)
    card.save(OUT, 'PNG', optimize=True)
    print('wrote %s  %s  %dKB' % (OUT, card.size, os.path.getsize(OUT) // 1024))


main()
