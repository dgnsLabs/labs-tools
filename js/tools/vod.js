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

  var TARGET_BYTES = 400 * 1000 * 1000; // 변환 결과의 최대 용량
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
    if (size > LARGE_MB * 1024 * 1024) {
      return '원본 용량이 커서 휴대폰에서는 변환이 오래 걸릴 수 있어요. 400MB 제한은 변환한 파일에 적용돼요. PC 브라우저에서 같은 주소를 열어 변환할 수도 있어요.';
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

  async function transcodeWebCodecs(file, plan, hooks, targetBytes) {
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
      var bitrate = videoBitrate(duration, targetBytes, plan.hasAudio);

      // --- 소리 ---
      if (plan.hasAudio) {
        hooks.stage('소리 준비 중…');
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
          hooks.stage('소리 변환 중…');
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
        bitrate: bitrate, framerate: OUT_FPS,
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
        hooks.stage('영상 변환 중…', i / total);
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

  function videoBitrate(duration, targetBytes, hasAudio) {
    var audioBitrate = targetBytes == null || hasAudio ? AUDIO_BITS : 0;
    var hasDuration = isFinite(duration) && duration > 0;
    var budget = hasDuration
      ? (targetBytes == null ? TARGET_BYTES : targetBytes) * 8 * 0.95 / duration - audioBitrate
      : OUT_BITRATE;
    // 컨테이너 오버헤드와 인코더의 편차를 위해 5%를 남긴다.
    if (targetBytes != null && (!hasDuration || budget < 1000)) {
      var error = new Error(hasDuration
        ? '영상 길이에 비해 목표 용량이 너무 작아요. 목표 용량을 높여 주세요.'
        : '영상 길이를 확인할 수 없어요. 자동 설정으로 변환해 주세요.');
      error.userMessage = error.message;
      throw error;
    }
    return Math.min(OUT_BITRATE, Math.max(1000, Math.floor(budget / 1000) * 1000));
  }

  async function probeInput(ff, inputPath, inspectLine) {
    var info = { duration: 0, hasAudio: false };
    function readInputInfo(event) {
      if (inspectLine) inspectLine(event.message);
      var match = /^\s*Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(event.message);
      if (match) info.duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      if (/^\s*Stream #0:\d+.*:\s*Audio:/.test(event.message)) info.hasAudio = true;
    }
    ff.on('log', readInputInfo);
    try {
      // 출력 없이 실행하면 입력 정보만 기록하고 종료한다.
      await ff.exec(['-i', inputPath]);
    } finally {
      ff.off('log', readInputInfo);
    }
    return info;
  }

  function ffmpegArgs(inputName, bitrate) {
    return [
      '-i', inputName,
      '-vf', VF,
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // 폰 브라우저(WASM)에서 가장 빠른 프리셋
      '-profile:v', 'baseline',
      '-level:v', '3.1',
      '-pix_fmt', 'yuv420p',
      '-b:v', String(bitrate), '-maxrate', String(bitrate), '-bufsize', String(bitrate * 2),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-movflags', '+faststart',
      '-threads', '1',
      '-y', 'output.mp4'
    ];
  }

  async function openFFmpegInput(file, hooks, state) {
    hooks.stage('변환 도구 준비 중…');
    state.failureHint = '변환 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
    var FFmpegWASM = await U.ensureLib('ffmpeg');
    if (!hooks.alive()) throw new Error('aborted');
    var ff = new FFmpegWASM.FFmpeg();
    state.ffmpeg = ff;
    await ff.load({
      coreURL: U.vendor('vendor/ffmpeg/ffmpeg-core.js'),
      wasmURL: U.vendor('vendor/ffmpeg/ffmpeg-core.wasm')
    });
    if (!hooks.alive()) throw new Error('aborted');

    var ext = (/\.[a-z0-9]+$/i.exec(file.name || '') || ['.mp4'])[0].toLowerCase();
    var inName = 'input' + ext;
    hooks.stage('원본 영상 읽는 중…');
    state.failureHint = '원본 영상에 접근하지 못했어요. 파일을 다시 선택해 주세요.';
    await ff.createDir('/source');
    if (!await ff.mount('WORKERFS', { blobs: [{ name: inName, data: file }] }, '/source')) {
      throw new Error('WORKERFS mount unavailable');
    }
    if (!hooks.alive()) throw new Error('aborted');

    return '/source/' + inName;
  }

  async function checkOriginal(file, targetBytes, hooks, state) {
    if (!/\.mp4$/i.test(file.name) || file.size > (targetBytes ?? TARGET_BYTES)) return false;
    await state.metadataReady;
    if (!hooks.alive()) throw new Error('aborted');
    if (!state.meta || state.meta.w !== OUT_W || state.meta.h !== OUT_H) return false;

    var streams = [];
    var brand = '';
    var bitrate = Infinity;
    var transformed = false;
    try {
      var path = await openFFmpegInput(file, hooks, state);
      hooks.stage('원본 업로드 규격 확인 중…');
      await probeInput(state.ffmpeg, path, function (line) {
        var match = /^\s*major_brand\s*:\s*(\S+)/.exec(line);
        if (match) brand = match[1];
        match = /^\s*Duration:.*bitrate:\s*(\d+) kb\/s/.exec(line);
        if (match) bitrate = Number(match[1]);
        if (/^\s*Stream #0:\d+/.test(line)) streams.push(line);
        if (/displaymatrix|^\s*rotate\s*:/i.test(line)) transformed = true;
      });
      if (!hooks.alive()) throw new Error('aborted');
    } catch (error) {
      if (!hooks.alive()) throw error;
      return false;
    } finally {
      closeFFmpeg(state);
    }
    // Use the total bitrate as a conservative upper bound on the video stream.
    if (transformed || bitrate >= OUT_BITRATE / 1000 ||
        !/^(isom|iso[2-9]|mp4[12]|avc1|M4V)$/.test(brand)) return false;
    var video = streams.filter(function (line) { return /:\s*Video:/.test(line); });
    var audio = streams.filter(function (line) { return /:\s*Audio:/.test(line); });
    return video.length === 1 && audio.length <= 1 &&
      streams.length === video.length + audio.length &&
      /Video: h264 \((?:Constrained )?Baseline\).*\(avc1 \/.*yuv420p[^,]*, 1280x720\b/.test(video[0]) &&
      !/\(attached pic\)/.test(video[0]) &&
      (!/\bSAR\b/.test(video[0]) || /\bSAR 1:1\b/.test(video[0])) &&
      audio.every(function (line) { return /Audio: aac \(LC\).*\(mp4a \/.*44100 Hz, (?:mono|stereo),/.test(line); });
  }

  function closeFFmpeg(state) {
    if (!state.ffmpeg) return;
    state.ffmpeg.terminate();
    state.ffmpeg = null;
  }

  async function transcodeFFmpeg(file, hooks, state, targetBytes) {
    var inputPath = await openFFmpegInput(file, hooks, state);
    var ff = state.ffmpeg;
    var duration = state.meta && state.meta.duration;
    var hasAudio = true;
    if (targetBytes != null) {
      hooks.stage('영상 정보 확인 중…');
      var info = await probeInput(ff, inputPath);
      if (!hooks.alive()) throw new Error('aborted');
      if (!isFinite(duration) || duration <= 0) duration = info.duration;
      hasAudio = info.hasAudio;
    }
    var bitrate = videoBitrate(duration, targetBytes, hasAudio);

    ff.on('progress', function (e) {
      if (e && isFinite(e.progress)) hooks.stage('영상 변환 중…', e.progress);
    });
    hooks.stage('영상 변환 중…');
    state.failureHint = '영상 변환을 마치지 못했어요. 파일이 재생되는지 확인하거나 PC 브라우저에서 다시 시도해 주세요.';
    var code = await ff.exec(ffmpegArgs(inputPath, bitrate));
    if (!hooks.alive()) throw new Error('aborted');
    if (code !== 0) throw new Error('영상 형식을 읽지 못했습니다 (code ' + code + ')');

    hooks.stage('MP4 파일 만드는 중…');
    state.failureHint = '변환한 파일을 꺼내지 못했어요. 다른 탭을 닫고 다시 시도해 주세요.';
    var data = await ff.readFile('output.mp4');
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
      '<div id="vod-drop">' +
      '<button class="drop vod-pick" id="vod-pick" type="button">' +
      '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.6"/><path d="m10 9 5 3-5 3z"/></svg>' +
      '<b>영상 선택</b><span>MP4 / MOV / WebM · 짧은 영상일수록 빨라요</span>' +
      '</button>' +
      '<input type="file" id="vod-file" accept="video/*" hidden>' +
      '<div class="row vod-source" id="vod-source" hidden><div class="grow">' +
      '<strong id="vod-name"></strong><p class="hint" id="vod-info"></p></div>' +
      '<button class="btn sm ghost" type="button" id="vod-change">영상 변경</button></div></div>' +
      '<div id="vod-warn"></div>' +
      '</div>' +

      '<div class="panel" id="vod-runner" hidden>' +
      '<div class="panel-head"><h2>변환</h2><span class="aside" id="vod-state">대기</span></div>' +
      '<details class="vod-settings" id="vod-settings">' +
      '<summary><span>변환 설정</span><span class="vod-setting-value" id="vod-setting-value">용량 · 자동</span></summary>' +
      '<div class="field"><label for="vod-size-mode">출력 용량</label>' +
      '<select id="vod-size-mode" aria-describedby="vod-setting-note">' +
      '<option value="auto">자동 (기본값)</option>' +
      '<option value="original">원본 크기를 목표로</option>' +
      '<option value="custom">목표 용량 직접 입력</option>' +
      '</select></div>' +
      '<div class="field" id="vod-target-row" hidden><label for="vod-target-mb">목표 용량 (MB)</label>' +
      '<input type="number" id="vod-target-mb" min="1" max="400" step="any" inputmode="decimal" ' +
      'placeholder="예: 40" aria-describedby="vod-setting-note"></div>' +
      '<p class="hint" id="vod-setting-note" role="status" hidden></p>' +
      '</details>' +
      '<div class="row">' +
      '<button class="btn primary grow" type="button" id="vod-go">변환 시작</button>' +
      '<button class="btn danger" type="button" id="vod-stop" disabled>중단</button>' +
      '</div>' +
      '<div class="progress-wrap" id="vod-progress" hidden>' +
      '<div class="bar" id="vod-meter" role="progressbar" aria-label="영상 변환 진행률" hidden><i id="vod-bar"></i></div>' +
      '<div class="bar-row"><span id="vod-label" role="status"></span><span id="vod-pct" aria-hidden="true"></span></div>' +
      '<p class="hint" id="vod-elapsed" aria-hidden="true"></p>' +
      '<p class="hint" id="vod-fallback" role="status" hidden>다른 방식으로 변환을 계속하고 있어요.</p></div>' +
      '<p class="hint warn" id="vod-note" role="alert" hidden></p>' +
      '</div>' +

      '<div id="vod-result"></div>';

    var input = $('#vod-file', root);
    var drop = $('#vod-drop', root);
    var pickBtn = $('#vod-pick', root);
    var changeBtn = $('#vod-change', root);
    var sourceEl = $('#vod-source', root);
    var nameEl = $('#vod-name', root);
    var settings = $('#vod-settings', root);
    var settingValue = $('#vod-setting-value', root);
    var progressEl = $('#vod-progress', root);
    var meter = $('#vod-meter', root);
    var elapsedEl = $('#vod-elapsed', root);
    var fallbackEl = $('#vod-fallback', root);
    var infoEl = $('#vod-info', root);
    var warnEl = $('#vod-warn', root);
    var runner = $('#vod-runner', root);
    var goBtn = $('#vod-go', root);
    var stopBtn = $('#vod-stop', root);
    var sizeMode = $('#vod-size-mode', root);
    var targetRow = $('#vod-target-row', root);
    var targetInput = $('#vod-target-mb', root);
    var settingNote = $('#vod-setting-note', root);
    var stateEl = $('#vod-state', root);
    var barEl = $('#vod-bar', root);
    var labelEl = $('#vod-label', root);
    var pctEl = $('#vod-pct', root);
    var noteEl = $('#vod-note', root);
    var resultEl = $('#vod-result', root);

    var state = { file: null, ffmpeg: null, running: false, alive: false, meta: null, resultURL: null };

    function selectedTarget() {
      if (sizeMode.value === 'original') return Math.min(state.file.size, TARGET_BYTES);
      if (sizeMode.value === 'custom') return Math.round(targetInput.valueAsNumber * 1000000);
      return null;
    }

    function refreshSettings() {
      var custom = sizeMode.value === 'custom';
      var invalid = custom && (!targetInput.value || !targetInput.validity.valid);
      var targetBytes = state.file && selectedTarget();
      var duration = state.meta && state.meta.duration;
      var smallTarget = targetBytes != null && duration > 0 && targetBytes * 8 / duration < 1000000;
      var targetLabel = targetBytes != null && !invalid
        ? (custom || targetBytes === TARGET_BYTES ? decimalSize(targetBytes) : U.bytes(targetBytes)) : '';
      settingValue.textContent = sizeMode.value === 'auto' ? '용량 · 자동' :
        targetLabel ? '목표 ' + targetLabel : '목표 용량 입력';
      var note = invalid ? '1~400MB 사이의 값을 입력해 주세요.' : targetLabel ?
        '목표 ' + targetLabel + ' · 결과가 목표를 넘을 수 있어요.' +
        (smallTarget ? ' 화질이 낮아질 수 있어요.' : '') : '';

      targetRow.hidden = !custom;
      targetInput.setAttribute('aria-invalid', String(invalid));
      settingNote.textContent = note;
      settingNote.hidden = !note;
      settingNote.classList.toggle('warn', invalid || smallTarget);
      goBtn.disabled = state.running || !state.file || invalid;
      return !invalid;
    }

    sizeMode.addEventListener('change', refreshSettings);
    targetInput.addEventListener('input', refreshSettings);

    function stage(text, progress) {
      if (labelEl.textContent !== text) labelEl.textContent = text;
      meter.hidden = !Number.isFinite(progress);
      pctEl.textContent = '';
      if (!meter.hidden) {
        var percentage = Math.min(99, Math.floor(U.clamp(progress, 0, 1) * 100));
        barEl.style.width = percentage + '%';
        meter.setAttribute('aria-valuenow', percentage);
        pctEl.textContent = percentage + '%';
      }
    }

    function clearResult() {
      var preview = $('video', resultEl);
      if (preview) {
        preview.removeAttribute('src');
        preview.load();
      }
      resultEl.replaceChildren();
      if (state.resultURL) URL.revokeObjectURL(state.resultURL);
      state.resultURL = null;
      goBtn.classList.add('primary');
      goBtn.textContent = '변환 시작';
    }

    U.dropzone(drop, input, function (files) {
      var f = files.filter(function (x) {
        return /^video\//.test(x.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(x.name);
      })[0];
      if (!f) { U.toast('영상 파일을 선택해 주세요', 'err'); return; }
      select(f);
    });
    [pickBtn, changeBtn].forEach(function (button) {
      button.addEventListener('click', function () { input.click(); });
    });

    function select(file) {
      if (state.running) return;
      state.file = file;
      state.meta = null;
      clearResult();
      pickBtn.hidden = true;
      sourceEl.hidden = false;
      runner.hidden = false;
      refreshSettings();
      changeBtn.focus({ preventScroll: true });
      stopBtn.hidden = true;
      stateEl.textContent = '대기';
      progressEl.hidden = true;
      noteEl.hidden = true;
      delete root.dataset.engine;

      nameEl.textContent = file.name || '영상';
      infoEl.textContent = U.bytes(file.size);
      renderNotice(file);

      state.metadataReady = new Promise(function (resolve) {
        var v = document.createElement('video');
        v.preload = 'metadata';
        var url = URL.createObjectURL(file);
        function finish() {
          clearTimeout(timeout);
          v.onloadedmetadata = v.onerror = null;
          v.removeAttribute('src');
          v.load();
          URL.revokeObjectURL(url);
          resolve();
        }
        var timeout = setTimeout(finish, 1800);
        v.onloadedmetadata = function () {
          var metadata = { duration: v.duration || 0, w: v.videoWidth, h: v.videoHeight };
          finish();
          if (state.file !== file) return;
          state.meta = metadata;
          refreshSettings();
          var dur = state.meta.duration;
          if (!Number.isFinite(dur) || dur <= 0) return;
          var seconds = Math.round(dur);
          infoEl.textContent = U.bytes(file.size) + ' · ' +
            Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        };
        v.onerror = finish;
        v.src = url;
      });
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
          U.copyText(location.href).then(function () {
            U.toast('주소를 복사했어요. PC 브라우저에 붙여넣어 주세요');
          }).catch(function () { U.toast('복사 권한이 없어요', 'err'); });
        });
      }
    }

    function decimalSize(bytes) {
      return (bytes / 1000000).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + ' MB';
    }

    function showResult(blob, targetBytes, formatSize, original) {
      state.resultURL = URL.createObjectURL(blob);
      var name = original ? state.file.name : (U.baseName(state.file.name) || 'video') + '-vod.mp4';
      var over = blob.size > TARGET_BYTES;
      var missedGoal = targetBytes != null && blob.size > targetBytes;
      var delta = blob.size - state.file.size;
      var difference = delta === 0 ? '용량 동일' :
        formatSize(Math.abs(delta)) + (delta > 0 ? ' 증가' : ' 감소');

      resultEl.innerHTML =
        '<div class="panel">' +
        '<div class="panel-head"><h2 id="vod-result-title" tabindex="-1">' + (original ? '원본 저장 가능' : '변환 결과') + '</h2></div>' +
        '<p class="vod-size-comparison" id="vod-size-comparison">원본 ' + formatSize(state.file.size) +
        ' → 결과 <strong>' + formatSize(blob.size) + '</strong> · ' + difference + '</p>' +
        '<p class="vod-verdict' + (over ? ' bad' : '') + '">' +
        '<span class="vod-check" aria-hidden="true">' + (over ? '!' : '✓') + '</span>' +
        (over ? '용량이 400MB를 넘었어요' : '업로드 규격 통과') +
        '</p>' +
        '<div class="chips" style="margin-top:8px">' +
        '<span class="chip ' + (over ? 'bad' : 'ok') + '">' + (over ? '400MB 초과' : '400MB 이하') + '</span>' +
        '<span class="chip">HD 720p</span><span class="chip">MP4</span>' +
        '</div>' +
        (targetBytes == null ? '' : '<p id="vod-goal" class="hint' + (missedGoal ? ' warn' : '') + '">' +
          (missedGoal ? '목표 용량 초과' : '목표 용량 충족') +
          ' · 목표 ' + formatSize(targetBytes) + (missedGoal ? '보다 ' + formatSize(blob.size - targetBytes) + ' 큼' : '') + '</p>') +
        '<div class="row vod-result-actions">' +
        '<a class="btn primary grow" id="vod-save">' + (original ? '변환 없이 저장' : 'MP4 저장') + '</a>' +
        '<button class="btn" type="button" id="vod-share">공유</button>' +
        '<button class="btn ghost" type="button" id="vod-adjust">설정 조정</button></div>' +
        '<p class="hint" id="vod-share-note" role="status" hidden></p>' +
        '<video src="' + state.resultURL + '" controls controlslist="nodownload" playsinline preload="metadata" aria-label="변환한 영상 미리보기" class="vod-preview"></video>' +
        (over ? '<p class="hint">목표 용량을 줄이거나 영상을 나눠 다시 변환해 주세요.</p>' : '') +
        '</div>';

      $('#vod-adjust', resultEl).addEventListener('click', function () {
        settings.open = true;
        sizeMode.focus();
      });
      $('#vod-result-title', resultEl).focus();
      var saveLink = $('#vod-save', resultEl);
      saveLink.href = state.resultURL;
      saveLink.download = name;
      var shareNote = $('#vod-share-note', resultEl);
      $('#vod-share', resultEl).addEventListener('click', async function () {
        shareNote.hidden = true;
        try {
          if (await U.shareBlob(blob, name, 'VOD 규격 MP4')) return;
          shareNote.textContent = '이 브라우저에서는 파일을 공유할 수 없어요. 저장 버튼으로 내려받아 주세요.';
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          shareNote.textContent = '공유를 열지 못했어요. 저장 버튼으로 내려받아 주세요.';
        }
        shareNote.hidden = false;
      });
    }

    async function convert() {
      if (!state.file || state.running || !refreshSettings()) return;
      var targetBytes = selectedTarget();
      var formatSize = sizeMode.value === 'custom' || targetBytes === TARGET_BYTES ? decimalSize : U.bytes;
      state.running = true;
      state.alive = true;
      state.failureHint = '';
      clearResult();
      goBtn.disabled = true;
      changeBtn.disabled = true;
      sizeMode.disabled = true;
      targetInput.disabled = true;
      stopBtn.hidden = false;
      stopBtn.disabled = false;
      stateEl.textContent = '변환 중';
      noteEl.hidden = true;
      fallbackEl.hidden = true;
      progressEl.hidden = false;

      var started = Date.now();
      function updateElapsed() {
        var seconds = Math.floor((Date.now() - started) / 1000);
        elapsedEl.textContent = '경과 ' + (seconds >= 60 ? Math.floor(seconds / 60) + '분 ' : '') + seconds % 60 + '초';
      }
      updateElapsed();
      stage('영상 정보 확인 중…');
      var clock = setInterval(updateElapsed, 1000);
      var hooks = {
        alive: function () { return state.alive; },
        stage: stage
      };

      var engine = 'ffmpeg';
      var reason = '';
      try {
        var original = await checkOriginal(state.file, targetBytes, hooks, state);
        var blob = original ? state.file : null;
        if (original) engine = 'original';
        var plan = original ? null : await checkWebCodecs(state.file, hooks);
        if (plan && plan.ok) {
          try {
            blob = await transcodeWebCodecs(state.file, plan, hooks, targetBytes);
            engine = 'webcodecs';
          } catch (e) {
            if (e && e.message === 'aborted') throw e;
            fallbackEl.hidden = false;
            reason = (e && e.message) || String(e);
            console.warn('[vod] 가속 변환 실패 → 기본 방식으로', e);
          }
        } else if (plan) {
          reason = plan.reason || '미지원';
        }

        // 2) 안 되면 ffmpeg.wasm 으로 자동 폴백
        if (!blob) {
          if (!state.alive) throw new Error('aborted');
          blob = await transcodeFFmpeg(state.file, hooks, state, targetBytes);
        }

        if (!state.alive) throw new Error('aborted');
        root.dataset.engine = engine;
        window.__labsVod = { path: engine, reason: reason, ms: Date.now() - started, size: blob.size };

        var secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        stateEl.textContent = '완료';
        stage(original ? '원본이 업로드 규격에 맞아요.' : '변환 완료 · ' + secs + '초');
        elapsedEl.textContent = '';
        fallbackEl.hidden = true;
        showResult(blob, targetBytes, formatSize, original);
        goBtn.textContent = original ? '다시 확인' : '다시 변환';
        goBtn.classList.remove('primary');
      } catch (e) {
        if (!state.alive || (e && e.message === 'aborted')) {
          stateEl.textContent = '중단됨';
          stage('변환을 중단했어요.');
        } else {
          if (!(e && e.userMessage)) console.error(e);
          stateEl.textContent = '실패';
          stage('변환하지 못했어요.');
          noteEl.hidden = false;
          noteEl.textContent = (e && e.userMessage) || state.failureHint ||
            '영상을 읽지 못했어요. 파일이 재생되는지 확인한 뒤 다시 시도해 주세요.';
          settings.open = true;
        }
      } finally {
        clearInterval(clock);
        elapsedEl.textContent = '';
        changeBtn.disabled = false;
        state.running = false;
        state.alive = false;
        sizeMode.disabled = false;
        targetInput.disabled = false;
        refreshSettings();
        if (document.activeElement === stopBtn) goBtn.focus();
        stopBtn.hidden = true;
        closeFFmpeg(state);
      }
    }

    goBtn.addEventListener('click', convert);

    stopBtn.addEventListener('click', function () {
      if (!state.running) return;
      state.alive = false;
      stopBtn.disabled = true;
      stage('변환 중단 중…');
      closeFFmpeg(state);
    });
  }

  window.Labs.register('vod', { mount: mount, largeNotice: largeNotice });
})();
