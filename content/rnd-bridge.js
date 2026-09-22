/* rnd.krs.co.kr (isolated world, 모든 프레임)
 * 1) MAIN world 훅이 보낸 .jct 캡처를 백그라운드로 전달
 * 2) 메인화면의 "미승인내역" 위젯을 DOM에서 읽어 스냅샷 저장 (서비스 미설정 시 대체 표시용) */
(() => {
  const send = (msg) => { try { return chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) {} };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__krext !== 'jct') return;
    send({ type: 'jctCaptured', entry: ev.data.entry });
  });

  /* 로그인 사용자 식별자 (화면의 hidden input: USER_ID / EMP_NO / USER_NM) → 참여인력 대조용 */
  (function detectUser() {
    const val = (sel) => { const el = document.querySelector(sel); return el ? String(el.value || el.textContent || '').trim() : ''; };
    const userId = val('input#USER_ID') || val('input[name=USER_ID]') || val('input#SESSION_USER_ID');
    const empNo = val('input#EMP_NO') || val('input[name=EMP_NO]') || val('input#LOGIN_EMP_NO');
    let userNm = val('input#USER_NM') || val('input[name=USER_NM]') || val('input#EMP_NM');
    if (!userNm && document.body) {   // 레이아웃 좌측의 "OOO님 반갑습니다"
      const m = /([가-힣A-Za-z]{2,20})\s*님\s*반갑습니다/.exec(document.body.innerText || '');
      if (m) userNm = m[1];
    }
    if (!userId && !empNo && !userNm) return;
    send({ type: 'rndUser', user: { userId, empNo, userNm, page: location.pathname, ts: Date.now() } });
  })();

  const LABELS = ['임시저장', '보완요청', '신청', '구매요청'];
  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const isLeaf = (el) => !el.children.length || Array.from(el.children).every((c) => /^(BR|IMG|I|EM|B|STRONG|SPAN|FONT|U)$/.test(c.tagName) && !c.children.length);
  const numOf = (el) => { const t = text(el); return /^-?[\d,]+$/.test(t) ? Number(t.replace(/,/g, '')) : null; };
  function leafByText(root, t) { for (const el of root.querySelectorAll('*')) if (isLeaf(el) && text(el) === t) return el; return null; }
  function numLeafIn(root, exclude) {
    if (root !== exclude && isLeaf(root) && numOf(root) != null) return root;
    for (const el of root.querySelectorAll('*')) if (el !== exclude && isLeaf(el) && numOf(el) != null) return el;
    return null;
  }
  function numberFor(labelEl, box) {
    const cell = labelEl.closest('th,td');
    if (cell && cell.parentElement) {
      const idx = cell.cellIndex; let r = cell.parentElement.nextElementSibling;
      while (r) { const c = r.cells && r.cells[idx]; if (c) { const n = numLeafIn(c); if (n) return n; } r = r.nextElementSibling; }
    }
    let node = labelEl;
    for (let depth = 0; depth < 4 && node && node !== box; depth++) {
      let sib = node.nextElementSibling;
      while (sib) { const n = numLeafIn(sib); if (n) return n; sib = sib.nextElementSibling; }
      node = node.parentElement;
    }
    return labelEl.parentElement ? numLeafIn(labelEl.parentElement, labelEl) : null;
  }
  function scrape() {
    if (!document.body || !document.body.textContent.includes('미승인내역')) return null;
    let header = leafByText(document.body, '미승인내역');
    if (!header) header = Array.from(document.body.querySelectorAll('*')).find((el) => isLeaf(el) && text(el).includes('미승인내역') && text(el).length < 20);
    if (!header) return null;
    let box = header.parentElement;
    while (box && box !== document.body && !LABELS.every((l) => box.textContent.includes(l))) box = box.parentElement;
    if (!box || box === document.body) return null;
    const items = {}; let found = 0;
    for (const l of LABELS) {
      const le = leafByText(box, l); if (!le) continue;
      const ne = numberFor(le, box); if (!ne) continue;
      const a = ne.closest('a') || le.closest('a') || ne.querySelector('a');
      items[l] = { count: numOf(ne), href: a ? (a.getAttribute('href') || '') : '', onclick: a ? (a.getAttribute('onclick') || '') : '' };
      found++;
    }
    return found ? { ts: Date.now(), page: location.pathname + location.search, items } : null;
  }
  let last = '';
  function attempt() {
    const s = scrape(); if (!s) return;
    const key = JSON.stringify(s.items);
    if (key === last) return;
    last = key;
    send({ type: 'unapprovedSnapshot', snapshot: s });
  }
  attempt();
  let timer = null;
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(attempt, 1200); });
  if (document.body) obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  setTimeout(() => obs.disconnect(), 180000);
})();
