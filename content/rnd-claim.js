/* rnd.krs.co.kr (isolated world, 모든 프레임): 청구서(카드) 입력 도우미
 * 과제 지출내역(카드 미청구 행)을 골라 "청구내역" 폼이 뜨면
 *  1) 예산(비목) 선택이 비어 있으면 기본값(연구활동비), RCMS 부가정보 > 사용금액구분이 비어 있으면 기본값(본예산)을 채우고
 *  2) "청구" 소제목 옆에 세목(회의비, 연구실운영비 …) 빠른 선택 버튼을 넣고
 *  3) 첨부문서 칸(행)에 파일을 끌어다 놓으면 화면의 파일 입력(input[type=file])에 넣어 첨부 처리를 시킨다.
 *  4) eClass 패널에서 미리 고른 청구종류·적은 청구내역(적요)·첨부 파일(청구 준비, lib/prep.js)이 있는 거래(주소의 krext_appr)면 행 선택 뒤 세목·청구종류를 고르고 청구내역을 적고 파일을 올리며,
 *     krext_auto=add(패널의 "청구서 작성", 백그라운드 탭)이면 "내역 추가"까지, add,apply("작성+신청")면 이어서 결의서 "신청"(결재요청)까지, apply("신청", krext_prep)면 저장된 결의서의 신청만,
 *     delete("임시저장 삭제", krext_prep)면 내역 추가된 청구내역 행의 [삭제]를 눌러 결과를 백그라운드에 보고한다 (아래 "청구 준비"·"신청"·"임시저장 삭제" 구역).
 *     저장된 결의서를 여는 모드(신청만·삭제)는 먼저 결의서 승인구분(hidden #APPR_DIV_CD)을 읽어 이미 신청·승인된 결의서(10/20/50/60)면 실패가 아니라 "신청됨"(applied)으로 보고한다 — 패널 상태가 ERP 와 어긋난 경우(화면에서 직접 신청 등).
 * 화면 요소는 ID 를 모르므로 라벨 문구("예산", "RCMS 부가정보", "첨부문서", "청구")로 찾는다. 값은 비어 있을 때만 채운다
 * (예외: 청구내역 칸은 고정 ID #REQ_PTCL 로 찾고, 패널에 적은 청구내역은 이 거래에 대한 명시적 입력이라 화면 기본값(카드 메모)을 덮어쓴다).
 * 설정 claimHelper(설정 페이지 "청구서(카드) 입력 도우미")로 켜고 끈다. */
(() => {
  if (window.__krextClaim) return;
  window.__krextClaim = true;

  /* 확장 재로드 후 다시 주입되면: 먼저 이전 스크립트를 멈추고 이전에 넣은 요소를 걷어내게 한 뒤(DOM 이벤트는 world 를 넘어 전달됨), 이 스크립트가 같은 신호를 기다린다 */
  const RESTART_EVT = 'krext-claim-restart';
  document.dispatchEvent(new Event(RESTART_EVT));
  let stopped = false;
  document.addEventListener(RESTART_EVT, () => { stopped = true; teardown(); });

  const S = self.KRX_SETTINGS;
  const norm = (s) => String(s || '').replace(/[\s*＊:：()（）\[\]【】]/g, '').toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.isConnected && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const log = (...a) => { try { console.debug('[krext claim]', ...a); } catch (e) {} };
  const OURS = '.krext-qp,.krext-drop-hint,.krext-toast,.krext-prep-bar';

  /* ---------- 상태 ---------- */
  let cfg = null;          // settings.claimHelper (+ picks: 파싱된 빠른 선택 목록)
  let current = null;      // 찾은 폼 요소 { bgtRow, sel1(비목), sel2(세목), rcms, attach(첨부문서 행), header("청구" 소제목) }
  let tickTimer = null;
  let scanTimer = null;
  let observer = null;
  let docDropHandlers = null;
  let picking = false;

  /* ---------- 설정 ---------- */
  function parsePicks(list) {
    return (Array.isArray(list) ? list : String(list || '').split(/\r?\n/)).map((line) => {
      const s = String(line || '').trim();
      if (!s || s.startsWith('#')) return null;
      const parts = s.split('=').map((x) => x.trim());   // 표시이름=세목 항목명=청구종류(코드 또는 이름)
      const label = parts[0];
      const kw = parts[1] || label;
      const type = parts[2] || '';
      return label ? { label, kw, type } : null;
    }).filter(Boolean);
  }
  async function loadCfg() {
    try {
      const s = await S.load();
      const c = Object.assign({}, (S.DEFAULTS.claimHelper || {}), s.claimHelper || {});
      c.picks = parsePicks(c.quickPicks);
      c.usefacSeqNo = String((s.adv && s.adv.usefacSeqNo) || (S.DEFAULTS.adv && S.DEFAULTS.adv.usefacSeqNo) || '10');   // 파일 직접 업로드(uploadDirect)의 이용기관 일련번호 (화면 hidden 값이 없을 때)
      cfg = c;
    } catch (e) { cfg = null; }   // 확장 컨텍스트가 사라진 경우 등
    if (stopped) return;
    if (cfg && cfg.enabled && cfg.dragDrop) bindDocumentDrop();
    if (!cfg || !cfg.enabled) teardownUi();
    scheduleScan();
  }
  try { chrome.storage.onChanged.addListener((ch, area) => { if ((area === 'sync' || area === 'local') && ch.settings) loadCfg(); }); } catch (e) {}

  /* ---------- 스타일 / 토스트 ---------- */
  const CSS = `
/* vertical-align 6px: 버튼(12px 맑은 고딕, 패딩 3px, 테두리 1px)의 아랫변은 기준선보다 약 6.4px 아래이므로 그만큼 올려 "청구" 글자 아랫줄과 버튼 아랫변을 맞춘다 (소제목 글꼴·크기와 무관) */
.krext-qp{display:inline-flex;flex-wrap:wrap;gap:4px;margin-left:10px;vertical-align:6px;font-weight:400}
.krext-qp button{font:12px/1.2 "Malgun Gothic","맑은 고딕",sans-serif;padding:3px 9px;border:1px solid #9db3d6;border-radius:12px;background:#f3f7fd;color:#1f4e9c;cursor:pointer;white-space:nowrap}
.krext-qp button:hover{background:#e2ecfa}
.krext-qp button.krext-on{background:#1f4e9c;color:#fff;border-color:#1f4e9c}
.krext-qp button:disabled{opacity:.5;cursor:default}
.krext-drop-hint{display:inline-block;margin-left:8px;font:12px "Malgun Gothic","맑은 고딕",sans-serif;color:#6b7480}
.krext-dropping,.krext-dropping td,.krext-dropping th{background:#eef5ff!important}
.krext-dropping{outline:2px dashed #1f4e9c!important;outline-offset:-2px}
.krext-toast{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#222;color:#fff;padding:8px 12px;border-radius:6px;font:13px/1.4 "Malgun Gothic","맑은 고딕",sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);opacity:.95;max-width:60vw;white-space:pre-wrap}
/* 청구 준비 안내 막대: 청구내역 폼(예산 행이 든 표) 바로 위 */
.krext-prep-bar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:4px 0 6px;padding:6px 10px;border:1px solid #b7cdf0;border-radius:6px;background:#eef5ff;font:12px/1.5 "Malgun Gothic","맑은 고딕",sans-serif;color:#1f2f4a}
.krext-prep-bar .krext-prep-ttl{font-weight:700;color:#1f4e9c}
.krext-prep-bar .krext-prep-dim{color:#6b7480}
.krext-prep-bar b{color:#1f4e9c}
.krext-prep-bar .krext-prep-st{color:#1a7f37}
.krext-prep-bar .krext-prep-st.krext-err{color:#b3261e}
.krext-prep-bar .krext-prep-btns{display:inline-flex;gap:4px;margin-left:auto}
.krext-prep-bar button{font:12px/1.2 "Malgun Gothic","맑은 고딕",sans-serif;padding:3px 9px;border:1px solid #9db3d6;border-radius:12px;background:#fff;color:#1f4e9c;cursor:pointer;white-space:nowrap}
.krext-prep-bar button:hover{background:#e2ecfa}
.krext-prep-bar button:disabled{opacity:.5;cursor:default}
`;
  function ensureStyle() {
    if (document.getElementById('krext-claim-style')) return;
    const st = document.createElement('style');
    st.id = 'krext-claim-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  let toastTimer = null;
  function toast(msg, ms) {
    try {
      ensureStyle();
      let el = document.getElementById('krext-claim-toast');
      if (!el) { el = document.createElement('div'); el.id = 'krext-claim-toast'; el.className = 'krext-toast'; document.body.appendChild(el); }
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
    } catch (e) {}
  }

  /* ---------- 화면 요소 찾기 (라벨 문구 기준) ---------- */
  const INLINE = /^(BR|IMG|I|EM|B|STRONG|SPAN|FONT|U|A|LABEL|SUP|SUB)$/;
  const isOurs = (el) => !!(el.classList && (el.classList.contains('krext-qp') || el.classList.contains('krext-drop-hint') || el.classList.contains('krext-toast') || el.classList.contains('krext-prep-bar')));
  /* 우리가 넣은 요소를 빼고 "글자만 가진" 요소인지 */
  const isLeaf = (el) => Array.from(el.children).every((c) => isOurs(c) || (INLINE.test(c.tagName) && !c.children.length));
  /* 우리가 넣은 요소를 뺀 글자 */
  function ownText(el) {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1 && !isOurs(n)) s += n.textContent;
    }
    return s;
  }
  const LABEL_SEL = 'th,td,div,span,label,p,li,dt,dd,strong,b,font,a,h1,h2,h3,h4,h5,h6';
  /* 한 번 훑어서 문구별 잎 요소 목록을 만든다 (문서 순서) */
  function collectLeaves() {
    const map = new Map();
    for (const el of document.querySelectorAll(LABEL_SEL)) {
      if (isOurs(el) || el.closest(OURS)) continue;
      if (!isLeaf(el)) continue;
      const t = norm(ownText(el));
      if (!t || t.length > 12) continue;
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(el);
    }
    return map;
  }
  /* 라벨이 든 행(tr; 없으면 상위 상자)과 그 안의 select 목록 (라벨 요소 안의 것은 제외).
   * 라벨이 표 안에 있으면 그 행만 본다 (그리드 열 제목 "예산" 이 표 전체의 select 를 잡지 않도록) */
  function rowFor(labelEl, needSelect) {
    const tr = labelEl.closest('tr');
    if (tr) {
      const sels = Array.from(tr.querySelectorAll('select')).filter((s) => !labelEl.contains(s));
      return (!needSelect || sels.length) ? { box: tr, sels } : null;
    }
    let box = labelEl.parentElement;
    for (let i = 0; i < 3 && box && box !== document.body; i++) {
      if (/^(TABLE|FORM|BODY)$/.test(box.tagName)) break;
      const sels = Array.from(box.querySelectorAll('select')).filter((s) => !labelEl.contains(s));
      if (!needSelect || sels.length) return { box, sels };
      box = box.parentElement;
    }
    return null;
  }
  const selectedText = (sel) => { const o = sel.options[sel.selectedIndex]; return o ? o.text : ''; };
  const isEmptySel = (sel) => { const t = norm(selectedText(sel)); return sel.selectedIndex < 0 || !t || t === '선택' || t === '선택하세요' || (t === '전체' && !sel.value); };
  const realOptions = (sel) => Array.from(sel.options).filter((o) => { const t = norm(o.text); return t && t !== '선택' && t !== '선택하세요'; });

  /* 문자열 유사도 (2글자 조각 겹침 비율): "클라우드 사용비" ↔ "클라우드컴퓨팅서비스 활용비" 처럼 표기가 조금 다른 항목 찾기용 */
  function bigrams(s) { const out = new Set(); for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2)); return out; }
  function similarity(a, b) {
    const A = bigrams(a), B = bigrams(b); if (!A.size) return 0;
    let n = 0; for (const g of A) if (B.has(g)) n++;
    return n / A.size;
  }
  /* select 에서 문구에 맞는 option: 정확히 같음 > 포함 관계(짧은 것 우선) > 유사도 0.5 이상(높은 것 우선) */
  function matchOption(sel, kw) {
    const k = norm(kw); if (!k || !sel) return null;
    const opts = realOptions(sel);
    let best = opts.find((o) => norm(o.text) === k); if (best) return best;
    const inc = opts.filter((o) => { const t = norm(o.text); return t.includes(k) || k.includes(t); }).sort((a, b) => norm(a.text).length - norm(b.text).length);
    if (inc.length) return inc[0];
    let score = 0.5;
    for (const o of opts) { const sc = similarity(k, norm(o.text)); if (sc > score) { score = sc; best = o; } }
    return best || null;
  }
  function setOption(sel, opt) {
    if (!opt || (sel.value === opt.value && sel.selectedIndex === opt.index)) return false;
    sel.selectedIndex = opt.index;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const follows = (el, ref) => !!(ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const precedes = (el, ref) => !!(ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);

  /* 청구내역 폼의 구성 요소 */
  function findForm() {
    if (!document.body) return null;
    const leaves = collectLeaves();
    const get = (t) => leaves.get(norm(t)) || [];
    // 예산 행: select 가 있는 행. 기본 비목 항목이 목록에 있는 select 가 든 행을 우선
    const bgtRows = get('예산').map((el) => rowFor(el, true)).filter(Boolean);
    if (!bgtRows.length) return null;
    const want = cfg && cfg.defaultBudget;
    const bgtRow = (want && bgtRows.find((r) => r.sels.some((s) => matchOption(s, want)))) || bgtRows[0];
    let sel1 = (want && bgtRow.sels.find((s) => matchOption(s, want))) || bgtRow.sels[0];
    const sel2 = bgtRow.sels.find((s) => s !== sel1) || null;
    const after = (els) => els.filter((el) => follows(el, bgtRow.box)).concat(els.filter((el) => !follows(el, bgtRow.box)));   // 예산 행 뒤에 있는 것 우선
    // RCMS 부가정보 > 사용금액구분
    let rcms = null;
    for (const lab of ['RCMS부가정보', '사용금액구분']) {
      for (const el of after(get(lab))) {
        const r = rowFor(el, true); if (!r) continue;
        rcms = (cfg && cfg.defaultRcms && r.sels.find((s) => matchOption(s, cfg.defaultRcms))) || r.sels[0];
        if (rcms) break;
      }
      if (rcms) break;
    }
    // 첨부문서 행
    let attach = null;
    const atLabel = after(get('첨부문서'))[0] || after(get('첨부파일'))[0];
    if (atLabel) attach = (rowFor(atLabel, false) || {}).box || null;
    // 청구종류 행 (라디오 또는 select)
    let typeRow = null;
    const tyLabel = after(get('청구종류'))[0];
    if (tyLabel) typeRow = (rowFor(tyLabel, false) || {}).box || null;
    // "청구" 소제목: 예산 행보다 앞에 있는 가장 가까운 것
    let header = null;
    for (const el of get('청구')) if (precedes(el, bgtRow.box)) header = el;
    return { bgtRow: bgtRow.box, sel1, sel2, rcms, attach, typeRow, header };
  }

  /* ---------- 세목별 청구종류 기본값 ----------
   * 빠른 선택 목록의 셋째 값(예: "외부전문가 활용비=외부 전문기술=83")이 있으면, 세목이 그 항목으로 바뀔 때(버튼이든 직접 선택이든)
   * 청구종류 라디오/select 에서 "(83) …" 처럼 코드가 맞는(또는 이름이 맞는) 것을 고른다. 세목이 바뀐 뒤에만 적용하므로
   * 이미 저장된 청구서를 열었을 때의 청구종류는 건드리지 않고, 사용자가 라디오를 직접 바꾼 뒤에는 세목을 다시 바꾸기 전까지 두 번 다시 고르지 않는다 */
  let watchedSel2 = null, lastSel2Key = null, typeRun = 0, typeApplying = false;   // typeApplying: 청구 준비 자동 처리가 "내역 추가" 전에 기다리는 표시
  const sel2Key = (sel) => sel && sel.isConnected ? sel.value + '|' + sel.selectedIndex : '';
  function watchClaimType(f) {
    if (!f.sel2) return;
    const key = sel2Key(f.sel2);
    if (f.sel2 !== watchedSel2) { watchedSel2 = f.sel2; lastSel2Key = key; return; }   // 새로 찾은 폼: 현재 값은 기준으로만 삼음
    if (key === lastSel2Key) return;
    lastSel2Key = key;
    if (isEmptySel(f.sel2)) return;
    const cur = f.sel2.options[f.sel2.selectedIndex];
    const item = cfg.picks.find((p) => p.type && (matchOption(f.sel2, p.kw) || {}).index === cur.index);
    if (item) applyClaimType(item.type);
  }
  function radioLabel(r) {
    let t = '';
    try { if (r.id) { const l = document.querySelector(`label[for="${r.id.replace(/"/g, '\\"')}"]`); if (l) t += l.textContent; } } catch (e) {}
    const pl = r.closest('label'); if (pl) t += ' ' + pl.textContent;
    let n = r.nextSibling, k = 0;
    while (n && k < 6) { if (n.nodeType === 1 && n.matches('input,select,br')) break; t += ' ' + (n.textContent || ''); n = n.nextSibling; k++; }
    return t;
  }
  /* 청구종류 행에서 코드/이름에 맞는 라디오 또는 option: 코드는 "(83)"·값 83 처럼 숫자가 정확히 맞는 것, 이름은 정확히 같음 > 포함 > 유사도 */
  function findClaimTypeControl(row, type) {
    const isCode = /^\d+$/.test(type);
    const codeRe = isCode ? new RegExp('(^|[^0-9])' + type + '(?![0-9])') : null;
    const k = norm(type);
    const score = (text, value) => {
      if (isCode) return (String(value) === type || codeRe.test(text)) ? 3 : 0;
      const t = norm(text);
      if (t === k) return 3;
      if (t.includes(k) || k.includes(t)) return 2;
      return similarity(k, t) >= 0.5 ? 1 : 0;
    };
    let best = null, bestScore = 0;
    for (const r of row.querySelectorAll('input[type=radio]')) { const sc = score(radioLabel(r), r.value); if (sc > bestScore) { best = { radio: r }; bestScore = sc; } }
    for (const s of row.querySelectorAll('select')) for (const o of realOptions(s)) { const sc = score(o.text, o.value); if (sc > bestScore) { best = { select: s, opt: o }; bestScore = sc; } }
    return best;
  }
  async function applyClaimType(type) {
    const run = ++typeRun;
    const started = Date.now();
    typeApplying = true;
    try {
      while (Date.now() - started < 6000 && !stopped && run === typeRun) {   // 세목 변경 뒤 화면이 청구종류 목록을 다시 그릴 때까지 기다림
        let row = current && current.typeRow && current.typeRow.isConnected ? current.typeRow : null;
        if (!row) { const f = findForm(); if (f) { current = f; row = f.typeRow; } }
        const hit = row ? findClaimTypeControl(row, type) : null;
        if (hit) {
          if (hit.radio) { if (!hit.radio.checked) hit.radio.click(); }
          else setOption(hit.select, hit.opt);
          log('청구종류', type, '→', hit.radio ? radioLabel(hit.radio).trim() : hit.opt.text);
          return;
        }
        await sleep(250);
      }
    } finally { if (run === typeRun) typeApplying = false; }
  }

  /* ---------- 기본값 채우기 ---------- */
  const setLog = new WeakMap();   // select → { n, ts }: 같은 select 를 계속 되돌리는 화면과의 무한 반복 방지
  function fillDefault(sel, text) {
    if (!sel || !text || !visible(sel) || !isEmptySel(sel)) return false;
    const opt = matchOption(sel, text); if (!opt) return false;
    const st = setLog.get(sel) || { n: 0, ts: 0 };
    if (Date.now() - st.ts > 15000) st.n = 0;
    if (st.n >= 4) return false;   // 15초 안에 4번 넘게 채웠는데 계속 비워지면 화면이 거부하는 것이므로 멈춤
    st.n++; st.ts = Date.now(); setLog.set(sel, st);
    log('기본값', text, '→', opt.text);
    return setOption(sel, opt);
  }

  /* ---------- 세목 빠른 선택 버튼 ---------- */
  /* 세목을 item.kw 로 고른다. 골랐으면 true (청구 준비 자동 처리가 결과를 본다) */
  async function pick(item, btn) {
    if (picking) return false;
    picking = true;
    if (btn) btn.disabled = true;
    try {
      let f = (current && current.sel1 && current.sel1.isConnected) ? current : (current = findForm());
      if (!f || !f.sel1) { toast('청구내역 폼을 찾지 못했습니다.'); return false; }
      if (cfg.defaultBudget && isEmptySel(f.sel1)) {   // 비목이 비어 있으면 먼저 기본 비목을 고른 뒤 세목 목록이 채워지길 기다림
        const o = matchOption(f.sel1, cfg.defaultBudget);
        if (o) setOption(f.sel1, o);
      }
      const started = Date.now();
      while (Date.now() - started < 5000 && !stopped) {
        if (!f.sel2 || !f.sel2.isConnected) f = current = findForm() || f;
        const opt = f.sel2 ? matchOption(f.sel2, item.kw) : null;
        if (opt) { setOption(f.sel2, opt); toast(`${item.label} → ${opt.text.trim()}`, 1800); return true; }
        await sleep(200);
      }
      toast(`'${item.kw}' 항목을 세목 목록에서 찾지 못했습니다.\n예산(비목)을 먼저 골랐는지 확인하세요.`);
      return false;
    } finally { picking = false; if (btn) btn.disabled = false; }
  }
  const pickBox = () => document.querySelector('.krext-qp');
  function ensurePicks(form) {
    const sig = cfg.picks.map((p) => p.label + '=' + p.kw + '=' + p.type).join('|');
    let box = pickBox();
    if (box && box.dataset.sig === sig && box.isConnected) { updatePickState(form, box); return; }
    if (box) box.remove();
    if (!cfg.picks.length) return;
    const anchor = form.header || form.sel2 || form.sel1;
    if (!anchor) return;
    ensureStyle();
    box = document.createElement('span');
    box.className = 'krext-qp';
    box.dataset.sig = sig;
    for (const item of cfg.picks) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.title = `세목을 "${item.kw}" 로 선택` + (item.type ? `, 청구종류 ${item.type}` : '');
      b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); pick(item, b); });
      box.appendChild(b);
    }
    if (form.header && !/^(TR|TABLE|TBODY|THEAD)$/.test(form.header.tagName)) form.header.appendChild(box);
    else anchor.insertAdjacentElement('afterend', box);
    updatePickState(form, box);
  }
  function updatePickState(form, box) {
    const sel2 = form.sel2;
    const cur = sel2 && !isEmptySel(sel2) ? sel2.options[sel2.selectedIndex] : null;
    Array.from(box.children).forEach((b, i) => {
      const item = cfg.picks[i]; if (!item) return;
      const opt = cur ? matchOption(sel2, item.kw) : null;
      b.classList.toggle('krext-on', !!(opt && cur && opt.index === cur.index));
    });
  }

  /* ---------- 첨부문서 드래그 앤 드롭 ---------- */
  const hasFiles = (ev) => { try { return Array.from(ev.dataTransfer.types || []).includes('Files'); } catch (e) { return false; } };
  const isFileInput = (el) => !!(el && el.matches && el.matches('input[type=file]'));
  function fileInputsIn(win, out, seen) {
    try {
      const doc = win.document; if (!doc || seen.has(doc)) return; seen.add(doc);
      for (const i of doc.querySelectorAll('input[type=file]')) if (!i.disabled) out.push(i);
      for (let k = 0; k < win.frames.length; k++) fileInputsIn(win.frames[k], out, seen);
    } catch (e) {}   // 다른 출처 프레임
  }
  /* 이 프레임 → 최상위부터 모든 같은 출처 프레임 순으로 파일 입력을 모아, 보이는 것 우선 (dragover 마다 부르므로 잠깐 캐시) */
  let fiCache = { ts: 0, list: [] };
  function findFileInputs() {
    if (Date.now() - fiCache.ts < 400) return fiCache.list;
    const out = [], seen = new Set();
    fileInputsIn(window, out, seen);
    try { fileInputsIn(window.top, out, seen); } catch (e) {}
    fiCache = { ts: Date.now(), list: out.sort((a, b) => Number(visible(b)) - Number(visible(a))) };
    return fiCache.list;
  }
  function assignFiles(input, files) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  /* 파일 입력에 넣기. multiple 이 아니면 한 개씩 넣고 화면이 처리할 시간을 둔다 (입력이 새로 만들어지면 다시 찾음) */
  async function feedFiles(input, files) {
    if (input.multiple || files.length === 1) { assignFiles(input, files); return files.length; }
    let n = 0;
    for (const f of files) {
      if (!input.isConnected) { fiCache.ts = 0; input = findFileInputs()[0]; if (!input) break; }
      assignFiles(input, [f]); n++;
      await sleep(900);
    }
    return n;
  }
  /* 파일등록 팝업(rcomm_0089_01.js changeFile())의 검사 규칙. 확장자·용량 규칙은 팝업의 hidden 값(APPR_FILE_CHK_YN 등)이 정하므로
   * 청구서 쪽에서는 팝업이 무조건 거부하는 것(실행·스크립트 확장자, 확장자 없음)만 빼고, 나머지 판정은 팝업 쪽에서 한다 */
  const DENY_EXT = new Set(['exe', 'bat', 'sh', 'java', 'jsp', 'htm', 'html', 'js', 'class', 'ini', 'php', 'jsv']);
  const IMAGE_EXT = ['bmp', 'rle', 'dib', 'gif', 'jpg', 'jpeg', 'tif', 'tiff', 'tga', 'pct', 'pgm', 'psd', 'ppm', 'png', 'pcx', 'pcd', 'sgi', 'eps'];
  const SC_RE = /[{}\[\]\/?,;:|*~`!^<>@#$%&\\='"]/g;   // 팝업이 파일명에서 지우는 특수문자
  const extOf = (name) => { const s = String(name || ''); const i = s.lastIndexOf('.'); return i < 0 ? null : s.slice(i + 1).toLowerCase(); };
  const byteLen = (s) => { let n = 0; for (const ch of String(s || '')) n += ch.charCodeAt(0) > 127 ? 2 : 1; return n; };
  const alwaysDenied = (f) => { const e = extOf(f.name); return e == null || DENY_EXT.has(e); };
  const skippedText = (sk) => (sk || []).map((s) => `${s.name} (${s.why})`).join(', ');
  function failText(res) {
    const sk = res.skipped && res.skipped.length ? `\n제외: ${skippedText(res.skipped)}` : '';
    if (res.reason === 'empty') return '첨부 창의 규칙에 맞는 파일이 없어 올리지 못했습니다.' + sk;
    if (res.reason === 'single') return '이 첨부 창은 파일을 하나만 받는데 이미 파일이 있습니다. 그 창에서 정리한 뒤 올려 주세요.';
    if (res.reason === 'button') return '업로드 버튼을 찾지 못했습니다. 첨부 창에서 업로드를 눌러 주세요.' + sk;
    return '첨부 창에서 자동 처리를 못 했습니다. 그 창에 파일을 끌어다 놓고 업로드를 눌러 주세요.' + sk;
  }
  function findAttachButton(box) {
    const cands = Array.from(box.querySelectorAll('button,a,input[type=button],input[type=submit],img,span,div,label'));
    return cands.find((el) => {
      const t = norm(el.tagName === 'INPUT' ? el.value : el.tagName === 'IMG' ? (el.alt || el.title) : (isLeaf(el) ? ownText(el) : ''));
      return t === '첨부' || t === '파일첨부' || t === '첨부하기';
    }) || null;
  }
  /* 반환 { ok, n, reason }: 청구 준비 자동 처리가 결과를 본다. reason: empty(올릴 파일 없음) · input · button · channel · busy · blocked(팝업 차단) · timeout · 팝업 쪽 실패 사유 */
  async function dropFiles(box, files) {
    let list = Array.from(files || []).filter((f) => f && f.name);
    if (!list.length) return { ok: false, reason: 'empty' };
    const bad = list.filter(alwaysDenied);
    if (bad.length) {
      toast(`첨부할 수 없는 파일 종류라 제외: ${bad.map((f) => f.name).join(', ')}`, 5000);
      list = list.filter((f) => !bad.includes(f));
      if (!list.length) return { ok: false, reason: 'empty' };
    }
    fiCache.ts = 0;
    const inputs = findFileInputs();
    if (inputs.length) {   // 화면 안에 파일 입력이 있는 경우: 바로 넣는다
      const n = await feedFiles(inputs[0], list);
      log('첨부', n, '건 →', inputs[0]);
      toast(`${n}개 파일을 첨부 처리했습니다. 목록에 안 보이면 "첨부" 버튼으로 올려 주세요.`, 3500);
      return { ok: n > 0, n, reason: n > 0 ? '' : 'input' };
    }
    // 파일 입력이 없는 화면(청구서: "첨부" 버튼이 파일등록 팝업 rcomm_0089_01.act 를 연다):
    // 파일을 보관해 두고 팝업을 연 뒤, 팝업에서 도는 이 스크립트가 파일을 받아 목록에 넣고 "업로드"를 누른다
    const btn = findAttachButton(box);
    if (!btn) { toast('첨부 버튼을 찾지 못했습니다. "첨부" 버튼으로 올려 주세요.', 5000); return { ok: false, reason: 'button' }; }
    if (!channel) { btn.click(); toast('첨부 창이 열리면 그 창에 파일을 끌어다 놓고 업로드를 눌러 주세요.', 6000); return { ok: false, reason: 'channel' }; }
    if (pending) return { ok: false, reason: 'busy' };
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const result = new Promise((resolve) => { pending = { id, files: list, ts: Date.now(), claimed: false, resolve }; });
    btn.click();                  // drop/click 이벤트 처리 중(await 전)에 눌러야 팝업 차단에 걸리지 않음
    post({ type: 'offer', id });  // 이미 열려 있던 팝업이면 이 신호를 받고 준비됐다고 알려 옴
    toast('첨부 창에 파일을 넘기는 중…', 20000);
    const timeout = new Promise((r) => setTimeout(() => r({ type: 'timeout' }), 20000));
    const res = await Promise.race([result, timeout]);
    if (pending && pending.id === id) pending = null;
    const skipped = res.skipped && res.skipped.length ? `\n제외: ${skippedText(res.skipped)}` : '';
    if (res.type === 'done') { toast(`${res.n}개 파일을 첨부 창에서 올렸습니다.` + skipped, skipped ? 8000 : 3500); return { ok: true, n: res.n, reason: '' }; }
    if (res.type === 'fail') { toast(failText(res), 8000); return { ok: false, reason: res.reason || 'fail' }; }
    if (res.type === 'blocked') {   // MAIN 훅(rnd-hook.js)이 window.open 이 null 을 돌려받았다고 알림
      toast('브라우저가 첨부 창(팝업)을 막았습니다. 주소창 오른쪽의 팝업 차단 표시에서 이 사이트를 허용하거나, "첨부" 버튼을 직접 눌러 주세요.', 8000);
      return { ok: false, reason: 'blocked' };
    }
    toast('첨부 창이 응답하지 않습니다. 그 창에 파일을 끌어다 놓고 업로드를 눌러 주세요.', 6000);
    return { ok: false, reason: 'timeout' };
  }

  /* ---------- 첨부 팝업(파일등록) 자동 처리 ----------
   * 청구서 프레임 ↔ 팝업 창은 같은 출처이므로 BroadcastChannel 로 File 객체를 그대로 넘길 수 있다.
   *  청구서: 드롭 → pending 보관 → "첨부" 클릭 → (offer) … 팝업의 popup-ready 를 받으면 files 전송 → done/fail 수신
   *  팝업  : 업로드 화면이 준비되면 popup-ready → files 를 받아 파일 입력(없으면 드롭 구역에 합성 drop)에 넣고 "업로드" 클릭 → done */
  const CH_NAME = 'krext-claim-files';
  let channel = null;
  let pending = null;      // 청구서 쪽 보관 { id, files, ts, claimed, resolve }
  let uploading = false;   // 팝업 쪽
  let synthActive = false; // 팝업 쪽: 합성 drop 을 우리 문서 리스너가 처리하지 않도록
  let announced = false;
  function post(msg) { try { if (channel) channel.postMessage(msg); } catch (e) { log('channel 전송 실패', e); } }
  /* 이 창이 파일등록 팝업(별도 창, 업로드 UI)인지 */
  function isUploadPopup() {
    if (current || window !== window.top || !window.opener) return false;
    if (document.querySelector('input[type=file]')) return true;
    const t = (document.body && document.body.textContent) || '';
    return /끌어오세요|파일\s*업로드|파일등록/.test(t) || /파일등록|파일\s*업로드/.test(document.title || '');
  }
  function initChannel() {
    if (channel || typeof BroadcastChannel !== 'function') return;
    try { channel = new BroadcastChannel(CH_NAME); } catch (e) { channel = null; return; }
    channel.onmessage = (ev) => {
      if (stopped) return;
      const m = ev.data || {};
      if (m.type === 'popup-ready') {
        if (pending && !pending.claimed && Date.now() - pending.ts < 60000) { pending.claimed = true; post({ type: 'files', id: pending.id, files: pending.files }); }
      } else if (m.type === 'offer') {
        if (isUploadPopup()) post({ type: 'popup-ready' });
      } else if (m.type === 'files') {
        if (isUploadPopup() && Array.isArray(m.files) && m.files.length) autoUpload(m.id, m.files);
      } else if (m.type === 'done' || m.type === 'fail') {
        if (pending && pending.id === m.id) { const p = pending; pending = null; p.resolve(m); }
      }
    };
  }
  /* 팝업 쪽: 업로드 UI 가 준비되면(늦게 그려질 수 있어 최대 8초 확인) 준비됐다고 알림 */
  function announceUploadUi() {
    if (!channel || window !== window.top || !window.opener) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (stopped || announced || Date.now() - started > 8000) { clearInterval(t); return; }
      if (isUploadPopup()) { announced = true; clearInterval(t); post({ type: 'popup-ready' }); }
    }, 400);
  }
  function findButton(texts) {
    const want = texts.map(norm);
    for (const el of document.querySelectorAll('button,a,input[type=button],input[type=submit],span,div,label,img')) {
      const t = norm(el.tagName === 'INPUT' ? el.value : el.tagName === 'IMG' ? (el.alt || el.title) : (isLeaf(el) ? ownText(el) : ''));
      if (t && want.includes(t) && visible(el)) return el;
    }
    return null;
  }
  /* 팝업의 hidden 값 (없으면 빈 문자열) */
  const hidVal = (id) => { const el = document.getElementById(id); return el && el.value != null ? String(el.value).trim() : ''; };
  /* 팝업 목록에 오른 파일 수: 목록 행의 체크박스(filechkKey) 수 → 없으면 "N 개체" 문구 → 목록 상자(#dropZone)만 있으면 0 → 아무것도 없으면 null(알 수 없음) */
  function listedCount() {
    const n = document.querySelectorAll('input[name="filechkKey"]').length;
    if (n) return n;
    const m = /(\d+)\s*개체/.exec((document.body && document.body.textContent) || '');
    if (m) return Number(m[1]);
    return document.getElementById('dropZone') ? 0 : null;
  }
  /* 팝업 changeFile() 의 검사 규칙을 hidden 값에서 읽는다. 걸리는 파일이 있으면 팝업이 alert 를 띄우고 그 뒤 파일을 모두 버리므로 미리 같은 규칙으로 걸러 넘긴다.
   * APPR_FILE_CHK_YN: Y=PDF·이미지만, I=이미지만, P=일부 이미지·500KB 이하. GBCD_1_CD: 허용 확장자 목록(문자열 포함 여부). MAX_FILE_SIZE(MB), MAX_CNT(개수), SINGLE_YN */
  function popupRules() {
    const chk = hidVal('APPR_FILE_CHK_YN');
    const allow = chk === 'Y' ? new Set(['pdf', ...IMAGE_EXT]) : chk === 'I' ? new Set(IMAGE_EXT) : chk === 'P' ? new Set(['bmp', 'gif', 'jpg', 'png', 'jpeg']) : null;
    let maxMb = Number(hidVal('MAX_FILE_SIZE')) || 0;
    if (!maxMb && !document.getElementById('MAX_FILE_SIZE')) { const m = /(\d+)\s*MB/.exec((document.body && document.body.textContent) || ''); if (m) maxMb = Number(m[1]); }   // hidden 값이 없는 화면: 안내 문구의 "N MB"
    return { chk, allow, gb: hidVal('GBCD_1_CD').toLowerCase(), maxMb, maxCnt: Number(hidVal('MAX_CNT')) || 0, single: hidVal('SINGLE_YN') === 'Y' };
  }
  function rejectReason(f, r) {
    const ext = extOf(f.name);
    if (byteLen(f.name) > 200) return '파일명이 너무 긺';
    if (ext == null || DENY_EXT.has(ext)) return '첨부할 수 없는 파일 종류';
    if (r.allow && !r.allow.has(ext)) return r.chk === 'Y' ? 'PDF·이미지만 가능' : '이미지만 가능';
    if (r.chk === 'P' && f.size > 500 * 1024) return '500KB 초과';
    if (r.gb && r.gb.indexOf(ext) === -1) return '허용 확장자 아님';
    if (r.maxMb && f.size / 1024 / 1024 > r.maxMb) return `${r.maxMb}MB 초과`;
    return '';
  }
  /* 파일 목록 상자: 팝업의 #dropZone, 없으면 "마우스로 파일을 끌어오세요" 문구가 든 구역 */
  function findDropZone() {
    const dz = document.getElementById('dropZone');
    if (dz) return dz;
    let leaf = null;
    for (const el of document.querySelectorAll('div,span,p,td,li,label')) if (isLeaf(el) && /끌어오세요|끌어다/.test(ownText(el))) { leaf = el; break; }
    if (!leaf) return null;
    let z = leaf;
    for (let i = 0; i < 5 && z.parentElement && z.parentElement !== document.body; i++) { z = z.parentElement; if (z.offsetHeight >= 100) break; }
    return z;
  }
  function synthDrop(zone, files) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    synthActive = true;
    try {
      for (const type of ['dragenter', 'dragover', 'drop']) {
        let ev;
        try { ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); }
        catch (e) { ev = new Event(type, { bubbles: true, cancelable: true }); try { Object.defineProperty(ev, 'dataTransfer', { value: dt }); } catch (e2) {} }
        zone.dispatchEvent(ev);
      }
    } finally { synthActive = false; }
  }
  async function autoUpload(id, files) {
    if (uploading) return;
    uploading = true;
    try {
      const bodyText = () => (document.body && document.body.textContent) || '';
      const rules = popupRules();
      const before = listedCount() || 0;
      const skipped = [];   // { name, why } — 청구서 쪽 토스트에 보여 준다 (이 창은 업로드 뒤 스스로 닫히므로)
      let list = files.filter((f) => f && f.name).filter((f) => { const why = rejectReason(f, rules); if (why) skipped.push({ name: f.name, why }); return !why; });
      if (rules.single) {
        if (before > 0) { post({ type: 'fail', id, reason: 'single', skipped }); return; }
        for (const f of list.slice(1)) skipped.push({ name: f.name, why: '하나만 첨부 가능' });
        list = list.slice(0, 1);
      }
      if (rules.maxCnt && before + list.length > rules.maxCnt) {
        const room = Math.max(0, rules.maxCnt - before);
        for (const f of list.slice(room)) skipped.push({ name: f.name, why: `최대 ${rules.maxCnt}개` });
        list = list.slice(0, room);
      }
      log('팝업 규칙', rules, '제외', skipped);
      if (!list.length) { post({ type: 'fail', id, reason: 'empty', skipped }); return; }
      // 목록에 올랐는지: 행 수가 늘었는지로 보고, 행 수를 알 수 없는 화면이면 표시 이름(특수문자 제거, 앞부분)이 글자에 있는지로 본다
      const shown = list.map((f) => f.name.replace(SC_RE, '').slice(0, 20));
      const listed = () => { const c = listedCount(); if (c != null) return c >= before + list.length; const t = bodyText(); return shown.every((s) => t.includes(s)); };
      const waitListed = async (ms) => { const st = Date.now(); while (Date.now() - st < ms) { if (listed()) return true; await sleep(150); } return false; };
      let ok = false;
      fiCache.ts = 0;
      const inputs = findFileInputs();
      if (inputs.length) { await feedFiles(inputs[0], list); ok = await waitListed(1500); log('팝업 파일 입력', ok); }
      if (!ok) { const zone = findDropZone(); if (zone) { synthDrop(zone, list); ok = await waitListed(1500); log('팝업 드롭 구역', ok); } }
      if (!ok) { toast('파일을 목록에 넣지 못했습니다. 이 창에 파일을 끌어다 놓고 업로드를 눌러 주세요.', 6000); post({ type: 'fail', id, reason: 'list', skipped }); return; }
      const up = findButton(['업로드']);
      if (!up) { toast('업로드 버튼을 찾지 못했습니다. 직접 눌러 주세요.', 6000); post({ type: 'fail', id, reason: 'button', skipped }); return; }
      document.dispatchEvent(new Event('krext-auto-confirm'));   // MAIN world 훅(rnd-hook.js): 잠시 동안 confirm() 자동 확인
      up.click();
      post({ type: 'done', id, n: list.length, skipped });
    } catch (e) { log('autoUpload 오류', e); post({ type: 'fail', id, reason: String(e && e.message || e) }); }
    finally { uploading = false; }
  }
  /* 첨부문서 행을 드롭 구역으로. 리스너는 떼지 않고 남기되(재주입·설정 변경 시) zoneActive 로 무력화한다 */
  const zoneActive = (ev) => !stopped && cfg && cfg.enabled && cfg.dragDrop && hasFiles(ev);
  function bindDropZone(box) {
    if (box.dataset.krextDrop) return;
    box.dataset.krextDrop = '1';
    ensureStyle();
    let depth = 0;
    box.addEventListener('dragenter', (ev) => { if (!zoneActive(ev)) return; ev.preventDefault(); depth++; box.classList.add('krext-dropping'); });
    box.addEventListener('dragover', (ev) => { if (!zoneActive(ev)) return; ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'copy'; });
    box.addEventListener('dragleave', (ev) => { if (!zoneActive(ev)) return; depth = Math.max(0, depth - 1); if (!depth) box.classList.remove('krext-dropping'); });
    box.addEventListener('drop', (ev) => {
      if (!zoneActive(ev)) return;
      ev.preventDefault(); ev.stopPropagation();
      depth = 0; box.classList.remove('krext-dropping');
      if (isFileInput(ev.target)) { assignFiles(ev.target, Array.from(ev.dataTransfer.files)); return; }
      dropFiles(box, ev.dataTransfer.files);
    });
    // 안내 문구: 확장자 안내가 있는 셀 끝, 없으면 마지막 셀 끝
    const cells = Array.from(box.querySelectorAll('td')).filter((td) => td.closest('tr') === box);
    const target = cells.find((td) => /확장자/.test(td.textContent || '')) || cells[cells.length - 1] || box;
    if (!target.querySelector('.krext-drop-hint')) {
      const hint = document.createElement('span');
      hint.className = 'krext-drop-hint';
      hint.textContent = '※ 파일을 이 칸에 끌어다 놓으면 첨부됩니다.';
      target.appendChild(hint);
    }
  }
  /* 문서 아무 곳에 파일을 놓았을 때(모든 ERP 프레임): 이 문서에 보이는 파일 입력이 있으면(첨부 팝업 등) 거기에 넣고,
   * 없으면 브라우저 기본 동작(파일을 열며 화면 이탈)만 막는다. 파일 입력 자체에 놓는 것은 브라우저에 맡긴다 */
  function bindDocumentDrop() {
    if (docDropHandlers) return;
    // 화면 자체의 드롭 구역이 이미 처리한 것(defaultPrevented)과 우리가 합성한 drop 은 건드리지 않음
    const active = (ev) => !stopped && cfg && cfg.enabled && cfg.dragDrop && !synthActive && !ev.defaultPrevented && hasFiles(ev) && !isFileInput(ev.target);
    const onDragover = (ev) => {
      if (!active(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = findFileInputs().some(visible) ? 'copy' : 'none';
    };
    const onDrop = (ev) => {
      if (!active(ev)) return;
      ev.preventDefault();
      const inputs = findFileInputs().filter(visible);
      if (inputs.length) { feedFiles(inputs[0], Array.from(ev.dataTransfer.files)).then((n) => toast(`${n}개 파일을 파일 입력에 넣었습니다.`, 2500)); return; }
      if (current && current.attach) toast('첨부문서 칸에 끌어다 놓으세요.');
    };
    document.addEventListener('dragover', onDragover);
    document.addEventListener('drop', onDrop);
    docDropHandlers = { onDragover, onDrop };
  }

  /* ---------- 청구 준비 (eClass 패널 lib/prep.js → 백그라운드 storage.local.claimPrep + IndexedDB, lib/prep-store.js) ----------
   * 이 프레임의 주소에 krext_appr(승인번호)·krext_card(카드 뒤 4자리)가 있으면(패널의 거래 행 클릭이나 "청구서 작성"으로 연 청구서) 백그라운드에서 그 거래의 준비 항목(청구종류·청구내역·파일)을 받아 두고,
   * MAIN 훅(rnd-hook.js)이 그 승인번호 행을 자동 선택했다는 신호(krext-row-selected 이벤트 또는 <html data-krext-row-selected>)가 오면 청구내역 폼에서
   *  1) 세목 빠른 선택(pick → watchClaimType 이 청구종류 코드까지)을 고르고
   *  2) 청구내역(적요) 글이 있으면 폼의 청구내역 칸(#REQ_PTCL, 없으면 "청구내역"·"적요" 라벨 행의 입력란 — 화면이 필수로 요구)에 넣고(화면 규칙대로 1000바이트에서 자름. "내역 추가" 직전에 되돌려졌는지 한 번 더 확인)
   *  3) 파일을 파일등록 팝업의 업로드 서비스(rcomm_0089_01_c001.jct, multipart)에 직접 올린 뒤 화면 콜백 ctl.doUploadAttfile(행) 을 MAIN 훅(krext-call)으로 불러 첨부 목록(#fileList)에 넣는다
   *     (팝업을 열지 않으므로 팝업 차단·백그라운드 탭과 무관). 안 되면 첨부 창(팝업) 경로(dropFiles)로, 그것도 안 되면 안내 막대의 버튼으로 사용자가 다시 시도
   *  4) krext_auto 에 add 가 있으면(백그라운드 탭) "내역 추가"(#btn_listAdd)를 눌러 청구내역을 저장하고(임시저장 상태의 결의서) 결과(rexpe_0083_01_c001 응답 / alert 문구)를 백그라운드(prepRunResult)에 보고한다.
   *  5) krext_auto 에 apply 가 있으면 이어서 결의서 "신청"(#btn_apprProc, 결재요청)까지 한다 — 아래 "신청" 구역. add 없이 apply 만이면(주소 krext_prep, 행 선택 없음) 이미 저장된 결의서를 신청만 한다.
   *  6) krext_auto=delete(주소 krext_prep)면 내역 추가된 청구내역 행(청구번호 run.reqNo)의 [삭제]를 눌러 임시저장을 지운다 — 아래 "임시저장 삭제" 구역. 지워지면 거래가 미청구 목록으로 돌아온다.
   * 자동 처리 동안은 MAIN 훅이 confirm 을 자동 확인하고 alert 를 막지 않고 문구만 넘긴다(krext-auto-mode). 안내 막대(.krext-prep-bar)는 청구내역 폼(예산 행이 든 표) 바로 위 */
  let prep = null;            // 준비 항목 메타 { key, appr, card4, type, ptcl(청구내역 글), files:[{id,name,size}], attached }
  let prepFiles = [];         // File 객체 (백그라운드 base64 → File)
  let prepBar = null;
  let prepSt = { type: '', typeErr: false, ptcl: '', ptclErr: false, files: '', filesErr: false, add: '', addErr: false, apply: '', applyErr: false, del: '', delErr: false };
  let prepAuto = '';          // 주소의 krext_auto: add(내역 추가) · add,apply(내역 추가 + 신청) · apply(저장된 결의서 신청만) · delete(내역 추가된 청구내역 삭제)
  let prepSteps = new Set();  // prepAuto 를 나눈 단계 집합
  const hasStep = (s) => prepSteps.has(s);
  const noRowMode = () => !!prepAuto && (!hasStep('add') || !!prepSaved);   // 신청만·삭제(미청구 카드 행 선택 없음), 또는 내역 추가가 끝나 행 선택이 풀린 뒤 — 이때 비목 기본값을 넣으면 화면이 되돌리며 alert
  let prepRunning = false, prepTypeDone = false, prepPtclDone = false, prepAttachDone = false, prepReported = false;
  let prepSaved = null;       // 내역 추가가 끝난 결의서 { reqNo(청구번호 REQ_SEQ_NO), reqCnt(결의서 차수 REQ_CNT) } — 신청 실패 보고에 "임시저장은 됨" 표시
  let prepAlerts = [];        // 자동 처리 중 화면이 띄우려던 alert 문구
  let addWaiter = null, applyWaiter = null, deleteWaiter = null, alertTimer = null;   // "내역 추가" / "신청" / "삭제" 결과 대기
  let overlapClicked = false; // 신청 단계에서 "출장/회의/식대 중복참여확인" 버튼을 눌렀는지
  let listLoadedTs = 0;       // 청구내역 목록 조회(rexpe_0001_01_r018) 응답이 마지막으로 온 시각
  let seenSvc = [];           // "내역 추가"/"신청" 클릭 뒤 캡처된 .jct 서비스 (결과를 못 받았을 때 어디까지 갔는지 진단용)
  let callSeq = 0;
  const callWaiters = new Map();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  /* 주소의 청구 준비 파라미터. krext_appr 는 훅이 그 미청구 행을 자동 선택하는 승인번호, krext_prep 은 행 선택 없이 준비 항목만 찾는 승인번호(이미 청구된 거래의 결의서 신청) */
  const prepQuery = () => {
    try { const sp = new URLSearchParams(location.search); return { appr: (sp.get('krext_appr') || sp.get('krext_prep') || '').trim(), card4: (sp.get('krext_card') || '').replace(/\D/g, '').slice(-4), auto: (sp.get('krext_auto') || '').trim() }; }
    catch (e) { return { appr: '', card4: '', auto: '' }; }
  };
  const b64ToFile = (f) => {
    const bin = atob(String(f.b64 || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name, { type: f.mime || 'application/octet-stream', lastModified: Date.now() });
  };
  const bgSend = (msg) => { try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch (e) { return Promise.resolve(null); } };
  const autoMode = (ms) => { try { document.dispatchEvent(new CustomEvent('krext-auto-mode', { detail: String(ms || 0) })); } catch (e) {} };
  const autoApply = (ms) => { try { document.dispatchEvent(new CustomEvent('krext-auto-apply', { detail: String(ms || 0) })); } catch (e) {} };   // MAIN 훅: 신청 단계(확인창 자동 확인 + 결재선 팝업 가로채기)
  const autoDelete = (ms) => { try { document.dispatchEvent(new CustomEvent('krext-auto-delete', { detail: String(ms || 0) })); } catch (e) {} };   // MAIN 훅: 삭제 단계(삭제 확인창 자동 확인)
  function setSt(k, msg, err) { prepSt[k] = msg || ''; prepSt[k + 'Err'] = !!err; renderPrepBar(); }

  async function loadPrep() {
    const q = prepQuery();
    if (!q.appr) return;
    prepAuto = q.auto;
    prepSteps = new Set(prepAuto.split(/[,+\s]+/).filter(Boolean));
    if (prepAuto && !hasStep('add') && !hasStep('apply') && !hasStep('delete')) prepSteps.add('add');   // 알 수 없는 값은 내역 추가로
    if (!cfg || !cfg.enabled) { if (prepAuto) reportRun(false, '설정의 청구서(카드) 입력 도우미가 꺼져 있어 자동 처리를 할 수 없습니다'); return; }
    const r = await bgSend({ type: 'prepGet', appr: q.appr, card4: q.card4, withFiles: !prepAuto || hasStep('add') });
    if (stopped) return;
    if (!r || !r.entry) { if (prepAuto) reportRun(false, '패널에 준비된 항목이 없습니다 (지워졌거나 다른 브라우저의 항목)'); return; }
    if (!r.entry.type && !r.entry.ptcl && !(r.entry.files || []).length && !(prepAuto && !hasStep('add'))) {
      if (prepAuto) reportRun(false, '패널에 준비된 항목(청구종류·청구내역·파일)이 없습니다');
      return;
    }
    prep = r.entry;
    prepFiles = (r.files || []).filter((f) => f && f.b64).map((f) => { try { return b64ToFile(f); } catch (e) { return null; } }).filter(Boolean);
    const missing = (r.files || []).filter((f) => f && !f.b64).map((f) => f.name);
    if (missing.length) setSt('files', `내용이 없는 파일 제외: ${missing.join(', ')}`, true);
    log('청구 준비', prep.key, prep.type || '(청구종류 없음)', prep.ptcl ? '청구내역 있음' : '(청구내역 없음)', prepFiles.length, '개 파일, 자동:', prepAuto || '없음');
    if (prepAuto && hasStep('delete')) { runDeleteOnly(); return; }   // 내역 추가된 청구내역 삭제 (행 선택 없음)
    if (prepAuto && !hasStep('add')) { runApplyOnly(); return; }   // 저장된 결의서 신청만 (행 선택 없음)
    if (document.documentElement.dataset.krextRowSelected === q.appr) runPrep();   // 훅이 이미 행을 골랐음
    else if (prepAuto) setTimeout(() => {   // 자동 처리인데 60초 안에 행 선택 신호가 없으면(이미 청구된 거래 등) 실패로 보고
      if (!stopped && prep && !prepRunning && !prepReported && document.documentElement.dataset.krextRowSelected !== q.appr) reportRun(false, '청구서 화면에서 이 승인번호의 미청구 행을 찾지 못했습니다 (이미 청구됐거나 목록에 없음)');
    }, 60000);
    scheduleScan();
  }
  /* 백그라운드(prepRunResult)에 보고. state: saved(내역 추가됨 — 신청 단계가 남았으면 final=false 인 진행 보고) · applied(신청됨) · deleted(임시저장 삭제됨) · failed.
   * saved 플래그는 내역 추가(임시저장)가 이미 된 상태인지 — 신청에 실패해도 결의서는 남아 있음을 패널이 알 수 있게 */
  function report(state, msg, extra) {
    if (!prepAuto) return;
    const final = !(state === 'saved' && hasStep('apply'));
    if (final) { if (prepReported) return; prepReported = true; }
    const last = document.documentElement.dataset.krextAlert || '';
    if (state === 'failed' && !prepAlerts.length && last) prepAlerts.push(last);
    log('자동 처리 보고', state, final ? '(끝)' : '(진행)', msg, prepAlerts);
    bgSend(Object.assign({ type: 'prepRunResult', key: prep ? prep.key : '', appr: prepQuery().appr, state, final, ok: state !== 'failed', msg: String(msg || ''),
      alerts: prepAlerts.slice(0, 5), saved: !!prepSaved || state === 'saved' || state === 'applied' }, extra || {}));
  }
  const reportRun = (ok, msg) => report(ok ? 'saved' : 'failed', msg);
  function mkBtn(text, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); }); return b; }
  function ensurePrepBar(f) {
    if (!prep) return;
    if (!prepBar) { prepBar = document.createElement('div'); prepBar.className = 'krext-prep-bar'; renderPrepBar(); }
    const anchor = f.bgtRow.closest('table') || f.bgtRow;
    if (!prepBar.isConnected || prepBar.nextElementSibling !== anchor) { ensureStyle(); anchor.insertAdjacentElement('beforebegin', prepBar); }
  }
  function renderPrepBar() {
    if (!prepBar || !prep) return;
    const st = (k) => prepSt[k] ? `<span class="krext-prep-st${prepSt[k + 'Err'] ? ' krext-err' : ''}">${esc(prepSt[k])}</span>` : '';
    const names = (prep.files || []).map((x) => x.name).join(', ');
    const modeNm = !prepAuto ? '' : hasStep('delete') ? ' · 자동 삭제' : !hasStep('add') ? ' · 자동 신청' : hasStep('apply') ? ' · 자동 작성+신청' : ' · 자동 작성';
    let html = `<span class="krext-prep-ttl">eClass 패널에서 준비한 항목</span><span class="krext-prep-dim">승인번호 ${esc(prep.appr)}${modeNm}</span>`;
    if (prep.type) html += `<span>청구종류 <b>${esc(prep.type)}</b> ${st('type')}</span>`;
    if (prep.ptcl) html += `<span>청구내역 <b title="${esc(prep.ptcl)}">${esc(prep.ptcl.length > 30 ? prep.ptcl.slice(0, 30) + '…' : prep.ptcl)}</b> ${st('ptcl')}</span>`;
    if ((prep.files || []).length) html += `<span>첨부 <b>${prepFiles.length}개</b> <span class="krext-prep-dim">${esc(names)}</span> ${st('files')}</span>`;
    if ((prepAuto && hasStep('add')) || prepSt.add) html += `<span>내역 추가 ${st('add')}</span>`;
    if ((prepAuto && hasStep('apply')) || prepSt.apply) html += `<span>신청 ${st('apply')}</span>`;
    if ((prepAuto && hasStep('delete')) || prepSt.del) html += `<span>임시저장 삭제 ${st('del')}</span>`;
    prepBar.innerHTML = html;
    const btns = document.createElement('span');
    btns.className = 'krext-prep-btns';
    if (prep.type) { const b = mkBtn('청구종류 적용', () => applyPrepType()); b.disabled = prepRunning; btns.appendChild(b); }
    if (prep.ptcl) { const b = mkBtn('청구내역 적용', () => applyPrepPtcl()); b.disabled = prepRunning; btns.appendChild(b); }
    if (prepFiles.length && cfg && cfg.dragDrop) { const b = mkBtn(prepAttachDone ? '파일 다시 첨부' : '파일 첨부', () => attachPrep(true)); b.disabled = prepRunning; btns.appendChild(b); }
    btns.appendChild(mkBtn('준비 항목 지우기', clearPrep));
    prepBar.appendChild(btns);
  }
  async function clearPrep() {
    if (!prep) return;
    if (!confirm('패널에서 준비한 청구종류·청구내역·파일을 지울까요? (이 거래의 준비 항목만)')) return;
    await bgSend({ type: 'prepClear', key: prep.key });
    prep = null; prepFiles = [];
    if (prepBar) { prepBar.remove(); prepBar = null; }
    toast('준비 항목을 지웠습니다.', 2500);
  }
  async function waitForm(ms) {
    const st = Date.now();
    while (!stopped && Date.now() - st < ms) {
      const f = (current && current.sel1 && current.sel1.isConnected) ? current : (current = findForm());
      if (f) return f;
      await sleep(300);
    }
    return null;
  }
  /* 행 선택 뒤: 청구종류 → 파일 → (자동이면) 내역 추가 */
  async function runPrep() {
    if (!prep || prepRunning || stopped) return;
    prepRunning = true; renderPrepBar();
    if (prepAuto) autoMode(300000);
    try {
      const f = await waitForm(20000);
      if (!f) { setSt('type', '청구내역 폼을 찾지 못했습니다', true); if (prepAuto) reportRun(false, '청구내역 폼을 찾지 못했습니다'); return; }
      await sleep(800);   // 행 선택 뒤 화면이 폼을 채우고 기본값(비목·RCMS)이 들어갈 시간
      if (prep.type && !prepTypeDone) {
        const ok = await applyPrepType();
        if (!ok && prepAuto) { reportRun(false, `청구종류 "${prep.type}" 을 세목 목록에서 찾지 못했습니다`); return; }
        const st = Date.now();   // 세목 변경 → 청구종류 라디오 선택(watchClaimType, tick 700ms)이 끝날 때까지
        await sleep(1200);
        while (typeApplying && !stopped && Date.now() - st < 8000) await sleep(250);
      }
      if (prep.ptcl && !prepPtclDone) await applyPrepPtcl();   // 칸을 못 찾아도 계속 — 그러면 화면 검증 alert("청구내역이 입력되지 않았습니다.")가 실패 사유로 보고된다
      if (prepFiles.length && !prepAttachDone && cfg.dragDrop) {
        if (prep.attached && !prepAuto) setSt('files', `${clock(prep.attached.ts)} 에 이미 첨부한 파일 — 다시 올리려면 "파일 다시 첨부"`);
        else {
          await sleep(400);
          const ok = await attachPrep(false);
          if (!ok && prepAuto) { reportRun(false, `첨부 실패: ${prepSt.files}`); return; }
        }
      }
      if (hasStep('add')) {   // 첨부·세목 처리 중 화면이 적요를 되돌렸으면 다시 넣고 저장, 이어서(add,apply) 결의서 신청
        await sleep(1000); if (prep.ptcl) await applyPrepPtcl(true);
        const saved = await addLine();
        if (saved && hasStep('apply')) await applyStep();
      }
    } catch (e) { log('runPrep 오류', e); if (prepAuto) reportRun(false, String((e && e.message) || e)); }
    finally { prepRunning = false; if (prepAuto) autoMode(0); renderPrepBar(); }
  }
  async function applyPrepType() {
    const want = norm(prep.type);
    const item = cfg.picks.find((p) => p.label === prep.type) || cfg.picks.find((p) => norm(p.label) === want) || { label: prep.type, kw: prep.type, type: '' };
    setSt('type', '적용 중…');
    while (picking && !stopped) await sleep(200);
    const ok = await pick(item, null);
    prepTypeDone = !!ok;
    setSt('type', ok ? '적용됨' : '세목 목록에서 찾지 못함', !ok);
    return !!ok;
  }
  /* 청구내역(적요) 칸: #REQ_PTCL(청구서 폼의 고정 ID, textarea 또는 글 입력) → 없으면 "청구내역"/"적요" 라벨 행의 입력란 */
  function findPtclField() {
    const byId = document.getElementById('REQ_PTCL');
    if (byId && byId.matches('textarea,input') && visible(byId)) return byId;
    const leaves = collectLeaves();
    for (const lab of ['청구내역', '적요']) {
      for (const el of leaves.get(norm(lab)) || []) {
        const r = rowFor(el, false); if (!r) continue;
        const f = Array.from(r.box.querySelectorAll('textarea,input[type=text],input:not([type])')).find((x) => !el.contains(x) && visible(x) && !x.readOnly && !x.disabled);
        if (f) return f;
      }
    }
    return null;
  }
  /* 화면(fnGetDataCutByByteLength)처럼 한글 2바이트 기준 1000바이트에서 자름 */
  const cutBytes = (s, max) => { let n = 0, out = ''; for (const ch of String(s || '')) { n += ch.charCodeAt(0) > 127 ? 2 : 1; if (n > max) break; out += ch; } return out; };
  /* 패널에 적은 청구내역을 폼에 넣는다 (화면 기본값이 있어도 덮어씀 — 이 거래에 대한 명시적 입력이므로).
   * recheck=true 는 "내역 추가" 직전 확인: 화면이 값을 되돌렸을 때만 다시 넣고 상태 문구는 바꾸지 않음 */
  async function applyPrepPtcl(recheck) {
    const want = cutBytes(prep.ptcl, 1000);
    const field = findPtclField();
    if (!field) { if (!recheck) setSt('ptcl', '청구내역 칸을 찾지 못했습니다 — 화면에서 직접 적으세요', true); return false; }
    if (field.value !== want) {
      field.value = want;
      for (const t of ['input', 'keyup', 'change']) field.dispatchEvent(new Event(t, { bubbles: true }));
      log(recheck ? '청구내역 다시 넣음 (화면이 되돌림)' : '청구내역', want.length, '자 →', field.id || field.name || field.tagName);
    }
    prepPtclDone = true;
    if (!recheck) setSt('ptcl', want.length < String(prep.ptcl || '').length ? '적용됨 (1000바이트에서 잘림)' : '적용됨');
    return true;
  }
  /* MAIN world 훅(rnd-hook.js callBridge)을 통해 화면 함수 호출 → { ok, error } */
  function pageCall(fn, args) {
    return new Promise((resolve) => {
      const id = 'c' + (++callSeq) + '_' + Date.now().toString(36);
      const timer = setTimeout(() => { callWaiters.delete(id); resolve({ ok: false, error: '응답 없음 (훅 미동작)' }); }, 5000);
      callWaiters.set(id, (r) => { clearTimeout(timer); resolve(r); });
      try { document.dispatchEvent(new CustomEvent('krext-call', { detail: JSON.stringify({ id, fn, args: args || [] }) })); }
      catch (e) { clearTimeout(timer); callWaiters.delete(id); resolve({ ok: false, error: String((e && e.message) || e) }); }
    });
  }
  /* MAIN world 전역값 읽기 (krext-call 의 get) → { ok, value } (원시값만) */
  function pageGet(path) {
    return new Promise((resolve) => {
      const id = 'g' + (++callSeq) + '_' + Date.now().toString(36);
      const timer = setTimeout(() => { callWaiters.delete(id); resolve({ ok: false, error: '응답 없음 (훅 미동작)' }); }, 3000);
      callWaiters.set(id, (r) => { clearTimeout(timer); resolve(r); });
      try { document.dispatchEvent(new CustomEvent('krext-call', { detail: JSON.stringify({ id, get: path }) })); }
      catch (e) { clearTimeout(timer); callWaiters.delete(id); resolve({ ok: false, error: String((e && e.message) || e) }); }
    });
  }
  const fileListCount = () => document.querySelectorAll('#fileList option').length;
  /* 파일등록 팝업(rcomm_0089_01.js btn_upload)과 같은 요청을 이 프레임에서 직접: multipart ATTFILE + USEFAC_SEQ_NO + OPER + REPLACE_FILE_NM → rcomm_0089_01_c001.jct
   * 응답 REC[](ATTFILE_SEQ_NO, SKEY, FILE_NM …) 을 화면 콜백 ctl.doUploadAttfile(행) 에 하나씩 넘긴다 (팝업의 fn_fileArrayPopOption 과 같고 POP_KEY 등은 청구서가 빈 값으로 넘김).
   * 화면이 파일을 거부하면(RCMS 과제의 zip·exe 등) 그 파일은 목록에 안 들어가므로 #fileList 의 option 수로 실제 첨부 수를 센다 */
  async function uploadDirect(files) {
    const skipped = files.filter(alwaysDenied).map((f) => f.name);
    const list = files.filter((f) => !alwaysDenied(f));
    if (!list.length) return { ok: false, reason: '올릴 수 있는 파일 없음', skipped };
    if (!document.getElementById('fileList')) return { ok: false, reason: '첨부 목록(#fileList)이 없는 화면', skipped };
    const fd = new FormData();
    for (const f of list) fd.append('ATTFILE', f, f.name);
    fd.append('USEFAC_SEQ_NO', hidVal('USEFAC_SEQ_NO') || cfg.usefacSeqNo || '10');
    fd.append('OPER', '');
    fd.append('REPLACE_FILE_NM', '');
    let data = null;
    try {
      const res = await fetch('/rcomm_0089_01_c001.jct', { method: 'POST', body: fd, credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });   // 팝업의 $.ajax 와 같은 요청
      if (!res.ok) return { ok: false, reason: `업로드 HTTP ${res.status}`, skipped };
      const buf = await res.arrayBuffer();
      const cs = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '');
      let text = '';
      try { text = new TextDecoder(cs ? cs[1] : 'euc-kr').decode(buf); } catch (e) { text = new TextDecoder('utf-8').decode(buf); }
      data = JSON.parse(text);
    } catch (e) { return { ok: false, reason: `업로드 요청 실패: ${(e && e.message) || e}`, skipped }; }
    const head = data && data.COMMON_HEAD;
    if (!data || (head && (head.ERROR === true || head.ERROR === 'true'))) return { ok: false, reason: `업로드 오류: ${(head && (head.MESSAGE || head.CODE)) || '응답 없음'}`, skipped };
    const rec = Array.isArray(data.REC) ? data.REC : [];
    if (!rec.length) return { ok: false, reason: '업로드 응답에 파일이 없음', skipped };
    const before = fileListCount();
    for (const row of rec) { const r = await pageCall('ctl.doUploadAttfile', [row]); if (!r.ok) log('doUploadAttfile 실패', r.error); }
    await sleep(150);
    const n = fileListCount() - before;
    log('직접 업로드', rec.length, '건 응답, 목록에', n, '건 추가');
    if (n <= 0) return { ok: false, reason: '화면 첨부 목록에 넣지 못함 (ctl.doUploadAttfile)', skipped };
    for (const row of rec.slice(n)) skipped.push(String(row.FILE_NM || ''));   // 화면이 거부한 파일(순서상 뒤쪽으로 추정)
    return { ok: true, n, skipped: skipped.filter(Boolean) };
  }
  async function attachPrep(manual) {
    const f = (current && current.sel1 && current.sel1.isConnected) ? current : (current = findForm());
    if (!f) { setSt('files', '청구내역 폼을 찾지 못했습니다', true); return false; }
    setSt('files', '올리는 중…');
    // 1) 팝업 없이 업로드 서비스에 직접 올리고 화면 콜백으로 첨부 목록에 넣기
    const direct = await uploadDirect(prepFiles);
    if (direct.ok) {
      prepAttachDone = true;
      setSt('files', `${direct.n}개 첨부됨${direct.skipped.length ? ` (제외: ${direct.skipped.join(', ')})` : ''}`);
      bgSend({ type: 'prepAttached', key: prep.key, n: direct.n });
      return true;
    }
    log('직접 업로드 실패 →', direct.reason);
    if (!f.attach || !cfg.dragDrop) { setSt('files', `첨부 실패: ${direct.reason}`, true); return false; }
    // 2) 첨부 창(팝업) 경로: 사용자 클릭이면 팝업이 열리고, 자동이면 팝업 차단에 걸릴 수 있음
    setSt('files', manual ? '첨부 창에 넘기는 중…' : '첨부 창을 여는 중…');
    const res = await dropFiles(f.attach, prepFiles);
    if (res.ok) { prepAttachDone = true; setSt('files', `${res.n}개 올림`); bgSend({ type: 'prepAttached', key: prep.key, n: res.n }); return true; }
    if (res.reason === 'blocked') setSt('files', `직접 업로드 실패(${direct.reason}), 첨부 창은 브라우저가 막음 — "파일 첨부" 버튼을 누르세요`, true);
    else setSt('files', `첨부 실패(${direct.reason} / ${res.reason}) — "파일 첨부" 버튼으로 다시 시도`, true);
    return false;
  }
  /* "내역 추가"(#btn_listAdd) 를 눌러 청구내역 저장. 결과는 rexpe_0083_01_c001 응답(MAIN 훅의 .jct 캡처 postMessage) 또는 alert 문구(검증 실패)로 판단하고,
   * 캡처를 놓친 경우에 대비해 화면 변화(토스트 "정상적으로 처리되었습니다", 청구내역 목록 행 증가, 목록 재조회 r018)로도 성공을 본다.
   * 화면의 클릭 처리기는 이중 클릭 방지 플래그 dbclick 이 false 면 아무 것도 하지 않으므로(지난 저장 처리 중) 먼저 true 가 되길 기다리고,
   * 클릭 뒤 20초 동안 화면 요청도 alert 도 없으면(반응 없음) 한 번 더 누른다. 저장됐으면 true */
  const newestReqNo = () => { const tr = listRows()[0]; const i = tr && tr.querySelector('input.REQ_SEQ_NO_REC,input[name=REQ_SEQ_NO_REC]'); return i ? String(i.value || '').trim() : ''; };
  /* 클릭 뒤 화면 변화 감시: 성공 토스트 · 목록 행 증가 · 목록 재조회 → { type:'saved', via:'dom' } */
  function watchAddDom(rowsBefore, clickedAt) {
    let obs = null, timer = null, done = false;
    const p = new Promise((resolve) => {
      const check = () => {
        if (done) return;
        const toast = /정상적으로\s*처리\s*되었습니다/.test((document.body && document.body.textContent) || '');
        const grown = listRows().length > rowsBefore;
        const reloaded = listLoadedTs > clickedAt;
        if (toast || grown || reloaded) { done = true; resolve({ type: 'saved', via: toast ? 'toast' : grown ? 'rows' : 'reload', reqNo: newestReqNo() }); }
      };
      try { obs = new MutationObserver(check); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) {}
      timer = setInterval(check, 1000);
    });
    return { promise: p, stop: () => { done = true; if (obs) obs.disconnect(); clearInterval(timer); } };
  }
  async function addLine() {
    setSt('add', '누르는 중…');
    const btn = document.getElementById('btn_listAdd') || findButton(['내역추가', '청구내역추가']);
    if (!btn) { setSt('add', '"내역 추가" 버튼을 찾지 못했습니다', true); report('failed', '"내역 추가" 버튼을 찾지 못했습니다'); return false; }
    let dbclick = null;
    for (let i = 0; i < 20 && !stopped; i++) {   // 화면의 이중 클릭 방지 플래그: false 면 클릭이 무시되므로 최대 10초 기다림
      const r = await pageGet('dbclick'); dbclick = r.ok ? r.value : null;
      if (dbclick !== false) break;
      if (i === 0) setSt('add', '화면의 이전 처리가 끝나기를 기다리는 중…');
      await sleep(500);
    }
    prepAlerts = [];
    listLoadedTs = 0;   // 저장 뒤 화면이 목록을 다시 읽는(rexpe_0001_01_r018) 것을 신청 단계가 기다림
    seenSvc = [];
    const rowsBefore = listRows().length;
    const result = new Promise((resolve) => { addWaiter = resolve; });
    const clickedAt = Date.now();
    const dom = watchAddDom(rowsBefore, clickedAt);
    const wait = (ms) => Promise.race([result, dom.promise, new Promise((r) => setTimeout(() => r({ type: 'timeout' }), ms))]);
    setSt('add', '누름 — 저장 응답 기다리는 중…');
    log('내역 추가 클릭', { dbclick, rowsBefore, btn: btn.tagName + (btn.id ? '#' + btn.id : '') });
    btn.click();
    let res = await wait(20000);
    if (res.type === 'timeout' && !seenSvc.length && !prepAlerts.length && addWaiter) {   // 화면이 아무 반응이 없음(요청·alert 없음) → 한 번 더
      log('내역 추가: 20초 동안 반응 없음 → 다시 클릭');
      setSt('add', '화면이 반응하지 않아 다시 누름…');
      btn.click();
      res = await wait(45000);
    } else if (res.type === 'timeout') res = await wait(40000);
    dom.stop();
    addWaiter = null; clearTimeout(alertTimer);
    if (res.type === 'saved') {
      prepSaved = { reqNo: String(res.reqNo || ''), reqCnt: String(res.reqCnt || '') };
      setSt('add', `저장됨${res.reqNo ? ` (청구번호 ${res.reqNo})` : ''}${res.via ? ` · ${res.via === 'toast' ? '토스트' : res.via === 'rows' ? '목록 행' : '목록 재조회'}로 확인` : ''}`);
      report('saved', `청구내역 추가됨${res.reqNo ? ` · 청구번호 ${res.reqNo}` : ''}${prepAlerts.length ? ' · ' + prepAlerts.join(' / ') : ''}`, prepSaved);
      return true;
    }
    if (res.type === 'error' || res.type === 'alert') { setSt('add', res.msg, true); report('failed', res.msg); }
    else {
      const diag = seenSvc.length ? `클릭 뒤 화면 요청 ${seenSvc.join(', ')} 까지 갔으나 저장 요청(rexpe_0083_01_c001)이 없음` : `클릭에 화면이 반응하지 않음 (요청·alert 없음${dbclick === false ? ', dbclick=false' : dbclick == null ? ', dbclick 읽기 실패' : ''})`;
      setSt('add', `결과를 확인하지 못했습니다 — ${diag}. 탭에서 확인하세요`, true);
      report('failed', `"내역 추가" 결과를 확인하지 못했습니다 — ${diag} (탭에서 확인)`);
    }
    return false;
  }

  /* ---------- 신청 (결의서 결재요청) ----------
   * 화면 흐름(rexpe_0083_01.js btnApprProc): #btn_apprProc 클릭 → 검증(alert: 청구내역 없음, 계좌·연구수당 한도 등) → 출장/회의/식대 중복확인이 버튼 방식(OVERLAP_CHK_TYPE B)인 화면에서
   * 회의비·출장·식대 건이 있으면 alert("출장/회의/식대 중복참여확인 버튼을 통해 중복여부 확인해주세요.") → uf_checkParam(5) → fn_CheckReqPtcl → ctl.call_Appl_Popup()
   *  → 기본결재선 설정(sysConfig.P11_BASE_APPRLINE_STGUP)이 90(일반)이면 appr0043_13.act 결재정보 팝업(저장된 결재선 목록 — handleGeneralApprPopup), 아니면 rcomm_0043_01.act 팝업(부서 10 / 본인 20 / 과제담당자 그룹 30·40·50·60·70·B0001·B0017 / 과제책임자 80)
   *  → 팝업 "결재요청"이 opener.uf_rcomm_0043_01Params(popKey, {APPR_USER_GB, APPR_USER_ID, APPR_DEPT_CD, ADD_RSPR_APPRLINE_YN, ONLINE_APPR_YN, APPL_CONT}) → ctl.uf_submit(5) → rexpe_0001_01_c003 → 토스트 "정상적으로 처리되었습니다."
   * 백그라운드 탭에서는 팝업이 차단되므로 MAIN 훅이 jexNewWin 을 가로채(krext-appr-popup) 여기서 팝업 문서를 같은 POST 로 받아 hidden 값·체크박스 기본값을 읽고,
   * 팝업 스크립트(rcomm_0043_01.js fn_screenInit)와 같은 서비스로 결재선을 정한 뒤 화면 콜백을 부른다(handleApprPopup). 중복참여확인 alert 가 오면 #btn_overlapChk 를 눌러 준다
   * (중복이 없으면 화면이 confirm("…신청하시겠습니까?") 뒤 신청 버튼을 다시 누름 — 훅이 자동 확인). 결과는 rexpe_0001_01_c003 응답 또는 alert 문구 */
  const listRows = () => Array.from(document.querySelectorAll('table#newExpList tbody tr')).filter((tr) => tr.id !== 'expListForm' && tr.id !== 'expListFormHeader' && visible(tr));
  /* 청구내역 목록이 (다시) 읽힐 때까지: r018 응답이 온 뒤 잠시, 또는 이미 행이 있으면(늦게 시작해 응답을 못 본 경우) 바로 */
  async function waitList(ms) {
    const st = Date.now();
    while (!stopped && Date.now() - st < ms) {
      if (listLoadedTs > st - 1000 || (listLoadedTs === 0 && listRows().length && Date.now() - st > 1500)) break;
      await sleep(250);
    }
    await sleep(700);   // 목록 그리기
  }
  /* 화면과 같은 규약으로 .jct 서비스 호출 (이 프레임의 세션): POST _JSON_=encodeURIComponent(encodeURIComponent(JSON)), 응답 euc-kr JSON. 오류(COMMON_HEAD.ERROR)는 예외 */
  async function jct(service, input) {
    const res = await fetch(`/${service}.jct`, { method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: '_JSON_=' + encodeURIComponent(encodeURIComponent(JSON.stringify(input || {}))) });
    if (!res.ok) throw new Error(`${service} HTTP ${res.status}`);
    const data = await readJson(res);
    if (!data) throw new Error(`${service} 응답이 JSON 이 아님`);
    const head = data.COMMON_HEAD;
    if (head && (head.ERROR === true || head.ERROR === 'true')) throw new Error(`${service} 오류: ${head.MESSAGE || head.CODE || ''}`);
    return data;
  }
  async function readText(res) {
    const buf = await res.arrayBuffer();
    const cs = /charset=([\w-]+)/i.exec(res.headers.get('content-type') || '');
    try { return new TextDecoder(cs ? cs[1] : 'euc-kr').decode(buf); } catch (e) { return new TextDecoder('utf-8').decode(buf); }
  }
  async function readJson(res) { try { return JSON.parse(await readText(res)); } catch (e) { return null; } }
  async function applyStep() {
    setSt('apply', '청구내역 목록 확인 중…');
    await waitList(hasStep('add') ? 12000 : 25000);
    if (stopped) return;
    const slip = slipStatus();
    if (slip.locked) { setSt('apply', `이미 ${slip.nm || '신청'} 상태입니다`); report('applied', `${lockedMsg(slip)} — 다시 신청할 필요가 없습니다`, prepSaved || {}); return; }   // 화면에서 직접 신청했거나 지난 신청 보고를 놓친 경우
    if (!listRows().length) { setSt('apply', '신청할 청구내역이 없습니다', true); report('failed', '신청할 청구내역이 없습니다 (결의서가 비어 있음)'); return; }
    const btn = document.getElementById('btn_apprProc');
    if (!btn || !visible(btn)) { setSt('apply', '"신청" 버튼이 없습니다', true); report('failed', `"신청" 버튼이 없습니다 (승인구분 ${slip.nm || slip.cd || '없음'} — 신청할 수 없는 상태)`); return; }
    setSt('apply', '신청 중…');
    autoApply(150000);
    prepAlerts = []; overlapClicked = false; seenSvc = [];
    const result = new Promise((resolve) => { applyWaiter = resolve; });
    btn.click();
    const timeout = new Promise((r) => setTimeout(() => r({ type: 'timeout' }), 120000));
    const res = await Promise.race([result, timeout]);
    applyWaiter = null; clearTimeout(alertTimer);
    autoApply(0);
    const tail = prepSaved && prepSaved.reqNo ? ` · 청구번호 ${prepSaved.reqNo}` : '';
    if (res.type === 'applied') { setSt('apply', '신청됨'); report('applied', `신청됨 (결재요청)${tail}${prepAlerts.length ? ' · ' + prepAlerts.join(' / ') : ''}`, prepSaved || {}); }
    else if (res.type === 'error' || res.type === 'alert') { setSt('apply', res.msg, true); report('failed', `신청 실패: ${res.msg}`); }
    else {
      const diag = seenSvc.length ? `클릭 뒤 화면 요청 ${seenSvc.join(', ')} 까지 갔으나 신청 요청(rexpe_0001_01_c003)이 없음` : '클릭에 화면이 반응하지 않음 (요청·alert 없음)';
      setSt('apply', `결과를 확인하지 못했습니다 — ${diag}. 탭에서 확인하세요`, true); report('failed', `신청 결과를 확인하지 못했습니다 — ${diag} (탭에서 확인)`);
    }
  }
  /* krext_auto=apply (행 선택 없음): 이미 내역 추가된 결의서를 신청만. 청구서 화면은 PRJ_NO 로 열면 작성중 결의서(REQ_CNT -1 = 최근 차수)의 청구내역을 보여 준다 */
  async function runApplyOnly() {
    if (!prep || prepRunning || stopped) return;
    prepRunning = true; renderPrepBar();
    prepSaved = { reqNo: String((prep.run && prep.run.reqNo) || ''), reqCnt: String((prep.run && prep.run.reqCnt) || '') };
    autoMode(300000);
    try {
      const f = await waitForm(30000);
      if (!f) { setSt('apply', '청구서 화면을 찾지 못했습니다', true); report('failed', '청구서 화면(청구내역 폼)을 찾지 못했습니다'); return; }
      if (!slipCnt()) { setSt('apply', '새 결의서 폼으로 열려 목록이 비어 있습니다', true); report('failed', '청구서 화면이 저장된 결의서가 아니라 새 결의서 폼으로 열렸습니다(주소에 REQ_CNT 없음) — 탭에서 확인하세요'); return; }
      await applyStep();
    } catch (e) { log('runApplyOnly 오류', e); report('failed', String((e && e.message) || e)); }
    finally { prepRunning = false; autoMode(0); renderPrepBar(); }
  }
  /* ---------- 임시저장 삭제 (내역 추가된 청구내역 행의 [삭제]) ----------
   * 화면 흐름(rexpe_0083_01.js .DelLnk_Rec click): 결의서 상태가 10/20/50 이면 alert("신청/승인된 청구건은 추가/수정/삭제가 불가합니다.") → 원청구 행이 하나뿐이면
   * confirm("결의 내역의 모든 정보가 삭제됩니다.\n삭제하시겠습니까?") → rtask_0008_t04_01_d001(결의서 전체 삭제) 뒤 top.jex.tabs.close 로 이 화면 탭이 닫힘,
   * 아니면 confirm("해당 청구내역을 삭제하시겠습니까?") → rexpe_0001_01_d001 {USEFAC_SEQ_NO, REQ_SEQ_NO, TAX_CTRL_YN}. (도서 23 은 엑셀 다운로드 confirm 이 먼저 — 취소해도 삭제는 이어짐)
   * 행은 table#newExpList 의 tr(id = REQ_SEQ_NO, hidden .REQ_SEQ_NO_REC)에서 내역 추가 때 받은 청구번호(run.reqNo)로 찾는다. 저장된 결의서는 background prepRun 이 주소에 REQ_CNT(run.reqCnt)·APPR_DIV_CD=40 을
   * 붙여 연다 — PRJ_NO 만 주면 새 결의서 폼(hidden REQ_CNT 빈값, 목록 0건)이라 행이 없다(2026-09-25 CDP 확인). 결과는 삭제 서비스 응답, 또는 화면 탭이 닫혀(pagehide) 이 프레임이 사라지면 성공으로 본다.
   * 화면은 결의서 승인구분(APPL_LIST.APPR_DIV_CD)이 10 신청·20 승인이면 행에 [삭제] 링크를 아예 그리지 않고(부가세 청구건 BASIC_REQ_SEQ_NO 가 있는 행도) "신청" 버튼도 감추므로, 링크를 찾기 전에 승인구분을 읽어
   * 이미 신청·승인된 결의서면 "신청됨"(applied)으로 보고한다 — 패널이 임시저장으로 알고 있던 결의서를 화면에서 직접 신청한 경우(2026-09-25: "[삭제] 링크가 없습니다" 로만 실패해 원인을 알 수 없었음) */
  const slipCnt = () => String(((document.getElementById('REQ_CNT') || {}).value) || '').trim();   // 화면 hidden 의 결의서 차수 (주소 REQ_CNT 를 서버가 렌더. 새 결의서 폼이면 빈값)
  /* 결의서 승인구분(RD0039): 10 신청 · 20 승인 · 30 보완요청 · 40 임시저장(작성중) · 50/60 (화면이 신청·승인처럼 잠그는 상태). hidden #APPR_DIV_CD 는 처음엔 주소 파라미터(40)가 렌더된 초기값이고,
   * 화면이 결의서 정보를 받으면(fn_selApprResult) 실제 값으로 덮어쓰며 td#APPR_DIV_NM 에 이름, td#APPL_INFO 에 신청정보(차수·신청일·신청자·문서번호)를 쓴다. 청구내역 목록(r018)은 그 뒤에 그려지므로
   * waitList 뒤에 읽는다 (2026-09-25 CDP: 40 → 약 3.6초 뒤 10 "신청" → 행 표시) */
  const SLIP_LOCKED = ['10', '20', '50', '60'];
  const slipStatus = () => {
    const cd = hidVal('APPR_DIV_CD');
    const text = (sel) => ((document.querySelector(sel) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    return { cd, nm: text('td#APPR_DIV_NM'), info: text('td#APPL_INFO'), locked: SLIP_LOCKED.includes(cd) };
  };
  const lockedMsg = (s) => `이미 신청된 결의서입니다 (승인구분 ${s.nm || s.cd}${s.info ? ' · 신청정보 ' + s.info : ''})`;
  const rowByReqNo = (reqNo) => {
    if (!reqNo) return null;
    const byId = document.getElementById(reqNo);
    if (byId && byId.tagName === 'TR' && byId.closest('table#newExpList')) return byId;
    return listRows().find((tr) => Array.from(tr.querySelectorAll('input.REQ_SEQ_NO_REC,input[name=REQ_SEQ_NO_REC]')).some((i) => String(i.value || '').trim() === reqNo)) || null;
  };
  async function runDeleteOnly() {
    if (!prep || prepRunning || stopped) return;
    prepRunning = true; renderPrepBar();
    const reqNo = String((prep.run && prep.run.reqNo) || '').trim();
    autoMode(300000);
    try {
      const f = await waitForm(30000);
      if (!f) { setSt('del', '청구서 화면을 찾지 못했습니다', true); report('failed', '청구서 화면(청구내역 폼)을 찾지 못했습니다'); return; }
      setSt('del', '청구내역 목록 확인 중…');
      await waitList(25000);
      if (stopped) return;
      const curCnt = slipCnt();
      if (!curCnt) { setSt('del', '새 결의서 폼으로 열려 목록이 비어 있습니다', true); report('failed', '청구서 화면이 저장된 결의서가 아니라 새 결의서 폼으로 열렸습니다(주소에 REQ_CNT 없음) — 탭에서 확인하세요'); return; }
      const slip = slipStatus();
      if (slip.locked) { setSt('del', `${slip.nm || '신청'} 상태라 삭제할 수 없습니다`, true); report('applied', `${lockedMsg(slip)} — 삭제하려면 R&D ERP 에서 신청 취소 후`, { reqNo, reqCnt: curCnt }); return; }
      if (!reqNo) { setSt('del', '청구번호를 몰라 삭제할 행을 찾지 못했습니다', true); report('failed', '이 항목의 청구번호가 기록돼 있지 않아 삭제할 청구내역 행을 찾지 못했습니다 — 탭의 청구내역 목록에서 [삭제]를 직접 누르세요'); return; }
      const row = rowByReqNo(reqNo);
      if (!row) { setSt('del', `청구번호 ${reqNo} 행이 없습니다`, true); report('failed', `청구내역 목록(결의서 ${curCnt}차)에 청구번호 ${reqNo} 행이 없습니다 (이미 삭제됐거나 다른 결의서) — 탭에서 확인하세요`); return; }
      const link = row.querySelector('a.DelLnk_Rec') || Array.from(row.querySelectorAll('a')).find((a) => /삭제/.test(a.textContent || ''));
      if (!link) { setSt('del', '[삭제] 링크가 없습니다', true); report('failed', `그 행에 [삭제] 링크가 없습니다 (승인구분 ${slip.nm || slip.cd || '없음'} — 부가세 청구건이거나 화면이 삭제를 허용하지 않는 상태)`); return; }
      setSt('del', '삭제 중…');
      autoDelete(60000);
      prepAlerts = [];
      const result = new Promise((resolve) => { deleteWaiter = resolve; });
      const onGone = () => { if (deleteWaiter) { deleteWaiter = null; report('deleted', '결의서가 삭제되어 청구서 화면이 닫혔습니다 (이 건만 있던 결의서)'); } };   // 결의서 전체 삭제 → 화면 탭이 닫히면 응답을 못 받으므로 여기서 바로 보고
      window.addEventListener('pagehide', onGone, { once: true });
      link.click();
      const timeout = new Promise((r) => setTimeout(() => r({ type: 'timeout' }), 60000));
      const res = await Promise.race([result, timeout]);
      window.removeEventListener('pagehide', onGone);
      deleteWaiter = null; clearTimeout(alertTimer);
      autoDelete(0);
      if (res.type === 'deleted') { setSt('del', '삭제됨'); report('deleted', `임시저장 삭제됨 · 청구번호 ${reqNo}${res.whole ? ' (결의서 전체 삭제)' : ''}${prepAlerts.length ? ' · ' + prepAlerts.join(' / ') : ''}`); }
      else if (res.type === 'error' || res.type === 'alert') { setSt('del', res.msg, true); report('failed', `삭제 실패: ${res.msg}`); }
      else { setSt('del', '결과를 확인하지 못했습니다 — 탭에서 확인하세요', true); report('failed', '삭제 결과를 확인하지 못했습니다 (탭에서 확인)'); }
    } catch (e) { log('runDeleteOnly 오류', e); report('failed', String((e && e.message) || e)); }
    finally { prepRunning = false; autoMode(0); renderPrepBar(); }
  }
  /* 결재선 팝업 대신: 팝업 문서(rcomm_0043_01.act, 같은 POST 값)를 받아 hidden(BASE_APPRLINE_STGUP, APPR_DEPT_CD, PRJ_NO, USER_ID, USEFAC_SEQ_NO, PRJ_CHRG_GRP_CD, PURCH_APPR_GRP_GB, RTN_FUNC, POP_KEY)과
   * 체크박스 기본값(CHK_ONLINE_APPR_YN 온라인결재, CHK_ADD_RSPR_APPRLINE 과제책임자 추가)을 읽고, 팝업 스크립트 fn_screenInit 과 같은 규칙으로 기본 선택 결재선을 정해 화면 콜백을 부른다.
   * 팝업이 기본으로 고르는 항목 = 부서 결재선(10)은 부서 하나, 본인(20)은 본인, 과제담당자 그룹은 목록 중 본인(있으면) 아니면 첫 행, 과제책임자(80)는 과제책임자 */
  async function handleApprPopup(url, params) {
    if (/appr0043_13\.act/.test(url)) return handleGeneralApprPopup(url, params);   // 기본결재선 "일반" 은 결재정보 팝업(저장된 결재선 목록) — 아래 handleGeneralApprPopup
    setSt('apply', '결재선 정하는 중…');
    let doc = null;
    try {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) body.append(k, v == null ? '' : String(v));
      const res = await fetch(url.startsWith('/') ? url : '/' + url, { method: 'POST', body, credentials: 'include', cache: 'no-store' });
      if (!res.ok) return { ok: false, error: `결재선 팝업 문서 HTTP ${res.status}` };
      doc = new DOMParser().parseFromString(await readText(res), 'text/html');
    } catch (e) { return { ok: false, error: `결재선 팝업 문서를 받지 못했습니다: ${(e && e.message) || e}` }; }
    const val = (id) => { const el = doc.getElementById(id); return el ? String(el.value != null ? el.value : (el.textContent || '')).trim() : ''; };
    // 체크박스: checked 속성, 또는 인라인 스크립트가 .prop/.attr("checked", true) 로 켜는 경우
    const scriptOn = (id) => { const re = new RegExp('#' + id + '["\']\\)\\.(?:prop|attr)\\(\\s*["\']checked["\']\\s*,\\s*(?:true|["\'](?:checked|true)["\'])\\s*\\)'); return Array.from(doc.scripts).some((s) => re.test(s.textContent || '')); };
    const checked = (id) => { const el = doc.getElementById(id); return !!(el && (el.hasAttribute('checked') || el.checked)) || scriptOn(id); };
    const p = params || {};
    const stgup = String(p.BASE_APPRLINE_STGUP || '') || val('BASE_APPRLINE_STGUP');   // 화면이 넘긴 값 우선 (ASCII 라 인코딩 문제 없음)
    if (!stgup) return { ok: false, error: '기본결재선 정보가 없습니다 (팝업 문서에 BASE_APPRLINE_STGUP 이 없음 — 세션이 끊겼는지 확인)' };
    const usefac = val('USEFAC_SEQ_NO') || hidVal('USEFAC_SEQ_NO') || (cfg && cfg.usefacSeqNo) || '10';
    const prjNo = val('PRJ_NO') || String(p.PRJ_NO || '');
    const userId = val('USER_ID') || hidVal('USER_ID');
    let gubun = '2', pickId = '', pickNm = '';
    try {
      if (stgup === '10') {
        const d = await jct('rcomm_0043_01_r002', { USEFAC_SEQ_NO: usefac, DEPT_CD: val('APPR_DEPT_CD') || String(p.APPR_DEPT_CD || '') });
        gubun = '1'; pickId = String((d && d.APPR_DEPT_CD) || ''); pickNm = String((d && d.APPR_DEPT_NM) || '');
        if (!pickId) return { ok: false, error: '부서 결재선을 찾지 못했습니다' };
      } else if (stgup === '20') {
        pickId = userId; pickNm = val('USER_NM');
      } else if (stgup === '80') {
        const d = await jct('rcomm_0043_01_r004', { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo });
        pickId = String((d && d.PRJ_RSPR_EMP_ID) || ''); pickNm = String((d && d.PRJ_RSPR_EMP_NM) || '');
        if (!pickId) return { ok: false, error: '과제책임자 결재선을 찾지 못했습니다' };
      } else if (['30', '40', '50', '60', '70', 'B0001', 'B0017'].includes(stgup)) {
        let grp = val('PRJ_CHRG_GRP_CD');
        const purch = val('PURCH_APPR_GRP_GB');
        if ((stgup === 'B0001' && purch === '10') || stgup === '50') grp = 'B0001';
        else if ((stgup === 'B0009' && purch === '10') || stgup === '60') grp = 'B0009';
        else if (stgup === '70') grp = 'B0008';
        else {
          if (prjNo) { const d = await jct('rcomm_0102_01_r001', { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo }); grp = String((d && d.PRJ_CHRG_GRP_CD) || grp || ''); }
          if (stgup === 'B0017') grp = stgup;
        }
        const d = await jct('rcomm_0043_01_r001', { USER_GRP_CD: grp });
        const rec = Array.isArray(d && d.REC) ? d.REC : [];
        if (!rec.length) return { ok: false, error: `결재선 담당자 목록이 비어 있습니다 (그룹 ${grp || '없음'})` };
        const row = rec.find((r) => userId && String(r.APPR_USER_ID || '') === userId) || rec[0];
        pickId = String(row.APPR_USER_ID || ''); pickNm = String(row.APPR_USER_NM || '');
      } else return { ok: false, error: `지원하지 않는 기본결재선 구분(${stgup})` };
    } catch (e) { return { ok: false, error: `결재선 조회 실패: ${(e && e.message) || e}` }; }
    if (!pickId) return { ok: false, error: '결재선 항목을 정하지 못했습니다' };
    const line = {
      APPR_USER_GB: gubun,                                   // 2 사용자 / 1 부서
      APPR_USER_ID: gubun === '1' ? '' : pickId,
      APPR_DEPT_CD: gubun === '1' ? pickId : '',
      ADD_RSPR_APPRLINE_YN: checked('CHK_ADD_RSPR_APPRLINE') ? 'Y' : 'N',
      ONLINE_APPR_YN: checked('CHK_ONLINE_APPR_YN') ? 'Y' : 'N',
      APPL_CONT: p.APPL_CONT != null ? String(p.APPL_CONT) : val('APPL_CONT')   // 화면이 넘긴 값을 그대로 (팝업 문서의 값은 POST 인코딩(UTF-8 ↔ EUC-KR) 차이로 한글이 깨질 수 있음)
    };
    const rtn = val('RTN_FUNC') || 'uf_rcomm_0043_01Params';
    const popKey = val('POP_KEY') || '1';
    log('결재선', stgup, pickNm, line);
    setSt('apply', `결재요청 보내는 중… (결재선 ${pickNm || pickId}${line.ONLINE_APPR_YN === 'Y' ? ' · 온라인결재' : ''})`);
    const r = await pageCall(rtn, [popKey, line]);   // 화면 콜백 → 500ms 뒤 ctl.uf_submit(5) → rexpe_0001_01_c003
    if (!r.ok) return { ok: false, error: `화면 콜백(${rtn}) 호출 실패: ${r.error}` };
    return { ok: true };
  }
  /* 기본결재선 "일반"(sysConfig.P11_BASE_APPRLINE_STGUP 90)의 결재정보 팝업 appr0043_13.act 대신 (2026-09-25 팝업 인라인 스크립트·서비스 CDP 실측):
   * 팝업은 저장된 결재선 목록 appr0043_05 {USEFAC_SEQ_NO, USER_ID} → REC[{KEY, DAT}] 를 select 에 넣고(첫 KEY 가 "0" 이 아니면 "0 최근결재선" 을 앞에 붙임), 고른 결재선의 결재자 행을
   * appr0043_04 {…, APPRLINE_SEQ_NO} → REC[{APPR_ORD, DEPT_USER_GB(1 부서/2 사용자), APPR_USER_ID, USER_NM, POS_NM/APPR_POS_NM/APPR_POS_CD, DEPT_CD, DEPT_NM, APPRLINE_USER_GB(2 결재/3 합의/4 공람/5 접수/6 감사)}] 로 표에 그린다
   * (열릴 때는 select 가 아직 비어 APPRLINE_SEQ_NO 없이 조회돼 표가 비고, 사용자가 결재선을 골라야 채워짐). "결재요청"(#applyApprLine → uf_rcomm_0043_13Params)은 표의 행으로 action09("out") =
   * appr0043_12 {USEFAC_SEQ_NO, USER_ID, APPRLINE_NM:"최근결재선", APPRLINE_SEQ_NO, REC[행]} (내 최근결재선 등록. 같은 사람이 결재자·공람자면 alert 후 중단, 그 밖의 중복은 뒤 행 제거, 순번은 1부터 연속) 뒤
   * opener.uf_rcomm_0043_01Params(POP_KEY(문서에 없음), null) → 500ms 뒤 ctl.uf_submit(5) → rexpe_0001_01_c003. 여기서는 목록 순서대로 결재자 행이 있는 첫 결재선(보통 최근결재선)을 골라 같은 순서로 처리한다 */
  async function handleGeneralApprPopup(url, params) {
    setSt('apply', '결재선(일반) 정하는 중…');
    let doc = null;
    try {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) body.append(k, v == null ? '' : String(v));
      const res = await fetch(url.startsWith('/') ? url : '/' + url, { method: 'POST', body, credentials: 'include', cache: 'no-store' });
      if (!res.ok) return { ok: false, error: `결재정보 팝업 문서 HTTP ${res.status}` };
      doc = new DOMParser().parseFromString(await readText(res), 'text/html');
    } catch (e) { return { ok: false, error: `결재정보 팝업 문서를 받지 못했습니다: ${(e && e.message) || e}` }; }
    const val = (id) => { const el = doc.getElementById(id); return el ? String(el.value != null ? el.value : (el.textContent || '')).trim() : ''; };
    const usefac = val('USEFAC_SEQ_NO') || hidVal('USEFAC_SEQ_NO') || (cfg && cfg.usefacSeqNo) || '10';
    const userId = val('USER_ID') || hidVal('USER_ID');
    if (!userId) return { ok: false, error: '결재정보 팝업 문서에 USER_ID 가 없습니다 (세션이 끊겼는지 확인)' };
    if (val('FORM_PAPER_SEQ_NO')) return { ok: false, error: '기안서식(FORM_PAPER_SEQ_NO)이 있는 결재정보 팝업은 자동 신청을 지원하지 않습니다 — 탭에서 신청 버튼을 누르세요' };
    let picked = null, rows = [], names = [];
    try {
      const d = await jct('appr0043_05', { USEFAC_SEQ_NO: usefac, USER_ID: userId });
      const opts = (Array.isArray(d && d.REC) ? d.REC : []).map((r) => ({ key: String(r.KEY == null ? '' : r.KEY), name: String(r.DAT || '') }));
      if (opts.length && opts[0].key !== '0') opts.unshift({ key: '0', name: '최근결재선' });
      if (!opts.length) return { ok: false, error: '저장된 결재선이 없습니다 — R&D ERP 전자결재 › 결재선관리에서 개인결재선을 먼저 등록하세요' };
      names = opts.map((o) => o.name);
      for (const o of opts) {
        const r = await jct('appr0043_04', { USEFAC_SEQ_NO: usefac, USER_ID: userId, APPRLINE_SEQ_NO: o.key });
        const rec = Array.isArray(r && r.REC) ? r.REC : [];
        if (rec.length) { picked = o; rows = rec; break; }
      }
      if (!picked) return { ok: false, error: `결재선(${names.join(', ')})에 결재자가 없습니다 — 탭에서 신청 버튼을 눌러 결재선을 고르세요` };
    } catch (e) { return { ok: false, error: `결재선 조회 실패: ${(e && e.message) || e}` }; }
    // 팝업 표의 행(action58) → 등록 입력(action09): 부서(1)는 부서명·부서코드만, 사용자(2)는 사번·이름·직급
    const rec = rows.map((r) => {
      const dept = String(r.DEPT_USER_GB || '') === '1';
      return { APPR_ORD: String(r.APPR_ORD || ''), DEPT_USER_GB: String(r.DEPT_USER_GB || ''), POS_NM: dept ? '' : String(r.APPR_POS_NM || r.POS_NM || ''), USER_NM: dept ? String(r.DEPT_NM || '') : String(r.USER_NM || ''),
        APPR_USER_ID: dept ? '' : String(r.APPR_USER_ID || ''), DEPT_CD: String(r.DEPT_CD || ''), DEPT_NM: String(r.DEPT_NM || ''), APPRLINE_USER_GB: String(r.APPRLINE_USER_GB || ''), APPR_POS_CD: dept ? '' : String(r.APPR_POS_CD || ''), REQD_YN: 'N' };
    });
    const kept = [];
    for (const r of rec) {
      const dup = kept.find((k) => k.APPR_USER_ID === r.APPR_USER_ID);
      if (dup && r.APPRLINE_USER_GB === '4') return { ok: false, error: '결재자와 공람자를 동일인으로 지정할 수 없습니다 (결재선을 고치세요)' };
      if (!dup) kept.push(r);
    }
    if (kept.map((r) => Number(r.APPR_ORD)).sort((a, b) => a - b).some((n, i) => n !== i + 1)) return { ok: false, error: '결재자 순번이 1부터 연속이 아닙니다 (결재선을 고치세요)' };
    const who = kept.map((r) => r.USER_NM).filter(Boolean).join(' → ');
    log('결재선(일반)', picked.name, who, kept);
    setSt('apply', `결재요청 보내는 중… (결재선 ${picked.name}: ${who})`);
    try { await jct('appr0043_12', { USEFAC_SEQ_NO: usefac, USER_ID: userId, APPRLINE_NM: '최근결재선', APPRLINE_SEQ_NO: picked.key, REC: kept }); }
    catch (e) { return { ok: false, error: `최근결재선 등록(appr0043_12) 실패: ${(e && e.message) || e}` }; }
    const r = await pageCall('uf_rcomm_0043_01Params', [null, null]);   // 팝업처럼 결재선 객체 없이 → 500ms 뒤 ctl.uf_submit(5) → rexpe_0001_01_c003
    if (!r.ok) return { ok: false, error: `화면 콜백(uf_rcomm_0043_01Params) 호출 실패: ${r.error}` };
    return { ok: true };
  }
  const onApprPopup = (ev) => {
    let d = null; try { d = JSON.parse(String((ev && ev.detail) || '')); } catch (e) { return; }
    if (!applyWaiter || !d) return;
    handleApprPopup(String(d.url || ''), d.params || {}).then((r) => { if (!r.ok && applyWaiter) { const w = applyWaiter; applyWaiter = null; w({ type: 'error', msg: r.error }); } });
  };
  const onRowSelected = () => { if (prep && !prepRunning && (!prepAuto || hasStep('add'))) runPrep(); };
  const onPopupBlocked = () => { if (pending) { const p = pending; pending = null; p.resolve({ type: 'blocked' }); } };
  const onCallResult = (ev) => { let r = null; try { r = JSON.parse(String((ev && ev.detail) || '')); } catch (e) { return; } const w = r && callWaiters.get(r.id); if (w) { callWaiters.delete(r.id); w(r); } };
  const onAlert = (ev) => {   // 자동 처리 중 화면의 alert: 검증 실패 문구. 2.5초 안에 저장/신청 응답이 오지 않으면 그 문구를 실패 사유로
    const msg = String((ev && ev.detail) || '').trim(); if (!msg) return;
    prepAlerts.push(msg); log('alert', msg);
    if (applyWaiter && /중복참여확인\s*버튼/.test(msg) && !overlapClicked) {   // 신청 전에 "출장/회의/식대 중복참여확인" 버튼을 눌러야 하는 화면 설정: 눌러 주면 화면이 확인 뒤 신청을 이어 간다
      overlapClicked = true;
      const b = document.getElementById('btn_overlapChk') || findButton(['출장/회의/식대중복참여확인']);
      if (b) { setSt('apply', '출장/회의/식대 중복참여확인 중…'); setTimeout(() => { try { b.click(); } catch (e) {} }, 300); return; }
    }
    const kind = addWaiter ? 'add' : applyWaiter ? 'apply' : deleteWaiter ? 'delete' : '';
    if (!kind) return;
    if (kind === 'delete' && /^\[확인 필요\]/.test(msg)) return;   // 삭제 단계에서 일부러 취소한 확인창(도서 엑셀 다운로드 등)은 실패 사유가 아님
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => {
      const w = kind === 'add' ? addWaiter : kind === 'apply' ? applyWaiter : deleteWaiter;
      if (!w) return;
      if (kind === 'add') addWaiter = null; else if (kind === 'apply') applyWaiter = null; else deleteWaiter = null;
      w({ type: 'alert', msg });
    }, 2500);
  };
  const onJctMessage = (ev) => {   // MAIN 훅이 캡처한 .jct 호출 (rnd-bridge 와 같은 postMessage): 내역 추가 c001 / 신청 c003 결과, 목록 조회 r018 시각
    if (ev.source !== window || !ev.data || ev.data.__krext !== 'jct') return;
    const e = ev.data.entry; if (!e || !e.service) return;
    if ((addWaiter || applyWaiter || deleteWaiter) && seenSvc.length < 12 && !seenSvc.includes(e.service)) seenSvc.push(e.service);   // 진단: 클릭 뒤 어디까지 갔는지
    if (e.service === 'rexpe_0001_01_r018') { listLoadedTs = Date.now(); return; }
    const isAdd = e.service === 'rexpe_0083_01_c001', isApply = e.service === 'rexpe_0001_01_c003';
    const isDel = e.service === 'rexpe_0001_01_d001' || e.service === 'rtask_0008_t04_01_d001';
    const w = isAdd ? addWaiter : isApply ? applyWaiter : isDel ? deleteWaiter : null;
    if (!w) return;
    const text = String(e.response || '');
    let data = null; try { data = JSON.parse(text); } catch (x) {}
    const head = data && data.COMMON_HEAD;
    const isErr = head ? (head.ERROR === true || head.ERROR === 'true') : /"ERROR"\s*:\s*(true|"true")/.test(text);
    const msgM = /"MESSAGE"\s*:\s*"([^"]*)"/.exec(text);
    const reqM = /"REQ_SEQ_NO"\s*:\s*"([^"]*)"/.exec(text);
    const cntM = /"REQ_CNT"\s*:\s*"?([^",}]*)"?/.exec(text);
    if (isAdd) addWaiter = null; else if (isApply) applyWaiter = null; else deleteWaiter = null;
    clearTimeout(alertTimer);
    const what = isAdd ? '저장' : isApply ? '신청' : '삭제';
    if (e.status && e.status !== 200) w({ type: 'error', msg: `${what} 요청 HTTP ${e.status}` });
    else if (isErr) w({ type: 'error', msg: `${what} 오류: ${(head && (head.MESSAGE || head.CODE)) || (msgM && msgM[1]) || '알 수 없음'}` });
    else if (isAdd) w({ type: 'saved', reqNo: (data && data.REQ_SEQ_NO) || (reqM && reqM[1]) || '', reqCnt: (data && data.REQ_CNT) || (cntM && cntM[1]) || '' });
    else if (isDel) w({ type: 'deleted', whole: e.service === 'rtask_0008_t04_01_d001' });
    else w({ type: 'applied' });
  };
  function bindPrepEvents() {
    document.addEventListener('krext-row-selected', onRowSelected);
    document.addEventListener('krext-popup-blocked', onPopupBlocked);
    document.addEventListener('krext-call-result', onCallResult);
    document.addEventListener('krext-alert', onAlert);
    document.addEventListener('krext-appr-popup', onApprPopup);
    window.addEventListener('message', onJctMessage);
  }
  function unbindPrepEvents() {
    document.removeEventListener('krext-row-selected', onRowSelected);
    document.removeEventListener('krext-popup-blocked', onPopupBlocked);
    document.removeEventListener('krext-call-result', onCallResult);
    document.removeEventListener('krext-alert', onAlert);
    document.removeEventListener('krext-appr-popup', onApprPopup);
    window.removeEventListener('message', onJctMessage);
  }

  /* ---------- 감시 / 주기 처리 ---------- */
  function scan() {
    if (stopped || !cfg || !cfg.enabled || !document.body) return;
    if (!/예산/.test(document.body.textContent || '')) { current = null; stopTick(); return; }
    const f = current = findForm();
    if (!f) { stopTick(); return; }
    apply(f);
    if (!tickTimer) tickTimer = setInterval(tick, 700);
  }
  function apply(f) {
    if (cfg.dragDrop && f.attach) bindDropZone(f.attach);
    ensurePicks(f);
    if (!noRowMode()) {   // 행 선택 없는 자동 모드에선 기본값을 넣지 않는다 — 카드 행이 체크돼 있지 않으면 화면의 비목 change 핸들러가 값을 되돌리며 alert("청구할 카드사용내역을 먼저 선택해주세요.")
      if (cfg.defaultBudget) fillDefault(f.sel1, cfg.defaultBudget);
      if (cfg.defaultRcms) fillDefault(f.rcms, cfg.defaultRcms);
    }
    watchClaimType(f);
    if (prep) ensurePrepBar(f);
  }
  function tick() {
    if (stopped || !cfg || !cfg.enabled) { stopTick(); return; }
    let f = current;
    if (!f || !f.sel1 || !f.sel1.isConnected) { f = current = findForm(); if (!f) { stopTick(); return; } }
    apply(f);
  }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 350); }

  function teardownUi() {
    for (const el of document.querySelectorAll(OURS + ',#krext-claim-toast')) el.remove();
    for (const el of document.querySelectorAll('[data-krext-drop]')) el.classList.remove('krext-dropping');
    stopTick();
  }
  function teardown() {
    stopTick(); clearTimeout(scanTimer);
    if (observer) { observer.disconnect(); observer = null; }
    if (docDropHandlers) { document.removeEventListener('dragover', docDropHandlers.onDragover); document.removeEventListener('drop', docDropHandlers.onDrop); docDropHandlers = null; }
    if (channel) { try { channel.close(); } catch (e) {} channel = null; }
    unbindPrepEvents();
    prepBar = null;
    teardownUi();
    for (const el of document.querySelectorAll('[data-krext-drop]')) delete el.dataset.krextDrop;   // 새 스크립트가 다시 묶을 수 있게 (이 스크립트의 리스너는 stopped 라 동작 안 함)
    const st = document.getElementById('krext-claim-style'); if (st) st.remove();
  }

  function start() {
    if (stopped) return;
    observer = new MutationObserver(() => { if (cfg && cfg.enabled) scheduleScan(); });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    bindPrepEvents();
    loadCfg().then(() => {
      if (cfg && cfg.enabled && cfg.dragDrop) { initChannel(); announceUploadUi(); }
      loadPrep();   // 도우미가 꺼져 있으면 자동 작성 요청에만 실패를 보고
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
