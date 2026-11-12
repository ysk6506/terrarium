---
title: ADR-0126 run-all은 이끼 검사도 돌린다 (0124 보정)
kind: decision
status: active
enforced_by:
  - harness/src/common.test.ts
touches_protected:
  - harness/config/test-lock.json
amends_tests:
  - harness/src/common.test.ts::check entry points [REQ-024] > run-all runs every check and prints a verdict
test_change_reason: ADR-0124가 이끼 검사(MOSS001~004)를 더했으므로 run-all이 도는 검사 목록이 하나 늘었다. 시험의 기대 목록에 moss를 더한다.
decision_hash: 7f07b42a374fe2be
---
# ADR-0126 run-all은 이끼 검사도 돌린다

## 맥락
ADR-0124가 `harness/src/checks/moss.ts`를 더하고 `run-all`에 넣었지만, `run-all`이 모든 검사를 돈다는 잠긴 시험의 기대 목록은 그대로였다. 그래서 main에서 그 시험이 실패했다.

## 결정
`run-all`이 도는 검사는 architecture · docs · debt · test-integrity · traceability · moss 여섯이다. 시험의 기대 목록에 `moss`를 더한다.

## 결과
- 시험 한 곳을 고친다(위 `amends_tests`).
