---
title: ADR-0013 같은 호출을 두 번 비교하는 단언은 허용한다 (TEST003 보정)
kind: decision
status: active
last_verified: 2026-10-28
enforced_by:
  - TEST003
  - harness/src/checks/testguard.test.ts
touches_protected:
  - harness/src/checks/test-rules.ts
  - harness/src/checks/testguard.test.ts
decision_hash: d09864dc905dcc91
---
# ADR-0013 TEST003 보정

## 맥락
TEST003은 `expect(x).toBe(x)`처럼 절대 실패할 수 없는 단언을 막는다. 그런데 결정성 검증은 같은 함수를
두 번 호출해서 결과를 비교한다(`expect(run()).toEqual(run())`, `expect(freshSeed()).not.toBe(freshSeed())`).
식의 모양만 보면 같지만, 두 번의 평가는 서로 다른 값을 낼 수 있어서 실패할 수 있는 정당한 단언이다.

## 결정
비교하는 두 식이 같은 모양이어도, 그 안에 함수 호출(`call`, `new`)이 있으면 TEST003으로 보지 않는다.
호출이 없는 순수한 식(변수, 속성 접근, 리터럴)끼리 같을 때만 실패시킨다.

## 이유
규칙의 목적(실패할 수 없는 테스트 금지)은 그대로 지키고, 결정성·무작위성 테스트를 쓸 수 있게 한다.
이 경우를 증명하는 메타 테스트를 추가했다.
