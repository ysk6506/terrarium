---
title: ADR-0086 세계 만들기 재설계로 달라진 글과 흐름의 시험 기대값을 고친다
kind: decision
status: active
last_verified: 2026-11-05
enforced_by:
  - apps/web/src/logic/builder/pieces.test.ts
  - apps/web/src/logic/editors.test.ts
  - apps/web/src/logic/world-words.test.ts
touches_protected:
  - harness/src/ux/score.ts
amends_tests:
  - apps/web/src/logic/builder/pieces.test.ts::the handles of a selected room [REQ-075] > a room on its floor has an edge handle and a plus handle on every side, and dragging one gives a priced plan
  - apps/web/src/logic/editors.test.ts::the experiment form and forks [REQ-030] [REQ-040] > a draft says what is missing step by step, and becomes a request
test_change_reason: ADR-0083이 타일 수를 화면에서 지우고(면적 ㎡만 남김) 실험 만들기 3단계의 말을 "몇 번 돌릴까요"로 바꿨다. 크기를 끌 때 안내 줄은 타일 장 수 대신 방 전체 면적과 더 들어가는 랙 수를 말하고, 횟수 오류는 "몇 번 돌릴지는 1~20번 사이로 정해 주세요"로 읽힌다. 두 시험이 재는 성질(끌면 값이 매겨진 계획이 나온다, 범위 밖 횟수는 첫 문제로 막힌다)은 그대로이고 기대 문장만 바꾼다.
decision_hash: c5b9204aa02f72cd
---
# ADR-0086 세계 만들기 재설계로 달라진 글과 흐름의 시험 기대값을 고친다

## 맥락
ADR-0083은 새 세계 흐름, 빌더 패널, 말을 한꺼번에 고쳤다. 같은 작업에서 피드백 10(실험 3단계)도 고쳤다. 그 결과 잠긴 시험 둘의 기대 문장이 달라졌다.

## 결정
1. `pieces.test.ts`의 손잡이 시험은 안내 줄에 "타일"이 없고 "방 전체"가 있음을 확인한다. 타일 수는 설계자의 단위라 화면에서 뺐다(ADR-0083 10번).
2. `editors.test.ts`의 실험 초안 시험은 횟수 오류 문장을 "몇 번 돌릴지는 1~20번 사이로 정해 주세요"로 확인한다. 초안의 기본 횟수는 권장 5번이다.
3. UX 여정은 `build-small`(작게 시작 → 서버룸 채우기 → 돌려 보기, 손 수 예산 8)을 맨 뒤에 더한다(`harness/src/ux/score.ts`, 보호 경로). 새 세계 화면에서 "현실에서 가져오기"가 사라졌으므로(ADR-0084) 이 길을 재던 `import` 여정은 뺀다. `build`와 `site` 여정은 새 화면의 길로 다시 쓴다.

## 버린 대안
- 시험을 지우기: 재는 성질이 남아 있어 기대 문장만 고친다.
- `import` 여정을 두고 실패로 남기기: 없는 화면을 재는 지표는 점수를 흐린다.

## 결과
- 새 시험 `next-step.test.ts`, `worldgen-scale.test.ts`, `tools.test.ts`, `pick.test.ts`, `world-words.test.ts`는 모두 [REQ-077]이고 `pnpm lock-tests`로 잠근다.
- UX 점수(`docs/generated/ux-score.json`)는 이 환경에서 다시 재지 못했다. 합치는 쪽에서 `pnpm ux`로 잰다(UX004).
