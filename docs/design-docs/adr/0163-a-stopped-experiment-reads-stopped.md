---
title: ADR-0163 멈춘 실행이 하나라도 있는 실험은 "완료"가 아니라 "멈춤"으로 읽힌다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - packages/core/src/experiments/experiments.test.ts
  - packages/core/src/analysis/stopped-experiment.test.ts
  - apps/web/src/logic/progress-words.test.ts
touches_protected: []
amends_tests:
  - packages/core/src/experiments/experiments.test.ts::run lifecycle [REQ-030] > an experiment's status and progress follow its runs
test_change_reason: 멈춘 실행이 하나라도 있는 실험은 완료가 아니라 멈춤으로 읽는다. 끝난 실행이 완료와 멈춤으로 섞이거나 실패와 멈춤으로 섞인 실험의 기대값이 바뀌어, 실패와 멈춤이 섞인 줄을 고치고 새 경우를 더했다.
decision_hash: f231d3f407b99c04
---
# ADR-0163 멈춘 실행이 하나라도 있는 실험은 "완료"가 아니라 "멈춤"으로 읽힌다

## 맥락
20번 중 1번만 끝나고 사람이 멈춘 실험이 "완료"로 보였다. `experimentStatus`가 모든 실행이 끝난 뒤 완료가 하나라도 있으면 "완료"를 돌려주기 때문이다. 실험 목록의 카드, "완료" 거르기, 결과 머리가 모두 그 말을 따른다.

UX 여정의 "끝난 실험 열기"가 그 실험을 집었고, 조건을 바꿔 다시 돌리는 여정이 뜻하지 않은 원본에서 갈라졌다([ADR-0162](0162-fork-journey-measures-the-fork-repeats-have-their-own.md)의 조사에서 드러났다).

## 결정
1. **모든 실행이 끝난 뒤의 실험 상태**는 이렇다. 멈춘(cancelled) 실행이 하나라도 있으면 "멈춤", 없고 완료가 하나라도 있으면 "완료", 그 밖에는 "실패"다. 대기·실행 중의 규칙은 그대로다.
2. **화면은 멈춘 실험에서 계획한 수와 끝난 수를 함께 말한다.** 예를 들어 "멈춤 · 20회 중 1회 끝"이다. 끝난 실행의 결과는 지금처럼 보인다.
3. **결과가 있어야 되는 일**(결과 보기, 공유, 조건 바꿔 다시 돌리기, 나란히 보기)은 실험의 상태가 아니라 "완료된 실행이 하나 이상 있는가"로 정한다. 멈춘 실험에서도 지금 되던 일은 그대로 된다.
4. **벤치마크 순위표와 통계에 들어가는 실행의 집합은 바뀌지 않는다.** 채점과 점수 분해도 바뀌지 않는다. 바뀌는 것은 실험의 상태 말과 상태 거르기뿐이다.

## 이유
"완료"는 계획한 실행이 다 결과에 닿았다는 말이어야 한다. 멈춘 것을 완료라 부르면 목록에서 실행 수가 모자란 실험을 온전한 것으로 읽는다.

## 대안과 버린 이유
- 완료된 실행이 더 많으면 완료로 부르기: 몇 번을 멈췄든 계획은 끝나지 않았다.
- 상태를 하나 더 만들기("일부만 끝남"): 말이 늘고 거르기가 늘어난다. "멈춤"과 숫자로 충분하다.

## 결과
- `experimentStatus`(`packages/core/src/experiments/lifecycle.ts`)가 결정 1의 순서로 돌려준다. 잠긴 시험 `an experiment's status and progress follow its runs`의 기대값 한 줄(완료·실패 없이 실패와 멈춤이 섞인 실험은 "실패"에서 "멈춤"으로)을 바꾸고, 완료와 멈춤이 섞인 경우와 완료와 실패가 섞인 경우(그대로 "완료")를 더했다.
- 실험 목록의 카드와 실험 결과 머리, 스크린 리더 안내, 이끼가 읽는 실험 상태가 멈춘 실험에서 "20회 중 1회 끝"처럼 말한다(`progressWords`, `stoppedWords`). 목록의 상태 거르기에 "멈춤"이 생겼고, 멈춘 실험은 "완료"에 나오지 않고 "멈춤"에 나온다.
- 결과 보기, 공유, 조건 바꿔 다시 돌리기, 나란히 보기, 원본과 견주기, 순위표, 통계는 이미 실험 상태가 아니라 완료된 실행(`progress.completed`, 실행의 상태)을 보고 있어 코드를 바꾸지 않았다.
- 결정 4는 시험 `stopping an experiment moves only its state word`가 지킨다. 끝난 실험 하나와 멈춘 실험 하나로 순위표와 두 실험의 통계(상태 말만 뺀 분석)를 만들어, 이 결정 전의 코드에서 얻은 글자 수와 지문(cyrb53)과 같은지 본다.
- UX 여정 `share`와 `fork`가 여는 실험은 "완료" 아래에서 가장 오래된 "알람 추적"(`run` 여정이 만든 것)이다. `cancel` 여정이 남긴 멈춘 실험이 "완료"에서 빠져, 가장 새 줄이 `repeat`의 실험(반복 3번)이 되기 때문이다. 여정 파일은 잠긴 시험이 아니라서 예산과 함께 바꾸지 않았다.
