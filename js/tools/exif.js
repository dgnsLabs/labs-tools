/* ============================================================
   사진 EXIF 제거 + 모자이크/블러 마스킹
   Canvas re-render removes all metadata; dabs are replayed from
   the clean base so undo/reset never degrade the original.
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var MAX_DIM = 4096;

  function mount(root) {
    root.innerHTML =

      '<div class="panel" id="ex-drop-panel">' +
      '<div class="drop" id="ex-drop">' +
      '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.6" cy="9.4" r="1.4"/><path d="M3.4 15.6 8 12l3.4 2.5 2.8-2 6.2 4.3"/></svg>' +
      '<b>사진 선택</b><span>JPG / PNG / WebP · 위치·기기 정보 자동 제거</span>' +
      '<input type="file" id="ex-file" accept="image/*" hidden>' +
      '</div>' +
      '<p class="hint">사진을 다시 그려서 저장하기 때문에 EXIF(촬영 위치·기기·시간)가 남지 않습니다. 서버로 전송되지 않습니다.</p>' +
      '</div>' +

      '<div id="ex-editor" hidden>' +
      '<div class="panel tight">' +
      '<div class="stage" id="ex-stage"></div>' +
      '<div class="row" style="margin-top:8px">' +
      '<span class="chip ok">EXIF 제거됨</span>' +
      '<span class="chip" id="ex-dims"></span>' +
      '<span class="grow"></span>' +
      '<button class="btn sm ghost" type="button" id="ex-change">다른 사진</button>' +
      '</div>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="seg" id="ex-mode">' +
      '<button type="button" class="is-on" data-mode="mosaic">모자이크</button>' +
      '<button type="button" data-mode="blur">블러</button>' +
      '</div>' +
      '<div class="field" style="margin-top:12px"><label>브러시 크기 <span class="val" id="ex-brush-val">40</span></label>' +
      '<input type="range" id="ex-brush" min="12" max="160" value="40"></div>' +
      '<div class="row">' +
      '<button class="btn sm" type="button" id="ex-undo">실행 취소</button>' +
      '<button class="btn sm ghost" type="button" id="ex-reset">초기화</button>' +
      '<span class="grow"></span>' +
      '<span class="small muted" id="ex-status">손가락으로 문질러 가리세요</span>' +
      '</div>' +
      '<p class="hint">가린 영역은 원본에서 다시 계산되므로 여러 번 문질러도 뭉개지지 않습니다. 저장할 때만 남습니다.</p>' +
      '</div>' +

      '<div class="sticky-actions">' +
      '<button class="btn" type="button" id="ex-png">PNG 저장</button>' +
      '<button class="btn primary" type="button" id="ex-jpg">JPG 저장</button>' +
      '<button class="btn" type="button" id="ex-share">공유</button>' +
      '</div>' +
      '</div>';

    var input = $('#ex-file', root);
    var drop = $('#ex-drop', root);
    var dropPanel = $('#ex-drop-panel', root);
    var editor = $('#ex-editor', root);
    var stage = $('#ex-stage', root);
    var dimsEl = $('#ex-dims', root);
    var brushEl = $('#ex-brush', root);
    var brushVal = $('#ex-brush-val', root);
    var statusEl = $('#ex-status', root);
    var undoBtn = $('#ex-undo', root);

    var state = {
      base: null, out: null, dabs: [],
      brush: 40, mode: 'mosaic',
      w: 0, h: 0, drawing: false, last: null, stroke: 0,
      fileSize: 0, name: 'photo'
    };
    var scratch = document.createElement('canvas');

    U.dropzone(drop, input, function (files) { load(files[0]); });
    $('#ex-change', root).addEventListener('click', function () { input.click(); });

    function load(file) {
      if (!file) return;
      U.fileToBitmap(file).then(function (bmp) {
        var k = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
        var w = Math.max(1, Math.round(bmp.width * k));
        var h = Math.max(1, Math.round(bmp.height * k));

        var base = document.createElement('canvas');
        base.width = w; base.height = h;
        var bctx = base.getContext('2d');
        bctx.imageSmoothingQuality = 'high';
        bctx.drawImage(bmp, 0, 0, w, h); // ← metadata dropped here

        var out = document.createElement('canvas');
        out.width = w; out.height = h;
        out.id = 'exif-canvas';
        out.getContext('2d').drawImage(base, 0, 0);

        state.base = base;
        state.out = out;
        state.dabs = [];
        state.w = w; state.h = h;
        state.stroke = 0;
        state.last = null;
        state.fileSize = file.size;
        state.name = U.baseName(file.name || 'photo');

        stage.innerHTML = '';
        stage.appendChild(out);

        dropPanel.hidden = true;
        editor.hidden = false;
        dimsEl.textContent = w + '×' + h + (k < 1 ? ' (원본에서 축소)' : '') + ' · ' + U.bytes(file.size);
        updateUndo();

        out.addEventListener('pointerdown', onDown);
        out.addEventListener('pointermove', onMove);
        out.addEventListener('pointerup', onUp);
        out.addEventListener('pointercancel', onUp);
        out.addEventListener('pointerleave', function (e) { if (state.drawing && e.buttons === 0) onUp(e); });

        statusEl.textContent = '손가락으로 문질러 가리세요';
      }).catch(function (e) {
        U.toast(e.message || '사진을 읽지 못했어요', 'err');
      });
    }

    /* ---------------- pointer -> image coordinates ---------------- */
    function point(e) {
      var r = state.out.getBoundingClientRect();
      var k = state.w / r.width;
      return {
        x: (e.clientX - r.left) * k,
        y: (e.clientY - r.top) * k,
        k: k
      };
    }

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      state.drawing = true;
      state.stroke++;
      state.last = null;
      try { state.out.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      addDab(point(e), true);
    }

    function onMove(e) {
      if (!state.drawing) return;
      e.preventDefault();
      addDab(point(e), false);
    }

    function onUp(e) {
      if (!state.drawing) return;
      state.drawing = false;
      state.last = null;
      statusEl.textContent = state.dabs.length ? '가린 부분 ' + state.stroke + '곳 · 되돌리기 가능' : '손가락으로 문질러 가리세요';
      updateUndo();
    }

    function addDab(p, force) {
      var r = Math.max(2, (state.brush / 2) * p.k);
      if (state.last && !force) {
        var dx = p.x - state.last.x, dy = p.y - state.last.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var step = Math.max(1, r * 0.45);
        if (dist < step) return;
        var n = Math.floor(dist / step);
        for (var i = 1; i <= n; i++) {
          var t = i / n;
          pushDab(state.last.x + dx * t, state.last.y + dy * t, r);
        }
      } else {
        pushDab(p.x, p.y, r);
      }
      state.last = p;
    }

    function pushDab(x, y, r) {
      var dab = { x: x, y: y, r: r, mode: state.mode, stroke: state.stroke };
      state.dabs.push(dab);
      paintDab(state.out.getContext('2d'), dab);
    }

    function paintDab(ctx, dab) {
      var w = state.w, h = state.h, base = state.base;
      var r = dab.r;
      var x0 = Math.floor(dab.x - r), y0 = Math.floor(dab.y - r);
      var x1 = Math.ceil(dab.x + r), y1 = Math.ceil(dab.y + r);

      if (dab.mode === 'blur') {
        var pad = Math.ceil(r * 0.7) + 2;
        var sx = U.clamp(x0 - pad, 0, w), sy = U.clamp(y0 - pad, 0, h);
        var sw = U.clamp(x1 + pad, 0, w) - sx, sh = U.clamp(y1 + pad, 0, h) - sy;
        if (sw < 2 || sh < 2) return;
        scratch.width = sw; scratch.height = sh;
        var sctx = scratch.getContext('2d');
        sctx.clearRect(0, 0, sw, sh);
        sctx.drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);

        ctx.save();
        ctx.beginPath();
        ctx.arc(dab.x, dab.y, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.filter = 'blur(' + Math.max(2, Math.round(r * 0.3)) + 'px)';
        ctx.drawImage(scratch, 0, 0, sw, sh, sx, sy, sw, sh);
        ctx.filter = 'none';
        ctx.restore();
      } else {
        // Pixelate on a grid aligned to the image so blocks look even.
        var block = Math.max(3, Math.round(r / 4.5));
        var bx = Math.floor(x0 / block) * block;
        var by = Math.floor(y0 / block) * block;
        var sx2 = U.clamp(bx, 0, w - 1);
        var sy2 = U.clamp(by, 0, h - 1);
        var sw2 = U.clamp(bx + Math.ceil((x1 - bx) / block) * block, 1, w) - sx2;
        var sh2 = U.clamp(by + Math.ceil((y1 - by) / block) * block, 1, h) - sy2;
        if (sw2 < 2 || sh2 < 2) return;
        var tw = Math.max(1, Math.round(sw2 / block));
        var th = Math.max(1, Math.round(sh2 / block));

        scratch.width = tw; scratch.height = th;
        var tctx = scratch.getContext('2d');
        tctx.clearRect(0, 0, tw, th);
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(base, sx2, sy2, sw2, sh2, 0, 0, tw, th);

        ctx.save();
        ctx.beginPath();
        ctx.rect(dab.x - r, dab.y - r, r * 2, r * 2);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(scratch, 0, 0, tw, th, sx2, sy2, tw * block, th * block);
        ctx.imageSmoothingEnabled = true;
        ctx.restore();
      }
    }

    function redraw() {
      if (!state.out) return;
      var ctx = state.out.getContext('2d');
      ctx.clearRect(0, 0, state.w, state.h);
      ctx.drawImage(state.base, 0, 0);
      state.dabs.forEach(function (d) { paintDab(ctx, d); });
    }

    function updateUndo() {
      undoBtn.disabled = state.dabs.length === 0;
    }

    /* ---------------- controls ---------------- */
    $('#ex-mode', root).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (!b) return;
      state.mode = b.getAttribute('data-mode');
      Array.prototype.forEach.call($('#ex-mode', root).children, function (x) {
        x.classList.toggle('is-on', x === b);
      });
    });

    brushEl.addEventListener('input', function () {
      state.brush = parseInt(brushEl.value, 10) || 40;
      brushVal.textContent = String(state.brush);
    });

    undoBtn.addEventListener('click', function () {
      if (!state.dabs.length) return;
      var lastStroke = state.dabs[state.dabs.length - 1].stroke;
      state.dabs = state.dabs.filter(function (d) { return d.stroke !== lastStroke; });
      redraw();
      updateUndo();
      statusEl.textContent = state.dabs.length ? '한 획 되돌렸어요' : '처음 상태로 돌아왔어요';
      U.toast('한 획 되돌렸어요');
    });

    $('#ex-reset', root).addEventListener('click', function () {
      if (!state.dabs.length) { U.toast('가린 부분이 없어요'); return; }
      state.dabs = [];
      state.stroke = 0;
      redraw();
      updateUndo();
      statusEl.textContent = '처음 상태로 돌아왔어요';
      U.toast('초기화했어요');
    });

    /* ---------------- export ---------------- */
    // Saving is a plain download — the share sheet is the separate 공유 button.
    function save(type) {
      if (!state.out) return;
      var mime = type === 'png' ? 'image/png' : 'image/jpeg';
      var name = state.name + '-masked.' + (type === 'png' ? 'png' : 'jpg');
      try {
        var blob = U.canvasBlobSync(state.out, mime, 0.92);
        U.download(blob, name);
        U.toast('저장했어요 · ' + U.bytes(blob.size));
      } catch (e) {
        U.toast(e.message || '저장하지 못했어요', 'err');
      }
    }

    $('#ex-png', root).addEventListener('click', function () { save('png'); });
    $('#ex-jpg', root).addEventListener('click', function () { save('jpg'); });

    $('#ex-share', root).addEventListener('click', function () {
      if (!state.out) return;
      var blob, name;
      try {
        blob = U.canvasBlobSync(state.out, 'image/jpeg', 0.92);
        name = state.name + '-masked.jpg';
      } catch (e) {
        U.toast(e.message || '이미지를 만들지 못했어요', 'err');
        return;
      }
      // navigator.share only opens while the tap is still fresh.
      if (!U.canShareFiles()) {
        U.download(blob, name);
        U.toast('저장했어요');
        return;
      }
      U.shareBlob(blob, name, '사진 공유').then(function (ok) {
        if (!ok) { U.download(blob, name); U.toast('저장했어요'); }
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return; // user closed the share sheet
        U.toast('공유를 열지 못했어요. 저장 버튼을 눌러 주세요.');
      });
    });
  }

  window.Labs.register('exif', { mount: mount });
})();
