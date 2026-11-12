---
title: ADR-0115 SDN 오버레이와 클라우드 네이티브 네트워크 층을 코어 모델로 올리면서 시험 열다섯 곳의 기대값을 고친다
kind: decision
status: active
enforced_by:
  - tests/spec/sdn-physics.test.ts
  - tests/spec/sdn-worldgen.test.ts
  - tests/spec/sdn-scenarios.test.ts
  - packages/core/src/topology/sdn-layer.test.ts
  - apps/web/src/logic/world-shape/sdn-cards.test.ts
  - tests/spec/controllability.test.ts
  - apps/web/src/logic/world-shape/world-shape.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - docs/design-docs/adr/0107-world-entry-two-doors-ha-ladders.md
amends_tests:
  - apps/web/src/logic/tool-picker.test.ts::the tool cards [REQ-080] > a search narrows the cards to the tools that answer it, by name, title, card or tag
  - "apps/web/src/logic/world-shape/world-shape.test.ts::HA 사다리: 선택지와 카드 [REQ-094] > 점선은 ADR-0107 결정 5의 목록 그대로다"
  - apps/web/src/logic/world-shape/world-shape.test.ts::이 모양이면 [REQ-094] > 점선 칸은 고장도 시나리오도 더하지 않는다
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > in the sample hall every supported fault can be used, each as its own block
  - packages/core/src/sources/worldgen/shaped.test.ts::서비스부터 세계 생성 [REQ-094] > 흉내 낼 수 없는 칸은 가까운 칸 모양으로 짓고 같은 결과를 낸다
  - packages/core/src/world/test-support/sample-campus.ts::=CAMPUS_ENTITY_IDS
  - packages/core/src/world/test-support/sample-campus.ts::=campusBlueprint
  - packages/core/src/world/world-edges.test.ts::lookups and labels at the edges [REQ-001] > only the four virtual kinds are virtual
  - tests/spec/calibration.test.ts::=WORLDS
  - tests/spec/config-scenarios.test.ts::mistakes are named so a diagnosis can name them [REQ-068] > each mistake has a label, is not a fault to inject, and is accepted in a diagnosis
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/physics-golden.test.ts::=worlds
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
  - tests/spec/controllability.test.ts::<stmt:c8231bea>
test_change_reason: 네트워크 사다리의 SDN 오버레이와 클라우드 네이티브를 코어 모델로 올려 개체 종류가 일곱, 고장 종류가 일곱, 실수 이름이 하나, 툴이 아홉, 세계 명령이 다섯, 행동 종류가 넷 늘고 ADR-0107 결정 5의 점선이던 칩 둘이 실선이 된다. 시험들은 같은 성질(모든 툴이 같은 모양, 모든 명령이 목록에 있거나 운영자의 것이 아니다, 가상 종류의 목록, 점선의 목록, 팔레트의 쓸 수 없는 고장, 실수의 목록)을 새 값으로 읽고, 캠퍼스 샘플은 "모든 종류를 쓴다"는 성질을 지키려고 오버레이 개체를 얻는다.
decision_hash: a46987ad03ed4dda
---
# ADR-0115 SDN 오버레이와 클라우드 네이티브 네트워크 층을 코어 모델로 올리면서 시험 열다섯 곳의 기대값을 고친다

## 맥락
[ADR-0107](0107-world-entry-two-doors-ha-ladders.md) 결정 5가 점선으로 둔 SDN 오버레이와 클라우드 네이티브(네트워크 쪽)를 구현했다(REQ-097). 결정 6은 이를 "오픈 뒤 로드맵"에 두었지만, 리프-스파인 위에 이미 BGP·EVPN·VNI의 흉내(스위치 CLI)가 있고 [DB 층](../db-storage-layers.md)이 같은 모양(점선 → 실선)을 한 번 지나가서 네트워크 층을 먼저 끌어올렸다. 동작과 규칙은 [SDN 오버레이와 클라우드 네이티브 네트워크 층](../sdn-network-layer.md)에 있다. 구현이 잠긴 시험 열다섯 곳을 건드렸고, 구현하면서 정한 것이 몇 있어 함께 남긴다. 서비스 메시 자체는 애플리케이션 층의 일이고 컨테이너 오케스트레이션은 컴퓨트 층의 일이라 여기서 다루지 않는다.

## 결정
1. **개체 종류 일곱과 링크 종류 둘을 더한다.** `sdn_controller`, `vtep`, `overlay_segment`, `nfv_function`, `cni`, `network_policy`, `ingress`는 자기 자리가 없는 가상 종류다. 컨트롤러가 스위치를 관리하는 `controls`와 정책이 서비스를 지키는 `applies_to`를 더했고, `hosted_on`의 대상에 스위치를, `member_of`에 VTEP → 세그먼트를, `depends_on`에 세그먼트·인그레스·가상 기능을 더했다.
2. **고장 일곱과 실수 하나를 더한다.** 컨트롤러 다운, 설정 동기화 실패, VXLAN 터널 끊김, EVPN 세션 플랩, 인그레스 컨트롤러 다운, CNI 플러그인 고장, 가상 방화벽 과부하. 잘못된 네트워크 정책 배포(`network_policy_deny`)는 고장이 아니라 사람의 실수 범주라 `MISTAKE_SPECS`에 있고, 시나리오의 설정 블록 `policy_set`이 만들며 에이전트는 `policy_revert`로 되돌린다. 모두 네트워크 도메인이고 리드타임 표에 행이 있다.
3. **툴 아홉을 더한다.** `sdn_status`, `sdn_sync`, `sdn_failover`, `overlay_trace`(`rare`), `evpn_sessions`, `policy_list`, `policy_revert`, `ingress_status`, `ingress_restart`. 툴이 40개에서 49개가 된다. 바꾸는 툴 넷은 제어 가능 요소표의 행(`sdn.sync`, `sdn.failover`, `policy.revert`, `ingress.restart`)을 가지고, 노드의 CNI 재시작은 호스트 조치 행(`host.cni`)이다. 스위치 CLI에는 `show nve peers`, `show vxlan vtep`이 더해졌고 VNI 표와 EVPN 요약이 오버레이 상태를 따라간다.
4. **컨트롤러가 멈춰도 서비스는 멈추지 않는다(헤드리스).** 이미 깔린 흐름은 그대로 돌고 새 설정만 못 민다. 그래서 "컨트롤러 다운" 시나리오는 같은 때 한 스위치에 새 설정이 닿지 못하게 하는 동기화 실패를 곁들여 서비스가 실제로 곤란해지게 한다. 컨트롤러 쌍이면 스탠바이가 이어받으며 전체 설정을 다시 밀어 둘 다 사라지고, 하나뿐이면 네트워크 팀에 넘겨야 한다.
5. **자동 동작은 원인 `cluster`다.** 컨트롤러 전환(감지 30초), 끊겼던 EVPN 세션의 재수립(BGP 타이머 90초), ECMP 경로 재계산이 `cluster` 사건으로 남는다. 복구 우선 채점은 서비스가 정상이 된 때가 에이전트의 마지막 조치보다 늦은 이 사건 뒤이면 클러스터가 한 복구(`byCluster`)로 읽는다. 에이전트가 `sdn_sync`로 푼 세션은 10초 뒤에 올라오고 `cluster` 사건을 남기지 않는다(에이전트의 복구다).
6. **ADR-0107 결정 5의 점선 목록이 줄어든다.** SDN 오버레이와 클라우드 네이티브가 실선이 되어 점선은 열둘이다. 두 칩은 리프-스파인 위에 컨트롤러 둘과 가상 방화벽을 깔고, 클라우드 네이티브는 노드마다 CNI, 서비스마다 정책, 요청 서비스마다 인그레스까지 깐다. 칩 카드의 "생기는 고장"은 칩의 멈추는·느려지는 고장을 고장 이름으로 풀어 만든다.
7. **ADR-0107 결정 6의 로드맵이 줄어든다.** 오픈 뒤 로드맵에서 SDN·클라우드 네이티브 네트워크가 끝으로 옮겨 간다. 컨테이너·서버리스, 지역 복제, DR 사이트, 서비스 메시는 그대로다.
8. **고치는 시험.** 모두 같은 성질을 새 값으로 읽는다.
   - `service-tools.test.ts`: 모든 툴이 같은 모양으로 적혀 있다 — 툴 수 40 → 49.
   - `controllability.test.ts`: 세계 명령이 모두 목록에 있거나 운영자의 것이 아니다 — 명령 다섯(`sdn.sync`, `sdn.failover`, `policy.set`, `policy.revert`, `ingress.restart`) 추가. 모든 길에 드라이브가 있다 — 새 길 다섯의 드라이브 추가(드라이브 표를 채우는 문장의 해시가 바뀐다).
   - `config-scenarios.test.ts`: 실수의 목록 — `network_policy_deny` 추가.
   - `world-edges.test.ts`: 가상 종류의 목록 — 일곱 추가.
   - `scenario.test.ts`: 샘플 홀에서 쓸 수 없는 고장의 목록 — 홀에 오버레이가 없어 일곱 추가.
   - `actions.test.ts`: 알 수 없는 행동의 안내문이 행동 목록을 적는다 — 넷 추가.
   - `world-shape.test.ts`: 점선의 목록 — 둘 빠짐. 점선 칸은 고장도 시나리오도 더하지 않는다 — 비교 상대를 점선인 사이트 칩(DR 사이트)으로 바꾼다.
   - `shaped.test.ts`: 점선은 가까운 칸 모양으로 짓는다 — 점선인 사이트 칩(DR 사이트)으로 바꾼다.
   - `tool-picker.test.ts`: "드묾"으로 찾으면 나오는 툴 — `overlay_trace` 추가.
   - `calibration.test.ts`: 각 내장 시나리오를 처음 맞는 시험 세계에서 만든다 — SDN 시험 세계 추가.
   - `sample-campus.ts`(지원 파일): "캠퍼스 샘플은 모든 종류를 쓴다"는 성질을 지키려고 컨트롤러 둘·VTEP·세그먼트·가상 방화벽·CNI·정책·인그레스를 얻는다. 가상 방화벽·인그레스·CNI는 OS 시나리오가 고장을 놓는 VM·서버와 겹치지 않는 서버에 올려 두었다.
   - `physics-golden.test.ts`와 `physics-golden.json`: 고장마다 기록한 값의 키를 갖도록 시험 세계에 SDN 시험 세계를 더하고 그 세계의 키를 기록한다(다른 세계의 키는 그대로).

## 이유
- 개체를 새 종류로 둔 것은 상태(세션, 리비전, 규칙)를 스위치나 서비스 상태에 억지로 넣지 않으려는 것이다. 서비스 건강이 "무엇에 기대는가"를 링크로 읽는 방식 그대로다.
- 컨트롤러의 복구를 따로 센 것은 복구 우선 채점이 "에이전트가 한 복구"만 점수로 센다는 약속(ADR-0091)을 자동 전환이 깨지 않게 하려는 것이다.
- 언더레이를 네트워크 모델의 케이블에서 읽은 것은 터널이 끊기는 이유(케이블, 스위치 전원)가 이미 알람과 같은 곳에서 오게 하려는 것이다.

## 대안과 버린 이유
- VTEP을 스위치 상태의 필드로 두는 안: 세션과 리비전이 따로 고장 나고 고쳐지는 단위라 개체로 두는 쪽이 고장·알람·토폴로지 모두에 맞았다.
- 컨트롤러가 멈추면 서비스도 느려지게 하는 안: 현실의 헤드리스 동작과 달라서 버렸다. 대신 곁들인 동기화 실패로 서비스가 곤란해진다.
- 서비스 사이의 호출 그래프를 만드는 안: 지금 세계에는 서비스끼리의 의존이 없어 정책에 적힌 호출자 하나로 줄였다.

## 결과
- 잠긴 시험 열다섯 곳의 본문만 바뀐다(`lock --amend`). 새 시험은 `[REQ-097]`로 잠근다.
- ADR-0107의 `enforced_by`에 이 구현의 시험을 더한다.
