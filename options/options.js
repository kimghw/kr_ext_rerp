/* 설정 페이지 */
(async () => {
  const S = KRX_SETTINGS, F = KRX_FMT;
  const $ = (id) => document.getElementById(id);
  const setStatus = (id, text, isErr) => { const el = $(id); el.textContent = text || ''; el.classList.toggle('err', !!isErr); if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000); };

  let selected = new Set();     // 모니터링 카드 선택(숫자만)
  let issued = null;            // storage.local.issuedCards: { ts, projects: [{prjNo, prjNm, rspr, cards[], accounts[], acctKnown}] }
  let excluded = new Set();     // 제외한 과제번호
  let projectList = null;       // storage.local.projectList
  let overrides = {};           // { prjNo: { include: Set, exclude: Set } }

  const ovOf = (prjNo) => { if (!overrides[prjNo]) overrides[prjNo] = { include: new Set(), exclude: new Set() }; return overrides[prjNo]; };
  /* 카드의 이 과제 포함 여부 (계좌 일치 기본값 + 재정의) */
  function isIncluded(prjNo, c) {
    const ov = ovOf(prjNo);
    if (ov.exclude.has(c.digits)) return false;
    if (ov.include.has(c.digits)) return true;
    return c.acctMatch === null || c.acctMatch === undefined ? true : !!c.acctMatch;
  }

  /* ---------- 과제 선택 ---------- */
  function renderProjects() {
    const box = $('prjList');
    const projects = (projectList && projectList.projects) || [];
    const known = new Set(projects.map((p) => p.prjNo));
    const row = (p, missing) => {
      const on = !excluded.has(p.prjNo);
      const period = (p.stDt || p.endDt) ? `${F.fmtDate(p.stDt)} ~ ${F.fmtDate(p.endDt)}` : '';
      return `<tr class="${on ? '' : 'off'}"><td><label><input type="checkbox" data-prj="${F.esc(p.prjNo)}" ${on ? 'checked' : ''}></label></td>
        <td>${F.esc(p.rspr || '-')}</td><td class="no">${F.esc(p.prjNo)}</td><td class="nm">${F.esc(p.prjNm || (missing ? '(목록에 없는 과제)' : ''))}</td>
        <td>${F.esc(period)}</td><td>${F.esc(p.status || '')}</td></tr>`;
    };
    let rows = projects.map((p) => row(p, false)).join('');
    rows += Array.from(excluded).filter((no) => !known.has(no)).map((no) => row({ prjNo: no }, true)).join('');
    box.innerHTML = rows
      ? `<table class="prj-table"><thead><tr><th></th><th>과제책임자</th><th>과제번호</th><th>과제명</th><th>과제기간</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="issued-empty">조회된 과제가 없습니다. R&amp;D ERP에 로그인된 상태에서 <b>과제 목록 새로고침</b>을 누르세요.</div>';
    const info = () => { $('prjInfo').textContent = projectList && projectList.ts ? `${projects.length}개 과제 · ${F.fmtClock(projectList.ts)} 기준 · 제외 ${excluded.size}개` : ''; };
    info();
    box.querySelectorAll('input[type=checkbox][data-prj]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) excluded.delete(cb.dataset.prj); else excluded.add(cb.dataset.prj);
      cb.closest('tr').classList.toggle('off', !cb.checked);
      info();
    }));
  }
  async function loadProjects() {
    projectList = (await chrome.storage.local.get('projectList')).projectList || null;
    renderProjects();
    const sel = $('diagPrj');
    const projects = (projectList && projectList.projects) || [];
    sel.innerHTML = '<option value="">과제 선택</option>' + projects.map((p) => `<option value="${F.esc(p.prjNo)}">${F.esc(p.prjNo)} ${F.esc(p.rspr || '')} ${F.esc((p.prjNm || '').slice(0, 40))}</option>`).join('');
  }
  $('btnPrjRefresh').addEventListener('click', async () => {
    setStatus('prjStatus', 'R&D ERP에서 불러오는 중…');
    const res = await chrome.runtime.sendMessage({ type: 'getData', force: true });
    await loadProjects(); await loadIssued();
    if (res && res.error) setStatus('prjStatus', '오류: ' + res.error, true);
    else if (res && res.loginRequired) setStatus('prjStatus', 'R&D ERP 로그인이 필요합니다. 로그인 후 다시 누르세요.', true);
    else setStatus('prjStatus', '불러왔습니다.');
  });
  $('btnPrjAll').addEventListener('click', () => { $('prjList').querySelectorAll('input[type=checkbox][data-prj]').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change')); }); });
  $('btnPrjNone').addEventListener('click', () => { $('prjList').querySelectorAll('input[type=checkbox][data-prj]').forEach((cb) => { cb.checked = false; cb.dispatchEvent(new Event('change')); }); });

  /* ---------- 과제별 카드 귀속 (계좌번호 규칙) ---------- */
  function renderIssued() {
    const box = $('issuedList');
    const projects = (issued && issued.projects) || [];
    let html = '';
    for (const p of projects) {
      const accts = (p.accounts || []).map((a) => `${F.esc(a.bank)} ${F.esc(a.acctNo)}${a.divNm ? ' (' + F.esc(a.divNm) + ')' : ''}`).join(', ');
      const acctLine = p.acctKnown ? `과제 계좌: ${accts}` : (p.acctError ? `과제 계좌 조회 오류: ${F.esc(p.acctError)}` : '과제 계좌 정보 없음 → 발급 카드 전체를 이 과제 카드로 봄');
      const rows = (p.cards || []).map((c) => {
        const on = isIncluded(p.prjNo, c);
        const match = c.acctMatch === true ? '<span class="mem-y">일치</span>' : c.acctMatch === false ? '<span class="mem-n">불일치</span>' : '<span class="muted">-</span>';
        return `<tr class="${on ? 'on' : ''}"><td><label><input type="checkbox" data-prj="${F.esc(p.prjNo)}" data-card="${F.esc(c.digits)}" data-match="${c.acctMatch === true ? '1' : c.acctMatch === false ? '0' : ''}" ${on ? 'checked' : ''}></label></td>
          <td class="card">${F.esc(c.cardNo)}</td><td>${F.esc(c.user)}</td><td>${F.esc(c.div)}</td><td>${F.esc(c.bank)} ${F.esc(c.acctNoRaw || '')}</td><td>${match}</td>
          <td>${F.esc(c.setlDd)}</td><td>${F.esc(F.fmtDate(c.issuDt))}</td></tr>`;
      }).join('');
      html += `<div class="issued-prj"><div class="issued-prj-head"><b>${F.esc(p.rspr || '-')}</b><span class="nm" title="${F.esc(p.prjNm)}">${F.esc(p.prjNm)}</span><span class="no">${F.esc(p.prjNo)}</span></div>
        <div class="issued-acct">${acctLine}</div>`;
      html += rows
        ? `<table class="issued-table"><thead><tr><th>포함</th><th>카드번호</th><th>사용자</th><th>과제카드구분</th><th>카드 계좌</th><th>계좌 일치</th><th>결제일</th><th>발급일</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="issued-empty">${p.error ? '조회 오류: ' + F.esc(p.error) : '발급된 카드 없음'}</div>`;
      html += `</div>`;
    }
    box.innerHTML = html || '<div class="issued-empty">발급 카드 목록이 없습니다. R&amp;D ERP에 로그인된 상태에서 <b>목록 새로고침</b>을 누르세요.</div>';
    $('issuedInfo').textContent = issued && issued.ts ? `${projects.length}개 과제 · ${F.fmtClock(issued.ts)} 기준` : '';
    box.querySelectorAll('input[type=checkbox][data-card]').forEach((cb) => cb.addEventListener('change', () => {
      const ov = ovOf(cb.dataset.prj); const d = cb.dataset.card; const match = cb.dataset.match;
      ov.include.delete(d); ov.exclude.delete(d);
      if (cb.checked && match !== '1') ov.include.add(d);        // 불일치(또는 판정불가)인데 포함
      if (!cb.checked && match !== '0') ov.exclude.add(d);       // 일치(또는 판정불가)인데 제외
      cb.closest('tr').classList.toggle('on', cb.checked);
    }));
    renderMonitor();
  }
  async function loadIssued() {
    issued = (await chrome.storage.local.get('issuedCards')).issuedCards || null;
    renderIssued();
  }
  $('btnIssuedRefresh').addEventListener('click', async () => {
    setStatus('issuedStatus', 'R&D ERP에서 불러오는 중…');
    const res = await chrome.runtime.sendMessage({ type: 'getData', force: true });
    await loadIssued();
    if (res && res.error) setStatus('issuedStatus', '오류: ' + res.error, true);
    else if (res && res.loginRequired) setStatus('issuedStatus', 'R&D ERP 로그인이 필요합니다. 로그인 후 다시 누르세요.', true);
    else setStatus('issuedStatus', '불러왔습니다.');
  });
  $('btnIssuedReset').addEventListener('click', () => { overrides = {}; renderIssued(); });

  /* ---------- 모니터링 카드 선택 (전체 공통 필터) ---------- */
  function renderMonitor() {
    const box = $('monitorList');
    const seen = new Map();
    for (const p of (issued && issued.projects) || []) for (const c of p.cards || []) {
      if (!isIncluded(p.prjNo, c)) continue;
      if (!seen.has(c.digits)) seen.set(c.digits, { digits: c.digits, cardNo: c.cardNo, user: c.user, prjs: [] });
      seen.get(c.digits).prjs.push(p.rspr || p.prjNo);
    }
    const cards = Array.from(seen.values());
    const orphans = Array.from(selected).filter((d) => !seen.has(d));
    let rows = cards.map((c) => `<tr class="${selected.has(c.digits) ? 'on' : ''}"><td><label><input type="checkbox" data-mon="${F.esc(c.digits)}" ${selected.has(c.digits) ? 'checked' : ''}></label></td>
      <td class="card">${F.esc(c.cardNo)}</td><td>${F.esc(c.user)}</td><td>${F.esc(c.prjs.join(', '))}</td></tr>`).join('');
    rows += orphans.map((d) => `<tr class="on"><td><label><input type="checkbox" data-mon="${F.esc(d)}" checked></label></td><td class="card">${F.esc(F.cardTail(d, 8))}</td><td colspan="2" class="muted">목록에 없는 카드 (체크 해제 시 제거)</td></tr>`).join('');
    box.innerHTML = rows ? `<table class="issued-table"><thead><tr><th></th><th>카드번호</th><th>사용자</th><th>귀속 과제</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="issued-empty">귀속된 카드가 없습니다.</div>';
    box.querySelectorAll('input[type=checkbox][data-mon]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.mon); else selected.delete(cb.dataset.mon);
      cb.closest('tr').classList.toggle('on', cb.checked);
    }));
  }
  $('btnMonAll').addEventListener('click', () => { $('monitorList').querySelectorAll('input[type=checkbox][data-mon]').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change')); }); });
  $('btnMonNone').addEventListener('click', () => { $('monitorList').querySelectorAll('input[type=checkbox][data-mon]').forEach((cb) => { cb.checked = false; cb.dispatchEvent(new Event('change')); }); });

  /* ---------- 폼 ---------- */
  async function showRndUser() {
    const u = (await chrome.storage.local.get('rndUser')).rndUser;
    $('rndUserInfo').textContent = u ? `${u.userNm || ''} (USER_ID ${u.userId || '-'}${u.empNo ? ', EMP_NO ' + u.empNo : ''}) · ${F.fmtClock(u.ts)} 기록` : 'R&D ERP를 열면 로그인 사용자 정보가 자동으로 기록됩니다.';
  }

  function fill(s) {
    document.querySelector(`input[name=panelMode][value="${s.panelMode === 'float' ? 'float' : 'inline'}"]`).checked = true;
    $('onlyMyProjects').checked = !!s.onlyMyProjects;
    $('myEmpNo').value = s.myEmpNo || '';
    excluded = new Set((s.excludedProjects || []).map((x) => String(x).trim()).filter(Boolean));
    renderProjects();
    $('accountRule').checked = s.accountRule !== false;
    $('showShared').checked = !!s.showShared;
    overrides = {};
    for (const [prjNo, ov] of Object.entries(s.cardOverrides || {})) {
      overrides[prjNo] = { include: new Set((ov.include || []).map(F.digits)), exclude: new Set((ov.exclude || []).map(F.digits)) };
    }
    document.querySelector(`input[name=cardFilterMode][value="${s.cardFilterMode === 'specific' ? 'specific' : 'all'}"]`).checked = true;
    selected = new Set((s.selectedCards || []).map((x) => F.digits(x)).filter(Boolean));
    renderIssued();
    $('cardFilterList').value = (s.cardFilterList || []).join('\n');
    $('monthsBack').value = s.monthsBack;
    $('monthsForward').value = s.monthsForward;
    $('maxProjects').value = s.maxProjects;
    $('refreshMinutes').value = s.refreshMinutes;
    $('autoRefresh').checked = !!s.autoRefresh;
    $('hideZeroProjects').checked = !!s.hideZeroProjects;
    $('projectStatusKeyword').value = s.projectStatusKeyword == null ? '진행' : s.projectStatusKeyword;
    $('rndUrl').value = s.rndUrl || '';
    const u = s.unapproved || {};
    $('unapServiceId').value = u.serviceId || '';
    $('unapInput').value = u.input || '{}';
    $('unapSupplement').value = (u.fields && u.fields.supplement) || '';
    $('unapApply').value = (u.fields && u.fields.apply) || '';
    $('unapTemp').value = (u.fields && u.fields.temp) || '';
    $('unapPurchase').value = (u.fields && u.fields.purchase) || '';
    $('unapLinkUrl').value = u.linkUrl || '';
    const a = s.adv || {};
    $('advUsefac').value = a.usefacSeqNo || '';
    $('advProjectsService').value = a.projectsService || '';
    $('advProjectsInput').value = a.projectsInput || '';
    $('advProjectsFallbackService').value = a.projectsFallbackService || '';
    $('advCardsService').value = a.cardsService || '';
    $('advCardsInput').value = a.cardsInput || '';
    $('advIssuedService').value = a.issuedService || '';
    $('advAccountsService').value = a.accountsService || '';
    $('advExpenseAcctDivCd').value = a.expenseAcctDivCd || '';
    $('advParticipantsService').value = a.participantsService || '';
    $('advParticipantsInput').value = a.participantsInput || '';
    toggleCardList();
  }

  function read() {
    const mode = document.querySelector('input[name=cardFilterMode]:checked').value;
    const num = (id, def) => { const v = Number($(id).value); return Number.isFinite(v) && v >= 0 ? v : def; };
    const checkJson = (id) => { try { JSON.parse($(id).value || '{}'); } catch (e) { throw new Error(`${id}: JSON 형식이 올바르지 않습니다.`); } };
    checkJson('unapInput'); checkJson('advProjectsInput'); checkJson('advCardsInput'); checkJson('advParticipantsInput');
    const cardOverrides = {};
    for (const [prjNo, ov] of Object.entries(overrides)) {
      if (ov.include.size || ov.exclude.size) cardOverrides[prjNo] = { include: Array.from(ov.include), exclude: Array.from(ov.exclude) };
    }
    return S.merge(S.DEFAULTS, {
      panelMode: document.querySelector('input[name=panelMode]:checked').value,
      accountRule: $('accountRule').checked,
      showShared: $('showShared').checked,
      cardOverrides,
      cardFilterMode: mode,
      selectedCards: Array.from(selected),
      cardFilterList: F.parseList($('cardFilterList').value),
      monthsBack: num('monthsBack', 6),
      monthsForward: num('monthsForward', 1),
      maxProjects: num('maxProjects', 30) || 30,
      refreshMinutes: num('refreshMinutes', 10) || 10,
      autoRefresh: $('autoRefresh').checked,
      hideZeroProjects: $('hideZeroProjects').checked,
      projectStatusKeyword: $('projectStatusKeyword').value.trim(),
      excludedProjects: Array.from(excluded),
      onlyMyProjects: $('onlyMyProjects').checked,
      myEmpNo: $('myEmpNo').value.trim(),
      rndUrl: $('rndUrl').value.trim() || S.DEFAULTS.rndUrl,
      unapproved: {
        serviceId: $('unapServiceId').value.trim(),
        input: $('unapInput').value.trim() || '{}',
        fields: { supplement: $('unapSupplement').value.trim(), apply: $('unapApply').value.trim(), temp: $('unapTemp').value.trim(), purchase: $('unapPurchase').value.trim() },
        linkUrl: $('unapLinkUrl').value.trim() || S.DEFAULTS.unapproved.linkUrl
      },
      adv: {
        usefacSeqNo: $('advUsefac').value.trim() || '10',
        projectsService: $('advProjectsService').value.trim() || S.DEFAULTS.adv.projectsService,
        projectsInput: $('advProjectsInput').value.trim() || '{}',
        projectsFallbackService: $('advProjectsFallbackService').value.trim(),
        cardsService: $('advCardsService').value.trim() || S.DEFAULTS.adv.cardsService,
        cardsInput: $('advCardsInput').value.trim() || '{}',
        issuedService: $('advIssuedService').value.trim() || S.DEFAULTS.adv.issuedService,
        accountsService: $('advAccountsService').value.trim() || S.DEFAULTS.adv.accountsService,
        expenseAcctDivCd: $('advExpenseAcctDivCd').value.trim(),
        participantsService: $('advParticipantsService').value.trim() || S.DEFAULTS.adv.participantsService,
        participantsInput: $('advParticipantsInput').value.trim() || S.DEFAULTS.adv.participantsInput
      }
    });
  }

  /* cardOverrides 는 저장 시 { include: [...], exclude: [...] } 로 직렬화되며, merge()가 Set 을 건드리지 않도록 read() 안에서 배열로 변환 */

  function toggleCardList() {
    const specific = document.querySelector('input[name=cardFilterMode]:checked').value === 'specific';
    $('monitorBox').style.opacity = specific ? '1' : '.45';
    $('monitorBox').style.pointerEvents = specific ? '' : 'none';
  }
  document.querySelectorAll('input[name=cardFilterMode]').forEach((r) => r.addEventListener('change', toggleCardList));

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await S.save(read()); setStatus('saveStatus', '저장했습니다. eClass 화면은 자동으로 다시 조회됩니다.'); }
    catch (e) { setStatus('saveStatus', String(e.message || e), true); }
  });
  $('btnReset').addEventListener('click', () => { if (confirm('모든 설정을 기본값으로 되돌릴까요?')) fill(S.merge(S.DEFAULTS, {})); });

  /* ---------- 미승인내역 테스트 ---------- */
  $('btnTestUnap').addEventListener('click', async () => {
    const svc = $('unapServiceId').value.trim();
    if (!svc) { setStatus('unapTestStatus', '서비스 ID를 입력하세요.', true); return; }
    let input; try { input = JSON.parse($('unapInput').value || '{}'); } catch (e) { setStatus('unapTestStatus', '입력 JSON 오류', true); return; }
    setStatus('unapTestStatus', '호출 중…');
    const res = await chrome.runtime.sendMessage({ type: 'callService', service: svc, input });
    const out = $('unapTestOut'); out.hidden = false;
    out.textContent = JSON.stringify(res, null, 2);
    setStatus('unapTestStatus', res && res.error ? '오류: ' + res.error : '응답 수신 (아래 JSON에서 필드명을 확인하세요)', !!(res && res.error));
  });
  async function showSnapshot() {
    const snap = (await chrome.storage.local.get('unapprovedSnapshot')).unapprovedSnapshot;
    $('snapshotOut').textContent = snap ? JSON.stringify(snap, null, 2) : '없음 (R&D ERP 메인화면을 열면 수집됩니다)';
  }

  /* ---------- 진단 ---------- */
  let diagResult = null;
  $('btnDiag').addEventListener('click', async () => {
    const prjNo = $('diagPrjNo').value.trim() || $('diagPrj').value;
    setStatus('diagStatus', '호출 중…');
    const res = await chrome.runtime.sendMessage({ type: 'diagnose', prjNo });
    diagResult = res;
    const out = $('diagOut'); out.hidden = false;
    out.textContent = JSON.stringify(res, null, 2);
    setStatus('diagStatus', res && res.error ? '오류: ' + res.error : '완료. 아래 결과를 확인하세요.', !!(res && res.error));
  });
  $('btnDiagCopy').addEventListener('click', async () => {
    if (!diagResult) { setStatus('diagStatus', '먼저 진단을 실행하세요.', true); return; }
    await navigator.clipboard.writeText(JSON.stringify(diagResult, null, 2));
    setStatus('diagStatus', '복사했습니다.');
  });

  /* ---------- 캡처 로그 ---------- */
  const HINT = /임시저장|보완요청|구매요청|TEMP|SUPP|APPL|PURCH|CNT/i;
  let capCache = [];
  async function loadCapture() {
    capCache = (await chrome.storage.local.get('captureLog')).captureLog || [];
    renderCapture();
  }
  function renderCapture() {
    const q = $('capFilter').value.trim().toLowerCase();
    const list = capCache.slice().reverse().filter((e) => !q || JSON.stringify(e).toLowerCase().includes(q));
    $('captureCount').textContent = `(${list.length}/${capCache.length}건)`;
    if (!list.length) { $('captureList').innerHTML = '<p class="help">기록이 없습니다. R&amp;D ERP(rnd.krs.co.kr)를 열어 메인화면을 표시하면 기록됩니다.</p>'; return; }
    $('captureList').innerHTML = list.map((e, i) => {
      const hit = HINT.test(e.response || '') && !/GWM0001/.test(e.response || '');
      const t = new Date(e.ts);
      return `<div class="cap${hit ? ' hit' : ''}" data-i="${i}">
        <div class="cap-head">
          <span class="cap-svc">${F.esc(e.service)}</span>
          <span class="cap-frame" title="${F.esc(e.tabUrl || '')}">${F.esc(e.frame || '')}</span>
          <span class="cap-time">${F.pad2(t.getHours())}:${F.pad2(t.getMinutes())}:${F.pad2(t.getSeconds())} · ${e.status}</span>
          <button type="button" class="btn" data-act="use">이 서비스 사용</button>
          <button type="button" class="btn" data-act="copy">복사</button>
          <button type="button" class="btn" data-act="toggle">내용</button>
        </div>
        <div class="cap-body" hidden>
          <div class="muted">요청</div><pre>${F.esc(e.request || '')}</pre>
          <div class="muted">응답</div><pre>${F.esc(e.response || '')}</pre>
        </div></div>`;
    }).join('');
    $('captureList').querySelectorAll('.cap').forEach((el) => {
      const e = list[Number(el.dataset.i)];
      el.querySelector('[data-act=toggle]').addEventListener('click', () => { const b = el.querySelector('.cap-body'); b.hidden = !b.hidden; });
      el.querySelector('[data-act=copy]').addEventListener('click', async () => { await navigator.clipboard.writeText(JSON.stringify(e, null, 2)); setStatus('capStatus', '복사했습니다.'); });
      el.querySelector('[data-act=use]').addEventListener('click', () => {
        $('unapServiceId').value = e.service;
        $('unapInput').value = e.request && e.request.trim().startsWith('{') ? e.request : '{}';
        window.scrollTo({ top: $('unapServiceId').getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
        setStatus('unapTestStatus', '서비스 ID를 채웠습니다. 테스트 호출 후 필드명을 입력하고 저장하세요.');
      });
    });
  }
  $('capFilter').addEventListener('input', renderCapture);
  $('btnCapRefresh').addEventListener('click', loadCapture);
  $('btnCapCopy').addEventListener('click', async () => {
    const snap = (await chrome.storage.local.get('unapprovedSnapshot')).unapprovedSnapshot || null;
    await navigator.clipboard.writeText(JSON.stringify({ exportedAt: new Date().toISOString(), unapprovedSnapshot: snap, captureLog: capCache }, null, 2));
    setStatus('capStatus', `전체 ${capCache.length}건을 복사했습니다.`);
  });
  $('btnCapDownload').addEventListener('click', async () => {
    const snap = (await chrome.storage.local.get('unapprovedSnapshot')).unapprovedSnapshot || null;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), unapprovedSnapshot: snap, captureLog: capCache }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `krext-capture-${F.ymd(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('btnCapClear').addEventListener('click', async () => { if (!confirm('캡처 로그를 모두 지울까요?')) return; await chrome.runtime.sendMessage({ type: 'clearCapture' }); loadCapture(); });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.captureLog) loadCapture();
    if (area === 'local' && ch.unapprovedSnapshot) showSnapshot();
    if (area === 'local' && ch.issuedCards) loadIssued();
    if (area === 'local' && ch.projectList) loadProjects();
    if (area === 'local' && ch.rndUser) showRndUser();
  });

  const local = await chrome.storage.local.get(['issuedCards', 'projectList']);
  issued = local.issuedCards || null;
  projectList = local.projectList || null;
  fill(await S.load());
  await loadProjects();
  await showRndUser();
  await showSnapshot();
  await loadCapture();
  if (!issued || !projectList) {
    chrome.runtime.sendMessage({ type: 'getData', force: true }).then(() => { loadProjects(); loadIssued(); }).catch(() => {});
  }
})();
