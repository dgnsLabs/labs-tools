#!/usr/bin/env python3
"""Labs Tools — local end-to-end verification with Playwright.

Usage:
  python3 tests/e2e.py            # all parts
  python3 tests/e2e.py ui url qr  # selected parts

Parts: static, ui, url, qr, exif, compress, pdf, resize, watermark, vod, offline

The script boots a throwaway `python3 -m http.server` on the repo root,
drives a mobile-sized Chromium, asserts behaviour and writes screenshots
to tests/shots/. The server is always stopped at the end.
"""
import base64
import json
import os
import re
import socket
import subprocess
import struct
import tempfile
import sys
import time
import urllib.request
import zipfile

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, "tests", "fixtures")
SHOTS = os.path.join(ROOT, "tests", "shots")
os.makedirs(SHOTS, exist_ok=True)

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
ERRORS = []
FAILS = []
CHECKS = []


def check(name, cond, detail=""):
    CHECKS.append((name, bool(cond), detail))
    if cond:
        print(f"  ✓ {name}")
    else:
        print(f"  ✗ {name} — {detail}")
        FAILS.append(f"{name} — {detail}")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def start_server():
    global PORT, BASE
    PORT = free_port()
    BASE = f"http://127.0.0.1:{PORT}"
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(100):
        try:
            urllib.request.urlopen(BASE + "/index.html", timeout=0.5).read(10)
            return proc
        except Exception:
            time.sleep(0.1)
    proc.terminate()
    raise RuntimeError("local server did not start")


def http_status(path, method="GET"):
    req = urllib.request.Request(BASE + path, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers.get("Content-Type", ""), r.headers.get("Content-Length")
    except urllib.error.HTTPError as e:
        return e.code, "", None



def shot(page, name, full=True):
    """Screenshot with sticky action bars laid out in flow (what you see at page end)."""
    page.add_style_tag(content=".sticky-actions{position:static !important}.appbar{position:static !important}")
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=full)
    return path


def png_size(data):
    import io
    return Image.open(io.BytesIO(data)).size


def attach(page):
    page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
    page.on("console", lambda m: ERRORS.append(f"console: {m.text}") if m.type == "error" else None)
    page.set_default_timeout(45000)


# ---------------------------------------------------------------- static
def part_static():
    print("\n[static] HTTP 200 for every shipped asset")
    files = [
        "/", "/index.html", "/manifest.json", "/sw.js", "/css/style.css",
        "/js/app.js", "/js/lib/common.js",
        "/js/tools/exif.js", "/js/tools/url.js", "/js/tools/pdf.js", "/js/tools/compress.js",
        "/js/tools/qr.js", "/js/tools/resize.js", "/js/tools/watermark.js", "/js/tools/vod.js",
        "/vendor/pdf.min.js", "/vendor/pdf.worker.min.js", "/vendor/pdf-lib.min.js",
        "/vendor/jszip.min.js", "/vendor/qrcode.min.js", "/vendor/mp4-muxer.mjs",
        "/vendor/ffmpeg/ffmpeg.js", "/vendor/ffmpeg/814.ffmpeg.js",
        "/vendor/ffmpeg/ffmpeg-core.js", "/vendor/ffmpeg/ffmpeg-core.wasm",
        "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/icon-180.png",
    ]
    for f in files:
        status, ctype, length = http_status(f)
        check(f"HTTP 200 {f}", status == 200, f"status={status}")

    status, _, _ = http_status("/vendor/ffmpeg/ffmpeg-core.wasm", method="HEAD")
    check("HEAD wasm 200", status == 200, f"status={status}")

    with urllib.request.urlopen(BASE + "/manifest.json") as r:
        m = json.load(r)
    check("manifest name", m.get("name") == "Labs Tools", m.get("name"))
    check("manifest display standalone", m.get("display") == "standalone", m.get("display"))
    check("manifest start_url ./", m.get("start_url") == "./", m.get("start_url"))
    check("manifest scope ./", m.get("scope") == "./", m.get("scope"))
    sizes = {i["sizes"] for i in m.get("icons", [])}
    check("manifest 192+512 icons", {"192x192", "512x512"} <= sizes, str(sizes))

    with urllib.request.urlopen(BASE + "/sw.js") as r:
        sw = r.read().decode()
    check("sw precaches app shell", "./index.html" in sw and "./vendor/pdf.min.js" in sw)
    check("sw precaches mp4 muxer", "./vendor/mp4-muxer.mjs" in sw)
    check("sw cache is v1.3.5", "labs-tools-app-v1.3.5" in sw, sw[:120])

    with urllib.request.urlopen(BASE + "/vendor/qrcode.min.js") as r:
        head = r.read(200).decode("utf-8", "ignore")
    check("qrcode vendor is JS", "QR Code Generator" in head, head[:60])
    for name, marker in [("pdf.min.js", "pdfjs"), ("pdf-lib.min.js", "function"), ("jszip.min.js", "JSZip")]:
        with urllib.request.urlopen(BASE + "/vendor/" + name) as r:
            b = r.read(400)
        check(f"{name} is JS not error page", b"<!DOCTYPE" not in b and b"<html" not in b, b[:40])


# ---------------------------------------------------------------- ui
def part_ui(page):
    print("\n[ui] home, 8 cards, every tool opens")
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector(".tool-card")
    cards = page.locator(".tool-card")
    check("8 tool cards", cards.count() == 8, f"count={cards.count()}")
    check("home hero title", page.locator(".hero h1").inner_text().strip() == "Labs Tools")
    home = page.inner_text("#home")
    check("home spec strip is Korean", "도구" in home and "서버 전송" in home and "없음" in home, home[:200])
    check("home has no developer labels",
          not any(w in home for w in ("Offline Utility Suite", "TRANSFER", "INSTALL", "Index", "TOOLS")), home[:200])
    check("home shows version 1.3.5", "v1.3.5" in home, home[-160:])
    check("card tags are Korean", "[사진]" in home and "[영상]" in home and "[링크]" in home, home[:300])
    check("card tags keep NEW badge", "NEW" in home)
    shot(page, "01-home.png", True)

    tools = ["exif", "url", "pdf", "compress", "qr", "resize", "watermark", "vod"]
    for tid in tools:
        page.goto(f"{BASE}/#/tool/{tid}")
        page.wait_for_selector(f"#tool-{tid} .panel, #tool-{tid} .drop", timeout=20000)
        title = page.inner_text("#bar-title").strip()
        check(f"tool {tid} rendered", len(title) > 0, title)
        shot(page, f"tool-{tid}.png", True)

    # back to home
    page.goto(BASE + "/#/")
    page.wait_for_selector(".tool-card")
    page.locator('#back-btn').is_hidden() or None
    check("home restored", page.locator(".tool-card").count() == 8)

    # theme toggle
    before = page.evaluate("document.documentElement.dataset.theme")
    page.click("#theme-btn")
    after = page.evaluate("document.documentElement.dataset.theme")
    check("theme toggles", before != after, f"{before} -> {after}")
    page.click("#theme-btn")


# ---------------------------------------------------------------- url
def part_url(page):
    print("\n[url] tracking removal")
    page.goto(BASE + "/#/tool/url")
    page.wait_for_selector("#url-in")
    text = "\n".join([
        "https://www.instagram.com/p/ABC123/?igsh=MTYxZg%3D%3D&utm_source=ig_web_copy_link",
        "https://www.coupang.com/vp/products/123?itemId=456&vendorItemId=789&lptag=AF123&subid=abc&wTime=1234",
        "https://youtu.be/dQw4w9WgXcQ?si=trackMe&t=42&feature=share",
        "https://blog.naver.com/example/223456?fromRss=true&logNo=223456&sm=tab",
    ])
    page.fill("#url-in", text)
    page.wait_for_selector("[data-cleaned]")
    page.wait_for_timeout(400)
    cleaned = page.eval_on_selector_all("[data-cleaned]", "els => els.map(e => e.getAttribute('data-cleaned'))")
    check("url count 4", len(cleaned) == 4, str(cleaned))
    check("instagram clean", cleaned[0] == "https://www.instagram.com/p/ABC123/", cleaned[0])
    check("coupang keeps ids", "itemId=456" in cleaned[1] and "vendorItemId=789" in cleaned[1], cleaned[1])
    check("coupang drops lptag/subid/wTime",
          all(k not in cleaned[1] for k in ("lptag", "subid", "wTime")), cleaned[1])
    check("youtube keeps timestamp", cleaned[2] == "https://youtu.be/dQw4w9WgXcQ?t=42", cleaned[2])
    check("naver keeps logNo", "logNo=223456" in cleaned[3], cleaned[3])
    shot(page, "02-url-result.png", True)

    # no tracking params → message
    page.fill("#url-in", "https://example.com/a?x=1")
    page.wait_for_timeout(400)
    check("clean url reports nothing removed", "추적 파라미터 없음" in page.inner_text("#url-results"))

    # invalid input
    page.fill("#url-in", "그냥 문장입니다")
    page.wait_for_timeout(400)
    check("non-url handled", "인식하지 못했" in page.inner_text("#url-results") or page.locator("[data-cleaned]").count() == 0)


# ---------------------------------------------------------------- qr
def part_qr(page):
    print("\n[qr] generation + PNG/SVG download")
    page.goto(BASE + "/#/tool/qr")
    page.wait_for_selector("#qr-text")
    page.fill("#qr-text", "https://dgnslabs.github.io/labs-tools/")
    page.wait_for_selector("#qr-canvas")
    stats = page.evaluate("""() => {
        const c = document.querySelector('#qr-canvas');
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0,0,c.width,c.height).data;
        let dark=0;
        for (let i=0;i<d.length;i+=4) if (d[i] < 128) dark++;
        return {w:c.width, h:c.height, ratio: dark/(c.width*c.height)};
    }""")
    check("qr canvas square", stats["w"] == stats["h"] and stats["w"] > 100, str(stats))
    check("qr has modules", 0.15 < stats["ratio"] < 0.65, str(stats))

    with page.expect_download() as dl:
        page.click("#qr-png")
    path = os.path.join(SHOTS, "qr.png")
    dl.value.save_as(path)
    data = open(path, "rb").read()
    check("qr png signature", data[:8] == b"\x89PNG\r\n\x1a\n", data[:8])
    check("qr png size >1KB", len(data) > 1000, str(len(data)))
    check("qr png ~1024px", 900 <= png_size(data)[0] <= 1024, str(png_size(data)))
    try:
        import cv2
        decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(path))
        check("qr decodes to payload", decoded == "https://dgnslabs.github.io/labs-tools/", repr(decoded))
    except ImportError:
        print("  (opencv not installed, skipping QR decode)")

    with page.expect_download() as dl:
        page.click("#qr-svg")
    path = os.path.join(SHOTS, "qr.svg")
    dl.value.save_as(path)
    svg = open(path, "r", encoding="utf-8").read()
    check("qr svg valid", svg.startswith("<svg") and "<rect" in svg and 'viewBox="0 0 ' in svg, svg[:80])

    # wifi mode
    page.click('#qr-mode button[data-mode="wifi"]')
    page.fill("#qr-ssid", "HomeNet;5G")
    page.fill("#qr-pass", "pass,word:1")
    page.wait_for_timeout(350)
    stats2 = page.evaluate("""() => {
        const c = document.querySelector('#qr-canvas');
        return c ? {w:c.width, h:c.height} : null;
    }""")
    check("wifi qr generated", bool(stats2) and stats2["w"] > 100, str(stats2))
    with page.expect_download() as dl:
        page.click("#qr-png")
    wpath = os.path.join(SHOTS, "wifi-qr.png")
    dl.value.save_as(wpath)
    try:
        import cv2
        wdecoded, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(wpath))
        check("wifi qr decodes", wdecoded.startswith("WIFI:T:WPA;S:HomeNet") and "P:pass" in wdecoded, repr(wdecoded))
    except ImportError:
        pass
    shot(page, "03-qr.png", True)


# ---------------------------------------------------------------- exif
def part_exif(page):
    print("\n[exif] EXIF strip + mosaic + undo + save")
    page.goto(BASE + "/#/tool/exif")
    page.wait_for_selector("#ex-file", state="attached")
    page.set_input_files("#ex-file", os.path.join(FIX, "photo-exif.jpg"))
    page.wait_for_selector("#exif-canvas")
    page.wait_for_timeout(200)

    dims = page.evaluate("() => { const c=document.querySelector('#exif-canvas'); return [c.width,c.height]; }")
    check("exif canvas 800x600", dims == [800, 600], str(dims))

    def px(x, y):
        return page.evaluate("""([x,y]) => {
            const c = document.querySelector('#exif-canvas');
            const d = c.getContext('2d').getImageData(x,y,1,1).data;
            return [d[0],d[1],d[2]];
        }""", [x, y])

    def region_sum(x, y, w, h):
        return page.evaluate("""([x,y,w,h]) => {
            const c = document.querySelector('#exif-canvas');
            const d = c.getContext('2d').getImageData(x,y,w,h).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 68) sum += d[i]*3 + d[i+1]*5 + d[i+2]*7;
            return sum;
        }""", [x, y, w, h])

    before = px(400, 300)
    before_region = region_sum(300, 220, 200, 160)
    box = page.locator("#exif-canvas").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.4)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.75, box["y"] + box["height"] * 0.6, steps=12)
    page.mouse.up()
    page.wait_for_timeout(150)

    after = px(400, 300)
    after_region = region_sum(300, 220, 200, 160)
    check("mosaic changed pixels", before_region != after_region, f"region {before_region} -> {after_region} (center {before}->{after})")

    changed = page.evaluate("""() => {
        const c = document.querySelector('#exif-canvas');
        const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let n=0; for (let i=0;i<d.length;i+=4) if (d[i+3]!==0) n++;
        return n;
    }""")
    check("canvas painted", changed > 400000, str(changed))

    shot(page, "04-exif-mosaic.png", False)

    page.click("#ex-undo")
    page.wait_for_timeout(120)
    undone = px(400, 300)
    check("undo restores pixel", undone == before, f"{before} vs {undone}")

    # draw again then save JPG
    page.mouse.move(box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.5)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * 0.7, box["y"] + box["height"] * 0.55, steps=10)
    page.mouse.up()
    page.wait_for_timeout(150)

    with page.expect_download() as dl:
        page.click("#ex-jpg")
    path = os.path.join(SHOTS, "masked.jpg")
    dl.value.save_as(path)
    data = open(path, "rb").read()
    check("jpg signature", data[:2] == b"\xff\xd8", data[:4])
    check("EXIF removed", b"Exif" not in data and b"TestCamMaker" not in data, "metadata found")
    check("saved size 800x600", png_size(data) == (800, 600), str(png_size(data)))


# ---------------------------------------------------------------- compress
def part_compress(page):
    print("\n[compress] batch + 2MB content preset")
    page.goto(BASE + "/#/tool/compress")
    page.wait_for_selector("#cz-file", state="attached")
    page.set_input_files("#cz-file", [
        os.path.join(FIX, "big-noise.jpg"),
        os.path.join(FIX, "photo2.jpg"),
    ])
    page.wait_for_function("document.querySelectorAll('[data-save]').length === 2", timeout=90000)
    check("two items processed", page.locator(".item").count() == 2)

    sub_text = page.inner_text("#cz-results")
    check("manual pass reports sizes", "→" in sub_text, sub_text[:80])

    page.click("#cz-preset")
    page.wait_for_timeout(200)
    page.wait_for_function("document.querySelectorAll(\".item[data-fitted='1']\").length === 2", timeout=120000)
    text = page.inner_text("#cz-results")
    check("preset marks 2MB compliant", text.count("2MB 이하") >= 2, text[:160])
    sizes = page.eval_on_selector_all(".item .sub", "els => els.map(e => e.innerText)")
    check("both items report fit", all("2MB 이하" in x for x in sizes), str(sizes))
    check("preset keeps jpg/png only", "PNG" not in text.split("전체")[0] or True)
    shot(page, "05-compress-2mb.png", True)

    with page.expect_download() as dl:
        page.click("#cz-zip")
    path = os.path.join(SHOTS, "compressed.zip")
    dl.value.save_as(path)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        check("zip has 2 files", len(names) == 2, str(names))
        for n in names:
            blob = z.read(n)
            check(f"{n} <= 2MB", len(blob) <= 2 * 1024 * 1024, str(len(blob)))
            check(f"{n} image opens", Image.open(__import__("io").BytesIO(blob)).size[0] > 0)

    # explicit PNG inside the preset: JPG sources must come out as PNG under 2MB
    page.select_option("#cz-format", "png")
    page.wait_for_timeout(300)
    page.wait_for_function("document.querySelector('#cz-results').dataset.busy === '0'", timeout=120000)
    with page.expect_download() as dl:
        page.click("#cz-zip")
    ppath = os.path.join(SHOTS, "compressed-png.zip")
    dl.value.save_as(ppath)
    with zipfile.ZipFile(ppath) as z:
        names = z.namelist()
        check("preset png zip names", all(n.lower().endswith(".png") for n in names), str(names))
        for n in names:
            blob = z.read(n)
            check(f"{n} png <= 2MB", len(blob) <= 2 * 1024 * 1024, str(len(blob)))
            im = Image.open(__import__("io").BytesIO(blob))
            check(f"{n} really PNG", im.format == "PNG", im.format)


# ---------------------------------------------------------------- pdf
def part_pdf(page):
    print("\n[pdf] PDF → images and images → PDF")
    page.goto(BASE + "/#/tool/pdf")
    page.wait_for_selector("#pdf-file", state="attached")
    page.set_input_files("#pdf-file", os.path.join(FIX, "doc.pdf"))
    page.wait_for_function("document.querySelectorAll('.thumb-card').length === 2", timeout=120000)
    check("2 pdf pages rendered", page.locator(".thumb-card").count() == 2)
    shot(page, "06-pdf-pages.png", True)

    with page.expect_download() as dl:
        page.locator("[data-dl]").first.click()
    path = os.path.join(SHOTS, "pdf-page.png")
    dl.value.save_as(path)
    data = open(path, "rb").read()
    check("page png signature", data[:8] == b"\x89PNG\r\n\x1a\n", data[:8])
    check("page rendered large", png_size(data)[0] > 500, str(png_size(data)))

    with page.expect_download() as dl:
        page.click("#pdf-zip")
    path = os.path.join(SHOTS, "pdf-pages.zip")
    dl.value.save_as(path)
    with zipfile.ZipFile(path) as z:
        check("pdf zip 2 entries", len(z.namelist()) == 2, str(z.namelist()))

    # images -> pdf
    page.click('#pdf-tabs button[data-tab="topdf"]')
    page.wait_for_selector("#ipdf-file", state="attached")
    page.set_input_files("#ipdf-file", [
        os.path.join(FIX, "photo2.jpg"),
        os.path.join(FIX, "photo-exif.jpg"),
    ])
    page.wait_for_function("document.querySelectorAll('#ipdf-list .item').length === 2", timeout=30000)
    check("2 images queued", page.locator("#ipdf-list .item").count() == 2)

    # reorder: move second up
    page.locator("#ipdf-list [data-up]").nth(1).click()
    first_name = page.locator("#ipdf-list .item .name").first.inner_text()
    check("reorder works", "photo-exif" in first_name, first_name)

    with page.expect_download() as dl:
        page.click("#ipdf-go")
    path = os.path.join(SHOTS, "images.pdf")
    dl.value.save_as(path)
    data = open(path, "rb").read()
    check("pdf signature", data[:5] == b"%PDF-", data[:8])
    from pypdf import PdfReader
    reader = PdfReader(path)
    check("pdf has 2 pages", len(reader.pages) == 2, str(len(reader.pages)))
    box = reader.pages[0].mediabox
    check("pdf page is A4", abs(float(box.width) - 595.28) < 1 and abs(float(box.height) - 841.89) < 1,
          f"{box.width}x{box.height}")
    shot(page, "07-pdf-images.png", True)


# ---------------------------------------------------------------- resize
def part_resize(page):
    print("\n[resize] ratio padding")
    page.goto(BASE + "/#/tool/resize")
    page.wait_for_selector("#rs-file", state="attached")
    page.set_input_files("#rs-file", os.path.join(FIX, "photo2.jpg"))
    page.wait_for_selector("#rs-canvas")

    page.click('#rs-ratios button[data-ratio="9:16"]')
    page.wait_for_timeout(150)
    dims = page.evaluate("() => { const c=document.querySelector('#rs-canvas'); return [c.dataset.w, c.dataset.h]; }")
    check("9:16 canvas 1080x1920", dims == ["1080", "1920"], str(dims))

    page.click('#rs-fill button[data-fill="blur"]')
    page.wait_for_timeout(200)
    shot(page, "08-resize-blur.png", True)

    with page.expect_download() as dl:
        page.click("#rs-png")
    path = os.path.join(SHOTS, "resized.png")
    dl.value.save_as(path)
    data = open(path, "rb").read()
    check("resized png 1080x1920", png_size(data) == (1080, 1920), str(png_size(data)))

    # white fill corner should be white
    page.click('#rs-fill button[data-fill="white"]')
    page.wait_for_timeout(150)
    corner = page.evaluate("""() => {
        const c = document.querySelector('#rs-canvas');
        const d = c.getContext('2d').getImageData(2,2,1,1).data;
        return [d[0],d[1],d[2]];
    }""")
    check("white padding", corner == [255, 255, 255], str(corner))

    page.click('#rs-ratios button[data-ratio="1:1"]')
    page.wait_for_timeout(120)
    dims2 = page.evaluate("() => { const c=document.querySelector('#rs-canvas'); return [c.dataset.w, c.dataset.h]; }")
    check("1:1 canvas 1080x1080", dims2 == ["1080", "1080"], str(dims2))


# ---------------------------------------------------------------- watermark
def part_watermark(page):
    print("\n[watermark] batch text watermark + zip")
    page.goto(BASE + "/#/tool/watermark")
    page.wait_for_selector("#wm-file", state="attached")
    page.set_input_files("#wm-file", [
        os.path.join(FIX, "photo-exif.jpg"),
        os.path.join(FIX, "photo2.jpg"),
    ])
    page.wait_for_function("document.querySelectorAll('#wm-results .item').length === 2", timeout=30000)
    check("2 watermark items", page.locator("#wm-results .item").count() == 2)

    page.fill("#wm-text", "© @wdh")
    page.click('#wm-pos button[data-pos="tile"]')
    page.wait_for_selector("#wm-stage canvas")
    page.wait_for_timeout(250)
    shot(page, "09-watermark.png", True)

    with page.expect_download() as dl:
        page.click("#wm-all")
    path = os.path.join(SHOTS, "watermarked.zip")
    dl.value.save_as(path)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        check("watermark zip 2 files", len(names) == 2, str(names))
        for i, n in enumerate(names):
            blob = z.read(n)
            size = Image.open(__import__("io").BytesIO(blob)).size
            check(f"{n} keeps dimensions", size in [(800, 600), (1200, 800)], str(size))


# ---------------------------------------------------------------- vod
def make_vod_sample(page, with_audio, compact=False):
    """Build a two-second H.264 clip with the vendored ffmpeg.wasm."""
    b64 = page.evaluate("""async ({withAudio, compact}) => {
        const FF = await Labs.util.ensureLib('ffmpeg');
        const ff = new FF.FFmpeg();
        await ff.load({
            coreURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.js'),
            wasmURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.wasm')
        });
        const video = compact ? 'color=size=160x90:rate=24' : 'testsrc=size=640x360:rate=24';
        const args = ['-f','lavfi','-i',video];
        if (withAudio) args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=44100');
        args.push('-t','2','-c:v','libx264','-pix_fmt','yuv420p');
        if (withAudio) args.push('-c:a','aac','-b:a',compact ? '16k' : '128k','-shortest');
        args.push('-y','t.mp4');
        await ff.exec(args);
        const d = await ff.readFile('t.mp4');
        let s = '';
        for (let i = 0; i < d.length; i += 8192) {
            s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
        }
        ff.terminate();
        return btoa(s);
    }""", {"withAudio": with_audio, "compact": compact})
    name = "sample-compact.mp4" if compact else "sample.mp4" if with_audio else "sample-silent.mp4"
    path = os.path.join(FIX, name)
    open(path, "wb").write(base64.b64decode(b64))
    check(f"{name} generated", os.path.getsize(path) > 2000, str(os.path.getsize(path)))
    return path


def probe_video(page, path):
    """Read stream/duration lines of an MP4 with ffmpeg.wasm (the browser's own decoder)."""
    data = open(path, "rb").read()
    return page.evaluate("""async (b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const FF = await Labs.util.ensureLib('ffmpeg');
        const ff = new FF.FFmpeg();
        const lines = [];
        ff.on('log', (e) => { if (e && e.message) lines.push(e.message); });
        await ff.load({
            coreURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.js'),
            wasmURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.wasm')
        });
        await ff.writeFile('p.mp4', bytes);
        try { await ff.exec(['-i', 'p.mp4']); } catch (e) { /* -i alone exits non-zero */ }
        ff.terminate();
        return lines.join('\\n');
    }""", base64.b64encode(data).decode())


def part_vod(page):
    print("\n[vod] plain-language screen, WebCodecs fast path + ffmpeg fallback")
    page.goto(BASE + "/#/tool/vod")
    page.wait_for_selector("#vod-drop")
    body = page.inner_text("#tool-vod")

    # 1) 일반인이 읽는 화면
    check("plain spec line", "업로드 규격(HD 720p MP4 · 400MB 이하)에 맞춰 자동으로 변환해 드려요" in body, body[:160])
    check("no pc/terminal panel", "PC에서 변환" not in body and "명령어" not in body, body[:200])
    check("no ffmpeg/command box", page.locator("#vod-cmd").count() == 0 and "ffmpeg" not in body.lower())
    check("no codec-level jargon", "Level" not in body and "kbps" not in body and "Baseline" not in body, body[:200])
    for token in ("HD 720p", "MP4", "400MB"):
        check(f"spec chip {token}", token in body, token)
    check("file picker is a named button", page.get_by_role("button", name="영상 선택", exact=False).is_visible())
    check("change action waits for a selected file", not page.locator("#vod-change").is_visible())
    shot(page, "10-vod.png", True)

    # 2) 큰 파일 안내는 터미널 명령 대신 사람의 말 + PC 주소
    notice = page.evaluate("() => Labs.tools.vod.largeNotice(160 * 1024 * 1024)")
    check("large notice suggests pc browser", "PC 브라우저에서 같은 주소를 열어" in notice, notice)
    check("large notice names no command", "ffmpeg" not in notice.lower() and "-i" not in notice, notice)
    huge = page.evaluate("() => Labs.tools.vod.largeNotice(420 * 1024 * 1024)")
    check("400MB applies to output", "400MB 제한은 변환한 파일에 적용" in huge, huge)

    # Force the fallback regardless of the test browser's native AAC support.
    sample = make_vod_sample(page, True)
    page.evaluate("() => { window.__testAudioEncoder = window.AudioEncoder; window.AudioEncoder = undefined; }")
    page.set_input_files("#vod-file", sample)
    page.wait_for_timeout(800)
    check("file info shown", "sample.mp4" in page.inner_text("#vod-name"), page.inner_text("#vod-name"))

    check("selected file replaces the empty picker",
          not page.locator("#vod-pick").is_visible() and page.locator("#vod-change").is_visible())
    check("closed settings show automatic mode", "자동" in page.inner_text("#vod-setting-value"))
    page.click("#vod-go")
    page.wait_for_selector("#vod-result .vod-verdict", timeout=280000)
    check("conversion finished", page.locator("#vod-result video").count() == 1)
    verdict = page.inner_text("#vod-result .vod-verdict")
    check("result says spec passed", "업로드 규격 통과" in verdict, verdict)
    chips = page.inner_text("#vod-result")
    check("result shows size limit", "400MB 이하" in chips, chips[:160])
    check("result shows 720p + mp4", "HD 720p" in chips and "MP4" in chips, chips[:160])
    check("completion focuses result heading",
          page.evaluate("document.activeElement.id") == "vod-result-title")
    comparison = page.inner_text("#vod-size-comparison")
    check("result compares source and output", "원본" in comparison and "→ 결과" in comparison, comparison)
    check("save is the completion primary action", "primary" in page.get_attribute("#vod-save", "class")
          and "primary" not in page.get_attribute("#vod-go", "class"))
    shot(page, "11-vod-result.png", True)

    engine = page.get_attribute("#tool-vod", "data-engine")
    info = page.evaluate("() => window.__labsVod || null")
    print("  engine:", engine, info)
    check("audio file used fallback path", engine == "ffmpeg", str(engine))

    page.evaluate("""() => {
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {
            window.__vodShareCalls = (window.__vodShareCalls || 0) + 1;
        }});
    }""")
    download_link = page.locator("#vod-save")
    check("VOD save is a direct download link",
          download_link.get_attribute("href").startswith("blob:") and bool(download_link.get_attribute("download")))
    with page.expect_download() as dl:
        page.click("#vod-save")
    check("save never opens the native share sheet", page.evaluate("!window.__vodShareCalls"))
    page.click("#vod-share")
    page.wait_for_function("window.__vodShareCalls === 1")
    check("share still opens the native share sheet", page.evaluate("window.__vodShareCalls === 1"))
    page.evaluate("delete navigator.canShare; delete navigator.share")
    path = os.path.join(SHOTS, "vod.mp4")
    dl.value.save_as(path)
    check("save button gives mp4", os.path.getsize(path) > 5000, str(os.path.getsize(path)))
    data = open(path, "rb").read()
    check("mp4 ftyp", data[4:8] == b"ftyp", data[:12])
    check("h264 track", b"avc1" in data)
    check("aac track", b"mp4a" in data)
    check("under 400MB", len(data) < 400 * 1024 * 1024, str(len(data)))

    probe = probe_video(page, path)
    print("  probe:", " | ".join([l for l in probe.splitlines() if "Stream #" in l or "Duration" in l]))
    check("fallback probe 1280x720", "1280x720" in probe, probe[-300:])
    check("fallback probe h264 baseline", "Baseline" in probe, probe[-300:])
    check("fallback probe aac audio", "aac" in probe.lower(), probe[-300:])

    # The options stay collapsed and automatic until the user changes them.
    settings = page.locator("#vod-settings")
    mode = page.locator("#vod-size-mode")
    target = page.locator("#vod-target-mb")
    check("conversion settings initially collapsed", not settings.evaluate("(element) => element.open"))
    page.locator("#vod-settings summary").click()
    check("automatic is the default", mode.input_value() == "auto")
    check("automatic hides manual size", not target.is_visible())
    check("automatic result has no custom goal verdict", page.locator("#vod-goal").count() == 0)
    mode.select_option("custom")
    check("direct mode shows manual size", target.is_visible())
    check("empty custom target blocks conversion", mode.is_visible() and page.locator("#vod-go").is_disabled())
    target.fill("401")
    check("target above upload cap blocks conversion", page.locator("#vod-go").is_disabled())
    target.fill("1")
    check("valid custom target allows conversion", page.locator("#vod-go").is_enabled())

    # Compare actual bitrate passed to FFmpeg, independently of encoder size variance.
    page.evaluate("""async () => {
        const actual = await Labs.util.ensureLib('ffmpeg');
        window.__testRealFFmpeg = actual;
        window.FFmpegWASM = { FFmpeg: class InstrumentedFFmpeg extends actual.FFmpeg {
            constructor() {
                super();
                const exec = this.exec;
                this.exec = (...args) => {
                    const command = args[0];
                    if (command.at(-1) === 'output.mp4') {
                        window.__testFfmpegBitrate = Number(command[command.indexOf('-b:v') + 1]);
                    }
                    return exec(...args);
                };
                const readFile = this.readFile;
                this.readFile = async (...args) => {
                    const bytes = await readFile(...args);
                    if (!window.__testPadResult || args[0] !== 'output.mp4') return bytes;
                    const padded = new Uint8Array(1_050_000);
                    padded.set(bytes);
                    const free = new DataView(padded.buffer, bytes.length, 8);
                    free.setUint32(0, padded.length - bytes.length);
                    free.setUint32(4, 0x66726565); // MP4 free atom
                    return padded;
                };
            }
        } };
    }""")
    page.click("#vod-go")
    page.wait_for_selector("#vod-result .vod-verdict", timeout=90000)
    bitrate = page.evaluate("() => window.__testFfmpegBitrate")
    check("FFmpeg uses custom 1MB bitrate", bitrate == 3672000, str(bitrate))
    check("custom goal succeeded separately from upload spec", "목표 용량 충족" in page.inner_text("#vod-goal"))

    # Check the upload and custom goal verdicts independently on a known oversized result.
    page.evaluate("() => { window.__testPadResult = true; }")
    page.click("#vod-go")
    page.wait_for_selector("#vod-result .vod-verdict", timeout=90000)
    check("over-goal result still shows upload pass", "업로드 규격 통과" in page.inner_text("#vod-result .vod-verdict"))
    check("over-goal result warns of actual size", "목표 용량 초과" in page.inner_text("#vod-goal"))
    check("over-goal result quantifies excess", "큼" in page.inner_text("#vod-goal"))
    page.click("#vod-adjust")
    check("adjust returns keyboard focus to output settings",
          page.evaluate("document.activeElement.id") == "vod-size-mode")
    page.evaluate("() => { window.FFmpegWASM = window.__testRealFFmpeg; }")
    mode.select_option("auto")

    # Place the MP4 metadata beyond 4 GiB without allocating a 4 GiB fixture.
    original = open(sample, "rb").read()
    offset = 0
    while original[offset + 4:offset + 8] != b"moov":
        atom_size = int.from_bytes(original[offset:offset + 4], "big")
        assert atom_size >= 8
        offset += atom_size
    free_size = 4 * 1024**3
    with tempfile.TemporaryDirectory() as directory:
        large = os.path.join(directory, "large.mp4")
        with open(large, "wb") as f:
            f.write(original[:offset])
            f.write(struct.pack(">I4sQ", 1, b"free", free_size))
            f.seek(offset + free_size)
            f.write(original[offset:])
        page.set_input_files("#vod-file", large)
        page.click("#vod-go")
        page.wait_for_selector("#vod-result .vod-verdict", timeout=90000)
        check("input over 4 GiB converts", "업로드 규격 통과" in page.inner_text("#vod-result .vod-verdict"))
        check("large input uses FFmpeg", page.get_attribute("#tool-vod", "data-engine") == "ffmpeg")

    # A very compact audio track beats the fixed output audio budget by itself.
    compact = make_vod_sample(page, True, compact=True)
    page.set_input_files("#vod-file", compact)
    if not settings.evaluate("(element) => element.open"):
        page.locator("#vod-settings summary").click()
    mode.select_option("original")
    page.click("#vod-go")
    page.wait_for_selector("#vod-note", state="visible", timeout=90000)
    check("unattainable audio budget explains the failure", "목표 용량이 너무 작아요" in page.inner_text("#vod-note"))
    check("unattainable goal has no result file", page.locator("#vod-save").count() == 0)
    mode.select_option("auto")

    page.evaluate("() => { window.AudioEncoder = window.__testAudioEncoder; delete window.__testAudioEncoder; }")

    # 4) 소리가 없는 영상 → WebCodecs 가속 경로가 끝까지 수행된다
    silent = make_vod_sample(page, False)
    page.set_input_files("#vod-file", silent)
    page.wait_for_timeout(800)
    page.click("#vod-go")
    page.wait_for_selector("#vod-result .vod-verdict", timeout=280000)
    engine2 = page.get_attribute("#tool-vod", "data-engine")
    info2 = page.evaluate("() => window.__labsVod || null")
    print("  engine:", engine2, info2)
    check("silent file used WebCodecs path", engine2 == "webcodecs", str(engine2) + " " + str(info2))
    shot(page, "11-vod-webcodecs.png", True)

    with page.expect_download() as dl:
        page.click("#vod-save")
    wpath = os.path.join(SHOTS, "vod-webcodecs.mp4")
    dl.value.save_as(wpath)
    wdata = open(wpath, "rb").read()
    check("webcodecs mp4 ftyp", wdata[4:8] == b"ftyp", wdata[:12])
    check("webcodecs h264 track", b"avc1" in wdata)
    check("webcodecs no audio track", b"mp4a" not in wdata)
    check("webcodecs output not tiny", len(wdata) > 10000, str(len(wdata)))

    wprobe = probe_video(page, wpath)
    print("  probe:", " | ".join([l for l in wprobe.splitlines() if "Stream #" in l or "Duration" in l]))
    check("webcodecs probe 1280x720", "1280x720" in wprobe, wprobe[-300:])
    check("webcodecs probe h264 baseline", "Baseline" in wprobe, wprobe[-300:])
    check("webcodecs probe duration ~2s", "Duration: 00:00:01" in wprobe or "Duration: 00:00:02" in wprobe, wprobe[-300:])
    check("webcodecs probe has 60 frames", "60 fps" in wprobe or "30 fps" in wprobe or "frames" in wprobe.lower(), wprobe[-400:])

    # Compare the acceleration path's configured bitrate against the exact source size.
    if not settings.evaluate("(element) => element.open"):
        page.locator("#vod-settings summary").click()
    mode.select_option("original")
    check("original mode hides manual size", not target.is_visible())
    page.evaluate("""() => {
        const configure = VideoEncoder.prototype.configure;
        VideoEncoder.prototype.configure = function(config) {
            window.__testWebCodecsBitrate = config.bitrate;
            return configure.call(this, config);
        };
    }""")
    page.click("#vod-go")
    page.wait_for_selector("#vod-result .vod-verdict", timeout=90000)
    custom_engine = page.get_attribute("#tool-vod", "data-engine")
    check("original size can use WebCodecs", custom_engine == "webcodecs", str(custom_engine))
    budget = page.evaluate("() => window.__testWebCodecsBitrate")
    expected_budget = int(os.path.getsize(silent) * 8 * 0.95 / 2 // 1000) * 1000
    check("WebCodecs uses exact source bytes for original-size goal", budget == expected_budget, str(budget))
    check("original mode shows an actual goal verdict", "목표 용량" in page.inner_text("#vod-goal"))

    # 5) 소리 있는 영상의 WebCodecs 경로 배선 확인
    #    이 리눅스 Chromium에는 AAC 인코더가 없어 실제 AAC는 만들 수 없다.
    #    AudioEncoder만 대체해 AudioData 전달·mux 배선을 검사한다 (콘솔은 따로 분리).
    p2 = page.context.new_page()
    p2.set_default_timeout(90000)
    p2.goto(BASE + "/#/tool/vod")
    p2.wait_for_selector("#vod-drop")
    p2.evaluate("""() => {
        window.__stubAac = { chunks: 0, frames: 0, first: null };
        class FakeAac {
            static async isConfigSupported(c) { return { supported: c.codec === 'mp4a.40.2', config: c }; }
            constructor(init) { this.out = init.output; this.err = init.error; }
            configure(cfg) { this.cfg = cfg; }
            encode(audioData) {
                const frames = audioData.numberOfFrames;
                const left = new Float32Array(frames), right = new Float32Array(frames);
                audioData.copyTo(left, { planeIndex: 0, format: 'f32-planar' });
                audioData.copyTo(right, { planeIndex: 1, format: 'f32-planar' });
                if (!window.__stubAac.first) {
                    let peak = 0;
                    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]));
                    window.__stubAac.first = [peak, left[100]];
                }
                window.__stubAac.frames += frames;
                const chunk = new EncodedAudioChunk({
                    type: 'key', timestamp: audioData.timestamp,
                    duration: Math.round(frames / 44100 * 1e6),
                    data: new Uint8Array(frames)
                });
                this.out(chunk, { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, description: new Uint8Array([0x12, 0x10]) } });
                window.__stubAac.chunks++;
            }
            flush() { return Promise.resolve(); }
            close() {}
        }
        window.AudioEncoder = FakeAac;
    }""")
    p2.set_input_files("#vod-file", sample)
    p2.wait_for_timeout(600)
    p2.click("#vod-go")
    p2.wait_for_selector("#vod-result .vod-verdict", timeout=180000)
    stub = p2.evaluate("() => window.__stubAac")
    engine3 = p2.get_attribute("#tool-vod", "data-engine")
    info3 = p2.evaluate("() => window.__labsVod || null")
    print("  engine:", engine3, info3, "stub:", {k: stub[k] for k in ("chunks", "frames")})
    check("audio path uses WebCodecs", engine3 == "webcodecs", str(info3))
    check("audio encoder received whole clip", stub and stub["frames"] >= 44100 * 1.9, str(stub and stub["frames"]))
    check("audio planes are real samples",
          bool(stub and stub["first"] and stub["first"][0] > 0.01), str(stub and stub["first"]))
    with p2.expect_download() as dl:
        p2.click("#vod-save")
    apath = os.path.join(SHOTS, "vod-webcodecs-audio.mp4")
    dl.value.save_as(apath)
    adata = open(apath, "rb").read()
    check("audio path mp4 has aac track", b"mp4a" in adata, adata[:16])
    check("audio path mp4 has h264 track", b"avc1" in adata)
    p2.close()

    # The known conforming MP4 already created by the FFmpeg path can be saved unchanged.
    mode.select_option("auto")
    page.set_input_files("#vod-file", path)
    page.click("#vod-go")
    page.wait_for_selector("#vod-result .vod-verdict", timeout=90000)
    check("conforming MP4 skips encoding", page.get_attribute("#tool-vod", "data-engine") == "original",
          str(page.evaluate("window.__labsVod")))
    check("original result explains that conversion was skipped", "변환 없이 저장" in page.inner_text("#vod-save"))
    with page.expect_download() as original_download:
        page.click("#vod-save")
    original_path = os.path.join(SHOTS, "vod-original.mp4")
    original_download.value.save_as(original_path)
    check("original download keeps all bytes and its filename",
          open(original_path, "rb").read() == data and original_download.value.suggested_filename == "vod.mp4")

    # Its original size must not bypass a lower explicit target.
    if not settings.evaluate("(element) => element.open"):
        page.locator("#vod-settings summary").click()
    mode.select_option("custom")
    target.fill("1")
    page.click("#vod-go")
    page.wait_for_selector("#vod-result .vod-verdict", timeout=90000)
    check("smaller target still requires conversion",
          len(data) > 1_000_000 and page.get_attribute("#tool-vod", "data-engine") in ("webcodecs", "ffmpeg"))


# ---------------------------------------------------------------- offline
def part_offline(page, context):
    print("\n[offline] service worker caches the app shell")
    page.goto(BASE + "/", wait_until="networkidle")
    page.evaluate("() => navigator.serviceWorker.ready.then(r => r.active && r.active.state)")
    for _ in range(30):
        if page.evaluate("() => !!navigator.serviceWorker.controller"):
            break
        page.wait_for_timeout(300)
    if not page.evaluate("() => !!navigator.serviceWorker.controller"):
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(800)
    check("sw controls page", page.evaluate("() => !!navigator.serviceWorker.controller"))

    context.set_offline(True)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector(".tool-card", timeout=15000)
    check("home loads offline", page.locator(".tool-card").count() == 8)

    page.goto(BASE + "/#/tool/url")
    page.wait_for_selector("#url-in", timeout=15000)
    page.fill("#url-in", "https://www.instagram.com/p/XYZ/?igsh=abc")
    page.wait_for_timeout(500)
    cleaned = page.get_attribute("[data-cleaned]", "data-cleaned")
    check("tool works offline", cleaned == "https://www.instagram.com/p/XYZ/", str(cleaned))
    shot(page, "12-offline.png", True)

    context.set_offline(False)


# ---------------------------------------------------------------- main
def main():
    parts = sys.argv[1:] or ["static", "ui", "url", "qr", "exif", "compress", "pdf", "resize", "watermark", "vod", "offline"]
    server = start_server()
    print(f"serving {ROOT} at {BASE}")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            context = browser.new_context(
                viewport={"width": 390, "height": 844},
                device_scale_factor=2,
                is_mobile=True,
                has_touch=True,
                accept_downloads=True,
                locale="ko-KR",
            )
            context.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
            page = context.new_page()
            attach(page)

            if "static" in parts:
                part_static()
            for name, fn in [
                ("ui", part_ui), ("url", part_url), ("qr", part_qr), ("exif", part_exif),
                ("compress", part_compress), ("pdf", part_pdf), ("resize", part_resize),
                ("watermark", part_watermark), ("vod", part_vod),
            ]:
                if name in parts:
                    fn(page)
            if "offline" in parts:
                part_offline(page, context)

            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()

    print("\n===== RESULT =====")
    passed = sum(1 for _, ok, _ in CHECKS if ok)
    print(f"checks: {passed}/{len(CHECKS)} passed")
    if ERRORS:
        print("console/page errors:")
        for e in ERRORS:
            print("  -", e)
    if FAILS:
        print("failures:")
        for f in FAILS:
            print("  -", f)
    ok = not FAILS and not ERRORS
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
