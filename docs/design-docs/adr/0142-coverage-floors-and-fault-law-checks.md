---
title: ADR-0142 커버리지 하한을 새 단위까지 넓히고, 고장 난 날에도 물리 법칙을 검사한다
kind: decision
status: active
enforced_by:
  - .github/workflows/ci.yml
  - harness/config/coverage-floor.json
  - scripts/coverage-gaps.ts
  - tests/spec/physics-laws-faults.test.ts
touches_protected:
  - .github/workflows/ci.yml
  - harness/config/coverage-floor.json
  - harness/config/test-lock.json
  - harness/src/checks/docs-main.test.ts
  - harness/src/ci/shard-sum-main.test.ts
decision_hash: df008ba5cde8a5af
---
# ADR-0142 커버리지 하한을 새 단위까지 넓히고, 고장 난 날에도 물리 법칙을 검사한다

## 맥락
ADR-0140 이후 CI에서 처음으로 커버리지 하한이 측정되었다(TD-0002). 하한 아래인 단위가 여럿이었고, 하한이 없는 단위도 넷 있었다. 또 ADR-0137의 물리 법칙 감시기는 평온한 날(고장 없음)에서만 검사했다.

## 결정
1. **하한이 없던 단위에 하한을 더한다.** `core.llm` 96, `core.ranking` 98, `core.topology` 93, `core.physics.slots` 97. 값은 측정치를 0.5 단위로 내림한 것이다. 기존 하한은 낮추지 않는다.
2. **빈 곳을 CI 로그에 보인다.** `coverage-floors` 작업이 `scripts/coverage-gaps.ts`로 단위별·파일별로 덮이지 않은 줄 범위를 `coverage-gaps.txt`로 남기고 로그에도 찍는다. 보고서 내려받기가 막힌 환경에서도 어디에 테스트가 모자란지 알 수 있다.
3. **`coverage-floors`는 아직 게이트가 아니다.** 하한을 못 채운 단위가 남아 있어(TD-0002 제목에 단위별 모자란 양을 적는다) `gate.needs`에 넣지 않고 `continue-on-error`도 그대로 둔다. 하한을 낮추거나 파일을 제외하거나 테스트를 약하게 하는 길로 맞추지 않는다. 마감(2026-11-21)은 그대로다.
4. **고장 난 날의 법칙 시험을 더한다.** `tests/spec/physics-laws-faults.test.ts`가 고장 계획 28개를 70번 돌려 `LawMonitor`가 위반을 보고하는지 본다. 위반은 `KNOWN_V1_EXCEPTIONS`에 이름 붙은 항목으로만 허용하며, 항목은 `fault`와 `measured`(측정한 값)를 가진다. 물리와 `physics-golden`은 바꾸지 않는다.
5. **찾은 예외는 모두 `power.chain`이다.** 전기 패스가 공급자 부하를 합친 뒤에 냉각·플랜트가 소비를 바꾸어 패널이 한 걸음(10초) 늦는다. 여섯 건이 기록되었고 목록은 `physics-laws.md`에 있다. 고치는 일은 물리 변경이므로 이 ADR의 범위 밖이다.
6. **하한 시험 전용 보강.** `docs.ts`와 `shard-sum.ts`의 명령줄 진입부는 잠긴 기존 시험을 건드리지 않도록 새 파일(`docs-main.test.ts`, `shard-sum-main.test.ts`)로 시험한다.

## 게이트를 빠르게 두는 방법(제안)
측정한 시간: 게이트가 의존하는 작업은 러너가 한가할 때 약 3.5분이다. 커버리지 조각은 대부분 2분 안에 끝나지만 6번과 7번이 7.5분 이상 걸려 `coverage-floors`가 약 8분 뒤에야 끝난다. 이를 게이트에 넣으면 약 4.5분 이상이 더해진다. 게이트로 올릴 때 지킬 것:
- 조각 6·7의 파일을 다른 조각으로 나눠 커버리지 조각의 길이를 고르게 한다(시뮬레이션이 무거운 파일을 따로 묶지 않는다).
- 커버리지 조각은 테스트 조각과 같은 시점에 병렬로 시작한다. 게이트 테스트 조각은 계속 계측 없이 돌린다.
- `coverage-floors`는 병합만 하고, 빈 곳 목록은 같은 작업에서 만든다.
- 고장 난 날 시험은 로컬 약 55초라 `test-heavy`로 옮기지 않고 일반 조각에 둔다. 러너에서 60초를 넘으면 옮긴다.

## 결과
- 새 하한 4개가 생겼고 기존 하한은 그대로다.
- 하한을 못 채운 단위는 TD-0002에 남고, 게이트로 올리는 일은 그 부채를 닫을 때 새 ADR로 한다.
- 고장 난 날에도 법칙이 검사된다. 새 위반은 시험을 깨뜨리고, 알려진 예외는 이름으로만 허용된다.
