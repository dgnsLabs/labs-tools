/* ============================================================
   VOD 규격 변환 — MP4 / H.264 Baseline / 1280×720 / AAC
   ffmpeg.wasm (single-threaded core) is downloaded only when the
   user starts a conversion; the core is never precached by the SW.
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  var TARGET_MB = 400;
  var VF = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';

  // Reads AVCLevelIndication straight from the avcC box so the result
  // reports the level that actually landed in the file.
  function avcLevelIdc(bytes) {
    for (var i = 0; i < bytes.length - 8; i++) {
      if (bytes[i] === 0x61 && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x63 && bytes[i + 3] === 0x43) {
        return bytes[i + 7];
      }
    }
    return null;
  }

  function levelName(idc) {
    var map = { 13: '1.3', 20: '2.0', 21: '2.1', 30: '3.0', 31: '3.1', 32: '3.2', 40: '4.0', 41: '4.1', 42: '4.2', 51: '5.1' };
    return map[idc] || (idc ? (idc / 10).toFixed(1) : null);
  }

  function pcCommand(level) {
    return 'ffmpeg -i input.mp4 \\\n' +
      '  -vf "' + VF + '" \\\n' +
      '  -c:v libx264 -profile:v baseline -level:v ' + level + ' -pix_fmt yuv420p \\\n' +
      '  -b:v 5000k -maxrate 5000k -bufsize 10000k \\\n' +
      '  -c:a aac -b:a 128k -ar 44100 -ac 2 \\\n' +
      '  -movflags +faststart -y output.mp4';
  }

  function mount(root) {
    root.innerHTML =

      '<div class="panel">' +
      '<div class="panel-head"><h2>목표 규격</h2><span class="aside">콘텐츠 입력 가이드</span></div>' +
      '<ul class="spec-list">' +
      '<li><span>컨테이너</span><b>MP4</b></li>' +
      '<li><span>비디오 코덱</span><b>H.264 (Baseline Level 1.3)</b></li>' +
      '<li><span>해상도</span><b>1280×720 HD</b></li>' +
      '<li><span>비트레이트</span><b>5000 kbps 이하</b></li>' +
      '<li><span>오디오</span><b>AAC</b></li>' +
      '<li><span>최대 용량</span><b>400 MB 이하</b></li>' +
      '</ul>' +
      '<p class="hint warn">※ H.264 표준상 1280×720은 Level 3.1이 필요합니다. 브라우저 변환은 Level 1.3으로 먼저 시도하고, 인코더가 거부하면 자동으로 Level 3.1로 다시 인코딩합니다(권장).</p>' +
      '</div>' +

      '<div class="panel">' +
      '<div class="drop" id="vod-drop">' +
      '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.6"/><path d="m10 9 5 3-5 3z"/></svg>' +
      '<b>영상 선택</b><span>MP4 / MOV / WebM · 짧은 영상 권장</span>' +
      '<input type="file" id="vod-file" accept="video/*" hidden>' +
      '</div>' +
      '<div class="row" style="margin-top:8px"><span class="chip" id="vod-info">아직 선택 없음</span>' +
      '<span class="grow"></span><button class="btn sm ghost" type="button" id="vod-change">다른 영상</button></div>' +
      '<p class="hint" id="vod-warn" hidden></p>' +
      '</div>' +

      '<div class="panel" id="vod-runner" hidden>' +
      '<div class="panel-head"><h2>변환</h2><span class="aside" id="vod-state">대기</span></div>' +
      '<div class="row">' +
      '<button class="btn primary grow" type="button" id="vod-go">변환 시작</button>' +
      '<button class="btn danger" type="button" id="vod-stop" disabled>중단</button>' +
      '</div>' +
      '<div class="progress-wrap"><div class="bar"><i id="vod-bar"></i></div>' +
      '<div class="bar-row"><span id="vod-label">대기 중</span><span id="vod-pct"></span></div></div>' +
      '<div class="log" id="vod-log" hidden></div>' +
      '<p class="hint">첫 변환 때 변환 엔진(약 32MB)을 한 번만 내려받습니다. 이후에는 캐시되어 바로 시작합니다. 폰에서는 실시간보다 느릴 수 있어 1~2분 이내 영상을 권장합니다.</p>' +
      '</div>' +

      '<div id="vod-result"></div>' +

      '<div class="panel">' +
      '<div class="panel-head"><h2>PC에서 변환 (대용량 권장)</h2>' +
      '<button class="btn sm" type="button" id="vod-copy">명령어 복사</button></div>' +
      '<pre class="code" id="vod-cmd">' + U.esc(pcCommand('3.1')) + '</pre>' +
      '<p class="hint">맥미니·PC에 ffmpeg가 설치되어 있다면 위 한 줄로 같은 결과를 훨씬 빠르게 만들 수 있습니다. 입력 파일 이름은 <span class="mono">input.mp4</span>로 바꿔 실행하세요. (Level 1.3 강제: <span class="mono">-level:v 1.3</span>)</p>' +
      '</div>';

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
    var logEl = $('#vod-log', root);
    var resultEl = $('#vod-result', root);

    var state = {
      file: null,
      ffmpeg: null,
      running: false,
      output: null,
      levelUsed: null,
      meta: null
    };

    U.dropzone(drop, input, function (files) {
      var f = files.filter(function (x) { return /^video\//.test(x.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(x.name); })[0];
      if (!f) { U.toast('영상 파일을 선택해 주세요', 'err'); return; }
      select(f);
    });
    $('#vod-change', root).addEventListener('click', function () { input.click(); });

    $('#vod-copy', root).addEventListener('click', function () {
      U.copyText(pcCommand('3.1')).then(function () { U.toast('명령어를 복사했어요'); })
        .catch(function () { U.toast('복사 권한이 없어요.', 'err'); });
    });

    function select(file) {
      state.file = file;
      state.output = null;
      state.levelUsed = null;
      resultEl.innerHTML = '';
      runner.hidden = false;
      goBtn.disabled = false;
      stateEl.textContent = '대기';
      barEl.style.width = '0%';
      labelEl.textContent = '대기 중';
      pctEl.textContent = '';
      logEl.textContent = '';
      logEl.hidden = true;

      infoEl.textContent = (file.name || 'video') + ' · ' + U.bytes(file.size);
      warnEl.hidden = true;

      // Read metadata for a friendlier summary.
      try {
        var v = document.createElement('video');
        v.preload = 'metadata';
        var url = URL.createObjectURL(file);
        v.onloadedmetadata = function () {
          state.meta = { duration: v.duration || 0, w: v.videoWidth, h: v.videoHeight };
          var dur = state.meta.duration;
          var mm = Math.floor(dur / 60), ss = Math.round(dur % 60);
          infoEl.textContent = (file.name || 'video') + ' · ' + U.bytes(file.size) +
            ' · ' + state.meta.w + '×' + state.meta.h + ' 큼 · ' + mm + ':' + String(ss).padStart(2, '0');
          if (file.size > TARGET_MB * 1024 * 1024) {
            warnEl.hidden = false;
            warnEl.textContent = '400MB를 넘는 영상입니다. 폰 브라우저에서는 메모리 부족으로 실패할 수 있어 PC 명령어 사용을 권장합니다.';
          } else if (dur > 180) {
            warnEl.hidden = false;
            warnEl.textContent = '3분이 넘는 영상은 폰에서 오래 걸리거나 중단될 수 있습니다. 아래 PC 명령어를 권장합니다.';
          }
          URL.revokeObjectURL(url);
        };
        v.onerror = function () { URL.revokeObjectURL(url); };
        v.src = url;
      } catch (e) { /* metadata is optional */ }
    }

    function setProgress(p) {
      var v = isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
      barEl.style.width = Math.round(v * 100) + '%';
      pctEl.textContent = Math.round(v * 100) + '%';
    }

    function appendLog(msg) {
      if (/^\s*Aborted\(\)\s*$/.test(msg)) return; // ffmpeg.wasm teardown noise
      logEl.hidden = false;
      var lines = (logEl.textContent ? logEl.textContent.split('\n') : []);
      lines.push(msg);
      if (lines.length > 40) lines = lines.slice(lines.length - 40);
      logEl.textContent = lines.join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    }

    async function getFFmpeg() {
      if (state.ffmpeg) return state.ffmpeg;
      var FFmpegWASM = await U.ensureLib('ffmpeg');
      var ff = new FFmpegWASM.FFmpeg();
      ff.on('log', function (e) { if (e && e.message) appendLog(e.message); });
      ff.on('progress', function (e) { if (e) setProgress(e.progress); });
      stateEl.textContent = '엔진 준비 중';
      labelEl.textContent = '변환 엔진 내려받는 중… (32MB, 첫 1회만)';
      await ff.load({
        coreURL: U.vendor('vendor/ffmpeg/ffmpeg-core.js'),
        wasmURL: U.vendor('vendor/ffmpeg/ffmpeg-core.wasm')
      });
      state.ffmpeg = ff;
      return ff;
    }

    function argsFor(inputName, level) {
      return [
        '-i', inputName,
        '-vf', VF,
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-level:v', level,
        '-pix_fmt', 'yuv420p',
        '-b:v', '5000k', '-maxrate', '5000k', '-bufsize', '10000k',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-movflags', '+faststart',
        '-threads', '1',
        '-y', 'output.mp4'
      ];
    }

    async function convert() {
      if (!state.file || state.running) return;
      state.running = true;
      state.output = null;
      state.levelUsed = null;
      resultEl.innerHTML = '';
      goBtn.disabled = true;
      stopBtn.disabled = false;
      stateEl.textContent = '준비';
      logEl.textContent = '';
      setProgress(0);
      var started = Date.now();

      try {
        var ff = await getFFmpeg();
        var inName = 'input' + (/\.[a-z0-9]+$/i.exec(state.file.name || '') || ['.mp4'])[0].toLowerCase();
        labelEl.textContent = '파일 올리는 중…';
        await ff.writeFile(inName, new Uint8Array(await U.readFile(state.file)));
        if (!state.running) return;

        stateEl.textContent = '변환 중';
        labelEl.textContent = 'Level 1.3 으로 인코딩 중…';
        var code = await ff.exec(argsFor(inName, '1.3'));
        var used = '1.3';

        if (code !== 0) {
          // 1280x720 needs at least Level 3.1; retry cleanly.
          appendLog('[level 1.3 거부 → 3.1로 재시도]');
          labelEl.textContent = 'Level 3.1 로 다시 인코딩 중…';
          try { await ff.deleteFile('output.mp4'); } catch (e) { /* none */ }
          code = await ff.exec(argsFor(inName, '3.1'));
          used = '3.1';
        }

        if (code !== 0) throw new Error('인코더가 변환을 마치지 못했습니다 (code ' + code + ')');

        var data = await ff.readFile('output.mp4');
        var blob = new Blob([data], { type: 'video/mp4' });
        state.output = blob;
        var detected = levelName(avcLevelIdc(data));
        state.levelUsed = detected || used;

        try { await ff.deleteFile(inName); await ff.deleteFile('output.mp4'); } catch (e) { /* ignore */ }

        var secs = Math.round((Date.now() - started) / 1000);
        setProgress(1);
        stateEl.textContent = '완료';
        labelEl.textContent = '변환 완료 · ' + U.bytes(blob.size) + ' · ' + secs + '초';
        pctEl.textContent = '100%';

        showResult(blob, state.levelUsed, used);
        U.toast('변환했어요 · ' + U.bytes(blob.size), null, 3200);
      } catch (e) {
        console.error(e);
        stateEl.textContent = '실패';
        labelEl.textContent = '변환하지 못했어요: ' + (e.message || e);
        U.toast('변환하지 못했어요. 아래 PC 명령어를 이용해 주세요.', 'err', 4000);
        if (String(e.message || e).indexOf('memory') >= 0 || String(e.message || e).toLowerCase().indexOf('oom') >= 0) {
          labelEl.textContent = '메모리가 부족합니다. 더 짧은 영상이나 PC 변환을 이용해 주세요.';
        }
      } finally {
        state.running = false;
        goBtn.disabled = false;
        stopBtn.disabled = true;
      }
    }

    function showResult(blob, level, attempted) {
      var url = URL.createObjectURL(blob);
      var name = (U.baseName(state.file.name) || 'video') + '-vod.mp4';
      var over = blob.size > TARGET_MB * 1024 * 1024;
      var chips =
        '<span class="chip ' + (over ? 'bad' : 'ok') + '">' + (over ? '400MB 초과' : '400MB 이하') + '</span>' +
        '<span class="chip accent">MP4</span>' +
        '<span class="chip">H.264 Baseline L' + level + '</span>' +
        '<span class="chip">1280×720</span>' +
        '<span class="chip">AAC</span>';

      resultEl.innerHTML =
        '<div class="panel">' +
        '<div class="panel-head"><h2>결과 미리보기</h2><span class="aside">' + U.bytes(blob.size) + '</span></div>' +
        '<video src="' + url + '" controls playsinline preload="metadata" style="width:100%;border-radius:12px;background:#000;display:block"></video>' +
        '<div class="chips" style="margin-top:10px">' + chips + '</div>' +
        (attempted === '1.3' && level !== '1.3'
          ? '<p class="hint">Level 1.3 인코딩이 거부되어 Level ' + level + '로 다시 인코딩했습니다. 해상도·코덱·비트레이트는 규격과 같습니다.</p>'
          : '') +
        '</div>' +
        '<div class="sticky-actions">' +
        '<button class="btn" type="button" id="vod-share">공유</button>' +
        '<button class="btn primary" type="button" id="vod-save">MP4 저장</button>' +
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

    goBtn.addEventListener('click', convert);

    stopBtn.addEventListener('click', function () {
      if (!state.running) return;
      state.running = false;
      stateEl.textContent = '중단됨';
      labelEl.textContent = '중단했습니다. 다시 시작하려면 “변환 시작”을 누르세요.';
      if (state.ffmpeg) {
        try { state.ffmpeg.terminate(); } catch (e) { /* ignore */ }
        state.ffmpeg = null;
      }
      stopBtn.disabled = true;
      goBtn.disabled = false;
    });
  }

  window.Labs.register('vod', { mount: mount });
})();
