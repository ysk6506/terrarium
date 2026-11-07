---
title: 애플리케이션 층 — 로드 밸런서·세션·서킷 브레이커·메시·리전과 서비스 호출 그래프
kind: spec
status: active
last_verified: 2026-11-07
covers:
  - packages/core/src/world/app.ts
  - packages/core/src/world/app-act.ts
  - packages/core/src/world/app-health.ts
  - packages/core/src/world/calls-health.ts
  - packages/core/src/world/state-app.ts
  - packages/core/src/world/faults-app.ts
  - packages/core/src/physics/app.ts
  - packages/core/src/physics/app-calls.ts
  - packages/core/src/physics/app-alarms.ts
  - packages/core/src/tools/catalog-app.ts
  - packages/core/src/tools/handlers-app.ts
  - packages/core/src/tools/shell-app.ts
  - packages/core/src/world/os/cmd-lb.ts
  - packages/core/src/scenario/library-app.ts
  - packages/core/src/sources/worldgen/shaped-app.ts
  - packages/core/src/topology/impact-app.ts
  - packages/core/src/world/ladder.ts
verification_log:
  - "2026-11-07: 개체·고장·툴·알아서 하는 일·시나리오를 코드와 대조해 적었다 (REQ-100)"
  - "2026-11-07: 마지막 정리(복잡도 분리) 뒤 코드와 다시 대조했다. 내용은 그대로 맞다"
  - "2026-11-07: o5 합치기 (애플리케이션 층)"
  - "2026-11-07: o7 합치기 (사다리·직접 짓기·시운전)"
  - "2026-11-07: o7 합치기 (사다리·직접 짓기·시운전)"
covers_hash: 20a0b3f71abec6da
---
# 애플리케이션 층 (REQ-100, [ADR-0121](adr/0121-application-layer-and-calls.md), [ADR-0107](adr/0107-world-entry-two-doors-ha-ladders.md) 결정 6)

## 한 문장으로

**서비스가 서로를 부르는 선(`calls`)을 세계에 넣고, 사용자와 프로세스 사이에 서는 것(로드 밸런서, 세션 저장소, 서킷 브레이커, 사이드카와 메시, 리전)을 코어 모델로 올렸다. 서비스 건강은 이 상태를 그대로 읽고, 층이 알아서 하는 일(백엔드 빼기, 브레이커 열고 닫기, 리전 넘기기)은 에이전트가 한 복구와 따로 센다.**

비유하면 식당의 홀과 주방 사이다. 서비스는 코스 요리 하나, `calls`는 "이 요리는 저 소스가 있어야 나간다"는 주방 안의 부름이다. 로드 밸런서는 손님을 빈 조리대로 안내하는 직원, 서킷 브레이커는 "소스 쪽이 계속 안 되면 대체 소스로 내보내라"는 규칙, 메시는 조리대마다 붙은 전달원과 그들을 지휘하는 주방장이다. 리전은 지점 하나다.

## 한계부터 (정직하게)

- **트래픽은 흉내 내지 않는다.** 요청 하나하나를 흘리지 않고, 상태(백엔드가 로테이션에 있는가, 브레이커가 열렸는가)에서 서비스가 정상·느려짐·멈춤 중 무엇인지 읽는다. 재시도 폭주도 배수 하나(`multiplier`)로 센다.
- **호출 건강은 선을 따라 끝까지 번진다.** 서비스 건강은 부르는 상대의 건강(그 상대가 부르는 상대의 건강까지 포함)을 읽는다. 호출이 고리를 이루면 이미 계산 중인 서비스는 정상으로 치고 멈춘다.
- **세션은 "있다·없다"다.** 어떤 사용자의 세션이 어디 있는지는 없다. 세션 저장소가 멈추면 서비스가 느려지고, 리전이 빠지면 그 뒤 두 분(`RELOGIN_S`) 동안 다시 로그인하는 중이라 느려진다.
- **mTLS는 사이드카의 표시 하나다.** 인증서를 만들거나 만료시키지 않는다(인증서 만료는 기존 고장 `cert_expired`가 한다).
- **복제 지연은 리전 상태의 숫자 하나(`lagS`)다.** 30초를 넘으면 그 리전에서 읽는 값이 옛 값이라 느려진 것으로 센다. 어떤 데이터가 얼마나 낡았는지는 없다.
- **로드 밸런서는 가중치·알고리즘이 없다.** 로테이션에 있는 백엔드와 없는 백엔드만 가른다.
- **진짜 envoy/istiod/redis가 아니다.** 셸은 상태로 `curl -I`와 `istioctl proxy-status`의 모양을 만들고, 프로세스는 `systemctl restart redis-server|envoy|istiod`로 다시 시작한다.

## 서비스 호출 그래프 (`calls`)

링크 종류 `calls`는 서비스에서 서비스로 간다(컨테이너 층의 워크로드끼리도 이을 수 있는데, 그건 그림과 영향 범위만 넓힌다). 속성은 모두 선택이다.

| 속성 | 뜻 | 기본 |
|---|---|---|
| `critical` | 부르는 서비스가 상대의 답 없이는 일하지 못한다 | 아니오 |
| `fanout` | 요청 하나에 상대를 부르는 횟수 (재시도 폭주 때 호출 수 계산에 쓴다) | 1 |
| `timeoutMs` | 상대를 기다리는 한계 (ms) | 2000 |

건강 규칙은 `world/calls-health.ts`에 있다. 서비스는 부르는 상대마다 읽고, 가장 나쁜 쪽을 따른다.

| 상대(callee) | 길에 서킷 브레이커 | 부르는 서비스 |
|---|---|---|
| 정상 | 닫힘 | 정상 |
| 멈춤 | 없음, `critical` 아님 | 느려짐 (시간 초과를 기다려요) |
| 멈춤 | 없음, `critical` | **멈춤** |
| 멈춤 | 있음 (닫힘이든 열림이든) | **느려짐만**. 브레이커가 열리고 대체 응답이 나간다 |
| 느려짐 | — | 느려짐 (응답을 기다려요) |
| 정상 | 열림 또는 반열림 (호출을 막고 있음, 굳었을 때도 같다) | 느려짐 (대체 응답만 가요) |

서킷 브레이커가 있는 길은 상대가 돌아오면 브레이커가 반열림으로 한 번 시험한 뒤 **알아서 닫히고**, 부르는 서비스도 알아서 돌아온다(원인 `cluster`, 아래 표).

### 네트워크 정책이 이제 호출을 따라간다

예전(SDN 층, [sdn-network-layer.md](sdn-network-layer.md))에는 정책 하나가 **한 쌍**(정책의 `from` 서비스)만 끊었다. 이제 정책은 지키는 서비스 하나에 붙고(`applies_to`), 정책이 `deny`일 때 **그 서비스를 부르는 서비스 모두**(`calls`의 반대 방향으로, 부르는 서비스가 다시 불리면 그 위로도)와 그 서비스 자신이 느려진다. 한 단계는 정책이 직접 읽고, 그 위는 호출 건강이 이어 번진다. 정책의 `from` 속성은 더는 건강에 쓰이지 않는다. 호출 선이 없는 세계에서는 정책이 지키는 서비스만 느려진다.

### 토폴로지와 영향 범위

서비스 단계 바로 뒤에 **부르는 곳**, **그 아래** 단계(서비스 호출 두 걸음)가 붙고, `calls` 선이 서비스 타일 사이에 그려진다. 영향 범위(`topology/impact.ts`와 `impact-app.ts`)는 호출을 아래에서 위로 걷는다: 상대가 멈추면 부르는 서비스가 범위에 든다. 로드 밸런서·세션 저장소·백엔드는 서비스 앞단(**앞단**)에, 사이드카와 메시는 **사이드카**에, 리전은 **리전** 단계에 선다.

## 개체와 상태

모두 가상 종류라 랙 자리가 없다(`virtual`). 설정은 속성에, 연결은 링크에, 지금의 모습은 상태에 있다.

| 개체 | 설정(속성) | 상태 | 링크 |
|---|---|---|---|
| `app_instance` 앱 인스턴스 | — | 정상/느려짐/멈춤, 로테이션에 있는가(`inRotation`), 뺐는가(`drained`), 플래핑 여부 | `hosted_on` VM·서버, `member_of` 서비스·리전 |
| `load_balancer` 로드 밸런서 | 확인 주기(`intervalS`, 5초), 범위(`scope`: 글로벌이면 리전 사이), 리전 감지 시간(`detectS`, 300초) | 정상/느려짐/멈춤과 이유, 글로벌이면 로테이션의 리전·고정(`pinned`) | `hosted_on`, 서비스가 `depends_on`, 리전이 `member_of` |
| `session_store` 세션 저장소 | — | 정상/멈춤 | `hosted_on`, 서비스가 `depends_on` |
| `circuit_breaker` 서킷 브레이커 | 지키는 `calls` 링크(`link`), 연속 실패(`failures`, 5), 열려 있는 시간(`resetS`, 30초) | 닫힘/열림/반열림(`mode`), 열린 횟수(`trips`), 굳음(`stuck`) | — (속성으로 링크를 가리킨다) |
| `mesh_sidecar` 사이드카 | — | 정상/멈춤, mTLS, 설정 번호 | `hosted_on` 앱 인스턴스, `member_of` 컨트롤 플레인 |
| `mesh_control` 메시 컨트롤 플레인 | — | 정상/멈춤, 설정 번호, 재시도 설정(`sane`/`aggressive`) | `hosted_on` |
| `region` 리전 | 주 리전 여부 | 정상/멈춤, 복제 지연(`lagS`) | 앱 인스턴스가 `member_of` |

## 서비스 건강이 읽는 법

`world/app-health.ts`가 한 서비스에 대해 아래 규칙의 가장 나쁜 쪽을 낸다. 서비스 건강(`service-health.ts`)은 이 판정에 `calls-health.ts`의 판정을 더한다.

| 상태 | 서비스 |
|---|---|
| 로드 밸런서가 멈춤 (로테이션에 백엔드 없음, 올라간 호스트 정지, 글로벌이면 받을 리전 없음) | 멈춤 |
| 로드 밸런서가 느려짐 (죽은 백엔드가 아직 로테이션에 있음, 플래핑, 리전이 멈췄는데 아직 로테이션에 있음, 복제 지연으로 옛 값, 리전이 빠진 뒤 다시 로그인하는 중) | 느려짐 |
| 세션 저장소가 멈춤 | 느려짐 (로그인이 풀려요) |
| 메시 재시도 설정이 `aggressive`이고 누가 이 서비스를 부름 | 느려짐 (호출이 몇 배로 불었어요) |
| 메시 컨트롤 플레인이 멈춤 | **영향 없음.** 사이드카가 가진 설정으로 트래픽이 흐른다(헤드리스). 새 설정을 밀거나 되돌릴 수만 없다 |
| 사이드카가 멈춤 | 그 인스턴스가 멈춤 → 로드 밸런서가 3번 실패 뒤 뺌 |

### 고장 → 서비스 건강

모두 `FAULT_SPECS`(도메인 서비스/OS)에 있고 `FAULT_TOOLS`·`FAULT_RESPONSES`·리드타임 행·운영 모드 MTBF 행·제어 가능 요소표 행이 하나씩 있다.

| 고장 | 대상 | 서비스 | 푸는 길 | 리드타임(원격) | 최소 칩 |
|---|---|---|---|---|---|
| `lb_backend_flapping` | 앱 인스턴스 | 느려짐 (백엔드가 오르락내리락) | `lb_drain(backend)`로 빼기 (완화) | 15분 / 30분 / 2시간 | 로드 밸런서 |
| `session_store_down` | 세션 저장소 | 느려짐 (로그인 풀림) | 호스트에서 `systemctl restart redis-server` | 15분 / 30분 / 2시간 | 상태 없는 앱 |
| `circuit_breaker_stuck_open` | 서킷 브레이커 | 느려짐 (대체 응답만) | `breaker_reset(link)` | 15분 / 30분 / 2시간 | 마이크로서비스 |
| `retry_storm` | 메시 컨트롤 플레인 | 느려짐 (불린 서비스와 부르는 서비스) | `mesh_rollback` | 15분 / 45분 / 2시간 | 서비스 메시 |
| `sidecar_crash` | 사이드카 | 인스턴스가 멈춤 → 백엔드 하나 빠짐 | 호스트에서 `systemctl restart envoy` | 15분 / 30분 / 2시간 | 서비스 메시 |
| `mesh_control_down` | 메시 컨트롤 플레인 | **영향 없음** (새 설정 못 밀기) | `systemctl restart istiod` | 30분 / 1시간 / 4시간 | 서비스 메시 |
| `region_down` | 리전 | 멈춘 리전의 요청이 실패 → 5분 뒤 글로벌 로드 밸런서가 뺌 → 세션 사라짐 → 느려짐 | `region_failover(region)`으로 바로 옮기기 (완화). 리전을 살리는 건 클라우드 팀 | 1시간 / 4시간 / 1일 (외부) | 멀티 리전 |
| `replication_lag_high` | 리전 | 느려짐 (옛 값을 읽음) | `region_failover`로 밀리지 않은 리전에 고정 (완화) | 30분 / 2시간 / 8시간 | 멀티 리전 |

## 알아서 하는 일 (원인 `cluster`)

물리가 매 스텝 돌린다(`physics/app.ts`, `app-calls.ts`). 사람이 한 일이 아니라 사건에 원인 `cluster`로 남고, 세션은 이것을 에이전트의 조치로 세지 않는다.

| 규칙 | 시간 | 사건으로 남는가 |
|---|---|---|
| 로드 밸런서가 헬스 체크 3번 실패한 백엔드를 로테이션에서 뺌 | 3 × 5초 | 예 |
| 로드 밸런서가 2번 통과한 백엔드를 로테이션에 다시 넣음 (직접 뺀 `drained`는 안 넣음) | 2 × 5초 | 예 |
| 서킷 브레이커가 연속 실패 5번에 열림 | 5초 | 예 |
| 열린 브레이커가 30초 뒤 반열림으로 한 번 시험함 | 30초 | 예 |
| 반열림에서 상대가 정상이면 닫힘, 아직 멈춰 있으면 다시 열림 | 바로 | 예 (닫힘) |
| 글로벌 로드 밸런서가 멈춘 리전을 로테이션에서 뺌 | 300초 (`detectS`) | 예 |
| 글로벌 로드 밸런서가 돌아온 리전을 로테이션에 다시 넣음 | 60초 | 예 |
| 리전이 빠지면 그 리전의 세션이 사라져 사용자가 다시 로그인함 | 120초 | 아니오 (느려짐으로 보임) |

굳은 브레이커(`circuit_breaker_stuck_open`)는 시간이 지나도 반열림으로 가지 않는다. `breaker_reset`만 푼다.

## 툴 여덟

모두 다섯 칸(요약·언제 쓰나·언제 안 쓰나·예·비용)을 채웠고 서비스/OS 도메인이다. 툴은 58개에서 66개가 된다.

| 툴 | 하는 일 | 바꾸는가 | 현실성 |
|---|---|---|---|
| `lb_status(service?)` | 로드 밸런서와 백엔드(로테이션, 확인 결과, 플래핑) | 보기만 | 흔함 |
| `lb_drain(backend)` | 백엔드를 로테이션에서 뺌 (직접 빼면 헬스 체크가 통과해도 안 넣음) | 바꿈 | 흔함 |
| `lb_enable(backend)` | 뺐던 백엔드를 되돌림 | 바꿈 | 흔함 |
| `breaker_status(service?)` | 서킷 브레이커와 부르는 쪽·부르는 대상 | 보기만 | 드묾 |
| `breaker_reset(link)` | 브레이커를 닫음. 상대가 아직 멈춰 있으면 몇 번 실패 뒤 다시 열림 | 바꿈 | 드묾 |
| `mesh_status(instance?)` | 컨트롤 플레인과 사이드카 | 보기만 | 드묾 |
| `mesh_rollback(control?)` | 메시 설정을 직전으로 되돌림. 컨트롤 플레인이 멈췄으면 못 함 | 바꿈 | 드묾 |
| `region_failover(region)` | 트래픽을 한 리전에 고정함. 떠나는 리전의 세션은 사라짐 | 바꿈 | 드묾 |

가짜 셸에는 `curl -I http://<서비스>/healthz`(로드 밸런서의 건강을 HTTP 응답 머리글 모양으로: 정상 `200 OK`, 느려짐은 `200`에 `X-LB-Status: degraded`, 멈춤 `503 Service Unavailable`. 정상 백엔드 수와 로테이션 수가 머리글에 있다)와 `istioctl proxy-status`(사이드카마다 설정 동기화 표, 컨트롤 플레인이 멈췄으면 진짜 도구의 오류문)를 `registerShellCommand`로 달았다. `systemctl restart redis-server|envoy|istiod`는 `world/reduce-os.ts`의 `host.act` 뒤처리가 처리한다.

제어 가능 요소표([controllability.md](controllability.md))에는 `lb.drain`, `lb.enable`, `circuit.reset`, `mesh.rollback`, `region.failover`, `host.app_process` 여섯 행이 더해진다.

## 사다리와 세계 생성

`world/ladder.ts`에서 앱 칸의 네 칩(`app-stateless`, `app-microservices`, `app-mesh`, `app-multiregion`)이 `modeled: true`와 `build.app`을 가진다. 점선은 아홉에서 다섯(`sto-geo`, `db-distributed-sql`, `db-managed-multiaz`, `site-dr-warm`, `site-multi-active`)이 된다.

| 칩 | 짓는 것 (앞 칩의 것을 모두 포함) | 새로 느려지는 고장 |
|---|---|---|
| 로드 밸런서·스티키 (`app-lb-sticky`, 이미 실선) | 요청 서비스마다 로드 밸런서, 서비스가 도는 곳마다 앱 인스턴스 | `lb_backend_flapping` |
| 상태 없는 앱 | 외부 세션 저장소 | `session_store_down` |
| 마이크로서비스 | `calls` 링크마다 서킷 브레이커 | `circuit_breaker_stuck_open` |
| 서비스 메시 | 인스턴스마다 사이드카, 그 위에 메시 컨트롤 플레인 | `retry_storm`, `sidecar_crash`, `mesh_control_down` |
| 멀티 리전 | 리전 둘(호스트 두 배), 글로벌 로드 밸런서 | `region_down`, `replication_lag_high` |

생성기는 `sources/worldgen/shaped-app.ts`다. 같은 구성과 번호면 같은 세계다. 서비스 카드의 "이 서비스가 부르는 서비스"(`calls`)가 `calls` 링크가 된다. IAP 기본 카드는 오케스트레이터 → 도메인 에이전트 → 토폴로지 그래프 DB, 오케스트레이터 → GoClaw 코어를 기본으로 부른다. 칩 카드(`apps/web/src/logic/world-shape/cards-*.ts`)의 "생기는 고장"은 칩의 `stops`·`slows`를 고장 이름으로 풀어 쓴 것이라 실제 고장 목록과 같다(시험).

## 시나리오 일곱

`scenario/library-app.ts`, 모두 복구 우선 채점이다. 같은 조치를 일찍 하면 높고, 오래 살핀 뒤에 하면 낮고, 아무것도 안 하면 0점이다(시험). 정답만 아는 에이전트는 30점이고 모두 60점 미만이다. 아무것도 안 함과 찍기는 0점이다. 흔한 툴(`list_alarms`·`list_services`)에서 두 번 만에 원인 장비에 닿는다(`shellReach`).

| 시나리오 | 고장 | 정답 |
|---|---|---|
| 백엔드 한 대가 됐다 안 됐다 해요 | `lb_backend_flapping` | `lb_drain` |
| 세션 저장소가 멈췄어요 | `session_store_down` | 그 호스트에서 `redis-server`를 다시 시작 |
| 서킷 브레이커가 열린 채 굳었어요 | `circuit_breaker_stuck_open` | `breaker_reset` |
| 재시도 폭주가 호출을 불려요 | `retry_storm` | `mesh_rollback` |
| 사이드카가 죽었어요 | `sidecar_crash` | 호스트마다 `envoy`를 다시 시작 |
| 컨트롤 플레인이 멈춘 채 설정이 잘못 퍼졌어요 | `mesh_control_down` + `retry_storm` | `istiod`를 살린 뒤 `mesh_rollback` (컨트롤 플레인이 멈춘 동안은 되돌릴 수 없다) |
| 리전이 통째로 멈췄어요 | `region_down` | `region_failover`. 기다리면 5분 뒤 알아서 넘어가지만 그동안 요청이 실패한다 |

애플리케이션 칩이 없는 세계에서는 시나리오가 "애플리케이션 칩 '…'가 필요해요"라고 이유를 말하고 만들어지지 않는다.

## 토폴로지 머리글

단계가 열다섯을 넘으면서 단계 머리글이 서로 겹쳤다. 머리글은 이제 `topology/words.ts`의 짧은 말(가능하면 다섯 글자 이하: "전원", "서비스", "부르는 곳", "사이드카"…)을 쓰고, 칸이 글보다 좁으면 `fitHead`가 먼저 글자 크기를 12에서 9까지 줄이고 그래도 안 되면 두 줄·세 줄로 나눈다. 기하만 읽는 시험(`apps/web/src/logic/topology/headers.test.ts`)이 너비 1,200px에서 어떤 두 머리글 상자도 겹치지 않는 것을 잰다. 전체 이름은 화면 낭독기와 툴팁이 그대로 말한다.

## 하지 않은 것

- 블루/그린·카나리 배포, 트래픽 쉐이핑 가중치, 레이트 리밋은 없다.
- 서비스 호출의 지연 분포와 요청 수준 트레이스는 없다. 건강은 상태 세 가지다.
- 지역 간 데이터 일관성(충돌 해결, 쿼럼 읽기)은 지연 숫자 하나로만 흉내 낸다.
- 점선으로 남은 다섯 칩(지역 복제 스토리지, 분산 SQL, 관리형 다중 AZ, DR 웜 사이트, 다중 사이트 활성)은 이 층이 아니다.
