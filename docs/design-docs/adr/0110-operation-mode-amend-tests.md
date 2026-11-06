---
title: ADR-0110 운영 모드를 구현하면서 ADR-0094의 강제 장치를 시험으로 잇는다
kind: decision
status: active
last_verified: 2026-11-06
enforced_by:
  - packages/core/src/session/operation/operation.test.ts
  - packages/core/src/session/operation/discrimination.test.ts
  - packages/core/src/topology/operation-marks.test.ts
  - apps/server/src/runtime/operation-run.test.ts
  - apps/server/src/runtime/alarm-wake.test.ts
  - apps/web/src/logic/operation.test.ts
touches_protected:
  - docs/design-docs/adr/0094-operation-mode.md
decision_hash: d60a1e4fc736966e
---
# ADR-0110 운영 모드 구현과 ADR-0094의 강제 장치

## 맥락
ADR-0094는 구현 전 결정이라 `enforced_by`가 `none`이었다("구현 작업이 끝나면 frontmatter의 `enforced_by`를 그 작업의 시험으로 바꾼다"). 운영 모드(REQ-090)가 구현되어, 결정 여덟 가지를 실제 시험이 지키게 되었다. ADR 파일은 보호 경로라서 이 frontmatter 변경은 봉인된 ADR이 같은 변경에 있어야 한다.

## 결정
1. ADR-0094의 `enforced_by`를 위 시험들로 바꾼다. 본문(결정 1~8)은 그대로이고 `decision_hash`도 그대로다.
2. 구현하면서 정한 세부(결정을 바꾸지 않는 해석)는 [운영 모드](../operation-mode.md)에 적었다: MTBF 표와 프리셋 배수, 시계 드라이버의 규칙(실시간 / 빨리 감기에서 새 알람·팀 사건 뒤 실제 5분, 툴 호출 뒤 실제 2초), 놓친 알람과 탐지 지연의 계산식, `wait`는 호스트가 실제 시간을 흘린 뒤 답한다는 규약.
3. 잠긴 시험은 바꾸지 않았다(`amends_tests` 없음). 새 시험은 REQ-090 꼬리표를 달고 새로 잠근다.

## 이유
- 구현 전에 쓴 결정이 구현 뒤에도 `none`으로 남으면 DOC080의 취지(결정은 강제 장치와 연결한다)가 무너진다.
- 세부 해석을 ADR 본문이 아니라 설계 문서에 두면 봉인된 결정을 건드리지 않고 고칠 수 있다.

## 버린 대안
- ADR-0094 본문에 구현 결과를 덧쓰기: 봉인 위반(DOC070)이다.
- 새 ADR 없이 frontmatter만 고치기: 보호 경로 변경이라 PROT001로 실패한다.

## 결과
ADR-0094는 `enforced_by`가 시험 여섯 개(위 목록이 ADR-0110과 같다)로 이어진다. 못 한 것(재시작 뒤 재개, 토큰·비용 상한, 지시문의 서버 저장)은 결정 8과 5의 일부로 남아 있고 [구현 계획](../../exec-plans/active/build-plan.md)에 적었다.
