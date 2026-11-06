---
title: ADR-0105 툴 범위·에스컬레이션·절차서를 구현하면서 시험 세 곳의 기대값을 고친다
kind: decision
status: active
last_verified: 2026-11-06
enforced_by:
  - tests/spec/tool-scope.test.ts
  - tests/spec/escalation.test.ts
  - tests/spec/sop.test.ts
  - packages/core/src/session/tool-pick.test.ts
  - packages/core/src/tools/runbook.test.ts
  - apps/server/src/runtime/escalation.test.ts
  - apps/web/src/logic/tool-picker.test.ts
  - apps/web/src/logic/human-talk.test.ts
touches_protected:
  - docs/design-docs/adr/0087-tool-scope-escalation-sop.md
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/analysis/test-support/runs.ts::=play
  - packages/core/src/session/run-events.test.ts::=started
  - tests/spec/service-tools.test.ts::every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086] > a summary, when to use and not, an example, access and cost; realism on all of them
test_change_reason: 기본 툴 묶음이 흔함 툴만으로 바뀌어 영향 범위(get_impact)와 토폴로지(get_topology)가 빠졌고, 툴이 둘(사람에게 묻기, 절차서 찾기) 늘어 스물아홉 개가 되었다. 세 곳은 같은 성질(툴 설명이 표준을 따른다, 사건 기록에 툴 호출이 남는다, 분석이 툴 호출을 읽는다)을 새 기본 묶음 위에서 읽는다.
decision_hash: 2b15f96ba878189b
---
# ADR-0105 툴 범위·에스컬레이션·절차서를 구현하면서 시험 세 곳의 기대값을 고친다

## 맥락
[ADR-0087](0087-tool-scope-escalation-sop.md)의 여섯 결정을 구현했다(REQ-080~082, 클로즈 베타 3a). 구현하면서 정해야 했던 것이 몇 가지 있었고, 그 가운데 둘이 이미 잠긴 시험의 전제를 바꾼다: 기본 툴 묶음의 모양과 툴의 개수다. 어떻게 정했는지와 왜 시험 세 곳을 고쳐야 하는지를 적는다. 동작과 규칙은 [툴 범위, 에스컬레이션, 절차서](../tool-scope-and-sop.md)에 있다.

## 결정
1. **기본 툴 묶음 = 현실 수준이 흔함인 툴 − 날것의 프로토콜 요청 + `run_command`.** ADR-0087 2번의 "흔함만"을 그대로 따르되, 2차(ADR-0104 5번)에서 정한 "날것의 프로토콜 요청은 넣지 않고 쉘은 넣는다"를 지킨다. 그래서 `get_topology`(드묾)와 `get_impact`(없음)가 빠진다. `ask_human`(흔함)과 `search_runbooks`(드묾)는 **설계자가 켤 때만** 들어간다: 답할 사람이 정해져야 하고, 절차서는 실험 변수이기 때문이다.
2. **툴이 둘 늘어 스물아홉이다.** `ask_human`과 `search_runbooks`. 둘 다 세계를 바꾸지 않는다(`ask_human`이 사람에게 묻고 사람이 세계를 바꾸는 것은 세계 기록에서 원인이 `human`이라 에이전트의 행동으로 세지 않는다).
3. **고장 범위의 주 고장과 배경 고장.** 시나리오의 **주 고장**은 진단 정답의 고장 종류가 가리키는 것(정답이 없으면 전부)이다. 주 고장을 풀 툴이 하나도 없으면 시나리오는 범위 밖이고, "준 툴 안에서만"일 때 목록에서 회색이 되며 서버는 그 조합의 실험을 거절한다. 나머지는 **배경 고장**이라 준 툴이 못 닿으면 일어나지 않는다. 진단하고 사람을 부르는 길뿐인 고장(원격으로 고칠 수 없는 고장)은 필요한 툴이 없으므로 어느 묶음에서도 범위 안이다. 기본 값은 "전부"다: "준 툴 안에서만"을 기본으로 하면 기본 묶음에 없는 네트워크 툴 때문에 스위치 시나리오가 처음부터 회색이다.
4. **에스컬레이션 처리의 기본은 "정해 둔 답으로 자동 응답"이다.** 사람 기다림을 기본으로 하면 사람이 없는 실험이 멈춘 채 남는다. 사람 기다림은 설계자가 일부러 고른다. 기다리는 동안은 세계 시간이 멈추고(실시간 방식에서는 기다린 시간을 세지 않는다) 에이전트의 실제 시간 제한에도 들어가지 않는다. 사람이 대신 조치하는 길은 에이전트가 가진 변경 툴과 같은 것을 쓴다.
5. **끝난 이유 `escalated`("사람에게 넘기다 끝남")와 사건 `human`.** "실패로 끝냄"과 사람이 끝내기는 이 이유로 끝나고, 사건 기록에는 물은 것·사람이 한 조치·답한 것이 `human` 사건으로 남는다. 사건 형식은 필드를 더하기만 하는 규칙(`RUN_EVENT_FORMAT`)을 따른다.
6. **SOP 준수 규칙.** 단계에 적힌 툴을 성공적으로 부르면 한 단계, 한 단계들이 절차서 순서대로이면 순서, 한 번도 안 한 단계는 건너뜀이다. 툴이 적히지 않은 단계는 세지 않는다. 결과는 `RunResult.sop`에 따로 적고 점수에 섞지 않으며, 시험이 절차서를 줘도 안 줘도 점수가 같음을 확인한다. 절차서는 시나리오 문서의 선택 칸(`runbook`)이고 시나리오 버전(digest)에 들어간다.
7. **벤치마크 키.** 고장 범위 "준 툴 안에서만"만 키에 들어간다(어떤 고장이 일어나는지가 과제를 바꾼다). 에스컬레이션 처리와 절차서는 툴처럼 에이전트 쪽 조건이라 키에 넣지 않는다.
8. **저장해 두기는 이 브라우저에 둔다.** 툴 묶음과 절차서는 이름을 붙여 저장하고 불러오고 지우며, 지우면 7일 안에는 되돌린다. 팀에 공개하거나 서버에 두는 것은 ADR-0092의 앱 전체 패턴과 함께 한다.
9. **시험 세 곳의 기대값을 고친다.**
   - `analysis/test-support/runs.ts`의 `play`: 분석 시험이 쓰는 대본 실행이 `get_impact`를 부른다. 기본 묶음에서 빠졌으므로 `get_impact`를 더해 준다. 읽는 성질(툴 오류가 없고 진단과 정답을 비교한다)은 그대로다.
   - `session/run-events.test.ts`의 세션 도우미: 사건 기록의 순서를 보려고 `get_impact` 호출을 쓴다. 같은 이유로 `get_impact`를 더한다.
   - `tests/spec/service-tools.test.ts`의 "모든 툴이 표준 순서로 설명되고 현실 수준이 있다": 툴 개수 기대값이 27에서 29로 바뀐다. 읽는 성질(다섯 칸, 현실 수준, 읽기/쓰기)은 그대로이고 새 툴 둘도 이를 지킨다.
10. ADR-0087의 `enforced_by`를 이 구현의 시험으로 바꾸고 `no_enforcement_reason`을 지운다. 본문은 그대로다. 요구사항 REQ-080~082의 행에는 구현에서 정해진 사항을 덧붙인다.

## 이유
- 기본 묶음이 현실의 운영팀이 가진 것이어야 실험이 우리 툴이 아니라 에이전트 실력을 잰다(ADR-0087의 맥락). 날것의 프로토콜 요청은 쉘 하나로 OS 고장이 풀리는 2차의 결정을 흐리지 않으려고 빼 둔다.
- 사람이 없는 실험을 막지 않으려면 기다림이 기본일 수 없다.
- 점수에 섞이지 않는 블록은 복구 우선 채점이 지난 읽기 그대로 남게 한다.

## 버린 대안
- **기본 묶음에 날것의 프로토콜 요청도 넣기**: 흔함이지만 2차의 기준(쉘만)을 되돌리고 기본 실험의 툴이 열 개 넘게 는다.
- **고장 범위의 기본을 "준 툴 안에서만"으로**: 처음 보는 사람에게 시나리오 여럿이 회색으로 보인다. 일부러 범위를 좁히는 실험에서 고르게 둔다.
- **고친 시험을 새 시험으로 대체하기**: 읽는 성질이 같아서 기대값만 고친다.

## 결과
시험 세 곳의 기대값이 새 기본 묶음과 툴 개수를 읽는다. ADR-0087이 시험으로 강제된다. 정직한 한계(브라우저 보관, 카드 안의 조치, 낱말 세기 점검)는 [설명 문서](../tool-scope-and-sop.md)에 있다.
