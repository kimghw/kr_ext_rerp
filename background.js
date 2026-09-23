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
      chrome.action.setTitle({ title: 'R&D ERP 현황 - 로그인 필요' });
      return;
    }
    const n = data.totalCount || 0;
    chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#d7263d' });
    chrome.action.setTitle({ title: `R&D ERP 현황 - 카드미청구 ${n}건` });
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
    chrome.alarms.create(ALARM, { periodInMinutes: Math.max(5, KRX_FMT.num(settings.refreshMinutes) || 10) });
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

chrome.runtime.onInstalled.addListener(() => {   // 설치/업데이트/재로드 시 이전 캐시를 버리고 새로 조회
  chrome.storage.local.remove(CACHE_KEY)
    .then(injectBridgeIntoOpenErpTabs)
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
