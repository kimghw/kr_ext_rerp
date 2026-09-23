/* 툴바 팝업: 패널 렌더러 재사용 */
(async () => {
  const host = document.getElementById('krext-panel');
  const state = { mode: 'popup', loading: true, data: null, fatal: null, collapsed: false, expanded: new Set(), rndUrl: null, view: 'project', section: 'cards', version: '',
    plans: {}, planEdit: null, planDraft: null, planError: '' };   // 예상 비용 (lib/plan.js)
  try { state.version = chrome.runtime.getManifest().version; } catch (e) {}
  try { const l = await chrome.storage.local.get(['cache', 'panelView', 'panelSection']); state.data = l.cache || null; state.view = l.panelView === 'card' ? 'card' : 'project'; state.section = l.panelSection === 'budget' ? 'budget' : 'cards'; } catch (e) {}
  try { state.plans = await KRX_PLAN.load(); } catch (e) {}
  try { state.payPlans = await KRX_PAY.load(); } catch (e) {}   // 받기 예정 연구수당 (lib/pay.js)
  try { state.partPlans = await KRX_PART.load(); } catch (e) {}   // 예비 참여율(참여 계획) (lib/part.js)
  const draw = () => KRX_RENDER.render(host, state);
  KRX_PLAN.bind(host, state, draw);   // 과제집행비율 표의 예상 비용 입력(＋/수정/삭제) 처리
  KRX_PAY.bind(host, state, draw);    // 급여·연구수당 구역의 받기 예정 연구수당 입력(＋/수정/삭제) 처리
  KRX_PART.bind(host, state, draw);   // 과제 참여율 표의 참여 계획 입력(＋/수정/삭제, 기간 달력) 처리

  host.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'refresh') { ev.preventDefault(); load(true); }
    else if (act === 'settings') { ev.preventDefault(); chrome.runtime.openOptionsPage(); }
    else if (act === 'prj') { ev.preventDefault(); const k = btn.dataset.prj; if (state.expanded.has(k)) state.expanded.delete(k); else state.expanded.add(k); draw(); }
    else if (act === 'view') { ev.preventDefault(); state.view = btn.dataset.view === 'card' ? 'card' : 'project'; chrome.storage.local.set({ panelView: state.view }); draw(); }
    else if (act === 'section') { ev.preventDefault(); state.section = btn.dataset.section === 'budget' ? 'budget' : 'cards'; chrome.storage.local.set({ panelSection: state.section }); draw(); }
    else if (act === 'claim') { if (ev.target.closest('a')) return; ev.preventDefault(); if (btn.dataset.href) chrome.tabs.create({ url: btn.dataset.href }); }
  });
  document.getElementById('btnOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

  async function load(force) {
    state.loading = true; state.fatal = null; draw();
    try {
      const res = await chrome.runtime.sendMessage({ type: 'getData', force: !!force });
      if (res && !res.error) state.data = res; else state.fatal = (res && res.error) || '응답 없음';
    } catch (e) { state.fatal = String((e && e.message) || e); }
    state.loading = false; draw();
    if (state.data && state.data.settings && state.data.settings.rndUrl) document.getElementById('rndLink').href = state.data.settings.rndUrl;
  }
  draw();
  load(false);
})();
