---
title: ADR-0103 토폴로지 보기 ②가 건드리는 보호 경로 — ADR-0084의 강제 장치에 새 시험을 잇는다
kind: decision
status: active
enforced_by:
  - tests/spec/run-replay.test.ts
  - packages/core/src/session/run-events.test.ts
  - apps/server/src/runtime/run-events.test.ts
  - apps/web/src/logic/topology/replay.test.ts
touches_protected:
  - docs/design-docs/adr/0084-topology-view.md
amends_tests: []
decision_hash: 50e5b77878f48dd9
---
# ADR-0103 토폴로지 보기 ②가 건드리는 보호 경로

## 맥락
[ADR-0084](0084-topology-view.md)의 두 번째 구현(에이전트 맥박·말풍선, 리플레이 시간 막대, 나란히 보기, 결과 첫 줄)과 [ADR-0088](0088-data-reuse.md) 1번(실행은 불변 사건 기록, 세계 시간·실제 시간)의 앞 절반이 들어간다. 잠긴 시험은 고치지 않는다 — 기존 시험의 기대값이 바뀐 것이 하나도 없고, 새 시험은 `pnpm lock-tests`로 더한다. 공기 흐름 지도와 토폴로지 보기에 따로 있던 시간 막대는 하나(`ui/replay`)로 합쳤다. 두 막대를 직접 읽던 잠긴 시험은 없다.

## 결정
1. **ADR-0084의 앞부분**(front matter)에서 `enforced_by`에 이 변경의 시험을 더한다. 본문은 봉인된 그대로다.
   - `tests/spec/run-replay.test.ts`: 실제 한 판의 사건으로 `stateAt`, 표식, 첫 줄, 말풍선의 말, 사건 1만 개가 100 ms 안인 것.
   - `packages/core/src/session/run-events.test.ts`, `apps/server/src/runtime/run-events.test.ts`: 사건 기록이 덧붙이기만 하는 것, 두 시계, 구간 조회, 실행 중 조회.
   - `apps/web/src/logic/topology/replay.test.ts`: 막대의 키·눈금·재생 계산, 말풍선.
2. **`stateAt` 시험은 `tests/spec`에 둔다.** 진짜 `Session`으로 한 판을 돌려 사건을 얻는데, `core.topology`는 session·scenario·tools를 쓸 수 없다(`ARCH010`). 단위 규칙을 풀지 않고 시험을 단위 바깥으로 옮겼다. 시험이 `performance.now()`로 시간을 재는 것도 `tests/`에서는 허용된다.
3. **사건 1만 개 100 ms는 체크포인트 없이 지킨다.** `stateAt`은 순수한 접기이고 1만 개에 0.5 ms쯤 걸려서(CPU 2개 환경에서 잰 값) 체크포인트를 두지 않는다. 사건이 100배 늘어 이 시험이 흔들리면 그때 둔다.

## 이유
- 맥박과 리플레이와 첫 줄은 모두 같은 사건 나열을 읽는다. 시험이 그 나열의 불변성과 접기의 결정성을 막아 주지 않으면 화면이 조용히 어긋난다.
- 시간 막대가 둘이면 같은 순간을 두 번 구현하고, 하나가 어긋나면 3D와 토폴로지가 서로 다른 순간을 보인다.

## 버린 대안
- **`core.topology`에 `session`을 허용하기**: 읽기 전용 계산 단위가 실행 쪽을 알게 된다. 시험 하나 때문에 의존 방향을 바꾸지 않는다.
- **체크포인트를 먼저 만들기**: 재지 않은 최적화다. 재 보니 필요 없었다.

## 결과
- 새 시험: 위 네 파일.
- 고쳐진 잠긴 시험: 없음.
- 한계: 이 변경에서 UX 측정(`pnpm ux`)은 돌리지 않았다(4차 뒤 한 번만, [차수 계획](../../exec-plans/active/beta-rounds.md)).
