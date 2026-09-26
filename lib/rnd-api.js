/* R&D ERP(rnd.krs.co.kr) 서비스 호출 - 서비스워커 전용
 * 규약: POST /{service}.jct, body: _JSON_=encodeURIComponent(encodeURIComponent(JSON)), 응답 JSON(charset=euc-kr)
 * 응답 COMMON_HEAD.ERROR=true 이면 오류. CODE=GWM0001("사용자 정보가 존재하지 않습니다") = 로그인 필요 */
(function (g) {
  const F = g.KRX_FMT;
  const BASE = 'https://rnd.krs.co.kr';

  function err(kind, message, extra) { return Object.assign(new Error(message || kind), { kind }, extra || {}); }

  async function call(service, input) {
    const body = '_JSON_=' + encodeURIComponent(encodeURIComponent(JSON.stringify(input || {})));
    let res;
    try {
      res = await fetch(`${BASE}/${service}.jct`, {
        method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'charset': 'utf-8' },
        body
      });
    } catch (e) { throw err('network', '네트워크 오류: ' + (e && e.message || e)); }
    const ct = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    const m = /charset=([^;]+)/i.exec(ct);
    const charset = m ? m[1].trim().toLowerCase() : 'euc-kr';
    let text;
    try { text = new TextDecoder(charset).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
    if (!/json/i.test(ct)) {
      if (/html/i.test(ct) || /<html/i.test(text)) throw err('login', '로그인 페이지가 반환되었습니다.', { status: res.status });
      throw err('badresponse', `예상치 못한 응답(${res.status} ${ct})`, { sample: text.slice(0, 200) });
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw err('badresponse', 'JSON 파싱 실패', { sample: text.slice(0, 200) }); }
    const head = data.COMMON_HEAD || {};
    if (head.ERROR) {
      const code = String(head.CODE || '');
      const msg = String(head.MESSAGE || '');
      const kind = (code === 'GWM0001' || /세션|로그인|사용자 정보/.test(msg)) ? 'login' : 'service';
      throw err(kind, `${service}: ${msg || code}`, { code, service });
    }
    return data;
  }

  function describe(e) { return { kind: (e && e.kind) || 'unknown', message: String((e && e.message) || e) }; }

  async function pool(items, size, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
    });
    await Promise.all(workers);
  }

  /* 과제 목록 원본 행 (과제 검색 팝업 rcomm_0009_01_r001 과 동일). 입력: SEARCH_GB = 진행상태 코드(콤보 RD0008: 10 진행, 30 완료 …, '' 전체), PRJ_AUTH = 과제권한(1 본인과제, 2 담당과제, 9/'' 전체)
   * 서버는 최대 500건만 돌려준다(2026-09-24 실측: 전체 조회가 정확히 500건이라 진행 중인 과제가 빠짐). 그래서 기본 입력은 진행(10)만 조회하고,
   * 전체('')로 받아 500건이 되면 진행(10)만 한 번 더 받아 합친다 — 진행 과제는 500건보다 훨씬 적어 잘리지 않는다.
   * 돌려주는 값: { recs, calls: [{ input, count, error }], capped(절단이 있었는지), firstErr } */
  const PROJECT_LIST_CAP = 500;
  async function fetchProjectRecs(settings) {
    const adv = settings.adv || {};
    const primary = adv.projectsService || 'rcomm_0009_01_r001';
    const base = Object.assign({ SEARCH_NM: '', SEARCH_GB: '10', GUBUN: 'A', PRJ_AUTH: '' }, g.KRX_SETTINGS.parseJson(adv.projectsInput));
    const out = { recs: [], calls: [], capped: false, firstErr: null };
    const one = async (input) => {
      const c = { input, count: 0, error: null };
      out.calls.push(c);
      try { const data = await call(primary, input); const recs = Array.isArray(data.REC) ? data.REC : []; c.count = recs.length; return recs; }
      catch (e) { if (e.kind === 'login') throw e; c.error = describe(e).message; if (!out.firstErr) out.firstErr = e; return []; }
    };
    const recs = await one(base);
    if (recs.length >= PROJECT_LIST_CAP) {
      out.capped = true;
      if (String(base.SEARCH_GB || '') !== '10') {   // 전체(또는 다른 상태) 조회가 잘렸으면 진행 과제만 한 번 더 받아 합친다
        const more = await one(Object.assign({}, base, { SEARCH_GB: '10' }));
        const seen = new Set(recs.map((r) => [r.PRJ_NO, r.ANL].join('#')));
        for (const r of more) { const k = [r.PRJ_NO, r.ANL].join('#'); if (!seen.has(k)) { seen.add(k); recs.push(r); } }
      }
    }
    out.recs = recs;
    return out;
  }
  /* 과제 목록
   * 1순위: rcomm_0009_01_r001 (과제 검색 팝업과 동일, fetchProjectRecs — 500건 절단 대응)
   * 2순위: rmain_0005_01_r001 (종료 90일 이내 진행과제) - 1순위가 실패하거나 0건일 때 */
  async function fetchProjects(settings) {
    const adv = settings.adv || {};
    const primary = adv.projectsService || 'rcomm_0009_01_r001';
    const pr = await fetchProjectRecs(settings);
    let recs = pr.recs;
    const firstErr = pr.firstErr;
    if (!recs.length) {
      const fb = adv.projectsFallbackService || 'rmain_0005_01_r001';
      if (fb && fb !== primary) {
        try { const data = await call(fb, { SEARCH_GB: 'D', STD_DT: F.ymd(new Date()) }); recs = Array.isArray(data.REC) ? data.REC : []; }
        catch (e) { if (e.kind === 'login') throw e; if (firstErr) throw firstErr; }
      } else if (firstErr) { throw firstErr; }
    }
    const kw = String(settings.projectStatusKeyword == null ? '진행' : settings.projectStatusKeyword).trim();
    if (kw) {
      const f = recs.filter((r) => String(r.PROG_STS_NM || '').includes(kw));
      if (f.length) recs = f;
    }
    const byNo = new Map();
    for (const r of recs) {
      const no = String(r.PRJ_NO || '').trim();
      if (!no) continue;
      const prev = byNo.get(no);
      if (!prev || F.num(r.ANL) >= F.num(prev.ANL)) byNo.set(no, r);
    }
    const out = Array.from(byNo.values()).map((r) => ({
      prjNo: String(r.PRJ_NO).trim(),
      prjNm: String(r.PRJ_NM || '').trim(),
      rspr: String(r.PRJ_RSPR_EMP_NM || '').trim(),
      chrg: String(r.PRJ_CHRG_GRP_NM || '').trim(),
      anl: String(r.ANL || ''),
      status: String(r.PROG_STS_NM || '').trim(),
      stDt: String(r.RCH_ST_DT || ''),
      endDt: String(r.RCH_END_DT || ''),
      termCnt: r.TERM_CNT == null ? null : F.num(r.TERM_CNT),
      cards: [], count: 0, amount: 0, error: null
    }));
    out.sort((a, b) => (b.stDt || '').localeCompare(a.stDt || ''));
    Object.assign(out, { capped: pr.capped, calls: pr.calls });   // collect · 진단용 (500건 절단 여부, 호출 내역)
    return out;
  }

  function dateRange(settings) {
    const today = new Date();
    return {
      START_DATE: F.ymd(F.addMonths(today, -Math.abs(F.num(settings.monthsBack) || 6))),
      END_DATE: F.ymd(F.addMonths(today, Math.abs(F.num(settings.monthsForward) || 1)))
    };
  }

  /* 과제정보 > 카드 탭 > 카드사용내역 (SEARCH_GB 1=미청구) */
  async function fetchCards(prjNo, settings) {
    const adv = settings.adv || {};
    const input = Object.assign({ USEFAC_SEQ_NO: adv.usefacSeqNo || '10', PRJ_NO: prjNo, SEARCH_GB: '1', CARD_DATE_GBN: '1', CARD_NO: '' },
      dateRange(settings), g.KRX_SETTINGS.parseJson(adv.cardsInput), { PRJ_NO: prjNo });
    const data = await call(adv.cardsService || 'rtask_0008_t05_01_r001', input);
    const recs = Array.isArray(data.REC) ? data.REC : [];
    const cards = recs.map((r) => ({
      cardNo: String(r.CARD_NO || ''),
      tail: F.cardTail(r.CARD_NO, 8),
      user: String(r.USER_NM || '').trim(),
      usedDate: String(r.USED_DATE || ''),
      usedTime: String(r.USED_TIME || ''),
      shop: String(r.SHOP_NAME || '').trim(),
      amount: F.num(r.USED_COST),
      apprNo: String(r.APPRNO || ''),
      cardDiv: String(r.PRJ_CARD_DIV_NM || ''),
      apprPlan: String(r.APPR_PLAN_DATE || ''),
      abroad: String(r.AB_LO_CLSS || ''),
      prjNo: String(r.PRJ_NO || '').trim()
    }));
    cards.sort((a, b) => (b.usedDate + b.usedTime).localeCompare(a.usedDate + a.usedTime));
    return cards;
  }

  /* 과제카드발급내역 (과제정보 > 카드 탭 하단 목록). 계좌번호 포함 */
  async function fetchIssuedCards(prjNo, settings) {
    const adv = settings.adv || {};
    const input = Object.assign({ USEFAC_SEQ_NO: adv.usefacSeqNo || '10', PRJ_NO: prjNo, SEARCH_GB: '1', CARD_DATE_GBN: '1', CARD_NO: '' }, dateRange(settings));
    const data = await call(adv.issuedService || 'rtask_0008_t01_01_r002', input);
    const recs = Array.isArray(data.REC) ? data.REC : [];
    return recs.map((r) => ({
      cardNo: String(r.CARD_NO || '').trim(),
      digits: F.digits(r.CARD_NO),
      tail: F.cardTail(r.CARD_NO, 8),
      user: String(r.USER_NM || '').trim(),
      div: String(r.PRJ_CARD_DIV_NM || '').trim(),
      bank: String(r.BNK_NM || '').trim(),
      acctNoRaw: String(r.ACCT_NO || '').trim(),
      acctNo: F.digits(r.ACCT_NO),
      setlDd: String(r.SETL_DD || '').trim(),
      issuDt: String(r.ISSU_DT || '').trim(),
      remark: String(r.RMK || r.REMK || '').trim()
    })).filter((c) => c.digits);
  }

  /* 과제정보 > 기본정보 > 과제관리계좌 (지출계좌 등) */
  async function fetchAccounts(prjNo, settings) {
    const adv = settings.adv || {};
    const data = await call(adv.accountsService || 'rtask_0010_02_r003', { PRJ_NO: prjNo, USEFAC_SEQ_NO: adv.usefacSeqNo || '10' });
    const recs = Array.isArray(data.REC) ? data.REC : [];
    return recs.map((r) => ({
      seq: String(r.MNG_SEQ_NO || r.SEQ_NO || ''),
      divCd: String(r.MNG_ACCT_DIV_CD || r.ACCT_DIV_CD || '').trim(),
      divNm: String(r.MNG_ACCT_DIV_NM || r.ACCT_DIV_NM || '').trim(),
      bank: String(r.MNG_BNK_NM || r.BNK_NM || '').trim(),
      acctNoRaw: String(r.MNG_ACCT_NO || r.ACCT_NO || '').trim(),
      acctNo: F.digits(r.MNG_ACCT_NO || r.ACCT_NO || ''),
      owner: String(r.MNG_ACCT_OWNR_NM || r.MNG_ACCT_OWNR || r.ACCT_OWNR || '').trim(),
      info: String(r.MNG_ACCT_BNK_NM || r.ACCT_INFO || '').trim(),
      res: String(r.RES_NM || '').trim(),
      nick: String(r.ACCT_NICK_NM || '').trim()
    }));
  }

  /* 과제정보 > 참여인력 (계상률기준 INFO_REC + 인력기준 HM_PER_REC) */
  async function fetchParticipants(prjNo, settings) {
    const adv = settings.adv || {};
    const input = Object.assign({ SEARCH_NM: '', SEARCH_GB: '1' }, g.KRX_SETTINGS.parseJson(adv.participantsInput), { PRJ_NO: prjNo });
    const data = await call(adv.participantsService || 'rtask_0008_t03_01_r001', input);
    // 계상률(PART_RT, 참여율 %)·지급기간(PART_TRM_DT)·계상률 체크제외(PARTRATE_YN)는 계상률기준내역(INFO_REC)에만 있음 (화면 rtask_0008_t03_01.js 의 sheetPrt1 열)
    const map = (r, src) => ({
      empNo: String(r.EMP_NO || '').trim(),
      empNm: String(r.EMP_NM || '').trim(),
      role: String(r.ROLE_NM || '').trim(),
      term: String(r.PART_TRM_DT_DTL || r.PART_TRM_DT || '').trim(),
      blng: String(r.BLNG_YN || '').trim(),
      src,                                                                        // 'info' 계상률기준 / 'hm' 인력기준
      rate: r.PART_RT == null || String(r.PART_RT).trim() === '' ? null : F.num(r.PART_RT),   // 계상률(참여율 %)
      rateExcluded: /^(y|1|true|예|제외)/i.test(String(r.PARTRATE_YN || '').trim()) || /제외/.test(String(r.PARTRATE_YN || '')),   // 계상률 체크제외 (Y/예/제외 등)
      payTerm: src === 'info' ? String(r.PART_TRM_DT || '').trim() : '',         // 지급기간
      div: String(r.PART_HM_DIV_NM || '').trim(),                                // 구분
      incm: String(r.INCM_DIV_NM || '').trim(),                                  // 소득구분 (근로소득/기타소득 …)
      incmDtl: String(r.INCM_DIV_DTL_NM || '').trim(),                           // 소득상세
      payExp: String(r.PAY_EXP_NM || r.MARK_EXP_NM || '').trim(),                // 지급비목 (인건비/연구수당 …)
      payAmt: r.PAY_AMT == null || String(r.PAY_AMT).trim() === '' ? null : F.num(r.PAY_AMT),   // 월 지급금액
      // 행 종류를 가리는 데 쓸 원본 필드 (주민번호·계좌·연락처 등 개인정보 필드는 제외). 본인 행만 저장됨
      raw: Object.fromEntries(Object.entries(r).filter(([k, v]) => (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '' && !/SSN|ACCT|ADDR|CPHN|EMAIL|ZIP|TEL|OWNR/i.test(k)).map(([k, v]) => [k, String(v).trim().slice(0, 60)]))
    });
    return [].concat((Array.isArray(data.INFO_REC) ? data.INFO_REC : []).map((r) => map(r, 'info')),
                     (Array.isArray(data.HM_PER_REC) ? data.HM_PER_REC : []).map((r) => map(r, 'hm')));
  }

  /* 참여기간 "2026-01-01 ~ 2026-12-31" / "20260101~20261231" → { st, end } (yyyyMMdd). 날짜가 없으면 null */
  /* 기간 문자열 → { st, end } (yyyyMMdd). "2026-01-01 ~ 2026-12-31", "20260101~20261231", 월 단위 "2026-04 ~ 2026-06"(시작 1일, 끝 31일로 봄) 모두 처리. 날짜가 없으면 null */
  function termRange(term) {
    const ds = String(term || '').match(/\d{4}[-./]?\d{2}(?:[-./]?\d{2})?/g) || [];
    if (!ds.length) return null;
    const norm = (s, isEnd) => { const d = F.digits(s); return d.length >= 8 ? d.slice(0, 8) : d.slice(0, 6) + (isEnd ? '31' : '01'); };
    return { st: norm(ds[0], false), end: ds.length > 1 ? norm(ds[1], true) : '' };
  }
  /* 과제 참여율 요약: 과제별 본인(useId 면 사번 일치 행만, 아니면 이름 일치 포함)의 계상률기준 행 가운데
   *  - 지급기간(PART_TRM_DT, 없으면 참여기간 PART_TRM_DT_DTL)에 오늘이 드는 행만 "현재" 행으로 보고,
   *  - 현재 행이 여럿(기간이 겹침)이면 시작이 가장 늦은 행(가장 최근 계상률) 하나만 그 과제의 참여율로 쓴다 — 계상률이 바뀔 때마다 행이 추가되는 화면이라 더하면 부풀려짐.
   *  - 계상률 체크제외(PARTRATE_YN=Y) 행은 같은 규칙으로 하나만 골라 별도 표시하고 합계에서는 뺀다.
   *  - 계상률기준 행이 없고 인력기준 행만 있으면 참여율 미상(hasInfo=false).
   * 행마다 status(current/past/future)와 counted(합계에 넣은 행)를 남겨 패널 표에서 원본을 확인할 수 있게 한다.
   * hits: checkMembership 결과 { [prjNo]: [행] | null(조회 실패) } */
  /* 행 종류: 지급비목 / 소득상세 / 소득구분 / 구분 (있는 것만). 연구수당·기타소득 성격이면 참여율(인건비 계상률)이 아니라 별도 표시 */
  const kindOf = (h) => [h.payExp, h.incmDtl, h.incm, h.div].map((v) => String(v || '').trim()).filter(Boolean).join(' / ');
  const isAllowanceKind = (kind) => /연구수당|연구활동비|기타\s*소득|수당/.test(String(kind || ''));
  function summarizeParticipation(projects, hits, useId) {
    const today = F.ymd(new Date());
    const items = [];
    let errorCount = 0;
    for (const p of projects) {
      const hs = hits ? hits[p.prjNo] : undefined;
      if (hs === null) { errorCount++; continue; }
      if (!Array.isArray(hs)) continue;
      const mine = hs.filter((h) => (useId ? h.byId : (h.byName || h.byId)));
      if (!mine.length) continue;
      const rows = mine.map((h, i) => {
        const r = termRange(h.payTerm) || termRange(h.term);
        const current = !r || ((!r.st || r.st <= today) && (!r.end || today <= r.end));
        const future = !!(r && r.st && r.st > today);
        const kind = kindOf(h);
        return { idx: i, role: h.role || '', src: h.src || 'info', rate: h.rate == null ? null : F.num(h.rate), rateExcluded: !!h.rateExcluded,
          term: h.term || '', payTerm: h.payTerm || '', st: (r && r.st) || '', end: (r && r.end) || '',
          kind, allowance: isAllowanceKind(kind), payAmt: h.payAmt == null ? null : F.num(h.payAmt), raw: h.raw || null,
          status: current ? 'current' : (future ? 'future' : 'past'), counted: false };
      });
      const info = rows.filter((x) => x.src === 'info' && x.rate != null);
      const part = info.filter((x) => !x.allowance);                 // 참여율(인건비) 성격 행
      const cur = part.filter((x) => x.status === 'current');
      // 종류(구분/소득구분/지급비목)가 같은 현재 행이 여럿(계상률 변경 이력 등)이면 시작이 가장 늦은 행, 같으면 나중에 온 행 하나만.
      // 종류가 다른 행(예: 재원별)은 각각 하나씩 골라 더한다
      const pick = (list) => list.length ? list.slice().sort((a, b) => (b.st || '').localeCompare(a.st || '') || b.idx - a.idx)[0] : null;
      const pickPerKind = (list) => { const g = new Map(); for (const x of list) { if (!g.has(x.kind)) g.set(x.kind, []); g.get(x.kind).push(x); } return Array.from(g.values()).map(pick).filter(Boolean); };
      const mains = pickPerKind(cur.filter((x) => !x.rateExcluded));
      const excls = pickPerKind(cur.filter((x) => x.rateExcluded));
      for (const x of mains.concat(excls)) x.counted = true;
      const allowCur = pickPerKind(info.filter((x) => x.allowance && x.status === 'current'));
      const sum = (list) => Math.round(list.reduce((s, x) => s + x.rate, 0) * 100) / 100;
      const first = mains[0] || excls[0] || part[0] || info[0] || rows[0] || null;
      const futureRows = part.filter((x) => x.status === 'future' && !x.rateExcluded);
      items.push({ prjNo: p.prjNo, prjNm: p.prjNm, rspr: p.rspr, stDt: p.stDt, endDt: p.endDt,
        role: (rows.map((x) => x.role).filter(Boolean))[0] || '',
        empNm: (mine.map((h) => h.empNm).filter(Boolean))[0] || '',   // 본인 이름 (과제책임자 이름과 대조해 "책임" 표시)
        hasInfo: part.length > 0, rate: part.length ? sum(mains) : null, excludedRate: sum(excls), allowanceRate: sum(allowCur),
        term: first ? (first.term || first.payTerm) : '',                       // 참여기간 (없으면 지급기간)
        overlapCount: Math.max(0, cur.filter((x) => !x.rateExcluded).length - mains.length),
        kinds: Array.from(new Set(mains.map((x) => x.kind).filter(Boolean))),
        futureRate: futureRows.length ? futureRows[0].rate : 0, infoCount: info.length, rows });
    }
    items.sort((a, b) => (b.rate || 0) - (a.rate || 0) || String(a.rspr || '').localeCompare(String(b.rspr || '')));
    const total = items.reduce((s, x) => s + (x.rate || 0), 0);
    const totalExcluded = items.reduce((s, x) => s + (x.excludedRate || 0), 0);
    return { ts: Date.now(), total: Math.round(total * 100) / 100, totalExcluded: Math.round(totalExcluded * 100) / 100, items,
      unknownCount: items.filter((x) => !x.hasInfo).length, errorCount, useId: !!useId };
  }

  /* 소수점 n자리 절사 (R&D ERP rderp.common.trunc 과 동일하게 반올림하지 않음) */
  function trunc(v, n) { const m = Math.pow(10, n || 0); return Math.trunc((Number(v) || 0) * m) / m; }
  /* 집행비율(%) = 승인액 / 예산액. R&D ERP 자금현황과 같이 둘 다 양수일 때만 계산, 소수 2자리 절사 */
  function execRate(appr, bgt) { return (bgt > 0 && appr > 0) ? trunc(appr / bgt * 100, 2) : 0; }

  /* 과제정보 > 자금현황 > 비목별 잔액
   * 예산기준 10(과제예산): rcomm_0041_01_r004 → REC[].RES_NM, MARK_EXP_NM, BGT_AMT(예산액 A), APPR_AMT(승인액 B), BAL_AMT(예산잔액 A-B), DIR_COST_YN, PSNL_COST_YN
   * 예산기준 20(본예산):   rcomm_0041_01_r006 → REC[].BGT_ITEM_NM, ATIT_NM, BGT_AMT, APPR_AMT, BAL_AMT (0건이면 과제 상세로 예산기준을 확인해 대체 호출)
   * 집행비율은 화면 스크립트(rderp_bgtAmtInfo.js)처럼 클라이언트에서 계산 */
  async function fetchBudget(prjNo, settings) {
    const adv = settings.adv || {};
    const usefac = adv.usefacSeqNo || '10';
    const base = { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo, REQ_CNT: '-1', RES_CD: '', PROC_TYP_CD: '', INCLUDE_TAX: 'Y' };
    const input = Object.assign(base, g.KRX_SETTINGS.parseJson(adv.budgetInput), { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo });
    // 비목 포함/제외: 설정 페이지에서 고른 비목(budgetItemInclude)은 그대로, 고르지 않은 비목은 기본 키워드(인건비·연구수당·간접비)가
    // 비목명/예산항목명에 들어가면 제외. 제외 비목은 합계·비율은 물론 패널 표에서도 빠짐 (공백/대소문자 무시)
    const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
    const chosen = settings.budgetItemInclude || {};
    const defKeys = (settings.budgetExcludeDefault || []).map(norm).filter(Boolean);
    const isExcluded = (exp, item) => {
      const key = String(exp || item || '').trim();
      if (key && Object.prototype.hasOwnProperty.call(chosen, key)) return chosen[key] === false;
      return defKeys.some((k) => norm(exp).includes(k) || (item && norm(item).includes(k)));
    };
    const row = (r, exp, item) => {
      const bgt = F.num(r.BGT_AMT), appr = F.num(r.APPR_AMT);
      const e = String(exp || '').trim(), it = String(item || '').trim();
      return {
        res: String(r.RES_NM || '').trim(), resCd: String(r.RES_CD || '').trim(), expCd: String(r.EXP_CD || r.BGT_ITEM_CD || '').trim(),
        exp: e, item: it,
        cary: F.num(r.CARY_AMT), inter: F.num(r.INTER_AMT), calcBgt: F.num(r.CALC_BGT_AMT),
        bgt, purch: F.num(r.PURCH_REQ_AMT), req: F.num(r.REQ_AMT), appr, adj: F.num(r.ADJ_AMT),
        bal: r.BAL_AMT == null || r.BAL_AMT === '' ? bgt - appr : F.num(r.BAL_AMT),
        rate: execRate(appr, bgt),
        dir: String(r.DIR_COST_YN || '').trim() === 'Y', psnl: String(r.PSNL_COST_YN || '').trim() === 'Y',
        excluded: isExcluded(e, it)
      };
    };
    let std = '10';
    let items = [];
    const data = await call(adv.budgetService || 'rcomm_0041_01_r004', input);
    items = (Array.isArray(data.REC) ? data.REC : []).map((r) => row(r, r.MARK_EXP_NM || r.EXP_NM || r.BGT_ITEM_NM, r.BGT_ITEM_NM));
    let detail = null;
    if (!items.length && adv.projectDetailService !== '') {
      // 본예산(20) 과제는 다른 서비스가 비목을 돌려준다. 과제 상세에서 예산기준을 확인해 대체 호출
      try { detail = await call(adv.projectDetailService || 'rcomm_0102_01_r001', { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo }); }
      catch (e) { if (e.kind === 'login') throw e; }
      if (detail && String(detail.BGT_STD_CD || '').trim() === '20') {
        std = '20';
        const yr = String(new Date().getFullYear());
        const d2 = await call(adv.budgetBaseService || 'rcomm_0041_01_r006',
          { USEFAC_SEQ_NO: usefac, PRJ_NO: prjNo, REQ_CNT: input.REQ_CNT || '-1', BIZSECTION_CD: String(detail.BIZSECTION_CD || ''), BGT_YEAR: yr });
        items = (Array.isArray(d2.REC) ? d2.REC : []).map((r) => row(r, r.BGT_ITEM_NM || r.MARK_EXP_NM, r.ATIT_NM));
      }
    }
    const sum = (k, pred) => items.reduce((s, x) => s + ((!pred || pred(x)) ? x[k] : 0), 0);
    // 합계·비율은 제외 비목을 뺀 값. 제외분은 별도 집계해 화면에 표시
    const inc = (x) => !x.excluded;
    const bgtAmt = sum('bgt', inc), apprAmt = sum('appr', inc), balAmt = sum('bal', inc);
    const exclItems = items.filter((x) => x.excluded);
    // R&D ERP 자금현황 상단 "직접비 집행비율(인건비 포함)": 직접비 또는 인건비 비목만 합산 (양쪽 모두인 비목은 한 번만). ERP 값 그대로라 제외 설정과 무관
    const dBgt = sum('bgt', (x) => x.dir || x.psnl), dAppr = sum('appr', (x) => x.dir || x.psnl);
    return {
      std, items, bgtAmt, apprAmt, balAmt,
      rate: execRate(apprAmt, bgtAmt),
      dirRate: dBgt > 0 ? trunc(dAppr / dBgt * 100, 3) : null, dirBgt: dBgt, dirAppr: dAppr,
      exclCount: exclItems.length, exclBgt: sum('bgt', (x) => x.excluded), exclAppr: sum('appr', (x) => x.excluded),
      exclNames: Array.from(new Set(exclItems.map((x) => x.exp || x.item))).filter(Boolean),
      resCount: new Set(items.map((x) => x.resCd || x.res)).size
    };
  }

  /* 카드번호 동일 여부: 전체 숫자 일치, 또는 마스킹(****)된 번호를 감안해 앞 4자리+뒤 4자리 일치 */
  function sameCard(a, b) {
    const x = F.digits(a), y = F.digits(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.slice(-4) !== y.slice(-4)) return false;
    return x.length < 13 || y.length < 13 || x.slice(0, 4) === y.slice(0, 4);
  }
  function samePrj(a, b) {
    const x = String(a || '').trim(), y = String(b || '').trim();
    if (!x || !y) return true;
    return x === y || x.startsWith(y) || y.startsWith(x);
  }

  const MEMBER_TTL = 2 * 60 * 60 * 1000;   // 참여인력 캐시 유지 시간 (2시간. 패널·팝업 ↻ 와 설정의 진단은 건너뜀)
  /* 본인 식별값: 사번/ID(설정 사번 · ERP 로그인 ID USER_ID · 자동 감지 사번은 USER_ID 와 같을 때만)와 이름(설정 이름 · ERP 자동 감지 이름). collect · diagnose 공용.
   * 이 ERP 의 사번은 USER_ID(MAND_USER_ID/gUserId)와 같다. 이전 버전 bridge 가 화면의 대상자 EMP_NO(다른 연구원 사번)를 본인 사번으로 저장한 적이 있어 USER_ID 와 다른 empNo 는 버린다 */
  function identity(settings, rndUser) {
    const u = rndUser || {};
    const userId = String(u.userId || '').trim(), empNo = String(u.empNo || '').trim();
    return {
      ids: Array.from(new Set([settings.myEmpNo, userId, (!userId || empNo === userId) ? empNo : ''].map((x) => String(x || '').trim()).filter(Boolean))),
      names: Array.from(new Set([settings.myName, u.userNm].map((x) => String(x || '').trim()).filter(Boolean)))
    };
  }
  const memberKey = (ids, names) => 'v4#' + ids.join('|') + '#' + names.join('|');   // v4: 행마다 계상률·기간·종류(구분/소득구분/지급비목)·원본 필드 포함 (이전 형식은 무시)
  /* 참여인력 목록(fetchParticipants)에서 본인 행만: 사번(EMP_NO) 일치 byId, 이름(EMP_NM) 일치 byName. 같은 사람의 계상률기준/인력기준 행, 참여기간이 다른 행은 각각 남김 (참여율 계산용) */
  function matchHits(list, myIds, myNames) {
    const seen = new Set();
    const hits = [];
    for (const x of list) {
      const byId = !!(x.empNo && myIds.includes(x.empNo));
      const byName = !!(x.empNm && myNames.includes(x.empNm));
      if (!byId && !byName) continue;
      const k = [x.empNo, x.empNm, x.src, x.term, x.rate].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      hits.push({ empNo: x.empNo, empNm: x.empNm, role: x.role, byId, byName, src: x.src, rate: x.rate, rateExcluded: x.rateExcluded, term: x.term, payTerm: x.payTerm,
        div: x.div, incm: x.incm, incmDtl: x.incmDtl, payExp: x.payExp, payAmt: x.payAmt, raw: x.raw || null });
    }
    return hits;
  }
  /* 본인 행의 참여가 끝났는지: 참여기간(없으면 지급기간)의 끝이 오늘 이전이고 그 끝이 과제(현재 연차) 시작일 이후면 중도 종료.
   * 끝이 과제 시작일보다 앞이면(지난 연차 행만 남고 이번 연차 행이 아직 안 올라온 경우) 종료로 단정하지 않는다 */
  function hitEnded(h, today, stDt) {
    const r = termRange(h.term) || termRange(h.payTerm);
    const st = F.digits(stDt).slice(0, 8);
    return !!(r && r.end && r.end < today && (!st || r.end >= st));
  }
  /* 본인 참여 여부를 과제별로 판정 (MEMBER_TTL 캐시. opts.fresh 면 캐시를 건너뛰고 모두 다시 조회 — 패널·팝업의 ↻). 사번(EMP_NO) 일치 우선, 이름(EMP_NM) 일치는 보조 */
  /* 과제별로 참여인력 중 사번(myIds) 또는 이름(myNames)이 맞는 사람 목록을 돌려준다: { [prjNo]: [{empNo, empNm, role, byId, byName}] | null(조회 실패) }
   * 참여 여부 판정(동명이인 처리 포함)은 collect()가 한다.
   * opts.stats 를 주면 { checkedAt(쓴 캐시 항목 중 가장 오래된 조회 시각, 모두 새로 조회했으면 지금), cached, fetched } 를 채운다 — 패널의 참여율 툴팁에 조회 시각 표시 */
  async function checkMembership(projects, myIds, myNames, settings, opts) {
    const fresh = !!(opts && opts.fresh), stats = (opts && opts.stats) || {};
    let cache = {};
    try { cache = (await chrome.storage.local.get('membership')).membership || {}; } catch (e) {}
    const key = memberKey(myIds, myNames);
    const now = Date.now();
    const result = {};
    const todo = [];
    let oldest = Infinity, cached = 0;
    const valid = (c) => !!(c && c.key === key && now - c.ts < MEMBER_TTL && Array.isArray(c.hits));
    for (const p of projects) {
      const c = cache[p.prjNo];
      if (!fresh && valid(c)) { result[p.prjNo] = c.hits; cached++; if (c.ts < oldest) oldest = c.ts; } else todo.push(p);
    }
    await pool(todo, 4, async (p) => {
      try {
        const hits = matchHits(await fetchParticipants(p.prjNo, settings), myIds, myNames);
        result[p.prjNo] = hits;
        cache[p.prjNo] = { hits, key, ts: now };
      } catch (e) {
        const c = cache[p.prjNo];   // 다시 조회(fresh)가 실패하면 아직 유효한 캐시값으로 대신 (없으면 조회 실패)
        if (fresh && valid(c)) { result[p.prjNo] = c.hits; if (c.ts < oldest) oldest = c.ts; } else result[p.prjNo] = null;
        stats.failed = (stats.failed || 0) + 1; stats.failMsg = describe(e).message;   // 패널 참여율 줄에 "다시 조회 실패 N건" 표시
        if (e.kind === 'login') throw e;
      }
    });
    stats.checkedAt = oldest === Infinity ? now : oldest; stats.cached = cached; stats.fetched = todo.length;
    try {
      for (const k of Object.keys(cache)) if (now - cache[k].ts > MEMBER_TTL * 4) delete cache[k];
      await chrome.storage.local.set({ membership: cache });
    } catch (e) {}
    return result;
  }

  function getPath(obj, path) {
    return String(path || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  async function fetchUnapproved(settings) {
    const u = settings.unapproved || {};
    if (!u.serviceId) return null;
    const data = await call(u.serviceId, g.KRX_SETTINGS.parseJson(u.input));
    const src = (Array.isArray(data.REC) && data.REC.length) ? data.REC[0] : data;
    const f = u.fields || {};
    const pick = (k) => (k ? F.num(getPath(src, k)) : null);
    return { source: 'live', ts: Date.now(), temp: pick(f.temp), supplement: pick(f.supplement), apply: pick(f.apply), purchase: pick(f.purchase) };
  }

  /* 받은 결재요청 = 다른 사람이 나를 결재자로 지정해 올린 건(내 결재대기). 대시보드 setApptCnt 와 같은 rmain_0002_01_r001 {USEFAC_SEQ_NO, USER_ID, DEPT_CD}
   * → USER_APPR_CNT(내 결재대기) · DEPT_APPR_CNT(부서 결재대기) · NOTI_PROC_CNT(알림). USER_APPR_CNT 는 DEPT_CD 없이도 같은 값(2026-09-25 CDP 확인). 건이 있으면 개인결재함(rappr_0002_01)
   * 결재대기함 목록 rappr_0001_01_r015 를 화면 uf_setParam() 과 같은 입력(APPRBOX_GB 2 결재대기함, 신청일 최근 1개월)으로 받아 행을 돌려준다. 사번(USER_ID)을 모르면 null */
  async function fetchInbox(settings, rndUser) {
    const userId = String((rndUser && rndUser.userId) || settings.myEmpNo || '').trim();
    if (!userId) return null;
    const usefac = String((settings.adv && settings.adv.usefacSeqNo) || '10');
    const cnt = await call('rmain_0002_01_r001', { USEFAC_SEQ_NO: usefac, USER_ID: userId, DEPT_CD: String((rndUser && rndUser.deptCd) || '') });
    const out = { ts: Date.now(), mine: F.num(cnt.USER_APPR_CNT), dept: F.num(cnt.DEPT_APPR_CNT), noti: F.num(cnt.NOTI_PROC_CNT), items: [], itemsError: null };
    if ((out.mine || 0) > 0) {
      try {
        const ymd = (d) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
        const to = new Date(), fr = new Date(); fr.setMonth(fr.getMonth() - 1);
        const d = await call('rappr_0001_01_r015', { APPRBOX_GB: '2', APPR_USER_GB: '2', DRAFT_FR_DT: ymd(fr), DRAFT_TO_DT: ymd(to), PROC_TYP_CD: '', SEARCH_TYP_CD: '1', SEARCH_NM: '', PRJ_CARD_DIV_CD: '', PRJ_RSPR_CNFM_YN: '',
          PRIVATE_APPR_YN: 'N', ACPT_YN: '', AUDIT_DIV_CD: '', DATE_GB1: '2', START_DATE: '', END_DATE: '', APPR_STS: '', EXP_DOC_TYP_CD: '', NTAX_PRJ_YN: '', SKIP_REC: [], PAY_WORK_EXCEPT: 'N' });
        out.items = (Array.isArray(d.REC) ? d.REC : []).map((r) => ({
          docNo: String(r.DOC_NO || ''), procTyp: String(r.PROC_TYP_NM || ''), prjNm: String(r.PRJ_NM || ''), prjRspr: String(r.PRJ_RSPR_EMP_NM || ''), amount: F.num(r.REQ_AMT),
          cont: String(r.APPL_CONT || ''), draftUser: String(r.DRAFT_USER_NM || ''), draftDate: String(r.DRAFT_DATE || ''), status: String(r.APPR_STS_NM || ''), expStatus: String(r.EXP_APPR_STS_NM || ''), dept: String(r.DEPT_NM || ''), online: String(r.ONLINE_APPR_NM || '') }));
      } catch (e) { out.itemsError = describe(e).message; }
    }
    return out;
  }

  /* 거래 고유 키: 같은 카드·같은 날·같은 승인번호·같은 금액이면 같은 승인 (시각은 무시). 승인번호가 없으면 시각까지 비교 */
  const txKey = (c) => {
    const appr = String(c.apprNo || '').trim();
    return appr ? [F.digits(c.cardNo), c.usedDate, appr, c.amount].join('|')
                : [F.digits(c.cardNo), c.usedDate, c.usedTime, '', c.amount].join('|');
  };

  /* 취소쌍 / 중복의심 표시 */
  function flagTxs(txs) {
    const pairKey = new Map();
    for (const t of txs) {
      const k = [F.digits(t.cardNo), t.usedDate, t.usedTime, Math.abs(t.amount)].join('|');
      if (!pairKey.has(k)) pairKey.set(k, []);
      pairKey.get(k).push(t);
    }
    let cancelPairs = 0;
    for (const arr of pairKey.values()) {
      const pos = arr.filter((t) => t.amount > 0), neg = arr.filter((t) => t.amount < 0);
      const n = Math.min(pos.length, neg.length);
      for (let i = 0; i < n; i++) { pos[i].cancelled = true; neg[i].cancel = true; cancelPairs++; }
    }
    const byCard = new Map();
    for (const t of txs) { const d = F.digits(t.cardNo); if (!byCard.has(d)) byCard.set(d, []); byCard.get(d).push(t); }
    let dupSuspects = 0;
    for (const arr of byCard.values()) {
      arr.sort((a, b) => (a.usedDate + a.usedTime).localeCompare(b.usedDate + b.usedTime));
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          if (a.amount <= 0 || a.cancelled || b.cancelled || b.amount !== a.amount) continue;
          const gap = Math.abs(F.toTime(b.usedDate, b.usedTime) - F.toTime(a.usedDate, a.usedTime));
          if (!(gap <= 10 * 60000)) break;
          if (a.shop === b.shop) { a.dupSuspect = true; b.dupSuspect = true; dupSuspects++; }
        }
      }
    }
    return { cancelPairs, dupSuspects };
  }

  /* 거래 목록 → 카드 단위 묶음 */
  function groupByCard(txs) {
    const cardMap = new Map();
    for (const t of txs) {
      const d = F.digits(t.cardNo);
      let card = cardMap.get(d);
      if (!card) { card = { digits: d, tail: t.tail, user: t.user, cardDiv: t.cardDiv, projects: [], txs: [], count: 0, amount: 0 }; cardMap.set(d, card); }
      for (const pr of t.projects) if (!card.projects.some((x) => x.prjNo === pr.prjNo)) card.projects.push(pr);
      card.txs.push(t); card.count++; card.amount += t.amount;
    }
    const cards = Array.from(cardMap.values());
    for (const card of cards) card.txs.sort((a, b) => (b.usedDate + b.usedTime).localeCompare(a.usedDate + a.usedTime));
    cards.sort((a, b) => b.count - a.count || b.amount - a.amount);
    return cards;
  }

  /* 전체 수집. 예외를 던지지 않고 결과 객체에 오류를 담아 반환
   * opts.freshMembership: 참여인력(계상률) 캐시(MEMBER_TTL)를 건너뛰고 모두 다시 조회 (패널·팝업의 ↻, 설정의 과제 목록 다시 불러오기) */
  async function collect(settings, opts) {
    const adv = settings.adv || {};
    const memberStats = {};
    const memberOpts = { fresh: !!(opts && opts.freshMembership), stats: memberStats };
    const showShared = !!settings.showShared;
    const out = {
      ts: Date.now(), loginRequired: false, error: null,
      projects: [], totalCount: 0, totalAmount: 0, sumCount: 0, sumAmount: 0, projectCount: 0, excludedCount: 0, truncatedCount: 0,
      issued: [], projectList: [], myIds: [], myNames: [], memberFilter: 'off', notMemberCount: 0, endedCount: 0, nameCandidates: [],   // endedCount: 본인 행은 있지만 참여기간이 끝나 제외된 과제 수
      cards: [], unattributed: [], unattributedCount: 0, unattributedAmount: 0, cancelPairs: 0, dupSuspects: 0,
      unapproved: null, unapprovedError: null, unapprovedSnapshot: null,
      inbox: null, inboxError: null,   // 받은 결재요청(내 결재대기 건수 + 결재대기함 행) — fetchInbox
      settings: {
        cardFilterMode: settings.cardFilterMode, cardFilterList: settings.cardFilterList || [],
        selectedCards: settings.selectedCards || [], cardNames: settings.cardNames || {},
        monthsBack: settings.monthsBack, monthsForward: settings.monthsForward,
        hideZeroProjects: settings.hideZeroProjects, rndUrl: settings.rndUrl,
        accountRule: settings.accountRule !== false, showShared,
        unapprovedLinkUrl: (settings.unapproved && settings.unapproved.linkUrl) || settings.rndUrl,
        unapprovedConfigured: !!(settings.unapproved && settings.unapproved.serviceId),
        quickPicks: (settings.claimHelper && settings.claimHelper.quickPicks) || [],   // 예상 비용 세목 자동완성 · 청구 준비의 청구종류 목록 (청구서 세목 빠른 선택 표시이름)
        claimHelperOn: !(settings.claimHelper && settings.claimHelper.enabled === false),   // 꺼져 있으면 패널의 청구 준비 줄도 숨김 (청구서에서 적용되지 않으므로)
        hr: Object.assign({}, (g.KRX_SETTINGS.DEFAULTS.hr || {}), settings.hr || {})   // 급여·연구수당 구역 (항목명 · 직급 · 한도 비율 · 링크)
      },
      hrPay: null,   // HR 급여명세서 수집값 (storage.local.hrPay, content/hr-pay.js 가 저장)
      participation: null, participationError: null,   // 과제 참여율 요약 (summarizeParticipation)
      membershipCheckedAt: null   // 참여인력(계상률) 조회 시각 — 캐시(MEMBER_TTL)라 ts 보다 오래될 수 있음 (checkMembership stats.checkedAt)
    };
    try { out.unapprovedSnapshot = (await chrome.storage.local.get('unapprovedSnapshot')).unapprovedSnapshot || null; } catch (e) {}
    try { out.hrPay = (await chrome.storage.local.get('hrPay')).hrPay || null; } catch (e) {}

    let projects;
    try { projects = await fetchProjects(settings); }
    catch (e) {
      const d = describe(e);
      if (d.kind === 'login') out.loginRequired = true; else out.error = d.message;
      return out;
    }
    out.projectCount = projects.length;
    out.prjNos = projects.map((p) => p.prjNo);   // 진단용: 이번 조회의 과제 목록(진행상태 필터 뒤 · 참여 판정 전) 번호만
    out.projectListCapped = !!projects.capped;   // 과제 목록 서비스가 500건에서 잘려 진행 과제만 다시 받아 합친 조회였는지

    // 본인이 참여인력(참여연구원/과제책임자)에 있는 과제만. 사번/이름을 모르면 과제를 표시하지 않음
    let rndUser = null;
    try { rndUser = (await chrome.storage.local.get('rndUser')).rndUser || null; } catch (e) {}
    ({ ids: out.myIds, names: out.myNames } = identity(settings, rndUser));
    let partHits = null, partUseId = false, partOk = false;   // 과제 참여율 요약용 (참여인력 조회 결과 재사용)
    if (settings.onlyMyProjects) {
      if (!out.myIds.length && !out.myNames.length) {
        out.memberFilter = 'no-id';
        out.notMemberCount = projects.length;
        projects = [];
      } else {
        out.memberFilter = 'applied';
        try {
          const hits = await checkMembership(projects, out.myIds, out.myNames, settings, memberOpts);   // 조회한 모든 과제(진행, 최대 500건)에서 참여 여부 확인 — 상한 없음
          const hitsOf = (p) => hits[p.prjNo];
          // 참여기간이 오늘 이전에 끝난(중도 종료) 행은 현재 참여로 보지 않음 (hitEnded). 과제 시작일보다 앞서 끝난 지난 연차 행은 그대로 둔다
          const today = F.ymd(new Date());
          const live = (p) => (hitsOf(p) || []).filter((h) => !hitEnded(h, today, p.stDt));
          // 사번이 참여인력 EMP_NO 와 실제로 맞는 과제가 하나라도 있으면 사번만 믿는다 (이름은 동명이인 위험)
          const idWorks = projects.some((p) => (hitsOf(p) || []).some((h) => h.byId));
          // 이름으로 맞은 사람들을 사번별로 모음 → 둘 이상이면 동명이인
          const byEmp = new Map();
          for (const p of projects) {
            for (const h of hitsOf(p) || []) {
              if (!h.byName) continue;
              const k = h.empNo || ('?' + h.empNm);
              if (!byEmp.has(k)) byEmp.set(k, { empNo: h.empNo, empNm: h.empNm, roles: new Set(), projects: [] });
              const c = byEmp.get(k);
              if (h.role) c.roles.add(h.role);
              c.projects.push({ prjNo: p.prjNo, prjNm: p.prjNm, rspr: p.rspr });
            }
          }
          out.nameCandidates = Array.from(byEmp.values()).map((c) => ({ empNo: c.empNo, empNm: c.empNm, roles: Array.from(c.roles), projects: c.projects }));
          let isMember;
          if (idWorks) {
            isMember = (p) => live(p).some((h) => h.byId);
          } else if (byEmp.size > 1) {
            // 동명이인: 어느 쪽인지 고를 수 있게 후보만 넘기고 과제는 표시하지 않음
            out.memberFilter = 'ambiguous';
            isMember = () => false;
          } else {
            isMember = (p) => live(p).length > 0;
          }
          const kept = projects.filter((p) => hitsOf(p) === null || hitsOf(p) === undefined ? true : isMember(p));   // 조회 실패한 과제는 남김 (기존 동작)
          // 본인 행은 있는데 참여기간이 끝나 빠진 과제 (헤더 "참여 종료 N 제외"). 미참여 수에서는 뺀다
          out.endedCount = projects.filter((p) => Array.isArray(hitsOf(p)) && !isMember(p) && (idWorks ? hitsOf(p).some((h) => h.byId) : hitsOf(p).length > 0)).length;
          out.notMemberCount = projects.length - kept.length - out.endedCount;
          projects = kept;
          partHits = hits; partUseId = idWorks; partOk = out.memberFilter !== 'ambiguous';
        } catch (e) {
          if (e.kind === 'login') { out.loginRequired = true; return out; }
          out.error = describe(e).message;
          projects = [];
        }
      }
    }
    out.projectList = projects.map((p) => ({ prjNo: p.prjNo, prjNm: p.prjNm, rspr: p.rspr, anl: p.anl, status: p.status, stDt: p.stDt, endDt: p.endDt }));
    const excluded = new Set((settings.excludedProjects || []).map((x) => String(x).trim()));
    if (excluded.size) {
      const kept = projects.filter((p) => !excluded.has(p.prjNo));
      out.excludedCount = projects.length - kept.length;
      projects = kept;
    }
    // 조회 과제 최대 수: "내 참여 과제만 보기"에서는 적용하지 않는다 — 조회한 모든 과제에서 참여 여부를 확인하고, 참여 중인 과제는 모두 보여 준다.
    // 꺼져 있을 때(모든 과제 표시)만 적용하며 잘린 수는 헤더에 표시 (truncatedCount)
    if (out.memberFilter !== 'applied') {
      const max = Math.max(1, F.num(settings.maxProjects) || 30);
      out.truncatedCount = Math.max(0, projects.length - max);
      projects = projects.slice(0, max);
    }

    // 과제 참여율: 표시할 과제의 참여인력(계상률기준)에서 본인 계상률을 모아 합계. "내 참여 과제만 보기"가 켜져 있으면 그 판정에 쓴 조회 결과를 재사용하고,
    // 꺼져 있으면 표시할 과제만 참여인력을 조회한다 (MEMBER_TTL 캐시). 사번/이름을 모르거나 동명이인이면 계산하지 않음
    try {
      if (!partHits && (out.myIds.length || out.myNames.length) && projects.length && out.memberFilter !== 'ambiguous') {
        partHits = await checkMembership(projects, out.myIds, out.myNames, settings, memberOpts);
        partUseId = projects.some((p) => (partHits[p.prjNo] || []).some((h) => h.byId));
        partOk = true;
      }
      if (partHits) out.membershipCheckedAt = memberStats.checkedAt || null;
      out.membershipFailed = memberStats.failed || 0; out.membershipFailMsg = memberStats.failMsg || '';   // 다시 조회(↻)가 실패해 이전 값을 쓴 과제 수
      if (partHits && partOk) out.participation = summarizeParticipation(projects, partHits, partUseId);
    } catch (e) {
      const d = describe(e);
      if (d.kind === 'login') out.loginRequired = true; else out.participationError = d.message;
    }

    const filterList = [].concat(settings.selectedCards || [], settings.cardFilterList || []);
    const useFilter = settings.cardFilterMode === 'specific' && filterList.length > 0;
    const accountRule = settings.accountRule !== false;
    const expCd = String(adv.expenseAcctDivCd || '').trim();
    const overrides = settings.cardOverrides || {};

    await pool(projects, 3, async (p) => {
      // 1) 과제 계좌 (지출계좌)
      p.accounts = []; p.acctError = null;
      if (accountRule) {
        try { p.accounts = await fetchAccounts(p.prjNo, settings); }
        catch (e) { p.acctError = describe(e).message; if (e.kind === 'login') out.loginRequired = true; }
      }
      const expPool = expCd ? p.accounts.filter((a) => a.divCd === expCd) : p.accounts;
      const acctSet = new Set((expPool.length ? expPool : p.accounts).map((a) => a.acctNo).filter(Boolean));
      p.expenseAccts = (expPool.length ? expPool : p.accounts).filter((a) => a.acctNo).map((a) => ({ bank: a.bank, acctNo: a.acctNoRaw || a.acctNo, divCd: a.divCd, divNm: a.divNm, owner: a.owner }));
      // 2) 발급 카드 + 귀속 판정 (계좌번호 일치 → 이 과제 카드, 설정 재정의 반영)
      try { p.issued = await fetchIssuedCards(p.prjNo, settings); }
      catch (e) { p.issued = []; p.issuedError = describe(e).message; if (e.kind === 'login') out.loginRequired = true; }
      const ov = overrides[p.prjNo] || {};
      const inc = new Set((ov.include || []).map(F.digits)), exc = new Set((ov.exclude || []).map(F.digits));
      for (const c of p.issued) {
        c.acctMatch = acctSet.size ? acctSet.has(c.acctNo) : null;   // null = 계좌 정보 없음(판정 불가)
        c.included = exc.has(c.digits) ? false : (inc.has(c.digits) ? true : (c.acctMatch === null ? true : c.acctMatch));
      }
      const ownNos = p.issued.filter((c) => c.included).map((c) => c.cardNo);
      p.issuedCount = p.issued.length;
      p.ownCount = ownNos.length;
      p.acctKnown = acctSet.size > 0;
      // 3) 카드 사용내역(미청구) → 이 과제 카드의 거래만 남기고, 나머지는 미귀속 후보로
      p.foreign = [];
      try {
        const raw = await fetchCards(p.prjNo, settings);
        p.rawCount = raw.length;
        let cards = raw.filter((c) => samePrj(c.prjNo, p.prjNo));
        if (p.issued.length && cards.length) {
          const anyIssuedMatch = cards.some((c) => p.issued.some((i) => sameCard(i.cardNo, c.cardNo)));
          if (!anyIssuedMatch) {
            p.matchNote = '발급 카드번호와 대조되지 않아 사용내역을 그대로 표시합니다.';
          } else {
            const own = [], other = [];
            for (const c of cards) (ownNos.some((n) => sameCard(n, c.cardNo)) ? own : other).push(c);
            cards = own; p.foreign = other;
          }
        }
        p.otherCards = raw.length - cards.length;
        const before = cards.length;
        if (useFilter) cards = cards.filter((c) => F.matchCard(c.cardNo, filterList));
        p.filteredByCard = before - cards.length;
        p.cards = cards;
      } catch (e) {
        const d = describe(e);
        p.error = d.message; p.cards = [];
        if (d.kind === 'login') out.loginRequired = true;
      }
      p.count = p.cards.length;
      p.amount = p.cards.reduce((s, c) => s + c.amount, 0);
      // 4) 자금현황 > 비목별 잔액 (과제집행비율 보기용). 실패해도 카드 내역에는 영향 없음
      p.budget = null; p.budgetError = null;
      if (adv.budgetService !== '') {
        try { p.budget = await fetchBudget(p.prjNo, settings); }
        catch (e) { const d = describe(e); p.budgetError = d.message; if (d.kind === 'login') out.loginRequired = true; }
      }
    });

    // 설정 페이지용: 과제별 발급 카드 + 계좌 정보 (귀속 판정 결과 포함)
    out.issued = projects.map((p) => ({
      prjNo: p.prjNo, prjNm: p.prjNm, rspr: p.rspr, cards: p.issued || [], error: p.issuedError || null,
      accounts: p.expenseAccts || [], acctError: p.acctError || null, acctKnown: !!p.acctKnown
    }));
    for (const p of projects) { delete p.issued; delete p.issuedError; delete p.accounts; delete p.acctError; }

    // 과제 안 완전 중복 제거
    for (const p of projects) {
      const seen = new Set();
      p.cards = p.cards.filter((c) => { const k = txKey(c); if (seen.has(k)) return false; seen.add(k); return true; });
      p.count = p.cards.length;
      p.amount = p.cards.reduce((s, c) => s + c.amount, 0);
    }
    // 귀속 거래 고유 집계 (두 과제가 같은 계좌를 쓰면 같은 거래가 양쪽에 귀속될 수 있음 → 공용 표시)
    const txMap = new Map();
    for (const p of projects) {
      for (const c of p.cards) {
        const k = txKey(c);
        let t = txMap.get(k);
        if (!t) { t = Object.assign({}, c, { projects: [] }); txMap.set(k, t); }
        if (!t.projects.some((x) => x.prjNo === p.prjNo)) t.projects.push({ prjNo: p.prjNo, rspr: p.rspr, prjNm: p.prjNm });
      }
    }
    // 미귀속 거래: 어느 과제에도 귀속되지 않은 카드의 거래 (연결된 과제 목록과 함께)
    const unMap = new Map();
    for (const p of projects) {
      for (const c of p.foreign || []) {
        const k = txKey(c);
        if (txMap.has(k)) continue;
        let t = unMap.get(k);
        if (!t) { t = Object.assign({}, c, { projects: [] }); unMap.set(k, t); }
        if (!t.projects.some((x) => x.prjNo === p.prjNo)) t.projects.push({ prjNo: p.prjNo, rspr: p.rspr, prjNm: p.prjNm });
      }
      delete p.foreign;
    }
    const attributed = Array.from(txMap.values());
    const unattributed = Array.from(unMap.values());
    const f1 = flagTxs(attributed);
    const f2 = flagTxs(unattributed);
    out.cancelPairs = f1.cancelPairs; out.dupSuspects = f1.dupSuspects;
    for (const p of projects) {
      for (const c of p.cards) {
        const t = txMap.get(txKey(c));
        c.shared = t.projects.length > 1;
        c.linked = t.projects.map((x) => x.rspr || x.prjNo);
        c.cancelled = !!t.cancelled; c.cancel = !!t.cancel; c.dupSuspect = !!t.dupSuspect;
      }
      // 과제집행비율 보기: 이 과제 카드의 미청구액(공용 거래 제외)을 아직 승인되지 않은 집행으로 보고 비율에 반영
      const own = p.cards.filter((c) => !c.shared);
      p.unbilledOwn = own.reduce((s, c) => s + c.amount, 0);
      p.unbilledOwnCount = own.length;
      p.unbilledShared = p.cards.length - own.length;
      if (p.budget) {
        const b = p.budget;
        b.unbilled = p.unbilledOwn;
        b.unbilledCount = p.unbilledOwnCount;
        b.execAmt = b.apprAmt + b.unbilled;                     // 승인액 + 미청구액
        b.balAfter = b.balAmt - b.unbilled;                     // 예산잔액 - 미청구액
        b.rateAll = execRate(b.execAmt, b.bgtAmt);              // (승인액 + 미청구액) / 예산액
        b.unbilledRate = b.bgtAmt > 0 && b.unbilled > 0 ? trunc(b.unbilled / b.bgtAmt * 100, 2) : 0;
      }
    }
    for (const t of unattributed) { t.shared = t.projects.length > 1; t.linked = t.projects.map((x) => x.rspr || x.prjNo); }
    out.cards = groupByCard(attributed);
    out.unattributedCount = unattributed.length;
    out.unattributedAmount = unattributed.reduce((s, t) => s + t.amount, 0);
    out.unattributed = showShared ? groupByCard(unattributed) : [];
    out.unattributedCancelPairs = f2.cancelPairs;

    // 0건 과제 숨김(hideZeroProjects)은 카드미청구 보기에서만 적용하므로 렌더러가 처리. 과제집행비율 보기는 전체 과제를 표시
    out.projects = projects;
    out.sumCount = projects.reduce((s, p) => s + p.count, 0);
    out.sumAmount = projects.reduce((s, p) => s + p.amount, 0);
    out.totalCount = attributed.length;
    out.totalAmount = attributed.reduce((s, t) => s + t.amount, 0);

    try { out.unapproved = await fetchUnapproved(settings); }
    catch (e) { out.unapprovedError = describe(e).message; }
    try { out.inbox = await fetchInbox(settings, rndUser); }
    catch (e) { out.inboxError = describe(e).message; }
    return out;
  }

  /* 진단: 과제번호 또는 과제명 일부(query)로 과제를 찾아 확장이 쓰는 서비스들을 그대로 호출해 원본 응답을 돌려주고,
   * 그 과제가 패널에 보이지 않는(또는 보이는) 이유를 why[] 로 정리한다 — 과제 검색 목록 유무 · 진행상태 키워드 · 설정 제외 · 참여인력(계속)의 본인 사번/이름 행.
   * found: 이름이 맞는 과제들(진행상태 포함), prjNo: 그중 진단한 과제 (번호가 정확히 맞는 것 → 첫 번째) */
  async function diagnose(query, settings) {
    query = String(query || '').trim();
    const out = { query, prjNo: '', ts: Date.now(), steps: [], found: [], why: [] };
    const step = async (name, service, input, parser) => {
      const s = { name, service, input };
      try {
        const data = await call(service, input);
        s.keys = Object.keys(data || {});
        const recs = Array.isArray(data.REC) ? data.REC : (Array.isArray(data.INFO_REC) ? data.INFO_REC : []);
        s.count = recs.length;
        s.sample = recs.slice(0, 5);
        if (data.HM_PER_REC) { s.hmPerCount = data.HM_PER_REC.length; s.hmPerSample = data.HM_PER_REC.slice(0, 5); }
        if (parser) s.parsed = parser(data);
      } catch (e) { s.error = describe(e); }
      out.steps.push(s);
    };
    const adv = settings.adv || {};
    const range = dateRange(settings);
    const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
    const q = norm(query);
    const isMatch = (r) => !!q && (String(r.PRJ_NO || '').trim() === query || norm(r.PRJ_NM).includes(q));
    const s0 = { name: '과제 목록', service: adv.projectsService || 'rcomm_0009_01_r001' };   // 패널과 같은 조회 (fetchProjectRecs: 500건 절단이면 진행만 다시 받아 합침)
    try {
      const pr = await fetchProjectRecs(settings);
      s0.calls = pr.calls; s0.capped = pr.capped; s0.count = pr.recs.length; s0.sample = pr.recs.slice(0, 3);
      const byNo = new Map();   // 같은 과제번호의 연차 행은 ANL 이 큰 것 하나 (fetchProjects 와 같은 규칙)
      for (const r of pr.recs) { if (!isMatch(r)) continue; const no = String(r.PRJ_NO || '').trim(); const prev = byNo.get(no); if (!prev || F.num(r.ANL) >= F.num(prev.ANL)) byNo.set(no, r); }
      out.found = Array.from(byNo.values()).map((r) => ({ PRJ_NO: String(r.PRJ_NO).trim(), ANL: r.ANL, PRJ_NM: r.PRJ_NM, PRJ_RSPR_EMP_NM: r.PRJ_RSPR_EMP_NM, PROG_STS_NM: r.PROG_STS_NM, RCH_ST_DT: r.RCH_ST_DT, RCH_END_DT: r.RCH_END_DT }));
      s0.parsed = { total: pr.recs.length, capped: pr.capped, matchingPrj: out.found };
      if (pr.firstErr && !pr.recs.length) s0.error = describe(pr.firstErr);
    } catch (e) { s0.error = describe(e); }
    out.steps.push(s0);
    // 참고: 과제권한 1(본인과제)·진행 조회 — 참여 과제 판정에 쓸 수 있는지 보기 위한 실측 (패널은 아직 쓰지 않음)
    await step('과제 목록(권한 1 본인과제 · 진행)', adv.projectsService || 'rcomm_0009_01_r001',
      Object.assign({ SEARCH_NM: '', SEARCH_GB: '10', GUBUN: 'A', PRJ_AUTH: '1' }, g.KRX_SETTINGS.parseJson(adv.projectsInput), { SEARCH_GB: '10', PRJ_AUTH: '1' }),
      (d) => ({ total: (d.REC || []).length, hasQuery: (d.REC || []).some(isMatch), prjNos: Array.from(new Set((d.REC || []).map((r) => String(r.PRJ_NO || '').trim()))).slice(0, 60) }));
    const prj = out.found.find((r) => r.PRJ_NO === query) || out.found[0] || null;
    const prjNo = out.prjNo = prj ? prj.PRJ_NO : '';
    if (!q) out.why.push('과제번호나 과제명 일부를 입력하세요.');
    else if (!prj) {
      const s = out.steps[0] || {};
      if (s.error) out.why.push(`과제 목록 조회 실패: ${s.error.message} — 로그인 세션을 확인하세요.`);
      else out.why.push(`과제 검색 목록 ${s.count || 0}건에 "${query}" 과제가 없습니다${s.capped ? ' (전체 조회가 500건에서 잘려 진행 과제만 따로 받아 합친 결과)' : ''} — R&D ERP 과제 검색 팝업(과제책임자/과제명)에서 진행상태 "진행"으로 검색해 보이는지 확인하세요.`);
    } else {
      if (out.steps[0] && out.steps[0].capped) out.why.push(`과제 목록 조회가 500건에서 잘려 진행 과제만 따로 받아 합쳤습니다 (총 ${out.steps[0].count}건).`);
      const s1 = out.steps.find((s) => /권한 1/.test(s.name));
      if (s1 && s1.parsed) out.why.push(`참고: 과제권한 1(본인과제)·진행 조회는 ${s1.parsed.total}건이고 이 과제를 ${s1.parsed.hasQuery ? '포함합니다' : '포함하지 않습니다'} — 참여 과제 판정에 쓸 수 있는지 확인용.`);
      if (out.found.length > 1) out.why.push(`"${query}" 에 맞는 과제 ${out.found.length}건 중 ${prj.PRJ_NO} (${prj.PRJ_NM}) 로 진단합니다. 다른 과제는 found 참고.`);
      const kw = String(settings.projectStatusKeyword == null ? '진행' : settings.projectStatusKeyword).trim();
      if (kw && !String(prj.PROG_STS_NM || '').includes(kw)) out.why.push(`진행상태 "${prj.PROG_STS_NM || ''}" 에 "${kw}" 가 없어 과제 목록에서 제외됩니다 — 설정 "과제 진행상태 키워드"를 비우거나 바꾸면 조회합니다.`);
      if ((settings.excludedProjects || []).map((x) => String(x).trim()).includes(prjNo)) out.why.push('설정 "과제 선택"에서 제외한 과제입니다.');
    }
    if (prjNo) {
      await step('과제관리계좌(기본정보)', adv.accountsService || 'rtask_0010_02_r003', { PRJ_NO: prjNo, USEFAC_SEQ_NO: adv.usefacSeqNo || '10' },
        (d) => ({ accounts: (d.REC || []).map((r) => ({ MNG_ACCT_DIV_CD: r.MNG_ACCT_DIV_CD, MNG_BNK_NM: r.MNG_BNK_NM, MNG_ACCT_NO: r.MNG_ACCT_NO, MNG_ACCT_BNK_NM: r.MNG_ACCT_BNK_NM, RES_NM: r.RES_NM, ACCT_NICK_NM: r.ACCT_NICK_NM })) }));
      await step('과제카드발급내역', adv.issuedService || 'rtask_0008_t01_01_r002',
        Object.assign({ USEFAC_SEQ_NO: adv.usefacSeqNo || '10', PRJ_NO: prjNo, SEARCH_GB: '1', CARD_DATE_GBN: '1', CARD_NO: '' }, range),
        (d) => ({ cards: (d.REC || []).map((r) => ({ tail: F.cardTail(r.CARD_NO, 8), USER_NM: r.USER_NM, PRJ_CARD_DIV_NM: r.PRJ_CARD_DIV_NM, BNK_NM: r.BNK_NM, ACCT_NO: r.ACCT_NO, PRJ_NO: r.PRJ_NO })) }));
      await step('카드 사용내역(미청구)', adv.cardsService || 'rtask_0008_t05_01_r001',
        Object.assign({ USEFAC_SEQ_NO: adv.usefacSeqNo || '10', PRJ_NO: prjNo, SEARCH_GB: '1', CARD_DATE_GBN: '1', CARD_NO: '' }, range, g.KRX_SETTINGS.parseJson(adv.cardsInput), { PRJ_NO: prjNo }),
        (d) => ({ cards: (d.REC || []).map((r) => ({ tail: F.cardTail(r.CARD_NO, 8), USER_NM: r.USER_NM, USED_DATE: r.USED_DATE, USED_TIME: r.USED_TIME, APPRNO: r.APPRNO, SHOP_NAME: r.SHOP_NAME, USED_COST: r.USED_COST, PRJ_NO: r.PRJ_NO })).slice(0, 20) }));
      await step('참여인력', adv.participantsService || 'rtask_0008_t03_01_r001',
        Object.assign({ SEARCH_NM: '', SEARCH_GB: '1' }, g.KRX_SETTINGS.parseJson(adv.participantsInput), { PRJ_NO: prjNo }),
        (d) => ({ people: [].concat((d.INFO_REC || []).map((r) => Object.assign({ SRC: 'INFO(계상률기준)' }, r)), (d.HM_PER_REC || []).map((r) => Object.assign({ SRC: 'HM(인력기준)' }, r)))
          .map((r) => ({ SRC: r.SRC, EMP_NO: r.EMP_NO, EMP_NM: r.EMP_NM, ROLE_NM: r.ROLE_NM, BLNG_YN: r.BLNG_YN, PART_HM_DIV_NM: r.PART_HM_DIV_NM, PART_TRM_DT_DTL: r.PART_TRM_DT_DTL, PART_TRM_DT: r.PART_TRM_DT, PART_RT: r.PART_RT, PARTRATE_YN: r.PARTRATE_YN, PAY_AMT: r.PAY_AMT, PAY_LIMT_AMT: r.PAY_LIMT_AMT })) }));
      await step('과제 상세(예산기준)', adv.projectDetailService || 'rcomm_0102_01_r001', { USEFAC_SEQ_NO: adv.usefacSeqNo || '10', PRJ_NO: prjNo },
        (d) => ({ BGT_STD_CD: d.BGT_STD_CD, PRJ_CATE_CD: d.PRJ_CATE_CD, BIZSECTION_CD: d.BIZSECTION_CD, TOT_DIR_AMT: d.TOT_DIR_AMT, TOT_STD_AMT: d.TOT_STD_AMT }));
      await step('비목별 잔액(자금현황)', adv.budgetService || 'rcomm_0041_01_r004',
        Object.assign({ USEFAC_SEQ_NO: adv.usefacSeqNo || '10', PRJ_NO: prjNo, REQ_CNT: '-1', RES_CD: '', PROC_TYP_CD: '', INCLUDE_TAX: 'Y' }, g.KRX_SETTINGS.parseJson(adv.budgetInput), { PRJ_NO: prjNo }),
        (d) => ({ items: (d.REC || []).map((r) => ({ RES_NM: r.RES_NM, MARK_EXP_NM: r.MARK_EXP_NM, BGT_AMT: r.BGT_AMT, APPR_AMT: r.APPR_AMT, BAL_AMT: r.BAL_AMT, DIR_COST_YN: r.DIR_COST_YN, PSNL_COST_YN: r.PSNL_COST_YN, BGT_ITEM_NM: r.BGT_ITEM_NM })) }));
      const s = { name: '비목별 잔액 취합', service: '(fetchBudget)' };
      try { s.parsed = await fetchBudget(prjNo, settings); } catch (e) { s.error = describe(e); }
      out.steps.push(s);
    }
    try { out.rndUser = (await chrome.storage.local.get('rndUser')).rndUser || null; } catch (e) {}
    out.myEmpNo = settings.myEmpNo || '';
    // 참여인력(계속)에 본인 행이 있는지 — collect() 와 같은 기준(identity · matchHits · hitEnded). 확장의 참여인력 캐시(storage.local.membership)와도 비교해
    // 캐시가 묵어 패널에 옛 값이 보였던 것인지 밝히고, 이 과제의 캐시는 지금 조회값으로 바꿔 둔다 (다음 자동 갱신 또는 ↻ 에서 반영)
    if (prjNo) {
      const { ids, names } = identity(settings, out.rndUser);
      const ps = out.steps.find((s) => s.name === '참여인력');
      const today = F.ymd(new Date());
      if (ps && ps.error) out.why.push(`참여인력 조회 실패: ${ps.error.message}`);
      else if (!ids.length && !names.length) out.why.push('본인 사번/이름을 아직 몰라 참여 여부를 판정할 수 없습니다 — R&D ERP 를 한 번 열거나 설정에 사번을 입력하세요.');
      else {
        let list = [];
        try { list = await fetchParticipants(prjNo, settings); } catch (e) { list = []; }
        const hits = matchHits(list, ids, names);
        const pick = (hs) => { const b = hs.filter((h) => h.byId); return b.length ? b : hs; };   // 사번 일치 행이 있으면 그것만 (collect 의 idWorks 규칙)
        const mine = pick(hits), byId = hits.some((h) => h.byId);
        const live = mine.filter((h) => !hitEnded(h, today, prj && prj.RCH_ST_DT));
        const fmt = (h) => (h.src === 'info' ? `계상률 ${h.rate == null ? '-' : h.rate + '%'}` : '인력기준') + (h.payTerm ? ` · 지급기간 ${h.payTerm}` : '') + (h.term && h.term !== h.payTerm ? ` · 참여기간 ${h.term}` : '');
        let cache = {}, c = null;
        try { cache = (await chrome.storage.local.get('membership')).membership || {}; c = cache[prjNo] || null; } catch (e) {}
        const key = memberKey(ids, names);
        out.member = { ids, names, key, fresh: hits, cached: c ? { ts: c.ts, key: c.key, hits: c.hits } : null };
        const ru = out.rndUser || {};
        const dropped = !!(ru.empNo && ru.userId && String(ru.empNo).trim() !== String(ru.userId).trim());
        out.why.push(`본인 식별값: 사번/ID ${ids.join(', ') || '-'} · 이름 ${names.join(', ') || '-'} — 설정 사번 "${settings.myEmpNo || ''}", R&D ERP 자동 감지 USER_ID ${ru.userId || '-'} · EMP_NO ${ru.empNo || '-'}${dropped ? ' (USER_ID 와 달라 무시 — 화면의 대상자 사번이 잘못 읽힌 값)' : ''} · 이름 ${ru.userNm || '-'}. 참여인력 EMP_NO/EMP_NM 과 대조합니다.`);
        if (!mine.length) out.why.push(`참여인력(참여구분 계속, ${list.length}행)에 본인 사번 ${ids.join('/') || '-'}${names.length ? ` · 이름 ${names.join('/')}` : ''} 행이 없어 "내 참여 과제만 보기"에서 제외됩니다 — R&D ERP 과제정보 › 참여인력 탭에서 본인이 등록돼 있는지(참여구분 계속) 확인하세요.`);
        else {
          if (!byId) out.why.push(`사번은 없고 이름만 같은 행 ${hits.length}건입니다 — 다른 과제에서 사번이 맞으면 이름 일치는 무시되므로 제외될 수 있습니다 (이 과제의 EMP_NO 확인).`);
          out.why.push(`참여인력에 본인 행 ${mine.length}건 (${byId ? '사번' : '이름'} 일치): ${mine.map(fmt).join(', ')}.`);
          if (!live.length) out.why.push(`본인 행의 참여기간이 모두 오늘(${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}) 이전에 끝나 현재 참여 과제로 보지 않습니다 — "내 참여 과제만 보기"의 목록과 참여율 표에서 빠집니다 (헤더 "참여 종료 N 제외").`);
          else if (!out.why.some((w) => /제외됩니다|제외한 과제/.test(w))) out.why.push('표시 조건을 모두 충족합니다 — 패널 제목 줄 ↻ 로 다시 조회하면 보입니다.');
        }
        // 확장 캐시 상태 — 옛 값이 보였던 이유를 밝히고, 이 과제는 지금 값으로 갱신
        const sig = (hs) => hs.map((h) => [h.empNo, h.src, h.rate, h.term, h.payTerm].join('|')).sort().join(';');
        const cMine = (c && c.key === key && Array.isArray(c.hits)) ? pick(c.hits) : null;
        if (!c) out.why.push('확장의 참여인력 캐시에 이 과제는 아직 없습니다 (한 번도 판정하지 않음) — 패널 ↻ 로 조회하면 들어갑니다.');
        else if (cMine === null) out.why.push(`확장의 참여인력 캐시(${F.fmtClock(c.ts)} 조회)는 다른 사번/이름 기준이라 쓰이지 않습니다.`);
        else if (sig(cMine) !== sig(mine)) out.why.push(`확장의 참여인력 캐시(${F.fmtClock(c.ts)} 조회)에는 본인 행이 ${cMine.length}건(${cMine.map(fmt).join(', ') || '없음'})이었는데 지금 조회는 ${mine.length}건(${mine.map(fmt).join(', ') || '없음'})입니다 — 캐시가 묵어 패널에 옛 값이 보였던 것입니다. 이 과제의 캐시를 지금 값으로 바꿨으니 패널 ↻(또는 다음 자동 갱신)에서 반영됩니다.`);
        else out.why.push(`확장의 참여인력 캐시(${F.fmtClock(c.ts)} 조회)도 지금 조회와 같습니다 (본인 행 ${mine.length}건).`);
        try { cache[prjNo] = { hits, key, ts: Date.now() }; await chrome.storage.local.set({ membership: cache }); } catch (e) {}
        // 패널의 마지막 조회 결과와 대조: 그 조회의 과제 목록에 이 과제가 있었는지(과제 목록 서비스는 500건에서 잘릴 수 있음) · 패널이 보여 주던 값
        try {
          const pc = (await chrome.storage.local.get('cache')).cache || null;
          if (pc && pc.ts) {
            const inList = Array.isArray(pc.prjNos) ? pc.prjNos.includes(prjNo) : null;
            const shown = (pc.projects || []).find((p) => p.prjNo === prjNo);
            const pi = pc.participation && (pc.participation.items || []).find((x) => x.prjNo === prjNo);
            const listTxt = inList === null ? '있는지 기록 없음(이전 버전의 조회)' : inList ? '있음' : '없음 — 과제 목록 서비스가 500건에서 잘려 빠졌을 수 있음';
            const showTxt = shown ? `표시 중 (참여율 표: ${pi ? (pi.rate == null ? '-' : pi.rate + '%') + (pi.term ? ' · ' + pi.term : '') : '없음'})` : '표시 안 함';
            const kept = (pc.projectCount || 0) - (pc.notMemberCount || 0) - (pc.endedCount || 0) - (pc.excludedCount || 0);
            const keptTxt = pc.memberFilter === 'applied' ? ` 참여 판정 통과 ${kept}건 중 표시 ${(pc.projects || []).length}건${pc.truncatedCount ? ` (표시 상한으로 ${pc.truncatedCount}건 잘림 — 설정의 조회 과제 최대 수)` : ''}.` : '';
            out.why.push(`패널의 마지막 조회(${F.fmtClock(pc.ts)} 기준): 과제 목록 ${pc.projectCount || 0}건에 이 과제가 ${listTxt}, 패널에 ${showTxt}.${keptTxt}${pc.membershipFailed ? ` 그 조회에서 참여인력 다시 조회 실패 ${pc.membershipFailed}건(이전 값 사용).` : ''}`);
          }
        } catch (e) {}
      }
    }
    return out;
  }

  /* eClass SSO 로 R&D ERP 세션 만들기 — 세션이 풀렸을 때 background.js rndAutoLogin 이 부른다 (2026-09-26 CDP 로 실제 브라우저 흐름을 추적해 확인).
   * eClass 홈의 R&D ERP 아이콘(mainCommon.rERP)은 rERP 쪽 페이지 /jsp/rderp/main/sso_login_krs_view.jsp?SSO_PAGE_GB=A 를 SSO_RESULT 창으로 열고, 그 페이지가
   *  ① eClass 의 loginCheck_json.aspx 를 JSONP 로 불러 { UID(30자 암호화 ID), SID(36자 세션 GUID) } 를 받는다 (eClass 쿠키 필요 · 둘 중 하나라도 비면 eClass 로그인 페이지로 보냄)
   *  ② /jsp/rderp/main/sso_login_krs.jct 에 _JSON_={UID,SID,SSO_PAGE_GB:'A'} 로 POST → JSON { URL, COMMON_HEAD } 와 함께 새 JSESSIONID 발급 (.act 로 보내면 JSON 이 아니라 view 페이지 HTML 이 온다)
   *  ③ 그 URL(rderp_layoutMain.act)에 SYS_LOGIN=Y&SSO_PAGE_GB=A 를 폼 POST 하면 세션이 로그인 상태가 된다 (응답은 레이아웃 HTML, 읽지 않음)
   * 확장 출처에서도 같은 요청이 통하며 rERP 는 Referer·Origin 을 보지 않는다. 비밀번호는 오가지 않고 UID·SID 는 저장하지 않는다.
   * 반환 { ok:true, url }. 실패는 kind 'eclass-login'(eClass 세션 없음 → 사용자가 eClass 에 로그인해야 함) | 'network' | 'sso'(응답 이상) | call 의 'service'/'login'(COMMON_HEAD 오류·HTML) 로 throw */
  const SSO = {
    loginCheck: 'https://eclass.krs.co.kr/intra/intranet/Main_N/json/loginCheck_json.aspx',
    dir: 'jsp/rderp/main',   // sso_login_krs_view.jsp · sso_login_krs.jct 가 있는 경로
    pageGb: 'A'
  };
  async function ssoLogin() {
    let res, text = '';
    try { res = await fetch(`${SSO.loginCheck}?callback=cb&_=${Date.now()}`, { credentials: 'include', cache: 'no-store', redirect: 'follow' }); text = await res.text(); }
    catch (e) { throw err('network', 'eClass loginCheck 를 받지 못했습니다: ' + String((e && e.message) || e)); }
    const uid = (text.match(/"UID"\s*:\s*"([^"]*)"/) || [])[1] || '', sid = (text.match(/"SID"\s*:\s*"([^"]*)"/) || [])[1] || '';
    if (!uid || !sid) throw err('eclass-login', `eClass 로그인이 풀려 R&D ERP 자동 로그인(SSO)을 못 했습니다 (loginCheck HTTP ${res.status}${res.redirected ? ' → ' + res.url : ''})`);
    const dat = await call(`${SSO.dir}/sso_login_krs`, { UID: uid, SID: sid, SSO_PAGE_GB: SSO.pageGb });   // 새 JSESSIONID 는 브라우저 쿠키 저장소에 들어간다
    const next = String(dat.URL || '').trim();
    if (!next) throw err('sso', 'sso_login_krs 응답에 URL 이 없습니다', { sample: JSON.stringify(dat).slice(0, 200) });
    const url = new URL(next, `${BASE}/${SSO.dir}/`).href;
    let r2;
    try {
      r2 = await fetch(url, { method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'follow',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `SYS_LOGIN=Y&SSO_PAGE_GB=${SSO.pageGb}` });
      await r2.arrayBuffer();   // 레이아웃 HTML — 읽지 않고 버림
    } catch (e) { throw err('network', 'SSO 마무리 요청(SYS_LOGIN) 실패: ' + String((e && e.message) || e)); }
    if (!r2.ok) throw err('sso', `SSO 마무리 요청(SYS_LOGIN) HTTP ${r2.status}`, { url });
    return { ok: true, url };
  }

  g.KRX_API = { call, ssoLogin, collect, diagnose, fetchProjects, fetchCards, fetchIssuedCards, fetchAccounts, fetchParticipants, fetchBudget, fetchUnapproved, describe, summarizeParticipation, termRange };
})(self);
