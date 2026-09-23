/* 서비스워커: 데이터 수집/캐시, 배지, 캡처 로그 저장, 주기 갱신 */
importScripts('lib/format.js', 'lib/settings.js', 'lib/rnd-api.js', 'lib/hr-api.js');

const CACHE_KEY = 'cache';
const CAPTURE_KEY = 'captureLog';
const CAPTURE_MAX = 150;
const ALARM = 'krext-refresh';
let inflight = null;
let settingsGen = 0;   // 설정이 바뀔 때마다 증가. 조회 도중 바뀌면 그 결과(이전 설정 기준)는 버리고 새 설정으로 다시 조회

async function getCache() { return (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || null; }

function updateBadge(data) {
  try {
    if (!data) return;
    if (data.loginRequired) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#8a8f98' });
      chrome.action.setTitle({ title: 'R&D ERP 현황 - 로그인 필요 (eClass의 R&D ERP 메뉴를 클릭해서 로그인해주세요)' });
      return;
    }
    // 미승인내역(보완요청 + 신청)은 실시간값, 없으면 메인화면 방문 시 읽은 스냅샷
    const cards = KRX_FMT.num(data.totalCount) || 0;
    let supplement = 0, apply = 0;
    if (data.unapproved) {
      supplement = KRX_FMT.num(data.unapproved.supplement) || 0;
      apply = KRX_FMT.num(data.unapproved.apply) || 0;
    } else if (data.unapprovedSnapshot && data.unapprovedSnapshot.items) {
      const it = data.unapprovedSnapshot.items;
      supplement = KRX_FMT.num(it['보완요청'] && it['보완요청'].count) || 0;
      apply = KRX_FMT.num(it['신청'] && it['신청'].count) || 0;
    }
    // 승인 필요 건수(보완요청 + 신청)가 있으면 그 수를 빨간 배지로 우선 표시, 없으면 카드미청구 건수를 회색 배지로 표시
    const pending = supplement + apply;
    if (pending > 0) {
      chrome.action.setBadgeText({ text: String(pending) });
      chrome.action.setBadgeBackgroundColor({ color: '#d7263d' });
    } else {
      chrome.action.setBadgeText({ text: cards > 0 ? String(cards) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#8a8f98' });
    }
    chrome.action.setTitle({ title: `R&D ERP 현황 - 보완요청 ${supplement}건 · 신청 ${apply}건 · 카드미청구 ${cards}건` });
  } catch (e) {}
}

async function refresh(force) {
  if (inflight) return inflight;
  inflight = (async () => {
    for (;;) {
      const gen = settingsGen;
      const settings = await KRX_SETTINGS.load();
      const cache = await getCache();
      const ttl = Math.max(1, KRX_FMT.num(settings.refreshMinutes) || 10) * 60000;
      // 오류로 끝난 결과(예: 재로드 직후 일시적 네트워크 오류)는 TTL 과 상관없이 다시 조회
      if (!force && cache && cache.ts && !cache.error && Date.now() - cache.ts < ttl) { updateBadge(cache); return cache; }
      let data = await KRX_API.collect(settings);
      if (gen !== settingsGen) { force = true; continue; }   // 조회 중 설정이 바뀜(예: 과제 제외) → 이 결과는 캐시하지 않고 다시 조회
      if (data.memberFilter === 'no-id' && !data.loginRequired) {
        // 사번/이름을 아직 모름 → 열려 있는 ERP 탭이 있으면 브리지를 넣어 직접 읽어 온 뒤 한 번 더 판정
        await injectBridgeIntoOpenErpTabs();
        const u = (await chrome.storage.local.get('rndUser')).rndUser;
        if (u && (u.userId || u.empNo || u.userNm)) data = await KRX_API.collect(settings);
      }
      const issued = data.issued || [];
      const projectList = data.projectList || [];
      delete data.issued;
      delete data.projectList;
      try { data.hrPay = (await chrome.storage.local.get('hrPay')).hrPay || null; } catch (e) {}   // 조회 도중 HR 급여명세서가 수집됐을 수 있어 저장 직전 값으로
      await chrome.storage.local.set({ [CACHE_KEY]: data });
      if (!data.loginRequired && data.memberFilter !== 'no-id' && !data.error) {
        // 설정 페이지의 과제 선택 / 발급 카드 목록: 참여 과제만 저장 (다른 과제 정보는 저장하지 않음)
        await chrome.storage.local.set({
          projectList: { ts: data.ts, projects: projectList },
          issuedCards: { ts: data.ts, projects: issued }
        });
      }
      updateBadge(data);
      return data;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

async function appendCapture(entry, sender) {
  if (!entry || !entry.service) return;
  const cur = (await chrome.storage.local.get(CAPTURE_KEY))[CAPTURE_KEY] || [];
  entry.tabUrl = (sender && sender.tab && sender.tab.url) || '';
  cur.push(entry);
  while (cur.length > CAPTURE_MAX) cur.shift();
  await chrome.storage.local.set({ [CAPTURE_KEY]: cur });
}

async function scheduleAlarm() {
  const settings = await KRX_SETTINGS.load();
  await chrome.alarms.clear(ALARM);
  if (settings.autoRefresh) {
    chrome.alarms.create(ALARM, { periodInMinutes: Math.max(1, KRX_FMT.num(settings.refreshMinutes) || 10) });   // 설정의 갱신 주기(분), 최소 1분
  }
}

/* 이미 열려 있는 R&D ERP 탭에 브리지를 다시 넣는다 (모든 프레임).
 * 확장을 설치/재로드해도 열린 탭의 콘텐츠 스크립트는 다시 실행되지 않으므로, 사용자 식별(rndUser)이 안 잡힌 채로 남는 것을 막는다.
 * 완료되면 refresh 가 새 rndUser 로 참여 과제를 판정한다 */
async function injectBridgeIntoOpenErpTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['https://rnd.krs.co.kr/*'] }); } catch (e) { return; }
  await Promise.all((tabs || []).map((t) =>
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content/rnd-bridge.js'] }).catch(() => {})));
  if (tabs.length) await new Promise((r) => setTimeout(r, 1500));   // 브리지의 rndUser 메시지가 저장될 시간
}

/* 이미 열려 있는 R&D ERP 탭에 청구서(카드) 입력 도우미를 넣는다 (모든 프레임). 설치/재로드 뒤 ERP 화면을 다시 열지 않아도 되게 함.
 * 스크립트는 다시 주입되면 이전 것을 스스로 멈추고 요소를 걷어낸 뒤 새로 붙인다 */
async function injectClaimHelperIntoOpenErpTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['https://rnd.krs.co.kr/*'] }); } catch (e) { return; }
  await Promise.all((tabs || []).map((t) =>
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['lib/settings.js', 'content/rnd-claim.js'] }).catch(() => {})));
}

/* 이미 열려 있는 HR System 탭(최상위 프레임)에 급여명세서 수집 스크립트를 넣는다. 다시 주입된 스크립트는 이전 것을 멈추고 새로 시작한다 */
async function injectHrIntoOpenTabs() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['https://hr.krs.co.kr/*'] }); } catch (e) { return; }
  await Promise.all((tabs || []).map((t) =>
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['lib/format.js', 'lib/settings.js', 'lib/hr-api.js', 'content/hr-pay.js'] }).catch(() => {})));
}
/* 열려 있는 HR System 탭에 급여명세서 수집(hrCollect)을 요청한다 (백그라운드 직접 호출이 안 될 때의 대체 경로).
 * 수집 결과는 탭이 hrPay 메시지로 따로 보내온다. 첫 탭이 성공하면 나머지는 건너뜀. 반환: { ok, via:'tab', tabs, … 탭의 응답 } */
async function requestHrCollect(force, all) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['https://hr.krs.co.kr/*'] }); } catch (e) { tabs = []; }
  let last = null;
  for (const t of tabs || []) {
    try {
      const r = await chrome.tabs.sendMessage(t.id, { type: 'hrCollect', force: !!force, all: !!all }, { frameId: 0 });
      last = r || { error: '응답 없음' };
      if (r && r.ok) break;
    } catch (e) { last = { error: String((e && e.message) || e) }; }
  }
  return Object.assign({ ok: false, via: 'tab', tabs: (tabs || []).length }, last || { error: (tabs || []).length ? '응답 없음' : 'HR System 탭 없음' });
}

/* HR API 를 백그라운드에서 직접 부르기 위한 DNR 규칙: 이 확장이 hr.krs.co.kr 에 보내는 XHR/fetch 의 Referer 를 HR 로 바꾼다.
 * HR 서버는 Referer 가 자기 사이트가 아니면(확장 출처·다른 사이트) 본문 없는 200 을 돌려준다 — Origin 은 보지 않음 (2026-09-23 확인).
 * initiatorDomains 로 이 확장이 보낸 요청에만 적용해 다른 사이트의 HR 요청에는 영향이 없게 한다. 동적 규칙이라 브라우저를 다시 켜도 남는다 */
const HR_RULE_ID = 9101;
let hrRulesReady = false;
async function ensureHrRules() {
  if (hrRulesReady) return true;
  try {
    const rule = { id: HR_RULE_ID, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: KRX_HR_API.HOME + '/' }] },
      condition: { urlFilter: '||hr.krs.co.kr/', resourceTypes: ['xmlhttprequest'], initiatorDomains: [chrome.runtime.id] } };
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [HR_RULE_ID], addRules: [rule] });
    hrRulesReady = true;
  } catch (e) { hrRulesReady = false; }
  return hrRulesReady;
}

/* HR 급여명세서 수집 (백그라운드 직접 호출). HR 탭이 없어도 HR 로그인 세션(쿠키)이 살아 있으면 된다.
 * 주기적으로 돌지 않고, 패널의 급여·연구수당 보기/↻ 나 설정 페이지의 지금 수집(hrCollectNow)을 눌렀을 때만 읽는다 (급여는 한 달에 한 번 바뀌므로).
 * force 가 아니면 저장값이 갱신 주기 안일 때 건너뜀, all 이면 모든 달을 다시 읽음 (아니면 목록만 다시 받고 새로 생기거나 소득합계가 바뀐 달만 지급내역 조회).
 * 사번: 저장된 hrPay.empNo → R&D ERP 사용자(rndUser) → 설정 myEmpNo. 사번을 모르거나 직접 호출이 실패하면(빈 응답 등) 열려 있는 HR 탭에 맡긴다.
 * 로그인이 풀려 있으면(로그인 페이지로 리다이렉트) 탭도 같은 쿠키라 소용없으므로, 설정 hr.autoLogin 이 켜져 있으면 hrAutoLogin 으로 HR 메인을 열어 SSO 자동 로그인 뒤 한 번 더 읽고,
 * 그래도 안 되면 status.loginRequired(+tabOpened) 로 기록한다 */
/* HR 로그인이 풀렸을 때 자동 재로그인: HR 메인 페이지를 열면 SSO 로 자동 로그인되므로, 비활성 탭으로 열고(이미 HR 탭이 있으면 그 탭을 그 주소로 이동)
 * hr.krs.co.kr 로 돌아와 다 뜰 때까지 기다린 뒤 tryCollect 로 다시 읽는다. HR 은 SPA 라 주소만으로는 로그인 여부를 알 수 없어 API 응답으로 판단하고,
 * 아직 로그인 리다이렉트면 2초 간격으로 제한 시간까지 재시도한다. 성공하면 이 함수가 연 탭은 닫고, 안 되면 탭을 그대로 두어 사용자가 거기서 로그인할 수 있게 한다(tabOpened).
 * 반환: 성공 시 tryCollect 의 결과, 실패 시 { ok:false, error, kind, tabOpened } */
const HR_AUTO_LOGIN_MS = 30000;
async function hrAutoLogin(hrUrl, tryCollect) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let tab = null, created = false;
  try {
    const open = await chrome.tabs.query({ url: ['https://hr.krs.co.kr/*'] });
    if (open && open.length) { tab = open[0]; await chrome.tabs.update(tab.id, { url: hrUrl }); }
    else { tab = await chrome.tabs.create({ url: hrUrl, active: false }); created = true; }
  } catch (e) { return { ok: false, kind: 'login', error: 'HR System 탭을 열지 못했습니다: ' + String((e && e.message) || e) }; }
  const deadline = Date.now() + HR_AUTO_LOGIN_MS;
  let landed = false, lastErr = null;
  while (Date.now() < deadline) {
    await sleep(landed ? 2000 : 500);
    let t = null;
    try { t = await chrome.tabs.get(tab.id); } catch (e) { return { ok: false, kind: 'login', error: 'HR System 탭이 닫혀 자동 로그인을 끝내지 못했습니다' }; }
    if (!landed) {   // SSO 가 다른 사이트를 거치는 동안(url 을 볼 수 없음)은 기다리고, HR 로 돌아와 로딩이 끝나면 잠시 뒤 읽기 시작
      if (t.status !== 'complete' || !/^https:\/\/hr\.krs\.co\.kr\//i.test(String(t.url || ''))) continue;
      landed = true; await sleep(1500);
    }
    try {
      const r = await tryCollect();
      if (created) { try { await chrome.tabs.remove(tab.id); } catch (e) {} }
      return r;
    } catch (e) { lastErr = e; if (!(e && e.kind === 'login')) break; }
  }
  const kind = (lastErr && lastErr.kind) || 'login';
  return { ok: false, kind, tabOpened: true,
    error: kind === 'login' ? 'HR System 자동 로그인이 되지 않았습니다' : String((lastErr && lastErr.message) || lastErr) };
}

let hrInflight = null;
async function collectHr(force, all) {
  if (hrInflight) return hrInflight;
  hrInflight = (async () => {
    const settings = await KRX_SETTINGS.load();
    const hr = Object.assign({}, KRX_SETTINGS.DEFAULTS.hr || {}, settings.hr || {});
    if (hr.enabled === false) return { ok: false, skipped: 'disabled' };
    const store = await chrome.storage.local.get(['hrPay', 'rndUser']);
    const cur = store.hrPay || {};
    const ttl = Math.max(1, KRX_FMT.num(settings.refreshMinutes) || 10) * 60000;
    if (!force && cur.ts && cur.source === 'api' && !(cur.status && (cur.status.loginRequired || cur.status.error)) && Date.now() - cur.ts < ttl) return { ok: false, skipped: 'fresh' };
    const u = store.rndUser || {};
    const empNo = [cur.empNo, u.empNo, u.userId, settings.myEmpNo].map((v) => String(v || '').trim()).find((v) => KRX_HR_API.EMP_RE.test(v)) || '';
    if (!empNo) return await requestHrCollect(force, all);   // 사번을 모름 → HR 탭(프로필에서 읽음)에 맡김
    await ensureHrRules();
    const tryCollect = async () => {
      KRX_HR_API.setBase(KRX_HR_API.HOME);
      const patch = await KRX_HR_API.collect({ empNo, known: cur.years || {}, years: [new Date().getFullYear()], force: !!all, page: 'background' });
      patch.status = { ts: Date.now(), ok: true, via: 'background' };
      const merged = await mergeHrPay(patch); await patchCacheHrPay(merged);
      return { ok: true, via: 'background', scan: patch.scan, grade: patch.grade || '', empNo, months: patch.lists.reduce((s, l) => s + l.total, 0) };
    };
    try { return await tryCollect(); }
    catch (e) {
      let kind = e && e.kind, msg = String((e && e.message) || e), tabOpened = false;
      if (kind === 'login' && hr.autoLogin !== false) {   // 로그인이 풀림 → HR 메인을 비활성 탭으로 열어 SSO 자동 로그인 뒤 다시 읽기 (hrAutoLogin)
        const re = await hrAutoLogin(hr.url || KRX_HR_API.HOME + '/', tryCollect);
        if (re.ok) return Object.assign(re, { autoLogin: true });
        kind = re.kind || kind; msg = re.error || msg; tabOpened = !!re.tabOpened;
      }
      if (kind !== 'login') {   // 빈 응답(규칙 미적용)·네트워크·HTTP 오류 → HR 탭이 있으면 그쪽에서 (탭은 프로필의 사번으로 다시 시도)
        const viaTab = await requestHrCollect(force, all);
        if (viaTab.ok) return viaTab;
      }
      const status = { ts: Date.now(), error: msg, loginRequired: kind === 'login', tabOpened, via: 'background' };
      const merged = await mergeHrPay({ status }); await patchCacheHrPay(merged);
      return { ok: false, via: 'background', error: msg, loginRequired: status.loginRequired, tabOpened };
    }
  })().finally(() => { hrInflight = null; });
  return hrInflight;
}

/* HR 급여명세서 수집(content/hr-pay.js → lib/hr-api.js) 병합 → storage.local.hrPay
 * { ts(마지막 성공 수집), source:'api', page, empNo, name, dept, grade(P1~P4, HR 직원 정보의 gradeCode), gradeTs,
 *   years: { [연도]: { months: { [지급일자|내용]: { date, title, seq, total, detailTotal, mismatch, items:{소득명: 금액}, order, codes, ts } }, list: { ts, total, rows } } },
 *   scan: { ts, years, tried, done, failed, note }, status: { ts, ok | error, loginRequired } }
 * API 는 한 해의 목록 전체를 주므로 목록은 통째로 교체하고 목록에 없는 달(예전 화면 읽기 잔재)은 지운다. 달은 key 로 덮어쓴다. 3년 넘은 연도는 정리 */
async function mergeHrPay(patch) {
  const cur = (await chrome.storage.local.get('hrPay')).hrPay || { years: {} };
  cur.years = cur.years || {};
  if (patch.lists || patch.months || patch.grade || patch.empNo) { cur.ts = Date.now(); if (patch.source) cur.source = patch.source; }
  if (patch.page) cur.page = patch.page;
  for (const k of ['empNo', 'name', 'dept', 'payGroupCode']) if (patch[k]) cur[k] = patch[k];
  if (patch.grade) { cur.grade = String(patch.grade).toUpperCase(); cur.gradeTs = Date.now(); }
  for (const l of patch.lists || []) {
    if (!l || !l.year) continue;
    const y = cur.years[l.year] = cur.years[l.year] || { months: {} };
    y.months = y.months || {};
    const rows = (l.rows || []).filter((r) => r && r.key).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const keys = new Set(rows.map((r) => r.key));
    for (const k of Object.keys(y.months)) if (!keys.has(k)) delete y.months[k];
    y.list = { ts: Date.now(), total: rows.length, rows };
  }
  for (const m of patch.months || []) {
    if (!m || !m.key || !m.year) continue;
    const y = cur.years[m.year] = cur.years[m.year] || { months: {} };
    y.months = y.months || {};
    y.months[m.key] = m;
  }
  if (patch.scan) cur.scan = patch.scan;
  if (patch.status) cur.status = patch.status;
  const thisYear = new Date().getFullYear();
  for (const k of Object.keys(cur.years)) if (Number(k) < thisYear - 2) delete cur.years[k];
  await chrome.storage.local.set({ hrPay: cur });
  return cur;
}
/* 패널 캐시의 hrPay 만 바꿔 넣어 eClass 패널·팝업이 바로 다시 그리게 한다 (R&D ERP 는 다시 조회하지 않음) */
async function patchCacheHrPay(hrPay) {
  const cache = await getCache();
  if (!cache) return;
  cache.hrPay = hrPay;
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

chrome.runtime.onInstalled.addListener(() => {   // 설치/업데이트/재로드 시 이전 캐시를 버리고 새로 조회
  chrome.storage.local.remove([CACHE_KEY, 'hrDiag'])
    .then(ensureHrRules)
    .then(injectBridgeIntoOpenErpTabs)
    .then(injectClaimHelperIntoOpenErpTabs)
    .then(injectHrIntoOpenTabs)
    .then(() => { scheduleAlarm(); refresh(true).catch(() => {}); });
  // 열려 있는 eClass 홈 탭은 옛 콘텐츠 스크립트가 남아 통신이 끊기므로 새로고침
  try {
    chrome.tabs.query({ url: ['https://eclass.krs.co.kr/eClassVer4/Home/Index*', 'https://eclass.krs.co.kr/eClassVer4/Home', 'https://eclass.krs.co.kr/eClassVer4/'] }, (tabs) => {
      if (chrome.runtime.lastError) return;
      for (const t of tabs || []) { try { chrome.tabs.reload(t.id); } catch (e) {} }
    });
  } catch (e) {}
});
chrome.runtime.onStartup.addListener(() => { ensureHrRules(); scheduleAlarm(); getCache().then(updateBadge); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refresh(true).catch(() => {}); });

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'sync' || area === 'local') && changes.settings) {
    settingsGen++;   // 진행 중인 조회가 있으면 끝난 뒤 새 설정으로 한 번 더 돌게 함
    chrome.storage.local.remove(CACHE_KEY).then(() => { scheduleAlarm(); refresh(true).catch(() => {}); });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'getData': return await refresh(!!msg.force);
      case 'jctCaptured': await appendCapture(msg.entry, sender); return { ok: true };
      case 'unapprovedSnapshot': await chrome.storage.local.set({ unapprovedSnapshot: msg.snapshot }); return { ok: true };
      case 'hrPay': { const merged = await mergeHrPay(msg.patch || {}); await patchCacheHrPay(merged); return { ok: true }; }
      case 'hrCollectNow': return await collectHr(true, !!msg.all);   // 패널 급여·연구수당 보기/↻, 설정 페이지 지금 수집 (백그라운드 직접, 안 되면 HR 탭)
      case 'clearHrPay': await chrome.storage.local.remove('hrPay'); await patchCacheHrPay(null); return { ok: true };
      case 'rndUser': {
        const u = msg.user || {};
        if (!u.userId && !u.empNo && !u.userNm) return { ok: false };
        const prev = (await chrome.storage.local.get('rndUser')).rndUser || {};
        const next = { userId: u.userId || prev.userId || '', empNo: u.empNo || prev.empNo || '', userNm: u.userNm || prev.userNm || '', ts: Date.now() };
        if (next.userId !== prev.userId || next.empNo !== prev.empNo || next.userNm !== prev.userNm) {
          await chrome.storage.local.set({ rndUser: next, membership: {} });   // 사용자가 바뀌면 참여 판정 캐시 초기화
        } else {
          await chrome.storage.local.set({ rndUser: next });
        }
        return { ok: true };
      }
      case 'openOptions': await chrome.runtime.openOptionsPage(); return { ok: true };
      case 'clearCapture': await chrome.storage.local.set({ [CAPTURE_KEY]: [] }); return { ok: true };
      case 'invalidate': await chrome.storage.local.remove(CACHE_KEY); return { ok: true };
      case 'callService': return await KRX_API.call(msg.service, msg.input || {});
      case 'diagnose': return await KRX_API.diagnose(String(msg.prjNo || '').trim(), await KRX_SETTINGS.load());
      default: return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e), kind: e && e.kind }));
  return true;
});
