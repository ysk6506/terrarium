---
title: ADR-0121 애플리케이션 층을 코어 모델로 올리고 서비스 호출 그래프를 넣는다 — 시험의 목록 기대값을 늘린다
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - tests/spec/app-physics.test.ts
  - tests/spec/app-scenarios.test.ts
  - tests/spec/physics-golden.test.ts
  - packages/core/src/sources/worldgen/shaped-app.test.ts
  - apps/web/src/logic/world-shape/app-cards.test.ts
  - apps/web/src/logic/topology/headers.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - apps/web/src/logic/tool-picker.test.ts::the tool cards [REQ-080] > a search narrows the cards to the tools that answer it, by name, title, card or tag
  - "apps/web/src/logic/world-shape/world-shape.test.ts::HA 사다리: 선택지와 카드 [REQ-094] > 점선은 ADR-0107 결정 5의 목록 그대로다"
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > in the sample hall every supported fault can be used, each as its own block
  - packages/core/src/world/test-support/sample-campus.ts::=campusBlueprint
  - packages/core/src/world/test-support/sdn-lab.ts::=SdnLabOptions
  - packages/core/src/world/test-support/sdn-lab.ts::=sdnLab
  - packages/core/src/world/world-edges.test.ts::lookups and labels at the edges [REQ-001] > only the four virtual kinds are virtual
  - tests/spec/calibration.test.ts::=WORLDS
  - tests/spec/calibration.test.ts::every built-in scenario tells an agent that knows from one that does not [REQ-070] [REQ-007] > the scenarios that give full marks for the answer alone are exactly these (they measure diagnosis, not operation)
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/controllability.test.ts::=Drive
  - tests/spec/controllability.test.ts::an agent really controls each thing on the list [REQ-069] [REQ-007] > %s changes the world and is scored as the action it is
  - tests/spec/physics-golden.test.ts::=worlds
  - tests/spec/sdn-physics.test.ts::the cloud-native layer [REQ-097] > a policy deployed with a deny cuts just that pair of services, and policy_revert undoes it
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
test_change_reason: 애플리케이션 층(REQ-100)은 세계에 새 개체 일곱 종류와 링크 `calls`, 고장 여덟, 툴 여덟, 시나리오 일곱을 더한다. 잠긴 시험 가운데 목록의 길이나 모음을 직접 세는 시험(툴 수 58에서 66, 가상 종류 넷에서 열하나, 점선 아홉에서 다섯, 제어 가능 요소 목록, 장면 팔레트의 고장 목록, 도구 카드 검색)은 목록이 늘어난 만큼 기대값을 고쳤다. 네트워크 정책 시험은 정책이 이제 한 쌍이 아니라 지키는 서비스를 부르는 모든 서비스에 닿는 것을 읽는다(호출 선이 없는 세계의 결과는 같다). 시험 도우미(캠퍼스 샘플, SDN 실험 세계, 변별력 점검의 세계 목록과 그 점검에 드는 시간 한도(시나리오가 일곱 늘어 20초가 모자라다), 제어 가능 요소 시험의 `Drive`, 물리 골든의 세계 목록)는 애플리케이션 층 세계를 더하는 방향으로만 늘렸고 기존 값(골든 해시 포함)은 하나도 바꾸지 않았다.
decision_hash: 4984ef9d061866fa
verification_log:
  - "2026-11-07: o5 합치기 (애플리케이션 층)"
---
# ADR-0121 애플리케이션 층을 코어 모델로 올리고 서비스 호출 그래프를 넣는다

## 맥락
ADR-0107 결정 5는 사다리의 앱 칸 넷(상태 없는 앱, 마이크로서비스, 서비스 메시, 멀티 리전)을 점선으로 남겼다. 이 칩들은 서비스가 서로를 부르는 선이 세계에 없어서 만들 수 없었다. SDN의 `network_policy_deny`도 정책의 `from` 속성으로 한 쌍만 끊을 수 있었다. 컨테이너 층(ADR-0114)과 SDN 층(ADR-0115)이 같은 방식으로 칩을 실선으로 올렸다.

## 결정
1. **`calls` 링크를 둔다.** 서비스(또는 컨테이너 층의 워크로드)에서 서비스로 가고, 속성은 `critical`, `fanout`, `timeoutMs`이다. 상대가 멈추면 부르는 서비스는 느려지고, `critical`이면 멈춘다. 서킷 브레이커가 있으면 상대가 멈춰도 부르는 서비스는 느려질 뿐이고, 상대가 돌아오면 브레이커가 반열림으로 한 번 시험한 뒤 알아서 닫는다.
2. **개체 일곱을 가상 종류로 더한다.** `app_instance`, `load_balancer`, `session_store`, `circuit_breaker`, `mesh_sidecar`, `mesh_control`, `region`. 랙 자리가 없고, 상태는 물리(`physics/app.ts`)가 옮기고, 서비스 건강은 그 상태를 읽는다(`world/app-health.ts`, `world/calls-health.ts`).
3. **고장 여덟, 툴 여덟, 시나리오 일곱을 더한다.** 고장마다 `FAULT_TOOLS`, `FAULT_RESPONSES`, 리드타임 행, MTBF 행, 제어 가능 요소표 행이 있다. 로드 밸런서의 백엔드 빼기, 브레이커의 열고 닫기, 글로벌 로드 밸런서의 리전 넘기기는 원인 `cluster`로 남아 에이전트의 조치로 세지 않는다. 메시 컨트롤 플레인이 멈춰도 트래픽은 흐른다(헤드리스).
4. **네트워크 정책은 `calls`를 따라간다.** 정책은 지키는 서비스 하나에 붙고, `deny`이면 그 서비스를 부르는 서비스들이 느려진다. 정책의 `from` 속성이 만들던 한 쌍 끊기는 없앴다. 호출 선이 없는 세계에서는 지키는 서비스만 느려진다.
5. **앱 칸 네 칩을 실선으로 올린다.** 점선은 아홉에서 다섯이 된다. 세계 생성기는 칩마다 인스턴스·로드 밸런서·세션 저장소·브레이커·사이드카·두 번째 리전을 짓는다. 칩 카드의 "생기는 고장"은 실제 고장 목록과 같다.
6. **토폴로지 머리글이 겹치지 않게 한다.** 단계가 열다섯을 넘어 머리글이 서로를 덮었다. 짧은 말(가능하면 다섯 글자 이하)을 쓰고, 칸이 좁으면 글자 크기를 줄이다 두 줄로 나눈다. 너비 1,200px에서 어떤 두 머리글 상자도 겹치지 않는 것을 기하만으로 시험한다.

## 시험을 고친 이유
애플리케이션 층(REQ-100)은 세계에 새 개체 일곱 종류와 링크 `calls`, 고장 여덟, 툴 여덟, 시나리오 일곱을 더한다. 잠긴 시험 가운데 목록의 길이나 모음을 직접 세는 시험(툴 수 58에서 66, 가상 종류 넷에서 열하나, 점선 아홉에서 다섯, 제어 가능 요소 목록, 장면 팔레트의 고장 목록, 도구 카드 검색)은 목록이 늘어난 만큼 기대값을 고쳤다. 네트워크 정책 시험은 정책이 이제 한 쌍이 아니라 지키는 서비스를 부르는 모든 서비스에 닿는 것을 읽는다(호출 선이 없는 세계의 결과는 같다). 시험 도우미(캠퍼스 샘플, SDN 실험 세계, 변별력 점검의 세계 목록과 그 점검에 드는 시간 한도(시나리오가 일곱 늘어 20초가 모자라다), 제어 가능 요소 시험의 `Drive`, 물리 골든의 세계 목록)는 애플리케이션 층 세계를 더하는 방향으로만 늘렸고 기존 값(골든 해시 포함)은 하나도 바꾸지 않았다.

## 결과
- 요구사항: REQ-100. 사다리의 모델링된 칩은 늘고, 기존 골든 해시는 하나도 바뀌지 않았다. 새 세계 "app layer lab"의 해시만 더해졌다.
- 설명: [애플리케이션 층](../application-layer.md).
