---
title: ADR-0129 마지막 점선 다섯을 실선으로 — 사이트·DR 사다리, 지역 복제, 분산 SQL, 관리형 멀티 AZ
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - apps/web/src/logic/world-shape/site-cards.test.ts
  - apps/web/src/logic/world-shape/world-shape.test.ts
  - apps/web/src/logic/world-shape/db-cards.test.ts
  - apps/web/src/logic/world-shape/app-cards.test.ts
  - packages/core/src/sources/worldgen/shaped.test.ts
  - packages/core/src/world/workload.test.ts
  - tests/spec/site-dr.test.ts
  - tests/spec/site-db.test.ts
  - tests/spec/site-scenarios.test.ts
  - tests/spec/site-tables.test.ts
  - tests/spec/site-topology.test.ts
  - tests/spec/physics-golden.test.ts
  - tests/spec/controllability.test.ts
  - tests/spec/service-tools.test.ts
  - tests/spec/db-worldgen.test.ts
  - apps/web/src/logic/tool-picker.test.ts
  - packages/core/src/scenario/actions.test.ts
  - packages/core/src/scenario/scenario.test.ts
  - tests/spec/calibration.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/test-lock.json
amends_tests:
  - apps/web/src/logic/world-shape/db-cards.test.ts::=MODELED
  - packages/core/src/world/test-support/sample-campus.ts::=campusBlueprint
  - packages/core/src/world/world-edges.test.ts::lookups and labels at the edges [REQ-001] > only the four virtual kinds are virtual
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/physics-golden.test.ts::=worlds
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
  - apps/web/src/logic/world-shape/app-cards.test.ts::애플리케이션 칩 네 개는 실선이고 카드는 코어의 고장 목록과 같다 [REQ-100] > 점선은 다섯 개만 남는다
  - apps/web/src/logic/world-shape/db-cards.test.ts::'이 모양이면'에 데이터베이스 고장이 들어간다 [REQ-095] > 점선 데이터베이스 칩은 고장도 시나리오도 더하지 않는다
  - apps/web/src/logic/world-shape/db-cards.test.ts::데이터베이스와 스토리지 칩의 카드는 코어의 고장 목록과 같다 [REQ-095] > 점선으로 남은 칩은 데이터베이스와 스토리지에 둘뿐이고 가까운 칸으로 짓는다
  - "apps/web/src/logic/world-shape/world-shape.test.ts::HA 사다리: 선택지와 카드 [REQ-094] > 점선은 ADR-0107 결정 5의 목록 그대로다"
  - apps/web/src/logic/world-shape/world-shape.test.ts::이 모양이면 [REQ-094] > 점선 칸은 고장도 시나리오도 더하지 않는다
  - packages/core/src/sources/worldgen/shaped-per-service.test.ts::서비스마다 다른 모양 [REQ-094] > 흉내 낼 수 없는 칸을 고르면 어느 서비스가 가까운 모양으로 지어졌는지 알린다
  - packages/core/src/sources/worldgen/shaped.test.ts::서비스부터 세계 생성 [REQ-094] > 흉내 낼 수 없는 칸은 가까운 칸 모양으로 짓고 같은 결과를 낸다
  - "packages/core/src/world/workload.test.ts::일감과 사다리 [REQ-094] > 사다리: 여덟 층에 선택지가 마흔네 개이고 층마다 아이디가 겹치지 않는다"
  - apps/web/src/logic/tool-picker.test.ts::the tool cards [REQ-080] > a search narrows the cards to the tools that answer it, by name, title, card or tag
  - tests/spec/db-worldgen.test.ts::데이터베이스 칩이 세계에 클러스터를 깐다 [REQ-095] > 점선 칩은 가장 가까운 칩 모양으로 짓는다
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > in the sample hall every supported fault can be used, each as its own block
  - tests/spec/calibration.test.ts::=WORLDS
test_change_reason: 점선 다섯 칩을 코어가 흉내 내는 실선으로 바꿔 점선 개수가 0이 되고, 개체 종류 넷(dr_site·site_link·replication_stream·dr_plan)과 db_node·db_managed·volume이 늘고 고장 열다섯, 툴 열네 개, 세계 명령이 늘고 사다리 칩이 마흔네 개에서 마흔여섯 개가 되었다. 점선을 세던 시험은 점선 0개를 세도록, 개수를 세던 시험(개체·툴·명령 목록, 사다리 칩 수)은 새 개수로, 골든 월드는 세 개를 더하되 기존 값은 그대로 두었다.
decision_hash: d0dacb8a3c87b6cf
---
# ADR-0129 마지막 점선 다섯을 실선으로 — 사이트·DR 사다리, 지역 복제, 분산 SQL, 관리형 멀티 AZ

## 맥락
[ADR-0107](0107-world-entry-two-doors-ha-ladders.md) 결정 5와 6은 코어가 모르는 구조를 점선으로 두고 "가까운 칸으로 짓는다"고 했다. 컨테이너·SDN·애플리케이션 층이 차례로 실선이 된 뒤 남은 점선은 다섯이었다: 지역 복제(`sto-geo`), 분산 SQL(`db-distributed-sql`), 관리형 멀티 AZ(`db-managed-multiaz`), DR 웜(`site-dr-warm`), 멀티 사이트(`site-multi-active`). 연수 님 결정(2026-11-07): "점선인 거 없이 현실세계와 모순되지 않게 전부 설계해서 구현해줘."

## 결정
1. **사이트 사다리를 한 줄로 만든다.** 서버룸 하나 → 둘 → 건물 둘 → DR 콜드 → 웜 → 핫 → 멀티 사이트 액티브-액티브. 건물이 둘 이상이어야 둘째 사이트가 생기고, 콜드는 꺼진 서버와 이미지, 웜은 서비스 절반의 대기, 핫은 전부의 동기 대기, 액티브는 두 사이트가 함께 일한다. 약속은 칩과 회선 지연으로 정해진다: 콜드 RTO 4시간·RPO 24시간, 웜 15분·36초, 핫 90초·0, 액티브 30초·0 ([사이트·DR 층](../site-dr-layer.md)).
2. **개체 종류를 넷 더한다.** `dr_site`, `site_link`, `replication_stream`, `dr_plan`은 자기 자리가 없는 가상 종류다. 지역 복제 볼륨(`volume`)은 `replicaSite`와 스트림을, 합의 DB는 `db_node`(셋 이상, 리더·term)를, 관리형 DB는 `db_managed`(영역별)를 가진다. `replication_stream`은 `hosted_on`의 시작 종류가 된다.
3. **고장 열다섯을 더한다.** 사이트·DR 일곱(`site_power_loss`, `wan_link_down`, `wan_degraded`, `replication_broken`, `dr_failover_stuck`, `split_brain`, `dr_site_stale`), 지역 복제 둘(`geo_replication_lag`, `geo_replica_broken`), 합의 DB 셋(`db_leader_lost`, `db_quorum_lost`, `db_node_lagging`), 관리형 DB 셋(`db_az_failure`, `db_failover_flapping`, `db_storage_full`). 모두 `FAULT_TOOLS`, `FAULT_RESPONSES`, 리드타임 행, MTBF, 제어 가능표의 줄, 골든 키가 있다. 서비스를 건드리지 않는 고장 여섯은 `SILENT_SITE_FAULTS`다.
4. **툴 열네 개를 더한다.** 사이트 여섯(`site_status`, `replication_status`, `wan_status`, `dr_failover`, `dr_failback`, `dr_drill`), 볼륨 둘(`volume_replication_status`, `volume_promote`), 합의 DB 셋(`db_cluster_status`, `db_node_restart`, `db_transfer_leader`), 관리형 DB 셋(`db_managed_status`, `db_managed_failover`, `db_managed_scale_storage`). 바꾸는 툴은 제어 가능표의 줄(`dr.failover`, `dr.failback`, `dr.drill`, `volume.promote`, `dbnode.restart`, `dbnode.transfer`, `dbm.failover`, `dbm.scale`)의 길이다.
5. **알아서 하는 일은 원인 `cluster`로 기록한다.** 핫 사이트 전환, 액티브의 죽은 사이트 빼기, 합의 DB 리더 선거(과반이 없다가 사람이 되살린 뒤의 선거는 `physics`다: 에이전트의 몫이어야 하므로), 관리형 DB 영역 넘기기, 동기 복제의 비동기 후퇴. 물리 단계는 10초이므로 늘고 주는 값은 모두 `dt`를 곱한다.
6. **시나리오 아홉과 구별 시험.** 사이트 정전, 전환 멈춤, 회선 끊김, 복제 멈춤, 스플릿 브레인, 합의 DB 과반 상실, 관리형 DB 플래핑·저장소 가득, 지역 복제본 깨짐. 모두 복구 채점이고, 같은 증상의 다른 시나리오와 구별되는지(`discriminability`)와 툴로 단서에 닿는지(`shellReach`)를 시험한다. 복구 채점의 시간 창은 전체에 같아서 콜드·웜 시트는 시간 점수가 낮다(정직한 한계).
7. **칩 카드와 "이 모양이면".** 새·바뀐 칩 일곱에 카드를 만들고, 사이트 칩 카드에는 "복구 목표"(RTO·RPO) 줄이 있다. 목록은 셋까지 보이고 "외 n가지"로 줄이며, 고장 목록은 코어의 실제 고장 목록과 같은지 시험한다. 점선 개수는 0이다.
8. **토폴로지에 "사이트" 단계가 맨 앞에 선다.** 사이트 둘과 회선이 서고 서비스는 노드가 선 사이트에 기댄다. 사이트가 꺼지면 영향 범위가 서비스로 걸어간다. 사이트가 하나인 세계에는 이 칸이 없다.
9. **전제 조건.** `site-dr-warm`은 `sto-geo` 또는 `db-primary-secondary`, `site-dr-hot`은 `sto-geo` 또는 `db-auto-failover`, `site-multi-active`는 `sto-geo` 또는 `db-distributed-sql`, `sto-geo`는 `site-dr-cold` 이상을 요구한다. 멀티 리전(`app-multiregion`)은 멀티 사이트와 분산 SQL이 받쳐야 한다. 자동 고르기와 프리셋(보통·잘 안 멈춤)이 이를 따른다.
10. **세계 입구 ③의 자동 수**(건물·사이트)가 사이트 칩을 따라간다.

## 이유
- 점선은 "고를 수는 있지만 흉내는 안 낸다"는 거짓말에 가깝다. 같은 칩을 고른 두 세계가 가까운 칸으로 지어져 같은 결과를 냈다.
- 사이트 전환은 현실에서 시간(RTO)과 잃는 쓰기(RPO)로만 말해진다. 칩마다 이 두 숫자를 약속하고, 실제 전환이 그 숫자와 같게 걸리게 하면 모순이 없다.
- 알아서 하는 일과 사람이 한 일을 원인으로 나눠야 복구 채점이 클러스터의 일을 에이전트의 점수로 세지 않는다.

## 대안과 버린 이유
- 둘째 사이트를 리전 개체로 모델링: 리전은 애플리케이션 층의 트래픽 단위이고 서버가 없다. 사이트는 서버와 건물이 있어야 전원·냉방 고장과 이어진다.
- 복구 채점의 시간 창을 사이트 모드마다 늘리기: 모든 시나리오의 점수 의미가 바뀌어 기존 시험이 흔들린다. 한계로 적고 뒤로 미룬다.
- 점선 두기: 연수 님이 결정했다.

## 시험
- 사이트·DR 물리와 도구: `tests/spec/site-dr.test.ts`; 합의·관리형 DB: `tests/spec/site-db.test.ts`; 시나리오: `tests/spec/site-scenarios.test.ts`; 표(도메인·리드타임·툴·MTBF·제어 가능표·골든): `tests/spec/site-tables.test.ts`; 토폴로지: `tests/spec/site-topology.test.ts`; 칩 카드: `apps/web/src/logic/world-shape/site-cards.test.ts`.
- 점선을 세던 시험, 개수를 세던 시험, 새 툴이 "드묾" 검색에 걸리는 시험, 행동·고장 목록을 통째로 세는 시험(`actions`, `scenario`), 모든 내장 시나리오를 시험 세계에 돌리는 `calibration`(사이트·DB 세계 다섯 추가)은 `amends_tests`에 이름을 적었다. 골든 월드 세 개를 더했고 기존 키의 값은 하나도 바뀌지 않았다.
