/* ============================================================
   워터마크 — text or logo overlay for many photos at once
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var MAX_DIM = 4096;
  var FONT = '700 %SIZE%px system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

  function mount(root) {
    root.innerHTML =

      '<div class="panel">' +
      '<div class="drop" id="wm-drop">' +
      '<svg viewBox="0 0 24 24"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>' +
      '<b>이미지 선택</b><span>여러 장 한 번에 · JPG / PNG / WebP</span>' +
      '<input type="file" id="wm-file" accept="image/*" multiple hidden>' +
      '</div>' +
      '<div class="row" style="margin-top:8px"><span class="chip" id="wm-count">0장</span>' +
      '<span class="grow"></span><button class="btn sm ghost" type="button" id="wm-add">추가</button>' +
      '<button class="btn sm ghost" type="button" id="wm-clear">모두 지우기</button></div>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="seg" id="wm-mode" style="margin-bottom:12px">' +
      '<button type="button" class="is-on" data-mode="text">텍스트</button>' +
      '<button type="button" data-mode="logo">로고 이미지</button>' +
      '</div>' +

      '<div id="wm-text-fields">' +
      '<div class="field"><label>문구</label>' +
      '<div class="row nowrap"><input class="grow" type="text" id="wm-text" value="@아이디" maxlength="80" autocomplete="off">' +
      '<input type="color" id="wm-color" value="#ffffff" aria-label="글자색"></div></div>' +
      '</div>' +

      '<div id="wm-logo-fields" hidden>' +
      '<div class="drop" id="wm-logo-drop" style="padding:16px">' +
      '<b id="wm-logo-label">로고 이미지 선택 (PNG 권장)</b>' +
      '<input type="file" id="wm-logo-file" accept="image/png,image/webp,image/jpeg" hidden>' +
      '</div>' +
      '</div>' +

      '<div class="field"><label>투명도 <span class="val" id="wm-op-val">60%</span></label>' +
      '<input type="range" id="wm-opacity" min="5" max="100" value="60"></div>' +

      '<div class="field"><label><span id="wm-size-label">크기</span> <span class="val" id="wm-size-val">6%</span></label>' +
      '<input type="range" id="wm-size" min="2" max="24" value="6"></div>' +

      '<div class="field"><label>위치</label>' +
      '<div class="seg" id="wm-pos">' +
      '<button type="button" class="is-on" data-pos="br">우하단</button>' +
      '<button type="button" data-pos="center">중앙</button>' +
      '<button type="button" data-pos="tile">전체 반복</button>' +
      '</div></div>' +

      '<div class="field" style="margin-bottom:0"><label>저장 포맷</label>' +
      '<select id="wm-format"><option value="jpg" selected>JPG (사진)</option><option value="png">PNG (투명도 유지)</option></select></div>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="panel-head"><h2>미리보기</h2><span class="aside" id="wm-preview-note"></span></div>' +
      '<div class="stage" id="wm-stage"><div class="stage-empty">이미지를 고르면 미리보기가 나옵니다</div></div>' +
      '</div>' +

      '<div id="wm-results"></div>';

    var input = $('#wm-file', root);
    var drop = $('#wm-drop', root);
    var logoInput = $('#wm-logo-file', root);
    var logoDrop = $('#wm-logo-drop', root);
    var stage = $('#wm-stage', root);
    var results = $('#wm-results', root);
    var countEl = $('#wm-count', root);

    var state = {
      items: [],
      mode: 'text',
      text: '@아이디',
      color: '#ffffff',
      opacity: 60,
      size: 6,
      position: 'br',
      format: 'jpg',
      logo: null,
      seq: 0
    };

    U.dropzone(drop, input, addFiles);
    $('#wm-add', root).addEventListener('click', function () { input.click(); });
    $('#wm-clear', root).addEventListener('click', function () {
      state.items.forEach(function (it) { if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); });
      state.items = [];
      render();
    });

    logoDrop.addEventListener('click', function (e) {
      if (e.target.closest('input')) return;
      logoInput.click();
    });
    logoInput.addEventListener('change', function () {
      var f = logoInput.files && logoInput.files[0];
      if (!f) return;
      U.fileToBitmap(f).then(function (bmp) {
        state.logo = bmp;
        state.logoName = f.name;
        $('#wm-logo-label', root).textContent = f.name + ' · ' + bmp.width + '×' + bmp.height;
        preview();
      }).catch(function () { U.toast('로고 이미지를 읽지 못했어요', 'err'); });
      logoInput.value = '';
    });

    async function addFiles(files) {
      var imgs = files.filter(function (f) { return /^image\//.test(f.type); });
      if (!imgs.length) { U.toast('이미지 파일만 넣을 수 있어요', 'err'); return; }
      for (var i = 0; i < imgs.length; i++) {
        try {
          var bmp = await U.fileToBitmap(imgs[i]);
          state.items.push({
            id: ++state.seq,
            file: imgs[i],
            bmp: bmp,
            name: imgs[i].name || ('image-' + state.seq),
            w: bmp.width,
            h: bmp.height,
            thumbUrl: URL.createObjectURL(imgs[i])
          });
        } catch (e) {
          U.toast('읽지 못한 파일: ' + imgs[i].name, 'err');
        }
      }
      render();
    }

    /* ---------------- painting ---------------- */
    function paint(ctx, w, h) {
      var alpha = state.opacity / 100;
      var margin = Math.round(w * 0.04);

      ctx.save();
      ctx.globalAlpha = alpha;

      if (state.mode === 'text') {
        var text = state.text || '';
        if (!text) { ctx.restore(); return; }
        var size = Math.max(8, Math.round(w * (state.size / 100)));
        ctx.font = FONT.replace('%SIZE%', String(size));
        ctx.fillStyle = state.color;
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = Math.max(2, size * 0.18);
        ctx.shadowOffsetY = Math.max(1, size * 0.04);

        if (state.position === 'tile') {
          var tw = ctx.measureText(text).width + size * 1.8;
          var th = size * 2.6;
          ctx.translate(w / 2, h / 2);
          ctx.rotate(-Math.PI / 6);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var span = Math.sqrt(w * w + h * h) / 2;
          for (var y = -span; y <= span; y += th) {
            var offset = (Math.round(y / th) % 2) ? tw / 2 : 0;
            for (var x = -span; x <= span; x += tw) {
              ctx.fillText(text, x + offset, y);
            }
          }
        } else if (state.position === 'center') {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, w / 2, h / 2);
        } else {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(text, w - margin, h - margin);
        }
      } else if (state.logo) {
        var logoW = Math.max(12, Math.round(w * (state.size / 100) * 1.8));
        var logoH = Math.round(logoW * (state.logo.height / state.logo.width));

        if (state.position === 'tile') {
          var stepX = logoW * 1.7;
          var stepY = logoH * 2.2;
          for (var ty = margin; ty < h; ty += stepY) {
            for (var tx = margin; tx < w; tx += stepX) {
              ctx.drawImage(state.logo, tx, ty, logoW, logoH);
            }
          }
        } else if (state.position === 'center') {
          ctx.drawImage(state.logo, (w - logoW) / 2, (h - logoH) / 2, logoW, logoH);
        } else {
          ctx.drawImage(state.logo, w - margin - logoW, h - margin - logoH, logoW, logoH);
        }
      }
      ctx.restore();
    }

    function compose(item, maxDim) {
      var scale = Math.min(1, maxDim / Math.max(item.w, item.h));
      var w = Math.max(1, Math.round(item.w * scale));
      var h = Math.max(1, Math.round(item.h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (state.format === 'jpg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(item.bmp, 0, 0, w, h);
      paint(ctx, w, h);
      return canvas;
    }

    function preview() {
      if (!state.items.length) {
        stage.innerHTML = '<div class="stage-empty">이미지를 고르면 미리보기가 나옵니다</div>';
        return;
      }
      var canvas = compose(state.items[0], 900);
      stage.innerHTML = '';
      stage.appendChild(canvas);
      $('#wm-preview-note', root).textContent = '첫 번째 사진 미리보기 · ' + state.items[0].name;
    }

    var previewSoon = U.debounce(preview, 80);

    /* ---------------- results ---------------- */
    function render() {
      countEl.textContent = state.items.length + '장';
      preview();

      if (!state.items.length) { results.innerHTML = ''; return; }

      var rows = state.items.map(function (it, i) {
        return '<div class="item">' +
          '<img class="thumb" src="' + it.thumbUrl + '" alt="">' +
          '<div class="meta"><div class="name">' + U.esc(it.name) + '</div>' +
          '<div class="sub">' + it.w + '×' + it.h + ' · ' + U.bytes(it.file.size) + '</div></div>' +
          '<div class="acts">' +
          '<button class="icon-btn" type="button" data-save="' + it.id + '" aria-label="저장">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button>' +
          '<button class="icon-btn" type="button" data-remove="' + it.id + '" aria-label="삭제">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
          '</div></div>';
      }).join('');

      results.innerHTML = '<div class="panel">' +
        '<div class="panel-head"><h2>사진 목록</h2><span class="aside">' + state.items.length + '장</span></div>' +
        '<div class="items">' + rows + '</div>' +
        '</div>' +
        '<div class="sticky-actions">' +
        '<button class="btn primary block" type="button" id="wm-all">전체 저장 (ZIP)</button>' +
        '</div>';

      results.querySelectorAll('[data-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = parseInt(b.getAttribute('data-remove'), 10);
          var it = state.items.filter(function (x) { return x.id === id; })[0];
          if (it) URL.revokeObjectURL(it.thumbUrl);
          state.items = state.items.filter(function (x) { return x.id !== id; });
          render();
        });
      });

      results.querySelectorAll('[data-save]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = parseInt(b.getAttribute('data-save'), 10);
          var it = state.items.filter(function (x) { return x.id === id; })[0];
          if (!it) return;
          U.busy(b, true, '');
          var canvas = compose(it, MAX_DIM);
          var mime = state.format === 'png' ? 'image/png' : 'image/jpeg';
          U.canvasToBlob(canvas, mime, 0.92).then(function (blob) {
            return U.saveOrShare(blob, U.baseName(it.name) + '-wm.' + (state.format === 'png' ? 'png' : 'jpg'), '워터마크');
          }).catch(function (e) { U.toast(e.message || '저장하지 못했어요', 'err'); })
            .then(function () { U.busy(b, false); });
        });
      });

      var all = $('#wm-all', results);
      if (all) all.addEventListener('click', async function () {
        U.busy(all, true, '만드는 중');
        try {
          var entries = [];
          for (var i = 0; i < state.items.length; i++) {
            var it = state.items[i];
            var canvas = compose(it, MAX_DIM);
            var mime = state.format === 'png' ? 'image/png' : 'image/jpeg';
            var blob = await U.canvasToBlob(canvas, mime, 0.92);
            entries.push({ name: U.baseName(it.name) + '-wm.' + (state.format === 'png' ? 'png' : 'jpg'), blob: blob });
          }
          await U.zipBlobs(entries, 'watermarked-' + U.stamp() + '.zip');
          U.toast('ZIP을 저장했어요');
        } catch (e) {
          U.toast(e.message || '저장하지 못했어요', 'err');
        }
        U.busy(all, false);
      });
    }

    /* ---------------- controls ---------------- */
    $('#wm-mode', root).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (!b) return;
      state.mode = b.getAttribute('data-mode');
      Array.prototype.forEach.call($('#wm-mode', root).children, function (x) { x.classList.toggle('is-on', x === b); });
      $('#wm-text-fields', root).hidden = state.mode !== 'text';
      $('#wm-logo-fields', root).hidden = state.mode !== 'logo';
      $('#wm-size-label', root).textContent = state.mode === 'logo' ? '로고 크기' : '크기';
      previewSoon();
    });

    $('#wm-text', root).addEventListener('input', function (e) {
      state.text = e.target.value;
      previewSoon();
    });
    $('#wm-color', root).addEventListener('input', function (e) {
      state.color = e.target.value;
      previewSoon();
    });
    $('#wm-opacity', root).addEventListener('input', function (e) {
      state.opacity = parseInt(e.target.value, 10);
      $('#wm-op-val', root).textContent = state.opacity + '%';
      previewSoon();
    });
    $('#wm-size', root).addEventListener('input', function (e) {
      state.size = parseInt(e.target.value, 10);
      $('#wm-size-val', root).textContent = state.size + '%';
      previewSoon();
    });
    $('#wm-pos', root).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pos]');
      if (!b) return;
      state.position = b.getAttribute('data-pos');
      Array.prototype.forEach.call($('#wm-pos', root).children, function (x) { x.classList.toggle('is-on', x === b); });
      previewSoon();
    });
    $('#wm-format', root).addEventListener('change', function (e) {
      state.format = e.target.value;
      previewSoon();
    });

  }

  window.Labs.register('watermark', { mount: mount });
})();
