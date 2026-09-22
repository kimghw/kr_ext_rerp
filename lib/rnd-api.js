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

  /* 과제 목록
   * 1순위: rcomm_0009_01_r001 (과제 검색 팝업과 동일, 사용자가 볼 수 있는 전체 과제)
   * 2순위: rmain_0005_01_r001 (종료 90일 이내 진행과제) - 1순위가 실패하거나 0건일 때 */
  async function fetchProjects(settings) {
    const adv = settings.adv || {};
    const primary = adv.projectsService || 'rcomm_0009_01_r001';
    const input = Object.assign({ SEARCH_NM: '', SEARCH_GB: '', GUBUN: 'A', PRJ_AUTH: '' }, g.KRX_SETTINGS.parseJson(adv.projectsInput));
    let recs = [];
    let firstErr = null;
    try { const data = await call(primary, input); recs = Array.isArray(data.REC) ? data.REC : []; }
    catch (e) { if (e.kind === 'login') throw e; firstErr = e; }
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
    const recs = [].concat(Array.isArray(data.INFO_REC) ? data.INFO_REC : [], Array.isArray(data.HM_PER_REC) ? data.HM_PER_REC : []);
    return recs.map((r) => ({
      empNo: String(r.EMP_NO || '').trim(),
      empNm: String(r.EMP_NM || '').trim(),
      role: String(r.ROLE_NM || '').trim(),
      term: String(r.PART_TRM_DT_DTL || r.PART_TRM_DT || '').trim(),
      blng: String(r.BLNG_YN || '').trim()
    }));
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

  const MEMBER_TTL = 12 * 60 * 60 * 1000;
  /* 본인 참여 여부를 과제별로 판정 (12시간 캐시). 사번(EMP_NO) 일치 우선, 이름(EMP_NM) 일치는 보조 */
  async function checkMembership(projects, myIds, myNames, settings) {
    let cache = {};
    try { cache = (await chrome.storage.local.get('membership')).membership || {}; } catch (e) {}
    const key = myIds.join('|') + '#' + myNames.join('|');
    const now = Date.now();
    const result = {};
    const todo = [];
    for (const p of projects) {
      const c = cache[p.prjNo];
      if (c && c.key === key && now - c.ts < MEMBER_TTL) result[p.prjNo] = c.member; else todo.push(p);
    }
    await pool(todo, 4, async (p) => {
      try {
        const list = await fetchParticipants(p.prjNo, settings);
        const member = list.some((x) => (x.empNo && myIds.includes(x.empNo)) || (x.empNm && myNames.includes(x.empNm)));
        result[p.prjNo] = member;
        cache[p.prjNo] = { member, key, ts: now };
      } catch (e) {
        result[p.prjNo] = null;
        if (e.kind === 'login') throw e;
      }
    });
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

  /* 전체 수집. 예외를 던지지 않고 결과 객체에 오류를 담아 반환 */
  async function collect(settings) {
    const adv = settings.adv || {};
    const showShared = !!settings.showShared;
    const out = {
      ts: Date.now(), loginRequired: false, error: null,
      projects: [], totalCount: 0, totalAmount: 0, sumCount: 0, sumAmount: 0, projectCount: 0, excludedCount: 0,
      issued: [], projectList: [], myIds: [], myNames: [], memberFilter: 'off', notMemberCount: 0,
      cards: [], unattributed: [], unattributedCount: 0, unattributedAmount: 0, cancelPairs: 0, dupSuspects: 0,
      unapproved: null, unapprovedError: null, unapprovedSnapshot: null,
      settings: {
        cardFilterMode: settings.cardFilterMode, cardFilterList: settings.cardFilterList || [],
        selectedCards: settings.selectedCards || [],
        monthsBack: settings.monthsBack, monthsForward: settings.monthsForward,
        hideZeroProjects: settings.hideZeroProjects, rndUrl: settings.rndUrl,
        accountRule: settings.accountRule !== false, showShared,
        unapprovedLinkUrl: (settings.unapproved && settings.unapproved.linkUrl) || settings.rndUrl,
        unapprovedConfigured: !!(settings.unapproved && settings.unapproved.serviceId)
      }
    };
    try { out.unapprovedSnapshot = (await chrome.storage.local.get('unapprovedSnapshot')).unapprovedSnapshot || null; } catch (e) {}

    let projects;
    try { projects = await fetchProjects(settings); }
    catch (e) {
      const d = describe(e);
      if (d.kind === 'login') out.loginRequired = true; else out.error = d.message;
      return out;
    }
    out.projectCount = projects.length;

    // 본인이 참여인력(참여연구원/과제책임자)에 있는 과제만. 사번/이름을 모르면 과제를 표시하지 않음
    if (settings.onlyMyProjects) {
      let rndUser = null;
      try { rndUser = (await chrome.storage.local.get('rndUser')).rndUser || null; } catch (e) {}
      const myIds = [settings.myEmpNo, rndUser && rndUser.empNo, rndUser && rndUser.userId].map((x) => String(x || '').trim()).filter(Boolean);
      const myNames = [rndUser && rndUser.userNm].map((x) => String(x || '').trim()).filter(Boolean);
      out.myIds = Array.from(new Set(myIds));
      out.myNames = Array.from(new Set(myNames));
      if (!out.myIds.length && !out.myNames.length) {
        out.memberFilter = 'no-id';
        out.notMemberCount = projects.length;
        projects = [];
      } else {
        out.memberFilter = 'applied';
        try {
          const member = await checkMembership(projects.slice(0, 200), out.myIds, out.myNames, settings);
          const kept = projects.filter((p) => member[p.prjNo] !== false);
          out.notMemberCount = projects.length - kept.length;
          projects = kept;
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
    projects = projects.slice(0, Math.max(1, F.num(settings.maxProjects) || 30));

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
    return out;
  }

  /* 진단: 한 과제에 대해 확장이 쓰는 서비스들을 그대로 호출해 원본 응답을 돌려줌 */
  async function diagnose(prjNo, settings) {
    const out = { prjNo, ts: Date.now(), steps: [] };
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
    await step('과제 목록', adv.projectsService || 'rcomm_0009_01_r001',
      Object.assign({ SEARCH_NM: '', SEARCH_GB: '', GUBUN: 'A', PRJ_AUTH: '' }, g.KRX_SETTINGS.parseJson(adv.projectsInput)),
      (d) => ({ total: (d.REC || []).length, matchingPrj: (d.REC || []).filter((r) => String(r.PRJ_NO).trim() === prjNo).map((r) => ({ PRJ_NO: r.PRJ_NO, ANL: r.ANL, PRJ_NM: r.PRJ_NM, PRJ_RSPR_EMP_NM: r.PRJ_RSPR_EMP_NM, PROG_STS_NM: r.PROG_STS_NM })) }));
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
        (d) => ({ people: [].concat(d.INFO_REC || [], d.HM_PER_REC || []).map((r) => ({ EMP_NO: r.EMP_NO, EMP_NM: r.EMP_NM, ROLE_NM: r.ROLE_NM, BLNG_YN: r.BLNG_YN, PART_TRM_DT: r.PART_TRM_DT })) }));
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
    return out;
  }

  g.KRX_API = { call, collect, diagnose, fetchProjects, fetchCards, fetchIssuedCards, fetchAccounts, fetchParticipants, fetchBudget, fetchUnapproved, describe };
})(self);
