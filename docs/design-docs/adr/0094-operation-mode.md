---
title: ADR-0094 운영 모드 — 끝이 없는 실험, 당겨서 보는 모니터링, 실시간과 빨리 감기
kind: decision
status: active
enforced_by:
  - packages/core/src/session/operation/operation.test.ts
  - packages/core/src/session/operation/discrimination.test.ts
  - packages/core/src/topology/operation-marks.test.ts
  - apps/server/src/runtime/operation-run.test.ts
  - apps/server/src/runtime/alarm-wake.test.ts
  - apps/web/src/logic/operation.test.ts
touches_protected:
  - docs/product-specs/requirements.md
decision_hash: 46c2eff583ef3898
---
# ADR-0094 운영 모드 — 끝이 없는 실험, 당겨서 보는 모니터링, 실시간과 빨리 감기

## 맥락
실험은 전부 과제 모양이었다(시나리오 하나, `submit_diagnosis`나 한도에서 끝). 48시간 자율 운영(대회의 본 종목)은 끝이 없고 고장이 무작위로 나며 에이전트가 상주해야 한다. 현실의 운영자는 깨워 주길 기다리지 않고 모니터링을 계속 본다(제품 책임자).

## 결정
1. **고장 발생기.** 장비 종류마다 고장률(MTBF, 시드 재현)과 시간대 패턴. "조용함·보통·바쁨" 또는 "이 세트를 n시간 안에 무작위 순서로". 연쇄·동시 고장 확률.
2. **시간.** "실시간"(세계의 시간 = 실제 시간; 공식 점수는 이것만) / "빨리 감기"(조용할 때만 10~60배, 알람이 나면 실제 속도; 결과에 표시). 기록에는 세계 시간·실제 시간 두 열. "벽시계" 같은 개발자 말은 화면에 쓰지 않는다.
3. **끝.** `submit_diagnosis`는 사건 하나를 닫는 것. 운영은 정해진 세계 시간이나 사람의 멈춤으로만 끝난다.
4. **모니터링은 당기기.** 세계는 아무것도 밀어 주지 않는다. 툴: `list_alarms`, `events_since(cursor)`, `query_metrics`, `service_status`, `wait(seconds)`. 안 보면 알람은 쌓이고 "놓친 알람"이 된다. 얼마나 자주 볼지는 에이전트의 선택이고 그 줄다리기(놓친 알람 vs 비용)가 측정 대상. "알람마다 깨우기"는 비교 변수로만.
5. **운영 지시문.** 실험 만들기에 "에이전트에게 주는 지시문" 칸과 권장안(5분마다 `events_since`, 복구 먼저, 조치 전 영향 확인, 못 하면 `ask_human`, 조용하면 `wait`), 옆에 "왜 이렇게 쓰나" 한 줄씩, 하네스별 주의. 저장해 두기 패턴.
6. **설계 가이드 + 기준 에이전트.** 개발자 안내서(운영 모드 동작·툴 전부와 규약·점수가 되는 것·하네스별 상주 루프 예)와 최소 기준 에이전트 소스. 연결 화면의 "운영 모드로 연결"에서 바로 간다. 대회의 규정집.
7. **측정.** 서비스 가용률, 사건별 복구 시간 분포, 놓친 알람, 탐지 지연(발생→알아챈 시각), 악화, 에스컬레이션, 사건당 비용, 조용할 때 쓴 비용, 감시 주기. 타임라인(알람 점·복구 막대·"봤다" 점·사람 개입)과 리플레이.
8. **운영상 필요.** 서버 재시작 뒤 재개, 하네스 끊김 기록과 재연결, 중간 점검 카드("14시간째 · 열린 사건 1"), 토큰·비용 상한.

## 결과
REQ-090. 백업·복구·업그레이드(오픈 단계)와 겹친다.
