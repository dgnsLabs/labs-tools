/* ============================================================
   PDF ↔ 이미지
   PDF → PNG/JPG (pdf.js)  |  이미지 → PDF (pdf-lib)
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var A4 = { w: 595.28, h: 841.89 };

  function mount(root) {
    root.innerHTML =

      '<div class="panel tight">' +
      '<div class="seg" id="pdf-tabs">' +
      '<button type="button" class="is-on" data-tab="toimg">PDF → 이미지</button>' +
      '<button type="button" data-tab="topdf">이미지 → PDF</button>' +
      '</div>' +
      '</div>' +

      /* ---------------- PDF → image ---------------- */
      '<div id="pdf-toimg">' +
      '<div class="panel">' +
      '<div class="drop" id="pdf-drop">' +
      '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>' +
      '<b>PDF 선택</b><span>각 페이지를 고해상도 이미지로</span>' +
      '<input type="file" id="pdf-file" accept="application/pdf,.pdf" hidden>' +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
      '<div class="field grow" style="margin:0"><label>해상도</label>' +
      '<select id="pdf-scale">' +
      '<option value="1.5">표준 (108 dpi)</option>' +
      '<option value="2" selected>고화질 (144 dpi)</option>' +
      '<option value="3">최대 (216 dpi)</option>' +
      '<option value="4">인쇄 (288 dpi)</option>' +
      '</select></div>' +
      '<div class="field grow" style="margin:0"><label>형식</label>' +
      '<select id="pdf-format"><option value="png" selected>PNG</option><option value="jpg">JPG</option></select></div>' +
      '</div>' +
      '<div id="pdf-progress" hidden><div class="progress-wrap"><div class="bar"><i></i></div>' +
      '<div class="bar-row"><span id="pdf-progress-label">준비 중</span><span id="pdf-progress-pct"></span></div></div></div>' +
      '</div>' +
      '<div id="pdf-pages"></div>' +
      '</div>' +

      /* ---------------- image → PDF ---------------- */
      '<div id="pdf-topdf" hidden>' +
      '<div class="panel">' +
      '<div class="drop" id="ipdf-drop">' +
      '<svg viewBox="0 0 24 24"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>' +
      '<b>이미지 선택</b><span>여러 장 · 순서대로 PDF 한 장이 됩니다</span>' +
      '<input type="file" id="ipdf-file" accept="image/*" multiple hidden>' +
      '</div>' +
      '<div class="row" style="margin-top:8px"><span class="chip" id="ipdf-count">0장</span>' +
      '<span class="grow"></span>' +
      '<button class="btn sm ghost" type="button" id="ipdf-add">추가</button>' +
      '<button class="btn sm ghost" type="button" id="ipdf-clear">모두 지우기</button></div>' +
      '<div class="field" style="margin:12px 0 0"><label>페이지 크기</label>' +
      '<select id="ipdf-size"><option value="a4" selected>A4 (여백 없이 꽉 채움)</option><option value="ratio">원본 비율 (A4 너비 기준)</option></select></div>' +
      '</div>' +
      '<div id="ipdf-list"></div>' +
      '</div>';

    /* ================= tab switching ================= */
    $('#pdf-tabs', root).addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      var tab = b.getAttribute('data-tab');
      Array.prototype.forEach.call($('#pdf-tabs', root).children, function (x) { x.classList.toggle('is-on', x === b); });
      $('#pdf-toimg', root).hidden = tab !== 'toimg';
      $('#pdf-topdf', root).hidden = tab !== 'topdf';
    });

    /* ================= PDF → images ================= */
    var pdfState = { pages: [], token: 0, name: 'document' };
    var pdfDrop = $('#pdf-drop', root);
    var pdfInput = $('#pdf-file', root);
    var pagesEl = $('#pdf-pages', root);
    var progress = $('#pdf-progress', root);
    var progressBar = progress.querySelector('.bar > i');
    var progressLabel = $('#pdf-progress-label', root);
    var progressPct = $('#pdf-progress-pct', root);

    U.dropzone(pdfDrop, pdfInput, function (files) {
      var f = files.filter(function (x) { return /pdf$/i.test(x.type) || /\.pdf$/i.test(x.name); })[0];
      if (!f) { U.toast('PDF 파일을 선택해 주세요', 'err'); return; }
      convertPdf(f);
    });

    async function convertPdf(file) {
      var token = ++pdfState.token;
      clearPages();
      progress.hidden = false;
      progressBar.style.width = '0%';
      progressLabel.textContent = 'PDF 여는 중…';
      progressPct.textContent = '';
      pdfState.name = U.baseName(file.name);

      try {
        var pdfjs = await U.ensureLib('pdfjs');
        var data = await U.readFile(file);
        var doc = await pdfjs.getDocument({ data: data, isEvalSupported: false }).promise;
        var total = doc.numPages;
        var scale = parseFloat($('#pdf-scale', root).value) || 2;
        var fmt = $('#pdf-format', root).value;
        var mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';

        for (var i = 1; i <= total; i++) {
          if (token !== pdfState.token) return;
          progressLabel.textContent = i + ' / ' + total + ' 페이지';
          var page = await doc.getPage(i);
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          page.cleanup();

          var blob = await U.canvasToBlob(canvas, mime, 0.92);
          addPage({
            page: i,
            blob: blob,
            w: canvas.width,
            h: canvas.height,
            url: URL.createObjectURL(blob)
          });
          var pct = Math.round((i / total) * 100);
          progressBar.style.width = pct + '%';
          progressPct.textContent = pct + '%';
          canvas.width = canvas.height = 0;
          await new Promise(function (r) { setTimeout(r, 0); });
        }
        if (token !== pdfState.token) return;
        progressLabel.textContent = total + '페이지 완료';
        U.toast(total + '페이지를 이미지로 만들었어요');
        doc.destroy();
      } catch (e) {
        console.error(e);
        progressLabel.textContent = 'PDF를 처리하지 못했어요';
        U.toast('PDF를 읽지 못했어요. 암호가 걸린 PDF인지 확인해 주세요.', 'err', 3600);
      }
    }

    function clearPages() {
      pdfState.pages.forEach(function (p) { URL.revokeObjectURL(p.url); });
      pdfState.pages = [];
      pagesEl.innerHTML = '';
    }

    function addPage(p) {
      pdfState.pages.push(p);
      pagesEl.innerHTML = '';
      pagesEl.appendChild(U.el(
        '<div class="panel">' +
        '<div class="panel-head"><h2>페이지</h2><span class="aside">' + pdfState.pages.length + '장 · ' + p.w + '×' + p.h + '</span></div>' +
        '<div class="grid-thumbs">' +
        pdfState.pages.map(function (x) {
          return '<div class="thumb-card">' +
            '<img src="' + x.url + '" alt="' + x.page + '페이지" loading="lazy">' +
            '<div class="bar-row"><b>p.' + x.page + '</b><span>' + U.bytes(x.blob.size) + '</span></div>' +
            '<div style="padding:0 8px 8px"><button class="btn sm block" type="button" data-dl="' + x.page + '">저장</button></div>' +
            '</div>';
        }).join('') +
        '</div>' +
        '<div class="sticky-actions" style="position:static">' +
        '<button class="btn primary block" type="button" id="pdf-zip">ZIP으로 모두 저장</button>' +
        '</div></div>'
      ));

      pagesEl.querySelectorAll('[data-dl]').forEach(function (b) {
        b.addEventListener('click', function () {
          var num = parseInt(b.getAttribute('data-dl'), 10);
          var pg = pdfState.pages.filter(function (x) { return x.page === num; })[0];
          if (!pg) return;
          U.download(pg.blob, pdfState.name + '-p' + String(num).padStart(2, '0') + (pg.blob.type === 'image/jpeg' ? '.jpg' : '.png'));
          U.toast('저장했어요 · ' + U.bytes(pg.blob.size));
        });
      });

      var zipBtn = $('#pdf-zip', pagesEl);
      if (zipBtn) zipBtn.addEventListener('click', function () {
        var ext = $('#pdf-format', root).value === 'jpg' ? '.jpg' : '.png';
        U.busy(zipBtn, true, '묶는 중');
        U.zipBlobs(pdfState.pages.map(function (x) {
          return { name: pdfState.name + '-p' + String(x.page).padStart(2, '0') + ext, blob: x.blob };
        }), pdfState.name + '-pages.zip').then(function () {
          U.toast('ZIP을 저장했어요');
        }).catch(function (e) {
          U.toast(e.message || 'ZIP을 만들지 못했어요', 'err');
        }).then(function () { U.busy(zipBtn, false); });
      });
    }

    /* ================= images → PDF ================= */
    var ip = { items: [], seq: 0, running: false };
    var ipDrop = $('#ipdf-drop', root);
    var ipInput = $('#ipdf-file', root);
    var ipList = $('#ipdf-list', root);

    U.dropzone(ipDrop, ipInput, addImages);
    $('#ipdf-add', root).addEventListener('click', function () { ipInput.click(); });
    $('#ipdf-clear', root).addEventListener('click', function () {
      ip.items.forEach(function (it) { URL.revokeObjectURL(it.thumbUrl); });
      ip.items = [];
      renderList();
    });

    async function addImages(files) {
      var imgs = files.filter(function (f) { return /^image\//.test(f.type); });
      if (!imgs.length) { U.toast('이미지 파일만 넣을 수 있어요', 'err'); return; }
      for (var i = 0; i < imgs.length; i++) {
        try {
          var bmp = await U.fileToBitmap(imgs[i]);
          ip.items.push({
            id: ++ip.seq,
            file: imgs[i],
            bmp: bmp,
            name: imgs[i].name,
            w: bmp.width,
            h: bmp.height,
            thumbUrl: URL.createObjectURL(imgs[i])
          });
        } catch (e) { U.toast('읽지 못한 파일: ' + imgs[i].name, 'err'); }
      }
      renderList();
    }

    function move(id, dir) {
      var i = ip.items.findIndex(function (x) { return x.id === id; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= ip.items.length) return;
      var t = ip.items[i]; ip.items[i] = ip.items[j]; ip.items[j] = t;
      renderList();
    }

    function renderList() {
      $('#ipdf-count', root).textContent = ip.items.length + '장';
      if (!ip.items.length) { ipList.innerHTML = ''; return; }

      ipList.innerHTML = '<div class="panel">' +
        '<div class="panel-head"><h2>순서</h2><span class="aside">위에서부터 1페이지</span></div>' +
        '<div class="items">' +
        ip.items.map(function (it, i) {
          return '<div class="item">' +
            '<span class="chip" style="width:24px;justify-content:center">' + (i + 1) + '</span>' +
            '<img class="thumb" src="' + it.thumbUrl + '" alt="">' +
            '<div class="meta"><div class="name">' + U.esc(it.name) + '</div>' +
            '<div class="sub">' + it.w + '×' + it.h + ' · ' + U.bytes(it.file.size) + '</div></div>' +
            '<div class="acts">' +
            '<button class="icon-btn" type="button" data-up="' + it.id + '" aria-label="위로"' + (i === 0 ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg></button>' +
            '<button class="icon-btn" type="button" data-down="' + it.id + '" aria-label="아래로"' + (i === ip.items.length - 1 ? ' disabled' : '') + '>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>' +
            '<button class="icon-btn" type="button" data-del="' + it.id + '" aria-label="삭제">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
            '</div></div>';
        }).join('') +
        '</div>' +
        '<div class="sticky-actions" style="position:static">' +
        '<button class="btn primary block" type="button" id="ipdf-go">PDF 만들기</button>' +
        '</div></div>';

      ipList.querySelectorAll('[data-up]').forEach(function (b) {
        b.addEventListener('click', function () { move(parseInt(b.getAttribute('data-up'), 10), -1); });
      });
      ipList.querySelectorAll('[data-down]').forEach(function (b) {
        b.addEventListener('click', function () { move(parseInt(b.getAttribute('data-down'), 10), 1); });
      });
      ipList.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = parseInt(b.getAttribute('data-del'), 10);
          var it = ip.items.filter(function (x) { return x.id === id; })[0];
          if (it) URL.revokeObjectURL(it.thumbUrl);
          ip.items = ip.items.filter(function (x) { return x.id !== id; });
          renderList();
        });
      });

      var go = $('#ipdf-go', ipList);
      if (go) go.addEventListener('click', function () { makePdf(go); });
    }

    async function embed(doc, it) {
      var type = it.file.type;
      if (/jpe?g/.test(type) || /\.jpe?g$/i.test(it.name)) {
        try { return await doc.embedJpg(await U.readFile(it.file)); } catch (e) { /* fall through */ }
      }
      if (/png/.test(type) || /\.png$/i.test(it.name)) {
        try { return await doc.embedPng(await U.readFile(it.file)); } catch (e) { /* fall through */ }
      }
      // webp / gif / anything else → re-encode as PNG
      var canvas = document.createElement('canvas');
      canvas.width = it.w; canvas.height = it.h;
      canvas.getContext('2d').drawImage(it.bmp, 0, 0);
      var blob = await U.canvasToBlob(canvas, 'image/png');
      return doc.embedPng(await blob.arrayBuffer());
    }

    async function makePdf(btn) {
      if (!ip.items.length) { U.toast('이미지를 먼저 넣어 주세요', 'err'); return; }
      U.busy(btn, true, 'PDF 만드는 중');
      try {
        var PDFLib = await U.ensureLib('pdflib');
        var doc = await PDFLib.PDFDocument.create();
        var mode = $('#ipdf-size', root).value;

        for (var i = 0; i < ip.items.length; i++) {
          var it = ip.items[i];
          var img = await embed(doc, it);
          if (mode === 'a4') {
            var page = doc.addPage([A4.w, A4.h]);
            var k = Math.min(A4.w / img.width, A4.h / img.height);
            var w = img.width * k, h = img.height * k;
            page.drawImage(img, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
          } else {
            var pw = A4.w;
            var ph = Math.min(14400, A4.w * (img.height / img.width));
            var page2 = doc.addPage([pw, ph]);
            var k2 = Math.min(pw / img.width, ph / img.height);
            var w2 = img.width * k2, h2 = img.height * k2;
            page2.drawImage(img, { x: (pw - w2) / 2, y: (ph - h2) / 2, width: w2, height: h2 });
          }
        }

        var bytes = await doc.save();
        var blob = new Blob([bytes], { type: 'application/pdf' });
        var name = (U.baseName(ip.items[0].file.name) || 'images') + '-' + ip.items.length + 'p.pdf';
        U.download(blob, name);
        U.toast('PDF를 저장했어요 · ' + U.bytes(blob.size));
      } catch (e) {
        console.error(e);
        U.toast(e.message || 'PDF를 만들지 못했어요', 'err');
      }
      U.busy(btn, false);
    }

    /* preload nothing — libraries are fetched on first use */
  }

  window.Labs.register('pdf', { mount: mount });
})();
