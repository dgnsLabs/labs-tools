#!/usr/bin/env python3
"""Labs Tools — GitHub Pages 라이브 검증.

python3 tests/live.py         # 전체 (홈·QR·VOD 변환)
python3 tests/live.py saves   # 저장 버튼 5종만 빠르게

배포된 https://dgnslabs.github.io/labs-tools/ 를 열어 홈 라벨·버전, VOD 화면,
WebCodecs 실제 변환과 ffmpeg 폴백 경로를 확인하고 tests/shots/live-*.png 를 남깁니다.
(로컬 fixtures가 필요합니다. tests/e2e.py 를 한 번 돌리면 만들어집니다.)
"""
import base64
import os
import sys

from playwright.sync_api import sync_playwright

LIVE = "https://dgnslabs.github.io/labs-tools/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "shots")
FIX = os.path.join(ROOT, "tests", "fixtures")
os.makedirs(SHOTS, exist_ok=True)

CHECKS = []
ERRORS = []


def check(name, cond, detail=""):
    CHECKS.append((name, bool(cond)))
    print(("  ✓ " if cond else "  ✗ ") + name + ("" if cond else f" — {detail}"))


def stub_android_sharing(page):
    """Android Chrome can share files. Saving must download anyway."""
    page.evaluate("""() => {
        window.__shareCalls = 0;
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
        Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {
            window.__shareCalls = window.__shareCalls + 1;
        }});
    }""")


def clear_sharing(page):
    page.evaluate("() => { delete navigator.canShare; delete navigator.share; }")


def part_save_buttons(page):
    """Every tool's 저장 button lands a file, share sheet or not."""
    print("\n[saves] 저장 buttons download on the live site")
    page.goto(LIVE + "#/tool/exif")
    page.wait_for_selector("#ex-file", state="attached")
    helpers = page.evaluate("() => ({sync: typeof Labs.util.canvasBlobSync, legacy: typeof Labs.util.saveOrShare})")
    check("live build has the sync canvas encoder", helpers["sync"] == "function", str(helpers))
    check("live build has no share-on-save helper", helpers["legacy"] == "undefined", str(helpers))
    page.set_input_files("#ex-file", os.path.join(FIX, "photo-exif.jpg"))
    page.wait_for_selector("#exif-canvas")
    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.click("#ex-jpg")
    spath = os.path.join(SHOTS, "live-save-exif.jpg")
    dl.value.save_as(spath)
    check("live exif save downloads a file", os.path.getsize(spath) > 0, str(os.path.getsize(spath)))
    check("live exif save never opens the share sheet", page.evaluate("!window.__shareCalls"))
    with page.expect_download() as dl:
        page.click("#ex-png")
    check("live exif png save downloads a file", dl.value.suggested_filename.endswith(".png"),
          dl.value.suggested_filename)
    check("live exif png save never opens the share sheet", page.evaluate("!window.__shareCalls"))
    page.click("#ex-share")
    page.wait_for_function("window.__shareCalls === 1")
    check("live exif share still opens the sheet", page.evaluate("window.__shareCalls === 1"))
    clear_sharing(page)

    page.goto(LIVE + "#/tool/compress")
    page.wait_for_selector("#cz-file", state="attached")
    page.set_input_files("#cz-file", os.path.join(FIX, "photo2.jpg"))
    page.wait_for_function("document.querySelectorAll('#cz-results [data-save]').length === 1", timeout=120000)
    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.locator("#cz-results [data-save]").first.click()
    cpath = os.path.join(SHOTS, "live-save-compress.jpg")
    dl.value.save_as(cpath)
    check("live compress save downloads a file", os.path.getsize(cpath) > 0, str(os.path.getsize(cpath)))
    check("live compress save never opens the share sheet", page.evaluate("!window.__shareCalls"))
    clear_sharing(page)

    page.goto(LIVE + "#/tool/resize")
    page.wait_for_selector("#rs-file", state="attached")
    page.set_input_files("#rs-file", os.path.join(FIX, "photo2.jpg"))
    page.wait_for_selector("#rs-canvas")
    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.click("#rs-png")
    rpath = os.path.join(SHOTS, "live-save-resize.png")
    dl.value.save_as(rpath)
    check("live resize save downloads a file", os.path.getsize(rpath) > 0, str(os.path.getsize(rpath)))
    check("live resize save never opens the share sheet", page.evaluate("!window.__shareCalls"))
    clear_sharing(page)

    page.goto(LIVE + "#/tool/watermark")
    page.wait_for_selector("#wm-file", state="attached")
    page.set_input_files("#wm-file", os.path.join(FIX, "photo2.jpg"))
    page.wait_for_function("document.querySelectorAll('#wm-results [data-save]').length === 1", timeout=60000)
    page.fill("#wm-text", "© @wdh")
    page.wait_for_timeout(300)
    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.locator("#wm-results [data-save]").first.click()
    wpath = os.path.join(SHOTS, "live-save-watermark.jpg")
    dl.value.save_as(wpath)
    check("live watermark save downloads a file", os.path.getsize(wpath) > 0, str(os.path.getsize(wpath)))
    check("live watermark save never opens the share sheet", page.evaluate("!window.__shareCalls"))
    clear_sharing(page)

    page.goto(LIVE + "#/tool/pdf")
    page.wait_for_selector("#pdf-file", state="attached")
    page.set_input_files("#pdf-file", os.path.join(FIX, "doc.pdf"))
    page.wait_for_function("document.querySelectorAll('.thumb-card').length === 2", timeout=120000)
    stub_android_sharing(page)
    with page.expect_download() as dl:
        page.locator("[data-dl]").first.click()
    ppath = os.path.join(SHOTS, "live-save-pdf.png")
    dl.value.save_as(ppath)
    check("live pdf save downloads a file", os.path.getsize(ppath) > 0, str(os.path.getsize(ppath)))
    check("live pdf save never opens the share sheet", page.evaluate("!window.__shareCalls"))
    clear_sharing(page)


def main(argv=None):
    argv = argv or []
    saves_only = "saves" in argv

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                 is_mobile=True, has_touch=True, accept_downloads=True, locale="ko-KR")
        page = ctx.new_page()
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.on("console", lambda m: ERRORS.append(f"console: {m.text}") if m.type == "error" else None)
        page.set_default_timeout(60000)

        page.goto(LIVE, wait_until="networkidle")
        page.wait_for_selector(".tool-card")
        home = page.inner_text("#home")
        check("live home has 8 cards", page.locator(".tool-card").count() == 8)
        check("live home uses plain Korean labels", "서버 전송" in home and "앱처럼 쓰기" in home and "[영상]" in home, home[:120])
        check("live home shows v1.3.7", "v1.3.7" in home)
        page.add_style_tag(content=".appbar{position:static !important}")
        page.screenshot(path=os.path.join(SHOTS, "live-home.png"), full_page=True)

        if saves_only:
            part_save_buttons(page)
            browser.close()
            return finish()

        page.goto(LIVE + "#/tool/qr")
        page.wait_for_selector("#qr-text")
        page.fill("#qr-text", "https://dgnslabs.github.io/labs-tools/")
        page.wait_for_selector("#qr-canvas")
        page.evaluate("""() => {
            Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
            Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {
                window.__qrShareCalls = (window.__qrShareCalls || 0) + 1;
            }});
        }""")
        with page.expect_download() as dl:
            page.click("#qr-png")
        qpath = os.path.join(SHOTS, "live-qr.png")
        dl.value.save_as(qpath)
        qdata = open(qpath, "rb").read()
        check("live qr png saves to a file with sharing available",
              len(qdata) > 1000 and qdata[:8] == b"\x89PNG\r\n\x1a\n", str(len(qdata)))
        check("live qr png save never opens the share sheet", page.evaluate("!window.__qrShareCalls"))
        with page.expect_download() as dl:
            page.click("#qr-svg")
        spath = os.path.join(SHOTS, "live-qr.svg")
        dl.value.save_as(spath)
        check("live qr svg saves to a file", open(spath, "r", encoding="utf-8").read().startswith("<svg"))
        page.evaluate("delete navigator.canShare; delete navigator.share")
        page.add_style_tag(content=".appbar{position:static !important}.sticky-actions{position:static !important}")
        page.screenshot(path=os.path.join(SHOTS, "live-tool-qr.png"), full_page=True)

        page.goto(LIVE + "#/tool/vod")
        page.wait_for_selector("#vod-drop")
        body = page.inner_text("#tool-vod")
        check("live vod spec is one plain line", "업로드 규격(HD 720p MP4 · 400MB 이하)" in body, body[:120])
        check("live vod has no ffmpeg command", page.locator("#vod-cmd").count() == 0 and "ffmpeg" not in body.lower())
        page.screenshot(path=os.path.join(SHOTS, "live-tool-vod.png"), full_page=True)

        swver = page.evaluate("""async () => {
            const t = await (await fetch('sw.js', {cache: 'no-store'})).text();
            return (t.match(/labs-tools-app-v[0-9.]+/) || [''])[0];
        }""")
        check("live sw cache is v1.3.7", swver == "labs-tools-app-v1.3.7", swver)

        # 소리 없는 샘플 → WebCodecs 가속 경로
        page.set_input_files("#vod-file", os.path.join(FIX, "sample-silent.mp4"))
        page.wait_for_timeout(700)
        check("live settings are collapsed", not page.locator("#vod-settings").evaluate("(element) => element.open"))
        check("live defaults to automatic", page.locator("#vod-size-mode").input_value() == "auto")
        page.click("#vod-go")
        page.wait_for_selector("#vod-result .vod-verdict", timeout=180000)
        engine = page.get_attribute("#tool-vod", "data-engine")
        info = page.evaluate("() => window.__labsVod || null")
        print("   engine:", engine, info)
        check("live conversion passed spec", "업로드 규격 통과" in page.inner_text("#vod-result .vod-verdict"))
        check("live conversion used WebCodecs", engine == "webcodecs", f"{engine} {info}")

        with page.expect_download() as dl:
            page.click("#vod-save")
        out = os.path.join(SHOTS, "live-vod-webcodecs.mp4")
        dl.value.save_as(out)
        check("live download is mp4", os.path.getsize(out) > 10000, str(os.path.getsize(out)))

        b64 = base64.b64encode(open(out, "rb").read()).decode()
        probe = page.evaluate("""async (b64) => {
            const bin = atob(b64); const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const FF = await Labs.util.ensureLib('ffmpeg');
            const ff = new FF.FFmpeg(); const lines = [];
            ff.on('log', (e) => { if (e && e.message) lines.push(e.message); });
            await ff.load({coreURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.js'),
                           wasmURL: Labs.util.vendor('vendor/ffmpeg/ffmpeg-core.wasm')});
            await ff.writeFile('p.mp4', bytes);
            try { await ff.exec(['-i', 'p.mp4']); } catch (e) {}
            ff.terminate(); return lines.join('\\n');
        }""", b64)
        print("   probe:", " | ".join(l for l in probe.splitlines() if "Stream #" in l or "Duration" in l))
        check("live probe 1280x720", "1280x720" in probe, probe[-200:])
        check("live probe h264 baseline", "Baseline" in probe, probe[-200:])

        # 소리 있는 샘플 → AAC 인코더가 없으면 ffmpeg 폴백 (두 경로 모두 규격은 같다)
        page.set_input_files("#vod-file", os.path.join(FIX, "sample.mp4"))
        page.wait_for_timeout(700)
        page.locator("#vod-settings summary").click()
        page.select_option("#vod-size-mode", "custom")
        page.fill("#vod-target-mb", "1")
        page.click("#vod-go")
        page.wait_for_selector("#vod-result .vod-verdict", timeout=240000)
        engine2 = page.get_attribute("#tool-vod", "data-engine")
        info2 = page.evaluate("() => window.__labsVod || null")
        print("   engine:", engine2, info2)
        check("live audio file produced a spec mp4", "업로드 규격 통과" in page.inner_text("#vod-result .vod-verdict"))
        with page.expect_download() as dl:
            page.click("#vod-save")
        out2 = os.path.join(SHOTS, "live-vod.mp4")
        dl.value.save_as(out2)
        data = open(out2, "rb").read()
        check("live audio mp4 has avc1", b"avc1" in data, data[:16])
        check("live audio mp4 has mp4a", b"mp4a" in data, data[:16])
        check("live custom size matches actual download",
              len(data) <= 1_000_000 and "목표 용량 충족" in page.inner_text("#vod-goal"), str(len(data)))
        page.screenshot(path=os.path.join(SHOTS, "live-vod-result.png"), full_page=True)

        browser.close()

    return finish()


def finish():
    print("\nchecks:", sum(1 for _, ok in CHECKS if ok), "/", len(CHECKS))
    if ERRORS:
        print("console/page errors:")
        for e in ERRORS:
            print("  -", e)
    ok = all(c for _, c in CHECKS) and not ERRORS
    print("LIVE OK" if ok else "LIVE FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
