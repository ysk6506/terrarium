---
title: ARCHITECTURE — 레이어와 의존 방향
kind: reference
status: active
last_verified: 2026-10-28
covers:
- harness/config/architecture.yaml
covers_hash: 3101b257831489c7
verification_log:
- '2026-10-28: initial'
---
# 아키텍처

한 줄 요약: **월드(상태)를 중심에 두고, 바깥 세계(Redfish·vCenter·FalkorDB·HTTP)는 가장자리에서 번역만 한다.**
규칙의 원본은 [architecture.yaml](harness/config/architecture.yaml)이고 `ARCH*` 검사가 매번 강제한다.
이유는 각 [ADR](docs/index.md)에 있다.

## 레이어 (아래가 기초, 위는 아래만 쓸 수 있다)

```
api ──► service ──► sources(worldgen | realimport)     facades
 │         │              │                               │
 │         ├──► physics ──┼──► world ──► spatial ──► kernel
 │         └──► profiles ──► catalog ──► kernel
```

| 레이어 | 책임 | 쓸 수 있는 레이어 |
|---|---|---|
| `kernel` | ID, 단위, 오류, `Clock`/`Rng` 포트, 유일한 비결정 입구(`entropy`) | 없음 |
| `spatial` | 순수 기하·좌표계 도출. 월드를 모른다 | kernel |
| `world` | 엔티티, 상태, 이벤트 로그, 스냅샷 | kernel, spatial |
| `catalog` | 장비 **모델**별 차이(데이터) | kernel |
| `profiles` | **제품 버전**별 동작 변형 | kernel, catalog |
| `physics` | 열·전력·공조 동역학 | kernel, spatial, world, catalog |
| `facades` | Redfish/vCenter/vROps ↔ 월드 중립 명령 번역. 웹을 모른다 | kernel, world, catalog, profiles |
| `sources` | 월드를 만드는 쪽: `worldgen`, `realimport` (서로 모른다) | kernel, spatial, world, catalog |
| `service` | 유스케이스 조립(시나리오 실행, 스냅샷/리셋, 장애 주입) | 위 전부 |
| `api` | HTTP/UI. FastAPI는 여기서만 | kernel, world, catalog, facades, service |

## 꼭 지켜야 할 경계

- **공개 API**: 다른 레이어는 `terrarium.<layer>`만 import하고, 내용은 `__all__`에 있는 것뿐이다 (`ARCH011`, `ARCH040`).
- **형제 격리**: `worldgen`과 `realimport`는 서로를 import하지 않는다. 공유할 것은 `spatial`로 내린다 (`ARCH012`).
- **외부 라이브러리 가두기**: `fastapi`는 `api`에, `falkordb`는 `realimport`에만 (`ARCH020`). 나머지는 포트 뒤에 숨는다.
- **비결정 금지**: 시간·난수·uuid는 `kernel.entropy`와 `api`에서만 읽는다. 나머지는 주입받는다 (`ARCH052`).
- **순환 금지** (`ARCH030`).

## 새 코드는 어디에 넣나

| 만들려는 것 | 위치 |
|---|---|
| 새 장비 모델 | `catalog` (데이터) |
| 제품 버전별로 응답이 다른 동작 | `profiles` |
| 새 프로토콜 응답 | `facades` |
| 새 물리 현상 | `physics` |
| 좌표/거리 계산 | `spatial` |
| 현실에서 가져오는 새 소스 | `sources/realimport` 의 어댑터 |
| 벤치마크가 부르는 새 엔드포인트 | `service`에 유스케이스, `api`에 얇은 라우트 |

위 표에 없거나 규칙이 막으면 **코드를 옮긴다**. 규칙이 틀렸다고 판단되면 ADR을 먼저 쓴다.
