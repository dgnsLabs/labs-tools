#!/usr/bin/env python3
"""Generate the Labs Tools PWA icons (no external assets).

Run from the repository root:  python3 tools/make-icons.py
"""
from PIL import Image, ImageDraw

OUT = "icons"
S = 1024
C1 = (79, 124, 255)    # blue
C2 = (34, 211, 238)    # cyan


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for i in range(size * 2):
        t = i / (size * 2 - 1)
        col = tuple(int(C1[k] + (C2[k] - C1[k]) * t) for k in range(3))
        d.line([(i, 0), (0, i)], fill=col)
    return img


def art(draw, scale=1.0, ox=0, oy=0):
    """White 'L' monogram + lens dot, centred in a 1024 box."""
    def r(x, y, w, h, rad):
        draw.rounded_rectangle(
            [ox + x * scale, oy + y * scale, ox + (x + w) * scale, oy + (y + h) * scale],
            radius=rad * scale, fill=(255, 255, 255, 255)
        )
    # vertical stem
    r(330, 250, 118, 500, 58)
    # foot
    r(330, 632, 300, 118, 58)
    # pixel accent (references the mosaic tools)
    r(628, 252, 136, 136, 34)


def rounded_icon(size):
    base = gradient(S).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
    base.putalpha(mask)
    art(ImageDraw.Draw(base))
    return base.resize((size, size), Image.LANCZOS)


def maskable_icon(size):
    base = gradient(S).convert("RGBA")
    # safe zone: art inside the central 74%
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    art(ImageDraw.Draw(layer), scale=0.72, ox=S * 0.14, oy=S * 0.14)
    base.alpha_composite(layer)
    return base.resize((size, size), Image.LANCZOS)


def apple_icon(size):
    base = gradient(S).convert("RGBA")
    art(ImageDraw.Draw(base))
    return base.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    rounded_icon(512).save(f"{OUT}/icon-512.png")
    rounded_icon(192).save(f"{OUT}/icon-192.png")
    maskable_icon(512).save(f"{OUT}/icon-maskable-512.png")
    apple_icon(180).save(f"{OUT}/icon-180.png")
    print("icons written to", OUT)
