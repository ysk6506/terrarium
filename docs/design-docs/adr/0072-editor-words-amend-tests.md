---
title: ADR-0072 편집기의 말을 용어집에 맞추고, 그 말을 지키던 시험 일곱 개의 기대값을 고친다
kind: decision
status: active
last_verified: 2026-11-04
enforced_by:
  - apps/web/src/logic/editor-words.test.ts
  - apps/web/src/logic/editor-units.test.ts
  - apps/web/src/logic/first-scenario.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - apps/web/src/logic/editors.test.ts::the scenario canvas [REQ-034] > every block's summary reads as a sentence
  - apps/web/src/logic/editors.test.ts::the block inspector [REQ-034] > fields come from the block's parameters, with this world's equipment to choose from
  - apps/web/src/logic/editors.test.ts::the scoring sheet [REQ-034] > add, change and remove items; the total aims at 100
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > parameters are checked against the block and the world
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > faults must fit their target, and their settings their ranges
  - packages/core/src/scenario/scenario.test.ts::scenario validation [REQ-034] > expectations are checked, and missing or inconsistent scoring is pointed out
  - packages/core/src/session/session.test.ts::session records [REQ-037] [REQ-039] > the timeline puts scenario steps, alarms and agent calls on one axis
test_change_reason: REQ-071은 편집기의 말이 용어집을 따르라고 한다(ADR-0071). 고장 발생·상황 설명·점수 같은 말, 분 단위, 이름으로 보이는 채점표, 비어 있으면 숨기는 세부 설정 칸으로 바뀌어 일곱 시험의 기대 문장과 칸 목록이 달라졌다. 시험이 확인하는 일은 그대로이고 기대 문자열만 바꿨다.
decision_hash: 00c10a4be420e192
---
# ADR-0072 편집기의 말을 용어집에 맞추고, 그 말을 지키던 시험 일곱 개의 기대값을 고친다

## 맥락
ADR-0071이 화면의 말을 용어집 하나로 정했고, 점검 표(strings.md)에서 편집기와 관련된 곳이 나왔다. 블록 이름은 "장애 주입", "장애 해제"였고, 폼에는 "장애 종류", "장애 세부값", "과제 설명", "툴 호출 한도", "제한 시간 (시뮬레이션)"이 있었다. 시간은 폼에서 초, 캔버스에서 분이었다. 채점표 카드 아래에는 장비 id와 고장 코드가, 미리 돌려 본 결과에는 `wait {"seconds":600}` 같은 JSON이 그대로 보였다.
[검토 문서](../scenario-editor-review.md)의 3~10번이 이 문제들이다.
이 말들을 지키던 시험이 있다. 문장이나 칸 목록을 그대로 기대값으로 적어 두었으므로, 말을 용어집에 맞추면 그 시험들이 실패한다. 시험은 잠겨 있어서 요구사항이 바뀐 근거를 ADR로 남겨야 고칠 수 있다. 요구사항 REQ-071의 여섯째 항목이 그 근거다.

## 결정
1. 코드를 고쳤다. 블록은 "고장 발생", "고장 복구"이고 폼은 "고장 종류", "세부 설정", "상황 설명", "툴 호출 상한", "제한 시간"이다. 팔레트 묶음은 고장 → 설정 바꾸기 → 흐름 → 에이전트 순서다. 코어의 타입 이름(`inject_fault`, `FaultType`)은 그대로다.
2. 시간 칸은 분이다. 저장은 초 그대로이고, 분으로 딱 떨어지지 않는 값은 소수 한 자리로 보인다. 고장의 지속 시간은 "복구 방식" 선택(고쳐질 때까지 / n분 뒤 저절로 복구)이다.
3. 고장에 정할 값이 없으면 "세부 설정" 칸을 보이지 않는다.
4. 채점표 카드는 장비를 이름으로, 고장을 라벨로, 조건을 문장으로 말한다. 미리 돌려 본 결과는 "10분 기다려요", "냉방기 정지 발생"처럼 문장이다.
5. 시험 일곱 개의 **기대 문자열과 칸 목록만** 새 말에 맞췄다. 무엇을 확인하는지는 바꾸지 않았다.
   - 편집기 시험 셋: 블록 요약 문장("300초 기다려요"는 "5분 기다려요", "x: 장애"는 "x: 고장", 고장 해제 요약), 고장 블록의 폼 칸 목록(비면 숨기는 "세부 설정"과 복구 방식 선택), 채점표 카드의 한 줄("끝 상태 조건"은 조건 문장).
   - 시나리오 검증 시험 셋: 범위 문장("1~86400 초"는 "0.1~1440분"), "알 수 없는 장애 종류"는 "모르는 고장 종류예요", "과제 설명"은 "상황 설명", "배점"은 "점수".
   - 세션 기록 시험 하나: 시간표의 "차단기 트립 주입 (pdu-a)"는 "차단기 트립 발생 (pdu-a)", 알람이 풀리는 줄 "해제: …"는 "복구: …".
6. 새 시험이 같은 일을 다시 막는다. `editor-words.test.ts`는 용어집의 쓰지 않는 말과 영문 코드, JSON, "~니다"가 팔레트·블록·채점 항목·고장·기준 에이전트의 글에 없는지 본다. `editor-units.test.ts`는 분 단위, 복구 방식, 숨는 칸, 이름으로 보이는 한 줄을 본다.
7. 요구사항 REQ-071에 여섯째 항목을 더했다.

## 버린 대안
- **시험을 그대로 두고 옛 말을 남기기**: 사람이 읽는 말이 코드 속 시험 때문에 굳는다. 말이 틀렸다는 것은 ADR-0071에서 이미 정했다.
- **시험을 지우고 새로 쓰기**: 시험이 확인하던 일(요약이 문장이다, 칸이 블록의 변수를 따른다, 합계를 센다)까지 잃는다. 기대값만 바꿔야 잠금의 뜻이 남는다.
- **새 시험에 말 목록을 따로 적기**: 용어집과 어긋나기 쉽다. 쓰지 않는 말은 용어집의 표를 그대로 옮겨 두고, 용어집을 바꿀 때 함께 고친다.

## 한계
- 말이 자연스러운지는 사람이 본다. 시험은 쓰지 않기로 한 말과 코드 누출만 막는다.
- 시험이 보는 글은 코드에 적힌 글이다. 서버가 만드는 문장이나 템플릿이 만드는 시나리오 안의 글(과제 설명, 알람 문구)은 이번에 다루지 않았다. 홈과 다른 화면은 다른 묶음이 맡는다.
- 분으로 보이는 값은 소수 한 자리까지다. 45초는 "0.8분"으로 보인다. 저장된 초는 바뀌지 않는다.
