/* 설정 기본값 / 로드 / 저장 */
(function (g) {
  const DEFAULTS = {
    eclassPanel: true,                // eClass 홈에 패널 표시 (끄면 툴바 아이콘 팝업으로만 봄. content/eclass.js)
    panelMode: 'inline',              // 'inline'(eClass 본문에 삽입) | 'float'(우측 상단 띄우기)
    accountRule: true,                // 발급 카드의 계좌번호가 과제 계좌(지출계좌)와 같은 카드만 그 과제의 카드로 인정
    cardOverrides: {},                // { [과제번호]: { include: [카드숫자...], exclude: [카드숫자...] } } 계좌 규칙 재정의
    showShared: false,                // 어느 과제에도 귀속되지 않은(공용) 카드 내역 표시 여부
    cardFilterMode: 'all',            // 'all' | 'specific'
    selectedCards: [],                // 모니터링 카드 선택(숫자만, 전체 번호)
    cardFilterList: [],               // 직접 입력한 카드번호 뒷자리 목록 (예: "4126", "0478-4126")
    cardNames: {},                    // 카드 별명 { [카드번호 숫자(전체 또는 뒷자리)]: '별명' } - 패널에서 뒤 8자리 대신 표시
    monthsBack: 6,                    // 사용일자 조회 시작: N개월 전
    monthsForward: 1,                 // 사용일자 조회 종료: N개월 후
    hideZeroProjects: false,          // 미청구 0건 과제 숨김
    budgetItemInclude: {},            // 과제집행비율 비목별 포함 여부 { [비목명]: true(포함) | false(제외) } - 설정 페이지 목록에서 선택
    budgetExcludeDefault: ['인건비', '연구수당', '간접비'],   // 명시적으로 고르지 않은 비목의 기본값: 이름에 이 단어가 들어가면 제외, 아니면 포함
    projectStatusKeyword: '진행',     // 과제 진행상태명(PROG_STS_NM)에 이 문자열이 포함된 과제만 (비우면 전체)
    excludedProjects: [],             // 설정에서 제외한 과제번호 목록 (새 과제는 기본 포함)
    onlyMyProjects: true,             // 참여인력에 본인이 있는 과제만 (사번을 알 수 있을 때만 적용)
    myEmpNo: '',                      // 본인 학번/사번 (비우면 R&D ERP 방문 시 자동 감지값 사용)
    myName: '',                       // 본인 이름 (사번을 모를 때 참여인력 이름으로 대조. 동명이인이면 사번을 골라야 함)
    maxProjects: 30,                  // 조회할 과제 최대 수 (내 참여 과제만 보기를 끈 경우에만 적용. 참여 과제는 모두 표시)
    refreshMinutes: 10,               // 캐시 유지 / 자동 새로고침 주기(분)
    autoRefresh: true,
    rndUrl: 'https://rnd.krs.co.kr/rderp_layoutMain.act',
    rndAutoLogin: true,               // R&D ERP 세션이 풀려 조회가 "로그인 필요"로 끝나면 eClass SSO(loginCheck → sso_login_krs.jct → rderp_layoutMain.act)로 백그라운드에서 다시 로그인한 뒤 한 번 더 조회
                                      //   (background.js rndAutoLogin · lib/rnd-api.js ssoLogin). eClass 에 로그인돼 있어야 하고 탭은 열지 않음. eClass 도 풀려 있으면 "eClass 로그인 필요"로 안내
    claimHelper: {                    // R&D ERP 청구서(카드) 화면의 청구내역 폼 입력 도우미 (content/rnd-claim.js)
      enabled: true,                  // 끄면 아래 기능 모두 사용 안 함
      defaultBudget: '연구활동비',      // 예산(비목) 선택이 비어 있을 때 채울 항목명 (비우면 채우지 않음)
      defaultRcms: '본예산',            // RCMS 부가정보 > 사용금액구분이 비어 있을 때 채울 항목명 (비우면 채우지 않음)
      dragDrop: true,                 // 첨부문서 칸에 파일 드래그 앤 드롭
      quickPicks: [                   // "청구" 소제목 옆 세목 빠른 선택 버튼: "표시이름=세목 목록의 항목명(또는 일부)=청구종류 코드(또는 이름)".
        '연구실 운영비=연구실운영비',   //   항목명을 생략하면 표시이름으로 찾고, 청구종류를 적으면 세목이 그 항목으로 바뀔 때 "(83) …" 처럼 코드가 맞는 청구종류를 고른다
        '회의비=회의비=17',
        '클라우드 사용비=클라우드',
        '외부전문가 활용비=외부 전문기술=83',
        '소프트웨어 활용비=소프트웨어',
        '연구활동비 기타비용=기타비용'
      ]
    },
    hr: {                             // HR System(hr.krs.co.kr) 급여명세서 API 수집 → 패널 "급여·연구수당" 구역 (lib/hr-api.js, content/hr-pay.js)
      enabled: true,                  // 끄면 수집도 표시도 하지 않음
      url: 'https://eclass.krs.co.kr/eClassVer4/External/SSOMessage',   // 패널·팝업의 HR System 열기 링크, 자동 로그인 때 쓰는 주소.
                                      //   eClass 홈 메뉴 HR › Main Page 가 여는 SSO 중계 페이지("SSO Redirect")로, 인라인 JS 가 hr.krs.co.kr/sso-proc?UID&SID 로 이동해 HR 세션을 만든다.
                                      //   hr.krs.co.kr/ 를 직접 열면 로그아웃 상태에서는 SSO 없이 본문 없는 403 이라 자동 로그인이 안 됨 (2026-09-25 확인)
      autoLogin: true,                // 로그인이 풀려 있으면 위 주소로 SSO 자동 로그인 뒤 다시 읽기: 백그라운드에서 중계 페이지 → sso-proc 를 받아 보고, 안 되면 비활성 탭으로 열어 기다림 (background.js hrAutoLogin)
      baseItem: '기본연봉',            // 지급내역(소득명)에서 기본연봉 항목명
      researchItem: '연구수당지급',     // 지급내역(소득명)에서 연구수당 항목명 (올해 1월부터 합계)
      grade: '',                      // 직급 (P1~P4). 비우면 HR 직원 정보(gradeCode)에서 자동 감지한 값 사용
      gradeRates: { P1: 18, P2: 20, P3: 22, P4: 24 }   // 연구수당 한도(%) = 연 기본연봉(월 기본연봉 × 12) × 직급 비율
    },
    unapproved: {
      serviceId: 'rmain_0002_01_r006', // 미승인내역 건수 (메인화면 setPendingStatusCount 와 동일). refreshMinutes 마다 자동 갱신
      input: '{}',                    // 서비스 입력 JSON
      fields: { temp: 'TEMP_SAVE_CNT', supplement: 'SUPPLEMENT_CNT', apply: 'APPLY_CNT', purchase: 'BUY_REQ_CNT' }, // 응답 필드명
      linkUrl: 'https://rnd.krs.co.kr/rderp_layoutMain.act'
    },
    adv: {
      usefacSeqNo: '10',
      projectsService: 'rcomm_0009_01_r001',                              // 과제 검색 팝업(과제책임자/과제명)과 동일
      projectsInput: '{"SEARCH_NM":"","SEARCH_GB":"10","GUBUN":"A","PRJ_AUTH":""}',   // SEARCH_GB 진행상태 코드(10 진행, '' 전체 — 전체는 500건에서 잘림), PRJ_AUTH 과제권한(1 본인, 2 담당, 9 전체)
      projectsFallbackService: 'rmain_0005_01_r001',                      // 종료 90일 이내 진행과제 (대체 경로)
      cardsService: 'rtask_0008_t05_01_r001',
      cardsInput: '{"SEARCH_GB":"1","CARD_DATE_GBN":"1"}',
      issuedService: 'rtask_0008_t01_01_r002',  // 과제카드발급내역
      accountsService: 'rtask_0010_02_r003',    // 과제정보 > 기본정보 > 과제관리계좌
      expenseAcctDivCd: '',                     // 지출계좌 계좌구분 코드 (비우면 등록된 모든 계좌와 대조)
      participantsService: 'rtask_0008_t03_01_r001',            // 과제정보 > 참여인력
      participantsInput: '{"SEARCH_NM":"","SEARCH_GB":"1"}',    // 참여구분 0:전체 1:계속 2:종료
      budgetService: 'rcomm_0041_01_r004',                      // 과제정보 > 자금현황 > 비목별 잔액 (예산기준 10:과제예산)
      budgetInput: '{"REQ_CNT":"-1","RES_CD":"","PROC_TYP_CD":"","INCLUDE_TAX":"Y"}',  // RES_CD 비우면 전체 재원
      budgetBaseService: 'rcomm_0041_01_r006',                  // 예산기준 20:본예산 과제의 비목별 잔액 (BIZSECTION_CD, BGT_YEAR 필요)
      projectDetailService: 'rcomm_0102_01_r001'                // 과제 상세 (BGT_STD_CD 예산기준, BIZSECTION_CD, TOT_DIR_AMT/TOT_STD_AMT)
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
    // 이전 기본값(진행상태 전체 조회)은 서버가 500건에서 잘라 진행 과제가 빠질 수 있어 진행(10)만 조회하는 새 기본값으로
    if ((adv.projectsInput || '') === '{"SEARCH_NM":"","SEARCH_GB":"","GUBUN":"A","PRJ_AUTH":""}') adv.projectsInput = DEFAULTS.adv.projectsInput;
    // 이전 버전의 제외 키워드 목록(budgetExcludeItems) → 기본 제외 키워드로 이전
    if (Array.isArray(s.budgetExcludeItems)) { s.budgetExcludeDefault = s.budgetExcludeItems; delete s.budgetExcludeItems; }
    // 미승인내역 서비스가 비어 있으면(이전 버전은 사용자가 직접 찾아 넣어야 했음) 기본 서비스로 채움
    if (!s.unapproved || !String(s.unapproved.serviceId || '').trim()) {
      s.unapproved = Object.assign({}, DEFAULTS.unapproved, { linkUrl: (s.unapproved && s.unapproved.linkUrl) || DEFAULTS.unapproved.linkUrl }, { fields: Object.assign({}, DEFAULTS.unapproved.fields) });
    }
    // 이전 기본값(HR 루트 주소)은 로그아웃 상태에서 403 이라 자동 로그인이 안 됨 → eClass SSO 중계 주소로
    if (s.hr && /^https?:\/\/hr\.krs\.co\.kr\/?$/i.test(String(s.hr.url || '').trim())) s.hr.url = DEFAULTS.hr.url;
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
