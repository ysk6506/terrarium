---
title: ADR-0140 CI가 합치기 관문이다 — 테스트는 조각으로 나눠 병렬로, 커버리지는 따로 잰다
kind: decision
status: active
last_verified: 2026-11-10
enforced_by:
  - .github/workflows/ci.yml
  - harness/src/ci/shard-sum.test.ts
  - harness/src/checks/traceability.test.ts
  - harness/src/checks/test-config.ts
  - harness/src/checks/test-config.test.ts
  - harness/config/tests.yaml
touches_protected:
  - .github/workflows/ci.yml
  - .github/actions/setup/action.yml
  - harness/src/ci/shard-sum.ts
  - harness/src/ci/shard-sum.test.ts
  - harness/src/checks/traceability.ts
  - harness/src/checks/traceability.test.ts
  - harness/src/checks/test-config.ts
  - harness/src/checks/test-config.test.ts
  - harness/config/tests.yaml
  - harness/src/run-all.ts
  - harness/src/files.ts
  - harness/config/test-lock.json
  - vitest.config.ts
  - docs/product-specs/requirements.md
  - AGENTS.md
decision_hash: 14ac4d75abc79f1c
---
# ADR-0140 CI가 합치기 관문이다 — 테스트는 조각으로 나눠 병렬로, 커버리지는 따로 잰다

## 맥락
테스트가 385개 파일, 4,330개로 늘어 개발과 CI의 병목이 되었다. main의 CI는 2026-11-07부터 푸시마다 실패했다(TD-0001). 한 작업이 `pnpm check`를 이어서 돌렸고(1,013초), 커버리지 계측 아래에서 파일을 병렬로 돌리니 시뮬레이션 테스트 열한 건이 시간 초과, 성능 단언 한 건이 실패했다. 테스트가 먼저 실패해서 그 뒤의 구조 검사·커버리지 하한·UX 기록 검사는 CI에서 한 번도 돌지 않았다(TD-0002, TD-0003).

## 결정
1. **CI가 합치기 관문이다.** "모든 테스트를 모든 로컬 실행에서"는 "모든 테스트를 모든 합치기에서"로 바뀐다. 로컬에서는 바뀐 코드와 관련된 테스트만 돌린다. 전체 테스트는 CI가 돌린다. main에는 게이트 작업이 모두 초록일 때만 합친다.
2. **작업을 나눠 병렬로 돌린다.** 린트·타입, 테스트 조각(12개), 테스트 합계 검사, 구조 검사가 게이트다. 마지막 `gate` 작업 하나가 필수 검사 이름이다. 같은 ref의 앞선 실행은 취소한다.
3. **게이트 테스트 조각은 커버리지 계측 없이 돌린다.** 계측이 시뮬레이션 테스트를 느리게 해 시간 초과를 만든다. `testTimeout`, 테스트, 단언은 바꾸지 않는다. 성능 단언(journal)은 계측 없는 조각에서 통과해야 한다.
4. **모든 테스트는 정확히 한 번 돈다.** `test-summary`가 조각별 JSON 보고서의 파일별 테스트 수를 합쳐, 조각 없이 센 `vitest list`와 파일마다 같은지, 실패·건너뜀이 없는지 검사한다(`harness/src/ci/shard-sum.ts`).
5. **커버리지는 따로 잰다.** 같은 조각으로 계측해 블롭 보고서를 모아 합치고(`--merge-reports`) 단위별 하한을 검사한다. 계측 아래에서는 시간 제한을 CLI로 늘린다. 통과 여부는 게이트 조각이 정하기 때문이다. 하한을 못 맞추면 하한을 낮추지 않고 단위별 수치를 보고한다. 그 전까지 이 작업은 게이트가 아니다(TD-0002, 기한 2026-11-21).
6. **UX 측정은 러너에서 돌리고 게이트가 아니다.** 그래픽 가속이 없는 환경에서는 측정값이 깎인다. 여정과 측정을 나누기 전까지(TD-0004, 기한 2026-11-24) 기록만 남긴다.
7. **'예정' 요구사항(TD-0003).** 결정은 났지만 아직 만들지 않은 요구사항은 본문을 `**예정(ADR-NNNN)**`으로 시작한다. 추적 검사는 이를 테스트 없이도 실패로 보지 않고 "예정"으로 따로 나열한다. 표시한 ADR이 없으면(`TRACE005`), 이미 테스트가 그 요구를 가리키면(`TRACE006`) 실패한다. 구현된 요구를 예정으로 숨길 수 없다. REQ-084·085·089·091·092는 구현 전 ADR(0089, 0092, 0095, 0096)이 가리키는 로드맵이라 예정으로 표시한다.

8. **느린 파일이 진행 보고를 막지 않게 한다.** 수백 개의 CPU 위주 테스트를 한 약속 사슬로 도는 파일(reference-mutations 등)은 워커가 이벤트 루프로 돌아오지 못해, 모두 통과했는데도 `Timeout calling "onTaskUpdate"`(60초)로 실행이 실패한다. 설정의 `setupFiles`가 테스트마다 이벤트 루프를 한 번 돈다(`tests/setup/yield-between-tests.ts`). `setupFiles`는 계속 금지(`TCFG001`)이고, `harness/config/tests.yaml`의 `allowed_setup_files`에 적힌 이 파일 하나만 예외다. 테스트·단언·`testTimeout`은 그대로다.

9. **느린 파일은 혼자 돌린다.** 보고 시간이 한도를 넘는 `tests/spec/calibration.test.ts`(테스트 하나가 1분 넘게 CPU를 잡는다)와 저장소 전체를 검사하는 `harness/src/common.test.ts`(자기 20초 한도가 빠듯하다)는 `test-heavy` 작업이 차례로 돌리고, 조각은 이 둘을 CLI로 뺀다. 합계 검사가 이 둘도 정확히 한 번 돌았는지 본다. 같은 이유로 `harness/src/files.ts`는 글롭을 한 번만 컴파일한다(구조 검사 전체가 약 15% 빨라진다).

## 이유
계측과 병렬 실행이 겹치면 시간 초과가 나는데, 계측 없이 조각으로 나누면 가장 느린 조각이 전체 시간을 정한다. 테스트를 약하게 하거나 빼는 길은 ADR-0004가 막는다. 조각 합계 검사는 나눔 때문에 테스트가 조용히 빠지는 것을 막는다.

## 버린 길
- 시간 제한을 늘리거나 느린 테스트를 제외하기: 테스트를 약하게 한다.
- 조각마다 계측: 시간 초과가 그대로 난다.
- 로컬에서 전체 테스트: 메모리와 시간이 모자라 병목이 된다.

## 결과
`pnpm check`는 로컬에서 그대로 동작한다. 합치기 전에 CI 초록을 확인한다. TD-0001은 CI가 초록으로 확인되면 닫는다. TD-0003은 예정 표시로 닫는다. TD-0002와 TD-0004는 계속 열려 있다.
