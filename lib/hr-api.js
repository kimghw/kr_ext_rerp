/* HR System(hr.krs.co.kr) 급여명세서 API 수집. hr.krs.co.kr 페이지 안(콘텐츠 스크립트, 같은 출처)에서만 동작한다.
 * 확장 출처(백그라운드·옵션 페이지)에서 부르면 서버 CORS 필터가 Origin 을 보고 본문 없는 200(content-length: 0)을 돌려주므로 쓸 수 없다 (2026-09-23 확인).
 * 급여명세서 화면(보상 › 나의 급여정보 › 급여명세서, /pay/payself/payself110/view)이 쓰는 API 그대로 (모두 GET, 추가 헤더·토큰 없음):
 *   /popup/psmst?emplNoName=사번&curCode=1&condition=&fieldFlag=emplNo → [{ emplNo, emplNameHan, gradeCode("P2"), orgNameHan, payGroupCode, loginUserId … }]
 *       검색어를 비우면 전 직원 목록(수 MB)이 오므로 반드시 사번으로 조회한다
 *   /pay/payself/payself110?baseYear=연도&emplNo=사번&transInd=Y → [{ payDate, paySeqNo, payNameEnv(내용), incomeAmt(소득합계), transIncomeAmt, dedAmt, sumAmt … }] 본인 사번만 허용(다른 사번은 500)
 *   /pay/payself/payself110/income?payDate&paySeqNo&emplNo&transInd=&taxInd=&sortKey= → [{ printNm(소득명), incomeAmt, payCode, transInd, taxInd }]
 * 로그인이 풀려 있으면 /hrm_admin/login(HTML)으로 리다이렉트된다 → kind:'login' 오류.
 * collect() 의 결과는 background.js mergeHrPay 가 storage.local.hrPay 에 합치는 patch 형태 */
(function (g) {
  const API = { emp: '/popup/psmst', list: '/pay/payself/payself110', income: '/pay/payself/payself110/income' };
  const LOGIN_RE = /\/login(\b|\/|\?|$)/i;
  const EMP_RE = /^\d{3,10}$/;

  function err(kind, message) { const e = new Error(message || kind); e.kind = kind; return e; }
  async function getJson(path, params) {
    const url = path + '?' + new URLSearchParams(params || {}).toString();
    let res;
    try {
      res = await fetch(url, { credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' } });
    } catch (e) { throw err('network', String((e && e.message) || e)); }
    if (res.redirected && LOGIN_RE.test(res.url)) throw err('login', 'HR System 로그인 필요');
    if (res.status === 401 || res.status === 403 || res.status === 419) throw err('login', `HR System 로그인 필요 (HTTP ${res.status})`);
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!/json/i.test(ct) || !text) {
      if (LOGIN_RE.test(res.url) || /hrm_admin\/login/.test(text.slice(0, 4000))) throw err('login', 'HR System 로그인 필요');
      throw err('http', `HTTP ${res.status} (${ct || 'content-type 없음'}${text ? '' : ', 빈 응답'})`);
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw err('parse', 'JSON 파싱 실패'); }
    if (!res.ok) {
      const m = data && data.model && data.model.camelCaseMap && data.model.camelCaseMap.message;
      throw err('http', `HTTP ${res.status}${m ? ' ' + m : ''}`);
    }
    return data;
  }

  /* 직원 정보: 사번으로 조회해 본인 행(emplNo 일치)을 고른다. grade = gradeCode (P1~P4) */
  async function fetchEmployee(empNo) {
    const rows = await getJson(API.emp, { emplNoName: empNo, curCode: '1', condition: '', fieldFlag: 'emplNo' });
    const list = Array.isArray(rows) ? rows : [];
    const me = list.find((r) => r && String(r.emplNo || '') === String(empNo))
      || list.find((r) => r && r.loginUserId && String(r.emplNo || '') === String(r.loginUserId)) || null;
    if (!me) return null;
    return {
      empNo: String(me.emplNo), name: String(me.emplNameHan || me.loginUserNm || '').trim(), dept: String(me.orgNameHan || me.loginDeptName || '').trim(),
      grade: String(me.gradeCode || me.gradeNameHan || me.loginGradeName || '').trim().toUpperCase(),
      payGroupCode: String(me.payGroupCode || ''), sessionUser: String(me.loginUserId || '')
    };
  }
  const rowKey = (r) => `${String(r.payDate).slice(0, 10)}|${String(r.payNameEnv || '').trim()}`;   // 저장 키 (지급일자|내용) — 이전 버전과 같은 형식
  /* 한 해의 급여지급내역 목록 (지급일자 내림차순) */
  async function fetchList(empNo, year) {
    const rows = await getJson(API.list, { baseYear: String(year), emplNo: empNo, transInd: 'Y' });
    return (Array.isArray(rows) ? rows : []).filter((r) => r && r.payDate).map((r) => ({
      key: rowKey(r), date: String(r.payDate).slice(0, 10), title: String(r.payNameEnv || '').trim(), total: Number(r.incomeAmt) || 0, seq: r.paySeqNo,
      transTotal: Number(r.transIncomeAmt) || 0, dedTotal: Number(r.dedAmt) || 0, net: Number(r.sumAmt) || 0
    })).sort((a, b) => b.date.localeCompare(a.date));
  }
  /* 한 달의 지급내역 (소득명 → 금액, 같은 이름은 합산) */
  async function fetchIncome(empNo, row) {
    const list = await getJson(API.income, { payDate: row.date, paySeqNo: row.seq == null ? '' : row.seq, emplNo: empNo, transInd: '', taxInd: '', sortKey: '' });
    const items = {}, order = [], codes = {};
    for (const it of (Array.isArray(list) ? list : [])) {
      const name = String((it && (it.printNm || it.payName || it.payCode)) || '').trim(); if (!name) continue;
      if (!(name in items)) { order.push(name); items[name] = 0; }
      items[name] += Number(it.incomeAmt) || 0;
      if (it.payCode) codes[name] = it.payCode;
    }
    const sum = order.reduce((s, k) => s + items[k], 0);
    return { items, order, codes, sum };
  }

  /* 수집: 직원 정보(직급) + 연도별 목록 + 아직 없거나 소득합계가 달라진 달의 지급내역.
   * opts: { empNo, years: [연도…] (기본 올해), known: storage.hrPay.years, force: 모든 달 다시 읽기 }
   * 이전 버전(화면 읽기)이 저장한 달은 codes 가 없어 한 번은 다시 읽는다. 로그인 오류는 그대로 던지고, 달 하나의 오류는 scan.note 에 남긴다 */
  async function collect(opts) {
    const o = opts || {};
    const empNo = String(o.empNo || '').trim();
    if (!EMP_RE.test(empNo)) throw err('no-emp', '사번을 알 수 없음');
    const years = (Array.isArray(o.years) && o.years.length ? o.years : [new Date().getFullYear()]).map(String);
    const known = o.known || {};
    const patch = { ts: Date.now(), source: 'api', page: location.pathname, empNo, lists: [], months: [] };
    const emp = await fetchEmployee(empNo);
    if (emp) { Object.assign(patch, { name: emp.name, dept: emp.dept, payGroupCode: emp.payGroupCode }); if (emp.grade) patch.grade = emp.grade; }
    let tried = 0, done = 0, failed = 0; const notes = [];
    for (const year of years) {
      const rows = await fetchList(empNo, year);
      patch.lists.push({ year, total: rows.length, rows: rows.map((r) => ({ key: r.key, date: r.date, title: r.title, total: r.total })) });
      const have = (known[year] && known[year].months) || {};
      for (const r of rows) {
        const m = have[r.key];
        if (!o.force && m && m.total === r.total && m.items && m.codes && !m.mismatch) continue;
        tried++;
        try {
          const d = await fetchIncome(empNo, r);
          patch.months.push({ year, key: r.key, date: r.date, title: r.title, seq: r.seq, total: r.total, detailTotal: d.sum, mismatch: d.sum !== r.total,
            items: d.items, order: d.order, codes: d.codes, ts: Date.now() });
          done++;
        } catch (e) {
          if (e && e.kind === 'login') throw e;
          failed++; notes.push(`${r.date} ${r.title}: ${(e && e.message) || e}`);
        }
      }
    }
    patch.scan = { ts: Date.now(), year: years[0], years, tried, done, failed, note: notes.slice(0, 3).join(' / ') };
    return patch;
  }

  g.KRX_HR_API = { API, EMP_RE, getJson, fetchEmployee, fetchList, fetchIncome, collect };
})(typeof self !== 'undefined' ? self : this);
