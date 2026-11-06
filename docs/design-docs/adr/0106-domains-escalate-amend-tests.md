---
title: ADR-0106 도메인·넘기기를 구현하면서 시험 두 개의 기대값을 고친다 — 에이전트 투입의 제한 시간 상한, 서버룸 사람의 말 묶음
kind: decision
status: active
last_verified: 2026-11-06
enforced_by:
  - packages/core/src/world/domains.test.ts
  - packages/core/src/tools/domains.test.ts
  - packages/core/src/session/escalate.test.ts
  - packages/core/src/session/handoff.test.ts
  - packages/core/src/session/domain-calibration.test.ts
  - packages/core/src/topology/partner.test.ts
  - apps/web/src/logic/world3d/crew-partner.test.ts
  - apps/web/src/logic/handoffs.test.ts
  - apps/server/src/runtime/partner-activity.test.ts
  - apps/server/src/runtime/operator-agent.test.ts
touches_protected:
  - docs/design-docs/adr/0098-domains-virtual-counterparts-tickets.md
  - docs/design-docs/adr/0099-counterparts-deterministic.md
  - docs/design-docs/adr/0100-escalate-by-domain.md
  - docs/product-specs/requirements.md
amends_tests:
  - apps/web/src/logic/crew-words.test.ts::the lines of the people in the server room [REQ-074] > there are 3 to 5 for each of the six situations
  - apps/web/src/logic/editor-units.test.ts::durations are minutes wherever people read them [REQ-071] > the agent's time limit and a condition wait's timeout are minutes too
  - apps/server/src/adapters/harness.test.ts::built-in reference agents use only the tools [REQ-008] [REQ-031] > guess is repeatable for a seed; idle never answers; unknown agents are an error
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
  - apps/server/src/runtime/platform.test.ts::what the server says about itself [REQ-031] [REQ-033] > who is asking, the harnesses with their agents, sources and limits
test_change_reason: 벤더가 부품을 바꾸는 데 하루에서 사흘이 걸리는 시나리오가 생겨 에이전트 투입 블록의 제한 시간 상한을 24시간에서 4일(5,760분)로 늘리고, 다른 팀의 기사가 서버룸에 오는 장면이 생겨 서버룸 사람의 말 묶음이 여섯에서 일곱 상황이 되며, 내장 하네스에 기준 에이전트 operator가 하나 늘어 에이전트 목록이 셋에서 넷이 되며, 넘기기·이벤트·티켓 툴 다섯이 더해져 툴 카탈로그가 29개에서 34개가 된다. 다섯 시험은 같은 성질(시간 칸은 분으로 보이고 상한이 있다, 상황마다 말이 3~5줄 있다, 내장 하네스의 에이전트 목록(서버 소개 응답도 같다), 모든 툴이 같은 모양으로 적혀 있다)을 새 값으로 읽는다.
decision_hash: 2efc5bd7e5023737
---
# ADR-0106 도메인·넘기기를 구현하면서 시험 두 개의 기대값을 고친다

## 맥락
[ADR-0098](0098-domains-virtual-counterparts-tickets.md), [0099](0099-counterparts-deterministic.md), [0100](0100-escalate-by-domain.md)을 구현했다(REQ-093). 구현이 잠긴 시험 두 개를 건드렸고, 구현하면서 정한 것이 몇 있어 함께 남긴다.

## 결정
1. **에이전트 투입 블록의 제한 시간 상한을 24시간에서 4일로 늘린다.** 메모리 불량은 벤더가 보통 1일, 길면 3일 만에 바꾼다. 제한 시간이 24시간이면 넘긴 일이 끝나기 전에 실행이 끝나 "넘기고 기다리는 운영"을 잴 수 없다. 블록의 시간 칸은 분으로 보이므로 상한은 1,440분에서 5,760분이 된다. 고치는 시험: `editor-units.test.ts`의 "에이전트의 제한 시간…" 기대값(`max`).
2. **서버룸 사람의 상황이 여섯에서 일곱이 된다.** 다른 팀의 기사가 장비 앞에서 일하는 상황(`partner`)의 말 3~5줄을 더한다. 말은 "고쳤어요"를 하지 않는 규칙(ADR-0078)을 그대로 따른다. 고치는 시험: `crew-words.test.ts`의 상황 수(6 → 7)와 제목.
3. **도메인은 "누가 고치나"로 정한다.** `cpu_runaway`는 프로세스 정리라 서비스/OS, `disk_failure`는 스토리지, 센서 틀어짐은 시설팀이라 데이터센터 인프라다. 스토리지 도메인에는 툴이 아직 없고, 그 도메인의 고장은 넘기는 길로만 풀린다.
4. **고장 종류 `memory_failure`(서버)를 더한다.** 서버가 멈추고 그 위의 VM과 서비스가 멈추며 모듈을 바꿔야 돌아온다. 다른 고장 종류의 물리는 그대로다.
5. **리드타임 설정은 실험의 설정이다.** 사업장(세계) 설정이 아니라 새 실험의 "SLA·예비 부품·팀" 카드다. 세계 설정에 두면 세계 버전(digest)이 바뀌어 같은 세계의 실험이 서로 비교되지 않는다. 실험 설정은 레시피에 들어가 벤치마크 키를 가른다(정하지 않은 레시피의 키는 그대로). 구현한 설정은 벤더 SLA(4시간·익일·3일), 예비 부품(부품마다 기본·모두 있음·모두 없음), 야간·주말 가산, 일을 맡는 때다. 부품별 스페어 목록, 팀별 응답 시간, 고장별 직접 지정은 아직 없다.
6. **측정에서 점수가 되는 것은 넘긴 근거 하나다.** 내 도메인에 속하고 그 도메인의 툴로 고칠 수 있는 고장(`FAULT_RESPONSES`의 `fix`)을 넘기면 한 건에 −5점, 최대 −15점(고장 없이 넘긴 것도 한 건). 임시 조치는 복구 우선 채점의 복구 시간이 이미 재고, 마무리와 동시 작업은 결과에 말로 적는다. 채점 버전(`ORACLE_VERSION`)은 그대로 "3"이다: 넘긴 일이 없는 실행의 점수는 달라지지 않는다.
7. **사람이 하는 실수(설정 변경)는 넘길 수 없다.** 세계의 고장 목록에 없기 때문이다. 포트 shutdown·VLAN·콘센트 꺼짐은 에이전트가 같은 명령으로 되돌린다.
8. 내장 하네스에 기준 에이전트 `operator`를 더한다(`scripted-operator.ts`). 멈춘 서비스를 옮겨 살리고, 이유 글에서 원인의 도메인을 읽어 넘기고, `events_since`로 기다리고, 끝나면 되돌린다. "내 도메인 밖이 원인" 시나리오의 잣대이자 실행 화면의 데모다. 내장 에이전트 목록이 셋에서 넷이 되어 `harness.test.ts`의 목록 기대값을 고친다.
9. ADR-0098·0099·0100의 앞부분에서 `enforced_by`를 이 구현의 시험으로 바꾼다. 본문은 그대로다.

## 이유
- 상한을 시나리오마다 따로 두는 대신 블록의 한 값을 늘렸다. 사흘 걸리는 일은 시나리오가 길어서가 아니라 현실이 그렇다.
- 설정을 실험에 둔 것은 "같은 시험지"를 지키려는 것이다. 벤더 계약이 다른 두 실험은 같은 세계에서 다른 과제다.

## 버린 대안
- **감점에 마무리까지 넣기**: 잊지 않았는지는 점수보다 말이 낫다. 되돌릴 것이 있는지는 시나리오마다 달라서 감점을 정하기 이르다.
- **넘긴 일마다 티켓을 강제**: 하네스가 자기 할 일 관리를 가질 수 있다(ADR-0099 3항). 측정은 사건 기록으로 하고 티켓은 선택이다.

## 결과
- 새 시험: 도메인·리드타임 표(`domains.test.ts`), 툴의 도메인 표(`tools/domains.test.ts`), `escalate`와 사건과 티켓과 템플릿(`escalate.test.ts`), 측정(`handoff.test.ts`), 변별력 점검(`domain-calibration.test.ts`), 토폴로지 타일·시간 막대(`partner.test.ts`), 3D 기사(`crew-partner.test.ts`), 실행 화면 글(`handoffs.test.ts`), 서버의 활동 스트림과 레시피(`partner-activity.test.ts`).
- 고쳐진 잠긴 시험: 위 둘.
- 한계: [도메인과 가상 담당자](../domains-and-counterparts.md)의 "한계" 절.
