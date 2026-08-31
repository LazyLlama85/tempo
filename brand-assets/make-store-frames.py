#!/usr/bin/env python3
"""
Build Arclo's App Store / Play Store screenshot frames.

The design is the marketing-framed layout the founder picked on 2026-08-30:
logo lockup, a two-line headline (white line + blue line), a grey sub-line,
a rail of icon bullets, and a tilted iPhone bleeding off the right edge over
a big blue arc.

The rule this script exists to enforce: the phone screen is ALWAYS a real
device capture, composited in. Nothing inside the device frame is drawn,
regenerated or invented. The first version of these frames was produced by an
image model, which redrew the UI and, among other drift, invented a
"Recovery by muscle" grid (Chest 92%, Back 78%...) that does not exist in the
app and duplicated a "W4" label in the volume chart. Screenshots that don't
show the real app are an App Review 2.3.3 problem and this app has already
been rejected five times.

Sources: mobile/../asc-check screenshots are the founder's own captures; by
default this reads the ones currently live on the Play listing, downloaded to
SRC below. Output is 1284x2778 (iPhone 6.7"), which App Store Connect accepts
as-is and Play is happy with.

Usage:  python brand-assets/make-store-frames.py [outdir]
"""
import os
import sys
import math
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, 'fonts')
SRC = os.environ.get(
    'ARCLO_SHOTS',
    'C:/Users/jacob/AppData/Local/Temp/claude/C--dev-tempo/'
    'f510d236-c244-422f-97cd-919c4fcc359e/scratchpad/play-live')
MARK = os.path.join(HERE, '..', 'mobile', 'assets', 'images', 'tempo-mark.png')

W, H = 1284, 2778
SS = 2  # supersample factor for the device layer

BG = (8, 9, 13)
BLUE = (37, 122, 255)
BLUE_DEEP = (18, 62, 168)
WHITE = (255, 255, 255)
GREY = (150, 157, 170)
CHIP = (23, 26, 33)


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, 'Inter-%d.ttf' % weight), size)


# ─────────────────────────── helpers ───────────────────────────

def find_coeffs(dst, src):
    """Coefficients for Image.transform(PERSPECTIVE): maps dst -> src."""
    import numpy as np
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    A = np.array(m, dtype=float)
    B = np.array(sum([list(p) for p in src], []), dtype=float)
    return np.linalg.solve(A, B)


def rounded_mask(size, radius, ss=1):
    m = Image.new('L', (size[0] * ss, size[1] * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size[0] * ss - 1, size[1] * ss - 1], radius=radius * ss, fill=255)
    if ss > 1:
        m = m.resize(size, Image.LANCZOS)
    return m


def build_device(shot_path, screen_w, screen_h):
    """A phone: real screenshot inside a bezel, on a transparent layer."""
    bezel = int(screen_w * 0.035)
    radius = int(screen_w * 0.135)
    dw, dh = screen_w + bezel * 2, screen_h + bezel * 2

    layer = Image.new('RGBA', (dw, dh), (0, 0, 0, 0))

    # Body: near-black with a faint vertical sheen so the frame reads as metal.
    body = Image.new('RGBA', (dw, dh), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for y in range(dh):
        t = y / dh
        v = int(46 - 24 * t)
        bd.line([(0, y), (dw, y)], fill=(v, v + 2, v + 6, 255))
    body.putalpha(rounded_mask((dw, dh), radius, ss=2))
    layer.alpha_composite(body)

    # A hairline highlight around the body edge.
    hi = Image.new('RGBA', (dw, dh), (0, 0, 0, 0))
    ImageDraw.Draw(hi).rounded_rectangle(
        [1, 1, dw - 2, dh - 2], radius=radius, outline=(255, 255, 255, 60), width=3)
    layer.alpha_composite(hi)

    # The real capture, cropped to the screen aspect (top-anchored: the top of
    # each screen is where its point is).
    shot = Image.open(shot_path).convert('RGB')
    target = screen_w / screen_h
    if shot.width / shot.height > target:
        nw = int(shot.height * target)
        shot = shot.crop(((shot.width - nw) // 2, 0, (shot.width - nw) // 2 + nw, shot.height))
    else:
        nh = int(shot.width / target)
        shot = shot.crop((0, 0, shot.width, nh))
    shot = shot.resize((screen_w, screen_h), Image.LANCZOS).convert('RGBA')
    shot.putalpha(rounded_mask((screen_w, screen_h), int(radius * 0.82), ss=2))
    layer.alpha_composite(shot, (bezel, bezel))

    return layer


def tilt(layer, angle_deg=-10.0, taper=0.035):
    """Rotate the device and taper its left edge, so it leans into the page."""
    w, h = layer.size
    pad = int(max(w, h) * 0.45)
    canvas = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(layer, (pad, pad))
    cw, ch = canvas.size

    a = math.radians(angle_deg)
    cx, cy = cw / 2, ch / 2

    def rot(x, y):
        dx, dy = x - cx, y - cy
        return (cx + dx * math.cos(a) - dy * math.sin(a),
                cy + dx * math.sin(a) + dy * math.cos(a))

    tl, tr = (pad, pad), (pad + w, pad)
    bl, br = (pad, pad + h), (pad + w, pad + h)
    # Taper: shrink the left edge vertically about its own centre.
    def shrink(p_top, p_bot, k):
        mx = (p_top[0] + p_bot[0]) / 2, (p_top[1] + p_bot[1]) / 2
        return ((mx[0] + (p_top[0] - mx[0]) * (1 - k), mx[1] + (p_top[1] - mx[1]) * (1 - k)),
                (mx[0] + (p_bot[0] - mx[0]) * (1 - k), mx[1] + (p_bot[1] - mx[1]) * (1 - k)))
    (tl, bl) = shrink(tl, bl, taper)

    dst = [rot(*p) for p in (tl, tr, br, bl)]
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    coeffs = find_coeffs(dst, src)
    out = layer.transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    return out


# ─────────────────────────── icons ───────────────────────────

def icon(name, size, colour=BLUE):
    """Small line glyphs, drawn rather than fetched, at 4x then downsampled."""
    s = size * 4
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lw = max(2, int(s * 0.075))
    c = colour + (255,)
    m = s * 0.2  # margin

    if name == 'calendar':
        d.rounded_rectangle([m, m * 1.35, s - m, s - m], radius=s * 0.09, outline=c, width=lw)
        d.line([(m, m * 2.55), (s - m, m * 2.55)], fill=c, width=lw)
        d.line([(m * 1.7, m * 0.75), (m * 1.7, m * 1.9)], fill=c, width=lw)
        d.line([(s - m * 1.7, m * 0.75), (s - m * 1.7, m * 1.9)], fill=c, width=lw)
        for gx in range(3):
            for gy in range(2):
                x = m * 1.55 + gx * (s - m * 3.1) / 2
                y = m * 3.25 + gy * (s - m * 4.6) / 1.6
                d.ellipse([x - lw * 0.7, y - lw * 0.7, x + lw * 0.7, y + lw * 0.7], fill=c)
    elif name == 'dumbbell':
        d.line([(m * 0.9, s / 2), (s - m * 0.9, s / 2)], fill=c, width=lw)
        for x in (m * 1.35, s - m * 1.35):
            d.line([(x, m * 1.5), (x, s - m * 1.5)], fill=c, width=lw)
        for x in (m * 0.75, s - m * 0.75):
            d.line([(x, m * 2.1), (x, s - m * 2.1)], fill=c, width=lw)
    elif name == 'bolt':
        d.polygon([(s * 0.56, m * 0.7), (s * 0.3, s * 0.55), (s * 0.47, s * 0.55),
                   (s * 0.42, s - m * 0.7), (s * 0.7, s * 0.43), (s * 0.52, s * 0.43)], fill=c)
    elif name == 'target':
        d.ellipse([m, m, s - m, s - m], outline=c, width=lw)
        d.ellipse([s * 0.38, s * 0.38, s * 0.62, s * 0.62], outline=c, width=lw)
        d.line([(s / 2, m * 0.3), (s / 2, m * 1.2)], fill=c, width=lw)
        d.line([(s / 2, s - m * 1.2), (s / 2, s - m * 0.3)], fill=c, width=lw)
        d.line([(m * 0.3, s / 2), (m * 1.2, s / 2)], fill=c, width=lw)
        d.line([(s - m * 1.2, s / 2), (s - m * 0.3, s / 2)], fill=c, width=lw)
    elif name == 'chart':
        for i, hgt in enumerate((0.34, 0.62, 0.46)):
            x = m + i * (s - m * 2) / 3 + (s - m * 2) / 12
            d.rounded_rectangle([x, s - m - (s - m * 2) * hgt, x + (s - m * 2) / 6, s - m],
                                radius=lw * 0.6, fill=c)
    elif name == 'trend':
        d.line([(m, s - m * 1.35), (s * 0.42, s * 0.55), (s * 0.6, s * 0.7), (s - m, m * 1.5)],
               fill=c, width=lw, joint='curve')
        d.polygon([(s - m, m * 1.5), (s - m * 1.9, m * 1.35), (s - m * 0.85, m * 2.4)], fill=c)
    elif name == 'clock':
        d.ellipse([m, m, s - m, s - m], outline=c, width=lw)
        d.line([(s / 2, s / 2), (s / 2, s * 0.29)], fill=c, width=lw)
        d.line([(s / 2, s / 2), (s * 0.68, s * 0.58)], fill=c, width=lw)
    elif name == 'list':
        for i in range(3):
            y = m * 1.3 + i * (s - m * 2.6) / 2
            d.ellipse([m, y - lw * 0.8, m + lw * 1.6, y + lw * 0.8], fill=c)
            d.line([(m * 2.4, y), (s - m, y)], fill=c, width=lw)
    elif name == 'heart':
        r = s * 0.17
        d.ellipse([s * 0.5 - r * 2, s * 0.3 - r, s * 0.5, s * 0.3 + r], outline=c, width=lw)
        d.ellipse([s * 0.5, s * 0.3 - r, s * 0.5 + r * 2, s * 0.3 + r], outline=c, width=lw)
        d.line([(s * 0.5 - r * 1.98, s * 0.33), (s * 0.5, s - m)], fill=c, width=lw)
        d.line([(s * 0.5 + r * 1.98, s * 0.33), (s * 0.5, s - m)], fill=c, width=lw)
    elif name == 'person':
        d.ellipse([s * 0.36, m * 0.9, s * 0.64, m * 0.9 + s * 0.28], outline=c, width=lw)
        d.arc([s * 0.24, s * 0.52, s * 0.76, s * 1.12], 180, 360, fill=c, width=lw)
    elif name == 'pencil':
        d.line([(m * 1.1, s - m * 1.1), (s - m * 1.2, m * 1.2)], fill=c, width=lw)
        d.polygon([(m * 0.75, s - m * 0.75), (m * 1.9, s - m * 1.0), (m * 1.0, s - m * 1.9)], fill=c)
    elif name == 'walk':
        d.ellipse([s * 0.44, m * 0.75, s * 0.62, m * 0.75 + s * 0.18], fill=c)
        d.line([(s * 0.53, s * 0.34), (s * 0.47, s * 0.6)], fill=c, width=lw)
        d.line([(s * 0.47, s * 0.6), (s * 0.36, s - m * 0.8)], fill=c, width=lw)
        d.line([(s * 0.47, s * 0.6), (s * 0.66, s - m * 0.9)], fill=c, width=lw)
        d.line([(s * 0.53, s * 0.42), (s * 0.71, s * 0.5)], fill=c, width=lw)
        d.line([(s * 0.53, s * 0.42), (s * 0.33, s * 0.52)], fill=c, width=lw)
    elif name == 'shuffle':
        d.line([(m, m * 1.4), (s - m * 1.4, s - m * 1.4)], fill=c, width=lw)
        d.line([(m, s - m * 1.4), (s * 0.42, s * 0.58)], fill=c, width=lw)
        d.line([(s * 0.62, s * 0.42), (s - m * 1.4, m * 1.4)], fill=c, width=lw)
        d.polygon([(s - m * 0.7, m * 1.15), (s - m * 1.9, m * 0.95), (s - m * 1.6, m * 2.1)], fill=c)
        d.polygon([(s - m * 0.7, s - m * 1.15), (s - m * 1.9, s - m * 0.95), (s - m * 1.6, s - m * 2.1)], fill=c)
    return im.resize((size, size), Image.LANCZOS)


# ─────────────────────────── layout ───────────────────────────

def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ''
    for w_ in words:
        t = (cur + ' ' + w_).strip()
        if draw.textlength(t, font=fnt) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def strip_background(n):
    """One continuous background for the whole set, drawn once and sliced.

    The point of rendering a strip rather than n separate canvases: in both
    store carousels the screenshots sit side by side, so a background that
    continues across the seams makes the set read as one wide composition
    instead of six unrelated cards. Every competitor listing studied on
    2026-08-30 (Fitbod, Hevy, Alpha Progression, Boostcamp, Ladder, Caliber)
    does some version of this.
    """
    SW = W * n
    im = Image.new('RGB', (SW, H), BG)

    # A single blue sweep travelling the length of the strip, low on the left
    # and rising to the right, so no two panels get the same slice of it.
    arc = Image.new('RGBA', (SW, H), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arc)
    r = int(SW * 0.62)
    cx, cy = int(SW * 0.46), int(H * 1.62)
    thick = int(W * 0.26)
    ad.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BLUE_DEEP + (255,))
    ad.ellipse([cx - r + thick, cy - r + thick, cx + r - thick, cy + r - thick],
               fill=(0, 0, 0, 0))
    arc = arc.filter(ImageFilter.GaussianBlur(W * 0.012))
    # Keep the sweep out of the top third: the headline block lives there and
    # white-on-blue at that size loses contrast fast. Ramp the arc in between
    # 0.38H and 0.56H so it emerges behind the devices rather than the type.
    ramp = Image.new('L', (SW, H), 0)
    rd = ImageDraw.Draw(ramp)
    y0, y1 = int(H * 0.38), int(H * 0.56)
    for yy in range(H):
        if yy <= y0:
            v = 0
        elif yy >= y1:
            v = 255
        else:
            v = int(255 * (yy - y0) / (y1 - y0))
        rd.line([(0, yy), (SW, yy)], fill=v)
    a = arc.getchannel('A').point(lambda v: int(v * 0.85))
    arc.putalpha(ImageChops.multiply(a, ramp))
    im = Image.alpha_composite(im.convert('RGBA'), arc).convert('RGB')

    # A faint lift under each panel so a device never floats on flat black.
    halo = Image.new('RGBA', (SW, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hr = int(W * 0.52)
    for i in range(n):
        hx = int((i + 0.62) * W)
        hd.ellipse([hx - hr, int(H * 0.66) - hr, hx + hr, int(H * 0.66) + hr],
                   fill=(26, 30, 40, 150))
    halo = halo.filter(ImageFilter.GaussianBlur(W * 0.06))
    im = Image.alpha_composite(im.convert('RGBA'), halo).convert('RGB')
    return im.convert('RGBA')


def panel_text(im, ox, headline_white, headline_blue, sub, eyebrow):
    """Logo, headline and sub, drawn at panel-local coordinates."""
    d = ImageDraw.Draw(im)
    LX = ox + int(W * 0.075)
    top = int(H * 0.052)

    mark = Image.open(MARK).convert('RGBA')
    px = mark.load()
    for y in range(mark.height):
        for x in range(mark.width):
            r_, g_, b_, a_ = px[x, y]
            if a_ > 8:
                px[x, y] = BLUE + (a_,)
    ms = int(W * 0.062)
    mark = mark.resize((ms, int(ms * mark.height / mark.width)), Image.LANCZOS)
    im.alpha_composite(mark, (LX, top))
    f_word = font(800, int(W * 0.054))
    bb = f_word.getbbox('arclo')
    wx = LX + ms + int(W * 0.018)
    d.text((wx, top + (mark.height - (bb[3] - bb[1])) // 2 - bb[1]), 'arclo',
           font=f_word, fill=WHITE)
    dr = int(W * 0.008)
    dx0 = wx + d.textlength('arclo', font=f_word) + dr
    d.ellipse([dx0, top + (mark.height + bb[3]) // 2 - bb[1] - dr * 2,
               dx0 + dr * 2, top + (mark.height + bb[3]) // 2 - bb[1]], fill=BLUE)

    y = top + mark.height + int(H * 0.030)
    if eyebrow:
        f_e = font(700, int(W * 0.0265))
        d.text((LX, y), eyebrow.upper(), font=f_e, fill=BLUE)
        y += int(f_e.size * 2.0)

    col_w = int(W * 0.85)
    size = int(W * 0.076)
    while size > int(W * 0.050):
        f_h = font(800, size)
        if max(d.textlength(headline_white, font=f_h),
               d.textlength(headline_blue or '', font=f_h)) <= col_w:
            break
        size -= 2
    f_h = font(800, size)
    for line, col in ((headline_white, WHITE), (headline_blue, BLUE)):
        if not line:
            continue
        d.text((LX, y), line, font=f_h, fill=col)
        y += int(f_h.size * 1.10)

    if sub:
        y += int(H * 0.006)
        f_s = font(400, int(W * 0.0345))
        for ln in wrap(d, sub, f_s, int(W * 0.80)):
            d.text((LX, y), ln, font=f_s, fill=GREY)
            y += int(f_s.size * 1.40)
    return y


FRAMES = [
    # Every panel carries its own screen, but each device is pushed right of
    # its panel centre so it crosses the seam: the tail of the previous phone
    # enters at the left edge of the next panel. Scrolled in the store the six
    # read as one chain rather than six separate cards. Angles alternate so the
    # chain has rhythm instead of looking like one template repeated.
    dict(shot='phoneScreenshots-0.png', out='1_today',
         eyebrow='Your day, planned',
         headline_white='Training that fits', headline_blue='your real week.',
         sub='Arclo reads your calendar and puts each session in a gap you actually have.',
         angle=-8.0, dev_w=0.86, dev_cx=0.76, dev_top=0.325),
    dict(shot='phoneScreenshots-1.png', out='2_reschedule',
         headline_white='Life moved.', headline_blue='So did the plan.',
         sub='A meeting lands on your session. Arclo offers the fix, not a guilt trip.',
         angle=0.0, dev_w=0.82, dev_cx=0.74, dev_top=0.310),
    dict(shot='phoneScreenshots-2.png', out='3_plan',
         headline_white='A real plan,', headline_blue='not a workout list.',
         sub='Structured weeks, progressive overload, and a deload before you need one.',
         angle=5.0, dev_w=0.84, dev_cx=0.75, dev_top=0.315),
    dict(shot='phoneScreenshots-3.png', out='4_session',
         headline_white='Track every rep.', headline_blue=None,
         sub='Weights already filled in from last time. Log a set with one tap.',
         angle=0.0, dev_w=0.82, dev_cx=0.74, dev_top=0.300),
    dict(shot='phoneScreenshots-4.png', out='5_quick',
         headline_white='Only got', headline_blue='fifteen minutes?',
         sub='No setup. Arclo builds the highest-impact session for the time you have.',
         angle=-6.0, dev_w=0.84, dev_cx=0.75, dev_top=0.315),
    dict(shot='phoneScreenshots-6.png', out='6_progress',
         headline_white='See progress.', headline_blue='Stay motivated.',
         sub='Volume, strength and weight trends that show whether the month did anything.',
         angle=0.0, dev_w=0.80, dev_cx=0.62, dev_top=0.305),
]


def build_set(outdir):
    """Render the whole set as one strip, then slice it into panels."""
    n = len(FRAMES)
    strip = strip_background(n)

    # Measure each panel's text block first: the device has to sit under it,
    # and it also has to land its bottom edge inside the canvas so the app's
    # own tab bar stays visible. Those two constraints fight each other, so the
    # device is shrunk until both hold rather than guessing a size per frame.
    scratch = Image.new('RGBA', (W * n, H), (0, 0, 0, 0))
    text_bottom = [panel_text(scratch, i * W, f['headline_white'],
                              f.get('headline_blue'), f.get('sub'), f.get('eyebrow'))
                   for i, f in enumerate(FRAMES)]

    # Devices left to right, so each phone overlaps the tail of the one
    # before it and the chain reads front-to-back consistently.
    for i, f in enumerate(FRAMES):
        dev_px = int(W * f.get('dev_w', 0.80))
        screen_w = int(dev_px * 0.93)
        screen_h = int(screen_w / (1179 / 2556))
        dev = build_device(os.path.join(SRC, f['shot']), screen_w * SS, screen_h * SS)
        ang = f.get('angle', 0.0)
        if abs(ang) > 0.01:
            dev = tilt(dev, angle_deg=ang)
            dev = dev.crop(dev.getbbox())
        dev = dev.resize((dev.width // SS, dev.height // SS), Image.LANCZOS)

        # Fit: bottom edge inside the canvas (so the tab bar shows), top edge
        # clear of the headline. Shrink until both are true.
        bottom_margin = int(H * 0.028)
        gap = int(H * 0.030)
        for _ in range(40):
            dy = H - bottom_margin - dev.height
            if dy >= text_bottom[i] + gap:
                break
            dev = dev.resize((int(dev.width * 0.97), int(dev.height * 0.97)),
                             Image.LANCZOS)
        dx = int((i + f.get('dev_cx', 0.74)) * W) - dev.width // 2
        dy = H - bottom_margin - dev.height

        shadow = Image.new('RGBA', strip.size, (0, 0, 0, 0))
        sh = dev.getchannel('A').point(lambda v: int(v * 0.62))
        shadow.paste((0, 0, 0, 255), (dx + int(W * 0.014), dy + int(W * 0.024)), sh)
        shadow = shadow.filter(ImageFilter.GaussianBlur(W * 0.026))
        strip = Image.alpha_composite(strip, shadow)
        strip.alpha_composite(dev, (dx, dy))

    # Text last, so a neighbouring phone can never sit on top of a headline.
    for i, f in enumerate(FRAMES):
        panel_text(strip, i * W, f['headline_white'], f.get('headline_blue'),
                   f.get('sub'), f.get('eyebrow'))

    os.makedirs(outdir, exist_ok=True)
    paths = []
    for i, f in enumerate(FRAMES):
        p = os.path.join(outdir, f['out'] + '.png')
        strip.crop((i * W, 0, (i + 1) * W, H)).convert('RGB').save(p, 'PNG')
        paths.append(p)
        print('%-16s %s  %dKB' % (f['out'], Image.open(p).size, os.path.getsize(p) // 1024))

    # A carousel preview with store-like gutters, so the crossing can actually
    # be judged before anything is uploaded.
    gap = int(W * 0.035)
    prev = Image.new('RGB', (W * n + gap * (n + 1), H + gap * 2), (14, 15, 19))
    for i, p in enumerate(paths):
        prev.paste(Image.open(p), (gap + i * (W + gap), gap))
    tw = 520 * n
    prev = prev.resize((tw, int(prev.height * tw / prev.width)), Image.LANCZOS)
    pp = os.path.join(outdir, '_carousel.png')
    prev.save(pp)
    print('carousel preview -> %s' % pp)
    return paths


def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'store-frames')
    build_set(outdir)
    print('%d frames -> %s' % (len(FRAMES), outdir))


if __name__ == '__main__':
    main()
