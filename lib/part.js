/* 과제 참여율 구역의 "예비 참여율(참여 계획)" 저장소 + 입력 처리. eClass 콘텐츠스크립트 / 팝업 공용
 * storage.local.plannedParticipation = [ { id, prjNo(ERP 과제번호, ERP 에 아직 없는 과제면 ''), prjNm, rate(%), st('YYYY-MM-DD'), end('YYYY-MM-DD', ''=미정), ts } ]
 * 계획이 있는 기간에는 그 과제의 참여율을 ERP 계상률 대신 계획 값으로 보고, ERP 에 없는 과제의 계획은 그 기간에 더한다.
 * 어떤 날의 계획 반영 합계 = Σ 표의 과제별(그날 계획이 있으면 계획 참여율, 없으면 그날 유효한 ERP 계상률) + Σ 그날 유효한 표 밖 과제 계획
 * 기간은 달력(state.partCal: { ym: yyyyMM, pick: 'st'|'end' })에서 시작일 → 종료일 순서로 고른다. 시작일보다 앞 날짜를 고르면 시작일을 바꾼다.
 * R&D ERP 에는 저장하지 않고 이 브라우저(확장 저장소)에만 남는다. 렌더러(render.js)는 state.partPlans / partEdit / partDraft / partError / partCal 을 읽는다 */
(function (g) {
  const F = g.KRX_FMT;
  const KEY = 'plannedParticipation';
  const PART_KEY = '__participation';   // render.js 의 참여율 표 펼침 키 (state.expanded)
  const api = {};
  api._now = () => new Date();   // 테스트에서 바꿔 끼움
  const EMPTY = () => ({ name: '', rate: '', st: '', end: '' });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const d8 = (s) => F.digits(s).slice(0, 8);   // 'YYYY-MM-DD' / yyyyMMdd → yyyyMMdd (없으면 '')
  const iso = (s) => { const d = d8(s); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : ''; };
  const today8 = () => F.ymd(api._now());
  const covers = (e, day) => { const s = d8(e && e.st), n = d8(e && e.end); return !!s && s <= day && (!n || day <= n); };
  const rateOf = (e) => F.num(e && e.rate);
  const r2 = (v) => Math.round(v * 100) / 100;

  async function load() { try { const r = await chrome.storage.local.get(KEY); return Array.isArray(r[KEY]) ? r[KEY] : []; } catch (e) { return []; } }
  async function save(list) { await chrome.storage.local.set({ [KEY]: list }); }

  const listOf = (plans, prjNo) => prjNo ? (plans || []).filter((e) => e.prjNo === prjNo) : [];
  /* 참여율 표에 없는 과제의 계획: ERP 에 아직 없는 과제(prjNo '') 또는 본인이 참여인력에 없는 과제 */
  const others = (plans, items) => { const has = new Set((items || []).map((x) => x.prjNo)); return (plans || []).filter((e) => !e.prjNo || !has.has(e.prjNo)); };
  const groupKey = (e) => e.prjNo || ('nm:' + String(e.prjNm || '').trim());
  /* 같은 날 계획이 여럿이면 시작이 가장 늦은 것 (ERP 계상률 이력과 같은 규칙) */
  const pickPlan = (list, day) => (list || []).filter((e) => covers(e, day)).sort((a, b) => d8(b.st).localeCompare(d8(a.st)) || (b.ts || 0) - (a.ts || 0))[0] || null;
  /* ERP 계상률기준 행(summarizeParticipation 의 item.rows)에서 그날 유효한 참여율:
   * 연구수당 성격·계상률 체크제외 행 제외, 종류별로 시작이 가장 늦은 행 하나씩 합 (rnd-api summarizeParticipation 의 "현재" 행 규칙을 임의의 날짜로) */
  function erpRateAt(item, day) {
    const rows = ((item && item.rows) || []).filter((r) => r && r.src === 'info' && r.rate != null && !r.allowance && !r.rateExcluded && (!r.st || r.st <= day) && (!r.end || day <= r.end));
    const byKind = new Map();
    for (const r of rows) {
      const k = r.kind || '', cur = byKind.get(k);
      if (!cur || String(r.st || '').localeCompare(String(cur.st || '')) > 0 || (String(r.st || '') === String(cur.st || '') && (r.idx || 0) > (cur.idx || 0))) byKind.set(k, r);
    }
    let s = 0; for (const r of byKind.values()) s += F.num(r.rate);
    return r2(s);
  }
  /* 그날의 계획 반영 참여율 { total, parts: [{ prjNo, prjNm, rate, planned }] } */
  function totalAt(items, plans, day) {
    const parts = [];
    for (const x of items || []) {
      const p = pickPlan(listOf(plans, x.prjNo), day);
      parts.push({ prjNo: x.prjNo, prjNm: x.prjNm, rate: p ? rateOf(p) : erpRateAt(x, day), planned: !!p });
    }
    const grp = new Map();
    for (const e of others(plans, items)) { const k = groupKey(e); if (!grp.has(k)) grp.set(k, []); grp.get(k).push(e); }
    for (const list of grp.values()) { const p = pickPlan(list, day); if (p) parts.push({ prjNo: p.prjNo, prjNm: p.prjNm, rate: rateOf(p), planned: true }); }
    return { total: r2(parts.reduce((s, x) => s + x.rate, 0)), parts };
  }
  /* 달력 한 달: ym(yyyyMM) → 6주 × 7일 [{ day: yyyyMMdd, d: 일, out: 다른 달 }] (일요일 시작) */
  function monthGrid(ym) {
    const y = +String(ym).slice(0, 4), m = +String(ym).slice(4, 6);
    const first = new Date(y, m - 1, 1);
    const cells = [];
    for (let i = 0; i < 42; i++) { const d = new Date(y, m - 1, 1 - first.getDay() + i); cells.push({ day: F.ymd(d), d: d.getDate(), out: d.getMonth() !== m - 1 }); }
    return cells;
  }
  const addMonth = (ym, n) => F.ymd(new Date(+String(ym).slice(0, 4), +String(ym).slice(4, 6) - 1 + n, 1)).slice(0, 6);
  /* 종료일 프리셋: 'year' = 시작일(없으면 오늘)이 속한 해의 12월 31일, 그 외는 yyyyMMdd */
  const presetEnd = (v, st) => v === 'year' ? (d8(st) || today8()).slice(0, 4) + '1231' : d8(v);

  /* 패널(host)에 위임 리스너를 붙인다. draw() 는 렌더러 호출. state.partPlans 는 미리 load() 로 채워 둔다.
   * data-act: part-open(과제 행의 ＋, data-prj/data-nm/data-end) · part-new(표 밖 과제 계획 ＋) · part-edit/part-del(data-id) · part-save · part-cancel
   *           part-cal(기간 버튼: 달력 열기/닫기) · part-cal-nav(data-d 달 이동) · part-cal-day(data-day) · part-cal-set(data-st='today' | data-end='year'|yyyyMMdd) · part-cal-clear · part-cal-close
   * 입력칸 data-part: name(표 밖 과제의 과제명) / rate(참여율 %) */
  function bind(host, state, draw) {
    if (!Array.isArray(state.partPlans)) state.partPlans = [];
    const input = (f) => host.querySelector(`[data-part="${f}"]`);
    const focus = (f) => { const el = input(f); if (el) { el.focus(); try { el.select(); } catch (e) {} } };
    const persist = () => { try { const r = save(state.partPlans); if (r && r.catch) r.catch(() => {}); } catch (e) {} };
    const close = () => { state.partEdit = null; state.partDraft = null; state.partError = ''; state.partCal = null; };
    const draft = () => state.partDraft || (state.partDraft = EMPTY());
    const openCal = (pick) => {
      const d = draft(), p = pick || (d8(d.st) ? 'end' : 'st');
      const base = d8(p === 'end' ? (d.end || d.st) : d.st) || today8();
      state.partCal = { ym: base.slice(0, 6), pick: p };
    };
    /* 패널에 있는 과제 목록 (표 밖 과제 폼의 과제명을 과제번호에 연결) */
    const candidates = () => { const d = state.data || {}; return (d.projects || []).concat((d.participation && d.participation.items) || []); };

    function pickDay(day) {
      const d = draft(), c = state.partCal || (state.partCal = { ym: day.slice(0, 6), pick: 'st' });
      if (c.pick === 'st' || !d8(d.st)) { d.st = iso(day); if (d8(d.end) && d8(d.end) < day) d.end = ''; c.pick = 'end'; }
      else if (day < d8(d.st)) { d.st = iso(day); c.pick = 'end'; }   // 시작일보다 앞을 고르면 시작일을 바꾼다
      else { d.end = iso(day); state.partCal = null; }
      state.partError = '';
    }
    function submit() {
      const pe = state.partEdit; if (!pe) return;
      const d = draft();
      const name = String(d.name || '').trim(), rate = F.num(d.rate);
      if (pe.free && !name) { state.partError = '과제명을 입력하세요'; draw(); focus('name'); return; }
      if (!(rate > 0) || rate > 100) { state.partError = '참여율(1~100%)을 입력하세요'; draw(); focus('rate'); return; }
      if (!d8(d.st)) { state.partError = '시작일을 고르세요'; openCal('st'); draw(); return; }
      if (d8(d.end) && d8(d.end) < d8(d.st)) { state.partError = '종료일이 시작일보다 앞입니다'; openCal('end'); draw(); return; }
      let prjNo = pe.prjNo || '', prjNm = pe.prjNm || '';
      if (pe.free) {   // 적은 과제명이 패널의 과제 목록에 있으면 과제번호를 붙인다 (뒤에 참여인력에 오르면 그 과제 줄 밑으로 옮겨감)
        const hit = candidates().find((p) => p && (String(p.prjNm || '').trim() === name || p.prjNo === name));
        prjNo = hit ? hit.prjNo : ''; prjNm = hit ? (hit.prjNm || name) : name;
      }
      const entry = { id: pe.id || newId(), prjNo, prjNm, rate, st: iso(d.st), end: iso(d.end), ts: Date.now() };
      const i = state.partPlans.findIndex((e) => e.id === entry.id);
      if (i >= 0) state.partPlans[i] = entry; else state.partPlans.push(entry);
      close(); persist(); draw();
    }

    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-act^="part-"]');
      // 달력 밖 클릭 → 달력만 닫기 (다른 동작 버튼이면 그 처리에서 다시 그린다)
      if (state.partCal && !ev.target.closest('.krext-cal') && !(btn && /^part-cal/.test(btn.dataset.act))) { state.partCal = null; if (!btn) draw(); }
      if (!btn) return;
      ev.preventDefault();
      const act = btn.dataset.act, id = btn.dataset.id;
      if (act === 'part-open' || act === 'part-new') {
        state.partEdit = { id: null, prjNo: btn.dataset.prj || '', prjNm: btn.dataset.nm || '', endDt: d8(btn.dataset.end), free: act === 'part-new' };
        state.partDraft = EMPTY(); state.partError = ''; state.partCal = null;
        if (state.expanded && state.expanded.add) state.expanded.add(PART_KEY);
        draw(); focus(state.partEdit.free ? 'name' : 'rate');
      } else if (act === 'part-edit') {
        const e = state.partPlans.find((x) => x.id === id); if (!e) return;
        state.partEdit = { id, prjNo: e.prjNo || '', prjNm: e.prjNm || '', endDt: d8(btn.dataset.end), free: btn.dataset.free === '1' || !e.prjNo };
        state.partDraft = { name: e.prjNm || '', rate: e.rate ? String(e.rate) : '', st: e.st || '', end: e.end || '' };
        state.partError = ''; state.partCal = null; draw(); focus('rate');
      } else if (act === 'part-cancel') { close(); draw(); }
      else if (act === 'part-save') { submit(); }
      else if (act === 'part-del') {
        state.partPlans = state.partPlans.filter((e) => e.id !== id);
        if (state.partEdit && state.partEdit.id === id) close();
        persist(); draw();
      } else if (act === 'part-cal') { if (state.partCal) state.partCal = null; else openCal(btn.dataset.pick); draw(); }
      else if (act === 'part-cal-nav') { if (state.partCal) { state.partCal.ym = addMonth(state.partCal.ym, F.num(btn.dataset.d) || 0); draw(); } }
      else if (act === 'part-cal-day') { if (/^\d{8}$/.test(btn.dataset.day || '')) { pickDay(btn.dataset.day); draw(); } }
      else if (act === 'part-cal-set') {   // 프리셋: 오늘부터(시작일) / 연말까지·과제 종료까지(종료일)
        const d = draft(), c = state.partCal || (state.partCal = { ym: today8().slice(0, 6), pick: 'st' });
        state.partError = '';
        if (btn.dataset.st) { d.st = iso(btn.dataset.st === 'today' ? today8() : btn.dataset.st); if (d8(d.end) && d8(d.end) < d8(d.st)) d.end = ''; c.pick = 'end'; c.ym = d8(d.st).slice(0, 6); }
        else if (btn.dataset.end) {
          const v = presetEnd(btn.dataset.end, d.st);
          if (d8(d.st) && v < d8(d.st)) state.partError = '종료일이 시작일보다 앞입니다';
          else { d.end = iso(v); if (d8(d.st)) state.partCal = null; else { c.pick = 'st'; state.partError = '시작일을 고르세요'; } }
        }
        draw();
      }
      else if (act === 'part-cal-clear') { const d = draft(); d.st = ''; d.end = ''; if (state.partCal) state.partCal.pick = 'st'; state.partError = ''; draw(); }
      else if (act === 'part-cal-close') { state.partCal = null; draw(); }
    });
    host.addEventListener('input', (ev) => {
      const el = ev.target; const f = el && el.dataset ? el.dataset.part : null; if (!f) return;
      draft()[f] = el.value;
    });
    host.addEventListener('keydown', (ev) => {
      const el = ev.target; if (!el || !el.dataset || !el.dataset.part) return;
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); if (state.partCal) state.partCal = null; else close(); draw(); }
    });
    // 패널 밖을 클릭하면 달력 닫기
    try { document.addEventListener('click', (ev) => { if (state.partCal && !host.contains(ev.target)) { state.partCal = null; draw(); } }, true); } catch (e) {}
    // 다른 창(팝업 ↔ eClass)에서 바꾼 값 반영
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        try { if (area === 'local' && ch[KEY]) { state.partPlans = Array.isArray(ch[KEY].newValue) ? ch[KEY].newValue : []; draw(); } } catch (e) {}
      });
    } catch (e) {}
  }

  Object.assign(api, { KEY, PART_KEY, load, save, bind, listOf, others, pickPlan, erpRateAt, totalAt, monthGrid, addMonth, covers, d8, iso, presetEnd });
  g.KRX_PART = api;
})(typeof self !== 'undefined' ? self : this);
