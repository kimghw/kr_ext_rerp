/* rnd.krs.co.kr (isolated world, 모든 프레임)
 * 1) MAIN world 훅이 보낸 .jct 캡처를 백그라운드로 전달
 * 2) 메인화면의 "미승인내역" 위젯을 DOM에서 읽어 스냅샷 저장 (서비스 미설정 시 대체 표시용) */
(() => {
  const send = (msg) => { try { return chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) {} };

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__krext !== 'jct') return;
    send({ type: 'jctCaptured', entry: ev.data.entry });
  });

  /* 로그인 사용자 식별자 → 참여인력 대조용
   * 레이아웃(rderp_layoutMain.act) 최상위 프레임: hidden input MAND_USER_ID(=사번, 전역 gUserId 와 동일)
   * 메인 프레임(rmain_0002_01.act): "OOO님, 안녕하세요." 인사말
   * 프레임마다 따로 보내면 백그라운드가 합친다. 인사말은 늦게 그려질 수 있어 몇 차례 재시도 */
  (function detectUser() {
    const val = (sel) => { const el = document.querySelector(sel); return el ? String(el.value || el.textContent || '').trim() : ''; };
    let lastKey = '';
    const attempt = () => {
      let userId = val('input#USER_ID') || val('input[name=USER_ID]') || val('input#SESSION_USER_ID') || val('input#MAND_USER_ID') || val('input[name=MAND_USER_ID]');
      if (!userId) {   // 인라인 스크립트의 var gUserId = "11115";
        for (const s of document.scripts) {
          if (s.src) continue;
          const m = /gUserId\s*=\s*['"]([^'"]+)['"]/.exec(s.textContent || '');
          if (m) { userId = m[1].trim(); break; }
        }
      }
      // EMP_NO 입력칸은 참여인력·인사 화면의 "대상자"(선택한 참여연구원) 사번이라 읽지 않는다 — 2026-09-24: 다른 연구원 사번이 본인으로 섞여 그 사람 과제·계상률이 본인 것으로 보였음.
      // 이 ERP 의 사번은 USER_ID(MAND_USER_ID / gUserId)와 같다
      const empNo = val('input#LOGIN_EMP_NO');
      let userNm = val('input#USER_NM') || val('input[name=USER_NM]') || val('input#EMP_NM');
      if (!userNm && document.body) {   // "OOO님, 안녕하세요." / "OOO님 반갑습니다"
        const m = /([가-힣A-Za-z]{2,20})\s*님[,\s]*(?:안녕하세요|반갑습니다)/.exec(document.body.innerText || '');
        if (m) userNm = m[1];
      }
      // 부서코드: 메인 대시보드(rmain_0002_01) 인라인 스크립트의 jsonValue["DEPT_CD"] = "HER" (결재대기 수 조회 rmain_0002_01_r001 의 DEPT_CD — 화면 hidden·전역에는 없음, 2026-09-25 확인)
      let deptCd = '';
      for (const s of document.scripts) {
        if (s.src) continue;
        const m = /\["DEPT_CD"\]\s*=\s*['"]([^'"]+)['"]/.exec(s.textContent || '');
        if (m) { deptCd = m[1].trim(); break; }
      }
      if (!userId && !empNo && !userNm) return false;
      const key = [userId, empNo, userNm, deptCd].join('|');
      if (key === lastKey) return true;
      lastKey = key;
      send({ type: 'rndUser', user: { userId, empNo, userNm, deptCd, page: location.pathname, ts: Date.now() } });
      return true;
    };
    attempt();
    for (const ms of [1000, 3000, 8000]) setTimeout(attempt, ms);
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
