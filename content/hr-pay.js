/* hr.krs.co.kr (최상위 프레임): HR System 급여명세서를 API 로 수집해 백그라운드(storage.local.hrPay)에 넘긴다 — lib/hr-api.js
 * - HR 에 로그인된 탭이 열려 있으면 어느 화면이든(급여명세서를 열 필요 없음) 페이지 로드 때 한 번, 그 뒤엔 백그라운드가 갱신 주기마다 보내는 hrCollect 요청에 따라 수집.
 *   HR API 는 확장 출처에서 부르면 본문 없는 200 을 주므로(CORS) 이 탭 안에서만 호출할 수 있다
 * - 사번: 화면 좌측 프로필(#_profile_userId) → 저장된 hrPay.empNo → R&D ERP 사용자(rndUser) → 설정 myEmpNo
 * - 로그인 페이지(/hrm_admin/login)면 건너뛰고, 세션이 풀려 로그인으로 리다이렉트되면 hrPay.status.loginRequired 로 기록
 * 확장 재로드 후 다시 주입되면 이전 스크립트는 스스로 멈춘다 (rnd-claim.js 와 같은 방식) */
(() => {
  if (window !== window.top) return;
  const RESTART_EVT = 'krext-hr-restart';
  document.dispatchEvent(new Event(RESTART_EVT));
  let stopped = false;
  document.addEventListener(RESTART_EVT, () => { stopped = true; });

  const S = self.KRX_SETTINGS, H = self.KRX_HR_API;
  const log = (...a) => { try { console.debug('[krext hr]', ...a); } catch (e) {} };
  const send = (msg) => { try { const p = chrome.runtime.sendMessage(msg); if (p && p.catch) p.catch(() => {}); return p; } catch (e) {} };
  const MIN_GAP = 60 * 1000;   // 같은 탭에서 연속 수집 최소 간격 (force 가 아닐 때)
  let running = null, lastRun = 0;

  function profileEmpNo() {
    const el = document.querySelector('#_profile_userId');
    const t = el ? String(el.textContent || '').trim() : '';
    return H.EMP_RE.test(t) ? t : '';
  }
  async function resolveEmpNo(settings) {
    const fromPage = profileEmpNo(); if (fromPage) return fromPage;
    try {
      const st = await chrome.storage.local.get(['hrPay', 'rndUser']);
      const hp = st.hrPay; if (hp && H.EMP_RE.test(String(hp.empNo || ''))) return String(hp.empNo);
      const u = st.rndUser || {}; for (const v of [u.empNo, u.userId]) if (H.EMP_RE.test(String(v || ''))) return String(v);
    } catch (e) {}
    const my = String((settings && settings.myEmpNo) || '').trim();
    return H.EMP_RE.test(my) ? my : '';
  }

  /* 수집 한 번. force 가 아니면 최근 MIN_GAP 안에 돌았거나 저장된 값이 갱신 주기(refreshMinutes) 안이면 건너뜀 */
  async function run(reason, force) {
    if (stopped) return { ok: false, skipped: 'stopped' };
    if (running) return running;
    running = (async () => {
      try {
        const settings = await S.load();
        const hr = Object.assign({}, S.DEFAULTS.hr || {}, settings.hr || {});
        if (hr.enabled === false) return { ok: false, skipped: 'disabled' };
        if (/login/i.test(location.pathname)) return { ok: false, skipped: 'login-page' };
        const st = (await chrome.storage.local.get('hrPay')).hrPay || {};
        const ttl = Math.max(1, Number(settings.refreshMinutes) || 10) * 60000;
        if (!force) {
          if (Date.now() - lastRun < MIN_GAP) return { ok: false, skipped: 'recent' };
          if (st.ts && st.source === 'api' && !(st.status && (st.status.loginRequired || st.status.error)) && Date.now() - st.ts < ttl) return { ok: false, skipped: 'fresh' };
        }
        const empNo = await resolveEmpNo(settings);
        if (!empNo) {
          send({ type: 'hrPay', patch: { status: { ts: Date.now(), error: '사번을 알 수 없어 급여명세서를 조회하지 못했습니다 (HR 화면에 프로필이 없음)' } } });
          return { ok: false, skipped: 'no-emp' };
        }
        lastRun = Date.now();
        const patch = await H.collect({ empNo, known: st.years || {}, years: [new Date().getFullYear()], force: !!force && reason === 'request-all' });
        patch.status = { ts: Date.now(), ok: true };
        await send({ type: 'hrPay', patch });
        log('collected', reason, patch.scan, patch.grade);
        return { ok: true, scan: patch.scan, grade: patch.grade || '', empNo, months: patch.lists.reduce((s, l) => s + l.total, 0) };
      } catch (e) {
        const msg = String((e && e.message) || e);
        const status = { ts: Date.now(), error: msg, loginRequired: !!(e && e.kind === 'login') };
        send({ type: 'hrPay', patch: { status } });
        log('collect failed', reason, msg);
        return { ok: false, error: msg, loginRequired: status.loginRequired };
      } finally { running = null; }
    })();
    return running;
  }

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'hrCollect') return;
      run(msg.all ? 'request-all' : 'request', !!msg.force).then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
      return true;
    });
  } catch (e) {}
  // 프로필(사번)이 그려진 뒤 시작. 로그인 직후 이동한 페이지에서는 새로 주입된 스크립트가 다시 실행된다
  const start = () => { if (!stopped) setTimeout(() => { run('load', false).catch((e) => log('run error', e)); }, 800); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
