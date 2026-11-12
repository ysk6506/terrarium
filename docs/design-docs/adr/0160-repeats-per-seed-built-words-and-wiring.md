---
title: ADR-0160 시드당 반복을 지을 때 정한 말과 짜임, 그리고 ADR-0158의 시험 수정 목록
kind: decision
status: active
enforced_by:
  - apps/server/src/runtime/repeats.test.ts
  - apps/server/src/adapters/sqlite-repeat.test.ts
  - packages/core/src/analysis/seed-statistics.test.ts
  - apps/web/src/logic/seed-rows.test.ts
  - apps/web/src/logic/world-words.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - docs/design-docs/adr/0158-repeats-per-seed-and-seed-level-statistics.md
decision_hash: 229a18909a23d729
---
# ADR-0160 시드당 반복을 지을 때 정한 말과 짜임, 그리고 ADR-0158의 시험 수정 목록

## 맥락
[ADR-0158](0158-repeats-per-seed-and-seed-level-statistics.md)은 설계만 먼저 합쳐졌다. 구현하면서 화면의 말과 몇 가지 짜임을 정했고, 시험 몇 개가 바뀌어 ADR-0158의 `amends_tests`와 `enforced_by`를 채워야 했다. ADR-0158은 이미 합쳐진 글이라 그 앞머리를 고치려면 이 ADR이 필요하다.

## 결정
1. **화면에서는 "시드"를 쓰지 않고 "상황"이라 부른다.** 같은 세계 흐름 하나가 상황이다. "조건"은 쓰지 않는다("조건 바꿔 다시 돌리기"의 조건은 하네스·에이전트 구성이다). API·하네스 규약·코드의 `seed`는 그대로다. 글 잣대 시험(`world-words.test.ts`)이 실험 만들기뿐 아니라 결과·순위표·요약 막대의 글에서도 "시드"를 막는다.
2. **새 실험의 두 질문을 말과 단위로 가른다.** "서로 다른 상황을 몇 개 돌릴까요"(개, 권장 5개)와 "같은 상황을 몇 번씩 돌릴까요"(번, 1번·3번·5번·직접 단추 하나, 직접을 고를 때만 입력칸).
3. **흔들림 두 줄은 "상황별" 구역의 머리에 둔다.** 근거인 점들이 바로 아래에 있다.
4. **알아낸 것은 점수 차이의 출처를 말한다.** 반복이 2번 이상이면 시드 안의 퍼짐과 시드 사이의 퍼짐을 견주어 어느 쪽이 큰지 한 줄로 말하고(둘 다 5점 미만이면 말하지 않는다), 시드마다 한 번뿐이면 앞 절반은 예전 문장 그대로 두고 뒤 절반이 "같은 상황을 여러 번 돌려야 알 수 있어요"라고 말한다.
5. **한도는 상황 20개, 반복 10번, 실행 60번이다.** 60은 예전 상한 20의 3배라서 가장 큰 예전 실험을 3번씩 돌릴 수 있고 실행 하나의 비용은 그대로다.
6. **하네스에 선택 필드 `repeat`를 둔다.** 없으면 1이다. 시드가 같으면 세계의 우연이 같다는 약속은 그대로다.
7. **기록의 저장은 SQLite 스키마 2(`runs.repeat_no`)이고 옛 파일은 `ALTER TABLE`로 올린다.**

## 시험 수정
통계의 단위가 바뀌고 한도 문구와 말이 바뀌어 ADR-0158의 `amends_tests`가 가리키는 시험의 기대값이 바뀌었다(이유는 ADR-0158의 `test_change_reason`). 채점과 점수 분해의 단언은 건드리지 않았다.
