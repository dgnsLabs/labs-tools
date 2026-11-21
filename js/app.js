/* ============================================================
   Labs Tools — app shell, router, home screen
   ============================================================ */
(function () {
  'use strict';

  var U = window.Labs.util;
  var $ = U.$;

  var ICONS = {
    exif:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/>' +
      '<circle cx="8.6" cy="9.4" r="1.5"/><path d="M3.4 15.5 8 12l3.4 2.6 2.8-2.1 6.2 4.6"/>' +
      '<path d="M15.5 5.5h2.8v2.8h2.8M21.1 5.5v2.8"/></svg>',
    url:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.2 13.6a4.2 4.2 0 0 0 6 0l2.4-2.4a4.2 4.2 0 0 0-6-6l-1.3 1.3"/>' +
      '<path d="M13.8 10.4a4.2 4.2 0 0 0-6 0l-2.4 2.4a4.2 4.2 0 0 0 6 6l1.3-1.3"/><path d="m4 4 16 16"/></svg>',
    pdf:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>' +
      '<path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
    compress:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' +
      '<path d="M9.2 9.2 4.6 4.6M14.8 9.2l4.6-4.6M9.2 14.8l-4.6 4.6M14.8 14.8l4.6 4.6"/></svg>',
    qr:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.6"/>' +
      '<rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/>' +
      '<path d="M14 14h3.2v3.2H14zM20.5 14v3.2M17 20.5h4M14 20.5h.01"/></svg>',
    resize:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3"/>' +
      '<rect x="8.5" y="8.5" width="7" height="7" rx="1.4"/></svg>',
    watermark:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2s6 6.6 6 10.1a6 6 0 0 1-12 0c0-3.5 6-10.1 6-10.1Z"/>' +
      '<path d="M9.3 13.6c1.2 1.2 2.9 1.2 4.1.1"/></svg>',
    vod:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.6"/>' +
      '<path d="M7.4 4v16M16.6 4v16M3 9.2h4.4M3 14.8h4.4M16.6 9.2H21M16.6 14.8H21"/>' +
      '<path d="m10.6 9.6 4 2.4-4 2.4z" fill="currentColor" stroke="none"/></svg>'
  };

  var TOOLS = [
    { id: 'exif', title: '사진 EXIF 제거·모자이크', short: '위치 정보 지우고 민감한 곳 가리기', icon: 'exif', accent: '#8b93ff', script: 'js/tools/exif.js' },
    { id: 'url', title: 'URL 추적 제거', short: 'igsh · utm 등 추적 파라미터 삭제', icon: 'url', accent: '#34d399', script: 'js/tools/url.js' },
    { id: 'pdf', title: 'PDF ↔ 이미지', short: '페이지를 PNG로, 사진을 PDF로', icon: 'pdf', accent: '#fb7185', script: 'js/tools/pdf.js' },
    { id: 'compress', title: '이미지 압축·변환', short: 'JPG · PNG · WebP 용량 줄이기', icon: 'compress', accent: '#fbbf24', script: 'js/tools/compress.js' },
    { id: 'qr', title: 'QR 생성기', short: '링크 · 텍스트 · Wi-Fi QR 즉시 생성', icon: 'qr', accent: '#22d3ee', script: 'js/tools/qr.js' },
    { id: 'resize', title: '비율 리사이즈', short: '1:1 · 4:5 · 9:16 여백 맞춤', icon: 'resize', accent: '#c084fc', script: 'js/tools/resize.js' },
    { id: 'watermark', title: '워터마크', short: '@아이디 · 로고 일괄 합성', icon: 'watermark', accent: '#fb7185', script: 'js/tools/watermark.js' },
    { id: 'vod', title: 'VOD 규격 변환', short: 'MP4 · H.264 720p · AAC 규격으로', icon: 'vod', accent: '#38bdf8', script: 'js/tools/vod.js', isNew: true }
  ];

  window.Labs.meta = TOOLS;

  /* ---------------- theme ---------------- */
  var THEME_KEY = 'labs-theme';
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#f4f6fb' : '#0a0e14');
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
        '<a class="tool-card" href="#/tool/' + t.id + '" style="--accent:' + t.accent + '">' +
        '<span class="idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="tile">' + ICONS[t.icon] + '</span>' +
        '<div class="grow">' +
        '<h3>' + U.esc(t.title) + (t.isNew ? '<span class="new-pill">NEW</span>' : '') + '</h3>' +
        '<p>' + U.esc(t.short) + '</p>' +
        '</div>' +
        '</a>'
      );
    }).join('');

    homeEl.innerHTML =
      '<section class="home">' +
      '<div class="hero">' +
      '<h1>Labs Tools</h1>' +
      '<p>서버 없이, 폰에서 바로 쓰는 8가지 도구.</p>' +
      '<div class="hero-badges"><span>오프라인 동작</span><span>파일은 기기 안에서만 처리</span><span>설치 불필요</span></div>' +
      '</div>' +
      '<div class="tool-grid">' + cards + '</div>' +
      '<div class="home-note" id="install-note">' +
      '<strong>홈 화면에 추가하면 앱처럼 열려요.</strong><br>' +
      '브라우저 메뉴에서 <b>“홈 화면에 추가”</b>를 누르면 주소창 없이 전체 화면으로 실행되고, 한 번 열어 두면 인터넷 없이도 동작합니다.' +
      '<div id="install-slot"></div>' +
      '</div>' +
      '<footer>v1.0.0 · 모든 변환은 이 브라우저 안에서만 이루어지며 파일은 어디에도 전송되지 않습니다.</footer>' +
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
