---
title: ARCHITECTURE — 단위와 의존 방향
kind: reference
status: active
last_verified: 2026-11-05
covers:
  - harness/config/architecture.yaml
covers_hash: d0ab48c09ab589b4
verification_log:
  - "2026-10-29: server unit rows describe stage 5 (ADR-0025..0028)"
  - "2026-10-29: server.cluster 단위 행과 fastify 허용 단위를 architecture.yaml과 대조했다 (ADR-0032)"
  - "2026-10-30: 2026-10-30: server.adapters 행(커넥터·봉인), runtime 행(연결 레지스트리·버전), http 행(식별 자리), 외부 라이브러리 줄(MCP SDK는 server.mcp와 server.adapters)을 architecture.yaml과 대조했다 (ADR-0042~0044)"
  - "2026-11-04: architecture.yaml 대조: 시험 전용 의존성 ajv와 ajv-formats가 tests.spec 단위에만 허용된 것(ADR-0057)을 외부 라이브러리 줄에, 파사드 단위 설명에 SNMP·BACnet을 반영했다"
  - "2026-11-05: architecture.yaml에 core.topology 단위(kernel, catalog, world, physics)가 늘었다. 단위 표와 그림에 한 줄씩 더했다"
---
# 아키텍처

한 줄 요약: **월드(상태)와 실험 규칙은 순수 TypeScript `core`에 있고, 바깥 세계(HTTP·MCP·DB·하네스·ClickStack·FalkorDB)는
`apps/server`의 어댑터가, 화면은 `apps/web`이 맡는다.** 규칙의 원본은 [architecture.yaml](harness/config/architecture.yaml)이고
`ARCH*` 검사가 매번 강제한다. 결정의 이유는 [ADR-0011](docs/design-docs/adr/0011-units-v2.md).

## 세 개의 패키지

| 패키지 | 실행 위치 | 규칙 |
|---|---|---|
| `packages/core` | 브라우저와 서버 양쪽 | Node 내장 모듈 금지(`ARCH021`), 시계·난수 직접 사용 금지(`ARCH052`) |
| `apps/server` | Node 22 | 포트(인터페이스)를 구현하는 어댑터, 워커 호스트, HTTP, MCP |
| `apps/web` | 브라우저 | React + three.js + React Flow. 서버와는 `core.contract` 타입으로만 대화 |

## core의 단위 (아래가 기초)

```
contract ─► analysis ─► experiments ─► oracle ─► scenario ─► tools ─► facades ─► world ─► spatial ─► kernel
                │            │                       │            └──────────► profiles ─► catalog ─┘
                └────────────┴─► session (조립) ─► physics ─► world        sources(worldgen | realimport) ─► world
                                                   topology ─► physics, world  (화면·채점이 읽는다)
```

| 단위 | 책임 | 쓸 수 있는 단위 |
|---|---|---|
| `kernel` | ID, 오류, `Clock`/`Rng` 포트, 유일한 비결정 입구 `entropy.ts` | 없음 |
| `spatial` | 위치 프로퍼티 → 좌표계. 순수 기하 | kernel |
| `catalog` | 장비 **모델**별 사양(데이터) | kernel |
| `world` | 청사진(부지~장비), 엔티티 상태, 이벤트 로그, 스냅샷 | kernel, spatial, catalog |
| `profiles` | **제품 버전**별 동작 변형 | kernel, catalog |
| `physics` | 열·전력·공조 동역학 | kernel, spatial, catalog, world |
| `topology` | 월드를 읽어 전원·냉방·네트워크 층의 보드로 접고(타일 150개 이하), 고장의 영향 범위를 계산한다. 화면과 채점용이고 에이전트 툴이 아니다 (ADR-0084, 0097) | kernel, catalog, world, physics |
| `facades` | Redfish/SNMP/BACnet/스위치 CLI·eAPI·NX-API/vCenter/vROps ↔ 월드 포트 번역. 웹을 모른다 | kernel, catalog, profiles, world |
| `tools` | 에이전트용 툴 카탈로그와 디스패처 | kernel, catalog, world, facades |
| `scenario` | 워크플로 시나리오, 지원 기능 목록, 실행기 | kernel, catalog, world, physics, tools |
| `oracle` | 시나리오 정답 기준 채점 | kernel, world, scenario |
| `sources` / `sources/worldgen` / `sources/realimport` | 세계를 만드는 쪽. worldgen과 realimport는 서로 모른다 | kernel, spatial, catalog, world (+부모 sources) |
| `session` | 실행 중인 시뮬레이션 하나를 조립 | 위의 시뮬레이터 단위 전부 |
| `experiments` | 레시피·계보·수명주기·스케줄러 정책·포트 | kernel, catalog, world, tools, scenario, oracle, session (ADR-0022) |
| `analysis` | 결과 분석, 리더보드, 공유 렌더링 | kernel, world, tools, scenario, oracle, session, experiments |
| `contract` | HTTP API 계약(zod) | core 전부 (ADR-0022) |

## server와 web의 단위

| 단위 | 책임 | 쓸 수 있는 단위 |
|---|---|---|
| `server.adapters` | 설정, 저장소(SQLite, ADR-0025), 연결 방식(커넥터: 내장·하네스 프로토콜·A2A·범용 HTTP·MCP 에이전트·OpenClaw·OpenCode·LangGraph·명령, ADR-0042), 비밀 값 봉인(ADR-0043), ClickStack, FalkorDB | core 전부 |
| `server.runtime` | 워커 스레드 세션 호스트, 실행기, 스케줄러 루프(ADR-0027), 연결 레지스트리와 에이전트 버전(ADR-0042, 0043), 세계·시나리오·실험·결과 서비스 | core, adapters |
| `server.cluster` | 스케일 아웃: 워커 노드 서버, 노드 등록부, 배치(`ClusterHost`), 자동 확장 지표(ADR-0032) | core, runtime |
| `server.mcp` | 실행마다 하나인 MCP 툴 엔드포인트 | core, runtime |
| `server.http` | 계약의 경로 표 그대로의 Fastify 라우트, SSE, 공유 링크, 정적 웹, 사용자 식별 자리(ADR-0028, 0044) | core, adapters, runtime, mcp |
| `web.logic` | 화면 상태와 계산(DOM 없이 테스트) | core |
| `web.ui` | React 화면, 3D 빌더, 시나리오 편집기 | core, web.logic |

## 꼭 지켜야 할 경계

- **공개 API**: 다른 단위는 그 단위의 `index.ts`만 import한다. core는 `@terrarium/core/<경로>` 별칭으로 가져온다 (`ARCH011`).
- **형제 격리**: `worldgen`과 `realimport`는 서로를 import하지 않는다. 공유할 것은 `sources` 또는 `spatial`로 내린다 (`ARCH012`).
- **외부 라이브러리 가두기**: 모든 패키지는 계약에 선언되어야 하고, 허용된 단위에서만 쓴다 (`ARCH020`). 예: `fastify`는 `server.http`와 `server.cluster`, `three`는 `web.ui`, Redfish 스키마 검사기(`ajv`)는 시험 단위 `tests.spec`, MCP SDK는 `server.mcp`와 MCP 서버의 툴로 에이전트를 부르는 커넥터가 있는 `server.adapters`(ADR-0042).
- **테스트 도구**: `vitest`, `fast-check`는 테스트 파일에서만 (`ARCH022`). 운영 코드는 `test-support/`를 import하지 않는다 (`ARCH013`).
- **순환 금지** (`ARCH030`, 타입 전용 import는 제외).

## 새 코드는 어디에 넣나

| 만들려는 것 | 위치 |
|---|---|
| 새 장비 모델 | `catalog` (데이터) |
| 제품 버전별로 응답이 다른 동작 | `profiles` |
| 새 프로토콜 응답 | `facades` |
| 새 물리 현상, 새 장애 효과 | `physics` |
| 시나리오 블록 | `scenario` (지원 기능 목록에 등록) |
| 에이전트에게 줄 새 툴 | `tools` |
| 새 하네스·에이전트 연결 방식 | `server.adapters/connectors`에 커넥터 하나 (포트는 `experiments`, 화면 폼은 커넥터의 설명에서 만들어진다) |
| 새 화면 | 계산은 `web.logic`, 그리는 것은 `web.ui` |
| 여러 단위에 걸친 동작의 테스트 (예: 장애 → 물리 → 알람 → 툴 응답) | `tests/spec/` |

규칙이 막으면 **코드를 옮긴다**. 규칙이 틀렸다고 판단되면 ADR을 먼저 쓴다.

## 테스트는 어디에 두나

- **단위 테스트**는 그 단위 폴더에 두고, 그 단위가 import할 수 있는 것만 쓴다. 테스트 파일도 의존 방향 규칙을 똑같이 지킨다.
  위 단위가 필요하면(예: `tools` 테스트에 물리 엔진) 상태를 직접 만들거나(`world.patch`, `alarm.raise`) 가짜를 주입한다.
- **명세 테스트**(`tests/spec/`)는 core 전체를 쓸 수 있다. "물리가 실제로 망가뜨린 것은 `get_impact`가 미리 말한 범위 안에 있다"처럼 단위 사이의 약속을 검증한다.
- 툴은 프로토콜 파사드를 직접 만들지 않는다. 세션이 실험이 고른 제품 버전으로 `createFacades`를 한 번 만들어 `ToolContext.facades`로 넘긴다.
