# KR eClass + R&D ERP 현황 (Chrome 확장)

eClass 홈(`https://eclass.krs.co.kr/eClassVer4/Home/Index`)에 R&D ERP(`https://rnd.krs.co.kr`)의
**미승인내역(보완요청/신청)** 과 **과제별 카드미청구 내역**을 패널로 표시합니다.

## 설치 (압축해제된 확장 프로그램)

1. Chrome 주소창에 `chrome://extensions` 입력 → 우측 상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → 이 폴더(`E:\dev\kr_ext_rerp`) 선택
3. R&D ERP에 로그인된 상태(eClass에서 링크로 한 번 들어가 두면 됨)에서 eClass 홈을 열면 우측 상단에 패널이 뜹니다.
   - 로그인 세션이 없으면 패널에 "R&D ERP 로그인이 필요합니다"가 표시됩니다. R&D ERP를 열어 로그인 후 ↻를 누르세요.

## 표시 내용

| 구역 | 내용 | 데이터 출처 |
| --- | --- | --- |
| 미승인내역 | 보완요청 / 신청 건수 (클릭 시 R&D ERP로 이동) | 실시간 서비스(설정 필요) 또는 R&D ERP 메인화면 방문 시 화면에서 읽은 값 |
| 카드미청구 | 과제책임자 / 과제명 / 미청구 건수 / 금액. 과제 클릭 시 카드(뒤 8자리), 사용일시, 가맹점, 사용액 목록 | `rcomm_0009_01_r001`(과제 검색, 대체: `rmain_0005_01_r001`) + `rtask_0008_t05_01_r001`(과제정보 > 카드 탭, 미청구) |

패널은 기본적으로 eClass 본문의 "Popup Notice" 카드 위에 삽입되며, 설정에서 우측 상단 띄우기로 바꿀 수 있습니다.

툴바 아이콘 배지에는 카드미청구 총 건수가 표시되고, 아이콘을 누르면 같은 패널이 팝업으로 열립니다.

## 설정 (아이콘 우클릭 → 옵션, 또는 패널의 ⚙)

- **내 참여 과제만 보기**(기본 켜짐): 과제별 참여인력(`rtask_0008_t03_01_r001`, 참여구분 "계속")에 본인 학번/사번이 있는 과제만 남깁니다.
  사번은 R&D ERP 화면의 hidden 값(USER_ID/EMP_NO)과 "OOO님 반갑습니다" 문구에서 자동 감지하며 설정에서 직접 입력할 수도 있습니다.
  사번/이름을 모르면 다른 과제가 섞이지 않도록 과제를 표시하지 않습니다.
- **과제별 카드 귀속(계좌번호 규칙, 기본 켜짐)**: 과제카드발급내역의 카드 계좌번호가 그 과제 기본정보의 과제관리계좌(`rtask_0010_02_r003`)와 같은 카드만
  그 과제의 카드로 보고, 그 카드의 미청구 거래만 과제 밑에 표시합니다. 계좌가 다른 카드는 설정에서 과제별로 포함/제외를 재정의할 수 있습니다.
  어느 과제에도 귀속되지 않은 거래는 기본으로 숨기고, 설정의 "미귀속 카드 내역 표시"를 켜면 별도 묶음으로 보여줍니다.
- **과제 선택**: 조회된 과제 목록에서 체크를 해제한 과제는 카드 조회와 패널 표시에서 제외됩니다 (새 과제는 기본 포함).
- **카드번호 필터**: 전체 보기 / 선택한 카드만 보기. 과제별 **과제카드발급내역**(`rtask_0008_t01_01_r002`)을 불러와
  체크한 카드만 모니터링합니다. 목록에 없는 카드는 뒷자리(4~8자리)로 직접 추가할 수 있습니다.
- **조회 옵션**: 사용일자 조회 범위(기본 6개월 전 ~ 1개월 후), 0건 과제 숨김, 캐시/자동 갱신 주기
- **미승인내역 실시간 조회**: 아래 "미승인내역 서비스 확정" 참고
- **고급**: 서비스 ID / 입력 JSON (기본값은 R&D ERP 화면 스크립트에서 확인한 값)

## 미승인내역 서비스 확정 (1회 작업)

메인화면의 미승인내역 위젯 스크립트는 페이지에 인라인되어 있어 서비스 ID를 사전에 확인하지 못했습니다.
확장 프로그램이 R&D ERP 방문 중 호출되는 `.jct` 서비스를 자동으로 기록하므로 다음 절차로 확정합니다.

1. 확장 설치 후 R&D ERP(`rderp_layoutMain.act`) 메인화면을 한 번 엽니다.
2. 옵션 페이지 하단 **캡처 로그**에서 미승인내역 값을 돌려주는 서비스를 찾습니다(붉게 표시된 항목이 후보).
   - 찾기 어려우면 **전체 복사** 결과를 개발자에게 전달하면 됩니다.
3. 해당 항목의 **이 서비스 사용** → **테스트 호출** → 응답 JSON에서 보완요청/신청 필드명을 입력 → **저장**.

설정 전에도 메인화면을 방문하면 화면에서 읽은 값(방문 시각 기준)이 패널에 표시됩니다.

## 구조

```
manifest.json          MV3 매니페스트
background.js          서비스워커: 수집/캐시/배지/알람, 캡처 로그 저장
lib/rnd-api.js         R&D ERP .jct 호출 (_JSON_ 이중 인코딩, EUC-KR 디코딩, 세션 오류 감지)
lib/render.js          패널 렌더러 (eClass 삽입 / 팝업 공용)
lib/panel.css          패널 스타일 (krext- 접두어)
lib/format.js, lib/settings.js
content/eclass.js      eClass 홈에 패널 삽입
content/rnd-hook.js    rnd.krs.co.kr MAIN world: XHR/fetch 훅으로 .jct 호출 기록
content/rnd-bridge.js  rnd.krs.co.kr: 기록 전달 + 미승인내역 위젯 DOM 스냅샷
options/               설정 페이지 (카드 필터, 조회 옵션, 미승인내역 서비스, 캡처 로그)
popup/                 툴바 팝업
```

## R&D ERP 호출 규약 (분석 메모)

- `POST https://rnd.krs.co.kr/{서비스ID}.jct`, 본문 `_JSON_=encodeURIComponent(encodeURIComponent(JSON))`
- 응답 `application/json;charset=euc-kr`, `COMMON_HEAD.ERROR=true` 이면 오류. `CODE=GWM0001` 은 세션 없음(로그인 필요)
- 과제 목록: `rcomm_0009_01_r001` `{SEARCH_NM:"", SEARCH_GB:""(진행상태), GUBUN:"A", PRJ_AUTH:""}` → `REC[].PRJ_NO, ANL, PRJ_NM, PRJ_RSPR_EMP_NM, RCH_ST_DT, RCH_END_DT, PROG_STS_NM`
  (과제정보 화면의 과제책임자/과제명 검색 팝업 `rcomm_0009_01.act`와 동일)
- 과제 목록(대체): `rmain_0005_01_r001` `{SEARCH_GB:"D", STD_DT:yyyyMMdd}` → 종료 90일 이내 진행과제만 반환하므로 주 경로로는 부적합
- 카드 사용내역: `rtask_0008_t05_01_r001` `{USEFAC_SEQ_NO:"10", PRJ_NO, SEARCH_GB:"1"(미청구), CARD_DATE_GBN:"1"(사용일자), START_DATE, END_DATE, CARD_NO:""}`
  → `REC[].CARD_NO, USER_NM, USED_DATE, USED_TIME, SHOP_NAME, USED_COST, APPRNO, PRJ_CARD_DIV_NM, APPR_PLAN_DATE`
- 과제카드발급내역: `rtask_0008_t01_01_r002` (카드 사용내역과 같은 입력) → `REC[].CARD_NO, USER_NM, PRJ_CARD_DIV_NM, BNK_NM, ACCT_NO, SETL_DD, ISSU_DT`
- 과제관리계좌(기본정보): `rtask_0010_02_r003` `{PRJ_NO, USEFAC_SEQ_NO}` → `REC[].MNG_ACCT_DIV_CD(계좌구분), MNG_BNK_NM, MNG_ACCT_NO, MNG_ACCT_OWNR_NM, MNG_ACCT_BNK_NM(계좌내역), RES_NM`
- 참여인력: `rtask_0008_t03_01_r001` `{PRJ_NO, SEARCH_NM:"", SEARCH_GB:"1"(0 전체/1 계속/2 종료)}` → `INFO_REC[]`(계상률기준), `HM_PER_REC[]`(인력기준): `EMP_NO, EMP_NM, ROLE_NM, PART_TRM_DT, BLNG_YN`
