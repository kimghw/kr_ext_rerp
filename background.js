/* 서비스워커: 데이터 수집/캐시, 배지, 캡처 로그 저장, 주기 갱신 */
importScripts('lib/format.js', 'lib/settings.js', 'lib/rnd-api.js');

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
      requestHrCollect(force).catch(() => {});   // 열려 있는 HR 탭이 있으면 급여명세서도 함께 갱신 (결과는 hrPay 메시지로 따로 반영, 주기 판단은 탭 쪽에서)
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
/* 열려 있는 HR System 탭에 급여명세서 수집(hrCollect)을 요청한다. HR API 는 확장 출처에서 부르면 본문 없는 200 을 주므로(CORS) 탭 안에서만 호출할 수 있다.
 * 수집 결과는 탭이 hrPay 메시지로 따로 보내온다. 첫 탭이 성공하면 나머지는 건너뜀 */
async function requestHrCollect(force, all) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['https://hr.krs.co.kr/*'] }); } catch (e) { return { tabs: 0, results: [] }; }
  const out = { tabs: (tabs || []).length, results: [] };
  for (const t of tabs || []) {
    try {
      const r = await chrome.tabs.sendMessage(t.id, { type: 'hrCollect', force: !!force, all: !!all }, { frameId: 0 });
      out.results.push(r || { error: '응답 없음' });
      if (r && r.ok) break;
    } catch (e) { out.results.push({ error: String((e && e.message) || e) }); }
  }
  return out;
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
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); getCache().then(updateBadge); });
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
      case 'hrCollectNow': return await requestHrCollect(true, !!msg.all);   // 설정 페이지: 열려 있는 HR 탭에서 지금 수집
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
