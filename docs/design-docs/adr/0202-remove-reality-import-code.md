---
title: ADR-0202 현실 연결 코드를 걷어낸다 — 그래프 소스를 읽어 세계를 짓던 길을 지우고, 저장된 가져온 세계는 보통 세계로 연다
kind: decision
status: active
enforced_by:
  - ARCH020
  - apps/server/src/adapters/adapters.test.ts
  - apps/server/src/main.test.ts
  - apps/server/src/http/app.test.ts
  - apps/server/src/runtime/platform.test.ts
  - apps/server/src/runtime/results.test.ts
updates_docs:
  - ARCHITECTURE.md
  - docs/product-specs/requirements.md
  - docs/design-docs/world-sources.md
  - docs/design-docs/operations.md
  - docs/design-docs/permissions.md
  - docs/design-docs/http-api.md
  - docs/design-docs/experiments-and-analysis.md
  - docs/design-docs/product-design.md
  - docs/design-docs/world-builder-review.md
  - docs/exec-plans/active/build-plan.md
  - docs/exec-plans/active/beta-rounds.md
amends:
  - adr: "0192"
    what: 결정 9의 걷어내기를 실행
  - adr: "0084"
    what: 가져오기 코드를 지우라던 결정을 실행
  - adr: "0021"
    what: 가져오기 길과 KG 매핑 결정
  - adr: "0008"
    what: worldgen과 realimport의 형제 격리
  - adr: "0011"
    what: 단위 구성의 realimport와 FalkorDB
  - adr: "0144"
    what: FalkorDB 제거의 순서
  - adr: "0177"
    what: 코드에 남은 가져오기를 없앤다
  - adr: "0009"
    what: 읽기 전용 현실 소스 포트와 FalkorDB 어댑터(통째로 대체)
touches_protected:
  - apps/server/package.json
  - docs/product-specs/requirements.md
  - harness/config/architecture.yaml
  - harness/config/coverage-floor.json
  - harness/config/test-lock.json
  - docs/design-docs/adr/0009-readonly-source-port.md
  - docs/design-docs/adr/0021-world-sources.md
  - docs/design-docs/adr/0008-spatial-and-sources.md
  - docs/design-docs/adr/0011-units-v2.md
  - docs/design-docs/adr/0084-topology-view.md
  - docs/design-docs/adr/0144-reality-data-pipeline-ontology-manager-world-kinds.md
  - docs/design-docs/adr/0177-goal-text-reality-worlds-and-top-level-docs.md
  - docs/design-docs/adr/0192-terrarium-returns-to-its-first-goal.md
amends_tests:
  - apps/server/src/adapters/adapters.test.ts::<import:06c70f0c>
  - apps/server/src/adapters/adapters.test.ts::<import:2dde0b52>
  - apps/server/src/adapters/adapters.test.ts::<import:8cdbe741>
  - apps/server/src/adapters/adapters.test.ts::server configuration [REQ-031] [REQ-037] > a file with every kind of connection; relative paths follow the file
  - apps/server/src/adapters/adapters.test.ts::server configuration [REQ-031] [REQ-037] > adapters are built from the config; the sample graph is always there
  - "apps/server/src/adapters/adapters.test.ts::server configuration [REQ-031] [REQ-037] > no file: the built-in harness and nothing else; every connection is named in the file"
  - apps/server/src/adapters/adapters.test.ts::the knowledge graph is only read [REQ-010] [REQ-011] > <suite>
  - apps/server/src/adapters/adapters.test.ts::the knowledge graph is only read [REQ-010] [REQ-011] > =dump
  - apps/server/src/adapters/adapters.test.ts::the knowledge graph is only read [REQ-010] [REQ-011] > =graph
  - apps/server/src/adapters/adapters.test.ts::the knowledge graph is only read [REQ-010] [REQ-011] > =queries
  - apps/server/src/adapters/adapters.test.ts::the knowledge graph is only read [REQ-010] [REQ-011] > importing through the graph adapter gives the same world as importing the dump
  - apps/server/src/adapters/adapters.test.ts::the knowledge graph is only read [REQ-010] [REQ-011] > rows with missing parts still map; a writing query never reaches the graph
  - apps/server/src/adapters/falkor.test.ts::<import:1f35931a>
  - apps/server/src/adapters/falkor.test.ts::<import:6402d54a>
  - apps/server/src/adapters/falkor.test.ts::<import:adbab5a9>
  - apps/server/src/adapters/falkor.test.ts::<import:e71fddbd>
  - apps/server/src/adapters/falkor.test.ts::=config
  - apps/server/src/adapters/falkor.test.ts::the FalkorDB client is only asked read-only queries [REQ-010] [REQ-011] > <suite>
  - apps/server/src/adapters/falkor.test.ts::the FalkorDB client is only asked read-only queries [REQ-010] [REQ-011] > a failed connection is tried again next time, and an empty reply is no rows
  - apps/server/src/adapters/falkor.test.ts::the FalkorDB client is only asked read-only queries [REQ-010] [REQ-011] > connects once, on first use, and runs RO_QUERY against the named graph
  - apps/server/src/adapters/falkor.test.ts::the FalkorDB client is only asked read-only queries [REQ-010] [REQ-011] > the source names the graph without credentials
  - apps/server/src/http/audit-changes.test.ts::=ROWS
  - apps/server/src/http/audit-refusals.test.ts::a refusal after sign-in [REQ-054] > =cases
  - "apps/server/src/http/audit-refusals.test.ts::a refusal after sign-in [REQ-054] > [REQ-054] an admin-only refusal names no id: nothing was looked up, so nothing in the address is confirmed"
  - apps/server/src/http/identity-loopback.test.ts::alone on one's own machine, the loopback address is the administrator [REQ-054] > [REQ-054] the admin routes open for loopback and stay shut for others
  - apps/server/src/http/identity-proxy.test.ts::typed names are for one person on their own machine [REQ-054] > [REQ-054] the admin token gates the admin routes in this mode
  - apps/server/src/http/permissions-api.test.ts::what was open to every signed-in person is for its maker and admins [REQ-054] > [REQ-054] importing a world from a source is for admins
  - apps/server/src/main.test.ts::starting and stopping the server [REQ-030] > a config file is all it takes; data lives next to it and survives a restart
  - apps/server/src/runtime/platform.test.ts::what the server says about itself [REQ-031] [REQ-033] > who is asking, the harnesses with their agents, sources and limits
  - apps/server/src/runtime/platform.test.ts::worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034] > worlds come from presets and from reality, with what was assumed
  - apps/server/src/runtime/results.test.ts::benchmarks and the digital twin [REQ-039] [REQ-015] > diagnosis records export as JSON Lines; the brief names what imported worlds lack
  - packages/core/src/analysis/share.test.ts::diagnosis records and the modelling brief [REQ-015] > an empty record set still gives a readable brief; easy faults are flagged too
  - packages/core/src/analysis/share.test.ts::diagnosis records and the modelling brief [REQ-015] > the brief hands the simulator developer where the world is thin
  - packages/core/src/contract/contract.test.ts::<import:64b9aed0>
  - packages/core/src/contract/contract.test.ts::worlds cross the wire intact [REQ-001] [REQ-009] > imports name a source and stay within limits; saves need the version they started from
  - packages/core/src/contract/policies.test.ts::every route says who may call it [REQ-054] > [REQ-054] what the survey found open before is now guarded by a named policy
  - packages/core/src/sources/realimport/realimport.test.ts::<import:0653fc4e>
  - packages/core/src/sources/realimport/realimport.test.ts::<import:b2677072>
  - packages/core/src/sources/realimport/realimport.test.ts::<import:bb90c830>
  - packages/core/src/sources/realimport/realimport.test.ts::<import:e71fddbd>
  - packages/core/src/sources/realimport/realimport.test.ts::=catalog
  - packages/core/src/sources/realimport/realimport.test.ts::=run
  - packages/core/src/sources/realimport/realimport.test.ts::=sample
  - packages/core/src/sources/realimport/realimport.test.ts::classification [REQ-010] > <suite>
  - packages/core/src/sources/realimport/realimport.test.ts::classification [REQ-010] > a node with no name property is named after its label and id
  - packages/core/src/sources/realimport/realimport.test.ts::classification [REQ-010] > rules are tried in order, filters apply, and relationships may be stored either way round
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > <suite>
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > ESXi hosts merge into their physical servers; VMs and clusters follow
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > NIC-port chains become server-to-switch links carrying the port names; storage keeps its direct link
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > a scope keeps chosen rooms and what still connects to them
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > a valid world comes out, and the report accounts for everything read
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > an import that is too big asks for a narrower scope
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > power and missing cooling are assumed, sized, marked and reported; real cooling is kept
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > rooms, racks and units come from relationships first, then location properties
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > storage volumes fold into datastore-backed-by-array
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > the same graph imports to the same world
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > undersized real cooling is reported, not enlarged
  - packages/core/src/sources/realimport/realimport.test.ts::importing the sample graph [REQ-010] [REQ-012] [REQ-013] > without assumptions the gaps show up as warnings
  - packages/core/src/sources/realimport/realimport.test.ts::memory source [REQ-010] > <suite>
  - packages/core/src/sources/realimport/realimport.test.ts::memory source [REQ-010] > summarises, pages and reads every page
  - packages/core/src/sources/realimport/realimport.test.ts::read-only Cypher [REQ-011] > <suite>
  - "packages/core/src/sources/realimport/realimport.test.ts::read-only Cypher [REQ-011] > refuses a writing query: %s"
  - packages/core/src/sources/realimport/realimport.test.ts::read-only Cypher [REQ-011] > the adapter queries are read-only and refuse labels that are not plain names
  - packages/core/src/sources/realimport/realimport.test.ts::read-only Cypher [REQ-011] > words like SET inside strings, names, comments or longer identifiers do not trip it
  - packages/core/src/sources/realimport/room-scope.test.ts::<import:8e5b4067>
  - packages/core/src/sources/realimport/room-scope.test.ts::<import:b2677072>
  - packages/core/src/sources/realimport/room-scope.test.ts::<import:e71fddbd>
  - packages/core/src/sources/realimport/room-scope.test.ts::=run
  - packages/core/src/sources/realimport/room-scope.test.ts::a room filter that matches nothing is an error that names the choices [REQ-010] > <suite>
  - packages/core/src/sources/realimport/room-scope.test.ts::a room filter that matches nothing is an error that names the choices [REQ-010] > a filter that matches something still imports
  - packages/core/src/sources/realimport/room-scope.test.ts::a room filter that matches nothing is an error that names the choices [REQ-010] > the message says what was asked and which rooms exist
  - tests/spec/realimport.test.ts::<import:085bdb25>
  - tests/spec/realimport.test.ts::<import:0f465da4>
  - tests/spec/realimport.test.ts::<import:208ed770>
  - tests/spec/realimport.test.ts::<import:35b79da2>
  - tests/spec/realimport.test.ts::<import:7ddaebd9>
  - tests/spec/realimport.test.ts::<import:917b2dea>
  - tests/spec/realimport.test.ts::<import:b0b4ba49>
  - tests/spec/realimport.test.ts::<import:b2677072>
  - tests/spec/realimport.test.ts::<import:fb009e77>
  - tests/spec/realimport.test.ts::=catalog
  - tests/spec/realimport.test.ts::=watched
  - tests/spec/realimport.test.ts::an imported world can be simulated [REQ-010] > <suite>
  - tests/spec/realimport.test.ts::an imported world can be simulated [REQ-010] > =imported
  - tests/spec/realimport.test.ts::an imported world can be simulated [REQ-010] > every built-in scenario fits it and a session runs to a score
  - tests/spec/realimport.test.ts::an imported world can be simulated [REQ-010] > it is quiet after half an hour at rest
  - tests/spec/realimport.test.ts::reality is read, never changed [REQ-011] > <suite>
  - tests/spec/realimport.test.ts::reality is read, never changed [REQ-011] > an import touches nothing on its source but the reading methods
  - tests/spec/realimport.test.ts::reality is read, never changed [REQ-011] > the graph records themselves are left exactly as they were
  - tests/spec/realimport.test.ts::reality is read, never changed [REQ-011] > the source port has only reading methods
test_change_reason: ADR-0192가 현실 연결을 테라리움 밖으로 정해 REQ-010과 REQ-011을 없앴다. 그 요구사항의 시험은 지우고, 가져오기 경로를 지나던 시험은 보려던 것(권한, 신원, 설정, 저장된 세계 열기)을 다른 경로로 계속 본다.
decision_hash: 3cd7156a4f25ae75
---
# ADR-0202 현실 연결 코드를 걷어낸다

## 맥락
ADR-0192는 테라리움을 처음의 목표로 돌렸다. 현실의 것을 받는 길은 세계 스냅샷 파일(REQ-121) 하나이고, 현실 시스템에 연결해 읽는 일은 하지 않는다. 결정 9가 "이미 만든 현실 연결 코드는 걷어낸다"고 했고, 걷어내는 변경은 시험을 바꾸므로 따로 결정 기록을 갖기로 했다. 이것이 그 기록이다.

남아 있던 것은 그래프 소스를 읽기 전용으로 읽어 세계를 짓는 옛 가져오기 하나다. 코어의 `sources/realimport`(읽기 창, 대응, 위치 풀기, 가정 채우기, 보고서), 서버의 FalkorDB 어댑터, 서버 설정의 `sources`, `POST /api/worlds/import`, `/api/meta`가 주던 `sources` 목록이다. 웹 화면에서는 이미 지웠고(ADR-0084), 쓰는 길은 관리자만 부를 수 있는 API 하나와 설정뿐이었다. 쓰지 않는 길이 남아 있으면 읽는 사람이 제품이 하는 일을 잘못 알고, 현실 시스템의 계정을 다루는 의존성이 공개 저장소에 남는다.

## 결정
제품 책임자가 정했다.

1. **지운다.**
   - 코어: `sources/realimport/` 전체(읽기 창, 대응, 위치 풀기, 가정 채우기, 보고서, 샘플 그래프와 시험). 구조 설정의 그 단위, 그 단위의 적용 범위 하한(`coverage-floor.json`).
   - 서버: `adapters/falkordb.ts`와 그 시험, `adapters/build.ts`의 현실 소스 만들기, 서버 설정의 `sources` 스키마, `worlds.ts`의 `import()`, `POST /api/worlds/import`와 `ImportWorldBody`, `SourceView`, `ImportedWorld`, `/api/meta`의 `sources`.
   - 의존성: `falkordb`와, 그것만 쓰던 하위 의존성(고지 파일과 라이선스 목록에서도 뺀다), 구조 설정의 `falkordb` 허용 줄.
   - 시험: 명세 시험 묶음(tests/spec)에서 가져오기만 보던 시험 파일 하나와, 위 코드만 시험하던 시험.
2. **남긴다.** `sources/assembly*`(worldgen이 쓴다), `spatial`, `ReadOnlyWorldPort`(REQ-008), `analysis/ontology*`(REQ-112, 현실 연결이 아니다), 하네스 연결(`connectors`), 운영 모드. 이름이 비슷해도 지우지 않았다. `ReadOnlyViolationError`도 `ReadOnlyWorldPort`가 쓰므로 남긴다.
3. **저장된 "가져온 세계"는 보통 세계로 계속 열린다.** 세계는 블루프린트일 뿐이다. `WorldOrigin`의 `"import"` 값은 남긴다. 저장된 기록을 읽어야 하고, REQ-121이 받은 세계에 같은 값을 쓸 자리다. 화면 라벨 "현실에서 가져옴"은 "밖에서 받음"으로 바꾼다. 새로 `"import"`를 만드는 코드는 없다. 같은 까닭으로 감사 기록의 행동 이름 `world.import`도 남기고 라벨에 "지금은 없는 기능"을 붙인다(이미 쌓인 기록이 읽혀야 하고, 기록은 보존 기간만큼 남는다).
4. **저장된 `provenance.report`는 읽지 않는다.** `twinBrief`가 그 보고서로 `WorldGaps`를 채우던 부분을 지웠다. 저장된 값은 지우지 않고 그대로 둔다. 읽지 않으므로 모양이 맞는지 따지지 않아, 옛 보고서가 든 세계도 열 때 깨지지 않는다. **`WorldGaps`는 걷어냈다.** 그 값을 채우는 곳이 `twinBrief` 하나뿐이었고, 화면에는 쓰는 곳이 없어서(모델링 브리프의 Markdown 한 절과 "다음에 볼 곳" 한 줄뿐) 채워지지 않는 타입과 절이 남기 때문이다. 모델링 브리프는 고장 유형별 정답률과 툴 오류, 다음에 볼 곳만 말한다.
5. **설정에 `sources`가 남아 있으면 서버가 시작하지 않고 한 줄로 말한다.** 조용히 무시하지 않는다. 기존 설정 오류와 같은 말투로 "설정: sources 설정은 더 쓰지 않아요. 설정에서 지워 주세요 (ADR-0202)"라고 한다. 시험 하나가 이 문장을 고정한다(`adapters.test.ts`, `main.test.ts`).
6. **요구사항.** REQ-010과 REQ-011은 없앤다(ADR-0192가 REQ-115 등을 없앤 방식대로 표에서 빼고 번호는 다시 쓰지 않는다). REQ-012는 "공간 계산은 독립 모듈이며 worldgen이 소비한다"로 고친다. REQ-008은 그대로다. 요구사항의 "범위 밖"에서 realimport로 가져온다는 말은 세계 스냅샷으로 받는다는 말로 바꾼다.
7. **가져오기 경로를 지나던 시험은 보려던 것을 다른 관리자 전용 경로로 계속 본다.** 지운 것은 그 기능의 시험뿐이다.
   - 관리자만 부를 수 있는 길의 본보기는 `POST /api/worlds/import` 하나였다. 대신 `GET /api/audit`(관리자 정책, 감사 기록 보기)를 쓴다. `permissions-api`, `identity-proxy`, `identity-loopback`, `policies`, `audit-refusals`의 시험이 이제 이 길로 "관리자 토큰이 있어야 열리고, 이 기계 자신이면 열리고, 남의 주소면 닫히고, 거절 기록은 id를 적지 않는다"를 본다. `audit-refusals`의 "관리자만 닫힌 길" 줄은 `GET /api/audit/export`로 한 줄 더 둔다. 변경 기록(`audit-changes`)의 길마다 한 줄 표에서는 지운 길의 줄만 뺐다.
   - 설정 파일로 서버를 올리고 다시 올려도 데이터가 남는지 보던 `main.test.ts`는 가져온 세계 대신 `POST /api/worlds`로 만든 세계가 남는지 본다.
   - 모델링 브리프와 쌍둥이 기록을 보던 `results.test.ts`는 `"import"` 기원과 옛 보고서가 든 세계를 저장소에 직접 넣어, 실험이 돌고 보고서가 읽히지 않는 것을 본다(결정 3·4).
8. **새 시험.** 설정에 `sources`가 있으면 시작이 실패한다. 저장된 `origin: "import"` 세계(와 `provenance.report`가 든 세계)가 열리고, 이름을 바꾸고, 지우고, 실험에 쓸 수 있다. `POST /api/worlds/import` 길이 없고 `/api/meta`에 `sources`가 없다.
9. **하지 않는 것.** REQ-121(스냅샷 받기)의 형식이나 화면을 만들지 않는다. 새 기능을 더하지 않는다. `docs/archive/moved-out/`의 문서는 건드리지 않는다.

## 이유
- **현실의 계정을 다루는 길은 제품 목표 밖이다**(ADR-0192). 쓰지 않는 길을 두면 "테라리움이 현실을 읽는다"는 말이 코드에서 되살아난다.
- **저장된 세계를 닫지 않는다.** 가져온 세계는 이미 블루프린트이므로 지울 까닭이 없다. 값 `"import"`와 감사 행동 이름을 남기는 것이 기록을 읽는 가장 싼 길이고, 앞으로 받는 세계가 같은 값을 쓸 수 있다.
- **보고서를 읽지 않는다.** 보고서의 모양을 정한 쪽이 없어졌다. 읽으려면 그 타입을 남겨야 하므로, 값은 두고 읽지 않는 쪽이 가장 작다.
- **설정은 소리 내어 거절한다.** 조용히 무시하면 설정에 `sources`를 둔 사람은 가져오기가 아직 되는 줄 안다. 시작을 막고 한 줄로 말하면 고칠 곳이 보인다.
- **`WorldGaps`는 채우는 곳이 없어지면 죽은 코드다.** 남기면 읽는 사람이 어딘가에서 채워지는 줄 안다.

## 버린 길
- **`"import"` 값을 지우기**: 이미 저장된 세계의 `origin`이 모르는 값이 되어, 열 때 거절하거나 따로 바꿔 줘야 한다.
- **`sources` 설정을 조용히 무시하기**: 위 이유.
- **`WorldGaps`를 남겨 REQ-121이 채우게 하기**: REQ-121의 형식은 아직 없고, 모델링 브리프가 무엇을 말할지도 그때 정한다. 지금 타입을 남기면 모양을 미리 정하는 셈이다.
- **`ReadOnlyWorldPort`도 함께 지우기**: REQ-008이 아직 말하는 포트이고 시험(`world.test.ts`, `facades.test.ts`)이 있다. 현실 연결이 아니라 포트의 틀이다.
- **관리자 전용 길의 본보기를 새로 만들기**: 이미 `GET /api/audit`와 `GET /api/audit/export`가 있다. 시험을 위해 길을 만들지 않는다.

## 결과
코드와 시험, 구조 설정, 고지 파일, 요구사항, 문서를 위 결정대로 고쳤다. 이 변경 앞에 쓰던 설정 파일에 `sources`가 있으면 서버가 시작하지 않으니, 설정에서 그 줄을 지운다.
