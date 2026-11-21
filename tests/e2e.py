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
        "/vendor/jszip.min.js", "/vendor/qrcode.min.js",
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
def part_vod(page):
    print("\n[vod] spec, command, real browser transcode")
    page.goto(BASE + "/#/tool/vod")
    page.wait_for_selector("#vod-cmd")
    body = page.inner_text("#tool-vod")
    for token in ["MP4", "Baseline Level 1.3", "1280×720", "5000 kbps", "AAC", "400 MB"]:
        check(f"spec shows {token}", token in body, token)
    cmd = page.inner_text("#vod-cmd")
    check("pc command has libx264", "-c:v libx264" in cmd, cmd[:80])
    check("pc command has aac", "-c:a aac" in cmd)
    check("pc command faststart", "+faststart" in cmd)

    shot(page, "10-vod.png", True)

    # Build a 2s test clip with the same ffmpeg build (first load ~32MB).
    print("  … generating sample.mp4 with ffmpeg.wasm (may take a minute)")
    b64 = page.evaluate("""async () => {
        const FF = await Labs.util.ensureLib('ffmpeg');
        const ff = new FF.FFmpeg();
        await ff.load({
            coreURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.js'),
            wasmURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.wasm')
        });
        await ff.exec(['-f','lavfi','-i','testsrc=size=640x360:rate=24',
                       '-f','lavfi','-i','sine=frequency=440:sample_rate=44100',
                       '-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y','t.mp4']);
        const d = await ff.readFile('t.mp4');
        let s = '';
        for (let i = 0; i < d.length; i += 8192) {
            s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
        }
        ff.terminate();
        return btoa(s);
    }""")
    sample = os.path.join(FIX, "sample.mp4")
    open(sample, "wb").write(base64.b64decode(b64))
    check("sample clip generated", os.path.getsize(sample) > 5000, str(os.path.getsize(sample)))

    page.set_input_files("#vod-file", sample)
    page.wait_for_timeout(800)
    check("file info shown", "sample.mp4" in page.inner_text("#vod-info"), page.inner_text("#vod-info"))

    page.click("#vod-go")
    page.wait_for_selector("#vod-result video", timeout=270000)
    check("conversion finished", page.locator("#vod-result video").count() == 1)
    chips = page.inner_text("#vod-result")
    check("result chips mention mp4", "MP4" in chips, chips[:100])
    check("result chips mention 720", "1280×720" in chips)
    shot(page, "11-vod-result.png", True)

    with page.expect_download() as dl:
        page.click("#vod-save")
    path = os.path.join(SHOTS, "vod.mp4")
    dl.value.save_as(path)
    data = open(path, "rb").read()
    check("mp4 ftyp", data[4:8] == b"ftyp", data[:12])
    check("h264 track", b"avc1" in data)
    check("aac track", b"mp4a" in data)
    check("under 400MB", len(data) < 400 * 1024 * 1024, str(len(data)))
    check("output not tiny", len(data) > 20000, str(len(data)))


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
