---
title: 서비스 카탈로그 — 기본 제공 카드 열 장과 내 카드 (REQ-104)
kind: spec
status: active
last_verified: 2026-11-07
covers:
  - packages/core/src/world/service-catalog.ts
  - packages/core/src/sources/worldgen/service-card.ts
  - apps/server/src/runtime/service-cards.ts
  - apps/server/src/runtime/experiments-quick.ts
  - packages/core/src/contract/service-cards.ts
covers_hash: da80cbd3da6d1836
verification_log:
  - "2026-11-07: 2026-11-07: REQ-104(ADR-0127) 코드와 대조해 고쳤다"
  - "2026-11-07: REQ-107: 해당 문장을 고쳤고 나머지는 코드와 대조해 그대로 맞다"
  - "2026-11-07: REQ-108: ADR-0131에 맞춰 해당 서술을 고쳤고 나머지는 코드와 대조해 그대로 맞다"
---
# 서비스 카탈로그 (REQ-104, [ADR-0127](adr/0127-short-world-flow-and-service-catalog.md))

"서비스부터"의 첫 화면은 서비스를 **타이핑하지 않고 고른다**. 카드 열 장은 코어의 데이터(`SERVICE_CATALOG`)이고, 카드마다 모양이 정해져 있어 세계 생성기가 항상 지을 수 있다. 사람이 나중에 바꾸는 것은 이름과(실험을 만들 때) 피해 숫자뿐이다. 그림은 없다(입구와 마찬가지로 나중에 3D 렌더로 채운다).

| 카드 | 종류 | 피해 등급(시간당) | 구조(위 · 가운데 · 아래) | 기본으로 부르는 카드 | 사다리에서 중요한 층 |
|---|---|---|---|---|---|
| 웹 API (`web-api`) | 요청 처리 | 일부 느림 50만 / 응답 없음 500만 | 로드밸런서 · API 서버 VM 4 · 가상화 호스트 3 · 스위치 2 | 없음 | compute·network·app |
| 배치 파이프라인 (`batch-pipeline`) | 배치 | 늦어짐 30만 / 아침까지 못 끝남 200만 | 스케줄러 · 워커 VM 3 · 작업 저장소 · 가상화 호스트 2 · 스위치 2 | 없음 | compute·storage |
| 데이터베이스 뒤의 앱 (`app-db`) | 상태 유지 | 읽기만 됨 100만 / 데이터베이스 멈춤 800만 | 앱 VM 2 · 데이터베이스 VM 1 · 가상화 호스트 3 · 공유 스토리지 · 스위치 2 | 없음 | database·storage·compute |
| 쿠버네티스 플랫폼 (`k8s-platform`) | 요청 처리 | 배포만 막힘 30만 / 앱 일부 응답 없음 200만 / 전부 멈춤 500만 | 플랫폼 앱 3 · 컨트롤 플레인 VM 3 · 워커 VM 3 · 가상화 호스트 3 · 공유 스토리지 · 스위치 2 | 없음 | compute·network·storage |
| 메시지 큐 (`message-queue`) | 상태 유지 | 쌓임 80만 / 전달 중단 300만 | 브로커 VM 3 · 디스크 · 가상화 호스트 3 · 스위치 2 | 없음 | compute·storage |
| 캐시 (`cache`) | 요청 처리 | 느려짐 40만 / 캐시 전체 멈춤 150만 | 캐시 VM 2 · 가상화 호스트 2 · 스위치 2 | 없음 | compute·network |
| AI 추론 서빙 (`ai-serving`) | 요청 처리 | 응답 느림 100만 / 모델 응답 없음 600만 | 로드밸런서 · GPU 서버 3 · 가상화 호스트 3 · 스위치 2 | cache | 가속기·컴퓨트·네트워크·냉방 |
| 학습 파이프라인 (`training-pipeline`) | 배치 | 되감기 150만 / 체크포인트 손실 400만 | GPU 서버 4 · 체크포인트 저장소 · 가상화 호스트 4 · 스위치 2 | 없음 | 가속기·컴퓨트·스토리지·전원·냉방 |
| 파일 공유 (`file-share`) | 상태 유지 | 느림 30만 / 파일 열기 불가 250만 | 게이트웨이 VM 2 · NAS · 가상화 호스트 2 · 스위치 2 | 없음 | storage·power |
| 모니터링 (`monitoring`) | 상태 유지 | 알람 지연 20만 / 알람 중단 120만 | 수집기·알람 VM 2 · 시계열 저장소 · 가상화 호스트 2 · 스위치 2 | 없음 | compute·storage |

- **종류**는 코어의 `ServiceKind`(요청 처리·배치·상태 유지)이고 일감(`DEFAULT_WORKLOAD`의 api·interactive·batch·stream)도 카드마다 정해져 있다.
- **피해 등급**은 어림이다(`harmEstimated`). 서비스부터 화면에는 돈이 없고, 실험의 "바꾸기"에서 고친다.
- **기본으로 부르는 카드**: 이미 세계에 있는 서비스 가운데 그 카드에서 만든 것이 있으면 `calls` 링크가 이어진다(키는 카드 id, 같은 카드를 또 고르면 `cache-2`).
- **사다리에서 중요한 층**은 둘째 화면의 안내 한 줄("AI 추론 서빙은 가속기·컴퓨트·네트워크·냉방이 특히 중요해요.")에 쓴다. 층을 대신 고르지는 않는다. 다만 AI 추론 서빙은 가속기 칩 `gpu-serving-pool`, 학습 파이프라인은 `gpu-training-cluster`를 기본으로 달고(`CatalogCard.accel`, REQ-107), "알아서"도 이 둘에서만 GPU를 고른다.
- IAP는 카탈로그 밖의 기본 서비스다(기본 제공 · 잠김). "쿠버네티스 플랫폼" 카드는 IAP와 같은 모양의 작은 판이다.

## 내 카드 (`service_cards`)
`POST /api/service-cards { name, card, harm?, shared? }`는 기본 제공 카드에 이름과 피해 숫자(등급 수가 같아야 한다)를 덮어쓴 카드를 저장한다. 모양은 늘 `card`의 것이다.

| 칸 | 뜻 |
|---|---|
| `owner` | 저장한 사람. 카탈로그에 이름과 칭호 알약으로 보인다 |
| `shared` (기본 false) | true: 모두의 카탈로그에 보인다. false: 만든 사람에게만 보인다 |

`GET`은 내 카드와 공유된 카드를, `PATCH /:id`는 이름·피해 숫자·`shared`를 만든 사람만, `DELETE /:id`도 만든 사람만 한다. **카드는 늘 잠겨 있다**(REQ-108): `locked` 칸은 없고 보내면 400이다. 남의 카드는 `POST /:id/copy { name? }`로 복사해서 내 카드로 쓴다(복사본은 복사한 사람의 것이고 공유 안 된 상태다). 공유되지 않은 남의 카드는 403이다. 카탈로그를 통해 세계에 더해진 서비스는 카드의 **복사본**이라, 나중에 원본을 고쳐도 이미 지은 세계는 바뀌지 않는다.

## 하지 않은 것
- 카드를 직접 설계(구조·종류 바꾸기)하는 편집기. 모양은 기본 제공 열 장뿐이다.
- 카드의 버전·팀 공개·검색·정렬(순서는 기본 제공 열 장, 이어서 만든 순서).
- 공유된 카드의 사용 수·인기 점수.
