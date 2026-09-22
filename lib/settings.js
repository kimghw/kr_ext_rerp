/* 설정 기본값 / 로드 / 저장 */
(function (g) {
  const DEFAULTS = {
    panelMode: 'inline',              // 'inline'(eClass 본문에 삽입) | 'float'(우측 상단 띄우기)
    accountRule: true,                // 발급 카드의 계좌번호가 과제 계좌(지출계좌)와 같은 카드만 그 과제의 카드로 인정
    cardOverrides: {},                // { [과제번호]: { include: [카드숫자...], exclude: [카드숫자...] } } 계좌 규칙 재정의
    showShared: false,                // 어느 과제에도 귀속되지 않은(공용) 카드 내역 표시 여부
    cardFilterMode: 'all',            // 'all' | 'specific'
    selectedCards: [],                // 모니터링 카드 선택(숫자만, 전체 번호)
    cardFilterList: [],               // 직접 입력한 카드번호 뒷자리 목록 (예: "4126", "0478-4126")
    monthsBack: 6,                    // 사용일자 조회 시작: N개월 전
    monthsForward: 1,                 // 사용일자 조회 종료: N개월 후
    hideZeroProjects: false,          // 미청구 0건 과제 숨김
    projectStatusKeyword: '진행',     // 과제 진행상태명(PROG_STS_NM)에 이 문자열이 포함된 과제만 (비우면 전체)
    excludedProjects: [],             // 설정에서 제외한 과제번호 목록 (새 과제는 기본 포함)
    onlyMyProjects: true,             // 참여인력에 본인이 있는 과제만 (사번을 알 수 있을 때만 적용)
    myEmpNo: '',                      // 본인 학번/사번 (비우면 R&D ERP 방문 시 자동 감지값 사용)
    maxProjects: 30,                  // 조회할 과제 최대 수
    refreshMinutes: 10,               // 캐시 유지 / 자동 새로고침 주기(분)
    autoRefresh: true,
    rndUrl: 'https://rnd.krs.co.kr/rderp_layoutMain.act',
    unapproved: {
      serviceId: '',                  // 미승인내역 서비스 ID (예: rmain_0002_01_r001) - 캡처 후 설정
      input: '{}',                    // 서비스 입력 JSON
      fields: { temp: '', supplement: '', apply: '', purchase: '' }, // 응답 필드명
      linkUrl: 'https://rnd.krs.co.kr/rderp_layoutMain.act'
    },
    adv: {
      usefacSeqNo: '10',
      projectsService: 'rcomm_0009_01_r001',                              // 과제 검색 팝업(과제책임자/과제명)과 동일
      projectsInput: '{"SEARCH_NM":"","SEARCH_GB":"","GUBUN":"A","PRJ_AUTH":""}',
      projectsFallbackService: 'rmain_0005_01_r001',                      // 종료 90일 이내 진행과제 (대체 경로)
      cardsService: 'rtask_0008_t05_01_r001',
      cardsInput: '{"SEARCH_GB":"1","CARD_DATE_GBN":"1"}',
      issuedService: 'rtask_0008_t01_01_r002',  // 과제카드발급내역
      accountsService: 'rtask_0010_02_r003',    // 과제정보 > 기본정보 > 과제관리계좌
      expenseAcctDivCd: '',                     // 지출계좌 계좌구분 코드 (비우면 등록된 모든 계좌와 대조)
      participantsService: 'rtask_0008_t03_01_r001',            // 과제정보 > 참여인력
      participantsInput: '{"SEARCH_NM":"","SEARCH_GB":"1"}'     // 참여구분 0:전체 1:계속 2:종료
    }
  };
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!isObj(over)) return out;
    for (const k of Object.keys(over)) {
      out[k] = (isObj(base[k]) && isObj(over[k])) ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }
  /* 이전 버전 기본값이 저장돼 있으면 새 기본값으로 교체 */
  function migrate(s) {
    const adv = s.adv || {};
    if (adv.projectsService === 'rmain_0005_01_r001' && (adv.projectsInput || '') === '{"SEARCH_GB":"D"}') {
      adv.projectsService = DEFAULTS.adv.projectsService;
      adv.projectsInput = DEFAULTS.adv.projectsInput;
    }
    return s;
  }
  async function load() {
    let stored = {};
    try { stored = (await chrome.storage.sync.get('settings')).settings || {}; }
    catch (e) { stored = (await chrome.storage.local.get('settings')).settings || {}; }
    return migrate(merge(DEFAULTS, stored));
  }
  async function save(s) {
    try { await chrome.storage.sync.set({ settings: s }); }
    catch (e) { await chrome.storage.local.set({ settings: s }); }
  }
  function parseJson(s, fallback) { try { return s ? JSON.parse(s) : (fallback || {}); } catch (e) { return fallback || {}; } }
  g.KRX_SETTINGS = { DEFAULTS, merge, load, save, parseJson };
})(typeof self !== 'undefined' ? self : this);
