---
title: ADR-0175 UX 검사를 더 잘게 나눠 돌리고, 점수 파일은 변경마다 커밋하지 않는다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - .github/workflows/ci.yml
  - harness/src/ux/merge.test.ts
  - harness/src/ux/check.test.ts
  - harness/src/ux/groups.test.ts
touches_protected:
  - .github/workflows/ci.yml
  - .github/actions/browser/action.yml
  - harness/src/ux/check.ts
  - harness/src/ux/check.test.ts
  - harness/src/ux/run.ts
  - harness/src/ux/merge.ts
  - harness/src/ux/merge.test.ts
  - harness/src/ux/groups.test.ts
  - harness/config/test-lock.json
  - AGENTS.md
amends_tests:
  - harness/src/ux/check.test.ts::<import:f51f959f>
  - harness/src/ux/check.test.ts::the recorded measurement [REQ-041] > goes stale when the web app changes (UX004)
  - harness/src/ux/groups.test.ts::the CI groups of UX journeys lose none and repeat none [REQ-114] > there are three groups, named as the workflow names them
test_change_reason: 낡은 측정 기록(UX004)이 실패에서 알림으로 바뀌었고(ADR-0175 결정 3), CI의 여정 묶음이 셋에서 다섯으로 늘었다(결정 2). 두 시험은 옛 동작(낡으면 빨강, 묶음 셋)을 단언했다. 새 동작을 같은 성질의 단언으로 다시 썼고, 기록을 읽지 못함(UX004 실패)·점수 위조(UX005)·하한(UX001~003)의 시험은 그대로다.
decision_hash: 1ea77ff8386e43c4
---
# ADR-0175 UX 검사를 더 잘게 나눠 돌리고, 점수 파일은 변경마다 커밋하지 않는다

## 맥락
게이트 작업 중 가장 긴 것은 `ux-journeys`다. main의 한 실행(실행 번호 43092302657)에서 묶음별로 `own` 168초, `flow` 125초, `build` 127초였고, 시험 조각은 100초 안팎에 끝났다. `own` 묶음은 여정 둘(`own-card-only` 76초, `topology` 59초)이고 `build` 묶음은 셋(39초, 22초, 32초)이라, 서로 기대지 않는 여정을 한 묶음에 둔 만큼 기다린다.

게이트가 아닌 `ux-measure`는 한 작업이 한 서버에서 여정 열넷과 탐침 열셋을 차례로 돌려 812초(약 13분 30초) 걸린다. 웹 화면을 바꾼 변경은 그 작업이 만든 `ux-score.json`을 마지막 커밋으로 올려야 했고(ADR-0141 2번, `UX004`), 그 커밋이 파이프라인 전체를 한 번 더 돌게 한다. 점수 파일은 변경의 내용이 아니라 측정의 기록인데, 변경마다 커밋하게 해서 모든 웹 변경이 두 번 기다린다.

## 결정
1. **`ux-measure`를 여러 작업으로 나눠 동시에 돌린다.** 조각은 아홉이다(`tests/e2e/ux/parts.ts`): 여정 묶음마다 하나(`journeys-flow` `-build` `-small` `-own` `-topology`)와 탐침 넷(`probes-a`~`d`). 탐침은 여정이 남긴 세계·시나리오·실험을 읽으므로, 탐침 조각은 `build` 여정, `flow` 묶음, `small` 묶음을 먼저 돌리되 결과는 기록하지 않는다(그 여정의 결과는 그 묶음의 조각이 기록한다). 세계가 하나일 때와 여럿일 때 새 실험 화면의 주된 버튼 수가 달라서, 세계를 여럿 만드는 `small`까지 돌려야 한 번에 잰 점수와 같아진다. 먼저 돌린 여정이 한 번 실패하면 한 번 더 돌린다. 빈 화면과 오류 화면은 아무것도 돌지 않은 서버에서 봐야 하므로 `journeys-flow` 조각이 맡는다. 각 조각은 자기 필드를 JSON으로 올리고, `ux-measure` 작업이 `pnpm ux merge <폴더>`로 모아 지금과 같은 일곱 면의 점수와 `ux-score.json`을 낸다. 모으기는 여정을 합치고, 깨끗한 화면의 집계를 더하고, 나머지 필드는 쓴 조각 하나에서 가져온다. 필드가 두 조각에 있거나 빠지면 오류다(`harness/src/ux/merge.ts`). 점수의 계산(`score.ts`)은 바꾸지 않는다. 목표는 벽시계 6분 안이다.
2. **`ux-journeys`의 묶음을 셋에서 다섯으로 늘린다**: `flow`(서로 기대는 아홉 여정은 그대로), `build`, `small`(`site`, `build-small`), `own`(`own-card-only`), `topology`. 묶음 표는 한 곳(`tests/e2e/ux/journeys.ts`의 `JOURNEY_GROUPS`)에서 정하고, `run`이 만든 실험을 `share`와 `fork`가 여는 것처럼 기대는 여정은 같은 묶음에 둔다. 가장 긴 묶음(`flow`)의 여정은 합쳐 90초 안팎이다. 서로 기대지 않는 여정만 갈랐으므로 어느 묶음도 앞 여정의 산출물에 기대지 않는다.
3. **`docs/generated/ux-score.json`은 변경마다 커밋하지 않는다.** 웹 화면이 바뀌어 기록이 낡았다는 검사(`UX004`)는 실패에서 알림 한 줄로 바뀐다(`QUAL001`과 같다). 기록을 읽을 수 없거나 없는 것(`UX004` 실패), 점수를 손으로 고친 것(`UX005`), 하한을 낮춘 것(`UX003`), 하한 미달(`UX001`, `UX002`)은 그대로 실패다. 기록은 5시간마다 도는 정리 작업이 main에서 `pnpm ux`로 새로 재서 올리고, 하한은 그 정리 작업이 `pnpm ux ratchet`으로 올린다. 변경의 점수는 그 변경의 `ux-measure` 작업 요약과 아티팩트에서 본다. 하한 검사(`UX001`)가 무엇을 재는지 확인했다: `pnpm ux`와 `pnpm ux merge`는 방금 잰 값을 파일에 쓴 뒤 그 파일로 하한을 판정하므로, 변경의 `ux-measure`는 방금 잰 값으로 판정한다. 로컬 `pnpm structure`의 `ux check`는 커밋된 기록으로 하한을 본다.
4. **브라우저 내려받기는 캐시한다.** 새 합성 액션 `.github/actions/browser`가 Playwright 버전을 키로 `~/.cache/ms-playwright`를 캐시하고, 시스템 꾸러미는 브라우저가 못 뜰 때만 설치한다(ADR-0159 그대로). `ux-journeys`와 `ux-parts`가 함께 쓴다.
5. **진단용 아티팩트가 관문을 떨어뜨리지 않게 한다. `continue-on-error`를 늘리는 대신 올리기 단계를 없앤다.** `ux-journeys`가 올리던 묶음별 로그는 작업 로그에 이미 그대로 찍힌다(`TERRARIUM_UX_ECHO`). 아티팩트가 중복이라 올리는 단계를 지우면 올리기 실패가 관문에 닿을 길이 없다. `continue-on-error`로 넘기는 길은 `IGN007`이 막는다(끄기 기준선은 오르지 못한다. 기준선은 4로 그대로다). 시험 조각·목록의 보고서는 `test-summary`의 입력이라 진단용이 아니므로 그대로 둔다. 올리기가 실패하면 합계 검사가 정확히 빨강이 되어야 하기 때문이다.

## 이유
기다림의 대부분은 서로 기대지 않는 일을 한 줄에 세운 데서 왔다. 기대는 일(여정의 산출물을 탐침이 읽는 것)은 조각마다 앞 여정을 다시 돌려 풀고, 기대지 않는 일은 갈랐다. 같은 일을 여러 번 돌리는 값(탐침 조각마다 `build`와 `flow`를 한 번씩)은 러너 시간으로 치르고 벽시계는 줄인다. 점수 파일을 변경에서 빼면 웹 변경이 한 번만 돈다. 기록이 한동안 낡아 있어도 점수의 하한이 변경마다 방금 잰 값으로 판정되는 한 놓치는 것이 없다.

## 버린 길
- **UX 작업을 웹 변경에만 돌리기**: 서버나 코어 변경도 여정을 깨뜨릴 수 있다. `ux-journeys`는 문서만 바뀐 변경(ADR-0173)을 뺀 모든 변경에서 돈다. `ux-measure`만 지금처럼 웹·UX 측정·CI 변경에서 돈다.
- **`continue-on-error`로 올리기 실패를 넘기기**: 끄기 수를 늘린다(`IGN007`).
- **탐침 조각이 여정을 아예 안 돌리기**: 탐침이 읽을 세계와 실험이 없다.

## 결과
점수는 조각을 나누기 전과 후에 같은 커밋에서 같아야 한다. 같지 않다면 조각의 서버 상태(앞 여정이 남긴 세계)가 탐침이 보는 화면을 바꾼 것이니 조각의 앞 여정을 늘려 맞춘다. 정리 작업은 `pnpm ux`로 기록을 새로 재서 올리고 `pnpm ux ratchet`으로 하한을 올린다. 새 탐침이나 새 여정 묶음은 `parts.ts`와 `measure.ts`에 더하고 `merge.test.ts`가 빠뜨리거나 겹침을 잡는다.
