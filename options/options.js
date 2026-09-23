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
  let bgtInclude = {};          // 과제집행비율 비목별 포함 여부 { [비목명]: true|false } (settings.budgetItemInclude)
  let bgtDefaultKeys = [];      // 명시적으로 고르지 않은 비목의 기본 제외 키워드 (settings.budgetExcludeDefault)
  let cacheData = null;         // storage.local.cache (패널 데이터) - 비목 목록 추출용

  const ovOf = (prjNo) => { if (!overrides[prjNo]) overrides[prjNo] = { include: new Set(), exclude: new Set() }; return overrides[prjNo]; };
  /* 카드의 이 과제 포함 여부 (계좌 일치 기본값 + 재정의) */
  function isIncluded(prjNo, c) {
    const ov = ovOf(prjNo);
    if (ov.exclude.has(c.digits)) return false;
    if (ov.include.has(c.digits)) return true;
    return c.acctMatch === null || c.acctMatch === undefined ? true : !!c.acctMatch;
  }

  /* ---------- 접기/펼치기 (details.card[data-collapse]): 마지막 상태를 storage.local.optCollapse 에 기억 (기본: 접힘) ---------- */
  async function initCollapse() {
    let saved = {};
    try { saved = (await chrome.storage.local.get('optCollapse')).optCollapse || {}; } catch (e) {}
    document.querySelectorAll('details.card[data-collapse]').forEach((el) => {
      const key = el.dataset.collapse;
      if (typeof saved[key] === 'boolean') el.open = saved[key];
      el.addEventListener('toggle', () => { saved[key] = el.open; try { chrome.storage.local.set({ optCollapse: saved }); } catch (e) {} });
    });
  }
  /* 접힌 제목 옆 요약 문구 */
  function updateIssuedSummary() {
    const projects = ((issued && issued.projects) || []).filter((p) => !excluded.has(p.prjNo));
    let nCards = 0, nInc = 0;
    for (const p of projects) for (const c of p.cards || []) { nCards++; if (isIncluded(p.prjNo, c)) nInc++; }
    $('issuedSummary').textContent = issued && issued.ts ? `${projects.length}개 과제 · 카드 ${nCards}장 중 ${nInc}장 귀속` : '';
  }
  function updateMonitorSummary() {
    const mode = document.querySelector('input[name=cardFilterMode]:checked');
    const specific = mode && mode.value === 'specific';
    const extra = F.parseList($('cardFilterList').value).length;
    $('monitorSummary').textContent = specific ? `선택한 카드만 · ${selected.size + extra}장` : '전체 보기';
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
      onExcludedChanged();
    }));
  }
  /* 과제 체크를 바꾸면 "저장"을 누르지 않아도 바로 적용: 아래 카드 목록을 다시 그리고, 제외 목록만 설정에 저장(→ 백그라운드가 다시 조회) */
  let excludeTimer = null;
  function onExcludedChanged() {
    renderIssued();
    renderBgtItems();   // 제외한 과제의 비목은 목록에서도 빠짐
    clearTimeout(excludeTimer);
    excludeTimer = setTimeout(saveExcluded, 600);
  }
  async function saveExcluded() {
    try {
      const cur = await S.load();
      const prev = (cur.excludedProjects || []).map((x) => String(x).trim());
      if (prev.length === excluded.size && prev.every((x) => excluded.has(x))) return;
      cur.excludedProjects = Array.from(excluded);
      await S.save(cur);
      setStatus('prjStatus', '적용했습니다. 패널은 자동으로 다시 조회됩니다.');
    } catch (e) { setStatus('prjStatus', '적용 실패: ' + String((e && e.message) || e), true); }
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

  /* ---------- 과제집행비율 비목 선택 ---------- */
  const normNm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  /* 명시적 선택이 없을 때의 기본값: 이름에 기본 제외 키워드가 들어가면 제외 */
  const bgtDefaultOn = (name) => !bgtDefaultKeys.some((k) => k && normNm(name).includes(k));
  const bgtIsOn = (name) => (Object.prototype.hasOwnProperty.call(bgtInclude, name) ? bgtInclude[name] !== false : bgtDefaultOn(name));
  /* 캐시(패널 데이터)의 과제별 비목을 이름 기준으로 합침 (조회된 순서 유지) */
  function collectBgtItems() {
    const map = new Map();
    for (const p of (cacheData && cacheData.projects) || []) {
      if (excluded.has(p.prjNo)) continue;
      for (const x of (p.budget && p.budget.items) || []) {
        const name = String(x.exp || x.item || '').trim();
        if (!name) continue;
        let it = map.get(name);
        if (!it) { it = { name, prjs: 0, bgt: 0, appr: 0, dir: false, psnl: false }; map.set(name, it); }
        it.prjs++; it.bgt += Number(x.bgt) || 0; it.appr += Number(x.appr) || 0; it.dir = it.dir || !!x.dir; it.psnl = it.psnl || !!x.psnl;
      }
    }
    for (const name of Object.keys(bgtInclude)) if (!map.has(name)) map.set(name, { name, prjs: 0, bgt: 0, appr: 0, missing: true });   // 목록에 없지만 선택 기록이 있는 비목
    return Array.from(map.values());
  }
  function renderBgtItems() {
    const items = collectBgtItems();
    const box = $('bgtList');
    const rows = items.map((it) => {
      const on = bgtIsOn(it.name);
      const explicit = Object.prototype.hasOwnProperty.call(bgtInclude, it.name);
      const tags = [it.psnl ? '인건비' : '', it.dir ? '직접비' : ''].filter(Boolean).join(' · ');
      return `<tr class="${on ? '' : 'off'}"><td><label><input type="checkbox" data-bgt="${F.esc(it.name)}" ${on ? 'checked' : ''}></label></td>
        <td class="nm">${F.esc(it.name)}${it.missing ? ' <span class="muted">(현재 목록에 없음)</span>' : ''}</td><td class="tag">${F.esc(tags)}</td>
        <td class="num">${it.prjs ? `${it.prjs}개 과제` : '-'}</td><td class="num">${F.money(it.bgt)}</td><td class="num">${F.money(it.appr)}</td>
        <td class="tag">${explicit ? '' : '기본'}</td></tr>`;
    }).join('');
    box.innerHTML = rows
      ? `<table class="prj-table"><thead><tr><th></th><th>비목</th><th>구분</th><th>과제</th><th style="text-align:right">예산액 합계</th><th style="text-align:right">승인액 합계</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="issued-empty">조회된 비목이 없습니다. R&amp;D ERP에 로그인된 상태에서 <b>목록 새로고침</b>을 누르세요.</div>';
    const onCnt = items.filter((it) => bgtIsOn(it.name)).length;
    $('bgtInfo').textContent = items.length ? `${items.length}개 비목 중 ${onCnt}개 포함${cacheData && cacheData.ts ? ` · ${F.fmtClock(cacheData.ts)} 기준` : ''}` : '';
    box.querySelectorAll('input[type=checkbox][data-bgt]').forEach((cb) => cb.addEventListener('change', () => {
      bgtInclude[cb.dataset.bgt] = cb.checked;
      cb.closest('tr').classList.toggle('off', !cb.checked);
      onBgtChanged();
    }));
  }
  let bgtTimer = null;
  function onBgtChanged() {
    const items = collectBgtItems();
    $('bgtInfo').textContent = `${items.length}개 비목 중 ${items.filter((it) => bgtIsOn(it.name)).length}개 포함`;
    clearTimeout(bgtTimer);
    bgtTimer = setTimeout(saveBgtInclude, 600);
  }
  async function saveBgtInclude() {
    try {
      const cur = await S.load();
      const prev = cur.budgetItemInclude || {};
      const next = Object.assign({}, bgtInclude);
      if (JSON.stringify(prev) === JSON.stringify(next)) return;
      cur.budgetItemInclude = next;
      await S.save(cur);
      setStatus('bgtStatus', '적용했습니다. 패널은 자동으로 다시 조회됩니다.');
    } catch (e) { setStatus('bgtStatus', '적용 실패: ' + String((e && e.message) || e), true); }
  }
  async function loadBgtItems() {
    cacheData = (await chrome.storage.local.get('cache')).cache || null;
    renderBgtItems();
  }
  const setAllBgt = (on) => { for (const it of collectBgtItems()) bgtInclude[it.name] = on; renderBgtItems(); onBgtChanged(); };
  $('btnBgtAll').addEventListener('click', () => setAllBgt(true));
  $('btnBgtNone').addEventListener('click', () => setAllBgt(false));
  $('btnBgtRefresh').addEventListener('click', async () => {
    setStatus('bgtStatus', 'R&D ERP에서 불러오는 중…');
    const res = await chrome.runtime.sendMessage({ type: 'getData', force: true });
    await loadBgtItems();
    if (res && res.error) setStatus('bgtStatus', '오류: ' + res.error, true);
    else if (res && res.loginRequired) setStatus('bgtStatus', 'R&D ERP 로그인이 필요합니다. 로그인 후 다시 누르세요.', true);
    else setStatus('bgtStatus', '불러왔습니다.');
  });

  /* ---------- 과제별 카드 귀속 (계좌번호 규칙) ---------- */
  function renderIssued() {
    const box = $('issuedList');
    const all = (issued && issued.projects) || [];
    const projects = all.filter((p) => !excluded.has(p.prjNo));   // 과제 선택에서 뺀 과제는 여기서도 숨김
    const hidden = all.length - projects.length;
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
    box.innerHTML = html || `<div class="issued-empty">${hidden
      ? '선택한 과제가 없습니다. 위 <b>과제 선택</b>에서 과제를 체크하세요.'
      : '발급 카드 목록이 없습니다. R&amp;D ERP에 로그인된 상태에서 <b>목록 새로고침</b>을 누르세요.'}</div>`;
    $('issuedInfo').textContent = issued && issued.ts ? `${projects.length}개 과제${hidden ? ` (제외 ${hidden}개 숨김)` : ''} · ${F.fmtClock(issued.ts)} 기준` : '';
    updateIssuedSummary();
    box.querySelectorAll('input[type=checkbox][data-card]').forEach((cb) => cb.addEventListener('change', () => {
      const ov = ovOf(cb.dataset.prj); const d = cb.dataset.card; const match = cb.dataset.match;
      ov.include.delete(d); ov.exclude.delete(d);
      if (cb.checked && match !== '1') ov.include.add(d);        // 불일치(또는 판정불가)인데 포함
      if (!cb.checked && match !== '0') ov.exclude.add(d);       // 일치(또는 판정불가)인데 제외
      cb.closest('tr').classList.toggle('on', cb.checked);
      updateIssuedSummary();
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
      if (excluded.has(p.prjNo) || !isIncluded(p.prjNo, c)) continue;   // 제외 과제의 카드는 모니터링 대상이 아님
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
      updateMonitorSummary();
    }));
    updateMonitorSummary();
  }
  $('cardFilterList').addEventListener('input', updateMonitorSummary);
  $('btnMonAll').addEventListener('click', () => { $('monitorList').querySelectorAll('input[type=checkbox][data-mon]').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change')); }); });
  $('btnMonNone').addEventListener('click', () => { $('monitorList').querySelectorAll('input[type=checkbox][data-mon]').forEach((cb) => { cb.checked = false; cb.dispatchEvent(new Event('change')); }); });

  /* ---------- 폼 ---------- */
  async function showRndUser() {
    const u = (await chrome.storage.local.get('rndUser')).rndUser;
    $('rndUserInfo').textContent = u ? `${u.userNm || ''} (USER_ID ${u.userId || '-'}${u.empNo ? ', EMP_NO ' + u.empNo : ''}) · ${F.fmtClock(u.ts)} 기록` : 'R&D ERP를 열면 로그인 사용자 정보가 자동으로 기록됩니다.';
  }

  /* 동명이인 후보 (cache.nameCandidates): 이름으로만 대조했는데 같은 이름의 사번이 둘 이상이면 고르게 한다. 고르면 myEmpNo 저장 → 백그라운드가 다시 조회 */
  async function showNameCandidates() {
    const box = $('nameCandidates');
    const d = (await chrome.storage.local.get('cache')).cache || null;
    const cands = (d && d.nameCandidates) || [];
    if (!d || d.memberFilter !== 'ambiguous' || cands.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<b>동명이인 ${cands.length}명</b> — 이름 "${F.esc((d.myNames || []).join(', '))}"이(가) 참여인력에 여러 사번으로 있어 과제를 표시하지 않고 있습니다. 본인을 고르세요.<br>` +
      cands.map((c) => `<label class="check"><input type="radio" name="nameCand" value="${F.esc(c.empNo || '')}"> ${F.esc(c.empNm)} · 사번 <b>${F.esc(c.empNo || '?')}</b>${c.roles && c.roles.length ? ' · ' + F.esc(c.roles.join('/')) : ''} · 과제 ${c.projects.length}건 <span class="muted">(${F.esc(c.projects.slice(0, 3).map((p) => (p.rspr ? p.rspr + ' ' : '') + p.prjNm).join(' / '))}${c.projects.length > 3 ? ' …' : ''})</span></label>`).join('');
    box.querySelectorAll('input[name=nameCand]').forEach((r) => r.addEventListener('change', async () => {
      if (!r.value) return;
      $('myEmpNo').value = r.value;
      try {
        const cur = await S.load();
        cur.myEmpNo = r.value;
        cur.myName = $('myName').value.trim() || cur.myName;
        await S.save(cur);
        setStatus('saveStatus', `사번 ${r.value}로 저장했습니다. 참여 과제를 다시 조회합니다.`);
      } catch (e) { setStatus('saveStatus', String(e.message || e), true); }
    }));
  }

  function fill(s) {
    document.querySelector(`input[name=panelMode][value="${s.panelMode === 'float' ? 'float' : 'inline'}"]`).checked = true;
    $('onlyMyProjects').checked = !!s.onlyMyProjects;
    $('myEmpNo').value = s.myEmpNo || '';
    $('myName').value = s.myName || '';
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
    const ch = Object.assign({}, S.DEFAULTS.claimHelper, s.claimHelper || {});
    $('chEnabled').checked = ch.enabled !== false;
    $('chDefaultBudget').value = ch.defaultBudget || '';
    $('chDefaultRcms').value = ch.defaultRcms || '';
    $('chDragDrop').checked = ch.dragDrop !== false;
    $('chQuickPicks').value = (Array.isArray(ch.quickPicks) ? ch.quickPicks : []).join('\n');
    toggleClaimBox();
    bgtInclude = Object.assign({}, s.budgetItemInclude || {});
    bgtDefaultKeys = (s.budgetExcludeDefault || []).map(normNm).filter(Boolean);
    renderBgtItems();
    const u = s.unapproved || {};
    $('unapServiceId').value = u.serviceId || '';
    $('unapInput').value = u.input || '{}';
    $('unapSupplement').value = (u.fields && u.fields.supplement) || '';
    $('unapApply').value = (u.fields && u.fields.apply) || '';
    $('unapTemp').value = (u.fields && u.fields.temp) || '';
    $('unapPurchase').value = (u.fields && u.fields.purchase) || '';
    $('unapLinkUrl').value = u.linkUrl || '';
    $('unapSummary').textContent = u.serviceId ? `설정됨 · ${u.serviceId}` : '미설정 (메인화면 방문 시 화면값 사용)';
    const a = s.adv || {};
    const advChanged = Object.keys(S.DEFAULTS.adv).some((k) => a[k] != null && String(a[k]) !== String(S.DEFAULTS.adv[k]));
    $('advSummary').textContent = advChanged ? '기본값에서 변경됨' : '기본값';
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
    $('advBudgetService').value = a.budgetService == null ? S.DEFAULTS.adv.budgetService : a.budgetService;
    $('advBudgetInput').value = a.budgetInput || S.DEFAULTS.adv.budgetInput;
    $('advBudgetBaseService').value = a.budgetBaseService == null ? S.DEFAULTS.adv.budgetBaseService : a.budgetBaseService;
    $('advProjectDetailService').value = a.projectDetailService == null ? S.DEFAULTS.adv.projectDetailService : a.projectDetailService;
    toggleCardList();
  }

  function read() {
    const mode = document.querySelector('input[name=cardFilterMode]:checked').value;
    const num = (id, def) => { const v = Number($(id).value); return Number.isFinite(v) && v >= 0 ? v : def; };
    const checkJson = (id) => { try { JSON.parse($(id).value || '{}'); } catch (e) { throw new Error(`${id}: JSON 형식이 올바르지 않습니다.`); } };
    checkJson('unapInput'); checkJson('advProjectsInput'); checkJson('advCardsInput'); checkJson('advParticipantsInput'); checkJson('advBudgetInput');
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
      budgetItemInclude: Object.assign({}, bgtInclude),   // 비목 선택 구역에서 고른 포함/제외 (체크 변경 시 즉시 저장되기도 함)
      excludedProjects: Array.from(excluded),
      onlyMyProjects: $('onlyMyProjects').checked,
      myEmpNo: $('myEmpNo').value.trim(),
      myName: $('myName').value.trim(),
      rndUrl: $('rndUrl').value.trim() || S.DEFAULTS.rndUrl,
      claimHelper: {
        enabled: $('chEnabled').checked,
        defaultBudget: $('chDefaultBudget').value.trim(),
        defaultRcms: $('chDefaultRcms').value.trim(),
        dragDrop: $('chDragDrop').checked,
        quickPicks: $('chQuickPicks').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
      },
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
        participantsInput: $('advParticipantsInput').value.trim() || S.DEFAULTS.adv.participantsInput,
        budgetService: $('advBudgetService').value.trim(),            // 비우면 과제집행비율 조회 안 함
        budgetInput: $('advBudgetInput').value.trim() || S.DEFAULTS.adv.budgetInput,
        budgetBaseService: $('advBudgetBaseService').value.trim() || S.DEFAULTS.adv.budgetBaseService,
        projectDetailService: $('advProjectDetailService').value.trim()   // 비우면 본예산 대체 조회 안 함
      }
    });
  }

  /* cardOverrides 는 저장 시 { include: [...], exclude: [...] } 로 직렬화되며, merge()가 Set 을 건드리지 않도록 read() 안에서 배열로 변환 */

  function toggleCardList() {
    const specific = document.querySelector('input[name=cardFilterMode]:checked').value === 'specific';
    $('monitorBox').style.opacity = specific ? '1' : '.45';
    $('monitorBox').style.pointerEvents = specific ? '' : 'none';
    updateMonitorSummary();
  }
  document.querySelectorAll('input[name=cardFilterMode]').forEach((r) => r.addEventListener('change', toggleCardList));

  /* 청구서(카드) 입력 도우미: 사용 안 함이면 세부 항목을 흐리게 */
  function toggleClaimBox() {
    const on = $('chEnabled').checked;
    $('chBox').style.opacity = on ? '1' : '.45';
    $('chBox').style.pointerEvents = on ? '' : 'none';
  }
  $('chEnabled').addEventListener('change', toggleClaimBox);

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
        const sec = $('unapServiceId').closest('details'); if (sec) sec.open = true;   // 접혀 있으면 펼쳐서 보여줌
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
    if (area === 'local' && ch.cache && ch.cache.newValue) { loadBgtItems(); showNameCandidates(); }
    if (area === 'local' && ch.rndUser) showRndUser();
  });

  const local = await chrome.storage.local.get(['issuedCards', 'projectList', 'cache']);
  issued = local.issuedCards || null;
  projectList = local.projectList || null;
  cacheData = local.cache || null;
  await initCollapse();
  fill(await S.load());
  await loadProjects();
  await showRndUser();
  await showNameCandidates();
  await showSnapshot();
  await loadCapture();
  if (!issued || !projectList) {
    chrome.runtime.sendMessage({ type: 'getData', force: true }).then(() => { loadProjects(); loadIssued(); }).catch(() => {});
  }
})();
