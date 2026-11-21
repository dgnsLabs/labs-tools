#!/usr/bin/env python3
"""Regenerate the deterministic test fixtures used by tests/e2e.py."""
from PIL import Image, ImageDraw

import os

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
os.makedirs(FIX, exist_ok=True)


def base(w, h, c1, c2):
    im = Image.new("RGB", (w, h), c1)
    d = ImageDraw.Draw(im)
    for i in range(0, w, 40):
        d.line([(i, 0), (i, h)], fill=c2, width=3)
    for j in range(0, h, 40):
        d.line([(0, j), (w, j)], fill=c2, width=1)
    d.ellipse([w * 0.2, h * 0.2, w * 0.6, h * 0.6], fill=(220, 80, 90))
    d.rectangle([w * 0.6, h * 0.55, w * 0.9, h * 0.85], fill=(30, 120, 220))
    return im


def main():
    exif = Image.Exif()
    exif[0x010F] = "TestCamMaker"
    exif[0x0110] = "TestCamModel"
    exif[0x0132] = "2026:11:21 12:34:56"
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (37.0, 33.0, 0.0)
    gps[3] = "E"
    gps[4] = (126.0, 58.0, 0.0)

    im1 = base(800, 600, (20, 30, 60), (90, 140, 220))
    im1.save(os.path.join(FIX, "photo-exif.jpg"), quality=92, exif=exif)

    im2 = base(1200, 800, (60, 20, 40), (220, 140, 90))
    im2.save(os.path.join(FIX, "photo2.jpg"), quality=90)

    noise = Image.effect_noise((2400, 2400), 90).convert("RGB")
    noise.save(os.path.join(FIX, "big-noise.jpg"), quality=94)

    im1.save(os.path.join(FIX, "doc.pdf"), save_all=True, append_images=[im2])
    print("fixtures written to", FIX)


if __name__ == "__main__":
    main()
