/* ============================================================
   URL 추적 제거 — strips tracking parameters from shared links
   ============================================================ */
(function () {
  'use strict';
  var U = window.Labs.util;
  var $ = U.$;

  // Exact parameter names (compared lowercase) that only exist for tracking.
  var TRACK_EXACT = {
    gclid: 1, gclsrc: 1, dclid: 1, wbraid: 1, gbraid: 1, yclid: 1, twclid: 1, ttclid: 1,
    fbclid: 1, msclkid: 1, li_fat_id: 1, mibextid: 1, fb_action_ids: 1, fb_action_types: 1,
    fb_source: 1, fb_ref: 1, _rdr: 1, mc_cid: 1, mc_eid: 1, _ga: 1, _gl: 1, _hsenc: 1,
    _hsmi: 1, hsctatracking: 1, vero_id: 1, vero_conv: 1, wickedid: 1, dm_i: 1, epik: 1,
    igsh: 1, igshid: 1, ref: 1, ref_src: 1, ref_url: 1, referrer: 1, referral: 1,
    source: 1, src: 1, subid: 1, sub_id: 1, lptag: 1, wtime: 1, spm: 1, scm: 1,
    si: 1, pp: 1, feature: 1, share: 1, share_id: 1, mkt_tok: 1, trk: 1, trkcampaign: 1,
    oly_enc_id: 1, oly_anon_id: 1, __twitter_impression: 1, s_cid: 1, cmp: 1,
    mtm_campaign: 1, mtm_source: 1, mtm_medium: 1, mtm_content: 1, mtm_keyword: 1,
    _branch_match_id: 1, _branch_referrer: 1, irclickid: 1, affiliate_id: 1,
    sa: 1, ved: 1, usg: 1, opi: 1, sclient: 1, ei: 1,  // google search share
    is_from_webapp: 1, sender_device: 1, share_app_id: 1, share_link_id: 1, share_item_id: 1,
    _t: 1, _r: 1
  };
  var TRACK_PREFIX = ['utm_', 'pk_', 'mtm_', 'hsa_', 'sc_', 'vero_'];

  function isTracking(key) {
    var k = key.toLowerCase();
    if (TRACK_EXACT[k]) return true;
    for (var i = 0; i < TRACK_PREFIX.length; i++) {
      if (k.indexOf(TRACK_PREFIX[i]) === 0) return true;
    }
    return false;
  }

  // Hosts with extra one-off tracking keys.
  var HOST_KEYS = {
    'coupang.com': ['lptag', 'subid', 'wtime', 'spec', 'rating', 'page'],
    'youtube.com': ['si', 'pp', 'feature', 'kw'],
    'youtu.be': ['si', 'feature'],
    'instagram.com': ['igsh', 'igshid', 'utm_source'],
    'threads.net': ['igsh', 'igshid'],
    'facebook.com': ['mibextid', '_rdr', 'fbclid'],
    'x.com': ['s', 'ref_src'],
    'twitter.com': ['s', 'ref_src'],
    'naver.com': ['sm', 'from', 'fromrss', 'fromfeed'],
    'tiktok.com': ['is_from_webapp', 'sender_device', 'share_app_id', 'share_link_id', 'share_item_id', '_r', '_t'],
    'google.com': ['sa', 'ved', 'usg', 'opi', 'sclient', 'ei', 'gclid']
  };

  function hostKey(hostname) {
    var h = hostname.replace(/^www\./, '').toLowerCase();
    var parts = h.split('.');
    for (var i = 0; i < parts.length - 1; i++) {
      var cand = parts.slice(i).join('.');
      if (HOST_KEYS[cand]) return cand;
    }
    return h;
  }

  function cleanOne(raw) {
    var s = String(raw).trim().replace(/&amp;/g, '&');
    s = s.replace(/^[<("'“”‘’\[]+/, '').replace(/[)>"'“”‘’\],.;]+$/, '');
    if (!s) return null;

    var url;
    try { url = new URL(s); }
    catch (e) {
      try { url = new URL('https://' + s); } catch (e2) { return { ok: false, input: raw }; }
    }
    if (!/^https?:$/.test(url.protocol)) return { ok: false, input: raw };

    var removed = [];
    var params = new URLSearchParams(url.search);
    var keys = Array.from(params.keys());
    var hk = hostKey(url.hostname);
    var hostExtra = HOST_KEYS[hk] || [];

    keys.forEach(function (k) {
      var lower = k.toLowerCase();
      var extra = hostExtra.some(function (x) { return x.toLowerCase() === lower; });
      if (isTracking(k) || extra) {
        if (removed.indexOf(k) === -1) removed.push(k);
        params.delete(k);
      }
    });

    // Rebuild query (URLSearchParams keeps the remaining order/encoding).
    var qs = params.toString();
    url.search = qs ? '?' + qs : '';

    // Fragment that is purely tracking (e.g. #utm_source=...).
    if (url.hash && url.hash.length > 1) {
      var frag = url.hash.slice(1);
      if (frag.indexOf('=') > 0) {
        var fp = new URLSearchParams(frag);
        var fkeys = Array.from(fp.keys());
        if (fkeys.length && fkeys.every(function (k) { return isTracking(k); })) {
          url.hash = '';
        }
      }
    }

    var out = url.toString();
    // A bare domain gets a trailing "/" from URL(); that is fine and canonical.
    return {
      ok: true,
      input: raw,
      cleaned: out,
      removed: removed,
      changed: removed.length > 0 || out !== s,
      host: url.hostname
    };
  }

  function extract(text) {
    var urls = [];
    var re = /https?:\/\/[^\s<>"'“”]+/gi;
    var m;
    while ((m = re.exec(text))) urls.push(m[0]);
    if (urls.length) return urls;
    // No scheme: accept each non-empty line that looks like a domain/path.
    return text.split(/[\n\r]+/).map(function (l) { return l.trim(); })
      .filter(function (l) { return /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(l); });
  }

  function mount(root) {
    root.innerHTML =

      '<div class="panel">' +
      '<div class="panel-head"><h2>링크 입력</h2><span class="aside">여러 개도 한 번에</span></div>' +
      '<textarea id="url-in" rows="4" placeholder="https://www.instagram.com/p/…?igsh=…&#10;https://link.coupang.com/a/…?lptag=…" spellcheck="false" autocomplete="off"></textarea>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn sm" type="button" id="paste-btn">붙여넣기</button>' +
      '<button class="btn sm ghost" type="button" id="clear-btn">지우기</button>' +
      '<span class="grow"></span>' +
      '<button class="btn primary sm" type="button" id="clean-btn">정리하기</button>' +
      '</div>' +
      '</div>' +

      '<div id="url-results"></div>' +

      '<div class="panel tight">' +
      '<div class="notice">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>' +
      '<div><b>단축 링크는 원본 주소까지 풀지 못합니다.</b><br>' +
      'link.coupang.com 같은 단축 주소는 서버 리다이렉트를 브라우저에서 읽을 수 없어(CORS 제약) 붙은 쿼리 파라미터만 제거합니다. 최종 주소는 링크를 연 뒤 주소창에서 다시 정리해 주세요.</div>' +
      '</div>' +
      '</div>';

    var input = $('#url-in', root);
    var results = $('#url-results', root);

    function render(list) {
      if (!list.length) { results.innerHTML = ''; return; }
      var okItems = list.filter(function (r) { return r.ok; });
      if (!okItems.length) {
        results.innerHTML = '<div class="panel"><p class="hint">주소를 인식하지 못했어요. http:// 또는 https://로 시작하는 링크를 넣어 주세요.</p></div>';
        return;
      }
      var allClean = okItems.map(function (r) { return r.cleaned; }).join('\n');

      var html = '<div class="panel">' +
        '<div class="panel-head"><h2>정리 결과</h2>' +
        '<button class="btn sm ghost" type="button" id="copy-all">전체 복사</button></div>';

      html += okItems.map(function (r) {
        var chips = r.removed.length
          ? r.removed.map(function (k) { return '<span class="chip bad">' + U.esc(k) + '</span>'; }).join('')
          : '<span class="chip ok">추적 파라미터 없음</span>';
        return '<div class="item" style="align-items:flex-start;flex-direction:column;gap:8px">' +
          '<div class="result" data-cleaned="' + U.esc(r.cleaned) + '" style="width:100%">' + U.esc(r.cleaned) + '</div>' +
          '<div class="row" style="width:100%;gap:6px">' +
          '<div class="chips grow">' + chips + '</div>' +
          '<button class="btn sm" type="button" data-copy="' + U.esc(r.cleaned) + '">복사</button>' +
          '<a class="btn sm ghost" href="' + U.esc(r.cleaned) + '" target="_blank" rel="noopener noreferrer">열기</a>' +
          '</div></div>';
      }).join('');

      html += '</div>';
      results.innerHTML = html;

      results.querySelectorAll('[data-copy]').forEach(function (b) {
        b.addEventListener('click', function () {
          U.copyText(b.getAttribute('data-copy')).then(function () {
            U.toast('복사했어요');
          }).catch(function () { U.toast('복사 권한이 없어요. 길게 눌러 복사해 주세요.', 'err'); });
        });
      });
      var all = $('#copy-all', results);
      if (all) all.addEventListener('click', function () {
        U.copyText(allClean).then(function () { U.toast('전체 복사했어요'); })
          .catch(function () { U.toast('복사 권한이 없어요.', 'err'); });
      });
    }

    var run = function () {
      var text = input.value.trim();
      if (!text) { render([]); return; }
      render(extract(text).map(cleanOne).filter(Boolean));
    };
    var runSoon = U.debounce(run, 220);

    input.addEventListener('input', runSoon);
    $('#clean-btn', root).addEventListener('click', run);
    $('#clear-btn', root).addEventListener('click', function () {
      input.value = '';
      render([]);
      input.focus();
    });
    $('#paste-btn', root).addEventListener('click', function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        U.toast('붙여넣기는 입력창을 길게 눌러 주세요.', 'err');
        input.focus();
        return;
      }
      navigator.clipboard.readText().then(function (t) {
        input.value = t;
        run();
      }).catch(function () {
        U.toast('클립보드 권한이 필요해요. 직접 붙여넣어 주세요.', 'err');
        input.focus();
      });
    });

    setTimeout(function () { input.focus(); }, 120);
  }

  window.Labs.register('url', { mount: mount });
})();
