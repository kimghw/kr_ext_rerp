/* 서비스워커: 데이터 수집/캐시, 배지, 캡처 로그 저장, 주기 갱신 */
importScripts('lib/format.js', 'lib/settings.js', 'lib/rnd-api.js', 'lib/hr-api.js', 'lib/prep-store.js');

const CACHE_KEY = 'cache';
const CAPTURE_KEY = 'captureLog';
const CAPTURE_MAX = 150;
const ALARM = 'krext-refresh';
let inflight = null, inflightFull = false;   // 진행 중인 조회, 그 조회가 참여인력 캐시까지 건너뛰는 전체 조회인지
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

/* force: 캐시 TTL 과 상관없이 다시 조회. opts.full: 참여인력(계상률) 캐시(2시간)도 건너뛰고 과제마다 다시 조회 — 패널·팝업의 ↻ 처럼 사용자가 직접 누른 새로고침만.
 * 알람·설정 변경·청구서 작성 뒤의 자동 조회는 참여인력 캐시를 그대로 쓴다 (과제마다 한 번씩 부르는 조회라 무거움).
 * 보통 조회가 진행 중일 때 전체 조회를 요청하면 그 조회가 끝난 뒤 이어서 전체 조회를 한다 */
async function refresh(force, opts) {
  let full = !!(opts && opts.full);
  if (inflight) return (full && !inflightFull) ? inflight.then(() => refresh(true, opts), () => refresh(true, opts)) : inflight;
  inflightFull = full;
  inflight = (async () => {
    for (;;) {
      const gen = settingsGen;
      const settings = await KRX_SETTINGS.load();
      const cache = await getCache();
      const ttl = Math.max(1, KRX_FMT.num(settings.refreshMinutes) || 10) * 60000;
      // 오류로 끝난 결과(예: 재로드 직후 일시적 네트워크 오류)는 TTL 과 상관없이 다시 조회
      if (!force && cache && cache.ts && !cache.error && Date.now() - cache.ts < ttl) { updateBadge(cache); return cache; }
      let data = await KRX_API.collect(settings, { freshMembership: full });
      full = false;   // 참여인력은 방금 다시 조회했으므로 이 뒤의 재조회(설정 변경·사번 감지)는 캐시로
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
      // 청구 준비(패널에서 고른 청구종류·첨부 파일): 미청구 목록에서 사라진 거래의 항목은 7일 뒤, 신청까지 끝난 항목은 하루 뒤 정리 (lib/prep-store.js)
      if (!data.loginRequired && !data.error && data.memberFilter !== 'no-id') { try { await KRX_PREP_STORE.cleanup(prepKeysOf(data)); } catch (e) {} }
      return data;
    }
  })().finally(() => { inflight = null; inflightFull = false; });
  return inflight;
}

/* 지금 미청구 목록에 있는 거래의 청구 준비 키(승인번호|카드 뒤 4자리): 과제별 카드 + 카드별 묶음 + 미귀속 묶음 */
function prepKeysOf(data) {
  const keys = new Set();
  const add = (c) => { const k = KRX_FMT.prepKey(c && c.apprNo, c && (c.cardNo || c.tail)); if (k) keys.add(k); };
  for (const p of data.projects || []) for (const c of p.cards || []) add(c);
  for (const card of (data.cards || []).concat(data.unattributed || [])) for (const t of card.txs || []) add(t);
  return keys;
}

/* 청구 준비 "청구서 작성" / "작성+신청" / "신청": R&D ERP 청구서(카드) 화면을 비활성 탭으로 열어(레이아웃 딥링크 #krext, rnd-hook.js) 그 거래 행을 자동 선택하고,
 * content/rnd-claim.js 가 세목·청구종류를 고르고 청구내역(적요)을 적고 파일을 올린 뒤 "내역 추가"를 누른다 (mode 'add' — 결의서에 임시저장 상태로 들어감. 여기서 끝나면 신청은 아직 안 된 것).
 * mode 'add,apply' 면 이어서 결의서 "신청"(결재요청)까지, mode 'apply' 면(이미 내역 추가된 항목 — 미청구 목록에서 빠져 패널의 신청 대기 목록에 있음) 저장된 결의서의 신청만,
 * mode 'delete' 면 내역 추가된 청구내역 행의 [삭제]를 눌러 임시저장을 지운다(거래가 미청구 목록으로 돌아오고 준비 항목은 작성 전 상태로).
 * 결과는 prepRunResult 로 보고: 내역 추가 성공은 진행 보고(final=false, saved) → 신청 결과가 끝 보고. 끝까지 성공하면 탭을 닫고 미청구 목록을 다시 조회(거래가 사라짐),
 * 실패하면 탭을 남겨 두어 패널의 "탭 보기"로 이어서 할 수 있게 한다. 제한 시간(5분) 안에 보고가 없으면 실패로 표시 */
const RND_MAIN = 'https://rnd.krs.co.kr/rderp_layoutMain.act';
const PREP_RUN_TIMEOUT = 5 * 60000;
const wasSaved = (run) => !!(run && (run.saved || run.state === 'done' || run.state === 'saved' || run.state === 'applied'));   // 'done' 은 이전 버전(0.6.9)의 "내역 추가됨" 상태 이름
async function prepRun(key, mode) {
  const m = await KRX_PREP_STORE.loadMeta();
  const e = m[key];
  if (!e) return { ok: false, error: '준비 항목이 없습니다' };
  const steps = new Set(String(mode || 'add').split(/[,+\s]+/).filter(Boolean));
  if (steps.has('delete')) { steps.clear(); steps.add('delete'); }
  if (!steps.has('add') && !steps.has('apply') && !steps.has('delete')) steps.add('add');
  const auto = ['add', 'apply', 'delete'].filter((s) => steps.has(s)).join(',');
  if (steps.has('add') && !e.type) return { ok: false, error: '청구종류를 먼저 고르세요' };
  if (!steps.has('add') && !wasSaved(e.run)) return { ok: false, error: steps.has('delete') ? '내역 추가된 항목이 아닙니다' : '먼저 청구서를 작성(내역 추가)하세요' };
  if (steps.has('delete') && e.run && e.run.state === 'applied') return { ok: false, error: '이미 신청된 결의서는 삭제할 수 없습니다 (R&D ERP 에서 신청 취소 후)' };
  if (e.run && e.run.state === 'running' && Date.now() - e.run.ts < PREP_RUN_TIMEOUT) return { ok: false, error: '이미 진행 중입니다' };
  if (e.run && e.run.tabId != null) { try { await chrome.tabs.remove(e.run.tabId); } catch (x) {} }   // 지난 실행이 남겨 둔 탭
  const req = { open: 'rexpe_0083_01.act', title: '청구서(카드)', menuId: 'menu_id_362', q: 'PRJ_NO=' + encodeURIComponent(e.prjNo || ''), card: e.card4, auto };
  if (steps.has('add')) req.appr = e.appr;
  else {
    /* 신청만·삭제: 미청구 행 자동 선택 없이(이미 청구된 거래) 준비 항목만 찾게 krext_prep. 저장된 결의서는 과제정보 › 청구결의서 탭(rtask_0008_t04_01.js)처럼 주소에
     * REQ_CNT(결의서 차수)·APPR_DIV_CD(40 임시저장)를 붙여야 열린다 — 화면(rexpe_0083_01)은 서버가 주소 파라미터로 렌더한 reqParam/hidden REQ_CNT 로 청구내역 목록(rexpe_0001_01_r018)을 읽고,
     * PRJ_NO 만 주면 새 결의서 폼(REQ_CNT 빈값, 목록 0건)이 열려 청구번호 행을 못 찾는다 (2026-09-25 CDP 확인). 회의비 관련 CFRC_* 파라미터는 없어도 같은 목록이 뜬다 */
    req.prep = e.appr;
    const reqCnt = String((e.run && e.run.reqCnt) || '').trim();
    if (!reqCnt) return { ok: false, error: '결의서 차수(REQ_CNT)가 기록돼 있지 않아 저장된 결의서를 열 수 없습니다 — R&D ERP 과제정보 › 청구결의서 탭에서 직접 처리하세요' };
    req.q += '&REQ_CNT=' + encodeURIComponent(reqCnt) + '&APPR_DIV_CD=40';
  }
  let tab = null;
  try { tab = await chrome.tabs.create({ url: RND_MAIN + '#krext=' + encodeURIComponent(JSON.stringify(req)), active: false }); }
  catch (x) { return { ok: false, error: '탭을 열지 못했습니다: ' + String((x && x.message) || x) }; }
  const prev = e.run || {};
  await KRX_PREP_STORE.setRun(key, { state: 'running', stage: steps.has('add') ? 'add' : steps.has('delete') ? 'delete' : 'apply', mode: auto, ts: Date.now(), tabId: tab.id, msg: '', saved: wasSaved(prev), reqNo: String(prev.reqNo || ''), reqCnt: String(prev.reqCnt || '') });
  setTimeout(async () => {
    try {
      const cur = (await KRX_PREP_STORE.loadMeta())[key];
      if (cur && cur.run && cur.run.state === 'running' && cur.run.tabId === tab.id) await KRX_PREP_STORE.setRun(key, Object.assign({}, cur.run, { state: 'failed', ts: Date.now(), msg: '제한 시간 안에 끝나지 않았습니다 — 탭에서 확인하세요' }));
    } catch (x) {}
  }, PREP_RUN_TIMEOUT);
  return { ok: true, tabId: tab.id };
}
/* rnd-claim.js 의 보고 { key, appr, state: saved|applied|deleted|failed, final, msg, alerts, saved, reqNo, reqCnt }. 이전 버전(0.6.9)의 { ok } 만 있는 보고도 받는다.
 * deleted(임시저장 삭제됨): run 을 지워 준비 항목을 작성 전 상태로 돌리고 미청구 목록을 다시 조회한다(거래가 돌아옴).
 * run = { state: running|saved|applied|failed, stage(running 일 때 add|apply), mode, ts, tabId, msg, saved(내역 추가는 됨), reqNo(청구번호), reqCnt(결의서 차수) } */
async function prepRunResult(msg, sender) {
  const tabId = sender && sender.tab && /rnd\.krs\.co\.kr/.test(String(sender.tab.url || '')) ? sender.tab.id : null;   // 닫을 탭은 R&D ERP 탭일 때만 (다른 곳에서 온 보고로 그 탭을 닫지 않게)
  const key = String(msg.key || '') || await KRX_PREP_STORE.keyFor(msg.appr, '');
  const alerts = Array.isArray(msg.alerts) ? msg.alerts.filter(Boolean) : [];
  const state = ['saved', 'applied', 'deleted', 'failed'].includes(msg.state) ? msg.state : (msg.ok ? 'saved' : 'failed');
  const final = msg.final !== false;
  if (state === 'deleted') {
    if (key) await KRX_PREP_STORE.setRun(key, null);
    if (tabId != null) setTimeout(() => { try { chrome.tabs.remove(tabId).catch(() => {}); } catch (x) {} }, 2500);
    chrome.storage.local.remove(CACHE_KEY).then(() => refresh(true)).catch(() => {});
    return { ok: true, key };
  }
  const text = String(msg.msg || '') + (state === 'failed' && alerts.length && !String(msg.msg || '').includes(alerts[alerts.length - 1]) ? ` (${alerts[alerts.length - 1]})` : '');
  const cur = key ? (await KRX_PREP_STORE.loadMeta())[key] : null;
  const prev = (cur && cur.run) || {};
  const saved = !!msg.saved || state === 'saved' || state === 'applied' || wasSaved(prev);
  if (cur) {
    await KRX_PREP_STORE.setRun(key, { state: final ? state : 'running', stage: final ? '' : 'apply', mode: String(prev.mode || ''), ts: Date.now(), tabId, msg: text, saved,
      reqNo: String(msg.reqNo || prev.reqNo || ''), reqCnt: String(msg.reqCnt || prev.reqCnt || '') });
  }
  if (final && state !== 'failed' && tabId != null) setTimeout(() => { try { chrome.tabs.remove(tabId).catch(() => {}); } catch (x) {} }, 2500);
  // 내역 추가된 거래는 미청구 목록에서 빠지므로 다시 조회 (신청 실패라도 임시저장은 됐음). 이미 저장된 상태에서 신청만 실패한 경우는 목록이 그대로라 건너뜀
  if (saved && (state !== 'failed' || !wasSaved(prev))) chrome.storage.local.remove(CACHE_KEY).then(() => refresh(true)).catch(() => {});
  return { ok: true, key };
}
async function prepFocusTab(key) {
  const e = (await KRX_PREP_STORE.loadMeta())[key];
  const tabId = e && e.run && e.run.tabId;
  if (tabId == null) return { ok: false, error: '열린 탭이 없습니다' };
  try {
    const t = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    try { await chrome.windows.update(t.windowId, { focused: true }); } catch (x) {}
    return { ok: true };
  } catch (x) { return { ok: false, error: '그 탭은 이미 닫혔습니다' }; }
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
      case 'getData': return await refresh(!!msg.force, { full: !!msg.full });   // full: 참여인력 캐시도 건너뜀 (↻)
      case 'jctCaptured': await appendCapture(msg.entry, sender); return { ok: true };
      case 'unapprovedSnapshot': await chrome.storage.local.set({ unapprovedSnapshot: msg.snapshot }); return { ok: true };
      case 'hrPay': { const merged = await mergeHrPay(msg.patch || {}); await patchCacheHrPay(merged); return { ok: true }; }
      case 'hrCollectNow': return await collectHr(true, !!msg.all);   // 패널 급여·연구수당 보기/↻, 설정 페이지 지금 수집 (백그라운드 직접, 안 되면 HR 탭)
      case 'clearHrPay': await chrome.storage.local.remove('hrPay'); await patchCacheHrPay(null); return { ok: true };
      case 'rndUser': {
        const u = msg.user || {};
        if (!u.userId && !u.empNo && !u.userNm) return { ok: false };
        const prev = (await chrome.storage.local.get('rndUser')).rndUser || {};
        const userId = u.userId || prev.userId || '';
        let empNo = u.empNo || prev.empNo || '';
        if (empNo && userId && empNo !== userId) empNo = '';   // 이 ERP 의 사번은 USER_ID 와 같다. 다른 값은 이전 버전 bridge 가 화면의 대상자 EMP_NO 를 잘못 읽은 것이라 버린다
        const next = { userId, empNo, userNm: u.userNm || prev.userNm || '', ts: Date.now() };
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
      // 청구 준비 (lib/prep.js 패널 ↔ lib/prep-store.js ↔ content/rnd-claim.js 청구서)
      case 'prepSetType': return { ok: true, entry: await KRX_PREP_STORE.setType(String(msg.key || ''), msg.meta || {}, msg.value) };
      case 'prepSetPtcl': return { ok: true, entry: await KRX_PREP_STORE.setPtcl(String(msg.key || ''), msg.meta || {}, msg.value) };   // 청구내역(적요) 글
      case 'prepAddFiles': return { ok: true, entry: await KRX_PREP_STORE.addFiles(String(msg.key || ''), msg.meta || {}, msg.files || []) };
      case 'prepRemoveFile': return { ok: true, entry: await KRX_PREP_STORE.removeFile(String(msg.key || ''), String(msg.id || '')) };
      case 'prepClear': await KRX_PREP_STORE.clear(String(msg.key || '')); return { ok: true };
      case 'prepClearAll': await KRX_PREP_STORE.clearAll(); return { ok: true };
      case 'prepGet': return await KRX_PREP_STORE.getEntry(msg.appr, msg.card4, !!msg.withFiles);
      case 'prepAttached': return { ok: true, entry: await KRX_PREP_STORE.markAttached(String(msg.key || ''), msg.n) };
      case 'prepStats': return await KRX_PREP_STORE.stats();
      case 'prepRun': return await prepRun(String(msg.key || ''), String(msg.mode || 'add'));   // 패널 "청구서 작성"(add) · "작성+신청"(add,apply) · "신청"(apply) · "임시저장 삭제"(delete) → 백그라운드 탭
      case 'prepRunResult': return await prepRunResult(msg, sender);           // ERP 청구서(rnd-claim.js)의 결과 보고
      case 'prepFocusTab': return await prepFocusTab(String(msg.key || ''));   // 패널 "탭 보기"
      case 'callService': return await KRX_API.call(msg.service, msg.input || {});
      case 'diagnose': {   // 진단은 그 과제의 참여인력 캐시를 지금 값으로 바꾸므로, 끝나면 패널도 다시 조회해 반영 (캐시 TTL 무시, 다른 과제의 참여인력은 캐시)
        const r = await KRX_API.diagnose(String(msg.prjNo || '').trim(), await KRX_SETTINGS.load());
        if (r && r.member) refresh(true).catch(() => {});
        return r;
      }
      default: return { error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e), kind: e && e.kind }));
  return true;
});
