/* hr.krs.co.kr 페이지(MAIN world, 모든 프레임): HR System 이 부르는 JSON API 호출을 가로채어 기록 (급여명세서 API 파악용)
 * rnd-hook.js 와 같은 방식. 기록은 hr-pay.js(isolated world)가 받아 백그라운드 캡처 로그(설정 페이지)에 넘긴다. 응답은 8000자까지만 */
(() => {
  if (window.__krextHrHooked) return;
  window.__krextHrHooked = true;

  const MAX_REQ = 3000, MAX_RES = 8000;
  const STATIC = /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map|html?)(\?|$)/i;
  const svcOf = (u) => { const p = String(u || '').split('?')[0].replace(/\/+$/, ''); return 'hr:' + (p.split('/').pop() || p); };
  const looksJson = (ct, text) => /json/i.test(ct || '') || /^\s*[\[{]/.test(text || '');

  function post(entry) { try { window.postMessage({ __krext: 'hrapi', entry }, location.origin); } catch (e) {} }
  function bodyText(body) {
    try {
      if (body == null) return '';
      if (typeof body === 'string') return body.slice(0, MAX_REQ);
      if (body instanceof URLSearchParams) return body.toString().slice(0, MAX_REQ);
      if (body instanceof FormData) return Array.from(body.entries()).map(([k, v]) => `${k}=${typeof v === 'string' ? v : '[file]'}`).join('&').slice(0, MAX_REQ);
      return '[non-string body]';
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
    if (info && !STATIC.test(info.url)) {
      info.request = bodyText(body);
      this.addEventListener('loadend', () => {
        let text = '';
        try { if (!this.responseType || this.responseType === 'text') text = this.responseText || ''; else if (this.responseType === 'json') text = JSON.stringify(this.response); } catch (e) {}
        let ct = ''; try { ct = this.getResponseHeader('content-type') || ''; } catch (e) {}
        if (!looksJson(ct, text)) return;
        post({ ts: Date.now(), site: 'hr', frame: location.pathname + location.search, service: svcOf(info.url), url: info.url,
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
      if (url && !STATIC.test(url)) {
        p.then((res) => {
          try {
            const ct = res.headers.get('content-type') || '';
            res.clone().text().then((t) => {
              if (!looksJson(ct, t)) return;
              post({ ts: Date.now(), site: 'hr', frame: location.pathname + location.search, service: svcOf(url), url,
                     method: (init && init.method) || (input && input.method) || 'GET', request: bodyText(init && init.body), status: res.status, response: t.slice(0, MAX_RES) });
            }).catch(() => {});
          } catch (e) {}
        }).catch(() => {});
      }
      return p;
    };
  }
})();
