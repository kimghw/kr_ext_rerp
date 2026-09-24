/* rnd.krs.co.kr 페이지(MAIN world, 모든 프레임): .jct 서비스 호출을 가로채어 기록 (미승인내역 서비스 파악용) */
(() => {
  if (window.__krextHooked) return;
  window.__krextHooked = true;

  /* ---- 딥링크: eClass 패널에서 연 rderp_layoutMain.act#krext=... 를 레이아웃의 탭으로 열기 ----
   * req.menuId 가 있으면 그 메뉴 ID로 바로 연다(청구서·과제정보).
   * 없으면 로그인 사용자의 메뉴 트리(comm_0001_01_r005 → _urlToMenusMap, _jex_layout_global_var.menu)에서
   * 화면 URL(req.open) → 메뉴 이름(req.menuName) 순으로 찾아 그 메뉴의 ID·URL로 열고(메뉴 ID는 사용자마다 다를 수 있음),
   * 그래도 없으면 상단 메뉴(req.topMenuId, 예: 결재함 menu_id_7)를 클릭해 첫 하위 메뉴를 연다 */
  (function deepLink() {
    try {
      if (window !== window.top) return;
      const m = /(?:^#|&)krext=([^&]+)/.exec(location.hash || '');
      if (!m) return;
      let req = null;
      try { req = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return; }
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      if (!req || !req.open) return;
      // krext_auto=add: 패널의 청구 준비 "청구서 작성"(백그라운드 탭) — rnd-claim.js 가 세목·청구종류·첨부를 넣고 "내역 추가"까지 누른다
      const extra = [req.q || '', req.appr ? 'krext_appr=' + encodeURIComponent(req.appr) : '', req.card ? 'krext_card=' + encodeURIComponent(req.card) : '', req.auto ? 'krext_auto=' + encodeURIComponent(req.auto) : ''].filter(Boolean).join('&');
      const title = req.title || '청구서(카드)';
      const started = Date.now();
      const withQuery = (path) => (extra ? path + (path.includes('?') ? '&' : '?') + extra : path);
      const url = withQuery('/' + req.open);
      const ownUrl = (v) => String((v && (v.URL || v.url)) || '').replace(/^\//, '');
      const norm = (s) => String(s || '').replace(/\s+/g, '');
      /* 메뉴 트리에서 화면 URL → 메뉴 이름(공백 무시, 완전 일치 → 포함) 순으로 찾기 */
      const findMenu = () => {
        const byUrl = (window._urlToMenusMap && window._urlToMenusMap[req.open]) || [];
        if (byUrl.length && byUrl[0].id) return byUrl[0];
        if (!req.menuName) return null;
        const leaves = [];
        const walk = (arr) => { for (const v of arr || []) { if (!v) continue; if (v.sub && v.sub.length) walk(v.sub); else if (ownUrl(v) && v.id) leaves.push(v); } };
        try { const g = window._jex_layout_global_var; walk(g && g.menu && g.menu.REC); } catch (e) {}
        const want = norm(req.menuName);
        return leaves.find((v) => norm(v.name) === want) || leaves.find((v) => norm(v.name).includes(want)) || null;
      };
      const timer = setInterval(() => {
        try {
          const menusReady = typeof window.manualYN !== 'undefined' && window._accessibleMenuMapReady;
          const canOpen = typeof window.openTab === 'function';
          if (menusReady && req.menuId && canOpen) {          // ERP 메인의 카드미청구 팝업과 같은 방식
            clearInterval(timer);
            window.openTab(req.menuId, title, url);
          } else if (menusReady && canOpen) {
            const menu = findMenu();
            const top = !menu && req.topMenuId ? document.getElementById(req.topMenuId) : null;
            if (menu) { clearInterval(timer); window.openTab(menu.id, title, withQuery('/' + ownUrl(menu))); }   // 메뉴 자신의 URL(고유 쿼리 포함)에 요청 쿼리를 덧붙임
            else if (top) { clearInterval(timer); top.click(); }
            else if (typeof window.openTabWithAuth === 'function') { clearInterval(timer); window.openTabWithAuth(title, req.open, extra); }   // 권한 없음 안내는 레이아웃이 표시
          } else if (Date.now() - started > 30000) {
            clearInterval(timer);
            if (canOpen) window.openTab(req.menuId || '', title, url);
          }
        } catch (e) { clearInterval(timer); }
      }, 400);
    } catch (e) {}
  })();

  /* ---- 청구서(카드) 화면: krext_appr(승인번호)와 같은 미청구 행을 자동 선택 ---- */
  (function autoSelectRow() {
    try {
      const sp = new URLSearchParams(location.search);
      const appr = (sp.get('krext_appr') || '').trim();
      if (!appr) return;
      const card4 = (sp.get('krext_card') || '').replace(/\D/g, '').slice(-4);
      const isLeaf = (el) => !el.children.length;
      const started = Date.now();
      let done = false;
      const tryClick = () => {
        if (done) return;
        const root = document.getElementById('myGrid2') || document.body;
        if (!root) return;
        const cells = Array.from(root.querySelectorAll('div,span,td')).filter((el) => isLeaf(el) && (el.textContent || '').trim() === appr);
        for (const cell of cells) {
          const row = cell.closest('[class*="row"]') || cell.parentElement;
          const rowText = row ? (row.textContent || '') : '';
          if (card4 && rowText && !rowText.replace(/\D/g, '').includes(card4)) continue;
          done = true;
          try { cell.scrollIntoView({ block: 'center' }); } catch (e) {}
          for (const type of ['mousedown', 'mouseup', 'click']) {
            cell.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          }
          // 청구서 입력 도우미(rnd-claim.js, isolated world)에 "이 승인번호 행을 골랐다"고 알림 (DOM 속성은 world 를 넘어 보이므로 늦게 시작한 스크립트도 확인 가능)
          try { document.documentElement.dataset.krextRowSelected = appr; document.dispatchEvent(new CustomEvent('krext-row-selected', { detail: appr })); } catch (e) {}
          return;
        }
      };
      const obs = new MutationObserver(() => { tryClick(); if (done || Date.now() - started > 40000) obs.disconnect(); });
      const start = () => { tryClick(); if (!done && document.body) obs.observe(document.body, { childList: true, subtree: true, characterData: true }); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    } catch (e) {}
  })();
  /* ---- 파일등록 팝업에서 청구서 입력 도우미(rnd-claim.js)가 "업로드"를 자동으로 누를 때: 그 직후 8초 동안 confirm() 을 자동 확인 ----
   * 청구 준비 자동 처리(krext-auto-mode, detail = 밀리초 문자열) 동안은 confirm() 을 자동 확인하고 alert() 은 화면을 막지 않고
   * 문구만 krext-alert 이벤트로 넘긴다 (백그라운드 탭에서 alert 가 뜨면 처리가 멈추므로). 끝나면 krext-auto-mode 를 "0" 으로 보내 해제 */
  (function autoConfirm() {
    try {
      let until = 0, autoUntil = 0;
      // 백그라운드 탭 자동 작성(krext_auto)이면 행 자동 선택 단계의 alert 도 화면을 막지 않도록 처음부터 자동 모드 (rnd-claim.js 가 끝나면 "0" 으로 해제)
      try { if (new URLSearchParams(location.search).get('krext_auto')) autoUntil = Date.now() + 180000; } catch (e) {}
      document.addEventListener('krext-auto-confirm', () => { until = Date.now() + 8000; });
      document.addEventListener('krext-auto-mode', (ev) => { const ms = Number(ev && ev.detail) || 0; autoUntil = ms > 0 ? Date.now() + ms : 0; });
      const OC = window.confirm, OA = window.alert;
      // 자동 모드에서 저절로 확인하는 확인창은 흐름상 예상되는 것만("청구내역을 추가하시겠습니까?", "새로운 미청구 카드내역을 선택하시겠습니까?").
      // 금액 불일치·심야 사용 등 다른 확인창은 진행하지 않고(취소) 문구를 "[확인 필요]" 로 넘겨 실패 사유가 되게 한다
      const SAFE_CONFIRM = /추가하시겠습니까|선택하시겠습니까/;
      window.confirm = function (msg) {
        if (Date.now() < until) return true;
        if (Date.now() < autoUntil) {
          const text = String(msg == null ? '' : msg);
          if (SAFE_CONFIRM.test(text)) return true;
          try { document.documentElement.dataset.krextAlert = '[확인 필요] ' + text; } catch (e) {}
          try { document.dispatchEvent(new CustomEvent('krext-alert', { detail: '[확인 필요] ' + text })); } catch (e) {}
          return false;
        }
        return OC.apply(this, arguments);
      };
      window.alert = function (msg) {
        if (Date.now() < autoUntil) {
          const text = String(msg == null ? '' : msg);
          try { document.documentElement.dataset.krextAlert = text; } catch (e) {}   // 늦게 시작한 스크립트도 마지막 문구를 볼 수 있게
          try { document.dispatchEvent(new CustomEvent('krext-alert', { detail: text })); } catch (e) {}
          return undefined;
        }
        return OA.apply(this, arguments);
      };
    } catch (e) {}
  })();
  /* ---- 청구서 입력 도우미가 화면의 함수를 부를 때 (isolated world 는 페이지 함수를 못 부름): krext-call(detail = JSON {id, fn:"ctl.doUploadAttfile", args:[…]})
   * → window 에서 fn 경로를 찾아 호출하고 결과를 krext-call-result(detail = JSON {id, ok, error}) 로 돌려준다 ---- */
  (function callBridge() {
    try {
      document.addEventListener('krext-call', (ev) => {
        let req = null;
        try { req = JSON.parse(String(ev && ev.detail || '')); } catch (e) { return; }
        if (!req || !req.fn) return;
        const reply = (ok, error) => { try { document.dispatchEvent(new CustomEvent('krext-call-result', { detail: JSON.stringify({ id: req.id, ok, error: error ? String(error) : '' }) })); } catch (e) {} };
        try {
          const path = String(req.fn).split('.');
          let ctx = window, fn = window;
          for (const p of path) { ctx = fn; fn = fn == null ? undefined : fn[p]; }
          if (typeof fn !== 'function') { reply(false, '함수 없음: ' + req.fn); return; }
          fn.apply(ctx, Array.isArray(req.args) ? req.args : []);
          reply(true, '');
        } catch (e) { reply(false, (e && e.message) || e); }
      });
    } catch (e) {}
  })();
  /* ---- window.open 이 팝업 차단으로 막히면(null 반환) 같은 출처의 모든 프레임에 krext-popup-blocked 를 알린다 (첨부 창을 자동으로 열 때 안내용) ---- */
  (function popupBlockedNotice() {
    try {
      const OO = window.open;
      window.open = function () {
        const w = OO.apply(this, arguments);
        if (!w) {
          try {
            const seen = new Set();
            const walk = (win) => {
              let d = null; try { d = win.document; } catch (e) { return; }
              if (!d || seen.has(d)) return; seen.add(d);
              try { d.dispatchEvent(new Event('krext-popup-blocked')); } catch (e) {}
              for (let i = 0; i < win.frames.length; i++) walk(win.frames[i]);
            };
            let top = window; try { top = window.top; } catch (e) {}
            walk(top); walk(window);
          } catch (e) {}
        }
        return w;
      };
    } catch (e) {}
  })();

  const MAX_REQ = 3000, MAX_RES = 8000;
  const isJct = (u) => /\.jct(\?|$)/i.test(String(u || ''));
  const svcOf = (u) => String(u || '').split('?')[0].split('/').pop().replace(/\.jct$/i, '');

  function post(entry) { try { window.postMessage({ __krext: 'jct', entry }, location.origin); } catch (e) {} }

  function decodeJsonParam(body) {
    try {
      if (body == null) return '';
      if (typeof body !== 'string') {
        if (body instanceof URLSearchParams) body = body.toString();
        else return '[non-string body]';
      }
      const m = /(?:^|&)_JSON_=([^&]*)/.exec(body);
      if (!m) return body.slice(0, MAX_REQ);
      let v = m[1].replace(/\+/g, ' ');
      for (let i = 0; i < 2; i++) { try { v = decodeURIComponent(v); } catch (e) { break; } }
      return v.slice(0, MAX_REQ);
    } catch (e) { return ''; }
  }

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__krext = { method: String(method || 'GET'), url: String(url || '') };
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__krext;
    if (info && isJct(info.url)) {
      info.request = decodeJsonParam(body);
      this.addEventListener('loadend', () => {
        let text = '';
        try { if (!this.responseType || this.responseType === 'text') text = this.responseText || ''; } catch (e) {}
        post({ ts: Date.now(), frame: location.pathname + location.search, service: svcOf(info.url), url: info.url,
               method: info.method, request: info.request, status: this.status, response: text.slice(0, MAX_RES) });
      });
    }
    return XS.apply(this, arguments);
  };

  const OF = window.fetch;
  if (typeof OF === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : ((input && input.url) || '');
      const p = OF.apply(this, arguments);
      if (isJct(url)) {
        p.then((res) => {
          try {
            res.clone().text().then((t) => post({ ts: Date.now(), frame: location.pathname + location.search, service: svcOf(url), url,
              method: (init && init.method) || 'GET', request: decodeJsonParam(init && init.body), status: res.status, response: t.slice(0, MAX_RES) }));
          } catch (e) {}
        }).catch(() => {});
      }
      return p;
    };
  }
})();
