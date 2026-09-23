/* 과제집행비율 보기의 "예상 비용" (비목별 세목·수량·단가 계획) 저장소 + 입력 처리. eClass 콘텐츠스크립트 / 팝업 공용
 * storage.local.plannedExpenses = { [과제번호]: { [비목 키]: [ { id, name(세목), qty(수량), unit(단가), amt(금액), ts, sub?: { date: 'YYYY-MM-DD' } } ] } }
 *   sub 가 있으면 월간 구독: date(첫 결제일)의 "일"에 매월 결제로 보고, 수량 = 오늘(포함) 이후 올해 12월까지 남은 결제 횟수를 그릴 때마다 다시 센다 (날짜가 지나면 줄어듦).
 *   금액 = 남은 횟수 × 단가(월 결제액). 저장된 qty/amt 는 저장 시점 값이고 실제 표시·합계는 qtyOf()/amtOf() 로 계산한다
 * 표에서는 기본으로 감춰져(＋·항목 줄·예상 반영 행이 빠지고 과제 행의 예상 잔액만 남음) 머리글의 눈 아이콘을 누른 동안만 보인다. 보이기 상태는 저장하지 않는다(state.planShown)
 * 비목 키 = "재원코드|비목명" (재원이 여럿인 과제는 재원별로 같은 비목이 따로 나오므로 재원을 앞에 붙임)
 * R&D ERP 에는 저장하지 않고 이 브라우저(확장 저장소 storage.local)에만 남으며, 입력·수정·삭제 때마다 자동 저장되어 브라우저를 다시 시작해도 남는다.
 * 저장 아이콘은 지금 한 번 더 저장하고 "저장됨"을 잠깐 보여 준다. storage.local.plannedSavedAt = 마지막 저장 시각 (아이콘 툴팁)
 * 렌더러(render.js)는 state.plans / state.planShown / state.planSavedAt / state.planSaved / state.planEdit / state.planDraft / state.planError 를 읽는다 */
(function (g) {
  const F = g.KRX_FMT;
  const KEY = 'plannedExpenses';
  const HKEY = 'plannedHidden';   // 이전 버전의 감춤 목록. 지금은 쓰지 않아 load() 가 지운다
  const TKEY = 'plannedSavedAt';
  const EMPTY = () => ({ name: '', qty: '1', unit: '', amt: '', sub: false, date: '' });
  let savedAtCache = 0;   // load() 가 읽어 둔 마지막 저장 시각. bind() 가 state.planSavedAt 의 초기값으로 씀
  const api = {};
  api._now = () => new Date();   // 테스트에서 바꿔 끼움

  const itemKey = (x) => `${(x && (x.resCd || x.res)) || ''}|${(x && (x.exp || x.item)) || ''}`;
  const keyName = (k) => { const s = String(k || ''); const i = s.indexOf('|'); return (i >= 0 ? s.slice(i + 1) : s) || '-'; };
  const listOf = (plans, prjNo, key) => (((plans || {})[prjNo] || {})[key]) || [];

  /* 월간 구독: 첫 결제일(YYYY-MM-DD)의 "일"로 매월 결제. 오늘(0시, 당일 포함) 이후부터 올해 12월까지 남은 결제일 목록.
   * 31일처럼 짧은 달에 없는 날은 그 달 말일. 첫 결제일이 내년이면 0회, 지난해면 올해 1월부터 */
  function subRemaining(dateStr) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dateStr || '').trim());
    if (!m) return { qty: 0, dates: [], day: 0 };
    const sy = +m[1], sm = +m[2], sd = +m[3];
    const t = api._now(), ty = t.getFullYear();
    const t0 = new Date(ty, t.getMonth(), t.getDate()).getTime();
    const dates = [];
    if (sy <= ty) for (let mo = (sy === ty ? sm : 1); mo <= 12; mo++) {
      const d = new Date(ty, mo - 1, Math.min(sd, new Date(ty, mo, 0).getDate()));
      if (d.getTime() >= t0) dates.push(d);
    }
    return { qty: dates.length, dates, day: sd };
  }
  const isSub = (e) => !!(e && e.sub && e.sub.date);
  /* 표시·합계에 쓰는 실제 수량/금액 (구독은 남은 횟수 × 단가) */
  const qtyOf = (e) => isSub(e) ? subRemaining(e.sub.date).qty : (F.num(e && e.qty) || 1);
  const amtOf = (e) => isSub(e) ? Math.round(qtyOf(e) * F.num(e.unit)) : F.num(e && e.amt);
  const sumOf = (list) => (list || []).reduce((s, e) => s + (amtOf(e) || 0), 0);
  /* 과제 전체 합계 { sum, count } (표에 없는 비목의 항목 포함) */
  function projectTotal(plans, prjNo) {
    const byKey = (plans || {})[prjNo] || {};
    let sum = 0, count = 0;
    for (const list of Object.values(byKey)) { sum += sumOf(list); count += list.length; }
    return { sum, count };
  }
  function find(plans, prjNo, key, id) { return listOf(plans, prjNo, key).find((e) => e.id === id) || null; }
  function upsert(plans, prjNo, key, entry) {
    if (!plans[prjNo]) plans[prjNo] = {};
    if (!plans[prjNo][key]) plans[prjNo][key] = [];
    const list = plans[prjNo][key];
    const i = list.findIndex((e) => e.id === entry.id);
    if (i >= 0) list[i] = entry; else list.push(entry);
  }
  function remove(plans, prjNo, key, id) {
    const byKey = plans[prjNo]; if (!byKey || !byKey[key]) return;
    byKey[key] = byKey[key].filter((e) => e.id !== id);
    if (!byKey[key].length) delete byKey[key];
    if (!Object.keys(byKey).length) delete plans[prjNo];
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isoToday = () => { const t = api._now(); return `${t.getFullYear()}-${F.pad2(t.getMonth() + 1)}-${F.pad2(t.getDate())}`; };

  async function load() {
    try {
      const r = await chrome.storage.local.get([KEY, HKEY, TKEY]);
      if (r[HKEY] !== undefined) { try { chrome.storage.local.remove(HKEY); } catch (e) {} }   // 이전 버전의 감춤 목록 정리
      savedAtCache = F.num(r[TKEY]) || 0;
      return r[KEY] || {};
    } catch (e) { return {}; }
  }
  async function save(plans) { await chrome.storage.local.set({ [KEY]: plans, [TKEY]: Date.now() }); }

  /* 패널(host)에 위임 리스너를 붙인다. draw() 는 렌더러 호출. state.plans 는 미리 load() 로 채워 둔다.
   * data-act: plan-open(＋ 버튼, data-prj/data-key) · plan-edit/plan-del(data-id) · plan-save · plan-cancel
   *           plan-qty(항목 줄의 수량 −/＋, data-id/data-d) · plan-step(폼의 수량 −/＋, data-d) · plan-sub(폼의 월간 구독 켜기/끄기)
   *           plan-hide(표 머리글 눈 아이콘: 과제 단위 보이기/감추기, data-prj. 기본은 감춤이고 보이기는 이 화면에서만) · plan-persist(저장 아이콘: 지금 저장, 저장됨 표시)
   * 입력칸 data-plan: name(세목) / qty(수량) / unit(단가) / amt(금액) / date(구독 첫 결제일). 수량·단가를 적으면 금액을, 금액을 적으면 단가를 맞춰 준다.
   * 구독이면 수량은 결제일에서 자동 계산되고 [data-plan-out="subqty"] 에 남은 횟수를 표시 */
  function bind(host, state, draw) {
    if (!state.plans) state.plans = {};
    if (!state.planShown) state.planShown = new Set();   // 눈 아이콘으로 펼쳐 둔 과제 (이 화면에서만)
    if (!state.planSavedAt) state.planSavedAt = savedAtCache;
    let savedTimer = 0;
    const input = (f) => host.querySelector(`[data-plan="${f}"]`);
    const focus = (f) => { const el = input(f); if (el) { el.focus(); try { el.select(); } catch (e) {} } };
    const swallow = (r) => { if (r && r.catch) r.catch(() => {}); };
    const persist = () => { try { const r = save(state.plans); if (r && r.then) r.then(() => { state.planSavedAt = Date.now(); }); swallow(r); } catch (e) {} };
    const close = () => { state.planEdit = null; state.planDraft = null; state.planError = ''; };
    const setVal = (f, v) => { const el = input(f); if (el) el.value = v; };

    /* 폼 값 연동: 수량/단가가 바뀌면 금액, 금액이 바뀌면 단가. 구독이면 수량은 결제일에서 계산 */
    function recalc(d, f) {
      if (d.sub) {
        d.qty = String(subRemaining(d.date).qty);
        const out = host.querySelector('[data-plan-out="subqty"]'); if (out) out.textContent = d.qty;
        if (f === 'date') f = 'qty';
      }
      const qty = F.num(d.qty);
      if (f === 'qty' || f === 'unit') {
        const u = F.num(d.unit);
        if (u) { d.amt = F.money(Math.round(qty * u)); setVal('amt', d.amt); }
      } else if (f === 'amt') {
        const a = F.num(d.amt);
        if (a && qty > 0) { d.unit = F.money(Math.round(a / qty)); setVal('unit', d.unit); }
      }
    }
    function submit() {
      const pe = state.planEdit; if (!pe) return;
      const d = state.planDraft || EMPTY();
      const name = String(d.name || '').trim();
      if (!name) { state.planError = '세목을 입력하세요'; draw(); focus('name'); return; }
      const entry = { id: pe.id || newId(), name, ts: Date.now() };
      if (d.sub) {   // 월간 구독: 결제일 + 단가(월 결제액). 남은 횟수가 0이어도 저장은 된다 (금액 0)
        const r = subRemaining(d.date);
        if (!r.day) { state.planError = '결제일을 고르세요'; draw(); focus('date'); return; }
        let unit = F.num(d.unit), amt = F.num(d.amt);
        if (!unit && amt && r.qty > 0) unit = Math.round(amt / r.qty);
        if (!(unit > 0)) { state.planError = '월 결제액(단가)을 입력하세요'; draw(); focus('unit'); return; }
        Object.assign(entry, { qty: r.qty, unit, amt: Math.round(r.qty * unit), sub: { date: String(d.date).trim() } });
      } else {
        let qty = F.num(d.qty); if (!(qty > 0)) qty = 1;
        let unit = F.num(d.unit), amt = F.num(d.amt);
        if (!amt && unit) amt = Math.round(qty * unit);
        if (!unit && amt) unit = Math.round(amt / qty);
        if (!(amt > 0)) { state.planError = '단가 또는 금액을 입력하세요'; draw(); focus(unit ? 'amt' : 'unit'); return; }
        Object.assign(entry, { qty, unit, amt });
      }
      upsert(state.plans, pe.prjNo, pe.key, entry);
      close(); persist(); draw();
    }

    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act^="plan-"]'); if (!btn) return;
      ev.preventDefault();
      const act = btn.dataset.act, prjNo = btn.dataset.prj, key = btn.dataset.key, id = btn.dataset.id;
      if (act === 'plan-open') {
        state.planEdit = { prjNo, key, id: null }; state.planDraft = EMPTY(); state.planError = '';
        state.expanded.add(prjNo);
        state.planShown.add(prjNo);   // 새 항목이 바로 보이도록 펼침 (기본은 감춤)
        draw(); focus('name');
      } else if (act === 'plan-edit') {
        const e = find(state.plans, prjNo, key, id); if (!e) return;
        state.planEdit = { prjNo, key, id };
        state.planDraft = { name: e.name || '', qty: String(qtyOf(e)), unit: e.unit ? F.money(e.unit) : '', amt: amtOf(e) ? F.money(amtOf(e)) : '', sub: isSub(e), date: isSub(e) ? e.sub.date : '' };
        state.planError = ''; draw(); focus('name');
      } else if (act === 'plan-cancel') { close(); draw(); }
      else if (act === 'plan-save') { submit(); }
      else if (act === 'plan-del') {
        remove(state.plans, prjNo, key, id);
        if (state.planEdit && state.planEdit.id === id) close();
        persist(); draw();
      } else if (act === 'plan-qty') {   // 항목 줄의 수량 −/＋: 수량 1 이상, 금액 = 수량 × 단가 (구독은 자동 계산이라 버튼이 없음)
        const e = find(state.plans, prjNo, key, id); if (!e || isSub(e)) return;
        const qty = Math.max(1, (F.num(e.qty) || 1) + (F.num(btn.dataset.d) || 0));
        if (qty === e.qty) return;
        const unit = F.num(e.unit) || (F.num(e.amt) && e.qty ? Math.round(F.num(e.amt) / e.qty) : 0);
        e.qty = qty; if (unit) { e.unit = unit; e.amt = Math.round(qty * unit); }
        persist(); draw();
      } else if (act === 'plan-step') {   // 폼의 수량 −/＋
        const d = state.planDraft || (state.planDraft = EMPTY());
        if (d.sub) return;
        d.qty = String(Math.max(1, (F.num(d.qty) || 0) + (F.num(btn.dataset.d) || 0)));
        setVal('qty', d.qty); recalc(d, 'qty');
      } else if (act === 'plan-sub') {   // 폼의 월간 구독 켜기/끄기. 켜면 결제일 기본값은 오늘
        const d = state.planDraft || (state.planDraft = EMPTY());
        d.sub = !d.sub;
        if (d.sub) { if (!d.date) d.date = isoToday(); recalc(d, 'date'); }
        else if (!(F.num(d.qty) > 0)) d.qty = '1';
        state.planError = ''; draw(); focus(d.sub ? 'date' : 'unit');
      } else if (act === 'plan-hide') {   // 과제 단위 보이기/감추기 (저장하지 않음). 감출 때 열린 폼은 닫는다
        if (state.planShown.has(prjNo)) { state.planShown.delete(prjNo); if (state.planEdit && state.planEdit.prjNo === prjNo) close(); }
        else state.planShown.add(prjNo);
        draw();
      } else if (act === 'plan-persist') {   // 저장 아이콘: 지금 저장하고 "저장됨"을 3초 보여 준다 (자동 저장과 같은 저장소)
        const show = (error) => {
          state.planSaved = { prjNo, error: !!error }; if (!error) state.planSavedAt = Date.now(); draw();
          clearTimeout(savedTimer); savedTimer = setTimeout(() => { state.planSaved = null; draw(); }, 3000);
        };
        try { const r = save(state.plans); if (r && r.then) r.then(() => show(false), () => show(true)); else show(false); }
        catch (e) { show(true); }
      }
    });
    host.addEventListener('input', (ev) => {
      const el = ev.target; const f = el && el.dataset ? el.dataset.plan : null; if (!f) return;
      const d = state.planDraft || (state.planDraft = EMPTY());
      d[f] = el.value; recalc(d, f);
    });
    host.addEventListener('keydown', (ev) => {
      const el = ev.target; if (!el || !el.dataset || !el.dataset.plan) return;
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(); draw(); }
      else if (el.dataset.plan === 'qty' && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {   // 수량 칸에서 ↑/↓ 로 증감
        ev.preventDefault();
        const d = state.planDraft || (state.planDraft = EMPTY());
        d.qty = String(Math.max(1, (F.num(d.qty) || 0) + (ev.key === 'ArrowUp' ? 1 : -1)));
        el.value = d.qty; recalc(d, 'qty');
      }
    });
    // 단가·금액 칸은 포커스를 벗어나면 천 단위 구분 기호로 정리
    host.addEventListener('focusout', (ev) => {
      const el = ev.target; const f = el && el.dataset ? el.dataset.plan : null;
      if (f !== 'unit' && f !== 'amt') return;
      const v = F.num(el.value); el.value = v ? F.money(v) : '';
      if (state.planDraft) state.planDraft[f] = el.value;
    });
    // 다른 창(팝업 ↔ eClass)에서 바꾼 값 반영
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        try {
          if (area !== 'local') return;
          if (ch[TKEY]) state.planSavedAt = F.num(ch[TKEY].newValue) || state.planSavedAt;
          if (ch[KEY]) { state.plans = ch[KEY].newValue || {}; draw(); }
        } catch (e) {}
      });
    } catch (e) {}
  }

  Object.assign(api, { KEY, itemKey, keyName, listOf, sumOf, projectTotal, find, load, save, bind, subRemaining, isSub, qtyOf, amtOf });
  g.KRX_PLAN = api;
})(typeof self !== 'undefined' ? self : this);
