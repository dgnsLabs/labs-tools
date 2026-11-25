/* ============================================================
   Labs Tools — app shell, router, home screen
   ============================================================ */
(function () {
  'use strict';

  var U = window.Labs.util;
  var $ = U.$;

  // Duotone glyphs: one filled face (fill-opacity .2) under 1.7px strokes,
  // so every icon reads as the same family at 25px.
  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  var ICONS = {
    exif:
      SVG_OPEN + '<rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor" fill-opacity="0.2"/>' +
      '<circle cx="8.6" cy="9.4" r="1.4"/><path d="M3.4 15.6 8 12.2l3.4 2.6 2.8-2.1 6.2 4.4"/>' +
      '<path d="M15.8 6.4h2.4v2.4"/></svg>',
    url:
      SVG_OPEN + '<rect x="9.2" y="2.9" width="6.6" height="17.2" rx="3.3" transform="rotate(-45 12 12)" fill="currentColor" fill-opacity="0.2" stroke="none"/>' +
      '<path d="M10.4 13.6a4.2 4.2 0 0 0 5.9 0l2.4-2.4a4.2 4.2 0 0 0-5.9-5.9l-1.2 1.2"/>' +
      '<path d="M13.6 10.4a4.2 4.2 0 0 0-5.9 0l-2.4 2.4a4.2 4.2 0 0 0 5.9 5.9l1.2-1.2"/>' +
      '<path d="m4.3 4.3 15.4 15.4"/></svg>',
    pdf:
      SVG_OPEN + '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" fill="currentColor" fill-opacity="0.2"/>' +
      '<path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
    compress:
      SVG_OPEN + '<rect x="9.2" y="9.2" width="5.6" height="5.6" fill="currentColor" fill-opacity="0.22" stroke="none"/>' +
      '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' +
      '<path d="M9.2 9.2 4.6 4.6M14.8 9.2l4.6-4.6M9.2 14.8l-4.6 4.6M14.8 14.8l4.6 4.6"/></svg>',
    qr:
      SVG_OPEN + '<rect x="3" y="3" width="7" height="7" rx="1.4" fill="currentColor" fill-opacity="0.2"/>' +
      '<rect x="14" y="3" width="7" height="7" rx="1.4" fill="currentColor" fill-opacity="0.2"/>' +
      '<rect x="3" y="14" width="7" height="7" rx="1.4" fill="currentColor" fill-opacity="0.2"/>' +
      '<path d="M14 14h3.2v3.2H14z" fill="currentColor" fill-opacity="0.24"/>' +
      '<path d="M20.5 14v3.2M17 20.5h3.5M14 20.5h.01"/></svg>',
    resize:
      SVG_OPEN + '<rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.2" fill="currentColor" fill-opacity="0.22"/>' +
      '<path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3"/></svg>',
    watermark:
      SVG_OPEN + '<path d="M12 3.2s6 6.6 6 10.1a6 6 0 0 1-12 0c0-3.5 6-10.1 6-10.1Z" fill="currentColor" fill-opacity="0.2"/>' +
      '<path d="M9.3 13.5c1.2 1.3 3 1.3 4.2.1"/></svg>',
    vod:
      SVG_OPEN + '<rect x="3" y="4" width="18" height="16" rx="2.4" fill="currentColor" fill-opacity="0.2"/>' +
      '<path d="M7.4 4v16M16.6 4v16M3 9.4h4.4M3 14.6h4.4M16.6 9.4H21M16.6 14.6H21"/>' +
      '<path d="m10.5 9.4 4.1 2.6-4.1 2.6z" fill="currentColor" fill-opacity="0.9" stroke="none"/></svg>'
  };

  var TOOLS = [
    { id: 'exif', title: '사진 EXIF 제거·모자이크', short: '위치 정보 지우고 민감한 곳 가리기', icon: 'exif', tag: '사진', script: 'js/tools/exif.js' },
    { id: 'url', title: 'URL 추적 제거', short: 'igsh · utm 등 추적 파라미터 삭제', icon: 'url', tag: '링크', script: 'js/tools/url.js' },
    { id: 'pdf', title: 'PDF ↔ 이미지', short: '페이지를 PNG로, 사진을 PDF로', icon: 'pdf', tag: '문서', script: 'js/tools/pdf.js' },
    { id: 'compress', title: '이미지 압축·변환', short: 'JPG · PNG · WebP 용량 줄이기', icon: 'compress', tag: '사진', script: 'js/tools/compress.js' },
    { id: 'qr', title: 'QR 생성기', short: '링크 · 텍스트 · Wi-Fi QR 즉시 생성', icon: 'qr', tag: 'QR', script: 'js/tools/qr.js' },
    { id: 'resize', title: '비율 리사이즈', short: '1:1 · 4:5 · 9:16 여백 맞춤', icon: 'resize', tag: '사진', script: 'js/tools/resize.js' },
    { id: 'watermark', title: '워터마크', short: '@아이디 · 로고 일괄 합성', icon: 'watermark', tag: '사진', script: 'js/tools/watermark.js' },
    { id: 'vod', title: 'VOD 규격 변환', short: '업로드 규격(HD 720p MP4)으로 자동 변환', icon: 'vod', tag: '영상', script: 'js/tools/vod.js', isNew: true }
  ];

  window.Labs.meta = TOOLS;

  /* ---------------- theme ---------------- */
  var THEME_KEY = 'labs-theme';
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#ffffff' : '#000000');
  }
  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') applyTheme(saved);
  } catch (e) { /* private mode */ }

  /* ---------------- home ---------------- */
  var homeEl = $('#home');
  var hostEl = $('#tool-host');
  var backBtn = $('#back-btn');
  var barTitle = $('#bar-title');
  var barSub = $('#bar-sub');

  function renderHome() {
    var cards = TOOLS.map(function (t, i) {
      return (
        '<a class="tool-card" href="#/tool/' + t.id + '">' +
        '<span class="card-bar"><span class="tag">[' + t.tag + ']</span>' +
        '<span class="idx">' + String(i + 1).padStart(2, '0') + '</span></span>' +
        '<span class="tile">' + ICONS[t.icon] + '</span>' +
        '<h3>' + U.esc(t.title) + (t.isNew ? '<span class="new-pill">NEW</span>' : '') + '</h3>' +
        '<p>' + U.esc(t.short) + '</p>' +
        '</a>'
      );
    }).join('');

    homeEl.innerHTML =
      '<section class="home">' +
      '<div class="hero">' +
      '<p class="hero-eyebrow"><span>오프라인 생활 도구</span><span class="rule"></span>' +
      '<span class="hero-ver">v1.4.0</span></p>' +
      '<h1>Labs Tools</h1>' +
      '<p>서버 없이, 폰에서 바로 쓰는 8가지 도구. 사진·PDF·링크·영상을 기기 안에서만 처리합니다.</p>' +
      '</div>' +
      '<dl class="spec-strip">' +
      '<div><dt>도구</dt><dd>8개</dd></div>' +
      '<div><dt>인터넷 없이</dt><dd>사용 가능</dd></div>' +
      '<div><dt>서버 전송</dt><dd>없음</dd></div>' +
      '</dl>' +
      '<div class="grid-head"><span>도구 목록</span><span>01 — 08</span></div>' +
      '<div class="tool-grid">' + cards + '</div>' +
      '<div class="home-note" id="install-note">' +
      '<p class="note-label">앱처럼 쓰기</p>' +
      '<p><strong>홈 화면에 추가하면 앱처럼 열립니다.</strong> 브라우저 메뉴에서 ' +
      '<b>“홈 화면에 추가”</b>를 누르면 주소창 없이 전체 화면으로 실행되고, ' +
      '한 번 열어 두면 인터넷 없이도 동작합니다.</p>' +
      '<div id="install-slot"></div>' +
      '</div>' +
      '<footer>v1.4.0 · 모든 변환은 이 브라우저 안에서만 이루어지며 파일은 어디에도 전송되지 않습니다.</footer>' +
      '</section>';
  }

  /* ---------------- router ---------------- */
  var mounted = {};
  var loading = {};
  var current = null;

  function hideAll() {
    homeEl.hidden = true;
    U.$$('.tool-page', hostEl).forEach(function (s) { s.hidden = true; });
  }

  function showHome() {
    hideAll();
    document.body.dataset.view = 'home';
    homeEl.hidden = false;
    current = null;
    backBtn.hidden = true;
    barTitle.textContent = 'Labs Tools';
    barSub.textContent = '8가지 생활 유틸';
    document.title = 'Labs Tools';
  }

  function showTool(tool, push) {
    hideAll();
    var sec = document.getElementById('tool-' + tool.id);
    if (!sec) {
      sec = document.createElement('section');
      sec.className = 'tool-page';
      sec.id = 'tool-' + tool.id;
      hostEl.appendChild(sec);
    }
    sec.hidden = false;
    document.body.dataset.view = 'tool';
    current = tool;
    backBtn.hidden = false;
    barTitle.textContent = tool.title;
    barSub.textContent = tool.short;
    document.title = tool.title + ' · Labs Tools';

    if (!mounted[tool.id]) {
      sec.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      loadTool(tool, sec);
    }
    window.scrollTo(0, 0);
  }

  function loadTool(tool, sec) {
    if (loading[tool.id]) return loading[tool.id];
    loading[tool.id] = U.loadScript(U.vendor(tool.script))
      .then(function () {
        var def = window.Labs.getTool(tool.id);
        if (!def || typeof def.mount !== 'function') throw new Error('도구를 초기화할 수 없습니다.');
        sec.innerHTML = '';
        def.mount(sec, tool);
        U.enhanceRanges(sec);
        mounted[tool.id] = true;
      })
      .catch(function (err) {
        console.error(err);
        sec.innerHTML = '';
        sec.appendChild(U.el(
          '<div class="panel"><div class="empty-state">' +
          '<p><b>도구를 불러오지 못했어요.</b></p>' +
          '<p class="small">' + U.esc(err.message || String(err)) + '</p>' +
          '<button class="btn primary" type="button" data-retry>다시 시도</button>' +
          '</div></div>'
        ));
        sec.querySelector('[data-retry]').addEventListener('click', function () {
          delete loading[tool.id];
          sec.innerHTML = '<div class="skeleton"></div>';
          loadTool(tool, sec);
        });
      })
      .then(function () { delete loading[tool.id]; });
    return loading[tool.id];
  }

  function route() {
    var m = /^#\/tool\/([a-z0-9-]+)/.exec(location.hash || '');
    if (!m) { showHome(); return; }
    var tool = TOOLS.filter(function (t) { return t.id === m[1]; })[0];
    if (!tool) { showHome(); return; }
    showTool(tool);
  }

  window.addEventListener('hashchange', route);

  backBtn.addEventListener('click', function () {
    if (history.length > 1 && location.hash.indexOf('#/tool/') === 0) {
      history.back();
    } else {
      location.hash = '#/';
    }
  });

  $('#theme-btn').addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  });

  /* ---------------- install prompt ---------------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var slot = document.getElementById('install-slot');
    if (slot) {
      slot.innerHTML = '<button class="btn primary sm" type="button" id="install-btn">홈 화면에 추가</button>';
      document.getElementById('install-btn').addEventListener('click', function () {
        deferredPrompt.prompt();
        deferredPrompt = null;
        slot.innerHTML = '';
      });
    }
  });

  /* ---------------- service worker ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register(new URL('sw.js', U.BASE).href, { updateViaCache: 'none' }).then(function (reg) {
      if (reg.waiting) notifyUpdate(reg);
      reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate(reg);
        });
      });
    }).catch(function (e) {
      console.warn('SW registration failed', e);
    });
  }

  function notifyUpdate(reg) {
    if (document.getElementById('sw-update')) return;
    var b = U.el('<button class="btn primary sm" id="sw-update" type="button">새 버전으로 새로고침</button>');
    b.addEventListener('click', function () {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      location.reload();
    });
    var slot = document.getElementById('install-slot');
    if (slot) slot.appendChild(b);
  }

  window.addEventListener('load', registerSW);

  /* ---------------- boot ---------------- */
  renderHome();
  route();
})();
