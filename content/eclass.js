/* eclass.krs.co.kr 홈: R&D ERP 현황 패널 삽입
 * panelMode 'inline' : 본문(Popup Notice 카드 위)에 카드 형태로 삽입. 삽입 위치를 못 찾으면 float 로 대체
 * panelMode 'float'  : 우측 상단에 띄움 */
(async () => {
  if (document.getElementById('krext-panel')) return;

  let settings = null;
  try { settings = await KRX_SETTINGS.load(); } catch (e) {}
  const wantInline = !settings || settings.panelMode !== 'float';

  const host = document.createElement('div');
  host.id = 'krext-panel';
  host.className = 'krext-panel';

  /* 본문 삽입 위치 찾기: "Popup Notice" 카드 → 그 카드(또는 그 카드가 속한 row)의 앞 */
  function findInlineAnchor() {
    const isRow = (el) => el && el.classList && el.classList.contains('row');
    const leaf = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,p,strong'))
      .find((el) => el.children.length === 0 && /^popup\s*notice$/i.test((el.textContent || '').trim()));
    if (leaf) {
      const card = leaf.closest('.card') || leaf.closest('.card-box') || leaf.closest('section') || leaf.parentElement;
      if (card && card !== document.body) {
        let node = card;
        while (node.parentElement && node.parentElement !== document.body && !isRow(node.parentElement)) node = node.parentElement;
        if (isRow(node.parentElement)) return { parent: node.parentElement, before: node, wrapCol: true };
        return { parent: card.parentElement, before: card, wrapCol: false };
      }
    }
    const main = document.querySelector('.content-page .container-fluid, .content-page .content, .content-page, .page-content, main, #content, .container-fluid');
    if (main) return { parent: main, before: main.firstElementChild, wrapCol: false };
    return null;
  }

  /* 본문이 늦게 그려지는 경우를 위해 최대 4초 대기 */
  async function waitInlineAnchor() {
    for (let i = 0; i < 14; i++) {
      const a = findInlineAnchor();
      if (a) return a;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  }

  let inline = false;
  if (wantInline) {
    const a = await waitInlineAnchor();
    if (a) {
      host.classList.add('krext-inline');
      if (a.wrapCol) {
        const col = document.createElement('div');
        col.className = 'col-12 krext-col';
        col.appendChild(host);
        a.parent.insertBefore(col, a.before);
      } else {
        a.parent.insertBefore(host, a.before);
      }
      inline = true;
    }
  }
  if (!inline) { host.classList.add('krext-float'); document.body.appendChild(host); }

  const state = { mode: inline ? 'inline' : 'page', loading: true, data: null, fatal: null, collapsed: false, expanded: new Set(), rndUrl: null, view: 'project', version: '' };
  try { state.version = chrome.runtime.getManifest().version; } catch (e) {}
  try {
    const local = await chrome.storage.local.get(['panelCollapsed', 'cache', 'panelView']);
    state.collapsed = !!local.panelCollapsed;
    state.data = local.cache || null;
    state.view = local.panelView === 'card' ? 'card' : 'project';
  } catch (e) {}
  const link = Array.from(document.querySelectorAll('a[href]')).find((x) => /rnd\.krs\.co\.kr/i.test(x.href));
  state.rndUrl = link ? link.href : null;

  const draw = () => KRX_RENDER.render(host, state);

  /* 확장이 새로고침/업데이트되면 이 스크립트는 확장과 연결이 끊긴다(Extension context invalidated). 예외 대신 안내 표시 */
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  const showStale = () => {
    if (host.querySelector('.krext-stale')) return;
    const n = document.createElement('div');
    n.className = 'krext-msg krext-warn krext-stale';
    n.innerHTML = '확장 프로그램이 업데이트되었습니다. <a href="#" onclick="location.reload();return false;">페이지를 새로고침</a>하면 다시 동작합니다.';
    const head = host.querySelector('.krext-head');
    if (head) head.insertAdjacentElement('afterend', n); else host.prepend(n);
  };

  /* chrome.* 호출은 확장이 교체된 뒤(context invalidated) 동기 예외를 던질 수 있어 모두 감싼다 */
  const safe = (fn) => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (e) { showStale(); } };

  host.addEventListener('click', (ev) => {
    try {
      const btn = ev.target.closest('[data-act]');
      if (!btn) return;
      if (!alive()) { ev.preventDefault(); showStale(); return; }
      const act = btn.dataset.act;
      if (act === 'refresh') { ev.preventDefault(); load(true); }
      else if (act === 'settings') { ev.preventDefault(); safe(() => chrome.runtime.sendMessage({ type: 'openOptions' })); }
      else if (act === 'toggle') { ev.preventDefault(); state.collapsed = !state.collapsed; safe(() => chrome.storage.local.set({ panelCollapsed: state.collapsed })); draw(); }
      else if (act === 'prj') { ev.preventDefault(); const k = btn.dataset.prj; if (state.expanded.has(k)) state.expanded.delete(k); else state.expanded.add(k); draw(); }
      else if (act === 'view') { ev.preventDefault(); state.view = btn.dataset.view === 'card' ? 'card' : 'project'; safe(() => chrome.storage.local.set({ panelView: state.view })); draw(); }
      else if (act === 'claim') { if (ev.target.closest('a')) return; ev.preventDefault(); if (btn.dataset.href) window.open(btn.dataset.href, '_blank', 'noopener'); }
    } catch (e) { showStale(); }
  });

  async function load(force) {
    if (!alive()) { state.loading = false; draw(); showStale(); return; }
    state.loading = true; state.fatal = null; draw();
    try {
      const res = await chrome.runtime.sendMessage({ type: 'getData', force: !!force });
      if (res && !res.error) state.data = res; else state.fatal = (res && res.error) || '응답 없음';
    } catch (e) {
      const msg = String((e && e.message) || e);
      state.fatal = /context invalidated/i.test(msg) ? null : msg;
      if (!state.fatal) { state.loading = false; draw(); showStale(); return; }
    }
    state.loading = false; draw();
  }

  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      try { if (area === 'local' && ch.cache && ch.cache.newValue) { state.data = ch.cache.newValue; if (!state.loading) draw(); } } catch (e) {}
    });
  } catch (e) {}

  draw();
  try { load(false); } catch (e) { showStale(); }
})();
