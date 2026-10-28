---
title: ADR-0014 근거가 충분할 때만 커버리지 하한을 올린다
kind: decision
status: active
last_verified: 2026-10-28
enforced_by:
  - COV001
  - COV003
  - harness/src/checks/ratchets.test.ts
touches_protected:
  - harness/src/checks/coverage.ts
  - harness/src/checks/ratchets.test.ts
  - harness/config/coverage-floor.json
amends_tests:
  - "harness/src/checks/ratchets.test.ts::coverage ratchet [REQ-023] > the CLI prints ratcheted floors"
test_change_reason: "ADR-0014 caps ratcheted floors at 98%, so a unit measured at 99% now gets a 98% floor instead of 99%."
decision_hash: 1593b01c7babfcb7
---
# ADR-0014 커버리지 래칫의 근거 기준

## 맥락
래칫이 코드가 거의 없는 단위(빈 index.ts만 있는 단위)를 100%로 측정해 하한을 100으로 올렸다. 실제 코드가 들어오는 순간
실패하고, 하한은 내릴 수 없으므로 개발이 막힌다. 또 하한이 정확히 100이면 방어 코드 한 줄 때문에 전체가 실패한다.

## 결정
- 측정된 줄+분기가 50개 미만인 단위는 래칫이 하한을 최소값(90%) 위로 올리지 않는다.
- 래칫이 정하는 하한의 최댓값은 98%다.
- 하한은 여전히 내려가지 않는다(`COV003`). 이 변경과 함께 아직 빈 단위의 하한을 90으로 정정했다.

## 이유
하한은 "이미 달성한 수준"의 기록이어야 한다. 측정 근거가 없는 숫자를 기록하면 래칫이 품질 대신 우연을 고정한다.
