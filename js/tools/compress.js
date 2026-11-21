/* ============================================================
   이미지 압축·포맷 변환 (+ 콘텐츠 규격 2MB 프리셋)
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var TARGET_BYTES = 2097152; // 2 MB
  var MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  var MAX_DIM = 8192;

  function mount(root) {
    root.innerHTML =

      '<div class="panel">' +
      '<div class="drop" id="cz-drop">' +
      '<svg viewBox="0 0 24 24"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>' +
      '<b>이미지 선택</b><span>여러 장 한 번에 · JPG / PNG / WebP</span>' +
      '<input type="file" id="cz-file" accept="image/*" multiple hidden>' +
      '</div>' +
      '<div class="row" style="margin-top:8px">' +
      '<span class="chip" id="cz-count">0장</span>' +
      '<span class="grow"></span>' +
      '<button class="btn sm ghost" type="button" id="cz-add">추가</button>' +
      '<button class="btn sm ghost" type="button" id="cz-clear">모두 지우기</button>' +
      '</div>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="panel-head"><h2>변환 설정</h2><span class="aside" id="cz-mode">수동 설정</span></div>' +
      '<button class="btn block" type="button" id="cz-preset">콘텐츠 규격 (JPG/PNG · 2MB 이하)</button>' +
      '<p class="hint" id="cz-preset-hint">스카이파크·굿티브이 콘텐츠 입력 규격에 맞춰, 2MB 이하가 될 때까지 품질과 해상도를 자동으로 낮춥니다.</p>' +

      '<div id="cz-manual">' +
      '<div class="field" style="margin-top:12px"><label>포맷</label>' +
      '<select id="cz-format">' +
      '<option value="original">원본 유지</option>' +
      '<option value="jpg">JPG (사진에 적합)</option>' +
      '<option value="png">PNG (무손실)</option>' +
      '<option value="webp">WebP (가장 작음)</option>' +
      '</select></div>' +

      '<div class="field"><label>품질 <span class="val" id="cz-q-val">82%</span></label>' +
      '<input type="range" id="cz-quality" min="10" max="100" step="1" value="82"></div>' +
      '</div>' +

      '<div class="field" style="margin-bottom:0"><label>최대 가로폭</label>' +
      '<select id="cz-width">' +
      '<option value="0">원본 크기 유지</option>' +
      '<option value="3840">3840 px</option>' +
      '<option value="2560">2560 px</option>' +
      '<option value="1920">1920 px</option>' +
      '<option value="1280">1280 px</option>' +
      '<option value="1080">1080 px</option>' +
      '<option value="720">720 px</option>' +
      '</select></div>' +
      '</div>' +

      '<div id="cz-results"></div>';

    var input = $('#cz-file', root);
    var drop = $('#cz-drop', root);
    var results = $('#cz-results', root);
    var countEl = $('#cz-count', root);
    var modeEl = $('#cz-mode', root);
    var formatEl = $('#cz-format', root);
    var qualityEl = $('#cz-quality', root);
    var qvalEl = $('#cz-q-val', root);
    var widthEl = $('#cz-width', root);
    var presetBtn = $('#cz-preset', root);
    var presetHint = $('#cz-preset-hint', root);

    var state = { items: [], preset: false, seq: 0, running: 0 };

    U.dropzone(drop, input, addFiles);
    $('#cz-add', root).addEventListener('click', function () { input.click(); });
    $('#cz-clear', root).addEventListener('click', function () {
      state.items.forEach(function (it) { if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); });
      state.items = [];
      render();
    });

    async function addFiles(files) {
      var images = files.filter(function (f) { return /^image\//.test(f.type); });
      if (!images.length) { U.toast('이미지 파일만 넣을 수 있어요', 'err'); return; }
      if (images.length < files.length) U.toast('이미지가 아닌 파일은 건너뛰었어요');
      for (var i = 0; i < images.length; i++) {
        var f = images[i];
        try {
          var bmp = await U.fileToBitmap(f);
          state.items.push({
            id: ++state.seq,
            file: f,
            bmp: bmp,
            name: f.name || ('image-' + state.seq),
            origW: bmp.width,
            origH: bmp.height,
            origSize: f.size,
            thumbUrl: URL.createObjectURL(f),
            out: null,
            error: null
          });
        } catch (e) {
          U.toast('읽지 못한 파일: ' + f.name, 'err');
        }
      }
      render();
      processAll();
    }

    /* -------------- processing -------------- */
    function renderTo(bitmap, scale, type, quality) {
      var w = Math.max(1, Math.round(bitmap.width * scale));
      var h = Math.max(1, Math.round(bitmap.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (type === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, w, h);
      return U.canvasToBlob(canvas, type, quality).then(function (blob) {
        return { blob: blob, w: w, h: h };
      });
    }

    function outputType(item) {
      if (state.preset) {
        return /png$/i.test(item.file.type) || /\.png$/i.test(item.name) ? 'image/png' : 'image/jpeg';
      }
      var fmt = formatEl.value;
      if (fmt === 'original') {
        if (/jpe?g/i.test(item.file.type)) return 'image/jpeg';
        if (/png/i.test(item.file.type)) return 'image/png';
        if (/webp/i.test(item.file.type)) return 'image/webp';
        return 'image/png';
      }
      return MIME[fmt] || 'image/jpeg';
    }

    function maxWidthFor() {
      var v = parseInt(widthEl.value, 10) || 0;
      return v;
    }

    async function processItem(item) {
      var type = outputType(item);
      var cap = maxWidthFor();
      var baseScale = 1;
      if (cap && item.origW > cap) baseScale = cap / item.origW;
      var longSide = Math.max(item.origW, item.origH);
      if (longSide * baseScale > MAX_DIM) baseScale = MAX_DIM / longSide;

      var quality = parseInt(qualityEl.value, 10) / 100;

      try {
        if (state.preset) {
          // Step down quality, then resolution, until the file fits 2 MB.
          var scale = baseScale;
          var q = type === 'image/png' ? null : Math.min(0.92, quality + 0.1);
          var last = null;
          for (var attempt = 0; attempt < 16; attempt++) {
            var res = await renderTo(item.bmp, scale, type, q == null ? undefined : q);
            last = res;
            if (res.blob.size <= TARGET_BYTES) break;
            if (type === 'image/png') {
              scale *= 0.8;
            } else if (q > 0.52) {
              q = Math.max(0.5, q - 0.1);
            } else {
              q = 0.85;
              scale *= 0.82;
            }
            if (scale < 0.12) break;
          }
          item.out = {
            blob: last.blob, w: last.w, h: last.h, type: type,
            quality: q, fitted: last.blob.size <= TARGET_BYTES, target: TARGET_BYTES
          };
        } else {
          var r = await renderTo(item.bmp, baseScale, type, type === 'image/png' ? undefined : quality);
          item.out = { blob: r.blob, w: r.w, h: r.h, type: type, quality: quality };
        }
        item.error = null;
      } catch (e) {
        item.error = e.message || '변환 실패';
        item.out = null;
      }
    }

    async function processAll() {
      if (!state.items.length) { render(); return; }
      var token = ++state.running;
      var queue = state.items.slice();
      render();
      for (var i = 0; i < queue.length; i++) {
        if (token !== state.running) return; // superseded by a newer run
        await processItem(queue[i]);
        render();
      }
    }

    function typeExt(type) {
      return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    }

    /* -------------- rendering -------------- */
    function render() {
      countEl.textContent = state.items.length + '장';
      modeEl.textContent = state.preset ? '콘텐츠 규격 · 2MB' : '수동 설정';

      if (!state.items.length) { results.innerHTML = ''; return; }

      var done = state.items.filter(function (i) { return i.out; });
      var origTotal = state.items.reduce(function (s, i) { return s + i.origSize; }, 0);
      var outTotal = done.reduce(function (s, i) { return s + i.out.blob.size; }, 0);
      var saved = origTotal > 0 && done.length ? Math.round((1 - outTotal / origTotal) * 100) : 0;

      var rows = state.items.map(function (it) {
        var sub;
        if (it.error) {
          sub = '<span class="warn">' + U.esc(it.error) + '</span>';
        } else if (it.out) {
          var pct = it.origSize ? Math.round((1 - it.out.blob.size / it.origSize) * 100) : 0;
          var dims = it.out.w + '×' + it.out.h;
          sub = U.bytes(it.origSize) + ' → <b>' + U.bytes(it.out.blob.size) + '</b> ' +
            '<span class="' + (pct >= 0 ? 'good' : 'warn') + '">(' + (pct >= 0 ? '-' : '+') + Math.abs(pct) + '%)</span> · ' + dims;
          if (it.out.fitted) sub += ' · <span class="good">2MB 이하</span>';
          else if (it.out.target) sub += ' · <span class="warn">2MB 초과</span>';
        } else {
          sub = U.bytes(it.origSize) + ' · ' + it.origW + '×' + it.origH + ' 처리 중…';
        }
        return '<div class="item" data-fitted="' + (it.out && it.out.fitted ? '1' : '0') + '">' +
          '<img class="thumb" src="' + it.thumbUrl + '" alt="">' +
          '<div class="meta"><div class="name">' + U.esc(it.name) + '</div><div class="sub">' + sub + '</div></div>' +
          '<div class="acts">' +
          (it.out ? '<button class="icon-btn" type="button" data-save="' + it.id + '" aria-label="저장">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button>' : '') +
          '<button class="icon-btn" type="button" data-remove="' + it.id + '" aria-label="삭제">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
          '</div></div>';
      }).join('');

      results.innerHTML =
        '<div class="panel">' +
        '<div class="panel-head"><h2>결과</h2><span class="aside">' + done.length + '/' + state.items.length + ' 완료</span></div>' +
        '<div class="items">' + rows + '</div>' +
        (done.length ? '<p class="hint">전체 ' + U.bytes(origTotal) + ' → ' + U.bytes(outTotal) +
          (saved >= 0 ? ' · <b>' + saved + '% 절감</b>' : '') + '</p>' : '') +
        (state.preset ? '<p class="hint">JPG/PNG로 2MB 이하가 되도록 자동 조정했습니다. 원본이 PNG면 투명도 유지를 위해 PNG로 저장합니다.</p>' : '') +
        '</div>' +
        (done.length ? '<div class="sticky-actions">' +
          '<button class="btn primary block" type="button" id="cz-zip">ZIP으로 모두 저장</button>' +
          '</div>' : '');

      results.querySelectorAll('[data-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = parseInt(b.getAttribute('data-remove'), 10);
          var it = state.items.filter(function (x) { return x.id === id; })[0];
          if (it && it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
          state.items = state.items.filter(function (x) { return x.id !== id; });
          render();
        });
      });
      results.querySelectorAll('[data-save]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = parseInt(b.getAttribute('data-save'), 10);
          var it = state.items.filter(function (x) { return x.id === id; })[0];
          if (!it || !it.out) return;
          var name = U.baseName(it.name) + '-min.' + typeExt(it.out.type);
          U.saveOrShare(it.out.blob, name, it.name);
        });
      });
      var zipBtn = $('#cz-zip', results);
      if (zipBtn) zipBtn.addEventListener('click', function () {
        var entries = done.map(function (it) {
          return { name: U.baseName(it.name) + '-min.' + typeExt(it.out.type), blob: it.out.blob };
        });
        U.busy(zipBtn, true, '묶는 중');
        U.zipBlobs(entries, 'compressed-' + U.stamp() + '.zip').then(function () {
          U.toast('ZIP을 저장했어요');
        }).catch(function (e) {
          U.toast(e.message || 'ZIP을 만들지 못했어요', 'err');
        }).then(function () { U.busy(zipBtn, false); });
      });
    }

    /* -------------- presets & controls -------------- */
    presetBtn.addEventListener('click', function () {
      state.preset = !state.preset;
      presetBtn.classList.toggle('primary', state.preset);
      presetBtn.textContent = state.preset
        ? '콘텐츠 규격 사용 중 · 2MB 이하 (해제하려면 누르세요)'
        : '콘텐츠 규격 (JPG/PNG · 2MB 이하)';
      formatEl.disabled = state.preset;
      qualityEl.disabled = state.preset;
      $('#cz-manual', root).hidden = state.preset;
      presetHint.textContent = state.preset
        ? '2,097,152 bytes 이하가 될 때까지 품질과 해상도를 단계적으로 낮춥니다. 원본이 PNG면 PNG, 그 외에는 JPG로 저장합니다.'
        : '스카이파크·굿티브이 콘텐츠 입력 규격에 맞춰, 2MB 이하가 될 때까지 품질과 해상도를 자동으로 낮춥니다.';
      processAll();
    });

    formatEl.addEventListener('change', function () {
      var fmt = formatEl.value;
      if (fmt === 'png') {
        qualityEl.disabled = true;
        qvalEl.textContent = '무손실';
      } else {
        qualityEl.disabled = state.preset;
        qvalEl.textContent = qualityEl.value + '%';
      }
      processAll();
    });
    qualityEl.addEventListener('input', function () {
      qvalEl.textContent = qualityEl.value + '%';
    });
    qualityEl.addEventListener('change', processAll);
    widthEl.addEventListener('change', processAll);
  }

  window.Labs.register('compress', { mount: mount });
})();
