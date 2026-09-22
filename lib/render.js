/* 패널 렌더러 (eClass 콘텐츠스크립트 / 팝업 공용) */
(function (g) {
  const F = g.KRX_FMT;
  const RND_MAIN = 'https://rnd.krs.co.kr/rderp_layoutMain.act';

  function stat(label, val, cls, href) {
    const v = (val == null || Number.isNaN(val)) ? '-' : F.money(val);
    const hot = (val || 0) > 0 ? ' krext-hot' : '';
    return `<a class="krext-stat${hot}" href="${F.esc(href)}" target="_blank" rel="noopener" title="R&D ERP에서 확인">
      <span class="krext-stat-label">${F.esc(label)}</span><span class="krext-stat-val ${cls || ''}">${v}</span></a>`;
  }

  /* 미승인내역 건수: 실시간 조회값 → 없으면 메인화면 방문 시 읽은 스냅샷 */
  function unapprovedCounts(d) {
    if (!d) return null;
    if (d.unapproved) return { supplement: d.unapproved.supplement, apply: d.unapproved.apply, source: 'live' };
    const it = d.unapprovedSnapshot && d.unapprovedSnapshot.items;
    if (it) return { supplement: it['보완요청'] ? it['보완요청'].count : null, apply: it['신청'] ? it['신청'].count : null, source: 'snapshot' };
    return null;
  }

  function chip(label, val, hotCls, title) {
    const has = val != null && !Number.isNaN(val);
    const hot = has && val > 0;
    return `<span class="krext-chip${hot ? ' ' + hotCls : ''}" title="${F.esc(title || label)}"><span class="krext-chip-l">${F.esc(label)}</span><span class="krext-chip-v">${has ? F.money(val) : '-'}</span></span>`;
  }

  function headerChips(d) {
    if (!d) return '';
    if (d.loginRequired) return `<span class="krext-chip krext-chip-warn"><span class="krext-chip-l">R&amp;D ERP 로그인 필요</span></span>`;
    const u = unapprovedCounts(d);
    const src = u ? (u.source === 'live' ? '실시간' : `R&D ERP 방문 ${F.fmtClock(d.unapprovedSnapshot.ts)} 기준`) : '아직 수집되지 않음';
    return chip('보완요청', u ? u.supplement : null, 'krext-chip-red', `보완요청 (${src})`)
         + chip('신청', u ? u.apply : null, 'krext-chip-blue', `신청 (${src})`)
         + chip('카드미청구', d.totalCount, 'krext-chip-red', `카드미청구 ${F.money(d.totalCount)}건 · ${F.money(d.totalAmount)}원`);
  }

  function unapprovedSection(d, s) {
    const link = s.unapprovedLinkUrl || s.rndUrl || RND_MAIN;
    let note = '', body = '';
    if (d.unapproved) {
      note = `실시간 ${F.fmtClock(d.unapproved.ts || d.ts)}`;
      body = stat('보완요청', d.unapproved.supplement, 'krext-red', link) + stat('신청', d.unapproved.apply, 'krext-blue', link);
      const extra = [];
      if (d.unapproved.temp != null) extra.push(`임시저장 ${F.money(d.unapproved.temp)}`);
      if (d.unapproved.purchase != null) extra.push(`구매요청 ${F.money(d.unapproved.purchase)}`);
      if (extra.length) body += `<div class="krext-sub">${F.esc(extra.join(' · '))}</div>`;
    } else if (d.unapprovedSnapshot && d.unapprovedSnapshot.items) {
      const it = d.unapprovedSnapshot.items;
      note = `R&D ERP 방문 ${F.fmtClock(d.unapprovedSnapshot.ts)} 기준`;
      body = stat('보완요청', it['보완요청'] ? it['보완요청'].count : null, 'krext-red', link)
           + stat('신청', it['신청'] ? it['신청'].count : null, 'krext-blue', link);
      const extra = [];
      if (it['임시저장']) extra.push(`임시저장 ${F.money(it['임시저장'].count)}`);
      if (it['구매요청']) extra.push(`구매요청 ${F.money(it['구매요청'].count)}`);
      if (extra.length) body += `<div class="krext-sub">${F.esc(extra.join(' · '))}</div>`;
      if (!s.unapprovedConfigured) body += `<div class="krext-sub krext-dim">실시간 조회 서비스가 아직 설정되지 않아 마지막 방문 시점 값을 표시합니다.</div>`;
    } else {
      body = `<div class="krext-msg krext-dim">아직 수집된 값이 없습니다. <a href="${F.esc(link)}" target="_blank" rel="noopener">R&D ERP 메인화면</a>을 한 번 열면 자동으로 수집됩니다.</div>`;
    }
    if (d.unapprovedError) body += `<div class="krext-sub krext-err">미승인내역 조회 오류: ${F.esc(d.unapprovedError)}</div>`;
    return `<section class="krext-sec"><div class="krext-sec-title">미승인내역 <span class="krext-note">${F.esc(note)}</span></div><div class="krext-stats">${body}</div></section>`;
  }

  function cardsTable(p) {
    if (p.error) return `<div class="krext-sub krext-err">조회 오류: ${F.esc(p.error)}</div>`;
    // 발급 카드 수·원본 건수 같은 일상 정보는 행 자체와 중복이라 표시하지 않고, 누락 이유(계좌 미확인/제외 건수)만 메모로 남김
    const info = [];
    if (p.acctKnown === false) info.push('과제 계좌 미확인 (발급 카드 전체를 이 과제 카드로 봄)');
    if (p.otherCards) info.push(`다른 계좌 카드 ${F.money(p.otherCards)}건 제외`);
    if (p.filteredByCard) info.push(`카드 필터로 ${F.money(p.filteredByCard)}건 제외`);
    if (p.matchNote) info.push(p.matchNote);
    const other = info.length ? `<div class="krext-sub krext-dim">${F.esc(info.join(' · '))}</div>` : '';
    if (!p.cards.length) return `<div class="krext-sub krext-dim">이 과제 카드의 미청구 내역 없음</div>${other}`;
    const rows = p.cards.map((c) => txRow(c, false, p.prjNo)).join('');
    return `<table class="krext-cards"><thead><tr><th>카드(뒤8자리)</th><th>사용일시</th><th>가맹점</th><th>승인번호</th><th class="krext-num">사용액</th></tr></thead><tbody>${rows}</tbody></table>${other}`;
  }

  /* R&D ERP 딥링크: rderp_layoutMain.act#krext=... (rnd-hook.js 가 레이아웃 안에서 해당 화면 탭을 연다) */
  function deepLink(req) { return RND_MAIN + '#krext=' + encodeURIComponent(JSON.stringify(req)); }
  /* 청구서(카드): 과제 + 승인번호 행 자동 선택 */
  function claimLink(prjNo, appr, cardNo) {
    return deepLink({ open: 'rexpe_0083_01.act', title: '청구서(카드)', menuId: 'menu_id_362', q: 'PRJ_NO=' + encodeURIComponent(prjNo || ''), appr: appr || '', card: F.digits(cardNo || '').slice(-4) });
  }
  /* 과제정보 (TAB_ID 01 기본정보, 05 카드 등) */
  function projectLink(prjNo, tabId) {
    return deepLink({ open: 'rtask_0008_t00_01.act', title: '과제정보', menuId: 'menu_id_80', q: 'PRJ_NO=' + encodeURIComponent(prjNo || '') + '&TAB_ID=' + (tabId || '01') });
  }

  /* 거래 한 줄. withPrj=true 면 연결 과제(책임자) 열 추가 (카드별 보기). 행 클릭 → 청구서(카드) */
  function txRow(c, withPrj, prjNo) {
    const target = prjNo || (c.projects && c.projects[0] && c.projects[0].prjNo) || '';
    const href = target ? claimLink(target, c.apprNo, c.cardNo) : '';
    const neg = c.amount < 0;
    const shared = c.shared ? ` <span class="krext-tag" title="같은 계좌를 쓰는 여러 과제에 귀속된 거래: ${F.esc((c.linked || []).join(', '))}">공용</span>` : '';
    const linked = (c.projects || []).map((x) => x.rspr || x.prjNo);
    let flag = '';
    if (c.cancel) flag = ` <span class="krext-tag krext-tag-grey" title="승인취소(마이너스) 건">취소</span>`;
    else if (c.cancelled) flag = ` <span class="krext-tag krext-tag-grey" title="같은 일시·금액의 취소 건이 있어 상쇄된 거래">취소됨</span>`;
    else if (c.dupSuspect) flag = ` <span class="krext-tag krext-tag-warn" title="같은 카드·가맹점·금액이 10분 안에 반복됨. 승인번호가 다르면 별개 승인(예: 인원별 결제)이거나 이중 승인일 수 있으니 카드매출전표로 확인">중복의심</span>`;
    const cls = [neg ? 'krext-neg' : '', c.cancelled ? 'krext-cancelled' : '', href ? 'krext-clickable' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}"${href ? ` data-act="claim" data-href="${F.esc(href)}" title="클릭: R&amp;D ERP 청구서(카드)에서 이 건 열기"` : ''}>
      <td class="krext-mono" title="${F.esc(c.cardDiv)} ${F.esc(c.user)}">${F.esc(c.tail)}${withPrj ? '' : shared}</td>
      <td class="krext-mono">${F.esc(F.fmtDate(c.usedDate))} ${F.esc(F.fmtTime(c.usedTime))}</td>
      <td class="krext-shop" title="${F.esc(c.shop)}">${F.esc(c.shop)}${flag}</td>
      <td class="krext-mono krext-dim">${F.esc(c.apprNo)}</td>
      <td class="krext-num" title="${neg ? '승인취소(마이너스) 건' : ''}">${F.money(c.amount)}</td>
      ${withPrj ? `<td class="krext-linked" title="${F.esc(linked.join(', '))}">${F.esc(linked.join(', '))}${linked.length > 1 ? ' <span class="krext-tag">공용</span>' : ''}</td>` : ''}</tr>`;
  }

  /* 카드 한 장 행 (카드별 보기 / 과제별 보기의 공용 카드 묶음 공용) */
  function cardRow(card, state) {
    const key = 'card:' + card.digits;
    const open = state.expanded.has(key);
    const prjs = card.projects.map((x) => `${x.rspr || ''}${x.prjNm ? '(' + x.prjNm.slice(0, 12) + (x.prjNm.length > 12 ? '…' : '') + ')' : ''}`).join(', ');
    const body = open ? `<div class="krext-prj-body"><table class="krext-cards"><thead><tr><th>카드</th><th>사용일시</th><th>가맹점</th><th>승인번호</th><th class="krext-num">사용액</th><th>연결 과제</th></tr></thead><tbody>${card.txs.map((t) => txRow(t, true)).join('')}</tbody></table></div>` : '';
    return `<div class="krext-prj${open ? ' krext-open' : ''}">
      <a href="#" class="krext-prj-row" data-act="prj" data-prj="${F.esc(key)}" title="${F.esc(card.cardDiv)} · 연결 과제: ${F.esc(card.projects.map((x) => `${x.rspr || ''} ${x.prjNm || x.prjNo}`).join(' / '))}">
        <span class="krext-caret">${open ? '▾' : '▸'}</span>
        <span class="krext-prj-rspr krext-mono">${F.esc(card.tail)}</span>
        <span class="krext-prj-nm">${F.esc(card.user)}${card.user ? ' · ' : ''}<span class="krext-dim">연결 과제: ${F.esc(prjs)}${card.projects.length > 1 ? ' <span class="krext-tag">공용</span>' : ''}</span></span>
        <span class="krext-prj-cnt krext-hot">${F.money(card.count)}건</span>
        <span class="krext-prj-amt">${F.money(card.amount)}</span>
      </a>${body}</div>`;
  }

  function cardView(d, state) {
    if (!d.cards || !d.cards.length) return `<div class="krext-msg krext-dim">미청구 카드 거래가 없습니다.</div>${sharedBlock(d, state)}`;
    return `<div class="krext-prj-list">${d.cards.map((card) => cardRow(card, state)).join('')}</div>${sharedBlock(d, state)}`;
  }

  /* 어느 과제에도 귀속되지 않은(계좌 불일치) 카드의 거래 묶음. 설정에서 표시를 켠 경우에만 */
  function sharedBlock(d, state) {
    const s = d.settings || {};
    if (!s.showShared) {
      return d.unattributedCount ? `<div class="krext-sub krext-dim" style="margin-top:8px">과제 계좌와 다른 카드의 미청구 거래 ${F.money(d.unattributedCount)}건은 표시하지 않습니다 (설정 › 미귀속 카드 내역 표시).</div>` : '';
    }
    const list = d.unattributed || [];
    if (!list.length) return '';
    const cnt = list.reduce((x, c) => x + c.count, 0);
    const amt = list.reduce((x, c) => x + c.amount, 0);
    return `<div class="krext-shared">
      <div class="krext-sub"><span class="krext-tag">미귀속</span> 과제 계좌와 다른 카드 ${F.money(list.length)}장 · ${F.money(cnt)}건 · ${F.money(amt)}원
        <span class="krext-dim">— 연결된 과제에는 보이지만 계좌번호가 그 과제 계좌와 달라 어느 과제에도 넣지 않은 거래입니다. 설정에서 과제별로 포함시킬 수 있습니다.</span></div>
      <div class="krext-prj-list">${list.map((card) => cardRow(card, state)).join('')}</div>
    </div>`;
  }

  /* 구역 전환 스위치: 카드미청구 ↔ 과제집행비율 (책임자/과제 목록은 공통, 펼친 내용만 달라짐) */
  function sectionSwitch(d, state) {
    const sec = state.section === 'budget' ? 'budget' : 'cards';
    return `<span class="krext-switch">
      <a href="#" data-act="section" data-section="cards" class="${sec === 'cards' ? 'krext-on' : ''}" title="과제별 카드 미청구 내역">카드미청구 <span class="krext-badge${d.totalCount ? ' krext-badge-hot' : ''}" title="고유 거래 기준">${F.money(d.totalCount)}건</span></a>
      <a href="#" data-act="section" data-section="budget" class="${sec === 'budget' ? 'krext-on' : ''}" title="과제정보 › 자금현황의 비목별 잔액 기준 (미청구 카드 사용액 포함)">과제집행비율</a>
    </span>`;
  }

  /* 과제가 하나도 없을 때 이유 */
  function whyEmpty(d, s, hiddenZero) {
    if (d.projectCount === 0) return '조회된 진행과제가 없습니다.';
    if (d.memberFilter === 'no-id') return `본인 사번/이름을 아직 확인하지 못해 과제를 표시하지 않습니다. <a href="${F.esc(s.rndUrl || RND_MAIN)}" target="_blank" rel="noopener">R&amp;D ERP</a>를 한 번 열거나 설정에 학번/사번을 입력한 뒤 새로고침하세요.`;
    if (d.excludedCount >= d.projectCount) return '모든 과제가 설정에서 제외되어 있습니다.';
    if (d.memberFilter === 'applied' && d.notMemberCount >= d.projectCount - d.excludedCount) return '참여인력에 본인이 포함된 과제가 없습니다. 설정에서 사번을 확인하세요.';
    return hiddenZero ? '미청구 내역이 있는 과제가 없습니다 (설정: 0건 과제 숨김).' : '표시할 과제가 없습니다.';
  }

  function cardsSection(d, s, state) {
    const picked = (s.selectedCards || []).map((x) => F.cardTail(x, 8)).concat(s.cardFilterList || []);
    const filterOn = s.cardFilterMode === 'specific' && picked.length;
    const fnote = filterOn ? `모니터링 카드: ${F.esc(picked.join(', '))}` : '전체 카드';
    let exnote = d.excludedCount ? ` · 제외 과제 ${F.money(d.excludedCount)}` : '';
    if (d.memberFilter === 'applied') exnote += ` · 내 참여 과제만${d.notMemberCount ? ` (미참여 ${F.money(d.notMemberCount)} 제외)` : ''}`;
    else if (d.memberFilter === 'no-id') exnote += ' · 본인 확인 전';
    let dup = (d.sumCount != null && d.sumCount !== d.totalCount) ? ` · 과제 합산 ${F.money(d.sumCount)}건 (같은 계좌를 쓰는 과제 간 중복 포함)` : '';
    if (d.cancelPairs) dup += ` · 취소쌍 ${F.money(d.cancelPairs)}건 포함`;
    if (d.dupSuspects) dup += ` · 중복의심 ${F.money(d.dupSuspects)}쌍`;
    const view = state.view === 'card' ? 'card' : 'project';
    const toggle = `<span class="krext-toggle"><a href="#" data-act="view" data-view="project" class="${view === 'project' ? 'krext-on' : ''}">과제별</a><a href="#" data-act="view" data-view="card" class="${view === 'card' ? 'krext-on' : ''}">카드별</a></span>`;
    const head = `<div class="krext-sec-title">${sectionSwitch(d, state)}
      <span class="krext-note">${F.money(d.totalAmount)}원 · ${fnote}${exnote}${dup}</span>${toggle}</div>`;
    if (view === 'card' && d.projects.length) return `<section class="krext-sec">${head}${cardView(d, state)}</section>`;
    // 0건 과제 숨김은 카드미청구 보기에서만 적용 (과제집행비율 보기는 전체 과제)
    const projects = s.hideZeroProjects ? d.projects.filter((p) => p.count > 0 || p.error) : d.projects;
    if (!projects.length) {
      return `<section class="krext-sec">${head}<div class="krext-msg krext-dim">${whyEmpty(d, s, d.projects.length > 0)}</div></section>`;
    }
    const list = projects.map((p) => {
      const open = state.expanded.has(p.prjNo);
      const period = (p.stDt || p.endDt) ? `${F.fmtDate(p.stDt)} ~ ${F.fmtDate(p.endDt)}` : '';
      const acct = (p.expenseAccts || []).map((a) => `${a.bank} ${a.acctNo}`).join(', ');
      return `<div class="krext-prj${open ? ' krext-open' : ''}${p.count ? '' : ' krext-zero'}">
        <div class="krext-prj-line">
          <a href="#" class="krext-prj-row" data-act="prj" data-prj="${F.esc(p.prjNo)}" title="${F.esc(p.prjNo)} ${F.esc(period)}${p.chrg ? ' / 담당 ' + F.esc(p.chrg) : ''}${acct ? ' / 과제 계좌 ' + F.esc(acct) : ''}">
            <span class="krext-caret">${open ? '▾' : '▸'}</span>
            <span class="krext-prj-rspr">${F.esc(p.rspr || '-')}</span>
            <span class="krext-prj-nm">${F.esc(p.prjNm)}</span>
            <span class="krext-prj-cnt${p.count ? ' krext-hot' : ''}">${F.money(p.count)}건</span>
            <span class="krext-prj-amt">${F.money(p.amount)}</span>
          </a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '01'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 열기 (${F.esc(p.prjNo)})">↗</a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '05'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 › 카드 탭 열기">💳</a>
        </div>
        ${open ? `<div class="krext-prj-body">${cardsTable(p)}</div>` : ''}
      </div>`;
    }).join('');
    return `<section class="krext-sec">${head}<div class="krext-prj-list">${list}</div>${sharedBlock(d, state)}</section>`;
  }

  /* ---------- 과제집행비율 보기 (과제정보 › 자금현황 › 비목별 잔액 + 이 과제 카드 미청구액) ---------- */
  const pct = (v) => (v == null || Number.isNaN(v)) ? '-' : `${(Math.trunc((Number(v) || 0) * 10) / 10).toFixed(1)}%`;
  /* 집행비율 셀: 막대 + 숫자. 90% 이상 주의, 100% 이상 초과 */
  function rateCell(rate, title) {
    if (rate == null || Number.isNaN(rate)) return `<span class="krext-rate krext-dim">-</span>`;
    const r = Number(rate) || 0;
    const cls = r >= 100 ? ' krext-bar-over' : (r >= 90 ? ' krext-bar-warn' : '');
    return `<span class="krext-rate" title="${F.esc(title || '')}"><span class="krext-bar"><span class="krext-bar-fill${cls}" style="width:${Math.max(0, Math.min(100, r))}%"></span></span><span class="krext-rate-v${r >= 100 ? ' krext-red' : ''}">${pct(r)}</span></span>`;
  }

  function budgetTable(p) {
    if (p.budgetError) return `<div class="krext-sub krext-err">자금현황 조회 오류: ${F.esc(p.budgetError)}</div>`;
    const b = p.budget;
    if (!b) return `<div class="krext-sub krext-dim">자금현황 정보를 아직 불러오지 못했습니다. ↻ 새로고침 하세요.</div>`;
    const unbilled = b.unbilled || 0;
    if (!b.items.length && !unbilled) return `<div class="krext-sub krext-dim">비목별 예산 정보가 없습니다 (예산 미등록 또는 조회 권한 없음). <a href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener">R&amp;D ERP 자금현황에서 확인 →</a></div>`;
    const multiRes = (b.resCount || 0) > 1;
    // 설정에서 제외한 비목(인건비/연구수당/간접비)은 계산은 물론 표에서도 뺀다
    const shown = b.items.filter((x) => !x.excluded);
    if (!shown.length && !unbilled) return `<div class="krext-sub krext-dim">설정에서 제외한 비목을 빼면 남는 비목이 없습니다. <a href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener">R&amp;D ERP 자금현황에서 확인 →</a></div>`;
    const rows = shown.map((x) => {
      const name = `${multiRes && x.res ? `<span class="krext-dim">${F.esc(x.res)}</span> ` : ''}${F.esc(x.exp || x.item || '-')}`;
      const tags = `${x.dir ? ' <span class="krext-tag krext-tag-grey" title="직접비 비목">직접비</span>' : ''}${x.psnl ? ' <span class="krext-tag krext-tag-grey" title="인건비 비목">인건비</span>' : ''}`;
      const tip = [x.item ? `예산항목 ${x.item}` : '', `예산액(A) ${F.money(x.bgt)}`, x.cary ? `이월 ${F.money(x.cary)}` : '', x.inter ? `이자 ${F.money(x.inter)}` : '',
        `승인액(B) ${F.money(x.appr)}`, x.req ? `신청 ${F.money(x.req)}` : '', x.purch ? `구매요청 ${F.money(x.purch)}` : '', x.adj ? `예산조정 ${F.money(x.adj)}` : '', `예산잔액(A-B) ${F.money(x.bal)}`].filter(Boolean).join(' · ');
      return `<tr title="${F.esc(tip)}"><td class="krext-bgt-nm">${name}${tags}</td><td class="krext-num">${F.money(x.bgt)}</td><td class="krext-num${x.bal < 0 ? ' krext-red' : ''}">${F.money(x.bal)}</td><td class="krext-num">${rateCell(x.rate, `승인액 ${F.money(x.appr)} / 예산액 ${F.money(x.bgt)}`)}</td></tr>`;
    }).join('');
    // 미청구 행: 이 과제 카드로 사용했지만 아직 청구/승인되지 않은 금액 (공용 거래 제외). 비목 배정 전이므로 예산은 없고 잔액에서 차감
    const ubTip = `이 과제 카드의 미청구 거래 ${F.money(b.unbilledCount || 0)}건 (같은 계좌를 쓰는 다른 과제와 공용인 거래 ${F.money(p.unbilledShared || 0)}건 제외). 청구 전이라 비목이 정해지지 않아 예산잔액 합계에서 차감하고 집행비율에 더합니다.`;
    const ubRow = `<tr class="krext-bgt-unbilled" title="${F.esc(ubTip)}"><td class="krext-bgt-nm">미청구 <span class="krext-tag" title="과제카드 미청구 사용액">과제카드</span> <span class="krext-dim">${F.money(b.unbilledCount || 0)}건</span></td><td class="krext-num krext-dim">-</td><td class="krext-num${unbilled > 0 ? ' krext-red' : ''}">${unbilled ? '−' + F.money(Math.abs(unbilled)) : '0'}</td><td class="krext-num">${unbilled > 0 ? `<span class="krext-rate-plus">+${pct(b.unbilledRate)}</span>` : '<span class="krext-dim">-</span>'}</td></tr>`;
    const foot = `<tr class="krext-bgt-total"><td>합계 <span class="krext-dim">(미청구 반영)</span></td><td class="krext-num">${F.money(b.bgtAmt)}</td><td class="krext-num${b.balAfter < 0 ? ' krext-red' : ''}">${F.money(b.balAfter)}</td><td class="krext-num">${rateCell(b.rateAll, `(승인액 ${F.money(b.apprAmt)} + 미청구 ${F.money(unbilled)}) / 예산액 ${F.money(b.bgtAmt)}`)}</td></tr>`;
    const notes = [`승인액 ${F.money(b.apprAmt)} + 미청구 ${F.money(unbilled)} = 집행 ${F.money(b.execAmt)}원`,
      b.rate != null ? `ERP 기준(미청구 제외) ${pct(b.rate)}` : '',
      b.dirRate != null ? `직접비 집행비율(인건비 포함, ERP 상단 값) ${pct(b.dirRate)}` : '',
      b.std === '20' ? '예산기준: 본예산' : ''].filter(Boolean).join(' · ');
    const link = `<div class="krext-sub"><a href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener">과제정보 › 자금현황 열기 →</a> <span class="krext-dim">${F.esc(notes)}</span></div>`;
    return `<table class="krext-cards krext-bgt"><thead><tr><th>비목</th><th class="krext-num" title="예산액(A)">예산</th><th class="krext-num" title="예산잔액(A-B)">예산잔액</th><th class="krext-num" title="승인액(B) ÷ 예산액(A)">집행비율</th></tr></thead><tbody>${rows}${ubRow}</tbody><tfoot>${foot}</tfoot></table>${link}`;
  }

  function budgetSection(d, s, state) {
    const withB = d.projects.filter((p) => p.budget);
    const tBgt = withB.reduce((x, p) => x + p.budget.bgtAmt, 0);
    const tExec = withB.reduce((x, p) => x + (p.budget.execAmt || 0), 0);
    const tUb = withB.reduce((x, p) => x + (p.budget.unbilled || 0), 0);
    const tRate = tBgt > 0 ? tExec / tBgt * 100 : null;
    let note = withB.length ? `예산 ${F.money(tBgt)}원 · 집행 ${F.money(tExec)}원 (미청구 ${F.money(tUb)} 포함) · ${pct(tRate)}` : '자금현황 정보 없음';
    // 실제로 제외된 비목 이름 (설정 페이지에서 체크를 푼 비목 + 기본 제외 규칙에 걸린 비목)
    const excl = Array.from(new Set(withB.flatMap((p) => p.budget.items.filter((x) => x.excluded).map((x) => x.exp || x.item)).filter(Boolean)));
    if (excl.length) note += ` · ${F.esc(excl.join('·'))} 제외`;
    if (d.memberFilter === 'applied') note += ' · 내 참여 과제만';
    const errs = d.projects.filter((p) => p.budgetError).length;
    if (errs) note += ` · 조회 오류 ${F.money(errs)}건`;
    const head = `<div class="krext-sec-title">${sectionSwitch(d, state)}<span class="krext-note">${note}</span></div>`;
    if (!d.projects.length) return `<section class="krext-sec">${head}<div class="krext-msg krext-dim">${whyEmpty(d, s, false)}</div></section>`;
    const list = d.projects.map((p) => {
      const open = state.expanded.has(p.prjNo);
      const b = p.budget;
      const period = (p.stDt || p.endDt) ? `${F.fmtDate(p.stDt)} ~ ${F.fmtDate(p.endDt)}` : '';
      const tip = `${p.prjNo} ${period}${b ? ` / 예산 ${F.money(b.bgtAmt)} · 승인 ${F.money(b.apprAmt)} · 미청구 ${F.money(b.unbilled || 0)} · 잔액 ${F.money(b.balAfter)}` : ''}`;
      const rate = b ? rateCell(b.rateAll, `(승인액 + 미청구) / 예산액`) : `<span class="krext-rate ${p.budgetError ? 'krext-err' : 'krext-dim'}">${p.budgetError ? '오류' : '-'}</span>`;
      return `<div class="krext-prj${open ? ' krext-open' : ''}">
        <div class="krext-prj-line">
          <a href="#" class="krext-prj-row" data-act="prj" data-prj="${F.esc(p.prjNo)}" title="${F.esc(tip)}">
            <span class="krext-caret">${open ? '▾' : '▸'}</span>
            <span class="krext-prj-rspr">${F.esc(p.rspr || '-')}</span>
            <span class="krext-prj-nm">${F.esc(p.prjNm)}</span>
            <span class="krext-prj-rate">${rate}</span>
            <span class="krext-prj-amt${b && b.balAfter < 0 ? ' krext-red' : ''}" title="예산잔액 (미청구 차감)">${b ? F.money(b.balAfter) : '-'}</span>
          </a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '01'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 열기 (${F.esc(p.prjNo)})">↗</a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 › 자금현황 탭 열기">📊</a>
        </div>
        ${open ? `<div class="krext-prj-body">${budgetTable(p)}</div>` : ''}
      </div>`;
    }).join('');
    const exclLegend = excl.length ? ` ${F.esc(excl.join('·'))}은(는) 설정(과제집행비율 비목 선택)에 따라 계산과 표에서 뺐습니다.` : '';
    const legend = `<div class="krext-sub krext-dim" style="margin-top:6px">집행비율 = (승인액 + 이 과제 카드 미청구액) ÷ 예산액. 잔액은 미청구액을 뺀 값이며, 공용 거래는 어느 과제에도 넣지 않습니다.${exclLegend}</div>`;
    return `<section class="krext-sec">${head}<div class="krext-prj-list">${list}</div>${legend}</section>`;
  }

  function render(host, state) {
    const d = state.data;
    const s = (d && d.settings) || {};
    const rnd = state.rndUrl || s.rndUrl || RND_MAIN;
    host.classList.toggle('krext-collapsed', !!state.collapsed);
    host.classList.toggle('krext-popup', state.mode === 'popup');
    const updated = d && d.ts ? `${F.fmtClock(d.ts)} 기준` : '';
    // 헤더 아무 곳(버튼 제외)을 클릭해도 접기/펼치기. 팝업에는 접기가 없음
    const headAct = state.mode === 'popup' ? '' : ` data-act="toggle" title="${state.collapsed ? '클릭: 펼치기' : '클릭: 접기'}"`;
    let html = `<div class="krext-head"${headAct}>
      <span class="krext-title">R&amp;D ERP 현황</span>
      <span class="krext-chips">${headerChips(d)}</span>
      <span class="krext-updated">${state.loading ? '조회 중…' : F.esc(updated)}</span>
      <button type="button" class="krext-btn" data-act="refresh" title="새로고침"${state.loading ? ' disabled' : ''}>↻</button>
      <button type="button" class="krext-btn" data-act="settings" title="설정">⚙</button>
      ${state.mode === 'popup' ? '' : `<button type="button" class="krext-btn" data-act="toggle" title="${state.collapsed ? '펼치기' : '접기'}">${state.collapsed ? '▢' : '－'}</button>`}
    </div>`;
    if (!state.collapsed) {
      html += `<div class="krext-body">`;
      if (state.fatal) html += `<div class="krext-msg krext-err">${F.esc(state.fatal)}</div>`;
      if (d) {
        if (d.loginRequired) {
          html += `<div class="krext-msg krext-warn">R&amp;D ERP 로그인이 필요합니다. <a href="${F.esc(rnd)}" target="_blank" rel="noopener">R&amp;D ERP 열기</a> 후 ↻ 새로고침 하세요.</div>`;
        } else if (d.error) {
          html += `<div class="krext-msg krext-err">조회 오류: ${F.esc(d.error)}</div>`;
        }
        const main = d.loginRequired ? '' : (state.section === 'budget' ? budgetSection(d, s, state) : cardsSection(d, s, state));
        html += `<div class="krext-cols">${unapprovedSection(d, s)}${main}</div>`;
      } else if (state.loading) {
        html += `<div class="krext-msg krext-dim">불러오는 중…</div>`;
      }
      const range = (d && s.monthsBack != null) ? ` · 사용일자 ${F.esc(s.monthsBack)}개월 전 ~ ${F.esc(s.monthsForward)}개월 후` : '';
      const ver = state.version ? ` · v${F.esc(state.version)}` : '';
      html += `<div class="krext-foot"><a href="${F.esc(rnd)}" target="_blank" rel="noopener">R&amp;D ERP 열기</a> · <a href="#" data-act="settings">설정</a>${range}${ver}</div></div>`;
    }
    host.innerHTML = html;
  }

  g.KRX_RENDER = { render };
})(typeof self !== 'undefined' ? self : this);
