/* ============================================================
   비율 리사이즈 — pad to 1:1 / 4:5 / 9:16 / 16:9 / 3:4 without cropping
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var PRESETS = [
    { id: '1:1', w: 1080, h: 1080, label: '1:1', use: '피드 · 프로필' },
    { id: '4:5', w: 1080, h: 1350, label: '4:5', use: '인스타 피드' },
    { id: '9:16', w: 1080, h: 1920, label: '9:16', use: '스토리 · 릴스' },
    { id: '16:9', w: 1920, h: 1080, label: '16:9', use: '유튜브 · 썸네일' },
    { id: '3:4', w: 1080, h: 1440, label: '3:4', use: '세로 사진' }
  ];
  var SIZES = [
    { v: 0.75, label: '기본' },
    { v: 1, label: '표준' },
    { v: 1.5, label: '고화질' }
  ];

  function mount(root) {
    root.innerHTML =

      '<div class="panel">' +
      '<div class="drop" id="rs-drop">' +
      '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m6 16 4-4 3 2.5 3-2.5 2.5 2"/><circle cx="9" cy="9.5" r="1.3"/></svg>' +
      '<b>이미지 선택</b><span>1장 · JPG / PNG / WebP</span>' +
      '<input type="file" id="rs-file" accept="image/*" hidden>' +
      '</div>' +
      '<div class="row" style="margin-top:8px"><span class="chip" id="rs-info">아직 선택 없음</span>' +
      '<span class="grow"></span><button class="btn sm ghost" type="button" id="rs-change">다른 사진</button></div>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="panel-head"><h2>비율</h2><span class="aside" id="rs-target-size"></span></div>' +
      '<div class="row" id="rs-ratios" style="gap:6px">' +
      PRESETS.map(function (p, i) {
        return '<button class="btn sm' + (i === 0 ? ' primary' : '') + '" type="button" data-ratio="' + p.id + '" title="' + p.use + '">' + p.label + '</button>';
      }).join('') +
      '</div>' +
      '<p class="hint" id="rs-use">' + PRESETS[0].use + '</p>' +

      '<div class="field" style="margin-top:14px"><label>여백 채우기</label>' +
      '<div class="seg" id="rs-fill">' +
      '<button type="button" class="is-on" data-fill="white">흰 여백</button>' +
      '<button type="button" data-fill="black">검정 여백</button>' +
      '<button type="button" data-fill="blur">블러 배경</button>' +
      '</div></div>' +

      '<div class="field" style="margin-bottom:0"><label>해상도</label>' +
      '<select id="rs-size">' +
      SIZES.map(function (s, i) { return '<option value="' + s.v + '"' + (i === 1 ? ' selected' : '') + '>' + s.label + ' (' + s.v + '×)</option>'; }).join('') +
      '</select></div>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="panel-head"><h2>미리보기</h2><span class="aside" id="rs-dims"></span></div>' +
      '<div class="stage" id="rs-stage"><div class="stage-empty">사진을 고르면 결과가 보입니다</div></div>' +
      '<div class="sticky-actions" style="position:static">' +
      '<button class="btn" type="button" id="rs-png" disabled>PNG 저장</button>' +
      '<button class="btn primary" type="button" id="rs-jpg" disabled>JPG 저장</button>' +
      '</div>' +
      '<p class="hint">원본 전체가 잘리지 않고 가운데에 맞춰집니다. 여백은 선택한 색이나 흐린 배경으로 채워집니다.</p>' +
      '</div>';

    var input = $('#rs-file', root);
    var drop = $('#rs-drop', root);
    var info = $('#rs-info', root);
    var stage = $('#rs-stage', root);
    var dimsEl = $('#rs-dims', root);
    var targetEl = $('#rs-target-size', root);
    var useEl = $('#rs-use', root);
    var pngBtn = $('#rs-png', root);
    var jpgBtn = $('#rs-jpg', root);

    var state = { bmp: null, ratio: PRESETS[0], fill: 'white', scale: 1, previewCanvas: null };

    U.dropzone(drop, input, function (files) { load(files[0]); });
    $('#rs-change', root).addEventListener('click', function () { input.click(); });

    function load(file) {
      if (!file) return;
      U.fileToBitmap(file).then(function (bmp) {
        state.bmp = bmp;
        info.textContent = U.baseName(file.name) + ' · ' + bmp.width + '×' + bmp.height + ' · ' + U.bytes(file.size);
        draw();
        [pngBtn, jpgBtn].forEach(function (b) { b.disabled = false; });
      }).catch(function (e) { U.toast(e.message || '이미지를 읽지 못했어요', 'err'); });
    }

    function targetDims() {
      var p = state.ratio;
      var w = Math.round(p.w * state.scale);
      var h = Math.round(p.h * state.scale);
      var max = 4096;
      if (w > max || h > max) {
        var k = max / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      return { w: w, h: h };
    }

    function draw() {
      if (!state.bmp) return;
      var d = targetDims();
      var canvas = document.createElement('canvas');
      canvas.width = d.w; canvas.height = d.h;
      canvas.id = 'rs-canvas';
      canvas.setAttribute('data-w', d.w);
      canvas.setAttribute('data-h', d.h);
      var ctx = canvas.getContext('2d');
      var src = state.bmp;
      var sw = src.width, sh = src.height;

      if (state.fill === 'white' || state.fill === 'black') {
        ctx.fillStyle = state.fill === 'white' ? '#ffffff' : '#000000';
        ctx.fillRect(0, 0, d.w, d.h);
      } else {
        // Blurred cover background: shrink far below target, then upscale.
        var tw = Math.max(8, Math.round(d.w / 18));
        var th = Math.max(8, Math.round(d.h / 18));
        var coverScale = Math.max(tw / sw, th / sh);
        var cw = sw * coverScale, ch = sh * coverScale;
        var tmp = document.createElement('canvas');
        tmp.width = tw; tmp.height = th;
        var tctx = tmp.getContext('2d');
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(src, (tw - cw) / 2, (th - ch) / 2, cw, ch);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tmp, 0, 0, tw, th, 0, 0, d.w, d.h);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(0, 0, d.w, d.h);
      }

      // Contain: never crop.
      var scale = Math.min(d.w / sw, d.h / sh);
      var dw = sw * scale, dh = sh * scale;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, (d.w - dw) / 2, (d.h - dh) / 2, dw, dh);

      state.previewCanvas = canvas;
      stage.innerHTML = '';
      stage.appendChild(canvas);
      dimsEl.textContent = d.w + '×' + d.h + ' px';
      targetEl.textContent = state.ratio.id + ' · ' + d.w + '×' + d.h;
    }

    $('#rs-ratios', root).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ratio]');
      if (!b) return;
      var id = b.getAttribute('data-ratio');
      state.ratio = PRESETS.filter(function (p) { return p.id === id; })[0];
      Array.prototype.forEach.call($('#rs-ratios', root).children, function (x) {
        x.classList.toggle('primary', x === b);
      });
      var preset = PRESETS.filter(function (p) { return p.id === id; })[0];
      useEl.textContent = preset.use;
      draw();
    });

    $('#rs-fill', root).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-fill]');
      if (!b) return;
      state.fill = b.getAttribute('data-fill');
      Array.prototype.forEach.call($('#rs-fill', root).children, function (x) {
        x.classList.toggle('is-on', x === b);
      });
      draw();
    });

    $('#rs-size', root).addEventListener('change', function () {
      state.scale = parseFloat($('#rs-size', root).value) || 1;
      draw();
    });

    // Saving is a plain download.
    function save(type) {
      if (!state.previewCanvas) return;
      var mime = type === 'png' ? 'image/png' : 'image/jpeg';
      var name = 'resize-' + state.ratio.id.replace(':', 'x') + '-' + U.stamp() + '.' + (type === 'png' ? 'png' : 'jpg');
      try {
        var blob = U.canvasBlobSync(state.previewCanvas, mime, 0.92);
        U.download(blob, name);
        U.toast('저장했어요 · ' + U.bytes(blob.size));
      } catch (e) {
        U.toast(e.message || '저장하지 못했어요', 'err');
      }
    }

    pngBtn.addEventListener('click', function () { save('png'); });
    jpgBtn.addEventListener('click', function () { save('jpg'); });

    // default label
    var d = PRESETS[0].w + '×' + PRESETS[0].h;
    targetEl.textContent = PRESETS[0].id + ' · ' + d;
  }

  window.Labs.register('resize', { mount: mount });
})();
