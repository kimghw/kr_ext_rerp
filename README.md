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
| 미승인내역 | 보완요청 / 신청 건수 (클릭 시 R&D ERP로 이동) | `rmain_0002_01_r006` 실시간 조회(갱신 주기마다), 실패 시 R&D ERP 메인화면 방문 시 화면에서 읽은 값 |
| 카드미청구 | 과제책임자 / 과제명 / 미청구 건수 / 금액. 과제 클릭 시 카드(뒤 8자리), 사용일시, 가맹점, 사용액 목록 | `rcomm_0009_01_r001`(과제 검색, 대체: `rmain_0005_01_r001`) + `rtask_0008_t05_01_r001`(과제정보 > 카드 탭, 미청구) |
| 과제집행비율 | 같은 과제 목록에서 과제별 집행비율 막대 / 예산잔액. 과제 클릭 시 비목 / 예산 / 예산잔액 / 집행비율 표 + **미청구(과제카드)** 행 + 합계 | `rcomm_0041_01_r004`(과제정보 > 자금현황 > 비목별 잔액; 본예산 과제는 `rcomm_0041_01_r006`) + 카드미청구 내역 |

카드미청구 / 과제집행비율은 구역 제목의 스위치로 전환하며 마지막 선택이 기억됩니다. 책임자·과제 목록은 두 보기가 공통입니다.

**집행비율 계산**: 비목별 집행비율은 R&D ERP 자금현황과 같이 `승인액(B) ÷ 예산액(A)` 입니다.
과제 합계 집행비율은 여기에 **이 과제 카드의 미청구 사용액**(청구 전이라 아직 승인액에 잡히지 않은 금액)을 더해 `(승인액 합계 + 미청구액) ÷ 예산액 합계` 로 계산하고,
합계 예산잔액도 미청구액을 뺀 값으로 표시합니다. 같은 계좌를 쓰는 다른 과제와 공용인 거래는 어느 과제에도 넣지 않습니다.
표의 "미청구" 행은 비목이 정해지기 전이므로 예산 열은 비어 있고, 잔액 차감액과 예산 대비 비율만 표시합니다. ERP 상단의 "직접비 집행비율(인건비 포함)" 값도 펼친 표 아래에 함께 보여줍니다.
설정의 **과제집행비율 비목 선택**에서 조회된 모든 비목을 하나씩(또는 모두 선택/해제로) 포함·제외할 수 있으며, 제외한 비목은 합계·비율 계산과 표에서 모두 빠집니다.
아직 고르지 않은 비목은 이름에 인건비·연구수당·간접비가 들어가면 기본 제외, 그 외는 기본 포함입니다.

패널은 기본적으로 eClass 본문의 "Popup Notice" 카드 위에 삽입되며, 설정에서 우측 상단 띄우기로 바꿀 수 있습니다.
제목 줄(버튼 제외) 아무 곳이나 클릭하면 접고 펼 수 있으며, 접힘 상태는 기억됩니다.

툴바 아이콘 배지에는 카드미청구 총 건수가 표시되고, 아이콘을 누르면 같은 패널이 팝업으로 열립니다.

## 설정 (아이콘 우클릭 → 옵션, 또는 패널의 ⚙)

- **내 참여 과제만 보기**(기본 켜짐): 과제별 참여인력(`rtask_0008_t03_01_r001`, 참여구분 "계속")에 본인 학번/사번이 있는 과제만 남깁니다.
  사번은 R&D ERP 레이아웃(`rderp_layoutMain.act`)의 hidden 값 `MAND_USER_ID`(전역 `gUserId`)와 메인 프레임의 "OOO님, 안녕하세요." 문구에서 자동 감지하며, 설정에서 사번 또는 이름을 직접 입력할 수도 있습니다.
  사번이 참여인력 `EMP_NO`와 맞으면 사번만 씁니다. 이름으로만 대조할 때 같은 이름의 사번이 둘 이상(동명이인)이면 과제를 표시하지 않고 패널·설정 페이지에 후보(이름·사번·역할·과제)를 보여주며, 설정에서 본인 사번을 고르면 바로 다시 조회합니다.
  사번/이름을 모르면 다른 과제가 섞이지 않도록 과제를 표시하지 않습니다. 이때 R&D ERP 탭이 열려 있으면 확장이 브리지 스크립트를 그 탭에 직접 넣어(`scripting` 권한) 사용자 정보를 읽어 온 뒤 다시 판정하므로, 확장을 설치/재로드한 뒤 ERP 페이지를 다시 열 필요가 없습니다.
- **과제별 카드 귀속(계좌번호 규칙, 기본 켜짐)**: 과제카드발급내역의 카드 계좌번호가 그 과제 기본정보의 과제관리계좌(`rtask_0010_02_r003`)와 같은 카드만
  그 과제의 카드로 보고, 그 카드의 미청구 거래만 과제 밑에 표시합니다. 계좌가 다른 카드는 설정에서 과제별로 포함/제외를 재정의할 수 있습니다.
  어느 과제에도 귀속되지 않은 거래는 기본으로 숨기고, 설정의 "미귀속 카드 내역 표시"를 켜면 별도 묶음으로 보여줍니다.
- **과제 선택**: 조회된 과제 목록에서 체크를 바꾸면 바로 저장·적용되어, 해제한 과제는 카드 조회와 패널 표시에서 제외됩니다 (새 과제는 기본 포함).
- "과제별 카드 귀속", "모니터링 카드 선택", "미승인내역 실시간 조회", "고급: 서비스 ID / 입력값" 구역은 제목을 클릭해 접고 펼 수 있으며(기본 접힘), 마지막 상태를 기억합니다.
  접힌 제목 옆에 과제·카드 수, 필터 모드, 미승인내역 서비스 설정 여부, 고급 설정 변경 여부가 요약으로 표시됩니다.
- **카드번호 필터**: 전체 보기 / 선택한 카드만 보기. 과제별 **과제카드발급내역**(`rtask_0008_t01_01_r002`)을 불러와
  체크한 카드만 모니터링합니다. 목록에 없는 카드는 뒷자리(4~8자리)로 직접 추가할 수 있습니다.
- **과제집행비율 비목 선택**(과제 선택 바로 아래): 선택한 과제의 자금현황에서 조회된 비목 목록에 체크 = 포함, 해제 = 계산·표에서 제외. 모두 선택/해제 버튼이 있고 체크를 바꾸면 바로 저장·적용됩니다.
  아직 목록에 없는 비목은 이름에 인건비·연구수당·간접비가 들어가면 기본 제외(설정값 `budgetExcludeDefault`), 그 외는 기본 포함입니다.
- **조회 옵션**: 사용일자 조회 범위(기본 6개월 전 ~ 1개월 후), 0건 과제 숨김(카드미청구 보기에만 적용), 캐시/자동 갱신 주기
- **미승인내역 실시간 조회**: 기본값이 메인화면과 같은 서비스(`rmain_0002_01_r006`, 아래 참고)라 별도 설정 없이 갱신 주기마다 자동 조회됩니다. 다른 서비스로 바꾸고 싶을 때만 수정
- **고급**: 서비스 ID / 입력 JSON (기본값은 R&D ERP 화면 스크립트에서 확인한 값)

## 미승인내역 실시간 조회

메인화면(`rmain_0002_01.act`)의 `setPendingStatusCount()`가 호출하는 서비스를 그대로 씁니다.

- 서비스 `rmain_0002_01_r006`, 입력 `{}` → `TEMP_SAVE_CNT`(임시저장), `SUPPLEMENT_CNT`(보완요청), `APPLY_CNT`(신청), `BUY_REQ_CNT`(구매요청). 조회기간은 서버가 최근 1개월로 고정
- 카드미청구·과제집행비율과 같은 주기(설정 "캐시 유지 / 자동 갱신 주기", 기본 10분, 최소 1분)로 백그라운드에서 갱신되며, 패널의 ↻ 로 즉시 갱신할 수 있습니다
- 서비스 호출이 실패하면(세션 만료 등) 마지막으로 메인화면을 방문했을 때 화면에서 읽은 값(방문 시각 표시)을 대신 보여줍니다
- 이전 버전에서 서비스 ID를 비워 둔 채 저장한 설정은 자동으로 기본 서비스로 바뀝니다

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
- 비목별 잔액(과제정보 > 자금현황 탭 `rtask_0008_t06_01`, 공통 모듈 `/js/jsp/rderp/rderp_bgtAmtInfo.js`):
  - 예산기준 10(과제예산): `rcomm_0041_01_r004` `{USEFAC_SEQ_NO, PRJ_NO, REQ_CNT:"-1", RES_CD:""(전체 재원), PROC_TYP_CD:"", INCLUDE_TAX:"Y"}`
    → `REC[].RES_NM, RES_CD, EXP_CD, MARK_EXP_NM(비목), CARY_AMT(이월), INTER_AMT(이자), CALC_BGT_AMT, BGT_AMT(예산액 A), PURCH_REQ_AMT, REQ_AMT, APPR_AMT(승인액 B), ADJ_AMT, BAL_AMT(예산잔액 A-B), DIR_COST_YN, PSNL_COST_YN, BGT_ITEM_NM, ATIT_NM`
  - 예산기준 20(본예산): `rcomm_0041_01_r006` `{USEFAC_SEQ_NO, PRJ_NO, REQ_CNT:"-1", BIZSECTION_CD, BGT_YEAR}` → `REC[].BGT_ITEM_NM, ATIT_NM, BGT_AMT, REQ_AMT, APPR_AMT, ADJ_AMT, BAL_AMT`
  - 집행비율(`APPR_RT`)은 서버 응답에 없고 화면에서 `trunc(APPR_AMT / BGT_AMT * 100, 2)` 로 계산 (둘 다 양수일 때만). 상단 "직접비 집행비율"은 DIR_COST_YN 또는 PSNL_COST_YN 인 비목의 승인액 합 ÷ 예산액 합
- 과제 상세: `rcomm_0102_01_r001` `{USEFAC_SEQ_NO, PRJ_NO}` → `BGT_STD_CD(예산기준 10/20/90), PRJ_CATE_CD, BIZSECTION_CD, TOT_DIR_AMT(직접비), TOT_STD_AMT(간접비), RCH_ST_DT`
- 자금현황 요약(미사용): `rcomm_0041_01_r002` `{USEFAC_SEQ_NO, PRJ_NO, RES_CD, INCLUDE_TAX}` → `INQ_AGRMT_AMT(협약액), INQ_RCV_AMT(입금액), INQ_APPR_REQ_AMT(승인액), INQ_REQ_BAL_AMT(미승인액), INQ_REQ_POSS_AMT(청구가능액)`
- 과제정보 화면 탭 ID: 01 기본정보, 02/03 예산·참여인력(과제예산일 때만), 04 청구결의서, 05 카드, 06 자금현황, 11 지출현황. 딥링크 `rtask_0008_t00_01.act?PRJ_NO=…&TAB_ID=06`
