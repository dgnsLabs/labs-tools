# Labs Tools

서버 없이 폰 브라우저 안에서만 동작하는 정적 PWA 유틸리티 모음입니다.
사진 · PDF · 링크 · 영상 작업을 8가지 도구로 처리하며, **어떤 파일도 서버로 전송되지 않습니다.**

- 서비스 주소: <https://dgnslabs.github.io/labs-tools/>
- 빌드 도구 없음 · GitHub Actions 0분 · 외부 CDN 의존 없음
- 앱 셸과 라이브러리를 Service Worker로 캐시해 **오프라인**에서도 동작

## 도구

| # | 도구 | 하는 일 |
|---|------|---------|
| 1 | 사진 EXIF 제거·모자이크 | Canvas 재렌더링으로 EXIF(위치·기기·시각) 제거, 터치 브러시 모자이크/블러, 되돌리기 |
| 2 | URL 추적 제거 | 인스타·스레드·쿠팡·유튜브·네이버 등의 `utm_*`, `igsh`, `fbclid`, `lptag`, `wTime` 등 제거 |
| 3 | PDF ↔ 이미지 | PDF 페이지를 PNG/JPG로(pdf.js), 사진 여러 장을 PDF 한 장으로(pdf-lib) |
| 4 | 이미지 압축·변환 | JPG/PNG/WebP 변환, 품질·최대 폭 조절, ZIP 일괄 저장, **콘텐츠 규격 2MB 프리셋** |
| 5 | QR 생성기 | 링크·텍스트·Wi-Fi QR, PNG/SVG 저장 (만료 없음) |
| 6 | 비율 리사이즈 | 1:1 · 4:5 · 9:16 · 16:9 · 3:4, 흰색/검정/블러 여백, 잘림 없음 |
| 7 | 워터마크 | 텍스트·로고 일괄 합성, 투명도·크기·위치(우하단/중앙/타일), ZIP 저장 |
| 8 | VOD 규격 변환 | MP4 / H.264 Baseline / 1280×720 / 5000kbps / AAC / 400MB 규격으로 브라우저에서 변환 |

### 콘텐츠 규격 (2MB) 프리셋

`이미지 압축·변환`에서 **“콘텐츠 규격 (JPG/PNG · 2MB 이하)”** 을 누르면
2,097,152 bytes 이하가 될 때까지 품질과 해상도를 단계적으로 낮춰 출력합니다.
원본이 PNG면 투명도 유지를 위해 PNG로, 그 외에는 JPG로 저장합니다. 여러 장 동시 처리와 ZIP 저장을 지원합니다.

### VOD 규격 변환

- 대상 규격: `MP4 / H.264 (Baseline Level 1.3) / 1280×720 HD / 5000 kbps 이하 / AAC / 400 MB 이하`
- `@ffmpeg/ffmpeg` 0.12.10 + `@ffmpeg/core` 0.12.6 **단일 스레드(UMD)** 빌드를 `vendor/ffmpeg/`에 두고,
  **변환을 시작할 때만** 내려받습니다(홈 로딩 영향 없음, Service Worker는 core를 미리 캐시하지 않음).
- 1280×720은 H.264 표준상 Level 3.1이 필요하므로 `-level:v 1.3`을 먼저 시도하고,
  인코더가 거부하면 `3.1`로 자동 재시도합니다. 결과 칩에는 파일에 실제로 기록된 레벨을 표시합니다.
- 폰 메모리 한계를 고려해 1~2분 이내 영상을 권장하며, 대용량은 화면의 `ffmpeg` 한 줄 명령을 PC에서 실행하도록 안내합니다.

## 구조

```
index.html            앱 셸 (해시 라우팅: #/tool/<id>)
manifest.json         PWA 매니페스트 (name: Labs Tools, display: standalone)
sw.js                 Service Worker (앱 셸 precache + ffmpeg core 런타임 캐시)
css/style.css         다크/라이트 테마, 모바일 카드 UI
js/app.js             홈 화면 · 라우터 · 테마 · SW 등록
js/lib/common.js      공통 유틸 (스크립트/라이브러리 지연 로드, 저장·공유, ZIP 등)
js/tools/*.js         도구 8종 (각 도구는 진입할 때만 로드)
vendor/               pdf.js 3.11.174 · pdf-lib 1.17.1 · JSZip 3.10.1 · qrcode-generator 1.4.4
vendor/ffmpeg/        ffmpeg.wasm 0.12.10 (UMD) + core 0.12.6 (단일 스레드)
icons/                PNG 아이콘 192 · 512 · maskable 512 · apple-touch 180
tools/make-icons.py   아이콘 재생성 스크립트
tests/e2e.py          Playwright 로컬 검증 (HTTP 200 · 콘솔 에러 0 · 도구 동작)
tests/make-fixtures.py 테스트용 이미지/PDF 생성
```

## 로컬 실행

```bash
cd labs-tools
python3 -m http.server 8080
# http://localhost:8080
```

Service Worker와 클립보드는 `localhost` 또는 HTTPS에서만 동작합니다.

## 검증

```bash
pip install playwright pillow pypdf
python3 -m playwright install chromium
python3 tests/make-fixtures.py
python3 tests/e2e.py            # 전체
python3 tests/e2e.py url qr     # 일부만
```

`tests/e2e.py`는 임시 HTTP 서버를 띄워 모바일 크기(390×844) Chromium으로
정적 파일 200 응답, 콘솔/페이지 에러 0건, 8개 도구 진입, URL 정리 규칙,
QR 생성·디코딩, EXIF 제거·모자이크·되돌리기, 2MB 프리셋, PDF 양방향 변환,
비율 리사이즈, 워터마크 ZIP, ffmpeg.wasm 실제 변환, 오프라인 로딩까지 확인한 뒤
서버를 종료합니다. 스크린샷은 `tests/shots/`에 남습니다.

## 배포

`main` 브랜치 루트를 GitHub Pages로 직접 서빙합니다(빌드 없음).

```bash
git push origin main
gh api -X POST /repos/dgnsLabs/labs-tools/pages --input pages.json   # {"source":{"branch":"main","path":"/"}}
```

## 개인정보

모든 처리는 브라우저 메모리에서 이루어지며 파일을 업로드하지 않습니다.
EXIF 제거·모자이크 결과도 Canvas에서 다시 인코딩한 이미지입니다.
