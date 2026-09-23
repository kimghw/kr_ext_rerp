/* 급여·연구수당 구역의 "받기 예정 연구수당" (아직 HR 급여에 잡히지 않았지만 받을 예정인 금액) 저장소 + 입력 처리. eClass 콘텐츠스크립트 / 팝업 공용
 * storage.local.plannedAllowance = [ { id, name(메모: 과제·사유), amt(금액), ts } ]
 * 더 받을 수 있는 금액 = 한도 − 올해 지급 합계 − 받기 예정 합계. 실제로 지급되어 HR 급여명세서에 잡히면 사용자가 × 로 지운다.
 * R&D ERP·HR 에는 저장하지 않고 이 브라우저(확장 저장소)에만 남는다. 렌더러(render.js)는 state.payPlans / state.payEdit / state.payDraft / state.payError 를 읽는다 */
(function (g) {
  const F = g.KRX_FMT;
  const KEY = 'plannedAllowance';
  const EMPTY = () => ({ name: '', amt: '' });
  const sumOf = (list) => (list || []).reduce((s, e) => s + (F.num(e.amt) || 0), 0);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function load() { try { return (await chrome.storage.local.get(KEY))[KEY] || []; } catch (e) { return []; } }
  async function save(list) { await chrome.storage.local.set({ [KEY]: list }); }

  /* 패널(host)에 위임 리스너를 붙인다. draw() 는 렌더러 호출. state.payPlans 는 미리 load() 로 채워 둔다.
   * data-act: pay-open(＋ 버튼) · pay-edit/pay-del(data-id) · pay-save · pay-cancel, 입력칸 data-pay: name(메모) / amt(금액) */
  function bind(host, state, draw) {
    if (!Array.isArray(state.payPlans)) state.payPlans = [];
    const input = (f) => host.querySelector(`[data-pay="${f}"]`);
    const focus = (f) => { const el = input(f); if (el) { el.focus(); try { el.select(); } catch (e) {} } };
    const persist = () => { try { const r = save(state.payPlans); if (r && r.catch) r.catch(() => {}); } catch (e) {} };
    const close = () => { state.payEdit = null; state.payDraft = null; state.payError = ''; };

    function submit() {
      const pe = state.payEdit; if (!pe) return;
      const d = state.payDraft || EMPTY();
      const amt = F.num(d.amt);
      if (!(amt > 0)) { state.payError = '금액을 입력하세요'; draw(); focus('amt'); return; }
      const entry = { id: pe.id || newId(), name: String(d.name || '').trim(), amt, ts: Date.now() };
      const i = state.payPlans.findIndex((e) => e.id === entry.id);
      if (i >= 0) state.payPlans[i] = entry; else state.payPlans.push(entry);
      close(); persist(); draw();
    }

    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act^="pay-"]'); if (!btn) return;
      ev.preventDefault();
      const act = btn.dataset.act, id = btn.dataset.id;
      if (act === 'pay-toggle') { state.payOpen = !state.payOpen; if (!state.payOpen) close(); draw(); }   // 급여·연구수당 구역 보기/숨기기 (저장하지 않음: 새로 열면 숨김)
      else if (act === 'pay-open') { state.payEdit = { id: null }; state.payDraft = EMPTY(); state.payError = ''; draw(); focus('name'); }
      else if (act === 'pay-edit') {
        const e = state.payPlans.find((x) => x.id === id); if (!e) return;
        state.payEdit = { id }; state.payDraft = { name: e.name || '', amt: e.amt ? F.money(e.amt) : '' }; state.payError = ''; draw(); focus('amt');
      }
      else if (act === 'pay-cancel') { close(); draw(); }
      else if (act === 'pay-save') { submit(); }
      else if (act === 'pay-del') {
        state.payPlans = state.payPlans.filter((e) => e.id !== id);
        if (state.payEdit && state.payEdit.id === id) close();
        persist(); draw();
      }
    });
    host.addEventListener('input', (ev) => {
      const el = ev.target; const f = el && el.dataset ? el.dataset.pay : null; if (!f) return;
      (state.payDraft || (state.payDraft = EMPTY()))[f] = el.value;
    });
    host.addEventListener('keydown', (ev) => {
      const el = ev.target; if (!el || !el.dataset || !el.dataset.pay) return;
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(); draw(); }
    });
    // 금액 칸은 포커스를 벗어나면 천 단위 구분 기호로 정리
    host.addEventListener('focusout', (ev) => {
      const el = ev.target; if (!el || !el.dataset || el.dataset.pay !== 'amt') return;
      const v = F.num(el.value); el.value = v ? F.money(v) : '';
      if (state.payDraft) state.payDraft.amt = el.value;
    });
    // 다른 창(팝업 ↔ eClass)에서 바꾼 값 반영
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        try { if (area === 'local' && ch[KEY]) { state.payPlans = ch[KEY].newValue || []; draw(); } } catch (e) {}
      });
    } catch (e) {}
  }

  g.KRX_PAY = { KEY, sumOf, load, save, bind };
})(typeof self !== 'undefined' ? self : this);
