---
title: ADR-0097 토폴로지 보기 ①이 건드리는 보호 경로 — 새 코어 단위, UX 여정, 두 문서의 앞부분
kind: decision
status: active
last_verified: 2026-11-05
enforced_by:
  - packages/core/src/topology/fold.test.ts
  - packages/core/src/topology/impact.test.ts
  - packages/core/src/topology/layers.test.ts
  - tests/spec/topology-scale.test.ts
touches_protected:
  - harness/config/architecture.yaml
  - harness/src/ux/score.ts
  - AGENTS.md
  - docs/design-docs/adr/0084-topology-view.md
amends_tests: []
decision_hash: 5f2fb9b47a8795cd
---
# ADR-0097 토폴로지 보기 ①이 건드리는 보호 경로

## 맥락
[ADR-0084](0084-topology-view.md)의 첫 구현(층 셋, 고장·알람·영향 범위, 접기)은 보호 경로 네 곳을 건드린다. 잠긴 시험은 고치지 않는다 — 기존 시험의 기대값이 바뀐 것이 하나도 없고, 새 시험은 `pnpm lock-tests`로 더한다.

## 결정
1. **코어에 단위 `core.topology`를 더한다** (`harness/config/architecture.yaml`). `packages/core/src/topology`는 kernel, catalog, world, physics만 쓴다. physics는 심각 온도(`RACK_CRITICAL_C`)를 읽으려는 것이고, catalog는 시험이 월드를 만들 때 쓴다. 이 단위는 월드를 **읽기만** 한다. 에이전트 툴이 쓰지 않는다(ADR-0087: 영향 범위는 화면과 채점용이다). 웹의 `web.logic`은 `core.*`를 이미 쓸 수 있어서 그쪽 규칙은 바뀌지 않는다.
2. **UX 여정 `topology`를 맨 뒤에 더한다** (`harness/src/ux/score.ts`: 예산 5번, 이름 "화성 실제 그대로 세계에서 토폴로지 열기"). 여정은 화성을 실제 크기로 올려 두고, 세계 목록에서 열어, 토폴로지를 누른 뒤 **타일 수 150개 이하**와 **첫 그림까지 3초 안**을 확인하고, 층을 바꾸고, 묶음 하나를 펼친다. 여정이 끝나면 그 세계를 숨겨서 뒤따르는 점검이 가장 큰 세계를 열지 않게 한다. 측정 항목 이름은 `JourneyId` 하나만 늘어나고 점수 계산은 그대로다.
3. **AGENTS.md의 검증 기록**만 더한다. `harness/config/architecture.yaml`이 바뀌어 `DOC010`이 났고, 지도의 단위 표에는 영향이 없음을 대조했다(코어 단위 하나가 늘었을 뿐 절대 규칙 표는 그대로다).
4. **ADR-0084의 앞부분**(front matter)에서 `enforced_by`를 위 시험으로 바꾸고 `no_enforcement_reason`을 지운다. 본문은 봉인된 그대로다.

## 이유
- 접기와 영향 범위는 세계 구조를 읽는 순수 계산이라 `world` 안에 두면 월드 단위가 화면 쪽 사정(묶음, 150개)을 알게 된다. 자기 단위로 두면 의존 방향이 그대로 위로만 간다.
- 150개와 3초는 읽기 위한 규칙이라, 말로만 두면 어느 날 조용히 넘는다. 여정이 실제 크기의 세계에서 재야 한다.

## 버린 대안
- **`core.world`에 넣기**: 단위가 커지고 화면의 사정이 아래로 스민다.
- **`web.logic`에만 두기**: 채점(영향 범위)이 같은 계산을 써야 해서 서버도 읽는다. 웹에만 있으면 둘이 갈라진다.

## 결과
- 새 시험: `fold.test.ts`, `impact.test.ts`, `layers.test.ts`, `words.test.ts`(코어), `topology.test.ts`(웹 계산), `tests/spec/topology-scale.test.ts`(화성 실제 크기).
- 고쳐진 잠긴 시험: 없음.
- 한계: 새 여정은 이 변경에서 돌려 보지 못했다(UX 측정은 4차 뒤 한 번만 돌린다, [차수 계획](../../exec-plans/active/beta-rounds.md)). 예산 5번은 손 수를 세어 정했다.
