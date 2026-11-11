---
title: ADR-0158 시드마다 여러 번 돌리고, 통계의 단위는 실행이 아니라 시드다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - apps/server/src/runtime/repeats.test.ts
  - apps/server/src/adapters/sqlite-repeat.test.ts
  - packages/core/src/analysis/seed-statistics.test.ts
  - apps/web/src/logic/seed-rows.test.ts
touches_protected:
  - docs/product-specs/requirements.md
amends_tests:
  - packages/core/src/analysis/analysis.test.ts::benchmark leaderboards [REQ-039] > configurations are pooled across people and ranked; small samples wait unranked
  - packages/core/src/analysis/analysis.test.ts::<import:cc825183>
  - "packages/core/src/contract/contract.test.ts::experiments: create, fork, add runs [REQ-030] [REQ-040] > a fork changes only what it names; adding runs says how many or which seeds"
  - packages/core/src/experiments/experiments.test.ts::recipes [REQ-030] [REQ-031] > a sound recipe has no problems; every problem is named in Korean
  - packages/core/src/experiments/experiments.test.ts::run lifecycle [REQ-030] > runs go queued → running → finished, and finished runs never change
  - apps/web/src/logic/logic.test.ts::=run
  - apps/server/src/runtime/repeats.test.ts::repeats of a seed [REQ-118] > the runs of an experiment, seeds times repeats, have a limit that is said before anything is queued
  - apps/web/src/logic/editors.test.ts::the experiment form and forks [REQ-030] [REQ-040] > a draft says what is missing step by step, and becomes a request
  - apps/web/src/logic/world-words.test.ts::=SCREENS
  - apps/web/src/logic/world-words.test.ts::=SOURCES
  - "apps/web/src/logic/world-words.test.ts::글 잣대: 해요체, 숫자와 단위, 시스템 말 금지, 버튼은 결과 [REQ-077] > the experiment form starts on the recommended number of runs, and says the range when it is out"
  - "packages/core/src/analysis/seed-statistics.test.ts::repeats of a seed: the seed is the unit [REQ-118] > a difference is clear only over two seeds or more: four runs of one seed are one situation"
  - "packages/core/src/analysis/seed-statistics.test.ts::repeats of a seed: the seed is the unit [REQ-118] > the shaking inside a seed is its own number, and so are the seeds that came out both ways"
  - packages/core/src/experiments/experiments.test.ts::forks and lineage [REQ-040] > the difference reads as words, with tools added and removed
test_change_reason: 통계의 단위가 실행에서 시드로 바뀌고 실행이 반복 번호를 지니게 되어 다섯 곳의 단언이 바뀐다. 순위표 시험은 같은 시드(1)가 두 실험에 겹쳐 있어 "실행 3번이면 순위"를 단언하고 있었는데, 이제 서로 다른 시드 3개가 필요하므로 시험 입력의 시드를 겹치지 않게 하고 순위 조건 상수의 이름을 바꿨다(성질은 그대로이고 겹친 경우는 새 시험이 따로 단언한다). 나머지는 한도 문구(실행 20번 대신 시드 20개와 실행 60번), 실행 더하기 요청의 안내 문장(반복이 늘었다), 새 실행 기록의 반복 번호(repeat 1), 실행 요약 시험 자료의 반복 번호다. 어느 것도 채점과 점수 분해의 단언을 건드리지 않는다. 화면의 말을 정리하면서(시드 대신 "상황", 첫 질문을 "서로 다른 상황을 몇 개"로) 한도 문구, 원본과 견준 말의 이름표(시드 대신 "상황")와 실험 만들기 글 시험(몇 개·권장 5개)과 초안 오류 문장이 바뀌었고, 글 잣대 시험의 화면 목록이 결과·순위표·요약 막대까지 넓어졌다. 이 ADR에서 새로 쓴 시험의 기대 문장도 같은 말로 고쳤다. 채점과 점수 분해의 단언은 건드리지 않았다.
decision_hash: 5510d10fa363c6ba
---
# ADR-0158 시드마다 여러 번 돌리고, 통계의 단위는 실행이 아니라 시드다

## 맥락
제품 책임자(연수 님)가 물었다: 같은 시나리오를 같은 시드로 여러 번 돌릴 수 있는가. 지금은 못 한다.

지금의 사실:
- 레시피에는 시드 목록이 있고 시드 하나가 실행 하나다(`experiments/model.ts`). 기본 시드는 1·2·3, 최대 20개다. 이미 있는 시드를 더하면 거절한다("시드 N는 이미 있어요", `runtime/experiments.ts`).
- 같은 시드는 같은 세계 흐름을 만든다(REQ-001). 시드가 정하는 것은 세계 쪽의 우연이다(가상 담당자의 걸리는 시간, 운영 실험의 고장).
- 실행 사이의 차이는 두 곳에서 온다: 시드가 만든 상황의 차이, 그리고 에이전트 자신의 흔들림(같은 상황에서도 모델의 답이 달라진다). 시드당 한 번이면 둘을 가를 수 없다.
- 통계는 실행들을 서로 독립인 표본으로 보고 평균과 95% 구간을 낸다(`analysis/stats.ts`의 `summarize`). "분명한 차이"는 두 구간이 겹치지 않을 때다(ADR-0023 5번).
- 순위표는 같은 시험지·같은 구성의 실행을 실험과 사람에 상관없이 합친다(ADR-0023 2번). 세 사람이 기본 시드 1·2·3으로 돌리면 실행 9번이 되고, 지금은 그것을 독립 표본 9개로 센다. 같은 시드의 실행은 같은 상황이라 독립이 아니다. 구간이 실제보다 좁게 나오고 "분명한 차이"가 쉽게 난다.

제품 목표 3번은 "채점이 늘 맞고 같다"다(ADR-0138). 통계가 표본 수를 부풀리면 맞지 않다.

## 결정
1. **레시피에 "시드당 반복"을 둔다.** 기본은 1이다. 시드마다 그 수만큼 실행을 만든다. 실행은 시드와 반복 번호로 가리킨다. 세계의 우연은 시드만 따르므로 같은 시드의 반복들은 같은 세계 흐름에서 시작한다.
2. **통계의 단위는 시드다.** 실험의 평균은 시드별 평균의 평균이고, 95% 구간은 시드별 평균들로 낸다(자유도 = 시드 수 − 1). 합격률과 진단 정확도도 시드별 비율의 평균이다. 순위표와 "분명한 차이"도 같다. 같은 시드의 실행이 여러 실험·여러 사람에서 와도 한 시드로 모은다.
3. **같은 조건에서의 흔들림을 따로 보인다.** 시드 안에서의 점수 퍼짐(반복이 2번 이상인 시드들로)과, "결과가 갈린 시드"(같은 시드인데 합격과 불합격이 섞인 시드)의 수.
4. **순위에 오르는 조건은 "완료된 실행이 있는 서로 다른 시드 3개 이상"이다.** ADR-0023 3번의 "실행 3번 이상"을 이것이 대신한다. 시드 하나를 세 번 돌린 것은 상황 하나를 본 것이다.
5. **반복 더하기.** 끝난 실험에 반복을 더하면 모든 시드에 한 번씩 더한다. 시드 더하기는 지금처럼 새 시드만 받고, 더해진 시드는 지금의 반복 수만큼 돈다.
6. **한도.** 한 실험의 실행 수(시드 수 × 반복)에 한도를 둔다. 화면은 돌리기 전에 "실행 15번"처럼 수를 보여 준다.
7. **결정적인 에이전트의 반복은 바이트까지 같아야 한다.** 내장 기준 에이전트로 같은 시드를 반복하면 점수 분해와 툴 호출 기록이 같다. 다르면 실험장의 결함이다. 이것을 시험으로 둔다.
8. **반복이 1이고 시드가 겹치지 않으면 지금과 숫자가 같다.** 이미 있는 실험의 평균·구간·판정이 그대로인지 골든 시험으로 지킨다. 순위표에서 같은 시드가 겹친 줄은 구간이 넓어지고 판정이 달라질 수 있다. 이것은 고치는 것이고, 무엇이 달라졌는지 결과 화면과 릴리스 노트에 적는다.
9. 하네스에 넘기는 실행 정보에 반복 번호를 더한다(하네스 규약의 `seed` 옆).

## 하지 않는 것
- 두 실험을 시드끼리 짝지어 비교하는 검정(짝 비교). 더 예민하지만 "분명한 차이"의 기준을 바꾸는 일이라 따로 정한다.
- 시드가 세계에 아무 차이도 만들지 않는 시나리오를 알아내 알려 주는 일. 쓸모 있지만 따로 한다.

## 버린 길
- **같은 시드를 그냥 여러 번 받기(통계는 그대로)**: 실행 수만큼 표본이 는 것처럼 보여 구간이 좁아진다. 틀린 확신을 만든다.
- **반복마다 세계의 우연도 다르게**: 그러면 시드를 늘린 것과 같아져서 에이전트의 흔들림을 가를 수 없다.
- **실행을 단위로 두고 섞인 모형으로 추정**: 설명하기 어렵다. 시드 평균으로 내는 쪽이 보수적이고 한 문장으로 말할 수 있다.

## 결과
REQ-118(예정). `experiments-and-analysis.md`는 만들 때 고친다.
