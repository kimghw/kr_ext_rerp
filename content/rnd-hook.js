/* rnd.krs.co.kr 페이지(MAIN world, 모든 프레임): .jct 서비스 호출을 가로채어 기록 (미승인내역 서비스 파악용) */
(() => {
  if (window.__krextHooked) return;
  window.__krextHooked = true;

  /* ---- 딥링크: eClass 패널에서 연 rderp_layoutMain.act#krext=... 를 레이아웃의 탭으로 열기 ---- */
  (function deepLink() {
    try {
      if (window !== window.top) return;
      const m = /(?:^#|&)krext=([^&]+)/.exec(location.hash || '');
      if (!m) return;
      let req = null;
      try { req = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return; }
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      if (!req || !req.open) return;
      const extra = [req.q || '', req.appr ? 'krext_appr=' + encodeURIComponent(req.appr) : '', req.card ? 'krext_card=' + encodeURIComponent(req.card) : ''].filter(Boolean).join('&');
      const title = req.title || '청구서(카드)';
      const started = Date.now();
      const url = '/' + req.open + (extra ? '?' + extra : '');
      const timer = setInterval(() => {
        try {
          const menusReady = typeof window.manualYN !== 'undefined' && window._accessibleMenuMapReady;
          if (menusReady && req.menuId && typeof window.openTab === 'function') {          // ERP 메인의 카드미청구 팝업과 같은 방식
            clearInterval(timer);
            window.openTab(req.menuId, title, url);
          } else if (menusReady && typeof window.openTabWithAuth === 'function') {
            clearInterval(timer);
            window.openTabWithAuth(title, req.open, extra);
          } else if (Date.now() - started > 30000) {
            clearInterval(timer);
            if (typeof window.openTab === 'function') window.openTab(req.menuId || '', title, url);
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
          return;
        }
      };
      const obs = new MutationObserver(() => { tryClick(); if (done || Date.now() - started > 40000) obs.disconnect(); });
      const start = () => { tryClick(); if (!done && document.body) obs.observe(document.body, { childList: true, subtree: true, characterData: true }); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    } catch (e) {}
  })();
  /* ---- 파일등록 팝업에서 청구서 입력 도우미(rnd-claim.js)가 "업로드"를 자동으로 누를 때: 그 직후 8초 동안 confirm() 을 자동 확인 ---- */
  (function autoConfirm() {
    try {
      let until = 0;
      document.addEventListener('krext-auto-confirm', () => { until = Date.now() + 8000; });
      const OC = window.confirm;
      window.confirm = function () { if (Date.now() < until) return true; return OC.apply(this, arguments); };
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
