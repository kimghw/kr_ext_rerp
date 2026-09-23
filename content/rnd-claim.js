/* rnd.krs.co.kr (isolated world, 모든 프레임): 청구서(카드) 입력 도우미
 * 과제 지출내역(카드 미청구 행)을 골라 "청구내역" 폼이 뜨면
 *  1) 예산(비목) 선택이 비어 있으면 기본값(연구활동비), RCMS 부가정보 > 사용금액구분이 비어 있으면 기본값(본예산)을 채우고
 *  2) "청구" 소제목 옆에 세목(회의비, 연구실운영비 …) 빠른 선택 버튼을 넣고
 *  3) 첨부문서 칸(행)에 파일을 끌어다 놓으면 화면의 파일 입력(input[type=file])에 넣어 첨부 처리를 시킨다.
 * 화면 요소는 ID 를 모르므로 라벨 문구("예산", "RCMS 부가정보", "첨부문서", "청구")로 찾는다. 값은 비어 있을 때만 채운다.
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
  const OURS = '.krext-qp,.krext-drop-hint,.krext-toast';

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
  const isOurs = (el) => el.classList && (el.classList.contains('krext-qp') || el.classList.contains('krext-drop-hint') || el.classList.contains('krext-toast'));
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
  let watchedSel2 = null, lastSel2Key = null, typeRun = 0;
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
  async function pick(item, btn) {
    if (picking) return;
    picking = true;
    if (btn) btn.disabled = true;
    try {
      let f = (current && current.sel1 && current.sel1.isConnected) ? current : (current = findForm());
      if (!f || !f.sel1) { toast('청구내역 폼을 찾지 못했습니다.'); return; }
      if (cfg.defaultBudget && isEmptySel(f.sel1)) {   // 비목이 비어 있으면 먼저 기본 비목을 고른 뒤 세목 목록이 채워지길 기다림
        const o = matchOption(f.sel1, cfg.defaultBudget);
        if (o) setOption(f.sel1, o);
      }
      const started = Date.now();
      while (Date.now() - started < 5000 && !stopped) {
        if (!f.sel2 || !f.sel2.isConnected) f = current = findForm() || f;
        const opt = f.sel2 ? matchOption(f.sel2, item.kw) : null;
        if (opt) { setOption(f.sel2, opt); toast(`${item.label} → ${opt.text.trim()}`, 1800); return; }
        await sleep(200);
      }
      toast(`'${item.kw}' 항목을 세목 목록에서 찾지 못했습니다.\n예산(비목)을 먼저 골랐는지 확인하세요.`);
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
  async function dropFiles(box, files) {
    let list = Array.from(files || []).filter((f) => f && f.name);
    if (!list.length) return;
    const bad = list.filter(alwaysDenied);
    if (bad.length) {
      toast(`첨부할 수 없는 파일 종류라 제외: ${bad.map((f) => f.name).join(', ')}`, 5000);
      list = list.filter((f) => !bad.includes(f));
      if (!list.length) return;
    }
    fiCache.ts = 0;
    const inputs = findFileInputs();
    if (inputs.length) {   // 화면 안에 파일 입력이 있는 경우: 바로 넣는다
      const n = await feedFiles(inputs[0], list);
      log('첨부', n, '건 →', inputs[0]);
      toast(`${n}개 파일을 첨부 처리했습니다. 목록에 안 보이면 "첨부" 버튼으로 올려 주세요.`, 3500);
      return;
    }
    // 파일 입력이 없는 화면(청구서: "첨부" 버튼이 파일등록 팝업 rcomm_0089_01.act 를 연다):
    // 파일을 보관해 두고 팝업을 연 뒤, 팝업에서 도는 이 스크립트가 파일을 받아 목록에 넣고 "업로드"를 누른다
    const btn = findAttachButton(box);
    if (!btn) { toast('첨부 버튼을 찾지 못했습니다. "첨부" 버튼으로 올려 주세요.', 5000); return; }
    if (!channel) { btn.click(); toast('첨부 창이 열리면 그 창에 파일을 끌어다 놓고 업로드를 눌러 주세요.', 6000); return; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const result = new Promise((resolve) => { pending = { id, files: list, ts: Date.now(), claimed: false, resolve }; });
    btn.click();                  // drop 이벤트 처리 중(await 전)에 눌러야 팝업 차단에 걸리지 않음
    post({ type: 'offer', id });  // 이미 열려 있던 팝업이면 이 신호를 받고 준비됐다고 알려 옴
    toast('첨부 창에 파일을 넘기는 중…', 20000);
    const timeout = new Promise((r) => setTimeout(() => r({ type: 'timeout' }), 20000));
    const res = await Promise.race([result, timeout]);
    const skipped = res.skipped && res.skipped.length ? `\n제외: ${skippedText(res.skipped)}` : '';
    if (res.type === 'done') toast(`${res.n}개 파일을 첨부 창에서 올렸습니다.` + skipped, skipped ? 8000 : 3500);
    else if (res.type === 'fail') toast(failText(res), 8000);
    else { if (pending && pending.id === id) pending = null; toast('첨부 창이 응답하지 않습니다. 그 창에 파일을 끌어다 놓고 업로드를 눌러 주세요.', 6000); }
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
    if (cfg.defaultBudget) fillDefault(f.sel1, cfg.defaultBudget);
    if (cfg.defaultRcms) fillDefault(f.rcms, cfg.defaultRcms);
    watchClaimType(f);
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
    teardownUi();
    for (const el of document.querySelectorAll('[data-krext-drop]')) delete el.dataset.krextDrop;   // 새 스크립트가 다시 묶을 수 있게 (이 스크립트의 리스너는 stopped 라 동작 안 함)
    const st = document.getElementById('krext-claim-style'); if (st) st.remove();
  }

  function start() {
    if (stopped) return;
    observer = new MutationObserver(() => { if (cfg && cfg.enabled) scheduleScan(); });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    loadCfg().then(() => { if (cfg && cfg.enabled && cfg.dragDrop) { initChannel(); announceUploadUi(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
