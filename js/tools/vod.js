/* ============================================================
   VOD 규격 변환 — MP4 / H.264 / 1280×720 / AAC
   1) WebCodecs(기기 가속) 로 먼저 변환을 시도한다.
   2) 지원되지 않거나 오디오·코덱 처리에 실패하면 ffmpeg.wasm 으로
      자동 폴백한다. 두 경로의 결과 규격은 같다.
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var TARGET_MB = 400;      // 업로드 최대 용량
  var LARGE_MB = 150;       // 폰에서 오래 걸리기 시작하는 용량
  var MAX_ACCEL_BYTES = 120 * 1024 * 1024; // 이보다 크면 가속 경로 대신 기본 방식
  var MAX_ACCEL_SECONDS = 600;             // 이보다 길면 소리를 통째로 풀지 않는다
  var OUT_W = 1280;
  var OUT_H = 720;
  var OUT_FPS = 30;
  var OUT_BITRATE = 5000000;
  var AVC_CODEC = 'avc1.42001f'; // H.264 Baseline (720p)
  var AUDIO_RATE = 44100;
  var AUDIO_BITS = 128000;

  var VF = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';

  /* ---------------- 안내 문구 ---------------- */

  // 용량이 큰 파일에 대한 안내 (터미널 명령 대신 사람의 말로)
  function largeNotice(size) {
    if (size > TARGET_MB * 1024 * 1024) {
      return '400MB가 넘는 영상이에요. 변환은 가능하지만 실패할 수 있으니, 짧게 나눠서 올려 주세요.';
    }
    if (size > LARGE_MB * 1024 * 1024) {
      return '용량이 커서 폰에서는 오래 걸릴 수 있어요. PC 브라우저에서 같은 주소를 열어 변환하시면 훨씬 빠릅니다.';
    }
    return '';
  }

  /* ---------------- 컨테이너 살펴보기 ---------------- */

  function readSlice(file, start, len) {
    return U.readFile(file.slice(start, start + len));
  }

  function indexOfAscii(bytes, word, from, to) {
    var first = word.charCodeAt(0);
    var end = to - word.length;
    for (var i = from; i <= end; i++) {
      if (bytes[i] !== first) continue;
      var k = 1;
      for (; k < word.length; k++) if (bytes[i + k] !== word.charCodeAt(k)) break;
      if (k === word.length) return i;
    }
    return -1;
  }

  // MP4/MOV 박스를 훑어 moov 안에 소리 트랙('soun')이 있는지 본다.
  // 이 조각에서 moov를 못 찾으면 null.
  function moovHasSound(bytes) {
    if (!bytes || bytes.length < 16) return null;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pos = 0;
    while (pos + 8 <= bytes.length) {
      var size = view.getUint32(pos);
      var type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      var head = 8;
      if (size === 1) {
        if (pos + 16 > bytes.length) return null;
        size = Number(view.getBigUint64(pos + 8));
        head = 16;
      } else if (size === 0) {
        size = bytes.length - pos;
      }
      if (size < head) return null;
      if (type === 'moov') {
        var end = Math.min(bytes.length, pos + size);
        return indexOfAscii(bytes, 'soun', pos, end) >= 0;
      }
      pos += size;
    }
    return null;
  }

  async function detectAudio(file) {
    var name = file.name || '';
    if (!/\.(mp4|m4v|mov)$/i.test(name)) return null; // 알 수 없음 → 폴백 쪽이 안전
    var span = 6 * 1024 * 1024;
    var head = new Uint8Array(await readSlice(file, 0, Math.min(file.size, span)));
    var hit = moovHasSound(head);
    if (hit !== null) return hit;
    if (file.size > span) {
      var tail = new Uint8Array(await readSlice(file, file.size - span, span));
      hit = moovHasSound(tail);
      if (hit !== null) return hit;
      return indexOfAscii(tail, 'soun', 0, tail.length) >= 0;
    }
    return null;
  }

  /* ---------------- WebCodecs 경로 ---------------- */

  var muxerModule = null;
  async function loadMuxer() {
    if (muxerModule) return muxerModule;
    // ESM 번들을 그대로 로컬에서 불러온다 (서비스 워커가 캐시).
    muxerModule = await import(U.vendor('vendor/mp4-muxer.mjs'));
    return muxerModule;
  }

  function waitEvent(el, ok, fail, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(err) {
        if (done) return;
        done = true;
        el.removeEventListener(ok, good);
        el.removeEventListener(fail, bad);
        clearTimeout(timer);
        err ? reject(err) : resolve();
      }
      function good() { finish(null); }
      function bad() { finish(new Error('영상을 열지 못했습니다.')); }
      var timer = setTimeout(function () { finish(new Error('영상을 여는 데 시간이 너무 오래 걸립니다.')); }, ms || 20000);
      el.addEventListener(ok, good);
      el.addEventListener(fail, bad);
    });
  }

  function seekTo(video, t) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(err) {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', good);
        clearTimeout(timer);
        err ? reject(err) : resolve();
      }
      function good() { finish(null); }
      var timer = setTimeout(function () { finish(new Error('영상 위치를 옮기지 못했습니다.')); }, 8000);
      video.addEventListener('seeked', good);
      try { video.currentTime = t; } catch (e) { finish(e); }
    });
  }

  function drawFrame(ctx, video) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    var sw = video.videoWidth || OUT_W;
    var sh = video.videoHeight || OUT_H;
    var scale = Math.min(OUT_W / sw, OUT_H / sh);
    var dw = Math.round(sw * scale);
    var dh = Math.round(sh * scale);
    ctx.drawImage(video, Math.round((OUT_W - dw) / 2), Math.round((OUT_H - dh) / 2), dw, dh);
  }

  function idle() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // 원본 소리를 44.1kHz 스테레오 PCM으로 만든다.
  async function decodeAudio(bytes) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      var ctx = new Ctx();
      try { await ctx.resume(); } catch (e) { /* 사용자 조작 전에는 막힐 수 있음 */ }
      var buf = await ctx.decodeAudioData(bytes.slice().buffer);
      try { ctx.close(); } catch (e) { /* ignore */ }
      return buf;
    }
    var off = new OfflineAudioContext(2, 1, AUDIO_RATE);
    return off.decodeAudioData(bytes.slice().buffer);
  }

  async function toStereo44100(buf) {
    if (buf.sampleRate === AUDIO_RATE && buf.numberOfChannels === 2) return buf;
    var frames = Math.max(1, Math.ceil(buf.duration * AUDIO_RATE));
    var off = new OfflineAudioContext(2, frames, AUDIO_RATE);
    var src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    return off.startRendering();
  }

  // WebCodecs 로 변환할 수 있는지 먼저 확인한다 (무거운 작업 전에).
  async function checkWebCodecs(file) {
    if (!window.isSecureContext) return { ok: false, reason: '보안 연결 아님' };
    if (typeof window.VideoEncoder !== 'function') return { ok: false, reason: '브라우저 미지원' };
    if (!/\.(mp4|m4v|mov)$/i.test(file.name || '')) return { ok: false, reason: '다른 형식' };
    if (file.size > MAX_ACCEL_BYTES) return { ok: false, reason: '용량 큼' };

    var cfg = {
      codec: AVC_CODEC, width: OUT_W, height: OUT_H,
      bitrate: OUT_BITRATE, framerate: OUT_FPS,
      avc: { format: 'avc' }, latencyMode: 'quality'
    };
    var support = await window.VideoEncoder.isConfigSupported(cfg).catch(function () { return null; });
    if (!support || !support.supported) return { ok: false, reason: '영상 코덱 미지원' };

    // 소리가 있는 파일이면(또는 확인이 안 되면) AAC로 다시 담을 수 있어야 한다.
    var hasAudio = (await detectAudio(file)) !== false;
    var audioConfig = null;
    if (hasAudio) {
      audioConfig = { codec: 'mp4a.40.2', sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: AUDIO_BITS };
      var aok = typeof window.AudioEncoder === 'function'
        ? await window.AudioEncoder.isConfigSupported(audioConfig).catch(function () { return null; })
        : null;
      if (!aok || !aok.supported) return { ok: false, reason: '오디오 인코더 미지원' };
    }
    return { ok: true, hasAudio: hasAudio, audioConfig: audioConfig };
  }

  async function transcodeWebCodecs(file, plan, hooks) {
    var mod = await loadMuxer();
    var muxer = new mod.Muxer({
      target: new mod.ArrayBufferTarget(),
      video: { codec: 'avc', width: OUT_W, height: OUT_H, frameRate: OUT_FPS },
      audio: plan.hasAudio ? { codec: 'aac', numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined,
      fastStart: 'in-memory'
    });

    var failure = null;
    var config = null;
    var audioChunks = 0;

    // --- 영상 열기 (길이 확인) ---
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.style.cssText = 'position:fixed;left:-4px;top:0;width:2px;height:2px;opacity:.01;pointer-events:none';
    var src = URL.createObjectURL(file);
    video.src = src;
    document.body.appendChild(video);

    try {
      await waitEvent(video, 'loadedmetadata', 'error', 30000);
      if (!video.videoWidth) throw new Error('영상 정보를 읽지 못했습니다.');
      var duration = video.duration;
      if (!isFinite(duration) || duration <= 0) throw new Error('영상 길이를 알 수 없습니다.');
      // 긴 영상은 소리를 통째로 풀면 메모리를 너무 많이 쓴다 → 기본 방식으로.
      if (duration > MAX_ACCEL_SECONDS) throw new Error('긴 영상');

      // --- 소리 ---
      if (plan.hasAudio) {
        hooks.stage('소리 준비 중…', 0.02);
        var bytes = new Uint8Array(await U.readFile(file));
        var decoded = null;
        try {
          decoded = await decodeAudio(bytes);
        } catch (e) {
          throw new Error('소리 읽기 실패');
        }
        bytes = null;
        if (!decoded || !decoded.length) throw new Error('소리 읽기 실패');

        var pcm = await toStereo44100(decoded);
        decoded = null;
        var aenc = new window.AudioEncoder({
          output: function (chunk, meta) {
            audioChunks++;
            muxer.addAudioChunk(chunk, meta && meta.decoderConfig ? { decoderConfig: cloneAudioConfig(meta.decoderConfig) } : undefined);
          },
          error: function (e) { failure = e; }
        });
        aenc.configure(plan.audioConfig);
        var frames = pcm.length;
        var step = AUDIO_RATE; // 1초 단위
        for (var off = 0; off < frames; off += step) {
          if (!hooks.alive()) throw new Error('aborted');
          var n = Math.min(step, frames - off);
          var planar = new Float32Array(n * 2);
          planar.set(pcm.getChannelData(0).subarray(off, off + n), 0);
          planar.set(pcm.getChannelData(1).subarray(off, off + n), n);
          var data = new window.AudioData({
            format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: n,
            numberOfChannels: 2, timestamp: Math.round(off / AUDIO_RATE * 1e6), data: planar
          });
          aenc.encode(data);
          data.close();
          hooks.stage('소리 변환 중…', 0.02 + 0.08 * (off / frames));
        }
        await aenc.flush();
        aenc.close();
        pcm = null;
        if (failure) throw failure;
        if (!audioChunks) throw new Error('소리 변환 결과가 비어 있습니다.');
      }

      var enc = new window.VideoEncoder({
        output: function (chunk, meta) {
          if (meta && meta.decoderConfig && !config) config = cloneVideoConfig(meta.decoderConfig);
          muxer.addVideoChunk(chunk, config ? { decoderConfig: config } : undefined);
        },
        error: function (e) { failure = e; }
      });
      enc.configure({
        codec: AVC_CODEC, width: OUT_W, height: OUT_H,
        bitrate: OUT_BITRATE, framerate: OUT_FPS,
        avc: { format: 'avc' }, latencyMode: 'quality'
      });

      var canvas = document.createElement('canvas');
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      var ctx = canvas.getContext('2d', { alpha: false });

      var total = Math.max(1, Math.round(duration * OUT_FPS));
      var keyEvery = OUT_FPS * 2;
      for (var i = 0; i < total; i++) {
        if (!hooks.alive()) throw new Error('aborted');
        if (failure) throw failure;
        var t = Math.min(duration - 0.001, (i + 0.5) / OUT_FPS);
        await seekTo(video, t);
        drawFrame(ctx, video);
        var frame = new window.VideoFrame(canvas, {
          // 타임스탬프는 0부터 고정 간격으로. (탐색 위치는 반 프레임 뒤에서 읽는다)
          timestamp: Math.round(i * 1e6 / OUT_FPS),
          duration: Math.round(1e6 / OUT_FPS)
        });
        enc.encode(frame, { keyFrame: i % keyEvery === 0 });
        frame.close();
        hooks.stage('영상 변환 중…', 0.1 + 0.88 * ((i + 1) / total));
        while (enc.encodeQueueSize > 6) await idle();
      }

      await enc.flush();
      enc.close();
      if (failure) throw failure;
      if (!config) throw new Error('영상 인코더가 준비되지 않았습니다.');
    } finally {
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* ignore */ }
      video.remove();
      URL.revokeObjectURL(src);
    }

    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  function cloneVideoConfig(cfg) {
    var out = { codec: cfg.codec, codedWidth: cfg.codedWidth, codedHeight: cfg.codedHeight };
    if (cfg.description) out.description = new Uint8Array(cfg.description).slice();
    if (cfg.colorSpace) {
      out.colorSpace = {
        primaries: cfg.colorSpace.primaries,
        transfer: cfg.colorSpace.transfer,
        matrix: cfg.colorSpace.matrix,
        fullRange: cfg.colorSpace.fullRange
      };
    }
    return out;
  }

  function cloneAudioConfig(cfg) {
    var out = { codec: cfg.codec, sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels };
    if (cfg.description) out.description = new Uint8Array(cfg.description).slice();
    return out;
  }

  /* ---------------- ffmpeg.wasm 경로 (폴백) ---------------- */

  function ffmpegArgs(inputName) {
    return [
      '-i', inputName,
      '-vf', VF,
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // 폰 브라우저(WASM)에서 가장 빠른 프리셋
      '-profile:v', 'baseline',
      '-level:v', '3.1',
      '-pix_fmt', 'yuv420p',
      '-b:v', '5000k', '-maxrate', '5000k', '-bufsize', '10000k',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart',
      '-threads', '1',
      '-y', 'output.mp4'
    ];
  }

  async function transcodeFFmpeg(file, hooks, state) {
    var FFmpegWASM = await U.ensureLib('ffmpeg');
    var ff = new FFmpegWASM.FFmpeg();
    state.ffmpeg = ff;
    ff.on('progress', function (e) {
      if (e && isFinite(e.progress)) hooks.stage('영상 변환 중…', 0.1 + 0.85 * U.clamp(e.progress, 0, 1));
    });
    hooks.stage('변환 도구 준비 중… (처음 한 번만)', 0.03);
    await ff.load({
      coreURL: U.vendor('vendor/ffmpeg/ffmpeg-core.js'),
      wasmURL: U.vendor('vendor/ffmpeg/ffmpeg-core.wasm')
    });
    if (!hooks.alive()) throw new Error('aborted');

    var ext = (/\.[a-z0-9]+$/i.exec(file.name || '') || ['.mp4'])[0].toLowerCase();
    var inName = 'input' + ext;
    hooks.stage('영상 올리는 중…', 0.06);
    await ff.writeFile(inName, new Uint8Array(await U.readFile(file)));
    if (!hooks.alive()) throw new Error('aborted');

    hooks.stage('영상 변환 중…', 0.1);
    var code = await ff.exec(ffmpegArgs(inName));
    if (!hooks.alive()) throw new Error('aborted');
    if (code !== 0) throw new Error('영상 형식을 읽지 못했습니다 (code ' + code + ')');

    hooks.stage('마무리 중…', 0.97);
    var data = await ff.readFile('output.mp4');
    try { await ff.deleteFile(inName); await ff.deleteFile('output.mp4'); } catch (e) { /* ignore */ }
    return new Blob([data], { type: 'video/mp4' });
  }

  /* ---------------- 화면 ---------------- */

  function mount(root) {
    root.innerHTML =

      '<div class="panel tight">' +
      '<p class="vod-lead">업로드 규격(HD 720p MP4 · 400MB 이하)에 맞춰 자동으로 변환해 드려요.</p>' +
      '<div class="chips" style="margin-top:9px">' +
      '<span class="chip">HD 720p</span><span class="chip">MP4</span><span class="chip">400MB 이하</span>' +
      '</div>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="drop" id="vod-drop">' +
      '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.6"/><path d="m10 9 5 3-5 3z"/></svg>' +
      '<b>영상 선택</b><span>MP4 / MOV / WebM · 짧은 영상일수록 빨라요</span>' +
      '<input type="file" id="vod-file" accept="video/*" hidden>' +
      '</div>' +
      '<div class="row" style="margin-top:8px"><span class="chip" id="vod-info">아직 선택 없음</span>' +
      '<span class="grow"></span><button class="btn sm ghost" type="button" id="vod-change">다른 영상</button></div>' +
      '<div id="vod-warn"></div>' +
      '</div>' +

      '<div class="panel" id="vod-runner" hidden>' +
      '<div class="panel-head"><h2>변환</h2><span class="aside" id="vod-state">대기</span></div>' +
      '<div class="row">' +
      '<button class="btn primary grow" type="button" id="vod-go">변환 시작</button>' +
      '<button class="btn danger" type="button" id="vod-stop" disabled>중단</button>' +
      '</div>' +
      '<div class="progress-wrap"><div class="bar"><i id="vod-bar"></i></div>' +
      '<div class="bar-row"><span id="vod-label">대기 중</span><span id="vod-pct"></span></div></div>' +
      '<p class="hint" id="vod-note" hidden></p>' +
      '</div>' +

      '<div id="vod-result"></div>';

    var input = $('#vod-file', root);
    var drop = $('#vod-drop', root);
    var infoEl = $('#vod-info', root);
    var warnEl = $('#vod-warn', root);
    var runner = $('#vod-runner', root);
    var goBtn = $('#vod-go', root);
    var stopBtn = $('#vod-stop', root);
    var stateEl = $('#vod-state', root);
    var barEl = $('#vod-bar', root);
    var labelEl = $('#vod-label', root);
    var pctEl = $('#vod-pct', root);
    var noteEl = $('#vod-note', root);
    var resultEl = $('#vod-result', root);

    var state = { file: null, ffmpeg: null, running: false, alive: false, meta: null };

    function setProgress(p) {
      var v = isFinite(p) ? U.clamp(p, 0, 1) : 0;
      barEl.style.width = Math.round(v * 100) + '%';
      pctEl.textContent = Math.round(v * 100) + '%';
    }

    function stage(text, p) {
      if (text) labelEl.textContent = text;
      if (p != null) setProgress(p);
    }

    U.dropzone(drop, input, function (files) {
      var f = files.filter(function (x) {
        return /^video\//.test(x.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(x.name);
      })[0];
      if (!f) { U.toast('영상 파일을 선택해 주세요', 'err'); return; }
      select(f);
    });
    $('#vod-change', root).addEventListener('click', function () { input.click(); });

    function select(file) {
      state.file = file;
      resultEl.innerHTML = '';
      runner.hidden = false;
      goBtn.disabled = false;
      goBtn.textContent = '변환 시작';
      stopBtn.disabled = true;
      stateEl.textContent = '대기';
      stage('대기 중', 0);
      pctEl.textContent = '';
      noteEl.hidden = true;
      delete root.dataset.engine;

      infoEl.textContent = (file.name || '영상') + ' · ' + U.bytes(file.size);
      renderNotice(file);

      try {
        var v = document.createElement('video');
        v.preload = 'metadata';
        var url = URL.createObjectURL(file);
        v.onloadedmetadata = function () {
          state.meta = { duration: v.duration || 0, w: v.videoWidth, h: v.videoHeight };
          var dur = state.meta.duration;
          var mm = Math.floor(dur / 60);
          var ss = Math.round(dur % 60);
          infoEl.textContent = (file.name || '영상') + ' · ' + U.bytes(file.size) +
            ' · ' + mm + ':' + String(ss).padStart(2, '0');
          URL.revokeObjectURL(url);
        };
        v.onerror = function () { URL.revokeObjectURL(url); };
        v.src = url;
      } catch (e) { /* 안내용 정보라 없어도 된다 */ }
    }

    // 용량이 크면 터미널 명령 대신 사람의 말로 안내한다.
    function renderNotice(file) {
      var text = largeNotice(file.size);
      if (!text) { warnEl.innerHTML = ''; return; }
      warnEl.innerHTML =
        '<div class="notice" style="margin-top:10px">' +
        '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>' +
        '<div><p style="margin:0">' + U.esc(text) + '</p>' +
        '<button class="btn sm ghost" type="button" id="vod-copy-link" style="margin-top:8px">PC에서 열 주소 복사</button>' +
        '</div></div>';
      var btn = $('#vod-copy-link', warnEl);
      if (btn) {
        btn.addEventListener('click', function () {
          U.copyText(location.origin + location.pathname).then(function () {
            U.toast('주소를 복사했어요. PC 브라우저에 붙여넣어 주세요');
          }).catch(function () { U.toast('복사 권한이 없어요', 'err'); });
        });
      }
    }

    function showResult(blob) {
      var url = URL.createObjectURL(blob);
      var name = (U.baseName(state.file.name) || 'video') + '-vod.mp4';
      var over = blob.size > TARGET_MB * 1024 * 1024;

      resultEl.innerHTML =
        '<div class="panel">' +
        '<div class="panel-head"><h2>변환 결과</h2><span class="aside">' + U.bytes(blob.size) + '</span></div>' +
        '<p class="vod-verdict' + (over ? ' bad' : '') + '">' +
        '<span class="vod-check" aria-hidden="true">' + (over ? '!' : '✓') + '</span>' +
        (over ? '용량이 400MB를 넘었어요' : '업로드 규격 통과') +
        '</p>' +
        '<div class="chips" style="margin-top:8px">' +
        '<span class="chip ' + (over ? 'bad' : 'ok') + '">' + (over ? '400MB 초과' : '용량 ' + U.bytes(blob.size) + ' · 400MB 이하') + '</span>' +
        '<span class="chip">HD 720p</span><span class="chip">MP4</span>' +
        '</div>' +
        '<video src="' + url + '" controls playsinline preload="metadata" style="width:100%;border-radius:6px;background:#000;display:block;margin-top:12px"></video>' +
        (over ? '<p class="hint">영상을 짧게 나눠서 다시 변환해 주세요.</p>' : '') +
        '</div>' +
        '<div class="sticky-actions">' +
        '<button class="btn primary" type="button" id="vod-save">MP4 저장</button>' +
        '<button class="btn" type="button" id="vod-share">공유</button>' +
        '</div>';

      $('#vod-save', resultEl).addEventListener('click', function () {
        U.saveOrShare(blob, name, 'VOD 규격 MP4');
      });
      $('#vod-share', resultEl).addEventListener('click', function () {
        U.shareBlob(blob, name, 'VOD 규격 MP4').then(function (ok) {
          if (!ok) { U.download(blob, name); U.toast('저장했어요'); }
        }).catch(function (e) {
          if (e && e.name === 'AbortError') return;
          U.download(blob, name);
        });
      });
    }

    async function convert() {
      if (!state.file || state.running) return;
      state.running = true;
      state.alive = true;
      resultEl.innerHTML = '';
      goBtn.disabled = true;
      stopBtn.disabled = false;
      stateEl.textContent = '변환 중';
      noteEl.hidden = true;
      setProgress(0);

      var started = Date.now();
      var hooks = {
        alive: function () { return state.alive; },
        stage: stage
      };

      var engine = 'ffmpeg';
      var reason = '';
      try {
        // 1) 기기 가속(WebCodecs) 먼저 시도
        var plan = await checkWebCodecs(state.file, hooks);
        var blob = null;
        if (plan.ok) {
          try {
            blob = await transcodeWebCodecs(state.file, plan, hooks);
            engine = 'webcodecs';
          } catch (e) {
            if (e && e.message === 'aborted') throw e;
            reason = (e && e.message) || String(e);
            console.warn('[vod] 가속 변환 실패 → 기본 방식으로', e);
          }
        } else {
          reason = plan.reason || '미지원';
        }

        // 2) 안 되면 ffmpeg.wasm 으로 자동 폴백
        if (!blob) {
          if (!state.alive) throw new Error('aborted');
          blob = await transcodeFFmpeg(state.file, hooks, state);
        }

        state.running = false;
        state.alive = false;
        root.dataset.engine = engine;
        window.__labsVod = { path: engine, reason: reason, ms: Date.now() - started, size: blob.size };

        var secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        setProgress(1);
        stateEl.textContent = '완료';
        labelEl.textContent = '변환 완료 · ' + U.bytes(blob.size) + ' · ' + secs + '초';
        pctEl.textContent = '100%';
        showResult(blob);
        goBtn.textContent = '다시 변환';
        U.toast('변환했어요 · ' + U.bytes(blob.size), null, 3000);
      } catch (e) {
        if (e && e.message === 'aborted') {
          stateEl.textContent = '중단됨';
          labelEl.textContent = '중단했습니다. 다시 시작하려면 “변환 시작”을 눌러 주세요.';
        } else {
          console.error(e);
          stateEl.textContent = '실패';
          labelEl.textContent = '변환하지 못했어요.';
          noteEl.hidden = false;
          noteEl.textContent = '영상이 너무 길거나 용량이 크면 실패할 수 있어요. 짧게 나눠서 다시 시도해 주세요.';
          U.toast('변환하지 못했어요', 'err', 3800);
        }
      } finally {
        state.running = false;
        state.alive = false;
        goBtn.disabled = false;
        stopBtn.disabled = true;
        if (state.ffmpeg) {
          try { state.ffmpeg.terminate(); } catch (e) { /* ignore */ }
          state.ffmpeg = null;
        }
      }
    }

    goBtn.addEventListener('click', convert);

    stopBtn.addEventListener('click', function () {
      if (!state.running) return;
      state.alive = false;
      if (state.ffmpeg) {
        try { state.ffmpeg.terminate(); } catch (e) { /* ignore */ }
        state.ffmpeg = null;
      }
    });
  }

  window.Labs.register('vod', { mount: mount, largeNotice: largeNotice });
})();
