#!/usr/bin/env python3
"""Membuat semua aset (PNG + audio) untuk Gaple Online.
Jalankan: pnpm assets   (butuh: pip install pillow numpy; ffmpeg opsional untuk mp3)"""
import os, math, random, wave, subprocess, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "assets")
IMG = os.path.join(ROOT, "images"); TIL = os.path.join(IMG, "tiles"); AUD = os.path.join(ROOT, "audio")
for d in (IMG, TIL, AUD): os.makedirs(d, exist_ok=True)
random.seed(7); np.random.seed(7)
SS = 4  # supersampling

def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "C:/Windows/Fonts/georgiab.ttf",
              "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)

# ---------------------------------------------------------------- kartu domino
PIP = {0: None, 1: "#c0392b", 2: "#2e7d32", 3: "#1565c0", 4: "#7b1fa2", 5: "#e65100", 6: "#1d1d24"}
GRID = {
    1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (1, -1), (-1, 1), (1, 1)], 5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
    6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)],
}

def draw_tile(a, b):
    W, H = 128 * SS, 64 * SS
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    r = 12 * SS
    d.rounded_rectangle((1 * SS, 3 * SS, W - 1 * SS, H - 1 * SS), r, fill=(40, 28, 18, 255))
    d.rounded_rectangle((1 * SS, 1 * SS, W - 1 * SS, H - 4 * SS), r, fill=(236, 226, 200, 255))
    d.rounded_rectangle((3 * SS, 3 * SS, W - 3 * SS, H - 6 * SS), r - 2 * SS, fill=(250, 245, 229, 255))
    d.line((W // 2, 9 * SS, W // 2, H - 14 * SS), fill=(120, 100, 70, 255), width=2 * SS)
    for half, v in ((0, a), (1, b)):
        if not PIP[v]: continue
        cx = W // 4 + half * W // 2; cy = (H - 3 * SS) // 2
        for gx, gy in GRID[v]:
            if v == 6: x = cx + gx * 12 * SS; y = cy + gy * 14 * SS
            else: x = cx + gx * 14 * SS; y = cy + gy * 14 * SS
            rr = 6.2 * SS
            d.ellipse((x - rr, y - rr + SS, x + rr, y + rr + SS), fill=(0, 0, 0, 70))
            d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=PIP[v])
            d.ellipse((x - rr * .65, y - rr * .7, x - rr * .05, y - rr * .1), fill=(255, 255, 255, 110))
    d.ellipse((W / 2 - 3 * SS, (H - 3 * SS) / 2 - 3 * SS, W / 2 + 3 * SS, (H - 3 * SS) / 2 + 3 * SS), fill=(176, 138, 56, 255))
    return im.resize((128, 64), Image.LANCZOS)

for a in range(7):
    for b in range(a, 7):
        draw_tile(a, b).save(os.path.join(TIL, f"t_{a}_{b}.png"))

def draw_back():
    W, H = 128 * SS, 64 * SS; r = 12 * SS
    base = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(base)
    d.rounded_rectangle((1 * SS, 3 * SS, W - 1 * SS, H - 1 * SS), r, fill=(20, 14, 10, 255))
    d.rounded_rectangle((1 * SS, 1 * SS, W - 1 * SS, H - 4 * SS), r, fill=(176, 138, 56, 255))
    inner = Image.new("RGBA", (W, H), (14, 74, 62, 255)); di = ImageDraw.Draw(inner)
    for i in range(-4, 14):
        x = i * 14 * SS
        di.line((x, H - 8 * SS, x + 40 * SS, 5 * SS), fill=(26, 112, 92, 255), width=2 * SS)
        di.line((x + 40 * SS, H - 8 * SS, x, 5 * SS), fill=(26, 112, 92, 255), width=2 * SS)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle((5 * SS, 5 * SS, W - 5 * SS, H - 8 * SS), r - 3 * SS, fill=255)
    base.paste(inner, (0, 0), mask)
    d = ImageDraw.Draw(base); cx, cy = W // 2, (H - 3 * SS) // 2
    d.ellipse((cx - 9 * SS, cy - 9 * SS, cx + 9 * SS, cy + 9 * SS), fill=(176, 138, 56, 255))
    d.ellipse((cx - 5 * SS, cy - 5 * SS, cx + 5 * SS, cy + 5 * SS), fill=(14, 74, 62, 255))
    return base.resize((128, 64), Image.LANCZOS)
draw_back().save(os.path.join(IMG, "tile_back.png"))

g = Image.new("RGBA", (176, 112), (0, 0, 0, 0))
ImageDraw.Draw(g).rounded_rectangle((26, 26, 150, 86), 16, fill=(255, 214, 90, 255))
g.filter(ImageFilter.GaussianBlur(11)).save(os.path.join(IMG, "tile_glow.png"))

S = 64 * SS; m = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(m)
d.ellipse((2 * SS, 2 * SS, S - 2 * SS, S - 2 * SS), fill=(10, 40, 30, 215), outline=(243, 195, 77, 255), width=4 * SS)
d.ellipse((8 * SS, 8 * SS, S - 8 * SS, S - 8 * SS), outline=(176, 138, 56, 255), width=SS)
m.resize((64, 64), Image.LANCZOS).save(os.path.join(IMG, "end_marker.png"))

# ---------------------------------------------------------------- meja
def make_table():
    W, H = 1280, 720
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dist = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    k = np.clip(1.15 - dist * 0.75, 0, 1)
    felt = np.stack([10 + 34 * k, 52 + 78 * k, 40 + 56 * k], -1)
    felt += np.random.normal(0, 3.2, (H, W, 1))
    im = Image.fromarray(np.clip(felt, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im, "RGBA")
    d.rounded_rectangle((64, 52, W - 64, H - 40), 46, outline=(220, 182, 90, 70), width=3)
    d.rounded_rectangle((78, 66, W - 78, H - 54), 38, outline=(220, 182, 90, 35), width=1)
    wood = np.zeros((H, W, 3), np.float32)
    grain = np.sin(xx * 0.05 + np.sin(yy * 0.11) * 2.2) * 9 + np.random.normal(0, 4, (H, W))
    wood[..., 0] = 96 + grain; wood[..., 1] = 58 + grain * .7; wood[..., 2] = 30 + grain * .4
    wim = Image.fromarray(np.clip(wood, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    mask = Image.new("L", (W, H), 255); ImageDraw.Draw(mask).rounded_rectangle((16, 14, W - 16, H - 14), 26, fill=0)
    im.paste(wim, (0, 0), mask)
    d = ImageDraw.Draw(im, "RGBA")
    d.rounded_rectangle((16, 14, W - 16, H - 14), 26, outline=(30, 18, 10, 255), width=4)
    return im.convert("RGB")
make_table().save(os.path.join(IMG, "table.png"))

# ---------------------------------------------------------------- logo
def make_logo():
    W, H = 760, 230
    im = Image.new("RGBA", (W * 2, H * 2), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    f = font(176); txt = "GAPLE"
    bb = d.textbbox((0, 0), txt, font=f); tw = bb[2] - bb[0]
    x = (W * 2 - tw) // 2 - bb[0]; y = 40
    for dy in (14, 10, 6):
        d.text((x, y + dy), txt, font=f, fill=(40, 24, 8, 255), stroke_width=10, stroke_fill=(40, 24, 8, 255))
    d.text((x, y), txt, font=f, fill=(243, 195, 77, 255), stroke_width=8, stroke_fill=(120, 78, 20, 255))
    d.text((x, y - 6), txt, font=f, fill=(255, 228, 140, 255))
    f2 = font(46); sub = "domino pos ronda, versi online"
    b2 = d.textbbox((0, 0), sub, font=f2)
    d.text(((W * 2 - (b2[2] - b2[0])) // 2 - b2[0], H * 2 - 70), sub, font=f2, fill=(246, 237, 216, 255))
    im.resize((W, H), Image.LANCZOS).save(os.path.join(IMG, "logo.png"))
make_logo()

# ---------------------------------------------------------------- avatar
def avatar(name, bg, skin, hair, robot=False):
    S = 128 * SS; im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse((0, 0, S - 1, S - 1), fill=bg)
    mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).ellipse((0, 0, S - 1, S - 1), fill=255)
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0)); b = ImageDraw.Draw(body)
    if robot:
        b.rounded_rectangle((28 * SS, 34 * SS, 100 * SS, 100 * SS), 14 * SS, fill=(190, 200, 208, 255), outline=(60, 70, 80, 255), width=3 * SS)
        b.line((64 * SS, 34 * SS, 64 * SS, 18 * SS), fill=(60, 70, 80, 255), width=3 * SS)
        b.ellipse((58 * SS, 10 * SS, 70 * SS, 22 * SS), fill=(230, 80, 60, 255))
        for ex in (46, 82):
            b.ellipse(((ex - 9) * SS, 54 * SS, (ex + 9) * SS, 72 * SS), fill=(20, 40, 50, 255))
            b.ellipse(((ex - 4) * SS, 58 * SS, (ex + 4) * SS, 66 * SS), fill=(110, 240, 200, 255))
        b.rectangle((44 * SS, 82 * SS, 84 * SS, 88 * SS), fill=(60, 70, 80, 255))
    else:
        b.ellipse((14 * SS, 92 * SS, 114 * SS, 190 * SS), fill=(46, 72, 92, 255))
        b.ellipse((30 * SS, 24 * SS, 98 * SS, 104 * SS), fill=skin)
        b.pieslice((26 * SS, 16 * SS, 102 * SS, 84 * SS), 180, 360, fill=hair)
        for ex in (50, 78): b.ellipse(((ex - 5) * SS, 62 * SS, (ex + 5) * SS, 74 * SS), fill=(30, 22, 18, 255))
        b.arc((48 * SS, 70 * SS, 80 * SS, 92 * SS), 20, 160, fill=(120, 40, 40, 255), width=3 * SS)
    clipped = Image.new("RGBA", (S, S), (0, 0, 0, 0)); clipped.paste(body, (0, 0), mask)
    im.alpha_composite(clipped)
    d = ImageDraw.Draw(im); d.ellipse((2 * SS, 2 * SS, S - 2 * SS, S - 2 * SS), outline=(243, 195, 77, 255), width=5 * SS)
    im.resize((128, 128), Image.LANCZOS).save(os.path.join(IMG, name + ".png"))
avatar("avatar_1", (38, 132, 160, 255), (233, 184, 140, 255), (40, 28, 22, 255))
avatar("avatar_2", (190, 90, 60, 255), (196, 140, 98, 255), (24, 20, 20, 255))
avatar("avatar_3", (96, 110, 190, 255), (240, 200, 160, 255), (120, 70, 30, 255))
avatar("avatar_4", (110, 150, 70, 255), (170, 118, 82, 255), (70, 70, 74, 255))
avatar("avatar_com", (60, 70, 90, 255), None, None, robot=True)

def icon(name, muted):
    S = 64 * SS; im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse((2 * SS, 2 * SS, S - 2 * SS, S - 2 * SS), fill=(6, 37, 27, 220), outline=(243, 195, 77, 255), width=3 * SS)
    c = (246, 237, 216, 255)
    d.polygon([(16 * SS, 26 * SS), (25 * SS, 26 * SS), (35 * SS, 17 * SS), (35 * SS, 47 * SS), (25 * SS, 38 * SS), (16 * SS, 38 * SS)], fill=c)
    if muted:
        d.line((40 * SS, 24 * SS, 52 * SS, 40 * SS), fill=(230, 90, 70, 255), width=4 * SS)
        d.line((52 * SS, 24 * SS, 40 * SS, 40 * SS), fill=(230, 90, 70, 255), width=4 * SS)
    else:
        for r in (8, 14):
            d.arc(((36 - r) * SS, (32 - r) * SS, (36 + r) * SS, (32 + r) * SS), -50, 50, fill=c, width=3 * SS)
    im.resize((64, 64), Image.LANCZOS).save(os.path.join(IMG, name + ".png"))
icon("icon_sound", False); icon("icon_mute", True)

fav = Image.open(os.path.join(TIL, "t_6_6.png")).rotate(90, expand=True)
fv = Image.new("RGBA", (128, 128), (14, 74, 62, 255)); fv.paste(fav, (32, 0), fav)
fv.save(os.path.join(ROOT, "..", "favicon.png"))

# ---------------------------------------------------------------- audio
SR = 22050
def env(n, a=0.004, d=8.0):
    t = np.arange(n) / SR
    return np.minimum(t / a, 1) * np.exp(-t * d)
def lowpass(x, k): return np.convolve(x, np.ones(k) / k, mode="same")
def tone(f, dur, d=6, kind="sine", vol=1.0):
    n = int(SR * dur); t = np.arange(n) / SR
    if kind == "tri": s = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * f * t))
    else: s = np.sin(2 * np.pi * f * t) + .25 * np.sin(2 * np.pi * f * 2 * t) + .1 * np.sin(2 * np.pi * f * 3 * t)
    return s * env(n, 0.006, d) * vol
def knock(vol=1.0, f=190):
    n = int(SR * .16); noise = lowpass(np.random.randn(n), 7)
    return (noise * env(n, .001, 38) * 1.4 + np.sin(2 * np.pi * f * np.arange(n) / SR) * env(n, .001, 30)) * vol
def mix(parts, total):
    out = np.zeros(int(SR * total))
    for t0, s in parts:
        i = int(SR * t0); out[i:i + len(s)] += s[:len(out) - i]
    return out
def save(name, x, vol=.8):
    x = x / max(1e-6, np.max(np.abs(x))) * vol
    path = os.path.join(AUD, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype("<i2").tobytes())
    return path

save("place", mix([(0, knock(1, 210)), (0.03, knock(.5, 120))], .3))
save("pass", mix([(0, knock(1, 140)), (0.16, knock(.9, 125))], .45))
save("click", lowpass(np.random.randn(int(SR * .05)), 3) * env(int(SR * .05), .001, 90), .5)
save("deal", mix([(i * 0.055 + random.random() * .01, knock(.55 + random.random() * .3, 220 + random.random() * 90)) for i in range(9)], .7))
save("turn", mix([(0, tone(880, .35, 7, vol=.8)), (0.11, tone(1318, .45, 6, vol=.6))], .6), .55)
save("win", mix([(i * .13, tone(f, .7, 4.5, "tri")) for i, f in enumerate((523.25, 659.25, 783.99, 1046.5))] + [(.55, tone(1318.5, .8, 3.5, "tri", .6))], 1.5), .7)
save("lose", mix([(i * .2, tone(f, .6, 5, "tri")) for i, f in enumerate((392, 349.23, 311.13, 261.63))], 1.2), .6)

# musik latar (loop): progresi Am - F - C - G, petikan lembut + pad
bpm = 84; beat = 60 / bpm
chords = [(57, (0, 3, 7, 12)), (53, (0, 4, 7, 12)), (60, (0, 4, 7, 12)), (55, (0, 4, 7, 12))] * 2
mf = lambda m: 440 * 2 ** ((m - 69) / 12)
total = len(chords) * 4 * beat; bgm = np.zeros(int(SR * total))
for ci, (root, ivs) in enumerate(chords):
    t0 = ci * 4 * beat
    for k in range(8):
        m = root + 12 + ivs[(0, 1, 2, 3, 2, 1, 2, 1)[k]]
        s = tone(mf(m), 1.1, 4.2, "tri", .55); i = int(SR * (t0 + k * beat / 2)); bgm[i:i + len(s)] += s[:len(bgm) - i]
    n = int(SR * 4 * beat); t = np.arange(n) / SR
    pad = sum(np.sin(2 * np.pi * mf(root + iv) * t) for iv in ivs[:3]) * .12
    pad *= np.minimum(t / .8, 1) * np.minimum((4 * beat - t) / .8, 1)
    i = int(SR * t0); bgm[i:i + n] += pad[:len(bgm) - i]
    bass = tone(mf(root - 12), 1.8, 2.4, "tri", .5); bgm[i:i + len(bass)] += bass[:len(bgm) - i]
bgm = lowpass(bgm, 3)
wp = save("bgm", bgm, .55)
if shutil.which("ffmpeg"):
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wp, "-b:a", "96k", wp[:-4] + ".mp3"], check=True)
        os.remove(wp)
    except Exception as e:
        print("mp3 gagal, pakai wav:", e)
print("selesai ->", os.path.abspath(ROOT))
