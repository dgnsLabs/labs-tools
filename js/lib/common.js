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
  var toastTimer;
  function toast(msg, kind, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (kind === 'err' ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, ms || 2600);
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

  // One-tap save that uses the Android share sheet when available.
  function saveOrShare(blob, filename, title) {
    if (canShareFiles()) {
      return shareBlob(blob, filename, title).then(function (shared) {
        if (!shared) { download(blob, filename); toast('저장했어요'); }
      }).catch(function (e) {
        if (e && e.name === 'AbortError') return; // user dismissed the sheet
        download(blob, filename);
      });
    }
    download(blob, filename);
    toast('저장했어요');
    return Promise.resolve();
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
    inputEl.addEventListener('change', function () {
      var files = Array.prototype.slice.call(inputEl.files || []);
      if (files.length) onFiles(files);
      inputEl.value = '';
    });
    dropEl.addEventListener('click', function (e) {
      if (e.target.closest('input,button,a')) return;
      inputEl.click();
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropEl.addEventListener(ev, function (e) {
        e.preventDefault();
        dropEl.classList.remove('is-over');
      });
    });
    dropEl.addEventListener('drop', function (e) {
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (files.length) onFiles(files);
    });
    if (label && opts.label) label.textContent = opts.label;
  }

  function pickFiles(inputEl) { inputEl.click(); }

  /* ---------------- text ---------------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; });
    }
    return new Promise(function (resolve, reject) {
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

  /* ---------------- registry ---------------- */
  function register(id, def) { Labs.tools[id] = def; }
  function getTool(id) { return Labs.tools[id]; }

  Labs.util = {
    BASE: BASE,
    $: $, $$: $$, esc: esc, el: el, bytes: bytes, clamp: clamp, uid: uid,
    debounce: debounce, stamp: stamp, baseName: baseName, extFor: extFor,
    toast: toast, busy: busy, loadScript: loadScript, ensureLib: ensureLib, vendor: vendor,
    download: download, shareBlob: shareBlob, saveOrShare: saveOrShare, canShareFiles: canShareFiles,
    canvasToBlob: canvasToBlob, fileToBitmap: fileToBitmap, readFile: readFile,
    zipBlobs: zipBlobs, dropzone: dropzone, pickFiles: pickFiles, copyText: copyText
  };
  Labs.register = register;
  Labs.getTool = getTool;
})();
