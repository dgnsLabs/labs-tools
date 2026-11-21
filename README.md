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
| 8 | VOD 규격 변환 | 업로드 규격(HD 720p MP4 · 400MB 이하)으로 자동 변환. WebCodecs 가속 + ffmpeg.wasm 폴백 |

### 콘텐츠 규격 (2MB) 프리셋

`이미지 압축·변환`에서 **“콘텐츠 규격 (JPG/PNG · 2MB 이하)”** 을 누르면
2,097,152 bytes 이하가 될 때까지 품질과 해상도를 단계적으로 낮춰 출력합니다.
원본이 PNG면 투명도 유지를 위해 PNG로, 그 외에는 JPG로 저장합니다. 여러 장 동시 처리와 ZIP 저장을 지원합니다.

### VOD 규격 변환

화면에는 업로드 규격 한 줄(`HD 720p MP4 · 400MB 이하`)만 보여주고, 코덱·레벨·비트레이트 표와
`ffmpeg` 명령어 안내는 두지 않습니다. 150MB가 넘는 파일을 고르면 터미널 명령 대신
휴대폰에서 오래 걸릴 수 있다는 안내와 PC에서 열 주소 복사 버튼을 보여줍니다.

- 변환 설정을 열어 원본 크기를 목표로 또는 목표 용량 직접 입력을 선택할 수 있습니다. 기본값은 자동입니다.
  목표는 변환 전에 표시되며, 결과 화면에는 원본 대비 용량 차이와 규격 및 목표 달성 여부가 표시됩니다.
- 출력 규격: `MP4 / H.264 Baseline / 1280×720 / 5000 kbps 이하 / AAC 44.1kHz / 400 MB 이하`
- **1순위 — WebCodecs 가속(`js/tools/vod.js`)**
  `VideoEncoder`(`avc1.42001f`, 1280×720) + `vendor/mp4-muxer.mjs`(mp4-muxer 5.2.2, ESM 로컬 번들)로
  영상을 다시 인코딩하고, 소리는 `decodeAudioData`로 PCM을 얻어 `AudioEncoder`(`mp4a.40.2`)로 AAC를 만듭니다.
  프레임은 `<video>`를 1/30초 간격으로 탐색하며 1280×720 캔버스(레터박스)에 그려 넣습니다 —
  브라우저가 디코딩·인코딩을 기기 가속으로 처리하므로 WASM 경로보다 훨씬 빠릅니다.
- **2순위 — ffmpeg.wasm 폴백**
  WebCodecs 미지원(비보안 연결·구형 브라우저·비 MP4 컨테이너), H.264 인코더 미지원, 소리 디코딩 실패,
  AAC 인코더 미지원(예: Linux Chromium), 인코딩 오류 중 하나라도 걸리면 자동으로 기존
  `@ffmpeg/ffmpeg` 0.12.10 + core 0.12.6 (단일 스레드, `-preset ultrafast`) 경로로 넘어갑니다.
  두 경로의 결과 규격(MP4 · H.264 Baseline · 1280×720 · AAC · 5000kbps 이하)은 같습니다.
- FFmpeg는 WORKERFS로 원본을 연결해 필요한 구간만 읽습니다. 영상 길이를 알 수 있으면 출력 용량을 고려해 영상 비트레이트를 낮춥니다.
- ffmpeg core(약 32MB)는 변환을 시작할 때만 내려받고 Service Worker는 core를 미리 캐시하지 않습니다.
- 결과에는 `업로드 규격 통과` 판정과 용량(`400MB 이하`), `HD 720p` `MP4` 칩, 미리보기,
  `MP4 저장`/`공유` 버튼을 보여줍니다.
- Service Worker 앱 셸 캐시는 버전(`labs-tools-app-vX.Y.Z`)으로 관리하며, `sw.js` 등록은 `updateViaCache: 'none'`이라
  배포 직후 새로고침 한두 번이면 새 파일로 바뀝니다.
- 테스트는 소리 있는 샘플(→ 폴백 경로, AAC 확인)과 소리 없는 샘플(→ WebCodecs 경로)을 각각 변환해
  ffmpeg.wasm으로 실제 코덱·해상도·길이를 검증합니다.

## 구조

```
index.html            앱 셸 (해시 라우팅: #/tool/<id>)
manifest.json         PWA 매니페스트 (name: Labs Tools, display: standalone)
sw.js                 Service Worker (앱 셸 precache + ffmpeg core 런타임 캐시)
css/style.css         Geist 흑백 헤어라인 그리드 + 시그널 오렌지(#ff5a1f) 디자인 시스템
js/app.js             홈 화면 · 라우터 · 테마 · SW 등록
js/lib/common.js      공통 유틸 (스크립트/라이브러리 지연 로드, 저장·공유, ZIP 등)
js/tools/*.js         도구 8종 (각 도구는 진입할 때만 로드)
vendor/               pdf.js 3.11.174 · pdf-lib 1.17.1 · JSZip 3.10.1 · qrcode-generator 1.4.4 · mp4-muxer 5.2.2(ESM)
vendor/ffmpeg/        ffmpeg.wasm 0.12.10 (UMD) + core 0.12.6 (단일 스레드)
icons/                PNG 아이콘 192 · 512 · maskable 512 · apple-touch 180
tools/make-icons.py   아이콘 재생성 스크립트
tests/e2e.py          Playwright 로컬 검증 (HTTP 200 · 콘솔 에러 0 · 도구 동작)
tests/make-fixtures.py 테스트용 이미지/PDF 생성
```

## 디자인

홈은 서버리스 유틸리티답게 **1px 헤어라인 2열(넓은 화면 4열) 그리드**로만 구성합니다.
카드 안에 파스텔 타일이나 라운드 배지를 두지 않고, 25px 듀오톤 아이콘과 모노스페이스 태그
(`[사진]` `[링크]` `[문서]` `[QR]` `[영상]`) · 번호(`01`~`08`)로 구분합니다.
라벨은 개발자 용어 대신 일반인이 바로 읽는 한국어입니다(`서버 전송 없음`, `앱처럼 쓰기`).

- 바탕: 다크 `#000000` / 라이트 `#ffffff`, 보더 `#222222` / `#e5e5e5`
- 포인트 컬러는 **시그널 오렌지 `#ff5a1f` 하나** — 상단 LED, 태그, `NEW`, primary 버튼,
  활성 탭 밑줄, 진행률 바, 포커스 링에만 사용
- 안쪽 도구 화면도 둥근 아일랜드를 걷어내고 2~4px 라운딩 + 1px 보더 + 플랫 표면으로 통일
- 모든 기능(DOM id/class, `#/tool/<id>` 라우팅, 테마 토글, 테스트 셀렉터)은 그대로 유지

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
python3 tests/e2e.py            # 로컬 전체
python3 tests/e2e.py url qr     # 일부만
python3 tests/live.py           # 배포된 Pages 사이트 검증
```

`tests/e2e.py`는 임시 HTTP 서버를 띄워 모바일 크기(390×844) Chromium으로
정적 파일 200 응답, 콘솔/페이지 에러 0건, 8개 도구 진입, URL 정리 규칙,
QR 생성·디코딩, EXIF 제거·모자이크·되돌리기, 2MB 프리셋, PDF 양방향 변환,
비율 리사이즈, 워터마크 ZIP, VOD 실제 변환(WebCodecs 경로 · ffmpeg 폴백 경로 각각), 오프라인 로딩까지 확인한 뒤
서버를 종료합니다. 스크린샷은 `tests/shots/`에 남습니다.
`tests/live.py`는 같은 검사를 배포 주소에서 한 번 더 수행합니다(홈·VOD 화면, WebCodecs 변환과 폴백).

## 배포

`main` 브랜치 루트를 GitHub Pages로 직접 서빙합니다(빌드 없음).

```bash
git push origin main
gh api -X POST /repos/dgnsLabs/labs-tools/pages --input pages.json   # {"source":{"branch":"main","path":"/"}}
```

## 개인정보

모든 처리는 브라우저 메모리에서 이루어지며 파일을 업로드하지 않습니다.
EXIF 제거·모자이크 결과도 Canvas에서 다시 인코딩한 이미지입니다.
