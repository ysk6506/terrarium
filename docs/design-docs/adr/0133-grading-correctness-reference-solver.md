---
title: "ADR-0133 채점 정확성 보증: 정답 풀이·결정성·변이 검사"
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - tests/spec/reference-coverage.test.ts
  - tests/spec/reference-solutions.test.ts
  - tests/spec/reference-determinism.test.ts
  - tests/spec/reference-mutations.test.ts
  - tests/spec/operator-isolation.test.ts
  - tests/spec/baseline-agents.test.ts
  - tests/spec/expected-recovery.test.ts
  - tests/spec/calibration.test.ts
  - tests/spec/db-scenarios.test.ts
  - tests/spec/sdn-scenarios.test.ts
  - tests/spec/site-scenarios.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/test-lock.json
amends_tests:
  - "tests/spec/expected-recovery.test.ts::a sheet carries the recovery its world allows [REQ-108] > site chips: cold four hours, warm fifteen minutes, hot and active the usual five"
  - tests/spec/expected-recovery.test.ts::a sheet carries the recovery its world allows [REQ-108] > a restore takes twenty minutes, a grown managed storage ten, whatever the agent does
  - tests/spec/expected-recovery.test.ts::a sheet carries the recovery its world allows [REQ-108] > every other sheet has none, so its score and its digest are what they were
  - tests/spec/baseline-agents.test.ts::operator and triage know the site and DR layer [REQ-108] > a cut line is handed to the network team and nothing is failed over; a broken volume copy to storage
  - tests/spec/baseline-agents.test.ts::operator and triage know the site and DR layer [REQ-108] > a stopped replicator is restarted on its host, and a lost quorum gets its nodes restarted
  - "tests/spec/baseline-agents.test.ts::nobody touches a cluster that is bringing the service back by itself [REQ-108] > hot site: the agents wait for the switch-over, change nothing, and still earn the report"
  - tests/spec/calibration.test.ts::every built-in scenario tells an agent that knows from one that does not [REQ-070] [REQ-007] > the scenarios that give full marks for the answer alone are exactly these (they measure diagnosis, not operation)
  - "tests/spec/db-scenarios.test.ts::what heals by itself is not the agent's recovery [REQ-095] [REQ-088] > auto failover: watching and reporting earns the report, and the result says the cluster did it"
  - "tests/spec/db-scenarios.test.ts::what heals by itself is not the agent's recovery [REQ-095] [REQ-088] > a distributed node lost: the pool heals by itself and the report is what the agent earns"
  - "tests/spec/sdn-scenarios.test.ts::what heals by itself is not the agent's recovery [REQ-097] [REQ-088] > a controller pair: watching and reporting earns the report, and the result says the system did it"
  - "tests/spec/operator-isolation.test.ts::operator sees only the tools [REQ-110] > it asks the endpoint and nothing else: any other reach into the request fails the test"
  - tests/spec/operator-isolation.test.ts::<import:e1047519>
  - tests/spec/sdn-scenarios.test.ts::every SDN sheet is valid and cannot be passed by not knowing [REQ-097] > <stmt:8f3edb9d>
  - tests/spec/site-scenarios.test.ts::every sheet is valid and cannot be passed by not knowing [REQ-106] > <stmt:b6ed7022>
  - tests/spec/site-scenarios.test.ts::recovery first beats cause first beats doing nothing [REQ-106] [REQ-088] > <stmt:944dd9d2>
test_change_reason: 손대지 않는 것이 정답인 시트(자동 전환, 컨트롤러 쌍, 회선 끊김, 복제본 오류, 핫 사이트, 풀 재구성)에서 옛 공식은 세 축을 0으로 두어 만점이 불가능했다. 공식을 보정했고(보고가 가득 차고 끝 상태가 유지될 때만), 창이 모자란 세 시트의 expectedRecoveryS를 세계의 물리 시간 + 5분으로 고쳤다. 그래서 30이던 기대는 100으로, 창 값은 새 값으로 옮겼다. 범위를 느슨하게 한 곳은 없고, 시험이 잡은 `guess` 버그는 코드를 고쳤다. 항목별 옛 기대와 새 기대는 본문 표에 있다.
decision_hash: 0fc0002491fe93fd
---
# ADR-0133 채점 정확성 보증: 정답 풀이·결정성·변이 검사

## 맥락
제품 책임자: "operator가 100점이 아니면 안 되지 않나? 100점이 아닌 층이 있으면 안 되지." 처음에는 `operator`를 100점짜리로 키우자는 요청이었다. 그런데 `operator`가 100점이 되려면 주입한 고장을 알아야 하고, 그러면 에이전트가 아니라 정답지다. 요구를 고쳤다. **채점기(`packages/core/src/oracle/*`)가 늘 맞고 같게 채점해야 에이전트·하네스 구조를 견줄 수 있다.** 그 보증은 사람이 아니라 시험이 서야 한다.

- 만점이 불가능한 시트(풀 수 없거나, 풀어도 100이 안 나오는 시트)가 있어도 아무도 몰랐다. 내장 에이전트는 많은 층에서 0점이었고 그것이 에이전트의 한계인지 시트의 결함인지 가를 수 없었다.
- 같은 행동이 같은 점수를 내는지, LLM이 느리면 점수가 달라지는지를 막아 둔 시험이 없었다.
- 틀린 풀이가 정말 덜 받는지 층마다 확인한 곳이 없었다.

## 결정
1. **오라클은 채점기이고, 정답 풀이(참조 풀이)는 그 채점기의 시험 도구다.** 정답 풀이는 주입한 고장을 알고(정답을 알아도 되는 유일한 쪽이다), 고장 종류마다 정해진 길을 에이전트와 같은 `ToolEndpoint`로 걷는다: 읽기(진단) → 고치기(순서대로) → 확인 → 진짜 원인과 종류로 답하기. 스스로 낫는 고장(핫 사이트의 DR, 분산 스토리지의 재구성, 컨트롤러 쌍의 승격)은 "읽고, 손대지 않고, 답하기"가 길이다. 길은 **데이터**다(`packages/core/src/oracle/reference-path*.ts`, 템플릿마다 다른 길은 `REFERENCE_VARIANTS`, 월드가 길을 정하는 곳은 `choose`). 걷는 코드는 `tests/spec/test-support/reference-solver.ts`에만 있고 선택 가능한 에이전트로 등록되지 않는다.
2. **고장 종류마다 길이 있어야 한다.** `REFERENCE_PATHS`는 `satisfies Record<ReferenceKey, ReferencePath>`라서 새 고장·실수 종류에 길이 없으면 컴파일이 깨지고, `reference-coverage.test.ts`가 한 번 더 막는다(길 없는 종류, 남은 길, 없는 툴, 템플릿 없는 변형).
3. **[REQ-110] 완전성.** `reference-solutions.test.ts`: 내장 템플릿 전부(사이트 모드 넷)와 어떤 템플릿도 주입하지 않는 고장 종류 39개(`tests/spec/test-support/kind-sheets.ts`가 고장 종류마다 만드는 탐침 시트, 세계에서 그 고장이 놓일 수 있는 첫 개체에 놓고 서비스 복구로 채점)에서 정답 풀이는 **모든 항목이 가득 찬 정확히 100점**이다. 100이 안 나오는 시트는 공식을 낮추지 않고 시나리오를 현실에 맞게 고쳤다(아래 보정). 공식이 정당한 경우에 틀렸던 곳은 공식을 고쳤다(아래 결정 6).
4. **결정성.** `reference-determinism.test.ts`: 계층마다 대표 시트 열네 개(시설·네트워크·펌웨어·OS·DB·SDN·K8s·앱·사이트 핫·DR 멈춤·GPU·전원·파워 캐핑·팀에 넘기는 시트)를 같은 시드로 세 번 돌려 점수 분해와 호출 목록의 JSON이 바이트까지 같다. 한 번은 호출마다 15 ms의 실제 시간을 끼워 넣는다. **복구 시간은 시뮬레이션 시계로만 잰다**: 툴 호출 하나는 30 시뮬레이션 초이고 `wait`는 그 초만큼이다. `packages/core/src/{oracle,session,world,physics,tools,scenario}`에는 `Date.now`·`performance.now`·`new Date()`·`setTimeout`·`Math.random`이 없다(이 점검으로 확인했고 새는 곳은 없었다). 그래서 모델이 오래 생각해도, 하네스가 느려도 점수는 그대로다. 호출 수는 점수에 쓰이지만(툴 예산) 호출 시간은 쓰이지 않는다.
5. **변이(건전성).** `reference-mutations.test.ts`: 정답 풀이에서 하나만 틀린 변형이 100 미만이고, 이름 붙은 항목이 깎인다.
   - 틀린 원인·틀린 종류: 모든 시트에서 진단(보고) 항목이 깎인다.
   - 고치기 빼기(보고만 함): 사람이 고칠 게 있는 시트에서 진단 아닌 항목이 깎인다. 모든 시트에서 아무것도 안 함 < 보고만 함이고, 고칠 게 있는 시트에서 보고만 함 < 정답 풀이다.
   - 엉뚱한 대상(열세 시트), 순서 뒤집기(열두 시트), 서비스가 선 서버를 끄기(서버 열두 대 이하의 작은 세계 전부), 늦은 시작(복구 점수 시트 전부, 창의 세 배): 모두 100 미만이고 복구 시간·순서·악화 없음 또는 이름 붙은 항목이 깎인다.
   - 건전성을 시험으로 못 박을 수 없는 곳은 시험 안에 이유와 함께 이름을 적었다(`NOTHING_TO_MEND`, `SELF_HEALING`, `POWER_OFF_IS_FINE`): 서비스가 멈추지 않고 넘기기만 하는 시트(회선 끊김·지역 복제본·UPS 모듈), 시스템이 5분 안에 스스로 낫는 시트(K8s 워커, NVLink 노드, 커널 패닉, 리전 장애 …), 복제가 낡을 뿐 서비스가 멈추지 않는 시트, 해결책이 서버를 끄는 시트, 서버 한 대를 꺼도 다른 복제본이 받는 큰 홀. 큰 홀에서 서버 한 대를 끄는 것은 악화가 아니다.
6. **공식 보정: 손대지 않는 것이 정답인 시트.** 복구 점수(시간 35 · 순서 15 · 악화 없음 20 · 보고 30)는 에이전트가 고친 것만 잰다. 서비스가 한 번도 멈추지 않았거나(복제가 낡을 뿐, 회선이 끊겼지만 본 사이트가 멀쩡), 클러스터가 스스로 고쳤고 에이전트가 아무것도 악화시키지 않았다면, 가만히 보고 정확히 답하는 것이 만점의 길이다. 그런데 공식은 "에이전트가 복구했는가"를 물어 그 길에서 시간·순서·악화 세 축이 0이었다. 이제 이 경우 세 축은 **보고(진단) 항목이 가득 찼을 때만** 만점을 받고(`recovery-score.ts`의 `handsOffShare`, `oracle.ts`가 0 또는 1로 넘긴다), 시트의 끝 상태가 유지될 때만 이 길을 탄다(`lasting`). 아무것도 안 하거나(idle) 찍은 에이전트는 보고 몫이 0이라 여전히 0이고, 악화시킨 에이전트도 이 경로를 못 탄다. 처음에는 보고 항목의 부분 점수를 비율로 넘겼는데, `guess`(진단 18/30)가 18점에서 45~60점으로 뛰어 합격선을 넘는 **내가 만든 채점기 버그**를 `baseline-agents`의 `guess` 시험이 잡았다. 시험이 아니라 코드를 고쳤다: 비율이 아니라 가득 찼는지만 본다. 또 영역을 고정해야 끝나는 시트(`db-managed-flapping`)와 복제를 되살려야 하는 시트(`replication-broken`)는 답만 하고 기다려도 75점이 나와 합격선을 넘었다. 끝 상태가 서지 않으면 이 길을 못 타게 막았다(`lasting`). 이 둘은 다시 30점이다. 복구 점수가 없는 시트(고전 채점)와 `ORACLE_VERSION "3"`은 그대로다: 에이전트가 직접 복구한 모든 기존 점수는 전과 같다.
7. **`operator`는 정답을 아는 에이전트가 아니라 관찰만 하는 규칙 기반 전문가다.** 알람 코드·오류 이유·프로브 결과로 고장의 갈래를 정하고 갈래마다 정해진 대응을 한다(`scripted-operator.ts`, `baseline-layers.ts`, `hands-off.ts`). 시나리오 정의·주입한 고장·정답·서버 내부 상태는 어떤 경로로도 받지 않는다. `operator-isolation.test.ts`가 (a) 소스가 `@terrarium/core/experiments`의 타입과 형제 파일만 가져오는 것, (b) 그 가져오기가 `import type`뿐인 것, (c) 요청의 `ToolEndpoint`에서 `specs`와 `call` 말고 다른 속성에 손대지 않는 것을 지킨다. `operator`는 100점을 못 받는 시트가 많고 그것이 정직한 값이다. `triage`는 보고만 하고, `guess`와 `idle`은 그대로다. 점수표는 [측정](../measurement.md)에 있다.
8. **정답 풀이를 `operator`로 쓰지 않는다.** 정답 풀이는 정답을 알고 있고 선택 가능한 에이전트가 아니다. 시험 지원 코드 안에만 산다.

## 보정: 시트와 물리, 공식을 고친 곳 (모두 현실의 약속을 따른다)
정답 풀이가 100점을 못 받은 시트를 고쳤다. 공식을 낮춘 곳은 결정 6 하나다. 어느 곳도 "점수가 모자라니 기준을 낮추기"가 아니다.

| 시트 | 문제 | 고침 |
|---|---|---|
| `outage-generator-fails` | 배터리가 버틸 분이 20분이라 서버를 최대한 줄여도 닿지 않았다 | 닿는 값 18분(`HOLD_MINUTES`). 서버마다 `set_power_cap`으로 전력을 낮추면 닿는다 |
| `db-restore-corrupt-backup` | 복원이 눌러서 20분 걸리는데 창이 20분이라 만점이 불가능했다 | 창을 복원 시간 + 5분(`RESTORE_S + 300`) |
| `storage-node-lost` | 풀 재구성에 15분인데 창이 5분이다 | 창을 재구성 시간 + 5분(`DEFAULT_REBUILD_S + 300`), 손대지 않고 기다리는 길(결정 6) |
| `sdn-tunnel-down` · `k8s-etcd-quorum` | 팀만 고치는 고장인데 창이 5분이다 | 창을 팀의 가장 긴 방문 + 5분(4시간 5분, 24시간 5분) |
| `site-power-loss` (콜드·웜) | 창이 계획의 RTO와 같아 눌러서 시작하는 시간이 모자랐다 | RTO가 5분을 넘으면 5분을 더한다(`planRto`) |
| `site-power-loss` (액티브) | 끝 조건이 "서비스가 DR에서 돈다"인데 액티브-액티브는 옮기는 일이 없다 | 액티브는 끝 조건에서 뺀다 |
| `dr-failover-stuck` | 첫 `dr_failover`가 절반 지점(웜 7분 30초)에서 멈춰 사람이 다시 누를 때까지 7분 반을 기다려야 해서 복구 순서(2분)가 불가능했다 | 자동화가 **첫 단계에서** 멈춘다(`physics/site.ts`): 눌러도 안 움직이고, `site_status`로 멈춘 것을 보고 다시 누르면 이어 간다. 이어 가는 시간(2분)은 그대로 |
| `db-managed-flapping` | 고정하지 않아도 서비스가 멈춘 적이 없어서 아무것도 안 하고 답만 해도 100이었다 | 끝 조건에 "영역을 고정했다"를 넣었다(`db_managed`에 `pinned` 조건 칸을 더함) |
| `ib-link-flap` | 노드를 빼도 그 노드의 흔들리는 링크가 패브릭을 계속 "저하"로 만들어 서비스가 낫지 않았다 | 스케줄러에서 뺀 노드의 링크는 패브릭 건강에 세지 않는다(`physics/accel.ts`) |
| 팀 몫인 고장 둘 (`wan-link-cut` · `geo-replica-broken`) | 팀이 못 고치는 시간 안에 `untilTeamDone`을 기다리면 제한 시간을 넘겼다 | 길이 넘기고 답한다. 서비스가 한 번도 멈추지 않으므로 결정 6으로 100 |
| 고장 설명 (`dr_failover_stuck`) | "중간에서 멈춘다"가 더는 사실이 아니다 | "첫 단계에서 멈춘다" |


## 잠긴 시험을 고친 곳: 옛 기대 → 새 기대, 왜 옛 기대가 틀렸나
시험을 느슨하게 하지 않았다. 범위는 문서에 적은 채점기·시나리오 고침 때문에 옮기거나 좁히기만 했다. 시험이 내가 만든 채점기 버그를 잡은 곳은 코드를 고쳤다(위 결정 6의 `guess`와 `lasting`).

| 시험 | 옛 기대 | 새 기대 | 왜 옛 기대가 틀렸나 |
|---|---|---|---|
| expected-recovery: 사이트 칩 | 콜드 14 400 · 웜 900 · 전환 멈춤 900 | 14 700 · 1 200 · 1 200 | 창이 계획의 RTO와 같아 눌러서 시작할 시간이 없어 만점이 불가능했다. 이제 RTO + 5분(`planRto`) |
| expected-recovery: 복원 | 1 200 | 1 500 | 복원이 눌러서 20분 걸리는데 창도 20분이었다. 복원 시간 + 5분 |
| expected-recovery: 다른 시트는 창이 없다 | 창 없는 시트 목록 | `storage-node-lost` · `sdn-tunnel-down` · `k8s-etcd-quorum`을 목록에서 뺀다 | 세 시트는 재구성·팀 방문 시간보다 창이 짧아 만점이 불가능했다. 이제 창이 있다(재구성 + 5분, 4시간 5분, 24시간 5분) |
| baseline-agents: 회선 끊김·지역 복제본 (operator·triage) | 30 | 100 | 서비스가 멈추지 않는 고장이라 보고만 하고 손대지 않는 것이 정답이다. 옛 공식은 "에이전트가 복구했나"만 물어 세 축이 0이었다(결정 6) |
| baseline-agents: 복제 중단 (operator·triage) | 30 | 100 | 복제기를 다시 켜는 것이 길이고 그 길을 따랐는데 서비스는 멈춘 적이 없어 옛 공식이 세 축을 0으로 두었다(결정 6) |
| baseline-agents: 핫 사이트 (operator·triage) | 30 | 100 | 클러스터가 스스로 옮기고 에이전트는 손대지 않고 답했다. 손대지 않는 것이 정답이다(결정 6) |
| baseline-agents: `guess` | 18 | 18 (그대로) | 공식 보정이 처음에 `guess`를 45~60점으로 올렸다. 시험이 잡은 내 버그라 코드를 고쳤다(보고 항목이 가득 찬 경우만 인정) |
| calibration: 정답만으로 만점인 시트 | `fan-failure-throttle` · `plant-loop-down` · `sensor-drift` | 위 셋 + `db-primary-down` · `sdn-controller-down` · `wan-link-cut` · `geo-replica-broken` | 넷은 가만히 보고 정확히 답하는 것이 정답인 시트다(자동 전환, 컨트롤러 쌍, 회선 끊김, 복제본 오류). 정확히 이 일곱이어야 한다고 그대로 못 박았다 |
| db-scenarios: 자동 전환 | 30 | 100 | 클러스터가 승격하고 에이전트는 보고만 했다. 결정 6 |
| db-scenarios: 분산 노드 손실 | 30, 끼어든 쪽 30 미만 | 100, 끼어든 쪽 100 미만 | 풀이 스스로 재구성하고(창을 15분 + 5분으로 고침) 손대지 않는 것이 정답이다. 끼어든 쪽이 정답보다 낮다는 뜻은 그대로다 |
| sdn-scenarios: 컨트롤러 쌍 | 30 | 100 | 쌍이 스스로 승격한다. 결정 6 |
| sdn-scenarios: 컨트롤러 쌍의 진단만 | 60 미만 | 정확히 100 (홑 컨트롤러는 60 미만 그대로) | 쌍은 답이 곧 전부다 |
| site-scenarios: 회선 끊김·지역 복제본의 진단만 | 60 미만, 경고 없음 | 정확히 100, 경고는 "정답만 말하면 만점" 하나 | 두 시트는 손대지 않고 답하는 것이 정답이다. 다른 일곱 시트는 옛 기대 그대로 |
| site-scenarios: 저장소 가득 참, 일찍 vs 늦게 | 일찍 > 늦게 | 둘 다 정확히 100 (다른 시트는 그대로) | 관리형 저장소가 10분 뒤에 스스로 늘어나므로 긴 관찰 뒤에도 창 안에서 끝난다. 늦게 해서 깎이던 순서 축이 손대지 않는 정답에서는 안 깎인다. 아무것도 안 하면 0이라 "늦게 > 아무것도"는 그대로 선다 |

`k8s-scenarios`·`sdn-scenarios`의 다른 시험과 `db-scenarios`의 나머지는 고치지 않았다.

## 이유
- 채점기가 틀리면 에이전트 사이의 모든 비교가 틀린다. "정답이 100점이다"와 "틀린 답은 덜 받는다"는 채점기 시험으로 먼저 서야 한다.
- `operator`를 100점으로 만들면 정답지가 된다. 정답을 아는 쪽을 따로 두고, 관찰만 하는 쪽은 관찰만 하게 두어야 두 가지를 다 잴 수 있다.
- 길을 코드가 아니라 **데이터**로 두면 고장 종류를 더할 때 길을 더하는 것이 필수가 된다.
- 결정 6은 "가만히 보고 맞게 답하는" 올바른 전략에게 불리했던 공식의 구멍이다. 구멍만 막고 나머지는 한 줄도 바꾸지 않았다.

## 대안과 버린 이유
- `operator`를 정답 풀이로 키우기: 정답지가 된다. 거부.
- 못 푸는 시트의 기준을 낮추기: 시험이 아무것도 보증하지 못한다. 시트를 현실에 맞게 고쳤다.
- 모든 시트에 대한 변이 시험을 한 규칙으로: 서버 한 대를 끄는 변형은 복제본이 있는 큰 홀에서는 악화가 아니다. 규칙마다 적용 범위와 이유를 시험 안에 적었다.
- 호출 시간으로 복구 시간을 재기: 모델·하네스에 따라 점수가 달라진다. 시뮬레이션 시계만 쓴다.

## 결과
REQ-110. [측정](../measurement.md)(5절), [운영 에이전트 가이드](../../guides/operation-agent-guide.md), [사이트·DR 층](../site-dr-layer.md).
