---
title: ADR-0135 지금 하는 방식은 사람이 적고, 에이전트의 값은 코드가 기록에서 세어 둘을 같은 잣대로 견준다
kind: decision
status: active
enforced_by:
  - packages/core/src/analysis/process.test.ts
  - packages/core/src/analysis/ontology.test.ts
  - apps/server/src/http/process-api.test.ts
  - apps/web/src/logic/process-compare/process-compare.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/test-lock.json
  - harness/src/ux/score.ts
amends_tests: []
decision_hash: c7ed5efb0d819f4e
amended_by:
  - adr: "0197"
    what: 승인 줄은 승인 사건에서만 센다
---
# ADR-0135 프로세스 비교: 적은 값과 잰 값을 같은 잣대로

## 맥락

실험 결과는 점수와 복구 시간을 말하지만, "지금 사람들이 하는 방식보다 나은가"에는 답하지 못했다. 보는 사람은 단계가 몇 개 줄고 사람이 몇 명 빠지고
시간이 어떻게 변했는지, 그리고 이 세계를 끝에서 끝까지(E2E) 맡기려면 무엇이 더 필요한지를 알고 싶어 한다.

## 결정

1. **시나리오마다 "지금 하는 방식" 표를 사람이 적는다.** 순번·누가·무엇을·걸리는 시간·종류(확인/승인/물리/넘기기). 서버는 `GET/PUT /api/scenarios/:id/current-process`로 저장하고, 규칙은 코어 계약(zod)이 확인한다. 처음 적은 사용자가 주인이고 남은 읽기만 한다.
2. **에이전트의 값은 코드가 센다.** `foldRun`이 실행 기록(`events`)을 접어 단계·사람·시간을 낸다. 에이전트의 연속 툴 호출은 한 줄("툴 N번")로 접고, 사람에게 묻기·넘기기·현장 작업은 각자 한 줄이다. 모델은 숫자에 관여하지 않는다.
3. **적은 값을 지어내지 않는다.** 표가 없으면 잰 값만 보이고 "지금 하는 방식 적기"로 안내한다. 기본값·어림값은 없다. 두 열의 이름은 "지금 하는 방식 (적은 값)"과 "에이전트가 하면 (테라리움에서 잰 값 · N번 평균)"이다.
4. **세계 단위로 E2E에 필요한 것을 Object·Link·Action으로 보인다.** 시나리오 정의와 청사진에서 뽑고, 고른 실험의 실행에서 실제 쓴 것을 센다. 모든 고장 종류는 적어도 한 Action에 닿는다(시험이 확인). 사람이 해야 하는 일은 `physical.repair` 하나로 모은다. 표는 브라우저에서 CSV·JSON으로 내보낸다.
5. **이끼의 설명은 기본 모델이 있을 때만 보인다.** 숫자 타일은 `MossAsk`로 묻게 한다.

## 이유

- 사람이 적은 값과 기계가 잰 값을 섞으면 어느 쪽도 믿을 수 없다. 이름과 열을 갈라 두면 "적은 값"은 가정이고 "잰 값"은 증거라는 것이 화면에서 읽힌다.
- 숫자를 모델이 말하게 하면 같은 기록에서 다른 숫자가 나온다. 접기 규칙을 순수 함수로 두면 시험으로 고정된다.
- 기록 모양이 옛 실행과 달라도 `legacyEvents()`로 같은 규칙을 탄다. 새 저장 칸은 `current_processes` 하나다.

## 대안과 버린 이유

- **모델이 표를 대신 채우기**: 지어낸 기준선이 된다. 버렸다.
- **표가 없을 때 업계 평균으로 채우기**: 같은 이유로 버렸다.
- **서버가 CSV를 만들기**: 파일 한 번에 서버 경로와 권한이 하나 더 는다. 값은 이미 화면에 있어 브라우저에서 만든다.
- **단계를 툴 호출마다 한 줄로 세기**: 사람이 적은 5단계 옆에 백 줄이 놓인다. 접은 줄에 "툴 N번"을 적는 쪽이 같은 잣대에 가깝다.

## 결과

- 새 경로 넷(`getCurrentProcess`·`putCurrentProcess`·`experimentProcess`·`worldOntology`)이 `ROUTES`에 더해진다.
- 여정 `process-compare`(예산 12)가 `harness/src/ux/score.ts`와 `tests/e2e/ux/journeys.ts`에 더해진다. 요구사항 REQ-112와 잠금 파일이 함께 바뀐다.
- 승인 줄은 에이전트가 `ask_human`을 부른 실행에만 나온다. 내장 에이전트는 부르지 않아 그 실행에는 없다.
- 설계는 [process-compare.md](../process-compare.md).
