/* ============================================================
   비율 리사이즈 — pad to 1:1 / 4:5 / 9:16 / 16:9 / 3:4 without cropping
   + 사진 확대(줌)·위치 조절, 두 손가락 확대/축소, 출력 해상도 2배 확대
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
    { v: 1.5, label: '고화질' },
    { v: 2, label: '2배 확대' }
  ];
  var ZOOM_MIN = 100;
  var ZOOM_MAX = 300;
  var ZOOM_STEP = 5;

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
      '<div class="field"><label>사진 확대 <span class="val" id="rs-zoom-val">100%</span></label>' +
      '<input type="range" id="rs-zoom" min="100" max="300" step="5" value="100" disabled>' +
      '<div class="row" style="margin-top:4px">' +
      '<button class="btn sm" type="button" id="rs-fit" disabled>전체 맞춤</button>' +
      '<button class="btn sm" type="button" id="rs-cover" disabled>꽉 채우기</button>' +
      '</div>' +
      '<p class="hint" id="rs-zoom-hint">사진을 고르면 확대해서 원하는 부분을 맞출 수 있어요.</p>' +
      '</div>' +
      '<div class="stage" id="rs-stage"><div class="stage-empty">사진을 고르면 결과가 보입니다</div></div>' +
      '<div class="sticky-actions" style="position:static">' +
      '<button class="btn" type="button" id="rs-png" disabled>PNG 저장</button>' +
      '<button class="btn primary" type="button" id="rs-jpg" disabled>JPG 저장</button>' +
      '</div>' +
      '<p class="hint">100%는 사진 전체가 잘리지 않고 가운데에 맞춰집니다. 확대하면 프레임 밖으로 넘친 부분은 잘리고, 사진을 끌거나 두 손가락으로 벌려서 보여 줄 부분을 고를 수 있습니다.</p>' +
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
    var zoomSlider = $('#rs-zoom', root);
    var zoomVal = $('#rs-zoom-val', root);
    var zoomHint = $('#rs-zoom-hint', root);
    var fitBtn = $('#rs-fit', root);
    var coverBtn = $('#rs-cover', root);

    var state = {
      bmp: null, ratio: PRESETS[0], fill: 'white', scale: 1,
      zoom: 1, pan: { x: 0, y: 0 }, canvas: null, queued: false
    };

    U.dropzone(drop, input, function (files) { load(files[0]); });
    $('#rs-change', root).addEventListener('click', function () { input.click(); });

    function load(file) {
      if (!file) return;
      U.fileToBitmap(file).then(function (bmp) {
        state.bmp = bmp;
        state.zoom = 1;
        state.pan = { x: 0, y: 0 };
        info.textContent = U.baseName(file.name) + ' · ' + bmp.width + '×' + bmp.height + ' · ' + U.bytes(file.size);
        [pngBtn, jpgBtn, zoomSlider, fitBtn, coverBtn].forEach(function (b) { b.disabled = false; });
        syncZoomUI();
        draw();
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

    // 100%에서 사진이 프레임에 맞춰지는 배율(fit)과, 여백 없이 채우는 배율(cover).
    function fitScale(d) {
      return Math.min(d.w / state.bmp.width, d.h / state.bmp.height);
    }
    function coverScale(d) {
      return Math.max(d.w / state.bmp.width, d.h / state.bmp.height);
    }
    function coverPct() {
      if (!state.bmp) return 100;
      var d = targetDims();
      return Math.round((coverScale(d) / fitScale(d)) * 100);
    }

    // 현재 배율·이동값으로 그릴 사진의 크기와, 움직일 수 있는 여유(px).
    function geom(d) {
      var sw = state.bmp.width, sh = state.bmp.height;
      var fit = fitScale(d);
      var dw = sw * fit * state.zoom;
      var dh = sh * fit * state.zoom;
      return {
        dw: dw, dh: dh,
        overflowX: Math.max(0, (dw - d.w) / 2),
        overflowY: Math.max(0, (dh - d.h) / 2)
      };
    }

    function maxZoomPct() {
      var cover = coverPct();
      if (cover <= ZOOM_MAX) return ZOOM_MAX;
      // 가로·세로 비율 차이가 큰 사진도 꽉 채울 수 있게 슬라이더 끝을 늘린다.
      return Math.ceil(cover / ZOOM_STEP) * ZOOM_STEP;
    }

    function syncZoomUI() {
      var pct = Math.round(state.zoom * 100);
      zoomSlider.max = String(maxZoomPct());
      zoomSlider.value = String(pct);
      zoomVal.textContent = pct + '%';
      zoomHint.textContent = pct > 100
        ? '사진을 끌어서 보여 줄 부분을 옮길 수 있어요.'
        : '100%를 넘기거나 두 손가락으로 벌리면 확대되고, 끌어서 보여 줄 부분을 옮길 수 있어요.';
    }

    function setZoom(pct) {
      if (!state.bmp) return;
      state.zoom = U.clamp(pct, ZOOM_MIN, maxZoomPct()) / 100;
      syncZoomUI();
      schedule();
    }

    function schedule() {
      if (state.queued) return;
      state.queued = true;
      var run = function () { state.queued = false; draw(); };
      if (window.requestAnimationFrame) requestAnimationFrame(run);
      else setTimeout(run, 16);
    }

    // 캔버스는 한 번만 만들고 계속 재사용한다 — 드래그·핀치 중에 DOM이 바뀌면 제스처가 끊긴다.
    function canvasEl() {
      if (state.canvas && state.canvas.parentNode === stage) return state.canvas;
      stage.innerHTML = '';
      var c = document.createElement('canvas');
      c.id = 'rs-canvas';
      stage.appendChild(c);
      state.canvas = c;
      return c;
    }

    function draw() {
      if (!state.bmp) return;
      var d = targetDims();
      var canvas = canvasEl();
      if (canvas.width !== d.w || canvas.height !== d.h) {
        canvas.width = d.w;
        canvas.height = d.h;
      }
      canvas.setAttribute('data-w', d.w);
      canvas.setAttribute('data-h', d.h);
      canvas.setAttribute('data-zoom', String(Math.round(state.zoom * 100)));

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
        var bgScale = Math.max(tw / sw, th / sh);
        var cw = sw * bgScale, ch = sh * bgScale;
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

      var g = geom(d);
      var dx = (d.w - g.dw) / 2 + state.pan.x * g.overflowX;
      var dy = (d.h - g.dh) / 2 + state.pan.y * g.overflowY;

      // 100%는 contain — 잘리지 않는다. 확대하면 넘친 부분만 프레임에 맞춰 잘린다.
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, dx, dy, g.dw, g.dh);

      canvas.classList.toggle('rs-pan', g.overflowX > 0 || g.overflowY > 0);
      canvas.setAttribute('data-pan-x', state.pan.x.toFixed(3));
      canvas.setAttribute('data-pan-y', state.pan.y.toFixed(3));

      dimsEl.textContent = d.w + '×' + d.h + ' px';
      targetEl.textContent = state.ratio.id + ' · ' + d.w + '×' + d.h;
    }

    /* ---------- 손가락·마우스 제스처 (한 손가락 이동 / 두 손가락 확대) ---------- */
    var pointers = {};     // pointerId -> {x, y}
    var single = null;     // 한 손가락 이동 기준점
    var pinch = null;      // 두 손가락 확대 기준 {dist, zoom}

    function pointerCount() { return Object.keys(pointers).length; }

    // 화면 좌표 → 캔버스 픽셀
    function canvasPoint(cx, cy) {
      var c = state.canvas;
      if (!c) return null;
      var r = c.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: (cx - r.left) * (c.width / r.width), y: (cy - r.top) * (c.height / r.height) };
    }

    // 화면 이동량만큼 사진을 민다 (프레임 밖으로 벗어나지 않게 clamp).
    function panBy(dx, dy) {
      if (!state.bmp) return;
      var c = state.canvas;
      if (!c) return;
      var r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var d = targetDims();
      var g = geom(d);
      var kx = d.w / r.width;
      var ky = d.h / r.height;
      if (g.overflowX > 0) state.pan.x = U.clamp(state.pan.x + (dx * kx) / g.overflowX, -1, 1);
      if (g.overflowY > 0) state.pan.y = U.clamp(state.pan.y + (dy * ky) / g.overflowY, -1, 1);
    }

    // 손가락 사이의 한 점을 기준으로 확대/축소 — 그 점 아래 사진이 그대로 머문다.
    function zoomAround(cx, cy, pct) {
      if (!state.bmp) return;
      var p = canvasPoint(cx, cy);
      var d = targetDims();
      var g = geom(d);
      if (!p) { setZoom(pct); return; }
      var dx = (d.w - g.dw) / 2 + state.pan.x * g.overflowX;
      var dy = (d.h - g.dh) / 2 + state.pan.y * g.overflowY;
      var u = g.dw > 0 ? U.clamp((p.x - dx) / g.dw, 0, 1) : 0.5;
      var v = g.dh > 0 ? U.clamp((p.y - dy) / g.dh, 0, 1) : 0.5;

      setZoom(pct);

      var g2 = geom(d);
      state.pan.x = g2.overflowX > 0
        ? U.clamp((p.x - u * g2.dw - (d.w - g2.dw) / 2) / g2.overflowX, -1, 1) : 0;
      state.pan.y = g2.overflowY > 0
        ? U.clamp((p.y - v * g2.dh - (d.h - g2.dh) / 2) / g2.overflowY, -1, 1) : 0;
      schedule();
    }

    function pinchState() {
      var ids = Object.keys(pointers);
      if (ids.length < 2) return null;
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var dx = a.x - b.x, dy = a.y - b.y;
      return { dist: Math.sqrt(dx * dx + dy * dy), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    // 손가락 수가 바뀔 때마다 기준을 다시 잡아 화면이 튀지 않게 한다.
    function rebase() {
      var ids = Object.keys(pointers);
      if (ids.length >= 2) {
        var ps = pinchState();
        pinch = ps ? { dist: Math.max(1, ps.dist), zoom: state.zoom } : null;
        single = null;
      } else if (ids.length === 1) {
        single = { id: Number(ids[0]), x: pointers[ids[0]].x, y: pointers[ids[0]].y };
        pinch = null;
      } else {
        single = null;
        pinch = null;
      }
    }

    stage.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      if (!state.bmp) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      rebase();
      if (pinch) stage.classList.add('is-gesture');
      e.preventDefault();
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;

      var prevSingleX = single ? single.x : 0;
      var prevSingleY = single ? single.y : 0;
      var prevPinch = pinch ? pinchState() : null;

      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      e.preventDefault();

      if (pinch) {
        var now = pinchState();
        if (!now || !prevPinch) return;
        // 손가락 사이 중간점이 움직인 만큼 사진도 따라 움직인다.
        panBy(now.x - prevPinch.x, now.y - prevPinch.y);
        if (pinch.dist > 0) zoomAround(now.x, now.y, (pinch.zoom * now.dist / pinch.dist) * 100);
        schedule();
        return;
      }

      if (single && single.id === e.pointerId) {
        var movedX = e.clientX - prevSingleX;
        var movedY = e.clientY - prevSingleY;
        single.x = e.clientX;
        single.y = e.clientY;
        if (!movedX && !movedY) return;
        panBy(movedX, movedY);
        schedule();
      }
    });

    function endPointer(e) {
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      rebase();
      if (!pinch) stage.classList.remove('is-gesture');
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('lostpointercapture', endPointer);

    /* ---------------------------- 컨트롤 ---------------------------- */
    $('#rs-ratios', root).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ratio]');
      if (!b) return;
      var id = b.getAttribute('data-ratio');
      state.ratio = PRESETS.filter(function (p) { return p.id === id; })[0];
      Array.prototype.forEach.call($('#rs-ratios', root).children, function (x) {
        x.classList.toggle('primary', x === b);
      });
      useEl.textContent = state.ratio.use;
      syncZoomUI();
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
      syncZoomUI();
      draw();
    });

    zoomSlider.addEventListener('input', function () {
      setZoom(parseFloat(zoomSlider.value) || ZOOM_MIN);
    });

    fitBtn.addEventListener('click', function () {
      state.pan = { x: 0, y: 0 };
      setZoom(ZOOM_MIN);
    });

    coverBtn.addEventListener('click', function () {
      if (!state.bmp) return;
      var pct = coverPct();
      state.pan = { x: 0, y: 0 };
      // 비율이 같아 cover가 100%면 150%로 살짝 당겨 채운다.
      setZoom(pct <= ZOOM_MIN ? 150 : pct);
    });

    // Saving is a plain download.
    function save(type) {
      if (!state.canvas) return;
      var mime = type === 'png' ? 'image/png' : 'image/jpeg';
      var name = 'resize-' + state.ratio.id.replace(':', 'x') + '-' + U.stamp() + '.' + (type === 'png' ? 'png' : 'jpg');
      try {
        var blob = U.canvasBlobSync(state.canvas, mime, 0.92);
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
