---
title: ADR-0111 데이터베이스 층과 스토리지 HA 층을 코어 모델로 올리면서 시험 열한 곳의 기대값을 고친다
kind: decision
status: active
last_verified: 2026-11-06
enforced_by:
  - tests/spec/db-physics.test.ts
  - tests/spec/db-worldgen.test.ts
  - packages/core/src/topology/db-layer.test.ts
  - tests/spec/db-scenarios.test.ts
  - tests/spec/controllability.test.ts
  - apps/web/src/logic/world-shape/world-shape.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - docs/design-docs/adr/0107-world-entry-two-doors-ha-ladders.md
amends_tests:
  - "apps/web/src/logic/world-shape/world-shape.test.ts::HA 사다리: 선택지와 카드 [REQ-094] > 점선은 ADR-0107 결정 5의 목록 그대로다"
  - apps/web/src/logic/world-shape/world-shape.test.ts::이 모양이면 [REQ-094] > 점선 칸은 고장도 시나리오도 더하지 않는다
  - packages/core/src/scenario/actions.test.ts::validating action conditions [REQ-034] > action conditions must name a known action and a real target
  - packages/core/src/scenario/scenario.test.ts::scenario palette [REQ-034] > in the sample hall every supported fault can be used, each as its own block
  - packages/core/src/world/test-support/sample-campus.ts::=CAMPUS_ENTITY_IDS
  - packages/core/src/world/test-support/sample-campus.ts::=campusBlueprint
  - packages/core/src/world/world-edges.test.ts::lookups and labels at the edges [REQ-001] > only the four virtual kinds are virtual
  - tests/spec/controllability.test.ts::the list of what can be controlled is made of real things [REQ-069] > every world command is either on the list or named as no operator's
  - tests/spec/controllability.test.ts::the kinds a row says it acts on are the kinds the world accepts [REQ-069] > %s
  - tests/spec/controllability.test.ts::<stmt:97d8fef7>
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
test_change_reason: 데이터베이스와 스토리지 HA를 코어 모델로 올려 개체 종류가 넷, 고장 종류가 여덟, 툴이 여섯, 세계 명령이 넷, 행동 종류가 넷 늘고 ADR-0107 결정 5의 점선이던 칩 일곱이 실선이 된다. 시험들은 같은 성질(모든 툴이 같은 모양, 모든 명령이 목록에 있거나 운영자의 것이 아니다, 가상 종류의 목록, 점선의 목록, 팔레트의 쓸 수 없는 고장)을 새 값으로 읽고, 캠퍼스 샘플은 "모든 종류를 쓴다"는 성질을 지키려고 데이터베이스 개체를 얻는다.
decision_hash: 9b7d59640e6ae05a
---
# ADR-0111 데이터베이스 층과 스토리지 HA 층을 코어 모델로 올리면서 시험 열한 곳의 기대값을 고친다

## 맥락
[ADR-0107](0107-world-entry-two-doors-ha-ladders.md) 결정 6이 클로즈 베타 2차에 모델링하기로 한 데이터베이스 층과 스토리지 HA 층을 구현했다(REQ-095, 2e). 동작과 규칙은 [데이터베이스 층과 스토리지 HA 층](../db-storage-layers.md)에 있다. 구현이 잠긴 시험 열한 곳을 건드렸고, 구현하면서 정한 것이 몇 있어 함께 남긴다.

## 결정
1. **개체 종류 넷과 링크 종류 둘을 더한다.** `db_cluster`, `db_instance`, `storage_pool`, `storage_controller`는 자기 자리가 없는 가상 종류다. 서비스가 기대는 `depends_on`과, 인스턴스·컨트롤러가 올라간 곳 `hosted_on`을 더했고, `member_of`·`stored_on`·`backed_by`의 대상 종류를 넓혔다. 인스턴스를 `runs_on`으로 잇지 않은 것은 `runs_on`을 VM의 것으로 읽는 기존 코드가 인스턴스를 VM으로 오해하지 않게 하려는 것이다.
2. **고장 여덟을 더한다.** 프라이머리 다운, 세컨더리 다운, 복제 끊김, 스플릿 브레인, 백업 손상, 스토리지 경로 끊김, 컨트롤러 고장, 분산 스토리지 노드 상실. 데이터베이스 호스트의 디스크 가득과 읽기 전용 파일시스템은 호스트의 OS 고장을 그대로 읽는다. 데이터베이스 고장은 서비스/OS, 스토리지 고장은 스토리지 도메인이고, 리드타임 표에 행이 있다.
3. **툴 여섯을 더한다.** `db_status`, `db_promote`, `db_failover`, `db_restore`, `storage_status`, `storage_path_switch`. 툴이 34개에서 40개가 된다. 스토리지 도메인에 처음으로 툴이 생기고, 스토리지 고장은 더 이상 넘기는 길로만 풀리지 않는다. 바꾸는 툴 넷은 제어 가능 요소표의 행(`db.promote`, `db.failover`, `db.restore`, `storage.path`)과 `host.database`(데이터베이스 인스턴스 다시 시작)를 가진다.
4. **자동 페일오버는 원인 `cluster`다.** 클러스터가 스스로 하는 승격, 멀티패스의 경로 전환, 분산 풀의 재복제 완료는 세계의 사건에 원인 `cluster`로 남는다. 세션은 이 원인을 에이전트가 한 일로 세지 않는다. 복구 우선 채점은 서비스가 정상이 된 때가 에이전트의 마지막 조치보다 늦은 이 사건 뒤이면 클러스터가 한 복구(`byCluster`)로 읽고, 시간·순서 축에 점수를 주지 않는다. 이 `note` 사건은 실행 기록에 남긴다(다른 `note`는 여전히 빼고).
5. **ADR-0107 결정 5의 점선 목록이 줄어든다.** 데이터베이스 층 전부, 듀얼 컨트롤러·멀티패스, 분산 스토리지가 실선이 되고, 점선은 분산 SQL·합의, 클라우드 관리형 멀티 AZ, 지역 복제와 나머지 층의 것(열네 개)이다. 점선은 가장 가까운 실선 모양으로 짓는다(분산 SQL·관리형은 자동 페일오버, 지역 복제는 듀얼 컨트롤러).
6. **공유 SAN·NAS는 컨트롤러 둘에 경로는 사람이 바꾼다.** 카드의 "컨트롤러 하나"는 그것이 멈추면 모두 멈추는 곳이 하나라는 말이었다. 같은 약점을 "컨트롤러가 둘이지만 호스트가 길을 자동으로 못 바꿔 사람이 바꿔야 이어진다"로 모델링했고, 듀얼 컨트롤러+멀티패스와의 차이가 이 자동 전환이 된다. 카드 글을 그에 맞게 고쳤다. 칩 카드의 "생기는 고장"은 칩의 멈추는·느려지는 고장을 고장 이름으로 풀어 만든다.
7. **세계 생성이 서비스마다 클러스터를 깐다.** 인스턴스는 서비스가 쓰지 않는 서버를 서로 다른 랙부터 골라 올라가고(그래서 다른 전원 줄), 풀은 세계에 하나다. "보통" 프리셋(프라이머리-세컨더리)은 이제 실제 클러스터를 깐다.
8. **고치는 시험.** 모두 같은 성질을 새 값으로 읽는다.
   - `service-tools.test.ts`: 모든 툴이 같은 모양으로 적혀 있다 — 툴 수 34 → 40.
   - `controllability.test.ts`: 세계 명령이 모두 목록에 있거나 운영자의 것이 아니다 — 명령 넷(`db.failover`, `db.promote`, `db.restore`, `storage.path_switch`) 추가. 행이 말하는 종류와 세계가 받는 종류가 같다 — 명령 넷의 줄 추가. 모든 길에 드라이브가 있다 — 새 길 다섯의 드라이브 추가(드라이브 표를 채우는 문장의 해시가 바뀐다).
   - `world-edges.test.ts`: 가상 종류의 목록 — 넷 추가.
   - `scenario.test.ts`: 샘플 홀에서 쓸 수 없는 고장의 목록 — 홀에 데이터베이스가 없어 일곱 추가(분산 스토리지 노드 상실은 홀의 스토리지에 놓을 수 있다).
   - `actions.test.ts`: 알 수 없는 행동의 안내문이 행동 목록을 적는다 — 넷 추가.
   - `world-shape.test.ts`: 점선의 목록 — 일곱 빠짐. 점선 칸은 고장을 더하지 않는다 — 비교 상대를 "데이터베이스 고장이 하나도 없다"로 바꾼다(데이터베이스 칩이 실선이 되어 단일 칩과 같을 수 없다).
   - `sample-campus.ts`(지원 파일): "캠퍼스 샘플은 모든 종류를 쓴다"는 성질을 지키려고 데이터베이스 클러스터·인스턴스 둘·풀·컨트롤러 둘을 얻는다. 인스턴스는 OS 시나리오가 고장을 놓는 VM·서버와 겹치지 않는 서버에 올려 두었다.
   - `physics-golden.json`은 시험이 아니라 기록한 값이다. 분산 스토리지 노드 상실이 네 세계에서 두 키씩 늘었다(다른 키는 그대로).

## 이유
- 개체를 새 종류로 둔 것은 상태(역할, 복제 지연, 복제본 수)를 서비스나 스토리지 상태에 억지로 넣지 않으려는 것이다. 서비스 건강이 "무엇에 기대는가"를 링크로 읽는 방식 그대로다.
- 클러스터의 복구를 따로 센 것은, 복구 우선 채점이 "에이전트가 한 복구"만 점수로 센다는 약속(ADR-0091)을 자동 페일오버가 깨지 않게 하려는 것이다.

## 대안과 버린 이유
- 인스턴스를 VM의 한 종류로 두는 안: 데이터베이스가 베어메탈에도 서야 해서 버렸다.
- 노드 상실에서 부하를 줄여 재복제를 앞당기는 안: 부하와 재복제 속도의 관계를 모델링해야 하고, 그 값은 어림이 될 뿐이라 버렸다. 그 시나리오는 보고만 잰다.

## 결과
- 잠긴 시험 열한 곳의 본문만 바뀐다(`lock --amend`). 새 시험은 `[REQ-095]`로 잠근다.
- ADR-0107의 `enforced_by`에 이 구현의 시험을 더한다.
