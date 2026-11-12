---
title: ADR-0104 복구 우선 채점을 구현하면서 시험 세 개의 기대값을 고친다
kind: decision
status: active
enforced_by:
  - packages/core/src/oracle/recovery.test.ts
  - tests/spec/recovery-scoring.test.ts
  - tests/spec/os-scenarios.test.ts
  - apps/web/src/logic/recovery.test.ts
touches_protected:
  - docs/design-docs/adr/0091-service-os-layer-recovery-first.md
amends_tests:
  - "tests/spec/os-scenarios.test.ts::the right fix on the host pays nearly in full [REQ-087] > memory leak: a restart helps for a while, the move to the standby is what lasts"
  - tests/spec/os-scenarios.test.ts::a hasty reboot recovers the service but costs points [REQ-087] > rebooting a host whose file system went read-only does bring the service back, minus the reboot
  - tests/spec/os-scenarios.test.ts::a hasty reboot recovers the service but costs points [REQ-087] > rebooting the host of a disk-full service takes points back and does not fix the disk
test_change_reason: 서비스가 있는 시나리오(OS 고장 다섯)의 채점이 항목별 점수에서 복구 우선 네 축으로 바뀌어, 채점표의 항목 이름 recovered와 durable이 recovery_time과 recovery_order로 대체된다. 세 시험은 같은 성질(고치면 점수가 나고 오래 가지 않는 복구는 반만 나고 재부팅은 감점이다)을 새 항목 이름으로 읽는다.
decision_hash: 43616966bf8cf2e3
---
# ADR-0104 복구 우선 채점을 구현하면서 시험 세 개의 기대값을 고친다

## 맥락
[ADR-0091](0091-service-os-layer-recovery-first.md)의 결정 3(복구 우선 채점)과 결정 4(흔한 툴만으로 원인에 닿는 길)를 구현했다(REQ-088). 서비스를 다루는 시나리오는 항목마다 점수를 매기는 대신 서비스가 얼마나 빨리 돌아왔는지를 먼저 재고, 그 뒤에 조치 순서, 악화, 진단·보고를 센다.

## 결정
1. **채점 네 축과 배점.** 서비스 복구 시간 35, 복구 순서 15, 복구 중 악화 없음 20, 진단·보고 30. 앞의 셋이 70점이라 "복구 우선"이 배점에서 읽힌다.
   - **복구 시간(35)**: 에이전트가 일을 맡은 때부터 모든 서비스가 정상이 될 때까지. 5분 안이면 만점, 20분 넘으면 0점, 그 사이는 직선. 맡기 전에 지난 시간(고장을 일으키고 기다린 시간)은 에이전트 탓이 아니므로 빼고, 결과에는 처음 멈춘 때부터 잰 복구 시간(MTTR)을 함께 둔다.
   - **복구 순서(15)**: 일을 맡은 때부터 서비스를 돌려놓은 조치까지. 2분 안이면 만점, 10분 넘으면 0점. 조사가 길어져 고치는 것이 늦으면 깎이고, 먼저 고치고 원인을 나중에 찾으면 만점이다.
   - **악화 없음(20)**: 에이전트의 조치 뒤 3분 안에, 조치 전에 멀쩡하던 서비스가 멈추면 서비스마다 −20점. 이 20점은 해를 끼치지 않고 복구했을 때만 받는다(조치가 없거나 복구가 없으면 0점).
   - **진단·보고(30)**: 원인 60%, 고장 종류 40%(다른 채점표와 같은 몫).
   - 복구가 오래 가지 않으면(채점표가 정한 조건이 끝에 거짓이면, 예: 누수를 다시 시작만 해서 대기 쪽으로 옮기지 않음) 시간과 순서 점수를 절반만 준다. 채점표의 금지 행동(호스트 재부팅 −15)은 그대로 깎는다.
   - 에이전트가 아무것도 바꾸지 않았는데 저절로 돌아온 서비스(메모리 누수의 한 주기, 커널 패닉 뒤 재부팅)는 에이전트의 복구가 아니다. 이 경우 세 축 모두 0점이다.
2. **사고 비용은 사건 기록만으로 센다.** 비용 = (멈춘 시간 + 느린 시간 × 30%) × 시간당 피해(원). 배치 서비스는 같은 시간에 "멈추면 늦어지는 시간"을 곱해 지연(시간)으로 센다. 서비스의 상태 변화는 `alarm.raise`/`alarm.clear`(종류 `service`)가 이미 사건 기록에 남기므로, 사건 목록과 서비스별 피해 값이면 계산된다. 리플레이와 같은 입력이고 순수 함수다(`analyzeRecovery`).
3. **어느 채점인지 시나리오가 정한다.** 시나리오 문서에 `scoring: "recovery"`가 있으면 복구 우선이고, 없으면 지금까지처럼 항목대로다. 결과(`Score.scoring`)에 어느 쪽인지 적고, 채점 버전(`ORACLE_VERSION`)은 "3"이 된다. 서비스가 없는 시나리오의 점수는 그대로다.
4. **변별력 점검에 두 가지를 더한다.** (가) 서비스를 다루는 템플릿마다 장비를 고치지 못해도 서비스를 옮겨 돌려놓는 길(`failover_service`, 없으면 `migrate_vm`)이 있는가. 없으면 점검이 실패한다. (나) 흔한 툴(`realism: common`)만 가진 에이전트가 알람에서 출발해 장비 상세와 서비스 상태에 나온 이름을 16번 안에 따라가 정답 장비에 닿는가. 닿지 않으면 "흔한 툴만으로는 원인에 닿을 수 없어요"를 점검 결과, 템플릿 카드, 실행 결과에 보인다. 툴의 현실 수준 꼬리표는 ADR-0087에서 이미 `TOOL_DOCS`에 있어 그대로 쓴다.
5. **기본 툴 묶음에 `run_command`를 넣는다.** OS 고장 템플릿이 기본 묶음으로 풀려야 한다. Redfish·vCenter·SNMP 같은 날것의 프로토콜 요청은 계속 뺀다. 현실 수준별 묶음은 3차에서 다시 정리한다(`beta-rounds.md`).
6. **시험 세 개의 기대값을 고친다.** OS 고장 시험이 채점표의 항목 이름 `recovered`·`durable`을 읽던 곳 세 군데를 `recovery_time`으로 바꾼다. 읽는 성질(복구하면 점수가 난다, 오래 가지 않는 복구는 일부만 난다, 디스크 꽉 참은 재부팅으로 안 풀린다)은 그대로다.
7. ADR-0091의 앞부분에서 `enforced_by`에 이 구현의 시험을 더한다. 본문은 그대로다.

## 이유
- 실전에서 먼저 필요한 것은 서비스가 돌아오는 것이다. 원인을 맞혔지만 늦게 고친 에이전트를 항목별 채점은 만점 가까이 준다(재시작만으로 75점이던 것, 맞게 고치면 100점이던 것이 그 예).
- 복구 시간만 재면 에이전트가 아무 조치나 해도 저절로 돌아오는 고장이 점수가 된다. "에이전트가 바꾼 것이 있고 끝에 정상"을 함께 요구해서 막았다.
- 악화는 점수를 깎는 쪽으로만 둔다. 서비스를 여럿 멈추고도 복구 시간이 짧은 에이전트가 이기면 안 된다.

## 버린 대안
- **복구 시간만 재기**: 순서와 악화를 따로 보지 않으면 "원인을 먼저 보고 10분 뒤에 고친 것"과 "먼저 고치고 나중에 본 것"이 같은 점수가 될 수 있다. 복구가 같아도 순서는 다르다.
- **복구 시간을 처음 멈춘 때부터 재기**: 시나리오가 고장을 일으키고 기다린 시간(메모리 누수는 11분)이 모든 에이전트에게 깔려 만점이 없어진다. 처음 멈춘 때부터 잰 값은 결과와 사고 비용에 그대로 둔다.
- **모든 템플릿에 복구 우선 채점**: 서비스가 멈추지 않는 시나리오(냉방기 정지, 펌웨어 올리기)에서는 복구 시간이 0이라 가만히 있어도 만점이 된다. 서비스가 있는 시나리오만 쓴다.

## 결과
- 새 시험: `recovery.test.ts`(순수 함수), `recovery-scoring.test.ts`(아홉 가짜 에이전트의 순서, 사고 비용, 같은 사건에서 같은 보고, 첫 줄, 기본 툴 묶음, 복구하는 길, 흔한 툴로 닿는 길), `recovery.test.ts`(웹, 숫자 카드).
- 고쳐진 잠긴 시험: 위 셋.
- 한계: "닿는다"는 알람과 장비 상세를 16번 따라간다는 좁은 뜻이다. 네트워크 CLI나 Redfish를 쓰는 길은 걷지 않는다. 모든 템플릿 카드는 세계가 작을 때(장비 600개 이하)만 이 점검을 한다. 사고 비용은 시간당 피해의 추정 값에서 나오고, 배치 서비스의 지연은 "멈춘 1시간마다 늦어지는 시간"으로 읽은 것이다.
