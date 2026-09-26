/* 패널 렌더러 (eClass 콘텐츠스크립트 / 팝업 공용) */
(function (g) {
  const F = g.KRX_FMT;
  const RND_MAIN = 'https://rnd.krs.co.kr/rderp_layoutMain.act';
  const ECLASS_HOME = 'https://eclass.krs.co.kr/eClassVer4/Home/Index';

  /* 로그인 안내: R&D ERP 주소를 바로 열면 세션이 만들어지지 않는다. 처음 한 번은 eClass 의 R&D ERP 메뉴로 들어가야 한다.
   * 자동 로그인(eClass SSO, background.js rndAutoLogin)이 켜져 있으면 조회 때마다 먼저 시도하므로, 여기까지 온 것은 eClass 도 풀렸거나(eclassLogin) SSO 가 실패한 경우 */
  function loginNotice(state) {
    const d = state.data || {};
    const where = state.mode === 'popup'
      ? `<a href="${ECLASS_HOME}" target="_blank" rel="noopener">eClass</a>를 열고 `
      : 'eClass 화면의 ';
    const eclass = state.mode === 'popup' ? `<a href="${ECLASS_HOME}" target="_blank" rel="noopener">eClass</a>` : 'eClass';
    const manual = `${where}<b>R&amp;D ERP</b> 메뉴를 클릭해서 로그인해주세요. (처음 로그인은 이 메뉴를 거쳐야 세션이 만들어집니다.) 로그인 후 ↻ 새로고침 하세요.`;
    let how;
    if (d.eclassLogin) how = `eClass 로그인이 풀려 자동 로그인(SSO)을 못 했습니다. ${eclass}에 다시 로그인하면 다음 조회 때 R&amp;D ERP 에 자동으로 로그인합니다 (또는 ↻).`;
    else if (d.autoLogin && !d.autoLogin.ok) how = `자동 로그인(SSO)에 실패했습니다: ${F.esc(d.autoLogin.error || d.autoLogin.kind || '')} — ${manual}`;
    else if (d.autoLogin && d.autoLogin.ok) how = `자동 로그인(SSO)을 했지만 R&amp;D ERP 가 여전히 로그인이 필요하다고 응답합니다. ${manual}`;
    else how = manual;
    return `<div class="krext-msg krext-warn">R&amp;D ERP 로그인이 필요합니다. ${how}</div>`;
  }

  /* 큰 숫자 칸. quiet 면 값이 있어도 강조(krext-hot)하지 않음 (건수가 아닌 금액용) */
  function stat(label, val, cls, href, title, quiet) {
    const v = (val == null || Number.isNaN(val)) ? '-' : F.money(val);
    const hot = !quiet && (val || 0) > 0 ? ' krext-hot' : '';
    return `<a class="krext-stat${hot}" href="${F.esc(href)}" target="_blank" rel="noopener" title="${F.esc(title || 'R&D ERP에서 확인')}">
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

  /* 설정의 카드 별명 { 카드번호 숫자(전체 또는 뒷자리): 별명 }. render() 가 현재 설정으로 채운다.
   * 전체 번호가 정확히 같은 항목 우선, 없으면 뒷자리가 맞는 항목 중 가장 긴 키 */
  let cardNames = {};
  function cardName(cardNo) {
    const d = F.digits(cardNo); if (!d) return '';
    if (cardNames[d]) return String(cardNames[d]);
    let best = '', bestLen = 0;
    for (const [k, v] of Object.entries(cardNames)) {
      const x = F.digits(k);
      if (x && v && x.length > bestLen && (d.endsWith(x) || x.endsWith(d))) { best = String(v); bestLen = x.length; }
    }
    return best;
  }

  /* 헤더 요약 칩. opts.href 면 링크 칩(새 탭), opts.section 이면 구역 전환 칩(data-act=section, 현재 구역이면 krext-on).
   * val 이 undefined 면 숫자 없이 라벨만, null 이면 '-'. 헤더 전체가 접기 버튼이지만 eclass.js 는 a 클릭·data-act 칩을 접기로 처리하지 않는다 */
  function chip(label, val, hotCls, title, opts) {
    const o = opts || {};
    const has = val != null && !Number.isNaN(val);
    const hot = has && val > 0;
    const cls = `krext-chip${hot && hotCls ? ' ' + hotCls : ''}${o.section ? ' krext-chip-sec' : ''}${o.on ? ' krext-on' : ''}`;
    const inner = `<span class="krext-chip-l">${F.esc(label)}</span>${val === undefined ? '' : `<span class="krext-chip-v">${has ? F.money(val) : '-'}</span>`}`;
    const t = ` title="${F.esc(title || label)}"`;
    if (o.href) return `<a class="${cls}" href="${F.esc(o.href)}" target="_blank" rel="noopener"${t}>${inner}</a>`;
    if (o.section) return `<a class="${cls}" href="#" data-act="section" data-section="${F.esc(o.section)}"${t}>${inner}</a>`;
    return `<span class="${cls}"${t}>${inner}</span>`;
  }

  function headerChips(d, state) {
    if (!d) return '';
    if (d.loginRequired) return d.eclassLogin
      ? `<span class="krext-chip krext-chip-warn" title="eClass 로그인이 풀려 R&amp;D ERP 자동 로그인(SSO)을 못 했습니다. eClass에 로그인하면 다음 조회 때 자동으로 로그인합니다"><span class="krext-chip-l">eClass 로그인 필요</span></span>`
      : `<span class="krext-chip krext-chip-warn" title="${d.autoLogin && !d.autoLogin.ok ? '자동 로그인(SSO) 실패: ' + F.esc(d.autoLogin.error || d.autoLogin.kind || '') + ' — ' : ''}eClass의 R&amp;D ERP 메뉴를 클릭해서 로그인해주세요"><span class="krext-chip-l">R&amp;D ERP 로그인 필요</span></span>`;
    const u = unapprovedCounts(d);
    const src = u ? (u.source === 'live' ? '실시간' : `R&D ERP 방문 ${F.fmtClock(d.unapprovedSnapshot.ts)} 기준`) : '아직 수집되지 않음';
    const sec = state && state.section === 'budget' ? 'budget' : 'cards';
    return chip('보완요청', u ? u.supplement : null, 'krext-chip-red', `보완요청 (${src})`)
         + chip('신청', u ? u.apply : null, 'krext-chip-blue', `신청 ${u ? F.money(u.apply) + '건 ' : ''}(내가 올려 결재 진행 중인 건 · ${src}) · 클릭: ${MY_APPLY_TITLE}`, { href: myApplyBoxLink() })
         // 받은 결재요청(내 결재대기): 다른 사람이 나를 결재자로 지정해 올린 건 — 개인결재함 결재대기함
         + chip('결재', d.inbox ? d.inbox.mine : null, 'krext-chip-red', d.inbox ? `받은 결재요청 ${F.money(d.inbox.mine)}건 (내 결재대기 · 실시간) · 클릭: ${APPR_BOX_TITLE} 결재대기함` : (d.inboxError ? `결재대기 조회 오류: ${d.inboxError}` : '결재대기 건수는 사번을 감지한 뒤 조회됩니다 (R&D ERP 를 한 번 열면 감지)'), { href: approvalBoxLink() })
         // 미청구(건수가 있어도 다른 칩과 같은 회색) / 집행비율: 본문 구역 전환. 접힌 패널이면 펼친다 (eclass.js)
         + chip('미청구', d.totalCount, '', `카드미청구 ${F.money(d.totalCount)}건 · ${F.money(d.totalAmount)}원 · 클릭: 과제별 카드 미청구 내역 보기`, { section: 'cards', on: sec === 'cards' })
         + chip('집행비율', undefined, '', '클릭: 과제집행비율 보기 (과제정보 › 자금현황의 비목별 잔액 기준)', { section: 'budget', on: sec === 'budget' });
  }

  /* 미승인내역: 보완요청 / 신청 두 칸을 한 줄에, 구역 제목 오른쪽에 임시저장 · 구매요청 건수.
   * 동기화 시각은 헤더의 "HH:MM 기준" 하나만 쓰고(조회 시각은 칸 툴팁), 실시간 조회가 실패해 메인화면 방문 스냅샷을 쓸 때만 그 방문 시각을 제목 옆에 표시 */
  function unapprovedSection(d, s) {
    const link = s.unapprovedLinkUrl || s.rndUrl || RND_MAIN;
    // 받은 결재요청(내 결재대기) 칸: 다른 사람이 나를 결재자로 지정해 올린 건 (rmain_0002_01_r001 USER_APPR_CNT). 사번을 모르면 '-'
    const ib = d.inbox;
    const ibTitle = ib ? `받은 결재요청 ${F.money(ib.mine)}건 — 다른 사람이 나를 결재자로 지정해 올린 건 (내 결재대기, 실시간 ${F.fmtClock(ib.ts)})${ib.dept != null ? ` · 부서 결재대기 ${F.money(ib.dept)}건` : ''} · 클릭: ${APPR_BOX_TITLE} 결재대기함`
      : d.inboxError ? `결재대기 조회 오류: ${d.inboxError}` : '결재대기 건수는 사번(USER_ID)을 감지한 뒤 조회됩니다 — R&D ERP 를 한 번 열면 자동 감지';
    let note = '', body = '', src = '', c = null;
    if (d.unapproved) {
      const u = d.unapproved;
      src = `실시간 ${F.fmtClock(u.ts || d.ts)}`;
      c = { supplement: u.supplement, apply: u.apply, temp: u.temp, purchase: u.purchase };
    } else if (d.unapprovedSnapshot && d.unapprovedSnapshot.items) {
      const it = d.unapprovedSnapshot.items, cnt = (k) => it[k] ? it[k].count : null;
      src = note = `R&D ERP 방문 ${F.fmtClock(d.unapprovedSnapshot.ts)} 기준`;
      c = { supplement: cnt('보완요청'), apply: cnt('신청'), temp: cnt('임시저장'), purchase: cnt('구매요청') };
    }
    if (c) {
      body = stat('보완요청', c.supplement, '', link, `보완요청 (${src}) · 클릭: R&D ERP에서 확인`, true)
           + stat('신청', c.apply, '', myApplyBoxLink(), `신청 ${F.money(c.apply)}건 — 내가 올려 결재 진행 중인 건 (${src}) · 클릭: ${MY_APPLY_TITLE}`, true)
           + stat('결재', ib ? ib.mine : null, '', approvalBoxLink(), ibTitle, true);   // 세 칸 모두 같은 색·강조 없음 (숫자 색과 신청 칸 강조를 빼 달라는 요청, 2026-09-25)
      if (!d.unapproved && !s.unapprovedConfigured) body += `<div class="krext-sub krext-dim">실시간 조회 서비스가 아직 설정되지 않아 마지막 방문 시점 값을 표시합니다.</div>`;
    } else {
      body = `<div class="krext-msg krext-dim">아직 수집된 값이 없습니다. <a href="${F.esc(link)}" target="_blank" rel="noopener">R&D ERP 메인화면</a>을 한 번 열면 자동으로 수집됩니다.</div>`;
    }
    if (d.unapprovedError) body += `<div class="krext-sub krext-err">미승인내역 조회 오류: ${F.esc(d.unapprovedError)}</div>`;
    if (d.inboxError) body += `<div class="krext-sub krext-err">결재대기 조회 오류: ${F.esc(d.inboxError)}</div>`;
    if (ib && ib.itemsError) body += `<div class="krext-sub krext-err">결재대기함 목록 조회 오류: ${F.esc(ib.itemsError)}</div>`;
    // 제목 줄 오른쪽: 임시저장 · 구매요청 (값이 있을 때만, 0이면 회색 숫자)
    const mini = (label, v) => `<span title="${F.esc(`${label} ${F.money(v)}건 (${src})`)}">${F.esc(label)} <b${(v || 0) > 0 ? '' : ' class="krext-dim"'}>${F.money(v)}</b></span>`;
    const side = [];
    if (c && c.temp != null) side.push(mini('임시저장', c.temp));
    if (c && c.purchase != null) side.push(mini('구매요청', c.purchase));
    const right = side.length ? `<span class="krext-sec-r">${side.join('<span class="krext-dim">·</span>')}</span>` : '';
    return `<section class="krext-sec krext-unappr"><div class="krext-sec-title">미승인내역${note ? `<span class="krext-note">${F.esc(note)}</span>` : ''}${right}</div><div class="krext-stats">${body}</div>${inboxRows(d)}</section>`;
  }

  /* 받은 결재요청 목록 (미승인내역 구역 아래): 개인결재함 결재대기함 행 — 신청자 · 업무구분 · 대표과제명 · 금액 · 대표적요. 클릭하면 개인결재함 */
  function inboxRows(d) {
    const ib = d.inbox;
    if (!ib || !(ib.items || []).length) return '';
    const href = approvalBoxLink();
    const rows = ib.items.slice(0, 8).map((it) => {
      const title = `${it.procTyp || ''} · ${it.prjNm || ''}${it.prjRspr ? ` (과제책임자 ${it.prjRspr})` : ''} · 문서번호 ${it.docNo || '-'} · 신청 ${it.draftDate || '-'} · 상태 ${it.status || '-'}${it.expStatus ? ' / ' + it.expStatus : ''} · 클릭: ${APPR_BOX_TITLE}`;
      return `<a class="krext-inbox-row" href="${F.esc(href)}" target="_blank" rel="noopener" title="${F.esc(title)}"><b>${F.esc(it.draftUser || '-')}</b><span class="krext-inbox-what">${F.esc([it.procTyp, it.prjNm].filter(Boolean).join(' · '))}</span><span class="krext-inbox-amt">${it.amount != null ? F.money(it.amount) + '원' : ''}</span>${it.cont ? `<span class="krext-inbox-cont">${F.esc(it.cont)}</span>` : ''}</a>`;
    }).join('');
    const more = ib.items.length > 8 ? `<div class="krext-sub krext-dim">외 ${F.money(ib.items.length - 8)}건 — 개인결재함에서 확인</div>` : '';
    return `<div class="krext-inbox">${rows}${more}</div>`;
  }

  function cardsTable(p, state) {
    if (p.error) return `<div class="krext-sub krext-err">조회 오류: ${F.esc(p.error)}</div>`;
    // 발급 카드 수·원본 건수 같은 일상 정보는 행 자체와 중복이라 표시하지 않고, 누락 이유(계좌 미확인/제외 건수)만 메모로 남김
    const info = [];
    if (p.acctKnown === false) info.push('과제 계좌 미확인 (발급 카드 전체를 이 과제 카드로 봄)');
    if (p.otherCards) info.push(`다른 계좌 카드 ${F.money(p.otherCards)}건 제외`);
    if (p.filteredByCard) info.push(`카드 필터로 ${F.money(p.filteredByCard)}건 제외`);
    if (p.matchNote) info.push(p.matchNote);
    const other = info.length ? `<div class="krext-sub krext-dim">${F.esc(info.join(' · '))}</div>` : '';
    if (!p.cards.length) return `<div class="krext-sub krext-dim">이 과제 카드의 미청구 내역 없음</div>${other}`;
    const show = prepShown(state, p.prjNo);   // 과제 줄 끝 청구 아이콘이 켜졌을 때만 청구 준비 요소
    const rows = p.cards.map((c) => txRow(c, false, p.prjNo, state, show)).join('');
    return `<table class="krext-cards"><thead><tr><th>카드(뒤8자리)</th><th>사용일시</th><th>가맹점</th><th>승인번호</th><th class="krext-num">사용액</th></tr></thead><tbody>${rows}</tbody></table>${other}`;
  }

  /* R&D ERP 딥링크: rderp_layoutMain.act#krext=... (rnd-hook.js 가 레이아웃 안에서 해당 화면 탭을 연다) */
  function deepLink(req) { return RND_MAIN + '#krext=' + encodeURIComponent(JSON.stringify(req)); }
  /* 청구서(카드): 과제 + 승인번호 행 자동 선택 */
  function claimLink(prjNo, appr, cardNo) {
    return deepLink({ open: 'rexpe_0083_01.act', title: '청구서(카드)', menuId: 'menu_id_362', q: 'PRJ_NO=' + encodeURIComponent(prjNo || ''), appr: appr || '', card: F.digits(cardNo || '').slice(-4) });
  }
  /* 개인결재함 (전자결재 › 결재함, rappr_0002_01). 메뉴 ID는 사용자마다 다른 메뉴 트리에서 rnd-hook.js 가 화면 URL·메뉴 이름으로 찾고,
   * 못 찾으면 결재함 상단 메뉴(menu_id_7, 레이아웃이 SSO 로그인 시 클릭하는 메뉴)를 클릭한다. 화면이 URL 파라미터를 받지 않아 탭·조건은 넘기지 않음 */
  const APPR_BOX_TITLE = 'R&D ERP 개인결재함 열기 (전자결재 › 결재함)';
  function approvalBoxLink() {
    return deepLink({ open: 'rappr_0002_01.act', title: '개인결재함', menuName: '개인결재함', topMenuId: 'menu_id_7' });
  }
  /* MY신청함 (전자결재 › 결재함, rappr_0001_01 "내결재함"): 내가 올린 신청(결의서) 목록 — 미승인내역의 "신청" 건수(APPLY_CNT)는 여기의 결재진행 건. ERP 대시보드도 신청 칸을 이 화면으로 연결하도록 돼 있음(주석 처리됨).
   * 화면은 URL 파라미터를 받지 않고 열리면 기본 조건(신청일자 최근 1개월 · 상태 전체)으로 바로 조회한다 (2026-09-25 CDP 확인: 신청한 결의서가 첫 행에 "결재진행"으로 표시) */
  const MY_APPLY_TITLE = 'R&D ERP MY신청함 열기 (내가 올린 신청 목록, 전자결재 › 결재함)';
  function myApplyBoxLink() {
    return deepLink({ open: 'rappr_0001_01.act', title: 'MY신청함', menuName: 'MY신청함', topMenuId: 'menu_id_7' });
  }
  /* 미신청내역조회 (전자결재 › 결재함, rappr_0017_01): 임시저장(40)·보완요청(30) 상태의 내 결의서 목록 — 미승인내역의 임시저장·보완요청 건수가 여기 건. ERP 대시보드가 임시저장·보완요청 칸에 쓰는 주소와 같이
   * DASH_MNTH_RANGE=1(등록일자 최근 1개월)·AUTO_SEARCH=Y(열리면 바로 조회)를 붙인다 — 화면 스크립트 applyDashboardNotApplInqEntry 가 이 둘만 읽고 상태 라디오(APPR_DIV_CD)는 주소로 못 정한다 (2026-09-25 CDP 확인) */
  const NOT_APPLIED_TITLE = 'R&D ERP 미신청내역조회 열기 (임시저장·보완요청 상태의 내 결의서 목록, 최근 1개월 자동 조회)';
  function notAppliedLink() {
    return deepLink({ open: 'rappr_0017_01.act', title: '미신청내역조회', menuName: '미신청내역조회', topMenuId: 'menu_id_7', q: 'DASH_MNTH_RANGE=1&AUTO_SEARCH=Y' });
  }
  /* 과제정보 (TAB_ID 01 기본정보, 05 카드 등) */
  function projectLink(prjNo, tabId) {
    return deepLink({ open: 'rtask_0008_t00_01.act', title: '과제정보', menuId: 'menu_id_80', q: 'PRJ_NO=' + encodeURIComponent(prjNo || '') + '&TAB_ID=' + (tabId || '01') });
  }

  /* ---------- 과제 참여율 (과제정보 › 참여인력 › 계상률기준내역의 본인 계상률 합, rnd-api summarizeParticipation) ----------
   * 접힌 줄: 막대 + 합계 %. 클릭(data-act=prj, key __participation → state.expanded)하면 과제별 참여율·참여기간 표
   * 예비 참여율(참여 계획, lib/part.js): 과제 행의 ＋ 로 참여율·기간(달력)을 적어 두면 그 행 밑에 "↳ 계획 ✎ ×" 줄로 보이고,
   * 합계(ERP 계상률, 변경 전) 줄은 그대로 둔 채 그 밑에 오늘부터 계획이 든 기간별 "계획 반영" 합계 줄(계획 과제는 계획 참여율, 나머지는 그날의 계상률 행·과제 종료일 기준, P.periods)을 보여준다.
   * 표에 없는 과제(ERP 에 아직 없는 과제)의 계획은 표 끝 "다른 과제 참여 계획" ＋ 로 과제명과 함께 적는다 */
  const PART_KEY = '__participation';
  const rateTxt = (v) => (v == null || Number.isNaN(v)) ? '-' : `${Number.isInteger(Number(v)) ? Number(v) : (Math.round(Number(v) * 100) / 100)}%`;
  const shortD8 = (s) => { const d = F.digits(s).slice(0, 8); return d.length === 8 ? `${d.slice(2, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : ''; };
  // 과제명은 앞 6자만 (전체 이름은 툴팁)
  const shortNm = (nm) => { const s = String(nm || '').trim(); return s.length > 6 ? s.slice(0, 6) + '…' : s; };
  const overCls = (v) => v > 100 ? ' krext-red' : '';
  const spare = (v) => v > 100 ? '100% 초과' : `여유 ${rateTxt(Math.round((100 - v) * 100) / 100)}`;
  const sumTxt = (at) => at.parts.map((p) => `${shortNm(p.prjNm) || p.prjNo} ${p.ended ? '종료' : rateTxt(p.rate)}${p.planned ? '(계획)' : ''}`).join(' + ');
  /* 참여 계획 줄: 이름 칸에 "↳ 계획 ✎ ×" 를 한 줄로(표에 없는 과제면 뒤에 과제명), 참여율 · 기간 칸. 기간별 합계는 표 아래 계획 반영 줄에 */
  function partPlanRow(e, other, endDt) {
    const tip = [`참여 계획 ${rateTxt(e.rate)} · ${e.st || '?'} ~ ${e.end || '미정'}`, e.prjNm || '', `${F.fmtClock(e.ts)} 입력 · 이 브라우저에만 저장`].filter(Boolean).join(' · ');
    const ref = `data-id="${F.esc(e.id)}" data-end="${F.esc(endDt || '')}"${other ? ' data-free="1"' : ''}`;
    const acts = `<span class="krext-plan-acts"><button type="button" data-act="part-edit" ${ref} title="수정">✎</button><button type="button" data-act="part-del" ${ref} title="삭제">×</button></span>`;
    return `<tr class="krext-part-plan" title="${F.esc(tip)}"><td class="krext-part-nm"><span class="krext-plan-head"><span class="krext-plan-ind">↳</span><span class="krext-tag krext-tag-sub">계획</span>${acts}${other ? `<span class="krext-plan-nm">${F.esc(shortNm(e.prjNm))}</span>` : ''}</span></td>
      <td class="krext-num krext-plan-rate">${rateTxt(e.rate)}</td><td class="krext-part-term krext-dim krext-mono">${F.esc(`${shortD8(e.st) || '?'} ~ ${shortD8(e.end)}`)}</td></tr>`;
  }
  /* 참여기간 달력 (state.partCal): 시작일 → 종료일 순서로 클릭. 프리셋: 오늘부터 / 연말까지 / 과제 종료까지(과제 종료일이 있을 때) */
  function partCalendar(P, state) {
    const c = state.partCal; if (!c) return '';
    const d = state.partDraft || {}, st = P.d8(d.st), end = P.d8(d.end), today = F.ymd(new Date());
    const cells = P.monthGrid(c.ym).map((x) => {
      const cls = ['krext-cal-d', x.out ? 'krext-cal-out' : '', x.day === today ? 'krext-cal-today' : '', (x.day === st || x.day === end) ? 'krext-cal-sel' : '', st && end && x.day > st && x.day < end ? 'krext-cal-in' : ''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-act="part-cal-day" data-day="${x.day}" title="${x.day.slice(0, 4)}-${x.day.slice(4, 6)}-${x.day.slice(6, 8)}">${x.d}</button>`;
    }).join('');
    const endDt = state.partEdit && state.partEdit.endDt;
    const hint = (c.pick === 'st' || !st) ? '시작일을 고르세요' : `종료일을 고르세요 (시작 ${shortD8(st)}${end ? ` ~ ${shortD8(end)}` : ''})`;
    return `<div class="krext-cal" role="dialog" aria-label="참여기간 선택">
      <div class="krext-cal-head"><button type="button" data-act="part-cal-nav" data-d="-1" title="이전 달">‹</button><b>${c.ym.slice(0, 4)}년 ${Number(c.ym.slice(4, 6))}월</b><button type="button" data-act="part-cal-nav" data-d="1" title="다음 달">›</button></div>
      <div class="krext-cal-hint">${F.esc(hint)}</div>
      <div class="krext-cal-grid">${['일', '월', '화', '수', '목', '금', '토'].map((w, i) => `<span class="krext-cal-wd${i === 0 ? ' krext-red' : ''}">${w}</span>`).join('')}${cells}</div>
      <div class="krext-cal-foot"><button type="button" data-act="part-cal-set" data-st="today" title="시작일 = 오늘">오늘부터</button><button type="button" data-act="part-cal-set" data-end="year" title="종료일 = 시작일이 속한 해의 12월 31일">연말까지</button>${endDt ? `<button type="button" data-act="part-cal-set" data-end="${F.esc(endDt)}" title="종료일 = 과제 종료일 ${F.esc(shortD8(endDt))}">과제 종료까지</button>` : ''}<button type="button" data-act="part-cal-clear" title="기간 지우기">지움</button><button type="button" data-act="part-cal-close" title="닫기 (Esc)">닫기</button></div></div>`;
  }
  /* 참여 계획 입력 폼 (한 번에 하나만: state.partEdit). 표 밖 과제 폼(free)에는 과제명 칸이 앞에 붙는다. 값은 state.partDraft 에 있어 다시 그려도 입력이 유지된다 */
  function partForm(P, state, names) {
    const pe = state.partEdit, d = state.partDraft || { name: '', rate: '', st: '', end: '' };
    const st = P.d8(d.st), end = P.d8(d.end);
    const period = st ? `${shortD8(st)} ~ ${end ? shortD8(end) : '미정'}` : '기간 선택';
    return `<tr class="krext-part-form"><td colspan="3"><div class="krext-plan-form krext-part-frm">
      <span class="krext-plan-ind">↳</span>
      ${pe.free ? `<input type="text" data-part="name" list="krext-part-names" placeholder="과제명 (ERP에 아직 없는 과제)" value="${F.esc(d.name)}" maxlength="80" autocomplete="off" title="과제명. 패널의 과제 목록에 있는 이름이면 그 과제로 연결됩니다">` : ''}
      <label>참여율 <input type="text" inputmode="decimal" data-part="rate" value="${F.esc(d.rate)}" placeholder="0" title="예비 참여율 (%)">%</label>
      <button type="button" class="krext-part-cal-btn${state.partCal ? ' krext-on' : ''}${st ? '' : ' krext-part-cal-empty'}" data-act="part-cal" title="참여기간 선택 — 달력에서 시작일, 종료일 순서로 클릭 (종료일을 비우면 미정)">${ICON_CAL}${F.esc(period)}</button>
      <button type="button" class="krext-plan-btn krext-plan-save" data-act="part-save">${pe.id ? '저장' : '추가'}</button>
      <button type="button" class="krext-plan-btn" data-act="part-cancel" title="취소 (Esc)">취소</button>
      ${state.partError ? `<span class="krext-err krext-plan-err">${F.esc(state.partError)}</span>` : ''}
      ${partCalendar(P, state)}
    </div>${pe.free ? `<datalist id="krext-part-names">${names.map((n) => `<option value="${F.esc(n)}"></option>`).join('')}</datalist>` : ''}</td></tr>`;
  }
  function participationSection(d, s, state) {
    if (d.loginRequired) return '';
    const pt = d.participation;
    const P = g.KRX_PART, plans = (P && Array.isArray(state.partPlans)) ? state.partPlans : [];
    const title = (note) => `<div class="krext-sec-title">과제 참여율 <span class="krext-note">${note}</span></div>`;
    if (!pt) {
      let why = '참여인력 정보 없음';
      if (d.participationError) why = '조회 오류';
      else if (d.memberFilter === 'no-id' || (!(d.myIds || []).length && !(d.myNames || []).length)) why = '본인 사번/이름 확인 전';
      else if (d.memberFilter === 'ambiguous') why = '동명이인 확인 필요 (설정에서 사번 선택)';
      return `<section class="krext-sec krext-part">${title(F.esc(why))}${d.participationError ? `<div class="krext-sub krext-err">${F.esc(d.participationError)}</div>` : ''}</section>`;
    }
    const open = state.expanded.has(PART_KEY);
    const total = pt.total || 0;
    const cls = total > 100 ? ' krext-bar-over' : '';   // 참여율은 100% 가까운 게 정상이라 90% 주의색 없이 파랑, 100% 초과만 빨강
    const tip = [`본인 계상률 합계 ${rateTxt(total)} / 100% (참여 과제 ${F.money(pt.items.length)}건, 오늘이 참여기간에 드는 계상률기준 행만)`,
      pt.totalExcluded ? `계상률 체크제외 ${rateTxt(pt.totalExcluded)} 는 합계에서 제외` : '',
      pt.unknownCount ? `계상률 미상 ${F.money(pt.unknownCount)}건 (인력기준내역에만 있음)` : '',
      pt.errorCount ? `참여인력 조회 실패 ${F.money(pt.errorCount)}건` : '',
      plans.length ? `참여 계획 ${F.money(plans.length)}건 (표의 ＋ 로 적은 예비 참여율)` : '',
      pt.useId ? '사번 기준' : '이름 기준',
      d.membershipCheckedAt ? `참여인력 ${F.fmtClock(d.membershipCheckedAt)} 조회 (2시간 캐시 · 제목 줄 ↻ 로 다시 조회)` : '',
      d.membershipFailed ? `참여인력 다시 조회 실패 ${F.money(d.membershipFailed)}건 — 이전 값 사용 (${d.membershipFailMsg || '오류'})` : '', '클릭: 과제별 참여율'].filter(Boolean).join(' · ');
    const head = `<a href="#" class="krext-part-head" data-act="prj" data-prj="${PART_KEY}" title="${F.esc(tip)}">
      <span class="krext-caret">${open ? '▾' : '▸'}</span>
      <span class="krext-bar krext-part-bar"><span class="krext-bar-fill${cls}" style="width:${Math.max(0, Math.min(100, total))}%"></span></span>
      <span class="krext-part-v${total > 100 ? ' krext-red' : ''}">${rateTxt(total)}</span><span class="krext-dim krext-part-max">/ 100%</span>
      <span class="krext-dim krext-part-cnt">${F.money(pt.items.length)}개 과제${plans.length ? ` · 계획 ${F.money(plans.length)}` : ''}</span></a>`;
    let body = '';
    if (open) {
      const shortTerm = (t) => String(t || '').replace(/\s+/g, '').replace(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})/g, (m, y, mo, dd) => `${y.slice(2)}.${mo}.${dd}`).replace(/(\d{4})[-./](\d{2})(?![-./\d])/g, (m, y, mo) => `${y.slice(2)}.${mo}`);
      // 역할은 이름 앞에 한 글자 태그만: 책(책임) · 참(참여) · 보(보조). 원래 역할명은 툴팁
      // 역할: ERP 역할명에 "책임"이 있거나, 과제책임자 이름이 본인(참여인력 행의 이름 또는 설정·자동 감지 이름)과 같으면 책임
      const myNames = (d.myNames || []).map((n) => String(n || '').trim()).filter(Boolean);
      const isLead = (x) => /책임/.test(String(x.role || '')) || (!!x.rspr && (String(x.rspr).trim() === String(x.empNm || '').trim() || myNames.includes(String(x.rspr).trim())));
      const roleTag = (x) => {
        const full = String(x.role || '').trim(), lead = isLead(x);
        const kind = lead ? '책임' : (/보조/.test(full) ? '보조' : '참여');
        const tip = [kind, full && full !== kind ? full : '', lead && !/책임/.test(full) ? '과제책임자' : ''].filter(Boolean).join(' · ');
        return `<span class="krext-tag${lead ? '' : ' krext-tag-grey'}" title="${F.esc(tip)}">${kind[0]}</span>`;
      };
      // 참여 계획 (lib/part.js): 과제 행의 ＋ → 그 행 밑 입력 폼, 저장된 계획은 그 행 밑 "계획" 줄. 표 밖 과제 계획은 표 끝
      const pe = P && state.partEdit ? state.partEdit : null;
      const names = P ? Array.from(new Set((d.projects || []).map((p) => p.prjNm).filter(Boolean))) : [];
      const form = () => partForm(P, state, names);
      const plus = (x) => P ? `<button type="button" class="krext-plus-btn" data-act="part-open" data-prj="${F.esc(x.prjNo)}" data-nm="${F.esc(x.prjNm)}" data-end="${F.esc(x.endDt || '')}" title="예비 참여율(참여 계획) 추가 — 참여율과 기간을 적어 두면 이 줄 밑에 계획 줄로 보입니다">＋</button>` : '';
      const rows = pt.items.map((x) => {
        const t = [x.prjNo, x.prjNm, x.rspr ? `책임자 ${x.rspr}` : '', x.role, x.term ? `참여기간 ${x.term}` : '', (x.kinds || []).length ? `종류 ${x.kinds.join(', ')}` : '',
          x.excludedRate ? `계상률 체크제외 ${rateTxt(x.excludedRate)} (합계 제외)` : '',
          x.allowanceRate ? `연구수당 성격 행 ${rateTxt(x.allowanceRate)} (참여율 아님, 제외)` : '',
          x.overlapCount ? `같은 종류의 현재 계상률 행이 겹쳐 가장 최근 1개만 반영 (${F.money(x.overlapCount)}개 제외)` : '',
          x.futureRate ? `이후 기간 계상률 ${rateTxt(x.futureRate)}` : '', !x.hasInfo ? '계상률기준내역에 참여율 행 없음' : ''].filter(Boolean).join(' · ');
        let html = `<tr title="${F.esc(t)}">
          <td class="krext-part-nm"><div class="krext-part-nmw">${roleTag(x)}<a class="krext-part-link" href="${F.esc(projectLink(x.prjNo, '03'))}" target="_blank" rel="noopener" title="${F.esc(x.prjNm)} · R&amp;D ERP 과제정보 › 참여인력 탭 열기 (${F.esc(x.prjNo)})">${F.esc(x.prjNm || x.prjNo)}</a></div></td>
          <td class="krext-num">${x.hasInfo ? rateTxt(x.rate) : '<span class="krext-dim" title="계상률기준내역에 없음">-</span>'}${x.excludedRate ? ` <span class="krext-dim" title="계상률 체크제외 (합계 제외)">+${rateTxt(x.excludedRate)}</span>` : ''}</td>
          <td class="krext-part-term"><span class="krext-dim krext-mono">${F.esc(shortTerm(x.term))}</span>${plus(x)}</td></tr>`;
        if (P) {   // 이 과제의 계획 줄(수정 중이면 폼) + 새 계획 폼
          html += P.listOf(plans, x.prjNo).map((e) => (pe && pe.id === e.id) ? form() : partPlanRow(e, false, x.endDt)).join('');
          if (pe && !pe.id && !pe.free && pe.prjNo === x.prjNo) html += form();
        }
        return html;
      }).join('');
      let extra = '';
      if (P) {   // 표에 없는 과제의 계획(과제명 함께) + "다른 과제 참여 계획" ＋ (또는 그 폼)
        extra += P.others(plans, pt.items).map((e) => (pe && pe.id === e.id) ? form() : partPlanRow(e, true, '')).join('');
        extra += (pe && !pe.id && pe.free) ? form()
          : `<tr class="krext-part-add"><td colspan="3"><button type="button" class="krext-plus-btn" data-act="part-new" title="표에 없는 과제(ERP에 아직 없는 신규·예정 과제)의 참여 계획 추가 — 과제명 · 참여율 · 기간">＋</button> <span class="krext-dim">다른 과제 참여 계획</span></td></tr>`;
      }
      // 합계(ERP 계상률, 변경 전) 줄은 그대로 두고, 그 밑에 오늘부터 계획이 든 기간별 "계획 반영" 합계 줄 (lib/part.js periods: 계획·계상률 행·과제 종료일을 경계로 잘라 구간마다
      // 계획 과제는 계획 참여율, 나머지 과제는 그날 유효한 계상률 행, 종료된 과제는 0(툴팁에 "종료")). 기간 끝이 미정이면 "시작일 ~"
      const planFoot = (P ? P.periods(pt.items, plans) : []).map((s) => {
        const term = `${shortD8(s.st)} ~ ${s.end ? shortD8(s.end) : ''}`.trim();
        const tip = `${term} 계획 반영 합계 ${rateTxt(s.total)}${s.total > 100 ? ' (100% 초과)' : ''} = ${sumTxt(s)}`;
        return `<tr class="krext-part-planfoot" title="${F.esc(tip)}"><td>계획 반영 <span class="krext-dim krext-mono krext-part-per">${F.esc(term)}</span></td><td class="krext-num${overCls(s.total)}">${rateTxt(s.total)}</td><td class="${s.total > 100 ? 'krext-red' : 'krext-dim'}">${spare(s.total)}</td></tr>`;
      }).join('');
      body = `<table class="krext-cards krext-part-table"><thead><tr><th>과제</th><th class="krext-num">참여율</th><th>기간</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="krext-dim">본인이 참여인력(계상률기준)에 있는 과제가 없습니다.</td></tr>'}${extra}</tbody>
        <tfoot><tr><td>합계</td><td class="krext-num${overCls(total)}">${rateTxt(total)}</td><td class="krext-dim">${spare(total)}</td></tr>${planFoot}</tfoot></table>`;
    }
    const note = `계상률기준 · ${d.memberFilter === 'applied' ? '내 참여 과제' : '표시 과제'} ${F.money(pt.items.length)}건${pt.totalExcluded ? ` · 체크제외 ${rateTxt(pt.totalExcluded)}` : ''}${plans.length ? ` · 계획 ${F.money(plans.length)}건` : ''}${d.membershipFailed ? ` · 다시 조회 실패 ${F.money(d.membershipFailed)}건(이전 값)` : ''}`;
    return `<section class="krext-sec krext-part">${title(F.esc(note))}${head}${body}</section>`;
  }

  /* ---------- 급여·연구수당 (HR System 급여명세서 → HR 탭의 content/hr-pay.js 가 API(lib/hr-api.js)로 수집해 storage.local.hrPay 에 저장, 캐시 d.hrPay 로 전달) ----------
   * 기본연봉(월) = 가장 최근 달의 지급내역 항목, 연 기본연봉 = × 12
   * 올해 연구수당 = 올해 1월부터 각 달 지급내역의 연구수당지급 합계
   * 한도 = 연 기본연봉 × 직급 비율(P1 18% · P2 20% · P3 22% · P4 24%, 설정), 더 받을 수 있는 금액 = 한도 − 올해 지급 − 받기 예정(lib/pay.js) */
  const HR_HOME = 'https://eclass.krs.co.kr/eClassVer4/External/SSOMessage';   // HR System 열기 기본 주소 = eClass 의 SSO 중계 페이지 (hr.krs.co.kr 를 직접 열면 로그아웃 상태에서 403). 설정 hr.url 이 우선
  const normNm = (x) => String(x || '').replace(/\s+/g, '').toLowerCase();
  /* 지급내역 항목 { 소득명: 금액 } 에서 이름으로 찾기: 공백 무시 완전 일치 → 포함 */
  function payItem(items, name) {
    if (!items) return null;
    const want = normNm(name); if (!want) return null;
    for (const [k, v] of Object.entries(items)) if (normNm(k) === want) return F.num(v);
    for (const [k, v] of Object.entries(items)) if (normNm(k).includes(want)) return F.num(v);
    return null;
  }
  /* 달 표시: "2026년 5월 급여" → "5월", 급여가 아닌 행("2026년 설 귀성비")은 연도만 뗀 내용 */
  const monthLabel = (m) => {
    const t = String((m && m.title) || '');
    const mt = /(\d{1,2})\s*월\s*급여/.exec(t); if (mt) return `${Number(mt[1])}월`;
    const mm = /^\d{4}-(\d{2})-/.exec(String((m && m.date) || ''));
    if (/급여/.test(t) && mm) return `${Number(mm[1])}월`;   // "20251224 급여 지급" 처럼 제목에 달이 없는 급여 행은 지급일자의 달
    const short = t.replace(/^\d{4}\s*년\s*/, '').trim(); if (short) return short;
    return mm ? `${Number(mm[1])}월` : t;
  };
  /* 올해 요약. 수집된 달이 없으면 months 가 빈 배열 */
  function paySummary(d, cfg, state) {
    const hr = d && d.hrPay; if (!hr) return null;
    const year = String(new Date().getFullYear());
    const y = (hr.years || {})[year] || {};
    const months = Object.values(y.months || {}).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const baseNm = cfg.baseItem || '기본연봉', resNm = cfg.researchItem || '연구수당지급';
    const latest = months.find((m) => payItem(m.items, baseNm) != null) || null;
    const base = latest ? payItem(latest.items, baseNm) : null;
    const paidMonths = months.filter((m) => { const v = payItem(m.items, resNm); return v != null && v !== 0; });
    const research = paidMonths.reduce((s, m) => s + payItem(m.items, resNm), 0);
    const list = y.list || null;
    const missing = list ? (list.rows || []).filter((r) => !(y.months || {})[r.key]) : [];
    // 올해 기준 수집 기간: 수집된 달의 지급일자 처음~끝. 급여 달(내용에 "급여")은 목록에 있는데 아직 못 읽은 달을 미수집으로,
    // 목록이 없으면 1월부터 지난달까지 중 빠진 달을 미수집으로 (이달 급여는 아직 지급 전일 수 있어 제외)
    const monthNo = (x) => { const m = /^\d{4}-(\d{2})-/.exec(String((x && x.date) || '')); return m ? Number(m[1]) : null; };
    const fmtD = (x) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String((x && x.date) || '')); return m ? `${Number(m[1])}월 ${Number(m[2])}일` : ''; };
    const isPay = (t) => /급여/.test(String(t || ''));
    const payMonths = months.filter((m) => isPay(m.title));
    const first = months[months.length - 1], last = months[0];   // months 는 지급일자 내림차순
    const period = months.length ? `${year}년 ${first.date === last.date ? fmtD(first) : `${fmtD(first)} ~ ${fmtD(last)}`} 지급분` : '';
    const payRows = list ? (list.rows || []).filter((r) => isPay(r.title)) : [];
    let missingNos;
    if (payRows.length) missingNos = payRows.filter((r) => !(y.months || {})[r.key]).map(monthNo).filter(Boolean);
    else { const have = new Set(payMonths.map(monthNo)); const lastNo = Math.max(new Date().getMonth(), ...have, 0); missingNos = []; for (let i = 1; i <= lastNo; i++) if (!have.has(i)) missingNos.push(i); }
    missingNos = Array.from(new Set(missingNos)).sort((a, b) => a - b);
    const grade = String(cfg.grade || hr.grade || '').toUpperCase();
    const rates = cfg.gradeRates || {};
    const rate = grade && rates[grade] != null && rates[grade] !== '' ? F.num(rates[grade]) : null;
    const annual = base != null ? base * 12 : null;
    const cap = annual != null && rate ? Math.round(annual * rate / 100) : null;
    const plans = (state && Array.isArray(state.payPlans)) ? state.payPlans : [];
    const planned = plans.reduce((s, e) => s + (F.num(e.amt) || 0), 0);
    const remain = cap != null ? cap - research : null;
    const remainAfter = remain != null ? remain - planned : null;
    return { year, hr, months, latest, base, annual, research, paidMonths, resNm, baseNm, list, missing, payMonths, period, missingNos,
      grade, gradeSource: cfg.grade ? '설정' : (hr.grade ? 'HR 직원 정보에서 자동 감지' : ''), rate, rates, cap, plans, planned, remain, remainAfter };
  }
  /* 마지막 수집 상태 (hrPay.status): 로그인이 풀렸거나 오류면 빨간 글씨 한 줄 */
  function hrStatusNote(hr, link) {
    const st = hr && hr.status; if (!st || st.ok) return '';
    if (st.loginRequired) {
      const a = `<a href="${F.esc(link)}" target="_blank" rel="noopener">HR System</a>`;
      const how = st.eclassLogin ? `eClass 로그인이 풀려 자동 로그인(SSO)을 못 했습니다. eClass 에 다시 로그인한 뒤`
        : st.tabOpened ? `HR System 탭을 열었지만 자동 로그인이 되지 않았습니다. ${a} 링크로 로그인한 뒤`   // 남은 탭은 오류 페이지일 수 있어 그 탭 대신 링크(eClass SSO)로 안내
        : `${a}에 로그인한 뒤`;
      return `<div class="krext-sub krext-err">HR System 로그인이 풀려 급여 정보를 읽지 못했습니다 — ${how} ↻ 를 누르세요${hr.ts ? ` (${F.esc(F.fmtClock(hr.ts))} 수집분 표시 중)` : ''}</div>`;
    }
    if (st.error) return `<div class="krext-sub krext-err">HR 급여 수집 오류: ${F.esc(st.error)}</div>`;
    return '';
  }
  /* 받기 예정 연구수당 (lib/pay.js, 이 브라우저에만 저장): 목록 + ＋ 입력 폼. 실제 지급되어 HR 에 잡히면 × 로 지운다 */
  function plannedBlock(ps, state) {
    if (!g.KRX_PAY || !state) return '';
    const pe = state.payEdit, dr = state.payDraft || { name: '', amt: '' };
    const form = () => `<div class="krext-pay-row krext-pay-form"><span class="krext-plan-ind">↳</span>
      <input type="text" data-pay="name" placeholder="메모 (과제·사유)" value="${F.esc(dr.name)}" maxlength="60" autocomplete="off" title="메모 (어느 과제·무슨 사유로 받을 예정인지)">
      <input type="text" inputmode="numeric" data-pay="amt" placeholder="금액" value="${F.esc(dr.amt)}" title="받기 예정 금액 (원)">
      <button type="button" class="krext-plan-btn krext-plan-save" data-act="pay-save">${pe && pe.id ? '저장' : '추가'}</button>
      <button type="button" class="krext-plan-btn" data-act="pay-cancel" title="취소 (Esc)">취소</button>
      ${state.payError ? `<span class="krext-err krext-plan-err">${F.esc(state.payError)}</span>` : ''}</div>`;
    const rows = ps.plans.map((e) => (pe && pe.id === e.id) ? form()
      : `<div class="krext-pay-row" title="${F.esc(`받기 예정 ${F.money(e.amt)}원${e.name ? ' · ' + e.name : ''} · ${F.fmtClock(e.ts)} 입력 · 실제 지급되어 급여명세서에 잡히면 × 로 지우세요`)}">
          <span class="krext-plan-ind">↳</span><span class="krext-pay-nm">${F.esc(e.name || '받기 예정')}</span><span class="krext-pay-amt">${F.money(e.amt)}</span>
          <span class="krext-plan-acts"><button type="button" data-act="pay-edit" data-id="${F.esc(e.id)}" title="수정">✎</button><button type="button" data-act="pay-del" data-id="${F.esc(e.id)}" title="삭제 (실제 지급되어 HR 급여명세서에 반영되면 지우세요)">×</button></span></div>`).join('');
    const head = `<div class="krext-pay-head"><span>받기 예정 연구수당 <span class="krext-dim">${ps.plans.length ? `${F.money(ps.plans.length)}건 · ${F.money(ps.planned)}원` : '없음'}</span></span>
      <button type="button" class="krext-plus-btn" data-act="pay-open" title="받기 예정 금액 추가 — 아직 급여에 반영되지 않았지만 받을 예정인 연구수당. 더 받을 수 있는 금액에서 빼서 보여주며, 실제 지급되면 × 로 지우세요">＋</button></div>`;
    return `<div class="krext-pay-plans">${head}${rows}${pe && !pe.id ? form() : ''}</div>`;
  }
  function paySection(d, s, state) {
    const cfg = s.hr || {};
    if (cfg.enabled === false) return '';
    const link = cfg.url || HR_HOME;
    // 급여 정보라 기본은 숨기고 버튼 하나만 둔다. 누르면 펼침 (state.payOpen — 저장하지 않으므로 화면을 새로 열면 다시 숨김)
    if (!(state && state.payOpen)) {
      return `<section class="krext-sec krext-pay"><button type="button" class="krext-pay-toggle" data-act="pay-toggle" title="HR 급여명세서 기준 연구수당 더 받을 수 있는 금액과 받기 예정 금액 보기">잔여연구수당 확인 ▸</button></section>`;
    }
    const ps = paySummary(d, cfg, state);
    const loading = !!state.payLoading;
    // 구역을 열 때 HR 을 읽어 오므로(lib/pay.js) 제목 옆에 읽는 중 표시, ↻ 는 모든 달 다시 읽기
    const btns = `<button type="button" class="krext-pay-toggle" data-act="pay-refresh" title="HR 급여명세서를 지금 다시 읽기 (모든 달)"${loading ? ' disabled' : ''}>↻</button><button type="button" class="krext-pay-toggle" data-act="pay-toggle" title="급여·연구수당 숨기기">숨기기</button>`;
    const title = (note) => `<div class="krext-sec-title">급여·연구수당 <span class="krext-note">${loading ? 'HR 급여명세서 읽는 중…' : note}</span>${btns}</div>`;
    if (!ps || !ps.months.length) {
      const hr = d.hrPay || {}, scan = hr.scan;
      const scanNote = scan && scan.note ? `<div class="krext-sub krext-err">${F.esc(scan.note)}</div>` : '';
      const msg = loading ? 'HR System 급여명세서를 읽는 중…'
        : `아직 수집된 급여 정보가 없습니다. 잔여연구수당 확인을 누르면 <a href="${F.esc(link)}" target="_blank" rel="noopener">HR System</a> 급여명세서에서 기본연봉·올해 ${F.esc(cfg.researchItem || '연구수당지급')} 합계와 직급을 읽어 옵니다 (HR 에 로그인되어 있어야 함).`;
      return `<section class="krext-sec krext-pay">${title('HR System')}<div class="krext-msg krext-dim">${msg}</div>${loading ? '' : hrStatusNote(hr, link)}${scanNote}</section>`;
    }
    // 화면에는 "더 받을 수 있는 금액"과 "받기 예정 연구수당"만. 계산 근거(월 기본연봉 × 12 × 직급 비율 − 올해 지급 − 받기 예정)는 금액 칸의 툴팁에
    const paidTip = ps.paidMonths.length ? ps.paidMonths.slice().reverse().map((m) => `${monthLabel(m)} ${F.money(payItem(m.items, ps.resNm))}`).join(' · ') : '올해 지급 없음';
    let body = '';
    if (ps.cap != null) {
      const tip = [`한도 ${F.money(ps.cap)} = 월 기본연봉 ${F.money(ps.base)} × 12 × ${ps.rate}% (직급 ${ps.grade}, ${ps.gradeSource})`,
        `− 올해 ${ps.resNm} ${F.money(ps.research)} (${paidTip})`,
        ps.planned ? `− 받기 예정 ${F.money(ps.planned)}` : '',
        ps.remainAfter < 0 ? '· 한도 초과' : ''].filter(Boolean).join(' ');
      body += stat('더 받을 수 있는 금액', ps.remainAfter, ps.remainAfter < 0 ? 'krext-red' : 'krext-blue', link, tip, true);
    } else {
      body += `<div class="krext-sub krext-dim">직급을 알 수 없어 더 받을 수 있는 금액(월 기본연봉 × 12 × 직급 비율 − 올해 지급)을 계산하지 못했습니다. HR System 탭을 열면 직원 정보에서 자동으로 읽어 오고, <a href="#" data-act="settings">설정</a>의 급여·연구수당에서 직접 고를 수도 있습니다.</div>`;
    }
    body += plannedBlock(ps, state);
    // 올해 급여 달 중 아직 읽지 못한 달이 있으면 합계가 덜 잡힌 것이라 빨간 글씨로만 알림
    if (ps.missingNos.length) body += `<div class="krext-sub krext-err">${F.esc(`${ps.year}년 ${ps.missingNos.map((n) => n + '월').join('·')} 급여 미수집 — ↻ 를 누르면 다시 읽습니다`)}</div>`;
    const scan = ps.hr.scan;
    if (scan && scan.note) body += `<div class="krext-sub krext-err">${F.esc(scan.note)}</div>`;
    if (!loading) body += hrStatusNote(ps.hr, link);
    // 제목 옆에는 수집된 기간만 (올해 지급일자 처음~끝, 급여 달 수)
    const note = `${ps.period} · 급여 ${F.money(ps.payMonths.length)}개월`;
    return `<section class="krext-sec krext-pay">${title(F.esc(note))}<div class="krext-stats">${body}</div></section>`;
  }

  /* ---------- 청구 준비 (lib/prep.js): 거래 행 밑 "↳ …" 둘째 줄(prepRow)의 "청구종류 · 청구내역(적요) · 첨부 · 청구서 작성" 조작 요소 ----------
   * 거래(지출) 정보 행과 한 줄에 섞지 않고 항상 그 밑 둘째 줄에 둔다 (eClass 삽입 패널·팝업·떠 있는 패널 공통).
   * 기본은 숨김: 과제(카드) 줄 끝의 청구 아이콘(prepToggle, data-act prep-toggle → lib/prep.js 가 state.prepOpen 을 토글)을 눌러야 그 묶음의 거래 행에 나타난다.
   * 청구종류 = 청구서 세목 빠른 선택 항목(설정 quickPicks 표시이름). 청구내역 = 청구서 폼의 청구내역(적요, #REQ_PTCL — 화면이 필수로 요구) 글. 파일은 거래 행이나 이 줄에 끌어다 놓는다(팝업에서는 불가).
   * "청구서 작성"은 백그라운드 탭에서 R&D ERP 청구서를 열어 세목·청구종류·청구내역·첨부를 넣고 "내역 추가"(결의서에 임시저장)까지, "작성+신청"은 이어서 결의서 "신청"(결재요청)까지 누른다 (background.js prepRun).
   * 상태는 entry.run (running / saved 임시저장됨·신청 필요 / applied 신청됨 / failed). 내역 추가된 거래는 미청구 목록에서 빠져 행이 사라지므로 구역 맨 아래 "신청 대기" 목록(pendingBlock)에 남겨 "신청" 버튼을 준다 */
  let prepCtx = { on: false, picks: [], mode: '' };   // render() 가 현재 설정으로 채움
  const prepMeta = (c, prjNo) => ({ appr: String(c.apprNo || ''), card4: F.digits(c.cardNo || c.tail).slice(-4), prjNo: prjNo || (c.projects && c.projects[0] && c.projects[0].prjNo) || '', shop: String(c.shop || ''), amount: c.amount, usedDate: String(c.usedDate || '') });
  const prepAttrs = (key, meta) => ` data-prep-key="${F.esc(key)}" data-prep-meta="${F.esc(JSON.stringify(meta))}"`;
  const fmtSize = (n) => g.KRX_PREP ? g.KRX_PREP.fmtSize(n) : String(n);
  const prepHas = (key, state) => !!(key && (state.prep || {})[key]);
  const prepShown = (state, gkey) => prepCtx.on && !!(state && state.prepOpen && state.prepOpen.has(gkey));   // 이 과제(prjNo)·카드('card:…') 묶음의 거래 행에 청구 준비 요소를 보이는가
  const prepToggle = (state, gkey) => prepCtx.on ? `<a href="#" class="krext-prj-link krext-prj-claim${prepShown(state, gkey) ? ' krext-on' : ''}" data-act="prep-toggle" data-key="${F.esc(gkey)}" title="${prepShown(state, gkey) ? '청구 준비 숨기기' : '청구 준비 보기 — 거래 행 밑에 청구종류 선택 · 청구내역(적요) 입력 · 첨부 파일 놓기 · 청구서 작성/작성+신청 버튼 줄을 보입니다'}">${ICON_CLAIM}</a>` : '';
  const PREP_TIP = '청구 준비: 여기서 고른 청구종류·적은 청구내역과 끌어다 놓은 파일은 이 브라우저에만 저장됩니다. 거래를 클릭해 청구서를 열면 폼에 적용되고, 청구서 작성을 누르면 백그라운드에서 내역 추가(결의서 임시저장)까지, 작성+신청을 누르면 결의서 신청(결재요청)까지 합니다';
  /* 백그라운드 작성·신청 상태(entry.run) 정규화: 이전 버전(0.6.9)의 'done' 은 'saved'(내역 추가됨), 6분 넘게 running 이면 실패로 간주(백그라운드가 꺼져 상태가 안 바뀐 경우) */
  function normRun(r) {
    if (!r) return null;
    if (r.state === 'done') r = Object.assign({}, r, { state: 'saved', saved: true });
    if (r.state === 'running' && Date.now() - (r.ts || 0) > 6 * 60000) r = Object.assign({}, r, { state: 'failed', msg: '제한 시간 안에 결과가 없습니다 — 탭에서 확인하세요' });
    return r;
  }
  const isClaimed = (r) => !!(r && (r.saved || r.state === 'saved' || r.state === 'applied'));   // 내역 추가(임시저장)가 이미 된 거래 — 미청구 목록에서 빠짐
  /* 상태 문구와 이어지는 버튼(신청 · 탭 보기). claimed 면 이미 내역 추가된 거래라 "청구서 작성" 대신 "신청"만 */
  function runStatus(key, r) {
    if (!r) return { html: '', claimed: false };
    const k = F.esc(key);
    const tabBtn = (t) => `<button type="button" class="krext-prep-btn" data-act="prep-tab" data-key="${k}" title="${t}">탭 보기</button>`;
    const applyBtn = `<button type="button" class="krext-prep-btn krext-prep-run" data-act="prep-run" data-mode="apply" data-key="${k}" title="R&D ERP 청구서(카드)를 백그라운드 탭으로 열어 이 과제의 작성중 결의서를 신청(결재요청)합니다 — 결의서에 든 청구내역 전체가 신청됩니다">신청</button>`;
    const delBtn = `<button type="button" class="krext-prep-btn krext-prep-del" data-act="prep-run" data-mode="delete" data-key="${k}" title="R&D ERP 결의서에서 이 청구내역(임시저장)을 삭제합니다 — 결의서에 이 건만 있으면 결의서 자체가 삭제됩니다. 삭제되면 거래가 미청구 목록으로 돌아오고 청구 준비(청구종류·청구내역·파일)는 남습니다. 결의서가 이미 신청·승인된 상태면 삭제하지 않고 신청됨으로 표시합니다(삭제하려면 R&D ERP 에서 신청 취소 후)${r.reqNo ? '' : '. 청구번호가 기록되지 않은 항목은 행을 찾지 못해 탭에서 직접 삭제해야 합니다'}">임시저장 삭제</button>`;
    const when = F.esc(F.fmtClock(r.ts));
    const msg = F.esc(r.msg || '');
    const claimed = isClaimed(r);
    let html = '';
    if (r.state === 'running') html = `<span class="krext-prep-state krext-prep-running" title="백그라운드 탭에서 진행 중 (${when} 시작)">${r.stage === 'apply' ? '신청 중…' : r.stage === 'delete' ? '임시저장 삭제 중…' : '작성 중…'}</span>${tabBtn('진행 중인 R&D ERP 탭 보기')}`;
    else if (r.state === 'saved') html = `<span class="krext-prep-state krext-prep-saved" title="${msg}${msg ? ' — ' : ''}청구내역은 결의서에 임시저장(작성중) 상태로만 들어갔습니다. 신청(결재요청)까지 해야 결재로 넘어갑니다">임시저장됨 ${when} · <b>신청 필요</b></span>${applyBtn}${delBtn}`;
    else if (r.state === 'applied') html = `<a class="krext-prep-state krext-prep-applied" href="${myApplyBoxLink()}" target="_blank" rel="noopener" title="${msg}${msg ? ' · ' : ''}클릭: ${MY_APPLY_TITLE}">신청됨 ${when}${/이미 신청된 결의서|R&D ERP 에서 신청됨/.test(r.msg || '') ? ' <span class="krext-dim">· R&amp;D ERP 에서 이미 신청된 결의서</span>' : ''}</a>`;   // 클릭하면 MY신청함(내가 올린 신청 목록). 신청만·삭제 실행이나 새로고침 동기화가 ERP 에서 이미 신청된 것을 확인한 경우는 그 사실을 덧붙임
    else if (r.state === 'failed') html = claimed
      ? `<span class="krext-prep-state krext-err" title="${msg}">임시저장됨 · ${/삭제/.test(msg) ? '' : '신청 '}실패: ${msg}</span>${applyBtn}${delBtn}${tabBtn('남겨 둔 R&D ERP 탭에서 이어서 하기')}`
      : `<span class="krext-prep-state krext-err" title="${msg}">작성 실패: ${msg}</span>${tabBtn('남겨 둔 R&D ERP 탭에서 이어서 하기')}`;
    return { html, claimed };
  }
  /* 조작 요소 묶음: [청구종류 ▾] [청구내역(적요) 입력란] [파일 칩 …] [끌어다 놓기] 상태 [청구서 작성] [작성+신청] 지움 (이미 내역 추가된 거래면 [신청]).
   * 청구내역 입력란은 적는 중(state.prepDraft — lib/prep.js 가 input 마다 보관)이면 그 글을, 아니면 저장된 글(entry.ptcl)을 보인다 (다른 이유로 다시 그려져도 적던 글이 남게) */
  function prepControls(key, meta, state) {
    const e = (state.prep || {})[key] || null;
    const type = e ? String(e.type || '') : '';
    const draft = state.prepDraft && state.prepDraft.key === key ? state.prepDraft : null;
    const ptcl = draft ? String(draft.value || '') : (e ? String(e.ptcl || '') : '');
    const files = e ? (e.files || []) : [];
    const known = prepCtx.picks.some((p) => p.label === type);
    const opts = [`<option value="">청구종류 선택</option>`]
      .concat(prepCtx.picks.map((p) => `<option value="${F.esc(p.label)}"${p.label === type ? ' selected' : ''}>${F.esc(p.label)}</option>`))
      .concat(type && !known ? [`<option value="${F.esc(type)}" selected>${F.esc(type)}</option>`] : []).join('');
    const chips = files.map((f) => `<span class="krext-prep-chip" title="${F.esc(`${f.name} · ${fmtSize(f.size)} · ${F.fmtClock(f.ts)} 저장`)}">${ICON_CLIP}<span class="krext-prep-chip-nm">${F.esc(f.name)}</span><span class="krext-dim">${fmtSize(f.size)}</span><button type="button" data-act="prep-file-del" data-key="${F.esc(key)}" data-id="${F.esc(f.id)}" title="이 파일 빼기">×</button></span>`).join('');
    const drop = prepCtx.mode === 'popup'
      ? `<span class="krext-prep-drop krext-prep-drop-off" title="툴바 팝업에는 파일을 끌어다 놓을 수 없습니다. eClass 홈 패널의 이 줄에 놓으세요">${ICON_CLIP}파일은 eClass 패널에서</span>`
      : `<span class="krext-prep-drop" data-act="prep-pick" data-key="${F.esc(key)}" role="button" title="클릭하면 파일 선택 창이 열립니다. 이 줄이나 거래 행에 끌어다 놓아도 됩니다. 첨부할 파일(영수증·증빙)은 이 브라우저에 저장해 두었다가 청구서에 첨부합니다">${ICON_CLIP}${files.length ? '파일 더 추가' : '첨부 파일 선택 또는 끌어다 놓기'}</span>`;
    const busy = state.prepBusy && state.prepBusy.key === key ? `<span class="krext-prep-state">저장 중 ${state.prepBusy.done}/${state.prepBusy.total}…</span>` : '';
    const note = state.prepNote && state.prepNote.key === key ? `<span class="krext-prep-state${state.prepNote.err ? ' krext-err' : ''}">${F.esc(state.prepNote.msg)}</span>` : '';
    const r = normRun(e && e.run);
    const rs = runStatus(key, r);   // 상태 문구 + 신청/탭 보기 버튼
    const canRun = !!(e && type) && !(r && r.state === 'running') && !(state.prepBusy && state.prepBusy.key === key);
    const dis = canRun ? '' : ' disabled';
    const runBtns = e && !rs.claimed ? `<button type="button" class="krext-prep-btn krext-prep-run" data-act="prep-run" data-mode="add" data-key="${F.esc(key)}"${dis} title="${type ? 'R&D ERP 청구서(카드)를 백그라운드 탭으로 열어 이 거래를 고르고 세목·청구종류·청구내역·첨부를 넣은 뒤 “내역 추가”까지 누릅니다 — 결의서에 임시저장만 되고 신청은 하지 않으므로, 끝나면 신청 대기 목록의 “신청” 버튼으로 이어서 하세요. 실패하면 그 탭을 남겨 둡니다' : '청구종류를 먼저 고르세요'}">${r && r.state === 'failed' ? '다시 작성' : '청구서 작성'}</button><button type="button" class="krext-prep-btn krext-prep-run" data-act="prep-run" data-mode="add,apply" data-key="${F.esc(key)}"${dis} title="${type ? '“청구서 작성”(내역 추가)에 이어 결의서 “신청”(결재요청)까지 백그라운드 탭에서 누릅니다. 결재선은 화면의 기본결재선 팝업이 기본으로 고르는 항목(부서·본인·과제담당자 그룹·과제책임자)이며, 결의서에 이미 들어 있던 청구내역도 함께 신청됩니다' : '청구종류를 먼저 고르세요'}">작성+신청</button>` : '';
    const attached = e && e.attached && !(r && r.state) ? `<span class="krext-prep-state" title="R&D ERP 청구서의 첨부 목록에 올린 시각">첨부함 ${F.esc(F.fmtClock(e.attached.ts))}</span>` : '';
    const clear = e ? `<button type="button" class="krext-prep-x" data-act="prep-clear" data-key="${F.esc(key)}" title="이 거래의 청구 준비(청구종류·청구내역·파일·작성 상태) 지우기">지움</button>` : '';
    const ptclBox = `<input type="text" class="krext-prep-ptcl${ptcl ? ' krext-on' : ''}" data-prep-ptcl="${F.esc(key)}" value="${F.esc(ptcl)}" maxlength="500" placeholder="청구내역(적요)" spellcheck="false" autocomplete="off" title="청구내역(적요) — R&D ERP 청구서 폼의 청구내역 칸에 이 글을 넣습니다 (화면이 필수로 요구하는 값. 칸을 벗어나거나 Enter 면 저장, Esc 는 되돌림). 비워 두면 화면의 기본값(카드 메모)을 그대로 둡니다">`;
    return `<select class="krext-prep-type${type ? ' krext-on' : ''}" data-prep-type="${F.esc(key)}" title="청구종류 — R&D ERP 청구서의 세목 빠른 선택 항목 (설정의 청구서 입력 도우미에서 변경)">${opts}</select>${ptclBox}
      <span class="krext-prep-files">${chips}${drop}</span>${busy}${note}${attached}${rs.html}${runBtns}${clear}`;
  }
  /* 신청 대기 목록(카드미청구 구역 맨 아래): 내역 추가(임시저장)가 끝난 거래는 미청구 목록에서 빠져 행이 사라지므로, 신청이 끝나기 전까지(신청됨은 하루 동안) 여기 남겨 상태와 "신청"·"임시저장 삭제" 버튼을 준다.
   * "감추기"는 패널 항목만 지우고(ERP 임시저장은 그대로), "임시저장 삭제"는 ERP 결의서의 그 청구내역을 지워 거래를 미청구 목록으로 되돌린다. 지금 목록에 있는 거래(행에 상태가 보이는 것)는 뺀다. n 은 아직 신청되지 않은 건수 */
  function pendingBlock(d, state) {
    if (!prepCtx.on || !state.prep || !d) return { html: '', n: 0 };
    const cur = new Set();
    for (const p of d.projects || []) for (const c of p.cards || []) cur.add(F.prepKey(c.apprNo, c.cardNo || c.tail));
    for (const card of (d.cards || []).concat(d.unattributed || [])) for (const t of card.txs || []) cur.add(F.prepKey(t.apprNo, t.cardNo || t.tail));
    const list = Object.values(state.prep).map((e) => e ? { e, r: normRun(e.run) } : null).filter((x) => x && x.r && isClaimed(x.r) && !cur.has(x.e.key)).sort((a, b) => (b.r.ts || 0) - (a.r.ts || 0));
    if (!list.length) return { html: '', n: 0 };
    const prjs = new Map((d.projects || []).map((p) => [p.prjNo, p]));
    const rows = list.map(({ e, r }) => {
      const p = prjs.get(e.prjNo);
      const prj = p ? `${p.rspr || ''} ${p.prjNm || ''}`.trim() : (e.prjNo || '-');
      const shop = String(e.shop || '');
      const note = state.prepNote && state.prepNote.key === e.key ? `<span class="krext-prep-state${state.prepNote.err ? ' krext-err' : ''}">${F.esc(state.prepNote.msg)}</span>` : '';
      return `<div class="krext-pend-row">
        <span class="krext-pend-prj" title="${F.esc(e.prjNo || '')}">${F.esc(prj)}</span>
        <span class="krext-pend-shop" title="${F.esc(shop)}">${F.esc(shop)}</span>
        <span class="krext-dim">${F.esc(F.fmtDate(e.usedDate))}</span>
        <span class="krext-pend-amt">${F.money(e.amount)}</span>
        ${e.type ? `<span class="krext-dim">${F.esc(e.type)}</span>` : ''}${r.reqNo ? `<span class="krext-dim krext-mono" title="청구번호">${F.esc(r.reqNo)}</span>` : ''}
        ${note}${runStatus(e.key, r).html}<button type="button" class="krext-prep-x" data-act="prep-clear" data-key="${F.esc(e.key)}" title="이 목록에서만 감춥니다 — R&D ERP 의 임시저장(결의서)은 그대로 남습니다. 임시저장을 지우려면 “임시저장 삭제”">감추기</button></div>`;
    }).join('');
    const need = list.filter(({ r }) => r.state !== 'applied').length;   // 임시저장만 되어 아직 신청하지 않은 건
    const done = list.length - need;                                       // 신청되어 결재 진행 중인 건 (하루 동안 남음)
    /* 머리글: "신청 필요 N건"(임시저장만 된 건 → 미신청내역조회)과 "신청됨 M건"(→ MY신청함)을 따로 센다 — "신청 대기" 한 숫자로는 아직 신청 안 한 건인지 신청하고 결재를 기다리는 건인지 헷갈린다는 지적(2026-09-25) */
    const head = `<a href="${notAppliedLink()}" target="_blank" rel="noopener" title="내역 추가(임시저장)만 된 청구는 결의서를 신청해야 결재로 넘어갑니다. 신청은 결의서에 든 청구내역 전체를 보냅니다 · 클릭: ${NOT_APPLIED_TITLE}">청구서 작성됨 · 신청 필요 <span class="krext-badge${need ? ' krext-badge-soft' : ''}">${F.money(need)}건</span></a>`
      + (done ? `<span class="krext-dim">·</span><a href="${myApplyBoxLink()}" target="_blank" rel="noopener" title="신청(결재요청)되어 결재 진행 중인 건 — 하루 동안 이 목록에 남습니다 · 클릭: ${MY_APPLY_TITLE}">신청됨 <span class="krext-badge">${F.money(done)}건</span></a>` : '');
    return { n: need, html: `<div class="krext-pend"><div class="krext-pend-head">${head}</div>${rows}</div>` };
  }
  /* 거래 행 밑 "↳ …" 둘째 줄 (모든 배치 공통) */
  function prepRow(key, meta, state, colspan) {
    return `<tr class="krext-prep${prepHas(key, state) ? ' krext-prep-set' : ''}"${prepAttrs(key, meta)}><td colspan="${colspan}"><div class="krext-prep-in">
      <span class="krext-plan-ind" title="${PREP_TIP}">↳</span>${prepControls(key, meta, state)}</div></td></tr>`;
  }

  /* 거래 한 줄. withPrj=true 면 연결 과제(책임자) 열 추가 (카드별 보기). 행 클릭 → 청구서(카드).
   * showPrep(묶음의 청구 아이콘이 켜짐)이고 취소/취소된 거래가 아니면 그 밑에 청구 준비 ↳ 줄(prepRow)을 붙인다. 가맹점 이름은 넘치면 … (전체는 툴팁) */
  function txRow(c, withPrj, prjNo, state, showPrep) {
    const target = prjNo || (c.projects && c.projects[0] && c.projects[0].prjNo) || '';
    const href = target ? claimLink(target, c.apprNo, c.cardNo) : '';
    const pkey = showPrep && prepCtx.on && state && !c.cancel && !c.cancelled ? F.prepKey(c.apprNo, c.cardNo || c.tail) : '';
    const pmeta = pkey ? prepMeta(c, target) : null;
    const nm = cardName(c.cardNo || c.tail);   // 별명이 있으면 뒤 8자리 대신 표시 (뒷자리는 툴팁)
    const neg = c.amount < 0;
    const shared = c.shared ? ` <span class="krext-tag" title="같은 계좌를 쓰는 여러 과제에 귀속된 거래: ${F.esc((c.linked || []).join(', '))}">공용</span>` : '';
    const linked = (c.projects || []).map((x) => x.rspr || x.prjNo);
    let flag = '';
    if (c.cancel) flag = ` <span class="krext-tag krext-tag-grey" title="승인취소(마이너스) 건">취소</span>`;
    else if (c.cancelled) flag = ` <span class="krext-tag krext-tag-grey" title="같은 일시·금액의 취소 건이 있어 상쇄된 거래">취소됨</span>`;
    else if (c.dupSuspect) flag = ` <span class="krext-tag krext-tag-warn" title="같은 카드·가맹점·금액이 10분 안에 반복됨. 승인번호가 다르면 별개 승인(예: 인원별 결제)이거나 이중 승인일 수 있으니 카드매출전표로 확인">중복의심</span>`;
    const cls = [neg ? 'krext-neg' : '', c.cancelled ? 'krext-cancelled' : '', href ? 'krext-clickable' : '', pkey && (state.prep || {})[pkey] ? 'krext-prep-has' : ''].filter(Boolean).join(' ');
    const row = `<tr class="${cls}"${href ? ` data-act="claim" data-href="${F.esc(href)}" title="클릭: R&amp;D ERP 청구서(카드)에서 이 건 열기${pkey ? ' (파일을 이 행에 끌어다 놓으면 청구 준비에 저장)' : ''}"` : ''}${pkey ? prepAttrs(pkey, pmeta) : ''}>
      <td class="krext-card${nm ? '' : ' krext-mono'}" title="${nm ? F.esc(c.tail) + ' · ' : ''}${F.esc(c.cardDiv)} ${F.esc(c.user)}">${F.esc(nm || c.tail)}${withPrj ? '' : shared}</td>
      <td class="krext-mono">${F.esc(F.fmtDate(c.usedDate))} ${F.esc(F.fmtTime(c.usedTime))}</td>
      <td class="krext-shop" title="${F.esc(c.shop)}"><span class="krext-shop-nm">${F.esc(c.shop)}</span>${flag}</td>
      <td class="krext-mono krext-dim">${F.esc(c.apprNo)}</td>
      <td class="krext-num" title="${neg ? '승인취소(마이너스) 건' : ''}">${F.money(c.amount)}</td>
      ${withPrj ? `<td class="krext-linked" title="${F.esc(linked.join(', '))}">${F.esc(linked.join(', '))}${linked.length > 1 ? ' <span class="krext-tag">공용</span>' : ''}</td>` : ''}</tr>`;
    return row + (pkey ? prepRow(pkey, pmeta, state, withPrj ? 6 : 5) : '');
  }
  /* 과제(또는 카드 묶음)의 거래 중 청구 준비가 있는 수 */
  const prepCount = (txs, state) => prepCtx.on && state && state.prep ? (txs || []).filter((c) => !c.cancel && !c.cancelled && state.prep[F.prepKey(c.apprNo, c.cardNo || c.tail)]).length : 0;
  const prepTag = (n) => n ? ` <span class="krext-prj-prep" title="청구 준비(청구종류·첨부 파일)가 있는 거래 ${F.money(n)}건">준비 ${F.money(n)}</span>` : '';

  /* 카드 한 장 행 (카드별 보기 / 과제별 보기의 공용 카드 묶음 공용) */
  function cardRow(card, state) {
    const key = 'card:' + card.digits;
    const open = state.expanded.has(key);
    const nm = cardName(card.digits || card.tail);   // 별명이 있으면 별명을 앞에, 뒤 8자리는 옆에
    const prjs = card.projects.map((x) => `${x.rspr || ''}${x.prjNm ? '(' + x.prjNm.slice(0, 12) + (x.prjNm.length > 12 ? '…' : '') + ')' : ''}`).join(', ');
    const show = prepShown(state, key);   // 카드 줄 끝 청구 아이콘이 켜졌을 때만 청구 준비 요소
    const body = open ? `<div class="krext-prj-body"><table class="krext-cards"><thead><tr><th>카드</th><th>사용일시</th><th>가맹점</th><th>승인번호</th><th class="krext-num">사용액</th><th>연결 과제</th></tr></thead><tbody>${card.txs.map((t) => txRow(t, true, '', state, show)).join('')}</tbody></table></div>` : '';
    return `<div class="krext-prj${open ? ' krext-open' : ''}"><div class="krext-prj-line">
      <a href="#" class="krext-prj-row" data-act="prj" data-prj="${F.esc(key)}" title="${F.esc(card.cardDiv)} · 연결 과제: ${F.esc(card.projects.map((x) => `${x.rspr || ''} ${x.prjNm || x.prjNo}`).join(' / '))}">
        <span class="krext-caret">${open ? '▾' : '▸'}</span>
        <span class="krext-prj-rspr${nm ? ' krext-card-nm' : ' krext-mono'}">${F.esc(nm || card.tail)}</span>
        <span class="krext-prj-nm">${nm ? `<span class="krext-mono">${F.esc(card.tail)}</span> · ` : ''}${F.esc(card.user)}${card.user ? ' · ' : ''}<span class="krext-dim">연결 과제: ${F.esc(prjs)}${card.projects.length > 1 ? ' <span class="krext-tag">공용</span>' : ''}</span></span>
        <span class="krext-prj-cnt krext-hot">${F.money(card.count)}건${prepTag(prepCount(card.txs, state))}</span>
        <span class="krext-prj-amt">${F.money(card.amount)}</span>
      </a>${prepToggle(state, key)}</div>${body}</div>`;
  }

  function cardView(d, state) {
    if (!d.cards || !d.cards.length) return `<div class="krext-msg krext-dim">미청구 카드 거래가 없습니다.</div>${sharedBlock(d, state)}`;
    return `<div class="krext-prj-list">${listHead('카드 · 사용자 · 연결 과제', '미청구 · 금액 (원)', prepCtx.on ? 1 : 0)}${d.cards.map((card) => cardRow(card, state)).join('')}</div>${sharedBlock(d, state)}`;
  }

  /* 어느 과제에도 귀속되지 않은(계좌 불일치) 카드의 거래 묶음. 설정에서 표시를 켠 경우에만 */
  function sharedBlock(d, state) {
    const s = d.settings || {};
    if (!s.showShared) return '';   // 표시 꺼짐: 안내 문구 없이 생략 (미귀속 건수는 설정 페이지에서 확인)
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
    if (d.memberFilter === 'no-id') return `본인 사번/이름을 아직 확인하지 못해 과제를 표시하지 않습니다. <a href="${F.esc(s.rndUrl || RND_MAIN)}" target="_blank" rel="noopener">R&amp;D ERP</a>를 한 번 열거나 설정에 학번/사번(또는 이름)을 입력한 뒤 새로고침하세요.`;
    if (d.memberFilter === 'ambiguous') {
      const cands = (d.nameCandidates || []).map((c) => `${F.esc(c.empNm)} (사번 ${F.esc(c.empNo || '?')}${c.roles && c.roles.length ? ', ' + F.esc(c.roles.join('/')) : ''}, 과제 ${F.money(c.projects.length)}건)`).join(' · ');
      return `이름 "${F.esc((d.myNames || []).join(', '))}"의 참여인력이 ${F.money((d.nameCandidates || []).length)}명이라 과제를 표시하지 않습니다. <a href="#" data-act="settings">설정</a>에서 본인 사번을 고르세요. — ${cands}`;
    }
    if (d.excludedCount >= d.projectCount) return '모든 과제가 설정에서 제외되어 있습니다.';
    if (d.memberFilter === 'applied' && d.notMemberCount + (d.endedCount || 0) >= d.projectCount - d.excludedCount) return '참여인력에 본인이 포함된 과제가 없습니다. 설정에서 사번을 확인하세요.';
    return hiddenZero ? '미청구 내역이 있는 과제가 없습니다 (설정: 0건 과제 숨김).' : '표시할 과제가 없습니다.';
  }

  function cardsSection(d, s, state) {
    const picked = (s.selectedCards || []).map((x) => F.cardTail(x, 8)).concat(s.cardFilterList || []);
    const filterOn = s.cardFilterMode === 'specific' && picked.length;
    const fnote = filterOn ? `모니터링 카드: ${F.esc(picked.join(', '))}` : '전체 카드';
    let exnote = d.excludedCount ? ` · 제외 과제 ${F.money(d.excludedCount)}` : '';
    if (d.memberFilter === 'applied') {   // 미참여(본인 행 없음) · 참여 종료(본인 행은 있으나 참여기간이 끝남) 제외 수
      const ex = [d.notMemberCount ? `미참여 ${F.money(d.notMemberCount)}` : '', d.endedCount ? `참여 종료 ${F.money(d.endedCount)}` : ''].filter(Boolean).join(' · ');
      exnote += ` · 내 참여 과제만${ex ? ` (${ex} 제외)` : ''}`;
    }
    else if (d.memberFilter === 'no-id') exnote += ' · 본인 확인 전';
    else if (d.memberFilter === 'ambiguous') exnote += ' · 동명이인 확인 필요';
    if (d.truncatedCount) exnote += ` · 최대 ${F.money((d.projects || []).length)}개만 표시 (${F.money(d.truncatedCount)}개 더 있음 — 설정의 조회 과제 최대 수)`;
    let dup = (d.sumCount != null && d.sumCount !== d.totalCount) ? ` · 과제 합산 ${F.money(d.sumCount)}건 (같은 계좌를 쓰는 과제 간 중복 포함)` : '';
    if (d.cancelPairs) dup += ` · 취소쌍 ${F.money(d.cancelPairs)}건 포함`;
    if (d.dupSuspects) dup += ` · 중복의심 ${F.money(d.dupSuspects)}쌍`;
    const prepN = prepCtx.on && state.prep ? Object.values(state.prep).filter((e) => e && !e.missingSince && !isClaimed(normRun(e.run))).length : 0;   // 청구 준비(청구종류·첨부) 항목 수 (내역 추가된 것·미청구 목록에서 사라진 것 제외)
    if (prepN) dup += ` · 청구 준비 ${F.money(prepN)}건`;
    const pend = pendingBlock(d, state);   // 내역 추가(임시저장)만 되어 신청이 남은 거래
    if (pend.n) dup += ` · 신청 필요 ${F.money(pend.n)}건`;
    const view = state.view === 'card' ? 'card' : 'project';
    const toggle = `<span class="krext-toggle"><a href="#" data-act="view" data-view="project" class="${view === 'project' ? 'krext-on' : ''}">과제별</a><a href="#" data-act="view" data-view="card" class="${view === 'card' ? 'krext-on' : ''}">카드별</a></span>`;
    const head = `<div class="krext-sec-title">${sectionSwitch(d, state)}
      <span class="krext-note">${F.money(d.totalAmount)}원 · ${fnote}${exnote}${dup}</span>${toggle}</div>`;
    if (view === 'card' && d.projects.length) return `<section class="krext-sec">${head}${cardView(d, state)}${pend.html}</section>`;
    // 0건 과제 숨김은 카드미청구 보기에서만 적용 (과제집행비율 보기는 전체 과제)
    const projects = s.hideZeroProjects ? d.projects.filter((p) => p.count > 0 || p.error) : d.projects;
    if (!projects.length) {
      return `<section class="krext-sec">${head}<div class="krext-msg krext-dim">${whyEmpty(d, s, d.projects.length > 0)}</div>${pend.html}</section>`;
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
            <span class="krext-prj-cnt${p.count ? ' krext-hot' : ''}">${F.money(p.count)}건${prepTag(prepCount(p.cards, state))}</span>
            <span class="krext-prj-amt">${F.money(p.amount)}</span>
          </a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '01'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 열기 (${F.esc(p.prjNo)})">${ICON_EXT}</a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '05'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 › 카드 탭 열기">${ICON_CARD}</a>${prepToggle(state, p.prjNo)}
        </div>
        ${open ? `<div class="krext-prj-body">${cardsTable(p, state)}</div>` : ''}
      </div>`;
    }).join('');
    return `<section class="krext-sec">${head}<div class="krext-prj-list">${listHead('책임자 · 과제', '미청구 · 금액 (원)', prepCtx.on ? 3 : 2)}${list}</div>${sharedBlock(d, state)}${pend.html}</section>`;
  }

  /* ---------- 과제집행비율 보기 (과제정보 › 자금현황 › 비목별 잔액 + 이 과제 카드 미청구액) ---------- */
  const pct = (v) => (v == null || Number.isNaN(v)) ? '-' : `${(Math.trunc((Number(v) || 0) * 10) / 10).toFixed(1)}%`;
  /* 집행비율 셀: 막대 + 숫자. 100% 이상이면 막대·숫자 빨강 */
  function rateCell(rate, title) {
    if (rate == null || Number.isNaN(rate)) return `<span class="krext-rate krext-dim">-</span>`;
    const r = Number(rate) || 0;
    const cls = r >= 100 ? ' krext-bar-over' : '';   // 90% 주의색(주황) 없이 파랑, 100% 초과만 빨강
    return `<span class="krext-rate" title="${F.esc(title || '')}"><span class="krext-bar"><span class="krext-bar-fill${cls}" style="width:${Math.max(0, Math.min(100, r))}%"></span></span><span class="krext-rate-v${r >= 100 ? ' krext-red' : ''}">${pct(r)}</span></span>`;
  }

  /* 집행비율 계산 (rnd-api execRate 와 동일: 둘 다 양수일 때만, 소수 2자리 절사) */
  const rateOf = (v, bgt) => (bgt > 0 && v > 0) ? Math.trunc(v / bgt * 10000) / 100 : 0;

  /* ----- 예상 비용 (lib/plan.js 의 storage.local.plannedExpenses): 비목 행의 ＋ 버튼으로 세목·수량·단가를 적어 두면 잔액·집행비율에 반영한 예상값을 함께 표시.
   * 표에서는 기본으로 감춰져 있고(＋·항목 줄·예상 반영 행이 빠지고 과제 행의 예상 잔액만 남음) 머리글 "비목" 옆 눈 아이콘을 누른 동안만 보인다(state.planShown, 저장 안 함).
   * 항목은 바꿀 때마다 자동 저장되며 저장 아이콘은 지금 저장 + "저장됨" 표시 ----- */
  const svgIcon = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON_EYE = svgIcon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>');
  const ICON_EYE_OFF = svgIcon('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>');
  const ICON_REPEAT = svgIcon('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>');
  const ICON_SAVE = svgIcon('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>');
  const ICON_CAL = svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>');   // 참여 계획 기간 버튼 (participationSection)
  // 헤더 버튼(새로고침 · 설정 · 접기/펼치기), 과제 행 링크(과제정보 ↗ · 카드 탭 · 자금현황 탭), 푸터 링크 아이콘 (render, cardsSection, budgetSection)
  const ICON_REFRESH = svgIcon('<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>');
  const ICON_SLIDERS = svgIcon('<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>');
  const ICON_UP = svgIcon('<polyline points="18 15 12 9 6 15"/>');
  const ICON_DOWN = svgIcon('<polyline points="6 9 12 15 18 9"/>');
  const ICON_EXT = svgIcon('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
  const ICON_CARD = svgIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>');
  const ICON_CHART = svgIcon('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>');
  const ICON_CLAIM = svgIcon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>');   // 과제·카드 줄 끝 "청구 준비 보기" 버튼 (prepToggle)
  const ICON_CLIP = svgIcon('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>');   // 청구 준비 파일 칩·드롭 구역 (prepRow)
  /* 과제(카드) 목록 머리글: 왼쪽 이름 열, 오른쪽 값 열 이름, 행 끝 아이콘 칸(.krext-prj-link 32px + 왼쪽 선 1px)만큼 빈 자리 (icons: 아이콘 칸 수) */
  const listHead = (left, right, icons) => `<div class="krext-prj-head"><span class="krext-prj-head-l">${left}</span><span class="krext-prj-head-r">${right}</span>${icons ? `<span class="krext-prj-head-sp" style="width:${icons * 33}px"></span>` : ''}</div>`;
  const planBtn = (prjNo, key) => `<button type="button" class="krext-plus-btn" data-act="plan-open" data-prj="${F.esc(prjNo)}" data-key="${F.esc(key)}" title="예상 비용 추가 (세목 · 수량 · 단가)">＋</button>`;
  /* 예상 비용 한 줄: 세목 · [−] 수량 [＋] × 단가 · −금액 · 예산 대비 비율. bgt 가 없으면(표에 없는 비목) 비율 생략.
   * 월간 구독(e.sub)은 수량이 "올해 남은 결제 횟수"로 자동 계산되므로 −/＋ 대신 "월간 N일" 표시 (툴팁에 남은 결제일 목록) */
  function planRow(prjNo, key, e, bgt) {
    const P = g.KRX_PLAN;
    const sub = P.isSub(e), qty = P.qtyOf(e), amt = P.amtOf(e), unit = F.num(e.unit);
    const ref = `data-prj="${F.esc(prjNo)}" data-key="${F.esc(key)}" data-id="${F.esc(e.id)}"`;
    const acts = `<span class="krext-plan-acts"><button type="button" data-act="plan-edit" ${ref} title="수정">✎</button><button type="button" data-act="plan-del" ${ref} title="삭제">×</button></span>`;
    let tip, qtyBox;
    if (sub) {
      const r = P.subRemaining(e.sub.date);
      const list = r.dates.map((d) => `${F.pad2(d.getMonth() + 1)}-${F.pad2(d.getDate())}`).join(', ');
      tip = `월간 구독: ${e.name} · 매월 ${r.day}일 결제 (첫 결제일 ${e.sub.date}) · 올해 남은 결제 ${F.money(qty)}회${list ? ` (${list})` : ''} × 월 ${F.money(unit)}원 = ${F.money(amt)}원 · 날짜가 지나면 횟수가 자동으로 줄어듭니다`;
      qtyBox = `<span class="krext-tag krext-tag-sub" title="매월 ${r.day}일 결제 (${e.sub.date}부터)">월간 ${r.day}일</span> <span class="krext-plan-qty-v" title="올해 남은 결제 횟수 (오늘 포함, 날짜가 지나면 줄어듦)">${F.money(qty)}</span>`;
    } else {
      tip = `예상 비용: ${e.name} · 수량 ${F.money(qty)} × 단가 ${F.money(unit)} = ${F.money(amt)}원${e.ts ? ` · ${F.fmtClock(e.ts)} 입력` : ''} · R&D ERP 에는 없고 이 브라우저에만 저장된 값`;
      qtyBox = `<span class="krext-plan-qty"><button type="button" data-act="plan-qty" data-d="-1" ${ref} title="수량 −1">−</button><span class="krext-plan-qty-v" title="수량">${F.money(qty)}</span><button type="button" data-act="plan-qty" data-d="1" ${ref} title="수량 +1">＋</button></span>`;
    }
    return `<tr class="krext-bgt-plan${sub ? ' krext-bgt-sub' : ''}" title="${F.esc(tip)}"><td class="krext-bgt-nm"><span class="krext-plan-ind">↳</span> <span class="krext-plan-nm">${F.esc(e.name)}</span> ${qtyBox}<span class="krext-dim"> × ${F.money(unit)}</span>${acts}</td><td class="krext-num krext-dim">-</td><td class="krext-num">−${F.money(amt)}</td><td class="krext-num">${bgt > 0 && amt > 0 ? `<span class="krext-rate-plus krext-plan-rate">+${pct(amt / bgt * 100)}</span>` : '<span class="krext-dim">-</span>'}</td></tr>`;
  }
  /* 예상 비용 입력 폼 (한 번에 하나만 열림: state.planEdit). 값은 state.planDraft 에 있어 다시 그려도 입력이 유지된다.
   * "월간" 토글을 켜면 수량 −/＋ 대신 결제일(date) 입력과 남은 횟수가 나온다 */
  function planForm(state, names) {
    const pe = state.planEdit, d = state.planDraft || { name: '', qty: '1', unit: '', amt: '', sub: false, date: '' };
    const opts = (names || []).map((n) => `<option value="${F.esc(n)}">`).join('');
    const subQty = d.sub ? g.KRX_PLAN.subRemaining(d.date).qty : 0;
    const qtyBox = d.sub
      ? `<span class="krext-plan-lbl">결제일</span><input type="date" data-plan="date" value="${F.esc(d.date)}" title="첫 결제일. 매월 같은 날 결제로 보고 오늘부터 올해 12월까지 남은 횟수를 수량으로 셉니다"><span class="krext-plan-lbl" title="올해 남은 결제 횟수 (오늘 포함)">남은 <b data-plan-out="subqty">${F.money(subQty)}</b>회</span>`
      : `<span class="krext-plan-lbl">수량</span><span class="krext-plan-step"><button type="button" data-act="plan-step" data-d="-1" title="수량 −1">−</button><input type="text" inputmode="decimal" data-plan="qty" value="${F.esc(d.qty)}" title="수량 (기본 1, ↑/↓ 키로도 증감)"><button type="button" data-act="plan-step" data-d="1" title="수량 +1">＋</button></span>`;
    return `<tr class="krext-bgt-form"><td colspan="4"><div class="krext-plan-form">
      <span class="krext-plan-ind">↳</span>
      <input type="text" data-plan="name" list="krext-plan-names" placeholder="세목 (예: 회의비, 소프트웨어 활용비)" value="${F.esc(d.name)}" maxlength="60" autocomplete="off" title="세목 (청구서 세목 빠른 선택 목록과 이전에 적은 세목이 자동완성에 나옵니다)">
      <button type="button" class="krext-plan-subtn${d.sub ? ' krext-on' : ''}" data-act="plan-sub" title="월간 구독: 결제일을 고르면 오늘부터 올해 12월까지 남은 결제 횟수가 수량이 되고, 날짜가 지나면 자동으로 줄어듭니다 (단가 = 월 결제액)">${ICON_REPEAT}월간</button>
      ${qtyBox}
      <label>${d.sub ? '월 결제액' : '단가'} <input type="text" inputmode="numeric" data-plan="unit" value="${F.esc(d.unit)}" placeholder="0" title="${d.sub ? '월 결제액 (원). 남은 횟수 × 월 결제액 = 금액' : '단가 (원). 수량 × 단가 = 금액'}"></label>
      <label>금액 <input type="text" inputmode="numeric" data-plan="amt" value="${F.esc(d.amt)}" placeholder="0" title="예상 금액 (원). 직접 적으면 단가를 수량으로 나눠 맞춥니다"></label>
      <button type="button" class="krext-plan-btn krext-plan-save" data-act="plan-save">${pe && pe.id ? '저장' : '추가'}</button>
      <button type="button" class="krext-plan-btn" data-act="plan-cancel" title="취소 (Esc)">취소</button>
      ${state.planError ? `<span class="krext-err krext-plan-err">${F.esc(state.planError)}</span>` : ''}
    </div><datalist id="krext-plan-names">${opts}</datalist></td></tr>`;
  }

  function budgetTable(p, s, state) {
    if (p.budgetError) return `<div class="krext-sub krext-err">자금현황 조회 오류: ${F.esc(p.budgetError)}</div>`;
    const b = p.budget;
    if (!b) return `<div class="krext-sub krext-dim">자금현황 정보를 아직 불러오지 못했습니다. ↻ 새로고침 하세요.</div>`;
    const unbilled = b.unbilled || 0;
    if (!b.items.length && !unbilled) return `<div class="krext-sub krext-dim">비목별 예산 정보가 없습니다 (예산 미등록 또는 조회 권한 없음). <a href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener">R&amp;D ERP 자금현황에서 확인 →</a></div>`;
    const multiRes = (b.resCount || 0) > 1;
    // 설정에서 제외한 비목(인건비/연구수당/간접비)은 계산은 물론 표에서도 뺀다
    const shown = b.items.filter((x) => !x.excluded);
    if (!shown.length && !unbilled) return `<div class="krext-sub krext-dim">설정에서 제외한 비목을 빼면 남는 비목이 없습니다. <a href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener">R&amp;D ERP 자금현황에서 확인 →</a></div>`;
    // 예상 비용: 이 과제에 열린 입력 폼(pe), 과제 합계(pt), 감춤 여부. 세목 자동완성은 청구서 세목 빠른 선택 표시이름 + 이미 적어 둔 세목
    const P = g.KRX_PLAN, plans = (P && state.plans) || {};
    const pe = P && state.planEdit && state.planEdit.prjNo === p.prjNo ? state.planEdit : null;
    const pt = P ? P.projectTotal(plans, p.prjNo) : { sum: 0, count: 0 };
    // 항목이 있는 과제는 기본으로 감춤(눈 아이콘으로 펼친 과제만 보임). 감춤이면 ＋·항목 줄·예상 반영 행을 모두 빼고 과제 행의 예상 잔액만 남긴다
    const hidden = !!(P && pt.count && !(state.planShown && state.planShown.has(p.prjNo)));
    const savedMark = state.planSaved && state.planSaved.prjNo === p.prjNo ? `<span class="krext-plan-saved${state.planSaved.error ? ' krext-err' : ''}">${state.planSaved.error ? '저장 실패' : '저장됨'}</span>` : '';
    const saveTip = `예상 비용 ${F.money(pt.count)}건 저장${state.planSavedAt ? ` · 마지막 저장 ${F.fmtClock(state.planSavedAt)}` : ''} (입력·수정·삭제 때마다 자동 저장되어 브라우저를 다시 시작해도 남습니다. 눌러서 지금 저장)`;
    const icons = P && pt.count ? `<span class="krext-plan-ico"><button type="button" class="krext-ico-btn${hidden ? ' krext-ico-off' : ''}" data-act="plan-hide" data-prj="${F.esc(p.prjNo)}" title="${hidden ? F.esc(`예상 비용 보이기 (${F.money(pt.count)}건 · ${F.money(pt.sum)}원 저장되어 있음. 기본은 감춤이며 이 화면에서만 펼쳐집니다)`) : '예상 비용 감추기 (＋ 버튼·항목 줄·예상 반영 행을 숨기고 과제 행의 예상 잔액만 남김)'}">${hidden ? ICON_EYE_OFF : ICON_EYE}</button><button type="button" class="krext-ico-btn" data-act="plan-persist" data-prj="${F.esc(p.prjNo)}" title="${F.esc(saveTip)}">${ICON_SAVE}</button>${savedMark}</span>` : '';
    const names = pe ? Array.from(new Set([].concat(
      (s.quickPicks || []).map((q) => String(q).split('=')[0].trim()),
      Object.values(plans).flatMap((byKey) => Object.values(byKey).flatMap((l) => l.map((e) => e.name)))).filter(Boolean))) : [];
    // 비목 밑의 예상 비용 행들 (수정 중인 항목은 폼으로 대체) + 새 항목 폼
    const planRows = (key, list, bgt) => list.map((e) => (pe && pe.key === key && pe.id === e.id) ? planForm(state, names) : planRow(p.prjNo, key, e, bgt)).join('')
      + (pe && pe.key === key && !pe.id ? planForm(state, names) : '');
    const seen = new Set();
    const rows = shown.map((x) => {
      const name = `${multiRes && x.res ? `<span class="krext-dim">${F.esc(x.res)}</span> ` : ''}${F.esc(x.exp || x.item || '-')}`;
      const tags = `${x.dir ? ' <span class="krext-tag krext-tag-grey" title="직접비 비목">직접비</span>' : ''}${x.psnl ? ' <span class="krext-tag krext-tag-grey" title="인건비 비목">인건비</span>' : ''}`;
      const tip = [x.item ? `예산항목 ${x.item}` : '', `예산액(A) ${F.money(x.bgt)}`, x.cary ? `이월 ${F.money(x.cary)}` : '', x.inter ? `이자 ${F.money(x.inter)}` : '',
        `승인액(B) ${F.money(x.appr)}`, x.req ? `신청 ${F.money(x.req)}` : '', x.purch ? `구매요청 ${F.money(x.purch)}` : '', x.adj ? `예산조정 ${F.money(x.adj)}` : '', `예산잔액(A-B) ${F.money(x.bal)}`].filter(Boolean).join(' · ');
      const key = P ? P.itemKey(x) : ''; seen.add(key);
      const list = (P && !hidden) ? P.listOf(plans, p.prjNo, key) : [];
      let html = `<tr title="${F.esc(tip)}"><td class="krext-bgt-nm">${name}${tags}${P && !hidden ? planBtn(p.prjNo, key) : ''}</td><td class="krext-num">${F.money(x.bgt)}</td><td class="krext-num${x.bal < 0 ? ' krext-red' : ''}">${F.money(x.bal)}</td><td class="krext-num">${rateCell(x.rate, `승인액 ${F.money(x.appr)} / 예산액 ${F.money(x.bgt)}`)}</td></tr>`;
      if (P && !hidden) html += planRows(key, list, x.bgt);
      if (list.length) {   // 이 비목의 예상 비용을 뺀 잔액 / 더한 집행비율
        const psum = P.sumOf(list);
        const ptip = `예상 비용 ${F.money(list.length)}건 ${F.money(psum)}원 반영: 잔액 ${F.money(x.bal)} − ${F.money(psum)} · 집행비율 (승인액 ${F.money(x.appr)} + 예상 ${F.money(psum)}) / 예산액 ${F.money(x.bgt)}`;
        html += `<tr class="krext-bgt-proj" title="${F.esc(ptip)}"><td class="krext-bgt-nm"><span class="krext-plan-ind">↳</span> 예상 반영 <span class="krext-dim">${F.money(list.length)}건 · ${F.money(psum)}원</span></td><td class="krext-num krext-dim">-</td><td class="krext-num${x.bal - psum < 0 ? ' krext-red' : ''}">${F.money(x.bal - psum)}</td><td class="krext-num">${rateCell(rateOf(x.appr + psum, x.bgt), `(승인액 + 예상) / 예산액`)}</td></tr>`;
      }
      return html;
    }).join('');
    // 표에 없는 비목(설정에서 제외했거나 자금현황에서 사라진 비목)에 적어 둔 예상 비용도 보이게 (합계의 예상 반영에는 포함)
    const orphans = (P && !hidden) ? Object.keys(plans[p.prjNo] || {}).filter((k) => !seen.has(k)).map((k) => {
      const list = P.listOf(plans, p.prjNo, k);
      return `<tr class="krext-bgt-orphan" title="현재 표에 없는 비목에 적어 둔 예상 비용 (설정에서 제외했거나 자금현황에서 사라진 비목). 합계의 예상 반영에는 포함됩니다"><td class="krext-bgt-nm">${F.esc(P.keyName(k))} <span class="krext-tag krext-tag-grey">표에 없는 비목</span></td><td class="krext-num krext-dim">-</td><td class="krext-num krext-dim">-</td><td class="krext-num krext-dim">-</td></tr>` + planRows(k, list, 0);
    }).join('') : '';
    // 미청구 행: 이 과제 카드로 사용했지만 아직 청구/승인되지 않은 금액 (공용 거래 제외). 비목 배정 전이므로 예산은 없고 잔액에서 차감
    const ubTip = `이 과제 카드의 미청구 거래 ${F.money(b.unbilledCount || 0)}건 (같은 계좌를 쓰는 다른 과제와 공용인 거래 ${F.money(p.unbilledShared || 0)}건 제외). 청구 전이라 비목이 정해지지 않아 예산잔액 합계에서 차감하고 집행비율에 더합니다.`;
    const ubRow = `<tr class="krext-bgt-unbilled" title="${F.esc(ubTip)}"><td class="krext-bgt-nm">미청구 <span class="krext-tag" title="과제카드 미청구 사용액">과제카드</span> <span class="krext-dim">${F.money(b.unbilledCount || 0)}건</span></td><td class="krext-num krext-dim">-</td><td class="krext-num${unbilled > 0 ? ' krext-red' : ''}">${unbilled ? '−' + F.money(Math.abs(unbilled)) : '0'}</td><td class="krext-num">${unbilled > 0 ? `<span class="krext-rate-plus">+${pct(b.unbilledRate)}</span>` : '<span class="krext-dim">-</span>'}</td></tr>`;
    let foot = `<tr class="krext-bgt-total"><td>합계 <span class="krext-dim">(미청구 반영)</span></td><td class="krext-num">${F.money(b.bgtAmt)}</td><td class="krext-num${b.balAfter < 0 ? ' krext-red' : ''}">${F.money(b.balAfter)}</td><td class="krext-num">${rateCell(b.rateAll, `(승인액 ${F.money(b.apprAmt)} + 미청구 ${F.money(unbilled)}) / 예산액 ${F.money(b.bgtAmt)}`)}</td></tr>`;
    if (pt.count && !hidden) {   // 예상 비용까지 뺀 잔액 / 더한 집행비율
      const ftip = `(승인액 ${F.money(b.apprAmt)} + 미청구 ${F.money(unbilled)} + 예상 ${F.money(pt.sum)}) / 예산액 ${F.money(b.bgtAmt)}`;
      foot += `<tr class="krext-bgt-proj" title="${F.esc(ftip)}"><td>예상 반영 <span class="krext-dim">(예상 ${F.money(pt.count)}건 · ${F.money(pt.sum)}원)</span></td><td class="krext-num krext-dim">-</td><td class="krext-num${b.balAfter - pt.sum < 0 ? ' krext-red' : ''}">${F.money(b.balAfter - pt.sum)}</td><td class="krext-num">${rateCell(rateOf(b.execAmt + pt.sum, b.bgtAmt), `(승인액 + 미청구 + 예상) / 예산액`)}</td></tr>`;
    }
    return `<table class="krext-cards krext-bgt"><thead><tr><th>비목${icons}</th><th class="krext-num" title="예산액(A)">예산</th><th class="krext-num" title="예산잔액(A-B)">예산잔액</th><th class="krext-num" title="승인액(B) ÷ 예산액(A)">집행비율</th></tr></thead><tbody>${rows}${orphans}${ubRow}</tbody><tfoot>${foot}</tfoot></table>`;
  }

  function budgetSection(d, s, state) {
    const withB = d.projects.filter((p) => p.budget);
    const tBgt = withB.reduce((x, p) => x + p.budget.bgtAmt, 0);
    const tExec = withB.reduce((x, p) => x + (p.budget.execAmt || 0), 0);
    const tUb = withB.reduce((x, p) => x + (p.budget.unbilled || 0), 0);
    const tRate = tBgt > 0 ? tExec / tBgt * 100 : null;
    let note = withB.length ? `예산 ${F.money(tBgt)}원 · 집행 ${F.money(tExec)}원 (미청구 ${F.money(tUb)} 포함) · ${pct(tRate)}` : '자금현황 정보 없음';
    // 예상 비용(lib/plan.js) 합계
    const P = g.KRX_PLAN, plans = (P && state.plans) || {};
    const tPlan = P ? withB.reduce((x, p) => x + P.projectTotal(plans, p.prjNo).sum, 0) : 0;
    if (tPlan > 0) note += ` · 예상 ${F.money(tPlan)}원`;
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
      const pt = P ? P.projectTotal(plans, p.prjNo) : { sum: 0, count: 0 };
      const tip = `${p.prjNo} ${period}${b ? ` / 예산 ${F.money(b.bgtAmt)} · 승인 ${F.money(b.apprAmt)} · 미청구 ${F.money(b.unbilled || 0)} · 잔액 ${F.money(b.balAfter)}${pt.count ? ` · 예상 비용 ${F.money(pt.count)}건 ${F.money(pt.sum)} 반영 시 잔액 ${F.money(b.balAfter - pt.sum)}` : ''}` : ''}`;
      // 예상 비용이 있으면 잔액 밑에 예상 반영 잔액을 작게
      const proj = b && pt.count ? `<span class="krext-prj-proj" title="예상 비용 ${F.money(pt.count)}건 ${F.money(pt.sum)}원 반영 시 잔액">예상 ${F.money(b.balAfter - pt.sum)}</span>` : '';
      const rate = b ? rateCell(b.rateAll, `(승인액 + 미청구) / 예산액`) : `<span class="krext-rate ${p.budgetError ? 'krext-err' : 'krext-dim'}">${p.budgetError ? '오류' : '-'}</span>`;
      return `<div class="krext-prj${open ? ' krext-open' : ''}">
        <div class="krext-prj-line">
          <a href="#" class="krext-prj-row" data-act="prj" data-prj="${F.esc(p.prjNo)}" title="${F.esc(tip)}">
            <span class="krext-caret">${open ? '▾' : '▸'}</span>
            <span class="krext-prj-rspr">${F.esc(p.rspr || '-')}</span>
            <span class="krext-prj-nm">${F.esc(p.prjNm)}</span>
            <span class="krext-prj-rate">${rate}</span>
            <span class="krext-prj-amt${b && b.balAfter < 0 ? ' krext-red' : ''}" title="예산잔액 (미청구 차감)">${b ? F.money(b.balAfter) : '-'}${proj}</span>
          </a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '01'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 열기 (${F.esc(p.prjNo)})">${ICON_EXT}</a>
          <a class="krext-prj-link" href="${F.esc(projectLink(p.prjNo, '06'))}" target="_blank" rel="noopener" title="R&amp;D ERP 과제정보 › 자금현황 탭 열기">${ICON_CHART}</a>
        </div>
        ${open ? `<div class="krext-prj-body">${budgetTable(p, s, state)}</div>` : ''}
      </div>`;
    }).join('');
    return `<section class="krext-sec">${head}<div class="krext-prj-list">${listHead('책임자 · 과제', '집행비율 · 예산잔액 (원)', 2)}${list}</div></section>`;
  }

  function render(host, state) {
    const d = state.data;
    const s = (d && d.settings) || {};
    cardNames = s.cardNames || {};
    // 청구 준비 줄: 청구서 입력 도우미가 켜져 있을 때만 (꺼져 있으면 청구서에서 적용되지 않음). 청구종류 목록은 세목 빠른 선택 표시이름
    prepCtx = { on: !!g.KRX_PREP && s.claimHelperOn !== false, picks: g.KRX_PREP ? g.KRX_PREP.parsePicks(s.quickPicks || []) : [], mode: state.mode };
    const rnd = state.rndUrl || s.rndUrl || RND_MAIN;
    const hrUrl = state.hrUrl || (s.hr && s.hr.url) || HR_HOME;   // 하단 HR System 열기: eClass 화면의 HR 링크 → 설정의 HR System 링크 → 기본 주소
    host.classList.toggle('krext-collapsed', !!state.collapsed);
    host.classList.toggle('krext-popup', state.mode === 'popup');
    const updated = d && d.ts ? `${F.fmtClock(d.ts)} 기준` : '';
    // 헤더 아무 곳(버튼 제외)을 클릭해도 접기/펼치기. 팝업에는 접기가 없음
    const headAct = state.mode === 'popup' ? '' : ` data-act="toggle" title="${state.collapsed ? '클릭: 펼치기' : '클릭: 접기'}"`;
    let html = `<div class="krext-head"${headAct}>
      <span class="krext-title">R&amp;D ERP 현황</span>
      <span class="krext-chips">${headerChips(d, state)}</span>
      <span class="krext-updated"><span class="krext-dot${state.loading ? ' krext-dot-busy' : ''}"></span>${state.loading ? '조회 중…' : F.esc(updated)}</span>
      <button type="button" class="krext-btn${state.loading ? ' krext-spin' : ''}" data-act="refresh" title="새로고침 (참여인력·계상률도 다시 조회)"${state.loading ? ' disabled' : ''}>${ICON_REFRESH}</button>
      <button type="button" class="krext-btn" data-act="settings" title="설정">${ICON_SLIDERS}</button>
      ${state.mode === 'popup' ? '' : `<button type="button" class="krext-btn" data-act="toggle" title="${state.collapsed ? '펼치기' : '접기'}">${state.collapsed ? ICON_DOWN : ICON_UP}</button>`}
    </div>`;
    if (!state.collapsed) {
      html += `<div class="krext-body">`;
      if (state.fatal) html += `<div class="krext-msg krext-err">${F.esc(state.fatal)}</div>`;
      if (d) {
        if (d.loginRequired) {
          html += loginNotice(state);
        } else if (d.error) {
          html += `<div class="krext-msg krext-err">조회 오류: ${F.esc(d.error)}</div>`;
        }
        const main = d.loginRequired ? '' : (state.section === 'budget' ? budgetSection(d, s, state) : cardsSection(d, s, state));
        // 왼쪽 칸: 미승인내역 + 급여·연구수당(HR), 오른쪽: 카드미청구 / 과제집행비율
        html += `<div class="krext-cols"><div class="krext-side">${unapprovedSection(d, s)}${participationSection(d, s, state)}${paySection(d, s, state)}</div>${main}</div>`;
      } else if (state.loading) {
        html += `<div class="krext-msg krext-dim">불러오는 중…</div>`;
      }
      const meta = [];
      if (d && s.monthsBack != null) meta.push(`사용일자 ${F.esc(s.monthsBack)}개월 전 ~ ${F.esc(s.monthsForward)}개월 후`);
      if (state.version) meta.push(`v${F.esc(state.version)}`);
      html += `</div><div class="krext-foot"><a href="${F.esc(rnd)}" target="_blank" rel="noopener">R&amp;D ERP 열기 ${ICON_EXT}</a><a href="${F.esc(hrUrl)}" target="_blank" rel="noopener">HR System 열기 ${ICON_EXT}</a><a href="#" data-act="settings">설정</a>${meta.length ? `<span class="krext-foot-r">${meta.join(' · ')}</span>` : ''}</div>`;
    }
    // 예상 비용 입력 중 다시 그려지면(자동 갱신, 다른 창의 변경 등) 같은 칸에 포커스와 커서를 되돌린다 (입력값은 state.planDraft 가 유지)
    // (받기 예정 연구수당 입력칸 data-pay, 참여 계획 입력칸 data-part, 청구 준비의 청구내역 입력칸 data-prep-ptcl(입력값은 state.prepDraft) 도 같음)
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    const attr = ae && ae.dataset ? (ae.dataset.plan ? 'plan' : (ae.dataset.pay ? 'pay' : (ae.dataset.part ? 'part' : (ae.dataset.prepPtcl ? 'prep-ptcl' : '')))) : '';
    const keep = attr && typeof host.contains === 'function' && host.contains(ae) ? { sel: `[data-${attr}="${ae.getAttribute('data-' + attr)}"]`, pos: ae.selectionStart } : null;
    host.innerHTML = html;
    if (keep) { const el = host.querySelector(keep.sel); if (el) { el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch (e) {} } }
  }

  g.KRX_RENDER = { render };
})(typeof self !== 'undefined' ? self : this);
