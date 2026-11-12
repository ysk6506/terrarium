---
title: ADR-0019 필수·금지 행동은 툴 이름이 아니라 세계에 끼친 효과로 판정한다
kind: decision
status: active
enforced_by:
  - packages/core/src/scenario/scenario.test.ts
  - packages/core/src/oracle/oracle.test.ts
touches_protected: []
amends_tests:
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > expectations are checked, and missing or inconsistent scoring is pointed out
test_change_reason: 채점표의 필수·금지 행동 필드를 툴 이름(tool)에서 행동 종류(action)로 바꿨다. REQ-039(같은 조건끼리 공정 비교)와 REQ-040(툴 조합만 바꿔 다시 실행)을 지키려면 같은 행동을 어떤 툴로 했든 같은 점수를 받아야 하기 때문이다. 이 테스트는 옛 필드 이름으로 검증 메시지를 확인하고 있었고, 검증하는 성질(알 수 없는 값과 없는 대상은 오류)은 그대로다.
decision_hash: 8c279bbeda1fa9db
---
# ADR-0019 행동은 효과로 판정한다

## 맥락
ADR-0016의 채점표는 "필수 조치"와 "금지 조치"를 툴 이름으로 적었다(예: `power_server`를 부르면 감점). 그런데 REQ-040은 같은
실험을 **툴 조합만 바꿔** 다시 돌리는 것을 요구하고, REQ-039는 그 결과들을 공정하게 비교하기를 요구한다. 서버를 끄는 방법은
`power_server` 툴 말고도 Redfish `ComputerSystem.Reset`이나 vCenter 전원 API가 있다. 툴 이름으로 판정하면 프로토콜 툴을 쓴
에이전트는 같은 짓을 하고도 감점을 피한다. 요구사항은 그대로이고, 처음 모델이 요구사항을 잘못 옮긴 것이다.

## 결정
1. 행동 종류를 정한다: 전원 끄기, 전원 켜기, 재시작, 차단기 리셋, 냉방 설정 변경 (`ACTION_KINDS`).
2. 세션은 툴 호출마다 그 호출이 일으킨 월드 명령을 모아 행동(`effects`)으로 기록한다. 같은 대상의 끄기→켜기는 재시작이다.
3. 채점표의 `required_action`/`forbidden_action`은 `action`(+대상)으로 적는다. 흐름 조건에도 `action_taken`을 둔다.
4. "어떤 툴을 썼나"가 정말 궁금할 때를 위해 `tool_called` 조건은 남긴다(채점표에는 쓰지 않는다).

## 이유
같은 일을 하면 같은 점수를 받아야 툴 조합 사이의 비교가 의미 있다. 시나리오 작성자도 "srv-a1 전원 끄기 금지"처럼
툴을 몰라도 읽히는 말로 쓸 수 있다.

## 버린 대안
- **툴 이름 + 프로토콜 경로 목록**: Redfish·vCenter API가 늘 때마다 목록을 고쳐야 하고, 빠뜨리면 공정성이 깨진다.
- **월드 이벤트의 cause 문자열로 추정**: 파사드마다 cause 형식이 달라 깨지기 쉽다. 세션이 호출 단위로 묶는 쪽이 정확하다.

## 결과
잠긴 테스트 하나를 이 ADR로 고쳤다(검증하는 성질은 같고 필드 이름만 바뀜). 오라클은 효과로 채점한다.
