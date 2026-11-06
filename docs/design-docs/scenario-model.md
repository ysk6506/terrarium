---
title: 시나리오 모델
kind: spec
status: active
last_verified: 2026-11-06
covers:
  - packages/core/src/scenario/model.ts
  - packages/core/src/scenario/blocks.ts
  - packages/core/src/scenario/runner.ts
  - packages/core/src/scenario/library-facility.ts
verification_log:
  - "2026-11-04: event 이력 조건, set_outdoor_temp 지원, 채점표 사실 규칙, 운영 채점 시나리오를 model.ts·blocks.ts·runner.ts·library와 대조해 더함 (REQ-073, ADR-0075)"
  - "2026-11-04: library.ts·library-facility.ts는 채점 코드를 도우미 함수로 나눴을 뿐이고 문서 내용은 그대로임을 대조"
  - "2026-11-05: ADR-0101: 행동 종류에 펌웨어 올리기, 펌웨어 올리기와 작업 보고 절을 model.ts, conditions.ts, library-firmware.ts와 대조해 더했다"
  - "2026-11-06: 2026-11-06: ADR-0091(결정 1·2)·ADR-0102 구현: 서비스 층·OS 층 1차를 코드와 대조해 해당 절을 더하거나 고쳤다. 이 문서가 말하는 나머지 구조는 그대로다"
  - "2026-11-06: model.ts의 ScenarioDoc.scoring과 digest.ts, library-os.ts의 채점표(진단·재부팅 금지·끝에 정상)를 대조해 복구 우선 채점 절을 더했다 (REQ-088, ADR-0104)"
covers_hash: b7f880ef04443350
---
# 시나리오 모델 (REQ-033, REQ-034)

## 한 문장으로

시나리오는 **"무슨 일이 언제 벌어지나"(흐름)** 와 **"무엇을 하면 잘한 것인가"(채점표)** 두 부분으로 된 문서다.
편집기가 저장하고, 실행기가 시뮬레이션 시간 위에서 돌리고, 오라클이 채점한다.

## 흐름: 블록과 연결

- 블록은 노코드 편집기의 상자다. 종류는 `BLOCK_SPECS`(blocks.ts) 한 곳에 있고, 편집기 팔레트·검증·실행기가 모두 이 표를 읽는다.
- 블록에는 출구(포트)가 있다. 대부분 `next` 하나, 분기는 `yes`/`no`, 조건 대기는 `met`/`timeout`, 무작위는 `1..n`.
- **한 출구에서 여러 연결이 나가면 동시에 진행**된다(고장 확산과 에이전트 작업이 함께 흐른다). 두 갈래가 다시 만나면
  만난 블록이 두 번 실행되므로 검증이 경고(SC019)한다. 분기의 예/아니오처럼 배타적인 갈래가 만나는 것은 괜찮다.
- 고리(cycle)는 금지다(SC008). "될 때까지 반복"은 `조건 대기`로 표현한다. 그래서 실행은 늘 유한하다.
- `에이전트 투입` 블록이 정확히 하나 있어야 한다. 여기서 상황 설명·툴 호출 상한·제한 시간이 정해진다.
  이후 블록은 에이전트가 일하는 동안에도 계속 진행된다(예: 15분 안에 진단 못 하면 고장이 번진다).
- 블록 이름과 폼의 말은 [용어집](glossary.md)을 따른다(`inject_fault`는 "고장 발생", `clear_fault`는 "고장 복구"). 팔레트 묶음은 고장 → 설정 바꾸기 → 흐름 → 에이전트 순서다. 시간 값(`seconds`, `timeoutSeconds`, `durationSeconds`, `timeLimitSeconds`)은 초로 저장하고 폼·캔버스·검증 메시지에서는 분으로 보이며(`units.ts`), 고장의 `durationSeconds` 0은 폼에서 "고쳐질 때까지", 양수는 "n분 뒤 저절로 복구"다.

## 시간

세션이 시간을 쥔다. 세션이 물리를 한 걸음 진행하고 `runner.tick()`을 부르면, 그 시각에 할 일이 있는 블록이 모두 실행된다.
같은 시각의 블록은 들어온 순서대로, 무작위 블록은 `(시드, 블록 id, 방문 횟수)`로 뽑으므로 **같은 시드면 늘 같은 결과**다.
블록을 하나 더 넣어도 다른 무작위 블록의 선택은 바뀌지 않는다.

실행 중 블록이 행동할 수 없으면(예: 범위를 벗어난 설정 온도) 기록(`error`)만 남기고 흐름은 계속된다. 시나리오 하나의 실수로
실험 전체가 멈추지 않게 하기 위해서다. 그런 실수는 원래 검증 단계에서 걸러진다.

## 채점표 (expectations)

| 종류 | 뜻 |
|---|---|
| `diagnosis` | 정답 원인(여러 개 허용)과 고장 종류 |
| `final_state` | 끝났을 때 참이어야 하는 조건 (예: 영향권 서버가 모두 살아 있다) |
| `required_action` | 반드시 해야 하는 조치 (예: pdu-a 차단기 리셋) |
| `forbidden_action` | 할 때마다 감점인 조치 (예: 멀쩡한 서버 전원 끄기) |
| `time_limit` | 과제 시작 후 몇 초 안에 진단했나 |
| `tool_budget` | 툴 호출을 몇 번 이하로 썼나 |

채점은 `core.oracle`이 한다. 채점표는 사실만 말한다(REQ-073, ADR-0075): "서버가 살아 있다"는 켜져 있음(`adminOn`)과 열 보호 차단 없음으로 보고(전원 공급 `powered`는 에이전트가 끈 서버에도 참이다), 유일한 완화를 벌하는 금지 항목은 없고, 상황 설명은 그 세계에서 일어나는 일만 말한다. 조건은 흐름과 채점표가 같은 `Condition` 형식을 쓴다.

조치는 **툴 이름이 아니라 세계에 끼친 효과**로 적는다(전원 끄기·켜기, 재시작, 차단기 리셋, 냉방 설정 변경, 포트 끄기·켜기, 콘센트 끄기·켜기, 펌웨어 올리기, 서비스 대기 쪽으로 옮기기·서비스 다시 시작·프로세스 다시 시작·디스크 비우기·파일시스템 다시 마운트·VM 옮기기 — ADR-0019, ADR-0059, ADR-0060, ADR-0101).
`power_server`로 껐든 Redfish `ComputerSystem.Reset`으로 껐든 같은 "전원 끄기"다. 그래야 툴 조합이 다른 실험끼리 공정하게 비교된다.
세션이 툴 호출마다 그 호출이 일으킨 월드 명령을 행동(`effects`)으로 묶어 기록한다.

## 쓸 수 없는 블록과 그 이유

팔레트(`paletteFor`)는 세계마다 블록을 "쓸 수 있음/없음 + 이유"로 보여 준다. 이유는 두 가지뿐이다.

1. 시뮬레이터가 아직 지원하지 않는다 (`status: "planned"` — 지금은 네트워크 지연·손실 하나. 링크 지연·손실 모델과 경로의 링크 id가 먼저 필요하다).
2. 이 세계에 대상 장비가 없다 (예: 냉방기가 없는 세계의 냉방기 정지).

지원하지 않는 블록은 감추지 않는다. 무엇이 아직 안 되는지 보이는 것이 신뢰(credible)에 도움이 된다.

## 버전(digest)

`scenarioDigest`는 벤치마크 키의 일부다. **동작과 채점에 영향을 주는 것만** 해시한다. 블록 위치, 캡션, 시나리오 이름을
바꿔도 digest는 같으므로 화면 정리 때문에 벤치마크 집합이 갈라지지 않는다.

## 기본 제공 시나리오

`SCENARIO_TEMPLATES`(library.ts)는 주어진 세계에서 대상을 골라 시나리오를 만든다(예: 가장 많은 랙을 맡은 냉방기).
명세 테스트(`tests/spec/scenarios.test.ts`)가 "에이전트가 투입될 때 기본 툴로 근본 원인이 보인다"를 확인한다.
아무도 풀 수 없는 시나리오는 아무것도 측정하지 못하기 때문이다. 과제 설명에는 증상만 쓰고 정답을 쓰지 않는다(테스트가 확인).

## 시설 시나리오 (REQ-044, REQ-046)

내장 템플릿은 두 묶음이다. `SCENARIO_TEMPLATES`는 어느 서버룸에서나 쓸 수 있는 다섯 가지(팬 고장, 냉방기 정지, 센서 오차, PDU 트립 연쇄,
VM 폭주). `FACILITY_TEMPLATES`는 플랜트·수랭·발전기가 있는 세계에서만 쓴다: **냉각 플랜트 루프 정지**(한 루프의 칠러가 함께 선다),
**CDU 정지와 수랭 서버 열 폭주**, **정전과 발전기 기동 실패**(예비 발전기까지 선다). 장비가 없으면 `unavailable`이 이유를 말한다.
`ALL_SCENARIO_TEMPLATES`가 둘을 합치고 `scenarioTemplate(id)`는 둘 다 찾는다.

## 설정 변경 블록 (REQ-068, ADR-0065)

조작 블록 여섯 개(포트 끄기/켜기, 포트 VLAN, VLAN 인터페이스, BGP 이웃, 정적 경로 지우기, PDU 콘센트)가 `BLOCK_SPECS`에 더해졌다. 블록 정의는 `blocks-net.ts`에 있고 `blocks.ts`가 합친다. 이 블록들의 매개변수는 새 종류 `net_pick`이다: 위에서 고른 스위치(`dependsOn`)가 가진 것의 목록에서 고른다. 에이전트가 `network_cli`로 스위치 설정을 바꾸면 행동 `config_change`로 기록된다. 자세한 내용과 내장 템플릿 일곱 개는 [설정 변경 시나리오](config-scenarios.md)에 있다. 알람 조건은 정확한 코드 또는 `코드.` 접두사에 맞는다(`link_down.<케이블>`처럼 뒤에 상세가 붙는 코드 때문이다).

## 이력 조건 `event`와 외기 온도 (REQ-073, ADR-0075)

조건의 `event`는 지금 상태가 아니라 **한 번이라도 있었나**를 묻는다. `{kind: "event", type, target?, occurred?}`: 세계 사건 기록에 그 사건 종류(`thermal.shutdown`, `fault.add`, `setpoint.set` 등 `events.ts`의 목록)가 있었는가, 대상이 있으면 그 장비나 링크에 대해서만. `occurred: false`면 "없었다"를 묻는다. 시나리오 시작 전(데움)에 있던 사건은 세지 않는다. 오라클, 검증(알 수 없는 사건 종류는 문제), 편집기("무엇을 묻나"에 이력 조건이 있고 "어떤 일", "대상", "있었나, 없었나"를 고른다)에 모두 들어 있다. 쓰임: "열 보호로 꺼진 적 없음". 시각 조건("N분 안에")은 없다.

`set_outdoor_temp`(외기 온도 바꾸기)는 이제 지원 블록이다. 명령 `outdoor.set`(−30~50°C)이 세계의 외기 온도(`WorldState.outdoorC`, 기본 25)를 바꾸고, 조건에서는 `site.outdoorC`로 읽는다. 팔레트에 남은 "아직 지원하지 않음"은 네트워크 품질 저하 하나다.

## 펌웨어 올리기와 작업 보고 (REQ-002, REQ-071, [ADR-0101](adr/0101-rack-containment-firmware-amend-tests.md))

서버에는 BMC와 BIOS의 버전이 있고(조건 필드 `bmcVersion`, `biosVersion`, 글자 비교), Redfish `UpdateService`의 `SimpleUpdate`로 올린다. 올리기는 **시간이 가는 일**이다: 2분 뒤 서버가 꺼지고(`rebooting`), BIOS는 4분, BMC는 2분 뒤에 새 버전으로 돌아온다. 고장 "펌웨어 올리기 실패"를 걸어 둔 서버는 정해진 횟수만큼 끝에서 실패하고 이전 버전과 경고 알람(`firmware_update_failed`)으로 돌아온다.
채점은 이 일을 사건(`firmware.update`·`reboot`·`finish`·`fail`)과 상태로 읽는다. 올릴 것이 있고 찾을 고장은 없으므로 진단의 "고장 종류"에는 일 종류 `firmware_update`를 쓸 수 있고(작업 보고), 시험지 점검은 이것을 고장이 없어도 올바른 정답으로 받아들인다. 템플릿 셋은 [설정 변경 시나리오](config-scenarios.md#펌웨어-작업-템플릿-셋)에 있다.

## 서비스와 OS (REQ-086, REQ-087, [ADR-0091](adr/0091-service-os-layer-recovery-first.md))

조건 필드에 서비스의 `status`(healthy·degraded·down), `backlog`(밀린 일), `lostKrw`(지금까지 본 피해, 추정), `failovers`(대기 쪽으로 옮긴 횟수)가 있다. 고장 종류에 OS 열 가지(분야 "운영체제")가 더해졌고, 내장 템플릿 묶음 "OS 고장" 다섯이 있다. 조치는 행동 종류 여섯으로 읽힌다. 계산과 표는 [서비스·OS 층](service-os-layer.md).

### 복구 우선 채점 `scoring` (REQ-088, [ADR-0104](adr/0104-recovery-scoring-amend-tests.md))

시나리오 문서에 `scoring: "recovery"`를 쓰면 위 채점표의 항목을 더하는 대신 서비스의 복구 시간(35)·복구 순서(15)·복구 중 악화 없음(20)·진단·보고(30)로 센다. 이때 채점표에서는 `diagnosis`(보고), `forbidden_action`(감점 그대로), `final_state`("끝에도 정상이다", 지켜지지 않으면 시간과 순서 점수가 반)만 읽고, `time_limit`·`tool_budget`·`required_action`은 읽지 않는다. 필드가 없으면 지금까지처럼 항목대로다. 서비스가 있는 시나리오(내장은 OS 고장 다섯)만 쓰며, `scoring`은 디지스트에 들어가서(있을 때만) 채점 방식이 다른 결과가 한 벤치마크에 섞이지 않는다. 자세한 규칙은 [측정의 신뢰](measurement.md#3-서비스가-있는-시나리오는-복구-우선으로-채점한다-req-088-adr-0091-adr-0104).

## 운영을 채점하는 내장 시나리오

물리가 조치를 갈라 주는 곳에만 조치를 채점한다. 가중치는 진단 45~50 / 최종 상태 25 / 조치 10 / 효율 20 안팎이고, 정답만 아는 기준 에이전트는 65점이다.
- `outage-generator-fails`: UPS 배터리를 낡게(`ups_battery_degraded`, factor 0.1) 해서 분(分)이 의미를 갖게 한다. 최종 상태는 UPS 배터리 20% 이상과 수랭·액침 서버가 켜져 있음이고, 필수 조치는 서버 전원 끄기다.
- `vm-cpu-spike-escalation`: 최종 상태는 VM이 멈췄거나 `vm_cpu_high` 알람이 없음이고, 필수 조치는 그 VM 전원 끄기다. 호스트로 번지는 조건 대기는 "VM이 멈췄거나 진단이 제출됨"이다.
- `cdu-failure`: 최종 상태는 수랭 서버의 CPU 60°C 미만이고, 필수 조치는 그 서버 전원 끄기다. 금지는 같은 서버를 다시 켜는 것(CDU를 다시 켜는 것은 허용).
- 진단 시나리오로 남는 것: `fan-failure-throttle`(서버 전원 끄기 금지: VM이 같이 죽는다), `sensor-drift`, `plant-loop-down`(금지 없음). `cooling-failure`는 "다른 냉방기 설정 온도 낮추기"가 필수 조치(10점)이지만 샘플 캠퍼스에서는 온도 차이가 작다. 자세한 점수는 [측정의 신뢰](measurement.md)에 있다.
