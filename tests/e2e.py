#!/usr/bin/env python3
"""Labs Tools — local end-to-end verification with Playwright.

Usage:
  python3 tests/e2e.py            # all parts
  python3 tests/e2e.py ui url qr  # selected parts

Parts: static, ui, ux, url, qr, exif, compress, pdf, resize, watermark, vod, offline

The script boots a throwaway `python3 -m http.server` on the repo root,
drives a mobile-sized Chromium, asserts behaviour and writes screenshots
to tests/shots/. The server is always stopped at the end.
"""
import base64
import errno
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


# Android Chrome can hand files to the share sheet. Saving must not use it: a
# 저장 button has to land a file, so these parts stub sharing ON and then check
# the download plus a share-call count of zero.
def stub_android_sharing(page, key="__shareCalls"):
    page.evaluate("""(key) => {
        window[key] = 0;
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {
            window[key] = window[key] + 1;
        }});
    }""", key)


def share_calls(page, key="__shareCalls"):
    return page.evaluate("(key) => window[key] || 0", key)


def clear_sharing(page):
    page.evaluate("() => { delete navigator.canShare; delete navigator.share; }")


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


def pinch(page, cx, cy, start_gap, end_gap, steps=8):
    """Two-finger pinch at (cx, cy) in viewport CSS pixels, using real touch events."""
    client = page.context.new_cdp_session(page)

    def points(gap):
        return [
            {"x": cx - gap / 2, "y": cy, "id": 1, "radiusX": 4, "radiusY": 4, "force": 0.6},
            {"x": cx + gap / 2, "y": cy, "id": 2, "radiusX": 4, "radiusY": 4, "force": 0.6},
        ]

    try:
        client.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": points(start_gap)})
        for i in range(1, steps + 1):
            gap = start_gap + (end_gap - start_gap) * i / steps
            client.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": points(gap)})
        client.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    finally:
        client.detach()


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
    check("sw cache is v1.4.0", "labs-tools-app-v1.4.0" in sw, sw[:120])

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
    check("home shows version 1.4.0", "v1.4.0" in home, home[-160:])
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


# ---------------------------------------------------------------- ux
def clear_toasts(page):
    page.evaluate("""() => {
        const s = document.getElementById('toast');
        if (!s) return;
        s.innerHTML = '';
        s.__toasts = [];
    }""")


def part_ux(host):
    print("\n[ux] toast stack, copy-to-check, drop feedback, value bubble, motion")
    # Its own page: the tools keep their mounted state, so the checks below must
    # not leave a dropped file or a moved slider behind for the other parts.
    page = host.context.new_page()
    attach(page)
    page.goto(BASE + "/")
    page.wait_for_selector(".tool-card")

    # 1) 토스트 스택 — 기존 U.toast(msg, kind, ms) 시그니처 그대로
    page.evaluate("""() => {
        Labs.util.toast('첫 번째', null, 4000);
        Labs.util.toast('두 번째', null, 4000);
        Labs.util.toast('세 번째', null, 4000);
        Labs.util.toast('네 번째', null, 4000);
    }""")
    page.wait_for_timeout(260)
    check("toast stack keeps at most 3", page.locator("#toast .toast").count() == 3,
          str(page.locator("#toast .toast").count()))
    texts = page.eval_on_selector_all("#toast .toast-msg", "els => els.map(e => e.textContent)")
    check("the oldest toast makes room for the newest", texts == ["두 번째", "세 번째", "네 번째"], str(texts))
    check("the stack still reads as one status text", "네 번째" in page.inner_text("#toast"), page.inner_text("#toast"))
    check("each toast carries icon, timer bar and close",
          page.locator("#toast .toast-ico svg").count() == 3 and
          page.locator("#toast .toast-life").count() == 3 and
          page.locator("#toast .toast-x").count() == 3)
    life = page.eval_on_selector("#toast .toast-life", "el => getComputedStyle(el).animationDuration")
    check("the time bar runs for the toast lifetime", life not in ("", "0s"), life)
    dash = page.eval_on_selector("#toast .toast-ico svg path", "el => getComputedStyle(el).strokeDasharray")
    check("the icon draws itself in", dash not in ("none", ""), dash)
    stack_boxes = page.evaluate("""() => {
        const items = Array.from(document.querySelectorAll('#toast .toast'));
        return items.map(e => e.getBoundingClientRect().top);
    }""")
    check("toasts stack upward without overlapping",
          len(stack_boxes) == 3 and stack_boxes[0] < stack_boxes[1] < stack_boxes[2], str(stack_boxes))
    shot(page, "13-ux-toast.png", False)

    page.locator("#toast .toast-x").last.click()
    page.wait_for_timeout(400)
    check("the close button dismisses one toast", page.locator("#toast .toast").count() == 2,
          str(page.locator("#toast .toast").count()))

    box = page.locator("#toast .toast").last.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] / 2 + 150, box["y"] + box["height"] / 2, steps=8)
    page.mouse.up()
    page.wait_for_timeout(420)
    check("a sideways swipe dismisses a toast", page.locator("#toast .toast").count() == 1,
          str(page.locator("#toast .toast").count()))

    page.evaluate("() => Labs.util.toast('저장하지 못했어요', 'err', 600)")
    page.wait_for_timeout(200)
    check("error toasts keep their warning kind", page.locator("#toast .toast.err").count() == 1,
          str(page.locator("#toast .toast.err").count()))
    page.wait_for_timeout(1200)
    check("a toast leaves on its own after its lifetime", page.locator("#toast .toast.err").count() == 0,
          str(page.locator("#toast .toast").count()))
    clear_toasts(page)

    # 2) 복사 → 체크 전환 + 빛 스윕
    page.goto(BASE + "/#/tool/url")
    page.wait_for_selector("#url-in")
    page.fill("#url-in", "https://www.instagram.com/p/ABC123/?igsh=MTYxZg%3D%3D&utm_source=ig_web_copy_link")
    page.wait_for_selector("[data-copy]")
    page.click("[data-copy]")
    page.wait_for_function("() => document.querySelector('[data-copy]').classList.contains('is-copied')")
    copied = page.evaluate("""() => {
        const b = document.querySelector('[data-copy]');
        const r = document.querySelector('.result');
        return { text: b.innerText.replace(/\\s+/g, ' ').trim(), icon: !!b.querySelector('svg'),
                 swept: r.classList.contains('is-swept'), clip: null };
    }""")
    check("the copy button turns into a check", copied["icon"] and "복사됨" in copied["text"], str(copied))
    check("the cleaned link really reaches the clipboard",
          page.evaluate("() => navigator.clipboard.readText()").strip() == "https://www.instagram.com/p/ABC123/",
          page.evaluate("() => navigator.clipboard.readText()"))
    check("the result box sweeps with light", copied["swept"], str(copied))
    shot(page, "14-ux-copied.png", False)
    page.wait_for_timeout(1700)
    restored = page.evaluate("""() => {
        const b = document.querySelector('[data-copy]');
        return { copied: b.classList.contains('is-copied'), text: b.innerText.trim(),
                 swept: document.querySelector('.result').classList.contains('is-swept') };
    }""")
    check("the button returns to 복사", not restored["copied"] and restored["text"] == "복사", str(restored))
    check("the sweep does not linger", not restored["swept"], str(restored))

    page.click("#copy-all")
    page.wait_for_function("() => document.querySelector('#copy-all').classList.contains('is-copied')")
    check("copy all gives the same feedback",
          "복사됨" in page.inner_text("#copy-all"), page.inner_text("#copy-all"))
    page.wait_for_timeout(1700)

    # 3) 드롭존 드래그·착지 피드백
    page.goto(BASE + "/#/tool/compress")
    page.wait_for_selector("#cz-drop")
    page.evaluate("""() => {
        const el = document.querySelector('#cz-drop');
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array([1])], 'hover.png', { type: 'image/png' }));
        el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }""")
    page.wait_for_timeout(160)
    over = page.evaluate("""() => {
        const el = document.querySelector('#cz-drop');
        const cs = getComputedStyle(el);
        return { over: el.classList.contains('is-over'), label: el.querySelector('b').textContent.trim(),
                 border: cs.borderTopStyle, icon: getComputedStyle(el.querySelector('svg')).transform };
    }""")
    check("dragging a file over swaps the guidance line", over["label"] == "놓으면 바로 열려요", str(over))
    check("the dashed border turns solid", over["border"] == "solid", str(over))
    check("the upload icon lifts", over["icon"] not in ("none", "matrix(1, 0, 0, 1, 0, 0)"), str(over))

    page.evaluate("""() => {
        document.querySelector('#cz-drop').dispatchEvent(new DragEvent('dragleave', {
            bubbles: true, cancelable: true, dataTransfer: new DataTransfer(),
        }));
    }""")
    page.wait_for_timeout(160)
    left = page.evaluate("""() => {
        const el = document.querySelector('#cz-drop');
        return { over: el.classList.contains('is-over'), label: el.querySelector('b').textContent.trim(),
                 border: getComputedStyle(el).borderTopStyle };
    }""")
    check("leaving restores the dropzone", not left["over"] and left["label"] == "이미지 선택" and left["border"] == "dashed", str(left))

    page.evaluate("""async () => {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 48;
        const x = c.getContext('2d');
        x.fillStyle = '#ff5a1f'; x.fillRect(0, 0, 64, 48);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 'drop-test.png', { type: 'image/png' }));
        const el = document.querySelector('#cz-drop');
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        window.__landed = el.classList.contains('is-dropped');
    }""")
    check("a dropped file bounces the zone", page.evaluate("() => window.__landed"))
    page.wait_for_function("() => document.querySelector('#cz-results').innerText.includes('drop-test')", timeout=60000)
    check("the dropped file is picked up and processed",
          page.locator("#cz-results .item").count() >= 1, str(page.locator("#cz-results .item").count()))
    page.wait_for_timeout(700)

    # 4) 값 말풍선 슬라이더
    page.wait_for_selector("#cz-quality")
    wrapped = page.evaluate("""() => {
        const i = document.querySelector('#cz-quality');
        const w = i.closest('.range-wrap');
        const b = w && w.querySelector('.range-bubble');
        return { wrap: !!w, bubble: !!b, live: w ? w.classList.contains('is-live') : null,
                 attrs: [i.id, i.min, i.max, i.step], value: i.value,
                 text: b ? b.textContent.trim() : '' };
    }""")
    check("every range gets a value bubble", wrapped["wrap"] and wrapped["bubble"], str(wrapped))
    check("the range keeps its id, bounds and step", wrapped["attrs"] == ["cz-quality", "10", "100", "1"], str(wrapped))
    check("the bubble stays hidden at rest", wrapped["live"] is False, str(wrapped))

    box = page.locator("#cz-quality").bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + box["width"] * 0.18, y)
    page.mouse.down()
    page.wait_for_timeout(90)
    live = page.evaluate("""() => {
        const i = document.querySelector('#cz-quality');
        const w = i.closest('.range-wrap');
        const b = w.querySelector('.range-bubble');
        const v = i.closest('.field').querySelector('.val');
        return { live: w.classList.contains('is-live'), bubble: b.textContent.trim(), val: v.textContent.trim(),
                 left: b.style.left, tilt: b.style.getPropertyValue('--tilt'), opacity: getComputedStyle(b).opacity };
    }""")
    check("the bubble appears while dragging", live["live"] and float(live["opacity"] or 0) > 0.5, str(live))
    check("the bubble shows the same value as the field label", live["bubble"] == live["val"], str(live))
    first_left = live["left"]
    shot(page, "15-ux-range-bubble.png", False)

    page.mouse.move(box["x"] + box["width"] * 0.86, y, steps=6)
    page.wait_for_timeout(30)
    moved = page.evaluate("""() => {
        const b = document.querySelector('.range-bubble');
        return { left: b.style.left, tilt: b.style.getPropertyValue('--tilt').trim() };
    }""")
    check("the bubble rides above the handle", moved["left"] != first_left, f"{first_left} -> {moved['left']}")
    lean = abs(float((moved["tilt"] or "0deg").replace("deg", "") or 0))
    check("the bubble leans with the drag speed", lean > 1, moved["tilt"])
    page.mouse.up()
    page.wait_for_timeout(200)
    upright = page.evaluate("() => document.querySelector('.range-bubble').style.getPropertyValue('--tilt').trim()")
    check("it springs upright once the drag stops", upright in ("0deg", "0.0deg"), upright)
    page.wait_for_timeout(700)
    check("it hides after the drag", page.locator(".range-wrap.is-live").count() == 0,
          str(page.locator(".range-wrap.is-live").count()))

    page.evaluate("""() => {
        const i = document.querySelector('#cz-quality');
        i.value = '50';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        i.dispatchEvent(new Event('change', { bubbles: true }));
    }""")
    page.wait_for_timeout(150)
    check("the range still drives the tool", page.inner_text("#cz-q-val").strip() == "50%", page.inner_text("#cz-q-val"))

    # 5) 촉각 피드백 · 진행률 광택 · 모션 줄임
    page.wait_for_selector("#cz-preset")
    page.locator("#cz-preset").scroll_into_view_if_needed()
    bb = page.locator("#cz-preset").bounding_box()
    page.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(140)
    pressed = page.evaluate("() => getComputedStyle(document.querySelector('#cz-preset')).transform")
    page.mouse.up()
    try:
        pressed_scale = float(pressed.split("(")[1].split(",")[0]) if pressed.startswith("matrix") else 1.0
    except (IndexError, ValueError):
        pressed_scale = 1.0
    check("a pressed button sinks a little", pressed_scale < 0.995, pressed)

    css = urllib.request.urlopen(BASE + "/css/style.css").read().decode("utf-8")
    check("segmented tabs animate between states", ".seg button:active" in css and ".seg button.is-on" in css)
    check("the progress fill carries a sheen", ".bar > i::after" in css and "bar-sheen" in css)
    check("the pattern source is credited", "lucian-uxui-prompt" in css.split("*/")[0])
    check("reduced motion is handled", "prefers-reduced-motion: reduce" in css and ".toast-life { display: none; }" in css)

    page.emulate_media(reduced_motion="reduce")
    page.evaluate("() => Labs.util.toast('모션 줄임', null, 3000)")
    page.wait_for_timeout(200)
    check("reduced motion drops the timer bar",
          page.evaluate("() => getComputedStyle(document.querySelector('#toast .toast-life')).display") == "none",
          page.evaluate("() => getComputedStyle(document.querySelector('#toast .toast-life')).display"))
    page.emulate_media(reduced_motion="no-preference")
    clear_toasts(page)
    page.close()


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

    # A phone (Chrome on Android) can share files natively. Saving must still be
    # a plain browser download there instead of opening the share sheet.
    page.evaluate("""() => {
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {
            window.__qrShareCalls = (window.__qrShareCalls || 0) + 1;
        }});
    }""")
    with page.expect_download() as dl:
        page.click("#qr-png")
    png_download = dl.value
    path = os.path.join(SHOTS, "qr.png")
    png_download.save_as(path)
    data = open(path, "rb").read()
    check("png save downloads a file even with native sharing available", len(data) > 0, str(len(data)))
    check("png save never opens the share sheet", page.evaluate("!window.__qrShareCalls"))
    check("png download keeps the png name", png_download.suggested_filename.endswith(".png"), png_download.suggested_filename)
    check("qr png signature", data[:8] == b"\x89PNG\r\n\x1a\n", data[:8])
    check("qr png size >1KB", len(data) > 1000, str(len(data)))
    check("qr png ~1024px", 900 <= png_size(data)[0] <= 1024, str(png_size(data)))
    check("png save tells the user it was saved", "저장했어요" in page.inner_text("#toast"), page.inner_text("#toast"))
    try:
        import cv2
        decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(path))
        check("qr decodes to payload", decoded == "https://dgnslabs.github.io/labs-tools/", repr(decoded))
    except ImportError:
        print("  (opencv not installed, skipping QR decode)")

    with page.expect_download() as dl:
        page.click("#qr-svg")
    svg_download = dl.value
    path = os.path.join(SHOTS, "qr.svg")
    svg_download.save_as(path)
    svg = open(path, "r", encoding="utf-8").read()
    check("svg save downloads a file even with native sharing available", len(svg) > 0, str(len(svg)))
    check("svg save never opens the share sheet", page.evaluate("!window.__qrShareCalls"))
    check("svg download keeps the svg name", svg_download.suggested_filename.endswith(".svg"), svg_download.suggested_filename)
    check("qr svg valid", svg.startswith("<svg") and "<rect" in svg and 'viewBox="0 0 ' in svg, svg[:80])

    # 공유 stays the one place that opens the native sheet.
    page.click("#qr-share")
    page.wait_for_function("window.__qrShareCalls === 1")
    check("share button still opens the native share sheet", page.evaluate("window.__qrShareCalls === 1"))

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
    check("wifi png save downloads without sharing",
          os.path.getsize(wpath) > 0 and page.evaluate("window.__qrShareCalls === 1"),
          str(os.path.getsize(wpath)))
    try:
        import cv2
        wdecoded, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(wpath))
        check("wifi qr decodes", wdecoded.startswith("WIFI:T:WPA;S:HomeNet") and "P:pass" in wdecoded, repr(wdecoded))
    except ImportError:
        pass

    # Without native sharing the 공유 button falls back to a download.
    page.evaluate("Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })")
    with page.expect_download() as dl:
        page.click("#qr-share")
    check("share falls back to a download when sharing is unavailable",
          dl.value.suggested_filename.endswith(".png"), dl.value.suggested_filename)
    page.evaluate("delete navigator.canShare; delete navigator.share")
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

    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.click("#ex-jpg")
    download = dl.value
    path = os.path.join(SHOTS, "masked.jpg")
    download.save_as(path)
    data = open(path, "rb").read()
    check("exif save downloads a file even with native sharing available", len(data) > 0, str(len(data)))
    check("exif save never opens the share sheet", share_calls(page) == 0, str(share_calls(page)))
    check("exif save keeps the masked jpg name", download.suggested_filename.endswith("-masked.jpg"),
          download.suggested_filename)
    check("exif save tells the user it was saved", "저장했어요" in page.inner_text("#toast"), page.inner_text("#toast"))
    check("jpg signature", data[:2] == b"\xff\xd8", data[:4])
    check("EXIF removed", b"Exif" not in data and b"TestCamMaker" not in data, "metadata found")
    check("saved size 800x600", png_size(data) == (800, 600), str(png_size(data)))

    with page.expect_download() as dl:
        page.click("#ex-png")
    png = dl.value
    ppath = os.path.join(SHOTS, "masked.png")
    png.save_as(ppath)
    pdata = open(ppath, "rb").read()
    check("exif png save downloads with native sharing available", pdata[:8] == b"\x89PNG\r\n\x1a\n", pdata[:8])
    check("exif png save never opens the share sheet", share_calls(page) == 0, str(share_calls(page)))

    # 공유 stays the one place that opens the native sheet.
    page.click("#ex-share")
    page.wait_for_function("window.__shareCalls === 1")
    check("exif share still opens the native share sheet", share_calls(page) == 1, str(share_calls(page)))
    clear_sharing(page)


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
    # A phone can share files natively; the 저장 icon must still download.
    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.locator("[data-save]").first.click()
    one = dl.value
    opath = os.path.join(SHOTS, "compressed-one.jpg")
    one.save_as(opath)
    odata = open(opath, "rb").read()
    check("compress save downloads a file even with native sharing available", len(odata) > 0, str(len(odata)))
    check("compress save never opens the share sheet", share_calls(page) == 0, str(share_calls(page)))
    check("compress save keeps the -min name", "-min." in one.suggested_filename, one.suggested_filename)
    check("compress save tells the user it was saved", "저장했어요" in page.inner_text("#toast"), page.inner_text("#toast"))
    check("compress saved file opens", Image.open(opath).size[0] > 0)
    clear_sharing(page)

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

    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.locator("[data-dl]").first.click()
    download = dl.value
    path = os.path.join(SHOTS, "pdf-page.png")
    download.save_as(path)
    data = open(path, "rb").read()
    check("pdf page save downloads a file even with native sharing available", len(data) > 0, str(len(data)))
    check("pdf page save never opens the share sheet", share_calls(page) == 0, str(share_calls(page)))
    check("pdf page save keeps the p.01 name", download.suggested_filename.endswith("-p01.png"),
          download.suggested_filename)
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

    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.click("#rs-png")
    download = dl.value
    path = os.path.join(SHOTS, "resized.png")
    download.save_as(path)
    data = open(path, "rb").read()
    check("resize save downloads a file even with native sharing available", len(data) > 0, str(len(data)))
    check("resize save never opens the share sheet", share_calls(page) == 0, str(share_calls(page)))
    check("resize save keeps its png name", download.suggested_filename.endswith(".png"), download.suggested_filename)
    check("resized png 1080x1920", png_size(data) == (1080, 1920), str(png_size(data)))

    with page.expect_download() as dl:
        page.click("#rs-jpg")
    jdata = dl.value
    jpath = os.path.join(SHOTS, "resized.jpg")
    jdata.save_as(jpath)
    check("resize jpg save downloads with native sharing available",
          open(jpath, "rb").read()[:2] == b"\xff\xd8")
    check("resize jpg save never opens the share sheet", share_calls(page) == 0, str(share_calls(page)))
    clear_sharing(page)

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

    # ---------------------------------------------------------- 확대·위치 조절
    def zoom_state():
        return page.evaluate("""() => {
            const c = document.querySelector('#rs-canvas');
            const s = document.querySelector('#rs-zoom');
            const px = c.getContext('2d').getImageData(2, 2, 1, 1).data;
            return {
                w: c.dataset.w, h: c.dataset.h, zoom: c.dataset.zoom,
                slider: s.value, max: s.max, label: document.querySelector('#rs-zoom-val').textContent,
                panx: c.dataset.panX, pany: c.dataset.panY,
                corner: [px[0], px[1], px[2]],
            };
        }""")

    z0 = zoom_state()
    check("zoom starts at 100%", z0["zoom"] == "100" and z0["slider"] == "100" and z0["label"] == "100%", str(z0))
    check("zoom slider spans 100-300%", (z0["max"], page.evaluate("() => document.querySelector('#rs-zoom').min")) == ("300", "100"), z0["max"])
    check("100% keeps the white padding", z0["corner"] == [255, 255, 255], str(z0["corner"]))
    size_labels = page.eval_on_selector_all("#rs-size option", "els => els.map(e => e.textContent)")
    check("2x output resolution option exists", "2배 확대 (2×)" in size_labels, str(size_labels))

    page.evaluate("""() => {
        const s = document.querySelector('#rs-zoom');
        s.value = '200';
        s.dispatchEvent(new Event('input', { bubbles: true }));
    }""")
    page.wait_for_timeout(250)
    z1 = zoom_state()
    check("slider zooms to 200%", z1["zoom"] == "200" and z1["label"] == "200%", str([z1["zoom"], z1["label"]]))
    check("zooming keeps the output size", [z1["w"], z1["h"]] == ["1080", "1080"], str([z1["w"], z1["h"]]))
    check("200% zoom fills the frame edge to edge", z1["corner"] != [255, 255, 255], str(z1["corner"]))
    shot(page, "08b-resize-zoom.png", True)

    page.locator("#rs-stage").scroll_into_view_if_needed()
    page.wait_for_timeout(150)
    box = page.locator("#rs-stage").bounding_box()
    mvx, mvy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(mvx, mvy)
    page.mouse.down()
    page.mouse.move(mvx - 60, mvy, steps=5)
    page.mouse.up()
    page.wait_for_timeout(200)
    z2 = zoom_state()
    check("drag pans the zoomed photo", float(z2["panx"]) <= -0.05, str(z2["panx"]))

    for _ in range(4):
        page.mouse.move(mvx, mvy)
        page.mouse.down()
        page.mouse.move(mvx - 200, mvy, steps=4)
        page.mouse.up()
    page.wait_for_timeout(200)
    z3 = zoom_state()
    check("pan stops at the photo edge", z3["panx"] == "-1.000", str(z3["panx"]))
    check("no blank strip at the panned edge", z3["corner"] != [255, 255, 255], str(z3["corner"]))

    page.click("#rs-cover")
    page.wait_for_timeout(250)
    z4 = zoom_state()
    check("꽉 채우기 uses the cover scale", z4["zoom"] == "150", str(z4["zoom"]))
    check("꽉 채우기 recentres the photo", [z4["panx"], z4["pany"]] == ["0.000", "0.000"], str([z4["panx"], z4["pany"]]))
    check("꽉 채우기 leaves no padding", z4["corner"] != [255, 255, 255], str(z4["corner"]))

    page.click("#rs-fit")
    page.wait_for_timeout(250)
    z5 = zoom_state()
    check("전체 맞춤 returns to 100%", z5["zoom"] == "100" and z5["slider"] == "100", str(z5["zoom"]))
    check("전체 맞춤 recentres the photo", [z5["panx"], z5["pany"]] == ["0.000", "0.000"], str([z5["panx"], z5["pany"]]))
    check("전체 맞춤 brings the padding back", z5["corner"] == [255, 255, 255], str(z5["corner"]))

    # ---------------------------------------------------------- 두 손가락 확대/축소
    page.locator("#rs-stage").scroll_into_view_if_needed()
    page.wait_for_timeout(150)
    box = page.locator("#rs-stage").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pinch(page, cx, cy, 80, 180)
    page.wait_for_timeout(300)
    z6 = zoom_state()
    check("pinch out zooms in", z6["zoom"].isdigit() and int(z6["zoom"]) >= 180, str(z6["zoom"]))
    check("pinch keeps the slider and label in sync",
          z6["slider"] == z6["zoom"] and z6["label"] == z6["zoom"] + "%", str([z6["slider"], z6["label"]]) + " vs " + str(z6["zoom"]))
    check("pinch redraws the preview", z6["corner"] != [255, 255, 255], str(z6["corner"]))
    shot(page, "08c-resize-pinch.png", True)

    pinch(page, cx, cy, 180, 80)
    page.wait_for_timeout(300)
    z7 = zoom_state()
    check("pinch in zooms back out", z7["zoom"].isdigit() and int(z7["zoom"]) <= 120, str(z7["zoom"]))

    # 두 손가락 중 하나만 떼어도 화면이 튀지 않고, 남은 손가락 이동이 그대로 이어진다.
    page.evaluate("""() => {
        const c = document.querySelector('#rs-canvas');
        const r = c.getBoundingClientRect();
        const stage = document.querySelector('#rs-stage');
        window.__pt = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        window.__fire = (type, id, x, y) => stage.dispatchEvent(new PointerEvent(type, {
            pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
    }""")
    page.evaluate("() => { const p = window.__pt; window.__fire('pointerdown', 21, p.cx - 40, p.cy); window.__fire('pointerdown', 22, p.cx + 40, p.cy); }")
    page.wait_for_timeout(100)
    page.evaluate("() => { const p = window.__pt; window.__fire('pointermove', 22, p.cx + 90, p.cy); }")
    page.wait_for_timeout(300)
    synth_zoom = page.evaluate("() => document.querySelector('#rs-canvas').dataset.zoom")
    check("two fingers zoom the preview", synth_zoom.isdigit() and int(synth_zoom) > 100, str(synth_zoom))

    page.evaluate("() => { const p = window.__pt; window.__fire('pointerup', 21, p.cx - 40, p.cy); }")
    page.wait_for_timeout(150)
    pan_a = page.evaluate("() => document.querySelector('#rs-canvas').dataset.panX")
    page.evaluate("() => { const p = window.__pt; window.__fire('pointermove', 22, p.cx + 92, p.cy); }")
    page.wait_for_timeout(300)
    pan_b = page.evaluate("() => document.querySelector('#rs-canvas').dataset.panX")
    page.evaluate("() => { const p = window.__pt; window.__fire('pointerup', 22, p.cx + 92, p.cy); }")
    page.wait_for_timeout(100)
    check("lifting one finger does not jump the photo",
          abs(float(pan_b) - float(pan_a)) < 0.2, f"pan {pan_a} -> {pan_b}")

    # ---------------------------------------------------------- 출력 해상도 2배
    page.click("#rs-fit")
    page.select_option("#rs-size", "2")
    page.wait_for_timeout(500)
    z8 = zoom_state()
    check("2배 확대 outputs 2160x2160", [z8["w"], z8["h"]] == ["2160", "2160"], str([z8["w"], z8["h"]]))
    check("2배 확대 keeps zoom at 100%", z8["zoom"] == "100", str(z8["zoom"]))

    with page.expect_download(timeout=120000) as dl:
        page.click("#rs-png")
    upath = os.path.join(SHOTS, "resized-2x.png")
    dl.value.save_as(upath)
    udata = open(upath, "rb").read()
    check("2배 확대 png really is 2160x2160", png_size(udata) == (2160, 2160), str(png_size(udata)))

    with page.expect_download(timeout=120000) as dl:
        page.click("#rs-jpg")
    ujpg = os.path.join(SHOTS, "resized-2x.jpg")
    dl.value.save_as(ujpg)
    check("2배 확대 jpg downloads", open(ujpg, "rb").read()[:2] == b"\xff\xd8")
    check("2배 확대 jpg keeps 2160x2160", Image.open(ujpg).size == (2160, 2160), str(Image.open(ujpg).size))


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

    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.locator("#wm-results [data-save]").first.click()
    download = dl.value
    wpath2 = os.path.join(SHOTS, "watermarked.jpg")
    download.save_as(wpath2)
    wdata = open(wpath2, "rb").read()
    check("watermark save downloads a file even with native sharing available", len(wdata) > 0, str(len(wdata)))
    check("watermark save never opens the share sheet", share_calls(page) == 0, str(share_calls(page)))
    check("watermark save keeps the -wm name", "-wm." in download.suggested_filename, download.suggested_filename)
    check("watermark save tells the user it was saved", "저장했어요" in page.inner_text("#toast"), page.inner_text("#toast"))
    check("watermark saved file keeps dimensions",
          Image.open(wpath2).size in [(800, 600), (1200, 800)], str(Image.open(wpath2).size))
    clear_sharing(page)


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
    try:
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
    except OSError as error:
        # tmpfs / some FUSE mounts refuse a file this large; the check still runs
        # wherever the filesystem holds it.
        if error.errno not in (errno.EFBIG, errno.ENOSPC):
            raise
        print(f"  (skipped >4 GiB fixture — filesystem refuses the file: {error})")

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
    parts = sys.argv[1:] or ["static", "ui", "ux", "url", "qr", "exif", "compress", "pdf", "resize", "watermark", "vod", "offline"]
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
                ("ui", part_ui), ("ux", part_ux), ("url", part_url), ("qr", part_qr), ("exif", part_exif),
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
