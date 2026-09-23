/* hr.krs.co.kr (isolated world, 모든 프레임): HR System 급여명세서 수집 → R&D ERP 현황 패널의 "급여·연구수당" 구역
 * 1) MAIN world 훅(hr-hook.js)이 보낸 JSON API 캡처를 백그라운드 캡처 로그로 전달 (급여 API 파악용)
 * 2) 급여명세서 화면(보상 › 나의 급여정보 › 급여명세서)에서
 *    - 급여지급내역 목록(지급일자 · 내용 · 소득합계)과
 *    - 선택된 달의 지급내역(소득명 · 금액)을 DOM 에서 읽어 백그라운드(storage.local.hrPay)에 저장한다.
 *    설정 hr.autoScan 이면 목록의 각 달(아직 저장되지 않았거나 소득합계가 달라진 달)을 차례로 클릭해 지급내역을 모아 오고, 끝나면 원래 선택을 되돌린다.
 *    화면 요소 ID 를 모르므로 문구("급여지급내역", "지급내역", 날짜 형식, 숫자)로 표와 행을 찾는다. 행 클릭에 화면이 반응하지 않으면 멈추고, 사용자가 달을 직접 클릭할 때마다 반영한다.
 * 3) 직급(P1~P4 등) 표시가 있으면 함께 기록 (연구수당 한도 = 기본연봉 × 12 × 직급 비율), 사번/성명도 있으면 기록
 * 확장 재로드 후 다시 주입되면 이전 스크립트는 스스로 멈춘다 (rnd-claim.js 와 같은 방식) */
(() => {
  const RESTART_EVT = 'krext-hr-restart';
  document.dispatchEvent(new Event(RESTART_EVT));
  let stopped = false;
  document.addEventListener(RESTART_EVT, () => { stopped = true; teardown(); });

  const S = self.KRX_SETTINGS;
  const send = (msg) => { try { const p = chrome.runtime.sendMessage(msg); if (p && p.catch) p.catch(() => {}); return p; } catch (e) {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const text = (el) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const numOf = (t) => { const s = String(t == null ? '' : t).trim(); return /^-?[\d,]+$/.test(s) && /\d/.test(s) ? Number(s.replace(/,/g, '')) : null; };
  const visible = (el) => !!(el && el.getClientRects && el.getClientRects().length);
  const DATE_RE = /^\d{4}[-./]\d{2}[-./]\d{2}$/;
  const SKIP_TAG = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|IFRAME)$/;
  const INLINE = /^(BR|IMG|I|EM|B|STRONG|SPAN|FONT|U|SUP|SUB|SMALL|LABEL|A)$/;
  const log = (...a) => { try { console.debug('[krext hr]', ...a); } catch (e) {} };

  /* ---------- 1) API 캡처 전달 ---------- */
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__krext !== 'hrapi') return;
    send({ type: 'jctCaptured', entry: ev.data.entry });
  });

  /* ---------- 상태 / 설정 ---------- */
  let cfg = null;               // settings.hr
  let known = {};               // storage.hrPay.years (이미 저장된 달 → 자동 수집 대상 판단)
  let lastClicked = null;       // 마지막으로 클릭된(사용자 또는 자동 수집) 목록 행 key → 지급내역 귀속
  let lastSig = '';             // 마지막으로 보낸 화면 읽기 결과 (중복 전송 방지)
  let lastGrade = '';
  let scanning = false;
  const scannedYears = new Set();   // 이 페이지 로드에서 자동 수집을 이미 시도한 연도
  let observer = null, timer = null, toastTimer = null;

  async function loadCfg() {
    try { const s = await S.load(); cfg = Object.assign({}, S.DEFAULTS.hr || {}, s.hr || {}); } catch (e) { cfg = null; }
    try { const hp = (await chrome.storage.local.get('hrPay')).hrPay; known = (hp && hp.years) || {}; } catch (e) {}
    if (!stopped) schedule(300);
  }
  try { chrome.storage.onChanged.addListener((ch, area) => { if ((area === 'sync' || area === 'local') && ch.settings) loadCfg(); }); } catch (e) {}

  /* ---------- 토스트 ---------- */
  const CSS = `.krext-toast{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#222;color:#fff;padding:8px 12px;border-radius:6px;font:13px/1.4 "Malgun Gothic","맑은 고딕",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:.95;max-width:60vw;white-space:pre-wrap}`;
  function toast(msg, ms) {
    try {
      if (!document.body) return;
      if (!document.getElementById('krext-hr-style')) { const st = document.createElement('style'); st.id = 'krext-hr-style'; st.textContent = CSS; document.head.appendChild(st); }
      let el = document.getElementById('krext-hr-toast');
      if (!el) { el = document.createElement('div'); el.id = 'krext-hr-toast'; el.className = 'krext-toast'; document.body.appendChild(el); }
      el.textContent = msg; el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
    } catch (e) {}
  }
  function teardown() {
    try { if (observer) observer.disconnect(); } catch (e) {}
    clearTimeout(timer); clearTimeout(toastTimer);
    for (const id of ['krext-hr-toast', 'krext-hr-style']) { const el = document.getElementById(id); if (el) el.remove(); }
  }

  /* ---------- DOM 읽기 도우미 ----------
   * leaf: 자식 요소가 없는 요소, 또는 자식이 모두 인라인 태그(span, b …)이고 자신의 직접 텍스트가 있는 요소. 표(table) 든 div 그리드든 셀 하나가 leaf 가 된다 */
  function isLeaf(el) {
    const kids = el.children;
    if (!kids.length) return true;
    for (const c of kids) if (!INLINE.test(c.tagName) || c.children.length) return false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }
  function leaves(root) {
    const out = [];
    const walk = (el) => {
      if (SKIP_TAG.test(el.tagName)) return;
      if (isLeaf(el)) { if (text(el)) out.push(el); return; }
      for (const c of el.children) walk(c);
    };
    if (root) walk(root);
    return out;
  }
  /* 문구로 제목 leaf 찾기 (앞부분 일치, 짧은 텍스트만: "급여지급내역 총 12건" 처럼 건수가 붙어 있을 수 있음) */
  function heading(re) { return leaves(document.body).find((l) => { const t = text(l); return t.length < 40 && re.test(t) && visible(l); }) || null; }
  const countIn = (t) => { const m = /총\s*(\d+)\s*건/.exec(t || ''); return m ? Number(m[1]) : null; };

  /* ---------- 2-a) 급여지급내역 목록 ---------- */
  /* 목록 범위: "급여지급내역" 제목에서 위로 올라가며 날짜 leaf 가 들어 있는 첫 조상 */
  function listScope() {
    const h = heading(/^급여지급내역/); if (!h) return null;
    let node = h.parentElement;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      if (leaves(node).some((l) => DATE_RE.test(text(l)))) return { el: node, total: countIn(text(h)) || countIn(text(node.firstElementChild)) };
      node = node.parentElement;
    }
    return null;
  }
  const countDates = (root) => { let n = 0; for (const l of leaves(root)) if (DATE_RE.test(text(l)) && ++n >= 2) break; return n; };
  /* 날짜 leaf 가 속한 "행": tr / role=row, 없으면 날짜 leaf 가 둘 이상인 조상(=행 묶음)의 바로 아래 노드 */
  function rowOf(leaf, scope) {
    const tr = leaf.closest('tr,[role=row]');
    if (tr && scope.contains(tr)) return tr;
    let node = leaf;
    for (let i = 0; i < 8 && node.parentElement && node.parentElement !== document.body; i++) {
      const p = node.parentElement;
      if (countDates(p) >= 2) return node;
      if (p === scope) return node;   // 목록이 한 행뿐이면 범위 바로 아래 노드
      node = p;
    }
    return null;
  }
  /* 셀 문자열 배열 → { date, title, total } : 지급일자 다음 칸이 내용, 그 뒤 첫 숫자가 소득합계 */
  function rowShape(cells) {
    const di = cells.findIndex((c) => DATE_RE.test(c));
    if (di < 0) return null;
    let title = cells[di + 1], rest = cells.slice(di + 2);
    if (!title || numOf(title) != null || DATE_RE.test(title)) {   // 내용 칸이 날짜 앞에 있는 배치
      title = cells[di - 1]; rest = cells.slice(di + 1);
      if (!title || numOf(title) != null || /^no\.?$/i.test(title)) return null;
    }
    const total = rest.map(numOf).find((n) => n != null);
    if (total == null) return null;
    return { date: cells[di].replace(/[./]/g, '-'), title, total };
  }
  function listRows(scope) {
    const rows = []; const seen = new Set();
    for (const leaf of leaves(scope.el)) {
      if (!DATE_RE.test(text(leaf)) || !visible(leaf)) continue;
      const row = rowOf(leaf, scope.el);
      if (!row || seen.has(row)) continue;
      seen.add(row);
      const ls = leaves(row); const cells = ls.map(text).filter(Boolean);
      const shape = rowShape(cells); if (!shape) continue;
      const cell = ls.find((l) => text(l) === shape.title) || leaf;
      rows.push(Object.assign({ el: row, cell, key: shape.date + '|' + shape.title, year: shape.date.slice(0, 4) }, shape));
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }

  /* ---------- 2-b) 선택된 달의 지급내역 (소득명 · 금액) ---------- */
  /* 범위: "지급내역" 제목(급여지급내역 제외)에서 위로 올라가며 소득명/합계가 들어 있고 공제내역·추가과세소득은 들어 있지 않은 조상. 없으면 기본연봉 leaf 의 표 */
  function detailScope() {
    const base = norm(cfg && cfg.baseItem || '기본연봉');
    for (const h of leaves(document.body).filter((l) => /^지급내역/.test(text(l)) && text(l).length < 30 && visible(l))) {
      let node = h.parentElement;
      for (let i = 0; i < 6 && node && node !== document.body; i++) {
        const t = node.textContent || '';
        if (/공제내역|추가과세소득|급여지급내역/.test(t)) break;
        if (/소득명|합\s*계/.test(t) && (/금액/.test(t) || norm(t).includes(base))) return node;
        node = node.parentElement;
      }
    }
    const b = leaves(document.body).find((l) => norm(text(l)) === base && visible(l));
    if (b) {
      const tbl = b.closest('table,[role=grid],[role=table],[role=treegrid]');
      if (tbl) return tbl;
      let node = b; for (let i = 0; i < 6 && node.parentElement && node.parentElement !== document.body; i++) { node = node.parentElement; if (/합\s*계/.test(node.textContent || '')) return node; }
    }
    return null;
  }
  function readDetail() {
    const scope = detailScope(); if (!scope) return null;
    const items = {}, order = []; let total = null;
    const push = (name, amt) => { if (!(name in items)) order.push(name); items[name] = (items[name] || 0) + amt; };
    const take = (name, amt) => { if (/^합\s*계$/.test(name)) total = amt; else if (!/^(소득명|금액|과세\s*여부|이체\s*여부)$/.test(name)) push(name, amt); };
    const rows = Array.from(scope.querySelectorAll('tr,[role=row]'));
    if (rows.length) {
      for (const r of rows) {
        const cells = leaves(r).map(text).filter(Boolean);
        if (cells.length < 2 || numOf(cells[0]) != null) continue;
        const amt = cells.slice(1).map(numOf).find((n) => n != null);
        if (amt != null) take(cells[0], amt);
      }
    }
    if (!order.length) {   // 표가 아니면: (이름, 숫자) 순서쌍으로
      const ls = leaves(scope).map(text).filter(Boolean);
      for (let i = 0; i < ls.length - 1; i++) {
        const name = ls[i], amt = numOf(ls[i + 1]);
        if (amt == null || numOf(name) != null || /^[YN]$/.test(name) || DATE_RE.test(name) || /총\s*\d+\s*건/.test(name)) continue;
        take(name, amt); i++;
      }
    }
    if (!order.length) return null;
    const sum = order.reduce((s, k) => s + items[k], 0);
    if (total == null) total = sum;
    return { items, order, total, sum, sig: order.map((k) => k + ':' + items[k]).join('|') + '#' + total };
  }

  /* 지급내역이 어느 행의 것인지: 마지막 클릭 행 → 선택 표시 클래스(한 행만) → 소득합계가 같은 유일한 행 → 첫 행(처음 열면 최신 달이 선택됨) */
  function selectedRow(rows, det) {
    if (lastClicked) { const r = rows.find((x) => x.key === lastClicked); if (r) return r; }
    const SEL = /select|active|focus|current|chosen|highlight|(^|\s)on(\s|$)/i;
    const cls = (el) => (el && typeof el.className === 'string' ? el.className : '') + (el && el.getAttribute && el.getAttribute('aria-selected') === 'true' ? ' selected' : '');
    const byCls = rows.filter((r) => SEL.test(cls(r.el)) || SEL.test(cls(r.cell)) || SEL.test(cls(r.cell.parentElement)));
    if (byCls.length === 1) return byCls[0];
    if (!det) return null;
    const m = rows.filter((r) => r.total === det.total);
    if (m.length === 1) return m[0];
    if (m.length > 1 && m[0] === rows[0]) return rows[0];
    return null;
  }
  const monthOf = (r, d) => ({ year: r.year, key: r.key, date: r.date, title: r.title, total: r.total, detailTotal: d.total, mismatch: d.total !== r.total, items: d.items, order: d.order, ts: Date.now() });

  /* ---------- 3) 직급 / 사번 ---------- */
  function detectGrade() {
    const near = (el, word) => { let n = el; for (let k = 0; k < 4 && n; k++) { if ((n.textContent || '').includes(word)) return true; n = n.parentElement; } return false; };
    const pick = (t) => { const m = /(?:^|[^A-Z0-9])(P[1-9])(?![0-9])/i.exec(String(t || '')); return m ? m[1].toUpperCase() : ''; };
    for (const l of leaves(document.body)) {
      const t = text(l); if (t.length > 24) continue;
      const g = pick(t); if (g && near(l, '직급')) return g;
    }
    for (const inp of document.querySelectorAll('input,select')) {
      const v = inp.tagName === 'SELECT' ? (inp.selectedOptions[0] ? inp.selectedOptions[0].textContent : '') : inp.value;
      const g = pick(String(v || '').trim().slice(0, 24)); if (g && near(inp, '직급')) return g;
    }
    return '';
  }
  function detectUser() {
    const out = {};
    const lab = leaves(document.body).find((l) => /^사번(\s*\/\s*성명)?$/.test(text(l)));
    let node = lab;
    for (let k = 0; k < 4 && node && !out.empNo; k++) {
      node = node.parentElement; if (!node) break;
      // 라벨 뒤에 오는 입력칸만 (앞의 기준년도 "2026" 같은 값 제외), 연도처럼 보이는 4자리는 사번으로 보지 않음
      const vals = Array.from(node.querySelectorAll('input')).filter((i) => lab.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING)
        .map((i) => String(i.value || '').trim()).filter(Boolean);
      const emp = vals.find((v) => /^\d{4,8}$/.test(v) && !/^(19|20)\d{2}$/.test(v)); const nm = vals.find((v) => /^[가-힣]{2,6}$/.test(v));
      if (emp) { out.empNo = emp; if (nm) out.name = nm; }
    }
    if (!out.empNo) { const m = /(\d{4,8})\s*\|\s*[가-힣]/.exec((document.body && document.body.innerText) || ''); if (m) out.empNo = m[1]; }   // 좌측 프로필 "11115|팀명"
    return out;
  }

  /* ---------- 저장 (백그라운드가 storage.local.hrPay 에 합치고 패널 캐시에 반영) ---------- */
  function sendPatch(patch) {
    for (const m of patch.months || []) {
      known[m.year] = known[m.year] || { months: {} };
      known[m.year].months = known[m.year].months || {};
      known[m.year].months[m.key] = { total: m.total, mismatch: m.mismatch };
    }
    send({ type: 'hrPay', patch });
  }

  /* ---------- 행 클릭 (그리드가 좌표로 행을 찾는 경우를 위해 셀 중앙 좌표를 넣는다) ---------- */
  function clickRow(r) {
    const el = (r.cell && r.cell.isConnected) ? r.cell : ((r.el && r.el.isConnected) ? r.el : null);
    if (!el) return false;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    const rc = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, view: window, clientX: rc.left + Math.min(rc.width / 2, 24), clientY: rc.top + rc.height / 2, button: 0 };
    const fire = (type, extra) => {
      const init = Object.assign({}, base, extra || {});
      const pointer = /^pointer/.test(type);
      if (pointer && typeof PointerEvent !== 'function') return;   // PointerEvent 가 없는 환경이면 마우스 이벤트만
      const ev = pointer ? new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, init)) : new MouseEvent(type, init);
      el.dispatchEvent(ev);
    };
    fire('pointerdown', { buttons: 1 }); fire('mousedown', { buttons: 1 });
    fire('pointerup'); fire('mouseup'); fire('click');
    return true;   // 어느 행이 선택됐는지(lastClicked)는 지급내역이 실제로 바뀐 것을 확인한 뒤 호출 쪽에서 기록
  }
  async function waitDetail(r, prevSig) {
    const t0 = Date.now();
    let d = null;
    while (Date.now() - t0 < 3500) {
      await sleep(150);
      d = readDetail();
      if (d && d.total === r.total && (d.sig !== prevSig || Date.now() - t0 > 900)) return d;
    }
    return d && d.total === r.total ? d : null;
  }

  /* ---------- 자동 수집: 아직 저장되지 않은(또는 소득합계가 달라진) 달을 차례로 클릭 ---------- */
  /* 목록의 스크롤 컨테이너 (가상 스크롤 그리드는 보이는 행만 DOM 에 두므로 위·아래로 움직여 나머지 행을 드러내야 함) */
  function scrollBox(el) {
    let n = el;
    while (n && n !== document.body && n !== document.documentElement) {
      if (n.scrollHeight > n.clientHeight + 2) {
        const o = getComputedStyle(n).overflowY;
        if (o === 'auto' || o === 'scroll' || o === 'overlay') return n;
      }
      n = n.parentElement;
    }
    return null;
  }
  const setScroll = async (sc, top) => { if (!sc || sc.scrollTop === top) return; sc.scrollTop = top; try { sc.dispatchEvent(new Event('scroll')); } catch (e) {} await sleep(600); };

  async function autoScan(scope, rows, year, det) {
    const months = (known[year] && known[year].months) || {};
    const need = (r) => { const m = months[r.key]; return !m || m.total !== r.total || m.mismatch; };
    // "총 N건"보다 DOM 행이 적으면 가상 스크롤 → 현재 위치·맨 위·중간·맨 아래로 움직이며 읽는다
    const sc = (scope.total && rows.length < scope.total) ? scrollBox(rows[0].el) : null;
    if (!sc && !rows.some(need)) return;
    const passes = sc ? Array.from(new Set([sc.scrollTop, 0, Math.floor(sc.scrollHeight / 2), sc.scrollHeight])) : [null];
    scanning = true;
    const original = selectedRow(rows, det) || rows[0];
    const origTop = sc ? sc.scrollTop : 0;
    let fails = 0, done = 0, tried = 0; const notes = []; const seen = new Set();
    const union = new Map(rows.map((r) => [r.key, r]));   // 스크롤로 드러난 행까지 합친 목록 (미수집 달 표시용)
    toast(`급여명세서 지급내역을 읽는 중… (총 ${scope.total || rows.length}건)`, 6000);
    try {
      outer: for (const top of passes) {
        if (top != null) await setScroll(sc, top);
        const cur = listRows(scope);
        for (const r of cur) union.set(r.key, r);
        for (const r0 of cur.filter((r) => r.year === year && !seen.has(r.key) && need(r))) {
          if (stopped) return;
          seen.add(r0.key); tried++;
          const r = listRows(scope).find((x) => x.key === r0.key) || r0;   // 다시 그려졌을 수 있으니 key 로 다시 찾음
          const before = readDetail();
          if (!clickRow(r)) { fails++; continue; }
          const d = await waitDetail(r, before ? before.sig : '');
          if (!d) {   // 화면이 반응하지 않음 → 선택 행 기록은 그대로 두어 이전 달의 지급내역이 이 달로 잘못 귀속되지 않게 함
            fails++;
            if (fails >= 2) { notes.push('행을 클릭해도 지급내역이 바뀌지 않아 자동 수집을 멈췄습니다. 급여지급내역의 각 달을 직접 클릭하면 반영됩니다.'); break outer; }
            continue;
          }
          fails = 0; done++; lastClicked = r.key;
          sendPatch({ ts: Date.now(), page: location.pathname, months: [monthOf(r, d)] });
          toast(`급여 지급내역 읽는 중… ${done}건`, 6000);
        }
      }
    } finally {
      if (sc) await setScroll(sc, origTop);
      if (original && done) {   // 원래 선택으로 되돌림 (화면이 클릭에 반응한 것을 확인했으므로 선택 행도 그 달로)
        const r = listRows(scope).find((x) => x.key === original.key) || original;
        if (clickRow(r)) lastClicked = original.key;
        await sleep(400);
      }
      scanning = false;
    }
    const all = Array.from(union.values()).filter((r) => r.year === year);
    sendPatch({ ts: Date.now(), page: location.pathname,
      lists: [{ year, total: Math.max(scope.total || 0, all.length), rows: all.map((r) => ({ key: r.key, date: r.date, title: r.title, total: r.total })) }],
      scan: { ts: Date.now(), year, tried, done, note: notes.join(' ') } });
    if (done) toast(`급여 지급내역 ${done}건을 읽었습니다. eClass 의 R&D ERP 현황 패널(급여·연구수당 버튼)에 표시됩니다.`, 4000);
    else if (notes.length) toast(notes[0], 7000);
  }

  /* ---------- 화면 읽기 (변화가 잦아들면 실행) ---------- */
  async function attempt() {
    if (stopped || scanning || !cfg || cfg.enabled === false || !document.body) return;
    const patch = { ts: Date.now(), page: location.pathname + location.search };
    const grade = detectGrade();
    if (grade && grade !== lastGrade) { lastGrade = grade; patch.grade = grade; patch.gradePage = location.pathname; }
    let scope = null, rows = [], det = null;
    if (document.body.textContent.includes('급여지급내역')) {
      scope = listScope();
      rows = scope ? listRows(scope) : [];
      det = readDetail();
      if (rows.length) {
        const byYear = new Map();
        for (const r of rows) { if (!byYear.has(r.year)) byYear.set(r.year, []); byYear.get(r.year).push(r); }
        patch.lists = Array.from(byYear.entries()).map(([year, rs]) => ({ year, total: byYear.size === 1 && scope.total ? scope.total : rs.length, rows: rs.map((r) => ({ key: r.key, date: r.date, title: r.title, total: r.total })) }));
        if (det) {
          // 지급내역 합계는 그 달의 소득합계와 같아야 한다. 어느 행과도 같지 않은 화면(합계 기준이 다른 경우)에서만 합계 불일치를 허용
          const sel = selectedRow(rows, det);
          const anyMatch = rows.some((r) => r.total === det.total);
          if (sel && (sel.total === det.total || !anyMatch)) patch.months = [monthOf(sel, det)];
        }
        Object.assign(patch, detectUser());
      }
    }
    const sig = JSON.stringify([patch.grade, patch.lists, (patch.months || []).map((m) => m.key + '#' + m.detailTotal + '#' + Object.keys(m.items).length), patch.empNo]);
    if (patch.grade || patch.lists || patch.months) {
      if (sig !== lastSig) { lastSig = sig; sendPatch(patch); log('read', patch); }
    }
    if (rows.length && cfg.autoScan !== false) {
      for (const year of new Set(rows.map((r) => r.year))) {
        if (scannedYears.has(year)) continue;
        scannedYears.add(year);
        await autoScan(scope, rows.filter((r) => r.year === year), year, det);
      }
    }
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => { attempt().catch((e) => log('attempt error', e)); }, ms == null ? 1200 : ms); }

  /* 사용자가 목록 행을 클릭하면 그 행을 기억해 뒤이어 바뀌는 지급내역을 그 달로 귀속 (자동 수집이 만든 합성 클릭은 clickRow 가 직접 기록) */
  document.addEventListener('click', (ev) => {
    try {
      if (!ev.isTrusted || scanning || !cfg || cfg.enabled === false) return;
      const scope = listScope(); if (!scope || !scope.el.contains(ev.target)) return;
      const rows = listRows(scope);
      const hit = rows.find((r) => r.el === ev.target || r.el.contains(ev.target));
      if (hit) { lastClicked = hit.key; schedule(700); }
    } catch (e) {}
  }, true);

  observer = new MutationObserver(() => { if (!scanning) schedule(); });
  const start = () => { if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true }); loadCfg(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
