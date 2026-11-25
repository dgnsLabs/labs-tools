/* ============================================================
   Labs Tools — shared helpers
   Everything runs inside the browser; no network requests except
   same-origin static assets.
   ============================================================ */
(function () {
  'use strict';

  var Labs = (window.Labs = window.Labs || {});
  Labs.tools = Labs.tools || {};
  Labs.meta = Labs.meta || [];

  // Resolved against the document path so the app works at
  // https://dgnslabs.github.io/labs-tools/ (sub-path) as well.
  var BASE = new URL('./', location.origin + location.pathname);

  function vendor(path) { return new URL(path, BASE).href; }

  /* ---------------- small helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Build an element from an HTML string (first element only).
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  function bytes(n) {
    if (n == null || isNaN(n)) return '-';
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB'];
    var v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + units[i];
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function uid() { return Math.random().toString(36).slice(2, 9); }

  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function baseName(name) {
    return String(name || 'file').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'file';
  }

  function extFor(mime) {
    if (/jpe?g/.test(mime)) return 'jpg';
    if (/png/.test(mime)) return 'png';
    if (/webp/.test(mime)) return 'webp';
    if (/pdf/.test(mime)) return 'pdf';
    if (/svg/.test(mime)) return 'svg';
    if (/mp4/.test(mime)) return 'mp4';
    if (/zip/.test(mime)) return 'zip';
    return 'bin';
  }

  /* ---------------- toast ---------------- */
  // Stacked toasts: at most three, each with a drawn icon, a thin lifetime
  // bar, a close button and a sideways swipe to dismiss. The old
  // toast(msg, kind, ms) call keeps working unchanged.
  var TOAST_MAX = 3;
  var TOAST_ICON = {
    ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="m6 12.6 4.2 4.2L18 7.7"/></svg>',
    err: '<svg viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M12 4.6 20.8 19.6H3.2z"/><path pathLength="1" d="M12 9.8v4.4M12 16.8h.01"/></svg>'
  };

  function toast(msg, kind, ms) {
    var stack = document.getElementById('toast');
    if (!stack) return;
    var life = Math.max(700, ms || 2600);
    var isErr = kind === 'err';

    var item = el(
      '<div class="toast' + (isErr ? ' err' : '') + '">' +
      '<span class="toast-ico" aria-hidden="true">' + (isErr ? TOAST_ICON.err : TOAST_ICON.ok) + '</span>' +
      '<span class="toast-msg"></span>' +
      '<button class="toast-x" type="button" aria-label="알림 닫기">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4"/></svg>' +
      '</button>' +
      '<i class="toast-life" aria-hidden="true" style="animation-duration:' + life + 'ms"></i>' +
      '</div>'
    );
    item.querySelector('.toast-msg').textContent = msg;

    var list = stack.__toasts || (stack.__toasts = []);

    function close(dir) {
      if (item.__gone) return;
      item.__gone = true;
      clearTimeout(item.__timer);
      var i = list.indexOf(item);
      if (i >= 0) list.splice(i, 1);
      item.style.pointerEvents = 'none';
      item.classList.remove('is-dragging');
      item.classList.add('is-out');
      item.style.opacity = '0';
      if (dir) {
        item.style.setProperty('--dx', (dir * 130) + 'px');
        item.style.setProperty('--sc', '.94');
      } else {
        item.style.setProperty('--dy', '12px');
        item.style.setProperty('--sc', '.95');
      }
      setTimeout(function () { item.remove(); }, 240);
    }
    item.__close = close;
    item.querySelector('.toast-x').addEventListener('click', function () { close(0); });

    // Sideways swipe: follow the finger, then fly out or settle back.
    var drag = { on: false, x: 0, dx: 0 };
    item.addEventListener('pointerdown', function (e) {
      if (item.__gone) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('button')) return;
      drag.on = true; drag.x = e.clientX; drag.dx = 0;
      item.classList.add('is-dragging');
      try { item.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    });
    item.addEventListener('pointermove', function (e) {
      if (!drag.on || item.__gone) return;
      drag.dx = e.clientX - drag.x;
      item.style.setProperty('--dx', drag.dx.toFixed(1) + 'px');
      item.style.opacity = String(Math.max(.25, 1 - Math.abs(drag.dx) / 260));
    });
    function endDrag() {
      if (!drag.on) return;
      drag.on = false;
      item.classList.remove('is-dragging');
      if (Math.abs(drag.dx) > 64) {
        close(drag.dx > 0 ? 1 : -1);
        return;
      }
      drag.dx = 0;
      item.style.opacity = '1';
      item.style.setProperty('--dx', '0px');
    }
    item.addEventListener('pointerup', endDrag);
    item.addEventListener('pointercancel', endDrag);

    while (list.length >= TOAST_MAX) {
      var oldest = list.shift();
      if (oldest) {
        oldest.__gone = true;
        clearTimeout(oldest.__timer);
        oldest.remove();
      }
    }

    item.style.setProperty('--dy', '20px');
    item.style.setProperty('--sc', '.94');
    item.style.opacity = '0';
    stack.appendChild(item);
    list.push(item);
    void item.offsetWidth;
    item.style.setProperty('--dy', '0px');
    item.style.setProperty('--sc', '1');
    item.style.opacity = '1';

    item.__timer = setTimeout(function () { close(0); }, life);
  }

  /* ---------------- buttons ---------------- */
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.idleHtml) btn.dataset.idleHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>' + esc(label || '처리 중');
    } else {
      btn.disabled = false;
      if (btn.dataset.idleHtml) { btn.innerHTML = btn.dataset.idleHtml; delete btn.dataset.idleHtml; }
    }
  }

  /* ---------------- script loading ---------------- */
  var scriptCache = {};

  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('스크립트를 불러오지 못했습니다: ' + src)); };
      document.head.appendChild(s);
    });
    scriptCache[src].catch(function () { delete scriptCache[src]; });
    return scriptCache[src];
  }

  // Lazily loads a vendored library. All files are pre-cached by the
  // service worker, so this works offline too.
  function ensureLib(name) {
    if (name === 'pdfjs') {
      if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
      return loadScript(vendor('vendor/pdf.min.js')).then(function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = vendor('vendor/pdf.worker.min.js');
        return window.pdfjsLib;
      });
    }
    if (name === 'pdflib') {
      if (window.PDFLib) return Promise.resolve(window.PDFLib);
      return loadScript(vendor('vendor/pdf-lib.min.js')).then(function () { return window.PDFLib; });
    }
    if (name === 'jszip') {
      if (window.JSZip) return Promise.resolve(window.JSZip);
      return loadScript(vendor('vendor/jszip.min.js')).then(function () { return window.JSZip; });
    }
    if (name === 'qrcode') {
      if (window.qrcode) return Promise.resolve(window.qrcode);
      return loadScript(vendor('vendor/qrcode.min.js')).then(function () { return window.qrcode; });
    }
    if (name === 'ffmpeg') {
      if (window.FFmpegWASM) return Promise.resolve(window.FFmpegWASM);
      return loadScript(vendor('vendor/ffmpeg/ffmpeg.js')).then(function () { return window.FFmpegWASM; });
    }
    return Promise.reject(new Error('알 수 없는 라이브러리: ' + name));
  }

  /* ---------------- files ---------------- */
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b);
        else reject(new Error('이미지를 저장할 수 없습니다.'));
      }, type || 'image/png', quality == null ? 0.92 : quality);
    });
  }

  // Encodes a canvas synchronously. A save has to finish inside the click:
  // canvas.toBlob() is async, and on phones that can outlast the tap's user
  // activation, after which the browser silently drops the download.
  function canvasBlobSync(canvas, type, quality) {
    var mime = type || 'image/png';
    var url = canvas.toDataURL(mime, quality == null ? 0.92 : quality);
    var comma = url.indexOf(',');
    if (comma < 0) throw new Error('이미지를 저장할 수 없습니다.');
    var bin = atob(url.slice(comma + 1));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // Loads a File/Blob as an ImageBitmap (or <img> fallback), honouring
  // EXIF orientation so the pixels we draw are already upright.
  function fileToBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return createImageBitmap(file).catch(function () { return imgFallback(file); });
      });
    }
    return imgFallback(file);
  }

  function imgFallback(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('이미지를 읽을 수 없습니다.')); };
      img.src = url;
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('파일을 읽지 못했습니다.')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function canShareFiles() {
    return !!(navigator.canShare && navigator.share && window.File);
  }

  // Native share sheet on Android; false when unsupported.
  function shareBlob(blob, filename, title) {
    var file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: title || filename }).then(function () { return true; });
    }
    return Promise.resolve(false);
  }

  async function zipBlobs(entries, zipName) {
    var JSZip = await ensureLib('jszip');
    var zip = new JSZip();
    var used = Object.create(null);
    entries.forEach(function (e) {
      var name = e.name;
      if (used[name]) {
        var m = name.match(/^(.*?)(\.[^.]+)?$/);
        name = m[1] + '-' + (++used[e.name]) + (m[2] || '');
      } else { used[name] = 1; }
      zip.file(name, e.blob);
    });
    var blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    download(blob, zipName);
    return blob;
  }

  // Wires a dropzone element + hidden file input.
  function dropzone(dropEl, inputEl, onFiles, opts) {
    opts = opts || {};
    if (!dropEl || !inputEl) return;
    var label = dropEl.querySelector('b');
    var idleLabel = null;
    var landTimer = 0;

    // The short landing bounce when a file actually arrives.
    function land() {
      dropEl.classList.remove('is-dropped');
      void dropEl.offsetWidth;
      dropEl.classList.add('is-dropped');
      clearTimeout(landTimer);
      landTimer = setTimeout(function () { dropEl.classList.remove('is-dropped'); }, 520);
    }

    // Hovering with a file swaps the guidance line; leaving puts it back.
    function setOver(on) {
      dropEl.classList.toggle('is-over', on);
      if (!label) return;
      if (on) {
        if (idleLabel === null) idleLabel = label.textContent;
        if (idleLabel !== '놓으면 바로 열려요') label.textContent = '놓으면 바로 열려요';
      } else if (idleLabel !== null) {
        label.textContent = idleLabel;
        idleLabel = null;
      }
    }

    inputEl.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inputEl.files || []);
      if (files.length) { land(); onFiles(files); }
      inputEl.value = '';
    });
    dropEl.addEventListener('click', function (e) {
      if (e.target.closest('input,button,a')) return;
      inputEl.click();
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        setOver(true);
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        setOver(false);
      });
    });
    dropEl.addEventListener('drop', function (e) {
      var files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) { land(); onFiles(files); }
    });
    if (label && opts.label) label.textContent = opts.label;
  }

  function pickFiles(inputEl) { inputEl.click(); }

  /* ---------------- text ---------------- */
  var COPY_OK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path pathLength="1" d="m5.6 12.6 4.3 4.3L18.5 7.9"/></svg>';

  // Turns the pressed button into a check for a moment and lets a light sweep
  // run over the box it sits next to.
  function markCopied(btn) {
    if (!btn || !btn.classList) return;
    if (!btn.__idleHtml) btn.__idleHtml = btn.innerHTML;
    btn.classList.add('is-copied');
    btn.innerHTML = COPY_OK_ICON + '<span>복사됨</span>';
    clearTimeout(btn.__copyTimer);
    btn.__copyTimer = setTimeout(function () {
      btn.classList.remove('is-copied');
      if (btn.__idleHtml != null) btn.innerHTML = btn.__idleHtml;
    }, 1500);
    sweepNear(btn);
  }

  function sweepNear(btn) {
    var host = btn.closest('.item') || btn.closest('.panel') || btn.parentElement;
    if (!host) return;
    $$('.result, .code', host).forEach(function (box) {
      box.classList.remove('is-swept');
      void box.offsetWidth;
      box.classList.add('is-swept');
      clearTimeout(box.__sweepTimer);
      box.__sweepTimer = setTimeout(function () { box.classList.remove('is-swept'); }, 820);
    });
  }

  function copyText(text, btn) {
    var work;
    if (navigator.clipboard && window.isSecureContext) {
      work = navigator.clipboard.writeText(text).then(function () { return true; });
    } else {
      work = new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        ok ? resolve(true) : reject(new Error('복사할 수 없습니다.'));
      });
    }
    return work.then(function (ok) {
      if (btn) markCopied(btn);
      return ok;
    });
  }

  /* ---------------- range value bubble ---------------- */
  // Wraps every <input type="range"> so a value bubble can ride above the
  // handle while it is being dragged. The input itself keeps its id, value,
  // min/max/step, listeners and the .field label .val readout.
  var rangesBound = false;
  function enhanceRanges(scope) {
    var root = scope || document;
    $$('input[type="range"]', root).forEach(function (input) {
      if (input.__rangeBubble) return;
      var wrap = document.createElement('div');
      wrap.className = 'range-wrap';
      if (input.parentNode) input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      var bub = document.createElement('span');
      bub.className = 'range-bubble';
      bub.setAttribute('aria-hidden', 'true');
      var out = document.createElement('span');
      bub.appendChild(out);
      wrap.appendChild(bub);
      input.__rangeBubble = { wrap: wrap, bub: bub };

      var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var hideTimer = 0, tiltTimer = 0, lastValue = null, lastTime = 0;

      function num(v, fallback) { var n = parseFloat(v); return isNaN(n) ? fallback : n; }

      function currentText() {
        var field = input.closest('.field');
        var val = field ? field.querySelector('.val') : null;
        var text = val ? val.textContent.trim() : '';
        return text || input.value;
      }

      function place() {
        var min = num(input.min, 0);
        var max = num(input.max, 100);
        var v = num(input.value, min);
        var p = max > min ? (v - min) / (max - min) : 0;
        var w = wrap.clientWidth || input.getBoundingClientRect().width || 0;
        var thumb = 12;
        var x = thumb / 2 + p * Math.max(0, w - thumb);
        var bw = bub.offsetWidth || 0;
        if (w && bw) x = Math.min(Math.max(x, bw / 2), w - bw / 2);
        bub.style.left = x.toFixed(1) + 'px';
      }

      function setTilt(deg) {
        if (reduce) return;
        bub.style.setProperty('--tilt', Math.max(-16, Math.min(16, deg)).toFixed(1) + 'deg');
      }

      // The farther and faster the value moved, the more the bubble leans away.
      function beat() {
        var v = num(input.value, 0);
        var now = (window.performance && performance.now) ? performance.now() : Date.now();
        if (lastValue != null && !reduce) {
          var span = Math.max(1, num(input.max, 100) - num(input.min, 0));
          var width = Math.max(1, (wrap.clientWidth || 0) - 12);
          var dx = ((v - lastValue) / span) * width;
          var dt = Math.max(8, now - lastTime);
          setTilt(-(dx / dt) * 10);
        }
        lastValue = v;
        lastTime = now;
        clearTimeout(tiltTimer);
        tiltTimer = setTimeout(function () { setTilt(0); }, 110);
      }

      function show() {
        clearTimeout(hideTimer);
        out.textContent = currentText();
        place();
        wrap.classList.add('is-live');
      }

      function hideSoon(ms) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          wrap.classList.remove('is-live', 'is-drag');
          setTilt(0);
        }, ms == null ? 560 : ms);
      }

      input.addEventListener('pointerdown', function () {
        wrap.classList.add('is-drag');
        show();
      });
      input.addEventListener('touchstart', function () { show(); }, { passive: true });
      input.addEventListener('input', function () {
        show();
        beat();
        hideSoon(720);
      });
      input.addEventListener('change', function () {
        out.textContent = currentText();
        place();
        wrap.classList.remove('is-drag');
        hideSoon(560);
      });
      ['pointerup', 'pointercancel', 'touchend', 'blur'].forEach(function (ev) {
        input.addEventListener(ev, function () {
          wrap.classList.remove('is-drag');
          setTilt(0);
          hideSoon(560);
        });
      });
      input.addEventListener('keydown', function (e) {
        if (/^(Arrow|Page|Home|End)/.test(e.key)) show();
      });

      if (!rangesBound) {
        rangesBound = true;
        window.addEventListener('resize', function () {
          $$('.range-wrap', document).forEach(function (w) {
            var i = w.querySelector('input[type="range"]');
            if (i && i.__rangeBubble) {
              var b = i.__rangeBubble.bub;
              var min = num(i.min, 0), max = num(i.max, 100), v = num(i.value, min);
              var p = max > min ? (v - min) / (max - min) : 0;
              var width = w.clientWidth || 0;
              var x = 6 + p * Math.max(0, width - 12);
              var bw = b.offsetWidth || 0;
              if (width && bw) x = Math.min(Math.max(x, bw / 2), width - bw / 2);
              b.style.left = x.toFixed(1) + 'px';
            }
          });
        });
      }
    });
  }

  /* ---------------- registry ---------------- */
  function register(id, def) { Labs.tools[id] = def; }
  function getTool(id) { return Labs.tools[id]; }

  Labs.util = {
    BASE: BASE,
    $: $, $$: $$, esc: esc, el: el, bytes: bytes, clamp: clamp, uid: uid,
    debounce: debounce, stamp: stamp, baseName: baseName, extFor: extFor,
    toast: toast, busy: busy, loadScript: loadScript, ensureLib: ensureLib, vendor: vendor,
    download: download, shareBlob: shareBlob, canShareFiles: canShareFiles,
    canvasToBlob: canvasToBlob, canvasBlobSync: canvasBlobSync,
    fileToBitmap: fileToBitmap, readFile: readFile,
    zipBlobs: zipBlobs, dropzone: dropzone, pickFiles: pickFiles, copyText: copyText,
    enhanceRanges: enhanceRanges
  };
  Labs.register = register;
  Labs.getTool = getTool;
})();
