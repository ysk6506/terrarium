---
title: ARCHITECTURE — 단위와 의존 방향
kind: reference
status: active
covers:
  - harness/config/architecture.yaml
---
# 아키텍처

한 줄 요약: **월드(상태)와 실험 규칙은 순수 TypeScript `core`에 있고, 바깥 세계(HTTP·MCP·DB·하네스·ClickStack)는
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
                └────────────┴─► session (조립) ─► physics ─► world        sources(worldgen) ─► world
                                                   topology ─► physics, world  (화면·채점이 읽는다)
```

| 단위 | 책임 | 쓸 수 있는 단위 |
|---|---|---|
| `kernel` | ID, 오류, `Clock`/`Rng` 포트, 유일한 비결정 입구 `entropy.ts` | 없음 |
| `llm` | 사람이 등록한 모델 API(LiteLLM·OpenAI 호환·Claude 호환)를 부르는 얇은 클라이언트: 모델 목록과 완성 한 번, `fetch` 주입, 연결 확인. 스트리밍·툴 호출은 없다(ADR-0119) | 없음 |
| `ranking` | 대회 메달 컷과 순위, 메달 수로 정하는 계급. 순수 함수, 아직 화면에 없다(ADR-0122) | 없음 |
| `spatial` | 위치 프로퍼티 → 좌표계. 순수 기하 | kernel |
| `catalog` | 장비 **모델**별 사양(데이터) | kernel |
| `world` | 청사진(부지~장비), 엔티티 상태, 이벤트 로그, 스냅샷 | kernel, spatial, catalog |
| `profiles` | **제품 버전**별 동작 변형 | kernel, catalog |
| `physics.slots` | 물리 모델 자리 열세 개의 표(숫자·곡선·계약)와 프로필 검증·지문·보간 (ADR-0137) | kernel |
| `physics` | 열·전력·공조 동역학 | kernel, spatial, catalog, world, physics.slots |
| `topology` | 월드를 읽어 전원·냉방·네트워크 층의 보드로 접고(타일 150개 이하), 고장의 영향 범위를 계산한다. 화면과 채점용이고 에이전트 툴이 아니다 (ADR-0084, 0097) | kernel, catalog, world, physics |
| `facades` | Redfish/SNMP/BACnet/스위치 CLI·eAPI·NX-API/vCenter/vROps ↔ 월드 포트 번역. 웹을 모른다 | kernel, catalog, profiles, world |
| `tools` | 에이전트용 툴 카탈로그와 디스패처 | kernel, catalog, world, facades |
| `scenario` | 워크플로 시나리오, 지원 기능 목록, 실행기 | kernel, catalog, world, physics, tools |
| `oracle` | 시나리오 정답 기준 채점 | kernel, world, scenario |
| `sources` / `sources/worldgen` | 세계를 만드는 쪽: 방을 짜 맞추는 조립(`sources`)과 사업장 프리셋·규모로 짓는 worldgen. 현실의 그래프를 읽어 짓는 길은 없다(ADR-0202) | kernel, spatial, catalog, world (+부모 sources) |
| `session` | 실행 중인 시뮬레이션 하나를 조립 | 위의 시뮬레이터 단위 전부 |
| `experiments` | 레시피·계보·수명주기·스케줄러 정책·포트, 세계 인기 점수와 정렬, 좋아요·칭호 기록의 모양, 대회 포트(ADR-0122) | kernel, catalog, world, tools, scenario, oracle, session, ranking (ADR-0022, ADR-0122) |
| `analysis` | 결과 분석, 리더보드, 공유 렌더링 | kernel, world, tools, scenario, oracle, session, experiments |
| `contract` | HTTP API 계약(zod) | core 전부 (ADR-0022) |

## server와 web의 단위

| 단위 | 책임 | 쓸 수 있는 단위 |
|---|---|---|
| `server.adapters` | 설정, 저장소(SQLite, ADR-0025), 연결 방식(커넥터: 내장·하네스 프로토콜·A2A·범용 HTTP·MCP 에이전트·OpenClaw·OpenCode·LangGraph·명령, ADR-0042), 비밀 값 봉인(ADR-0043), ClickStack | core 전부 |
| `server.runtime` | 워커 스레드 세션 호스트, 실행기, 스케줄러 루프(ADR-0027), 연결 레지스트리와 에이전트 버전(ADR-0042, 0043), 세계·시나리오·실험·결과 서비스 | core, adapters |
| `server.cluster` | 스케일 아웃: 워커 노드 서버, 노드 등록부, 배치(`ClusterHost`), 자동 확장 지표(ADR-0032) | core, runtime |
| `server.mcp` | 실행마다 하나인 MCP 툴 엔드포인트 | core, runtime |
| `server.http` | 계약의 경로 표 그대로의 Fastify 라우트, SSE, 공유 링크, 정적 웹, 사용자 식별 자리(ADR-0028, 0044) | core, adapters, runtime, mcp |
| `web.logic` | 화면 상태와 계산(DOM 없이 테스트) | core |
| `web.moss` | 이끼: 화면 등록부, 읽기·핸들러 훅, 화면 상태 JSON, `MossAsk` (REQ-103) | core, web.logic |
| `web.ui` | React 화면, 3D 빌더, 시나리오 편집기 | core, web.logic, web.moss |

## 꼭 지켜야 할 경계

- **공개 API**: 다른 단위는 그 단위의 `index.ts`만 import한다. core는 `@terrarium/core/<경로>` 별칭으로 가져온다 (`ARCH011`).
- **형제 격리**: 부모 단위가 같은 단위끼리는 서로를 import하지 않는다. 공유할 것은 부모나 더 아래 단위(`sources`, `spatial` 같은)로 내린다 (`ARCH012`).
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
- **명세 테스트**(`tests/spec/`)는 core 전체를 쓸 수 있고, 브라우저 실행기(`tests/e2e/`)는 그 입구(`index.ts`)로만 쓴다(ADR-0195). "물리가 실제로 망가뜨린 것은 `get_impact`가 미리 말한 범위 안에 있다"처럼 단위 사이의 약속을 검증한다.
- 툴은 프로토콜 파사드를 직접 만들지 않는다. 세션이 실험이 고른 제품 버전으로 `createFacades`를 한 번 만들어 `ToolContext.facades`로 넘긴다.
