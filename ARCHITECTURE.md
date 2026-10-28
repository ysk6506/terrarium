---
title: ARCHITECTURE — 단위와 의존 방향
kind: reference
status: active
last_verified: 2026-10-28
covers:
  - harness/config/architecture.yaml
covers_hash: 1eb12685160a1d5a
verification_log:
  - "2026-10-28: rewritten for units v2"
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
                                                     │            └──────────► profiles ─► catalog ─┘
session (조립) ─► physics ─► world        sources(worldgen | realimport) ─► world
```

| 단위 | 책임 | 쓸 수 있는 단위 |
|---|---|---|
| `kernel` | ID, 오류, `Clock`/`Rng` 포트, 유일한 비결정 입구 `entropy.ts` | 없음 |
| `spatial` | 위치 프로퍼티 → 좌표계. 순수 기하 | kernel |
| `catalog` | 장비 **모델**별 사양(데이터) | kernel |
| `world` | 청사진(부지~장비), 엔티티 상태, 이벤트 로그, 스냅샷 | kernel, spatial, catalog |
| `profiles` | **제품 버전**별 동작 변형 | kernel, catalog |
| `physics` | 열·전력·공조 동역학 | kernel, spatial, catalog, world |
| `facades` | Redfish/vCenter/vROps ↔ 월드 포트 번역. 웹을 모른다 | kernel, catalog, profiles, world |
| `tools` | 에이전트용 툴 카탈로그와 디스패처 | kernel, catalog, world, facades |
| `scenario` | 워크플로 시나리오, 지원 기능 목록, 실행기 | kernel, catalog, world, physics, tools |
| `oracle` | 시나리오 정답 기준 채점 | kernel, world, scenario |
| `sources` / `sources/worldgen` / `sources/realimport` | 세계를 만드는 쪽. worldgen과 realimport는 서로 모른다 | kernel, spatial, catalog, world (+부모 sources) |
| `session` | 실행 중인 시뮬레이션 하나를 조립 | 위의 시뮬레이터 단위 전부 |
| `experiments` | 레시피·계보·수명주기·스케줄러 정책·포트 | kernel, catalog, world, tools, scenario, oracle |
| `analysis` | 결과 분석, 리더보드, 공유 렌더링 | kernel, tools, scenario, oracle, experiments |
| `contract` | HTTP API 계약(zod) | session을 뺀 core 전부 |

## server와 web의 단위

| 단위 | 책임 | 쓸 수 있는 단위 |
|---|---|---|
| `server.adapters` | 저장소(SQLite), 하네스 어댑터, ClickStack, FalkorDB | core 전부 |
| `server.runtime` | 워커 스레드 세션 호스트, 스케줄러 루프 | core, adapters |
| `server.mcp` | 실험별 MCP 엔드포인트 | core, runtime |
| `server.http` | Fastify 라우트, 정적 웹 | core, adapters, runtime, mcp |
| `web.logic` | 화면 상태와 계산(DOM 없이 테스트) | core |
| `web.ui` | React 화면, 3D 빌더, 시나리오 편집기 | core, web.logic |

## 꼭 지켜야 할 경계

- **공개 API**: 다른 단위는 그 단위의 `index.ts`만 import한다. core는 `@terrarium/core/<경로>` 별칭으로 가져온다 (`ARCH011`).
- **형제 격리**: `worldgen`과 `realimport`는 서로를 import하지 않는다. 공유할 것은 `sources` 또는 `spatial`로 내린다 (`ARCH012`).
- **외부 라이브러리 가두기**: 모든 패키지는 계약에 선언되어야 하고, 허용된 단위에서만 쓴다 (`ARCH020`). 예: `fastify`는 `server.http`, `three`는 `web.ui`.
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
| 새 하네스 연결 | `server.adapters`의 하네스 어댑터 (포트는 `experiments`) |
| 새 화면 | 계산은 `web.logic`, 그리는 것은 `web.ui` |

규칙이 막으면 **코드를 옮긴다**. 규칙이 틀렸다고 판단되면 ADR을 먼저 쓴다.
