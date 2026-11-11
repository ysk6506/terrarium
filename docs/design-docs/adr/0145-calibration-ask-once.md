---
title: ADR-0145 보정 시험은 한 번 돌리고 여러 번 묻는다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - tests/spec/calibration.test.ts
touches_protected:
  - harness/config/test-lock.json
amends_tests:
  - tests/spec/calibration.test.ts::<import:f610e077>
  - tests/spec/calibration.test.ts::=built
  - tests/spec/calibration.test.ts::a quick wrong answer earns nothing for being quick [REQ-070] > time and tool budget count as much as the diagnosis was right
  - tests/spec/calibration.test.ts::every built-in scenario tells an agent that knows from one that does not [REQ-070] [REQ-007] > %s
  - tests/spec/calibration.test.ts::every built-in scenario tells an agent that knows from one that does not [REQ-070] [REQ-007] > =cases
  - tests/spec/calibration.test.ts::every built-in scenario tells an agent that knows from one that does not [REQ-070] [REQ-007] > the scenarios that give full marks for the answer alone are exactly these (they measure diagnosis, not operation)
test_change_reason: 요구사항은 그대로이고 시험이 확인하는 사실도 그대로다. 같은 세계·시나리오·기준 에이전트의 실행을 시험마다 다시 돌리던 것을 한 번 돌려 나눠 쓰고, 시험이 단언하지 않는 탐침(probe) 계산을 빼서 CI의 시간 초과 흔들림(cdu-pump-fail 20초 안팎)을 없앤다.
decision_hash: 69fb11e84ac62252
---
# ADR-0145 보정 시험은 한 번 돌리고 여러 번 묻는다

## 맥락
`test-heavy` 작업이 `tests/spec/calibration.test.ts`의 `cdu-pump-fail` 시험 하나가 20초 한도 바로 위(19~20.5초)에 있어서 PR마다 동전 던지기처럼 떨어졌다. 같은 시간 안에 PR 둘이 같은 이유로 막혔고, main은 `gate`가 필수라 모든 합치기가 멈췄다.

시간을 재 보니(로컬, 코어 2개) 원인은 둘이었다.
1. **`calibrate`가 단언하지 않는 계산을 한다.** 시험이 읽는 것은 세 기준 에이전트(아무것도 안 함, 찍기, 정답만 앎)의 점수뿐인데, `calibrate`는 그 뒤에 서비스·도구 탐침(`withProbes`)을 돌린다. `cdu-pump-fail`은 한 시험 16.2초 중 탐침의 `recoveryPath`가 15.1초이고, 세 기준 에이전트는 합쳐서 1초 안팎이다.
2. **같은 계산을 두 번 한다.** 시나리오마다 한 번(시험 72개 중 71개), 그리고 "정답만으로 만점인 시나리오" 시험이 모든 시나리오에 한 번 더 돌렸다. 그 시험 하나가 87초였다. 세계 설계도(blueprint)도 `built()`를 부를 때마다 시나리오마다 새로 지었다.

## 결정
1. **제품 코드: `calibrateBaselines`를 내보낸다.** `calibrate`의 앞 절반(세 기준 에이전트를 돌려 `judge`로 판정)을 그대로 떼어 낸 함수다. `calibrate`는 `withProbes(calibrateBaselines(config), config)`이고 동작은 같다(`calibrate`를 쓰는 다른 시험과 서버가 그대로 쓴다).
2. **시험: 시나리오마다 기준 에이전트를 한 번만 돌린다.** 결과를 파일 안 `Map`에 두고, 시나리오별 시험과 "정답만으로 만점" 시험이 같은 결과를 읽는다. 결과는 읽기만 한다.
3. **시험: 세계 설계도와 색인을 세계마다 한 번만 짓는다.** 시나리오를 지을 세계 목록과 순서(처음으로 맞는 세계)는 그대로다.
4. **탐침은 이 시험이 단언하는 것이 아니다.** `recoveryPath`·`commonReach`·`shellReach`·`toolPickCheck`의 결과는 이 시험이 읽지 않는다. 탐침은 `calibrate`를 쓰는 시험이 단언한다. 예를 들어 `layer-scenarios`는 가속기·전원·냉방 층 시나리오(`cdu-pump-fail` 포함)의 `recoveryPath.ok`를, `domain-calibration`은 영역 밖 원인 시나리오의 `recoveryPath`를, `sdn-scenarios`·`app-scenarios`·`site-scenarios`는 각 층의 `recoveryPath`를 본다. 다만 이 파일이 69개 시나리오 전부에 탐침을 돌리던 것은 없어진다. 그 점은 남는 위험이다.

## 바뀌지 않는 것
- 검사하는 사실의 집합: 시나리오 69개 각각의 단언 4개(찍기·아무것도 안 함 점수 한도, 모르는 쪽이 합격하지 않음, 정답만과 바닥의 차이 30점 이상), 만점 시나리오 목록, 빠른 오답 시험 둘이 그대로다. 시험 이름과 개수(72개)도 그대로다.
- 시나리오·세계·에이전트 조합, `testTimeout`, 시험 안의 제한(180초), 제품 동작.
- 확인: 모든 시나리오에서 "공유한 설계도로 돌린 기준 에이전트 결과"가 "새 설계도로 돌린 `calibrate`의 결과"와 `runs` 전부 같았고, 시나리오 문서도 같았다.
- `Session`은 설계도를 바꾸지 않는다. 그래서 설계도를 나눠 써도 실행 사이에 상태가 새지 않는다.

## 이유
탐침 15초는 시험이 묻지 않는 것을 계산하는 비용이다. 제품에서 그 시간을 줄이려면 물리 계산을 바꿔야 하는데(프로파일은 평평하다. 한 곳이 아니라 모든 걸음에 고르게 든다) 이 일의 범위가 아니다. 시험이 묻는 것만 묻고, 묻는 것은 한 번만 계산하는 쪽이 사실을 하나도 줄이지 않는다.

## 버린 길
- 제한 시간 늘리기, 시험 건너뛰기: 시험을 약하게 한다(ADR-0004).
- `beforeAll`에 몰아 계산하기: 시간을 시험 밖으로 숨길 뿐이다.
- 시나리오를 더 작은 세계에 짓기: 시험이 보는 시나리오·세계 조합이 바뀐다.
- 탐침을 제품에서 빠르게 하기: 이 ADR의 범위 밖. 남은 느린 시험은 기준 에이전트의 `idle`(96시간을 걸음으로 도는 것) 때문이며 물리 계산 비용이다.

## 결과
calibration 파일이 로컬에서 173.5초에서 36.0초로, 가장 느린 시험이 87.7초에서 8.8초로 줄었다(`domain-port-network`). `cdu-pump-fail`은 14.5초에서 1초 아래다. 남은 느린 셋(`domain-port-network`, `domain-memory-vendor`, `sdn-tunnel-down`)은 한도 20초의 절반 아래다.
