---
title: 사이트·DR 층 — 서버룸 하나에서 멀티 사이트까지, 지역 복제, 합의 DB, 관리형 멀티 AZ
kind: spec
status: active
last_verified: 2026-11-07
covers:
  - packages/core/src/world/ladder-site.ts
  - packages/core/src/world/site-dr.ts
  - packages/core/src/world/site-model.ts
  - packages/core/src/world/site-act.ts
  - packages/core/src/world/site-health.ts
  - packages/core/src/world/state-site.ts
  - packages/core/src/world/faults-site.ts
  - packages/core/src/world/faults-dbx.ts
  - packages/core/src/physics/site.ts
  - packages/core/src/physics/dbx.ts
  - packages/core/src/physics/site-alarms.ts
  - packages/core/src/tools/catalog-site.ts
  - packages/core/src/tools/handlers-site.ts
  - packages/core/src/scenario/library-site.ts
  - packages/core/src/scenario/controls-site.ts
  - packages/core/src/sources/worldgen/shaped-site.ts
  - packages/core/src/topology/impact-site.ts
verification_log:
  - "2026-11-07: REQ-106 구현(ADR-0129)에 맞춰 코드와 대조해 새로 썼다"
  - "2026-11-07: REQ-106을 코드와 대조해 새로 썼다"
  - "2026-11-07: REQ-106 마무리(툴 인자·설명 문구·고장 설명 다듬기)에 맞춰 다시 대조했다. 서술은 그대로 맞다"
  - "2026-11-07: REQ-106 마무리(전환이 이미 옮긴 서비스를 되돌리지 않게 함)에 맞춰 다시 대조했다. 서술은 그대로 맞다"
covers_hash: 917d95e8e343758f
---
# 사이트·DR 층 (REQ-106, ADR-0129)

연수 님의 결정(2026-11-07): "점선인 거 없이 현실세계와 모순되지 않게 전부 설계해서 구현해줘." 마지막 점선 다섯 칩 — 지역 복제(`sto-geo`), 분산 SQL(`db-distributed-sql`), 관리형 멀티 AZ(`db-managed-multiaz`), DR 웜(`site-dr-warm`), 멀티 사이트(`site-multi-active`) — 이 모두 코어가 흉내 내는 실선이 되었다. 사다리의 점선은 0개다.

## 한 줄로
서버룸이 하나일 때는 그 방이 사이트다. 건물이 둘이면 두 번째 건물이 **복구 사이트**가 되고, 둘 사이에 **회선**이 있고, 서비스·볼륨·DB를 **복제 스트림**이 따라 복사하며, **DR 계획**이 약속한 복구 시간(RTO)과 잃어도 되는 쓰기(RPO)를 들고 있다.

## 사다리
| 칩 | 둘째 사이트 | 거리·회선 | 복제 | RTO | RPO | 전환 |
|---|---|---|---|---|---|---|
| 서버룸 하나·둘, 건물 둘 | 없다 (건물 둘은 같은 사이트의 건물) | — | — | — | — | — |
| DR 콜드 (`site-dr-cold`) | 꺼진 서버 + 이미지 | 300 km, 7 ms | 밤마다 백업 | 4시간 (이미지가 30일 넘으면 +2시간) | 24시간 | 사람이 한다 |
| DR 웜 (`site-dr-warm`) | 서비스 절반이 대기 | 100 km, 3 ms | 비동기 | 15분 | 36초 | 사람이 한다 |
| DR 핫 (`site-dr-hot`) | 서비스 전부가 대기 | 50 km, 2 ms | 동기 | 90초 (감지 60초 + 전환 30초) | 0 | 알아서 (원인 `cluster`) |
| 멀티 사이트 (`site-multi-active`) | 두 사이트가 함께 일한다 | 100 km, 3 ms | 동기 | 30초 (죽은 사이트를 글로벌 밸런서가 뺀다) | 0 | 알아서 |

숫자는 사다리 칩과 링크 지연으로 정해지고(`drTargets`), 칩 카드의 "복구 목표" 줄과 다 지었어요 화면이 같은 값을 보인다. 웜 이상은 지역 복제(`sto-geo`) 또는 그에 맞는 DB 칩이 받쳐 줘야 고를 수 있다(전제 표는 [세계 만들기 입구](world-entry.md)).

## 개체
| 개체 | 맡은 일 | 상태 |
|---|---|---|
| `dr_site` | 사이트 하나. 건물과 역할(primary·dr·active) | 서버 `up/total`, 상태, 이미지 나이 |
| `site_link` | 사이트 사이 회선 | 지연(ms), 지연 배수, 상태 |
| `replication_stream` | 서비스·DB·볼륨 하나의 복사 흐름 | 동기·비동기, 상태(ok·lagging·broken), 밀린 초 |
| `dr_plan` | 약속(RTO·RPO), 누가 주인인가, 전환 단계 | 서빙 사이트, 전환 단계, 훈련 결과, 스플릿 여부 |
| `volume` | 지역 복제 볼륨. `replicaSite`와 스트림 | 주인 사이트, 복사본 상태 |
| `db_node` | 합의 DB의 노드 셋 이상. 리더와 term | 역할, term, 밀림, 쓰기 가능한 과반 |
| `db_managed` | 관리형 DB. 영역(az)별 | 주인 영역, 고정 여부, 저장소 찬 정도 |

월드 만들기(`sources/worldgen/shaped-site.ts`)는 서비스마다 둘째 사이트에 복사본을 놓는다(콜드는 꺼진 서버, 웜은 절반, 핫은 전부, 액티브는 양쪽에서 함께 돌고 쿠버네티스 클러스터도 사이트마다 하나씩).

## 고장 (모두 `FAULT_TOOLS`·`FAULT_RESPONSES`·리드타임·MTBF·제어 가능표·골든에 있다)
| 고장 | 일어나는 일 | 서비스에 보이는 것 |
|---|---|---|
| `site_power_loss` | 사이트 전체의 전기가 끊겨 서버가 모두 멈춘다 | 그 사이트에서 돌던 서비스가 멈춘다. 핫·액티브는 알아서 넘어간다 |
| `wan_link_down` | 회선이 끊긴다 | 비동기는 스트림이 밀리고, 동기는 30초 안에 비동기로 물러난다 (쓰기가 그동안 멈칫) |
| `wan_degraded` | 회선이 느려진다 | 동기 복제는 지연 10 ms 위에서 모든 쓰기가 느려진다 |
| `replication_broken` | 스트림이 깨진다 | 조용하다. 복제 지연이 커지고, 그때 사이트를 잃으면 그만큼 잃는다. 호스트에서 복제기를 다시 시작하면 풀린다 |
| `dr_failover_stuck` | 전환이 중간에서 멈춘다 | 서비스가 반쯤 옮겨진 채 멈춘다. `dr_failover`로 마저 끝낸다 |
| `split_brain` | 두 사이트가 모두 주인이다 | 양쪽이 서로 다른 쓰기를 받는다. 한쪽을 골라 전환해야 풀린다 |
| `dr_site_stale` | 콜드 사이트의 이미지가 오래됐다 | 조용하다. 전환 시간이 2시간 늘어난다 |
| `geo_replication_lag` | 지역 복제 볼륨의 복사본이 밀린다 | 조용하다. 볼륨을 올리면 밀린 만큼 잃는다 |
| `geo_replica_broken` | 복사본이 깨진다 | 조용하다. 볼륨을 올릴 수 없다 |
| `db_leader_lost` | 합의 DB의 리더가 죽는다 | 10초 안에 선거가 끝나고 서비스는 잠깐 느리다 (원인 `cluster`) |
| `db_quorum_lost` | 과반이 죽는다 | 쓰기가 멈춘다. 노드를 다시 시작해 과반을 되찾으면 선거가 있다 (원인 `physics`) |
| `db_node_lagging` | 한 노드가 로그를 따라가지 못한다 | 그 노드에서 읽으면 옛 값이 나와 서비스가 느려진다. 노드를 다시 시작하거나 리더를 옮긴다 |
| `db_az_failure` | 관리형 DB의 영역이 죽는다 | 30초 감지 + 60초 멈춤 뒤 알아서 다른 영역으로 넘어간다 (원인 `cluster`) |
| `db_failover_flapping` | 관리형 DB가 영역을 오락가락한다 | 5분마다 짧게 멈춘다. `db_managed_failover`로 영역을 고정하면 멈춘다 |
| `db_storage_full` | 관리형 DB의 저장소가 가득 찬다 | 쓰기가 멈춘다. `db_managed_scale_storage`로 늘린다 (실제 늘어나는 데 10분) |

조용한 고장(`SILENT_SITE_FAULTS`)은 서비스를 건드리지 않아서 시나리오가 진단과 넘기기만 점수에 넣는다.

## 툴
| 툴 | 하는 일 | 바꾸나 |
|---|---|---|
| `site_status` | 사이트·계획·약속과 지금 상태 | 읽기 |
| `replication_status` | 스트림마다 모드·밀린 초 | 읽기 |
| `wan_status` | 회선 지연·상태 | 읽기 |
| `dr_failover` | 서비스를 다른 사이트로 전환 | 바꾼다 |
| `dr_failback` | 본 사이트로 되돌리기 | 바꾼다 |
| `dr_drill` | 옮기지 않고 전환에 걸릴 시간과 잃을 쓰기를 잰다 | 훈련 시각만 |
| `volume_replication_status` / `volume_promote` | 지역 볼륨의 복사 상태 / 복사본을 주인으로 | 읽기 / 바꾼다 |
| `db_cluster_status` / `db_node_restart` / `db_transfer_leader` | 합의 DB 상태 / 노드 다시 시작 / 리더 넘기기 | 읽기 / 바꾼다 / 바꾼다 |
| `db_managed_status` / `db_managed_failover` / `db_managed_scale_storage` | 관리형 DB 상태 / 영역 고르기 / 저장소 늘리기 | 읽기 / 바꾼다 / 바꾼다 |

바꾸는 툴은 모두 [제어 가능 요소표](controllability.md)의 한 줄의 길이고, 시험이 실제로 구동한다.

## 알아서 하는 일 (원인 `cluster`)
- 핫: 주 사이트가 사라지고 60초가 지나면 30초 동안 서비스를 넘긴다. 쓰기는 잃지 않는다.
- 액티브: 죽은 사이트를 글로벌 밸런서가 30초 안에 빼고, 서비스는 옮기지 않는다.
- 합의 DB: 리더가 죽으면 10초 안에 새 리더를 뽑는다. 과반이 없으면 뽑지 못한다.
- 관리형 DB: 영역이 죽으면 감지하고 넘어간다. 회선·저장소 문제로는 넘어가지 않는다.
- 동기 복제: 확인을 받지 못하면 30초 뒤 비동기로 물러난다.
사람이 한 일(`physics` 원인)은 복구 채점에서 에이전트의 몫이고, `cluster`가 한 일은 뒤에 에이전트의 행동이 없을 때만 클러스터의 몫이다.

## 구별하는 시나리오 아홉 (`scenario/library-site.ts`)
| 시나리오 | 맞는 길 | 막힌 길 |
|---|---|---|
| 사이트 전체의 전기가 끊겼어요 | `dr_failover` | 서버 재시작 |
| 전환이 중간에서 멈췄어요 | `dr_failover`로 마저 끝내기 | 재시작 |
| 사이트 사이 회선이 끊겼어요 | 회선 상태와 복제 확인 뒤 네트워크 팀에 넘기기 | 전환 (본 사이트가 멀쩡하다) |
| 복제가 멈췄어요 | 복제 상태를 읽고 호스트에서 복제기 다시 시작 | 서버 재시작, 전환 |
| 두 사이트가 모두 주인이 됐어요 | 남길 쪽을 골라 `dr_failover` | 재시작 |
| 합의 DB가 과반을 잃었어요 | `db_node_restart` | 서비스를 대기 쪽으로 옮기기 |
| 관리형 DB가 영역을 오락가락해요 | `db_managed_failover`로 고정 | 재시작 |
| 관리형 DB 저장소가 가득 찼어요 | `db_managed_scale_storage` | 재시작 |
| 지역 복제본이 깨졌어요 | 볼륨 상태 확인 후 넘기기 | 전환 |
시험은 시나리오마다 같은 증상을 내는 다른 시나리오와 구별되는지(`discriminability`)와 셸이나 툴로 단서에 닿는지(`shellReach`)를 본다.

## 토폴로지
네트워크 층의 첫 칸에 **사이트** 단계가 있다. 사이트 둘과 그 사이의 회선이 서고, 서비스는 노드가 서 있는 사이트(둘 다면 두 사이트)에 기댄다. 사이트가 꺼지면 노드의 절반 이상이 거기 있는 서비스가 영향 범위에 들고 모두 거기 있으면 멈춘 것이다(`topology/impact-site.ts`). 사이트가 하나인 세계에는 이 칸이 없다.

## 숫자의 정직한 한계
- 복구 채점의 시간 창(5분 만점, 20분 영점)은 전체에 같다. 그래서 콜드(4시간)와 웜(15분) 시트는 어느 길로 해도 시간 점수가 낮다. 웜 몫(`share`)은 대기 서버 수와 비용에만 영향을 준다.
- 거리와 지연은 칩마다 고정이다(콜드 300 km, 웜 100 km, 핫 50 km). 실험에서 거리를 바꾸는 설정은 아직 없다.
- 두 사이트가 넘어서 쓰는 DNS·글로벌 밸런서·인증서 같은 부수 설정은 모델에 없다. 전환 시간에 들어 있다고 본다.
- 셋 이상의 사이트, 지역(리전) 사이의 사이트 전환은 [애플리케이션 층](application-layer.md)의 리전 넘기기와 따로 논다.
