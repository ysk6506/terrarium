---
title: 사이트·DR 층 — 서버룸 하나에서 멀티 사이트까지, 지역 복제, 합의 DB, 관리형 멀티 AZ
kind: spec
status: active
last_verified: 2026-11-11
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
  - "2026-11-07: REQ-108: ADR-0131에 맞춰 해당 서술을 고쳤고 나머지는 코드와 대조해 그대로 맞다"
  - "2026-11-07: REQ-108: 코드와 대조했고 필요한 서술(기대 복구 시간, 서비스 카드 복사, 숫자 보정)을 고쳤다. 나머지는 그대로 맞다"
  - "2026-11-07: 첫 단계에서 멈추는 전환, 창 +5분, 손대지 않는 시트 설명을 ADR-0133에 맞춰 확인"
  - "2026-11-10: 물리 상수를 슬롯 표로 옮김(REQ-113). v1 동작은 physics-golden이 비트까지 같음을 확인, 문서 내용 변화 없음"
  - "2026-11-11: tools·world/os: 닿지 않는 분기 정리와 시험 추가; 동작은 같음(TD-0002), awk는 이름 바로 뒤 '(' 호출과 srand 반환값"
covers_hash: 1ca6937faa3b3106
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
| `dr_failover_stuck` | 전환 자동화가 첫 단계에서 멈춘다 | 눌러도 옮겨지지 않는다. `site_status`로 멈춘 것을 보고 `dr_failover`를 다시 눌러 이어 간다(이어 가는 데 2분) |
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

## 내장 에이전트는 이 층을 안다 (REQ-108, ADR-0131)
`operator`와 `triage`는 사이트·DR 알람(`site_down` · `wan_down` · `replication_broken` · `dr_failover_stuck` · `site_split_brain` …)을 알아본다. 먼저 `site_status`·`replication_status`로 보고 모드대로 한다.

| 모드 | 하는 일 |
|---|---|
| 핫·액티브 | 아무것도 안 한다. 카운트다운("전환 중")이 끝나길 기다리고 서비스가 멀쩡하면 그대로 끝낸다 |
| 웜 | `dr_failover` 한 번. 계획의 약속 시간의 반쯤에 `site_status`로 멈췄는지 보고 멈췄으면 다시 누른다 |
| 콜드 | 시설 도메인에 `escalate`하고 `dr_failover` |
| 회선 끊김 | `wan_status`를 보고 네트워크 도메인에 넘긴다. 사이트를 옮기지 않는다 |
| 복제 끊김 | `replicad` 재시작, 지리 복제본이면 스토리지 도메인에 넘긴다 |
| 스플릿 브레인 | 주 사이트(없으면 먼저 살아 있는 사이트)를 지킨다 |

GPU(`gpu_status` → `gpu_reset`/`node_drain`, `job_resume`), 전원(`transfer_feed`), 냉방(`cdu_pump_switch`)은 "보고, 한 번 한다" 수준이다. 이 에이전트들은 툴 출력만 보는 관찰 기반이라 100점을 못 받는 시트가 있다(점수표는 [측정](measurement.md)). 정답을 아는 쪽은 에이전트가 아니라 시험 도구인 정답 풀이다. **모든 내장 에이전트의 공통 규칙**: 클러스터가 이미 스스로 복구하고 있으면 손대지 않는다. 이를 `events_since`의 `auto_recovery`(원인 `cluster`의 세계 사건)와 상태 툴의 카운트다운으로 읽는다. 자동 복구 중에는 `failover_service`·`dr_failover`·`breaker_reset` 같은 변경 툴을 부르지 않는다. `guess`는 그대로 어리석다.

## 구별하는 시나리오 아홉 (`scenario/library-site.ts`)
| 시나리오 | 맞는 길 | 막힌 길 |
|---|---|---|
| 사이트 전체의 전기가 끊겼어요 | `dr_failover` | 서버 재시작 |
| 전환이 멈췄어요 | `dr_failover`를 누르고, 멈춘 것을 보고 다시 눌러 이어 가기 | 재시작 |
| 사이트 사이 회선이 끊겼어요 | 회선 상태와 복제 확인 뒤 네트워크 팀에 넘기기 | 전환 (본 사이트가 멀쩡하다) |
| 복제가 멈췄어요 | 복제 상태를 읽고 호스트에서 복제기 다시 시작 | 서버 재시작, 전환 |
| 두 사이트가 모두 주인이 됐어요 | 남길 쪽을 골라 `dr_failover` | 재시작 |
| 합의 DB가 과반을 잃었어요 | `db_node_restart` | 서비스를 대기 쪽으로 옮기기 |
| 관리형 DB가 영역을 오락가락해요 | `db_managed_failover`로 고정 | 재시작 |
| 관리형 DB 저장소가 가득 찼어요 | `db_managed_scale_storage` | 재시작 |
| 지역 복제본이 깨졌어요 | 볼륨 상태 확인 후 넘기기 | 전환 |
시험은 시나리오마다 같은 증상을 내는 다른 시나리오와 구별되는지(`discriminability`)와 셸이나 툴로 단서에 닿는지(`shellReach`)를 본다.

### 정답 풀이는 이 아홉(과 사이트 모드 넷)에서 정확히 100점이다 (REQ-110, ADR-0133)
시트가 풀 수 없는 모양이면 정답 풀이가 100점을 못 받는다. 그래서 다음을 현실에 맞게 고쳤다.
- 콜드·웜의 기대 복구 시간은 계획의 RTO에 눌러서 시작하는 5분을 더한다(5분 넘는 RTO만). 액티브-액티브는 옮기는 일이 없어서 끝 조건에 "DR에서 돈다"가 없다.
- 전환 멈춤은 자동화가 **첫 단계에서** 멈춘다. 절반 지점에서 멈추면 사람이 다시 누를 수 있는 때가 7분 반 뒤라서 복구 순서(2분)가 불가능하다.
- 관리형 DB가 영역을 오락가락하는 시트는 "영역을 고정했다"가 끝 조건이다. 고정하지 않아도 서비스는 멈추지 않기 때문이다.
- 서비스가 멈추지 않는 시트(회선 끊김, 지역 복제본)와 스스로 낫는 시트(핫, 액티브)는 보고를 정확히 한 쪽이 100점이다. 아무것도 안 하거나 찍은 쪽은 0이다.

## 토폴로지
네트워크 층의 첫 칸에 **사이트** 단계가 있다. 사이트 둘과 그 사이의 회선이 서고, 서비스는 노드가 서 있는 사이트(둘 다면 두 사이트)에 기댄다. 사이트가 꺼지면 노드의 절반 이상이 거기 있는 서비스가 영향 범위에 들고 모두 거기 있으면 멈춘 것이다(`topology/impact-site.ts`). 사이트가 하나인 세계에는 이 칸이 없다.

## 숫자의 정직한 한계
- 복구 채점의 시간 창은 시트의 기대 복구 시간을 따른다(REQ-108): 콜드 4시간(만점)~16시간(영점), 웜 15분~1시간, 핫·액티브는 기본 5분~20분. 기대 복구는 "이 모양이 허락하는 시간"이라서 콜드 사이트에서 에이전트가 4시간을 다 써도 만점이다. 웜 몫(`share`)은 대기 서버 수와 비용에만 영향을 준다.
- 거리와 지연은 칩마다 고정이다(콜드 300 km, 웜 100 km, 핫 50 km). 실험에서 거리를 바꾸는 설정은 아직 없다.
- 두 사이트가 넘어서 쓰는 DNS·글로벌 밸런서·인증서 같은 부수 설정은 모델에 없다. 전환 시간에 들어 있다고 본다.
- 셋 이상의 사이트, 지역(리전) 사이의 사이트 전환은 [애플리케이션 층](application-layer.md)의 리전 넘기기와 따로 논다.
