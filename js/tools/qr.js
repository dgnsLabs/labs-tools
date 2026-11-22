/* ============================================================
   QR 생성기 — offline QR for links, text and Wi-Fi
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var ECC = { L: 'L', M: 'M', Q: 'Q', H: 'H' };

  function escapeWifi(s) {
    return String(s == null ? '' : s).replace(/([\\;,:"])/g, '\\$1');
  }

  function mount(root) {
    root.innerHTML =

      '<div class="panel">' +
      '<div class="seg" id="qr-mode">' +
      '<button type="button" class="is-on" data-mode="text">링크 / 텍스트</button>' +
      '<button type="button" data-mode="wifi">Wi-Fi 접속</button>' +
      '</div>' +

      '<div id="qr-text-fields" style="margin-top:12px">' +
      '<div class="field"><label>내용 <span class="val" id="qr-len">0자</span></label>' +
      '<textarea id="qr-text" rows="3" placeholder="https://example.com 또는 아무 텍스트" spellcheck="false"></textarea></div>' +
      '</div>' +

      '<div id="qr-wifi-fields" style="margin-top:12px" hidden>' +
      '<div class="field"><label>네트워크 이름 (SSID)</label>' +
      '<input type="text" id="qr-ssid" placeholder="MyHomeWiFi" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
      '<div class="field"><label>암호</label>' +
      '<input type="text" id="qr-pass" placeholder="비밀번호" autocomplete="off" spellcheck="false"></div>' +
      '<div class="row nowrap">' +
      '<div class="field grow" style="margin:0;flex:1.5"><label>암호화</label>' +
      '<select id="qr-sec"><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="nopass">없음 (개방)</option></select></div>' +
      '<div class="field grow" style="margin:0"><label>숨김 SSID</label>' +
      '<select id="qr-hidden"><option value="0">아니오</option><option value="1">예</option></select></div>' +
      '</div>' +
      '</div>' +

      '<div class="row nowrap" style="margin-top:12px">' +
      '<div class="field grow" style="margin:0"><label>오류 정정</label>' +
      '<select id="qr-ecc"><option value="L">L · 7%</option><option value="M" selected>M · 15%</option><option value="Q">Q · 25%</option><option value="H">H · 30%</option></select></div>' +
      '<div class="field grow" style="margin:0"><label>PNG 크기</label>' +
      '<select id="qr-size"><option value="512">512 px</option><option value="1024" selected>1024 px</option><option value="2048">2048 px</option></select></div>' +
      '</div>' +
      '</div>' +

      '<div class="panel" id="qr-preview-panel">' +
      '<div class="panel-head"><h2>미리보기</h2><span class="aside" id="qr-version"></span></div>' +
      '<div id="qr-stage" class="stage" style="background:#fff;border-color:var(--border);padding:12px">' +
      '<div class="stage-empty" style="color:#7b8794">내용을 입력하면 QR이 바로 만들어집니다</div>' +
      '</div>' +
      '<div class="sticky-actions" style="position:static;margin-top:12px">' +
      '<button class="btn" type="button" id="qr-png" disabled>PNG 저장</button>' +
      '<button class="btn" type="button" id="qr-svg" disabled>SVG 저장</button>' +
      '<button class="btn primary" type="button" id="qr-share" disabled>공유</button>' +
      '</div>' +
      '<p class="hint">만료 없이 이 기기에서만 만들어집니다. 서버에 저장되는 내용은 없습니다.</p>' +
      '</div>';

    var modeSeg = $('#qr-mode', root);
    var textFields = $('#qr-text-fields', root);
    var wifiFields = $('#qr-wifi-fields', root);
    var input = $('#qr-text', root);
    var stage = $('#qr-stage', root);
    var lenEl = $('#qr-len', root);
    var versionEl = $('#qr-version', root);
    var pngBtn = $('#qr-png', root);
    var svgBtn = $('#qr-svg', root);
    var shareBtn = $('#qr-share', root);

    var state = { mode: 'text', matrix: null, n: 0, payload: '', svg: '', busy: false };

    function payload() {
      if (state.mode === 'text') return input.value.trim();
      var ssid = $('#qr-ssid', root).value;
      if (!ssid) return '';
      var sec = $('#qr-sec', root).value;
      var pass = $('#qr-pass', root).value;
      var hidden = $('#qr-hidden', root).value === '1';
      var out = 'WIFI:T:' + sec + ';S:' + escapeWifi(ssid) + ';';
      if (sec !== 'nopass') out += 'P:' + escapeWifi(pass) + ';';
      if (hidden) out += 'H:true;';
      return out + ';';
    }

    function drawCanvas(n, isDark, px) {
      var quiet = 4;
      var total = n + quiet * 2;
      var scale = Math.max(1, Math.floor(px / total));
      var c = document.createElement('canvas');
      c.width = c.height = total * scale;
      c.id = 'qr-canvas';
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#000000';
      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          if (isDark(y, x)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
      return c;
    }

    function buildSvg(n, isDark) {
      var quiet = 4;
      var total = n + quiet * 2;
      var parts = [];
      // merge horizontal runs into one rect per run
      for (var y = 0; y < n; y++) {
        var x = 0;
        while (x < n) {
          if (!isDark(y, x)) { x++; continue; }
          var start = x;
          while (x < n && isDark(y, x)) x++;
          parts.push('<rect x="' + (start + quiet) + '" y="' + (y + quiet) + '" width="' + (x - start) + '" height="1"/>');
        }
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + total * 8 + '" height="' + total * 8 +
        '" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
        '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>' +
        '<g fill="#000000">' + parts.join('') + '</g></svg>';
    }

    function setEnabled(on) {
      [pngBtn, svgBtn, shareBtn].forEach(function (b) { b.disabled = !on; });
    }

    function render() {
      var data = payload();
      lenEl.textContent = (state.mode === 'text' ? input.value.length : (data ? data.length : 0)) + '자';
      if (!data) {
        stage.innerHTML = '<div class="stage-empty" style="color:#7b8794">' +
          (state.mode === 'text' ? '내용을 입력하면 QR이 바로 만들어집니다' : 'Wi-Fi 이름을 입력해 주세요') + '</div>';
        versionEl.textContent = '';
        setEnabled(false);
        state.matrix = null;
        return;
      }
      try {
        var qr = window.qrcode(0, $('#qr-ecc', root).value || 'M');
        qr.addData(data);
        qr.make();
        var n = qr.getModuleCount();
        var isDark = function (r, c) { return qr.isDark(r, c); };
        var px = parseInt($('#qr-size', root).value, 10) || 1024;
        var canvas = drawCanvas(n, isDark, px);

        stage.innerHTML = '';
        stage.appendChild(canvas);

        state.matrix = { n: n, isDark: isDark };
        state.n = n;
        state.payload = data;
        state.svg = buildSvg(n, isDark);
        versionEl.textContent = '버전 ' + (Math.floor((n - 17) / 4)) + ' · ' + n + '×' + n + ' 모듈';
        setEnabled(true);
      } catch (e) {
        stage.innerHTML = '<div class="stage-empty" style="color:#b4232f">' +
          '내용이 너무 길어 QR로 만들 수 없습니다. 조금 줄여 주세요.</div>';
        versionEl.textContent = '';
        setEnabled(false);
        state.matrix = null;
      }
    }

    var renderSoon = U.debounce(render, 160);

    modeSeg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (!b) return;
      state.mode = b.getAttribute('data-mode');
      Array.prototype.forEach.call(modeSeg.children, function (x) { x.classList.toggle('is-on', x === b); });
      textFields.hidden = state.mode !== 'text';
      wifiFields.hidden = state.mode !== 'wifi';
      render();
      if (state.mode === 'text') input.focus();
    });

    [input, $('#qr-ssid', root), $('#qr-pass', root)].forEach(function (el) {
      el.addEventListener('input', renderSoon);
    });
    ['#qr-sec', '#qr-hidden', '#qr-ecc', '#qr-size'].forEach(function (sel) {
      $(sel, root).addEventListener('change', render);
    });

    function fileName(ext) {
      var base = 'qr-code';
      if (state.mode === 'wifi') base = 'wifi-' + (U.baseName($('#qr-ssid', root).value) || 'qr');
      else {
        try { base = 'qr-' + (new URL(state.payload).hostname.replace(/^www\./, '') || 'code'); }
        catch (e) { base = 'qr-code'; }
      }
      return base + '.' + ext;
    }

    // Saving is a plain browser download — the native share sheet is the
    // separate 공유 button, so tapping 저장 always lands a file in 내려받기.
    pngBtn.addEventListener('click', function () {
      var canvas = $('#qr-canvas', stage);
      if (!canvas) return;
      try {
        U.download(U.canvasBlobSync(canvas, 'image/png'), fileName('png'));
        U.toast('PNG를 저장했어요');
      } catch (e) {
        U.toast(e.message || '저장하지 못했어요', 'err');
      }
    });

    svgBtn.addEventListener('click', function () {
      if (!state.svg) return;
      var blob = new Blob([state.svg], { type: 'image/svg+xml;charset=utf-8' });
      U.download(blob, fileName('svg'));
      U.toast('SVG를 저장했어요');
    });

    shareBtn.addEventListener('click', function () {
      var canvas = $('#qr-canvas', stage);
      if (!canvas) return;
      var blob, name;
      try {
        blob = U.canvasBlobSync(canvas, 'image/png');
        name = fileName('png');
      } catch (e) {
        U.toast(e.message || '이미지를 만들지 못했어요', 'err');
        return;
      }
      // navigator.share only opens while the click is still fresh, so the
      // bytes are ready before it is called.
      if (!U.canShareFiles()) {
        U.download(blob, name);
        U.toast('PNG를 저장했어요');
        return;
      }
      U.shareBlob(blob, name, 'QR 코드').then(function (shared) {
        if (!shared) { U.download(blob, name); U.toast('PNG를 저장했어요'); }
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return; // user closed the share sheet
        U.download(blob, name);
        U.toast('공유를 열지 못해 PNG로 저장했어요');
      });
    });

    U.ensureLib('qrcode').then(function (q) {
      q.stringToBytes = q.stringToBytesFuncs['UTF-8'];
      render();
    }).catch(function (e) {
      stage.innerHTML = '<div class="stage-empty" style="color:#b4232f">QR 엔진을 불러오지 못했습니다.<br>' + U.esc(e.message) + '</div>';
    });
  }

  window.Labs.register('qr', { mount: mount });
})();
