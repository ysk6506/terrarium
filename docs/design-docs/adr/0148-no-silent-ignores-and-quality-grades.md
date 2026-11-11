---
title: ADR-0148 검사는 조용히 끌 수 없고, 단위별 품질 등급표는 하네스가 만든다
kind: decision
status: active
last_verified: 2026-11-11
enforced_by:
  - harness/src/checks/ignores.test.ts
  - harness/src/checks/quality.test.ts
  - harness/src/common.test.ts
amends_tests:
  - harness/src/common.test.ts::check entry points [REQ-024] > run-all runs every check and prints a verdict
test_change_reason: run-all의 검사 목록에 ignores와 quality 두 검사가 더해졌다. 시험은 목록을 그대로 대조하므로 두 이름만 더했고, 단언의 수와 종류는 그대로다.
touches_protected:
  - harness/src/checks/ignores.ts
  - harness/src/checks/ignores-scan.ts
  - harness/src/checks/ignores.test.ts
  - harness/src/checks/quality.ts
  - harness/src/checks/quality-facts.ts
  - harness/src/checks/quality.test.ts
  - harness/src/checks/debt-measure.ts
  - harness/src/run-all.ts
  - harness/src/common.test.ts
  - harness/config/ignores.yaml
  - harness/config/ignores-baseline.json
  - harness/config/test-lock.json
  - package.json
  - .github/workflows/ci.yml
  - AGENTS.md
  - docs/product-specs/requirements.md
decision_hash: f0363cfac9371267
---
# ADR-0148 검사는 조용히 끌 수 없고, 단위별 품질 등급표는 하네스가 만든다

## 맥락
구조 검사(`harness/src/checks/*`)와 부채 장부(`docs/exec-plans/tech-debt.yaml`)가 품질을 지키지만 두 군데가 비어 있었다.

1. **검사를 조용히 끄는 길이 열려 있었다.** 검사 끄기 주석, 건너뛴 시험, CI의 `continue-on-error`는 이유도 근거도 없이 둘 수 있었다. 부채 번호가 적힌 것은 몇 개뿐이었다. `TODO`는 `DEBT001`이 막는데 끄기는 막는 것이 없었다.
2. **어디가 얼마나 건강한지 볼 표가 없었다.** 커버리지 하한, 린트 경고, 크기 한도에 가까운 파일, 열린 부채, 낡은 문서가 각각 다른 곳에 있었다.

저장소를 AST로 전수 조사했다(문자열과 템플릿 안의 예시는 세지 않는다). 처음 값은 다음과 같다.

| 종류 | 처음 수 | 없앰(원인을 고침) | 이유만 적음 | ADR 근거 | 부채 근거 |
|---|---|---|---|---|---|
| `biome-ignore` | 42 | 1 | 17 | 1 | 23 (규칙 단위) |
| `eslint-disable` | 0 | 0 | 0 | 0 | 0 |
| `@ts-ignore`, `@ts-nocheck` | 0 | 0 | 0 | 0 | 0 |
| `@ts-expect-error` | 0 | 0 | 0 | 0 | 0 |
| 건너뛴 시험(`skip`, `todo`, `skipIf`, `fails`) | 0 | 0 | 0 | 0 | 0 |
| `continue-on-error` | 4 | 0 | 0 | 2 (ADR-0140) | 2 (TD-0002, TD-0004) |

`@ts-ignore`나 건너뛴 시험이 보이는 곳은 검사 자신의 시험(`testguard.test.ts`, `architecture.test.ts`)이 문자열로 든 예시와 잠금 파일의 지문뿐이다. `ARCH051`이 이미 `@ts-ignore`와 `@ts-nocheck`를 코드에서 막고 있고, `TEST002`가 건너뛴 시험에 `TD-NNNN`을 요구한다. 37곳이 `apps/web/src/ui/` 안에 있고, 17곳(`noArrayIndexKey` 14, CSS 3)이 아래 결정 3번의 부류에 든다. 접근성(`a11y`) 16곳과 의존성(`useExhaustiveDependencies`) 7곳은 이유는 있으나 번호가 없어 부채가 필요했다.

## 결정
### A. 무시 금지 규칙 (`harness/src/checks/ignores.ts`)
1. **무엇이 끄기인가.** `biome-ignore`(`-all`, `-start` 포함), `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, 건너뛴 시험(`skip`, `todo`, `skipIf`, `runIf`, `fails`, `fixme`, `ctx.skip()`), 그리고 `.github/` 안의 `continue-on-error`(`false`가 아닌 것). TypeScript는 컴파일러가 읽은 주석과 호출식으로 센다. 주석은 **시작이 지시문일 때만** 지시문이다. 문장 중간에서 이름을 말하거나 문자열·템플릿 안에 든 예시는 세지 않는다(`IGN` 시험이 확인한다). CSS는 문자열을 건너뛰는 주석 읽개로, YAML은 줄 단위로 읽는다.
2. **이유와 근거 번호.** 같은 줄 또는 바로 윗줄(윗줄은 그 줄에서 끝나는 주석)에 이유가 있고(`IGN001`, 공백·문장부호·번호를 뺀 8자 이상), 근거 번호가 있어야 한다(`IGN002`). 근거는 **열려 있는 `TD-NNNN`**이거나 **봉인된 활성 `ADR-NNNN`**이다. 닫혔거나 장부에 없는 부채를 가리키면 빨강이다(`IGN003`, "부채는 닫혔는데 끄기는 남음"). 없거나 봉인되지 않은 ADR을 가리켜도 빨강이다(`IGN004`).
3. **이유만 있으면 되는 부류, 규칙 단위 근거.** 근거 번호를 줄에 적는 것이 원칙이다. 예외는 둘이다(`harness/config/ignores.yaml`).
   - **이유만 있으면 되는 부류(`reason_only_rules`).** Biome의 `noArrayIndexKey`(정체성이 없는 행의 목록), `noImportantStyles`(움직임 줄이기가 모든 부품의 시간보다 이겨야 하는 CSS), `noDescendingSpecificity`(스타일 순서)와, 시험 파일의 `@ts-expect-error`(타입 시험은 컴파일 오류가 나야 한다는 것을 일부러 단언한다). 이들은 그 자리의 사정으로 답이 정해지는 모양 규칙이고, 고치려면 코드를 비틀어 같은 뜻을 다른 모양으로 쓰는 수밖에 없다. Biome가 이미 설명을 요구하므로 규칙이 더하는 것은 설명의 최소 길이와 수의 래칫이다. 목록에 규칙을 더하려면 ADR이 필요하다(설정 파일이 보호 경로다).
   - **규칙 단위 근거(`basis_by_rule`).** 줄마다 번호를 적을 수 없는 끄기(다른 작업이 고치는 중인 파일)는 규칙마다 열린 부채 하나를 근거로 둔다. 그 규칙의 끄기는 해당 부채가 열려 있는 동안만 통과하고, 부채가 닫히면 남은 끄기가 모두 빨강이다(`IGN003`). 줄에 번호가 있으면 줄의 번호가 우선이다. 접근성(`lint/a11y/`)은 부품이 접근성을 갖추지 못한 것이지 그 자리의 사정이 아니라서 디자인 시스템 부품으로 바꿀 때 없앨 빚이다(TD-0013, 기한 2026-12-22). `useExhaustiveDependencies`는 의존성 누락이 낡은 값을 읽는 진짜 버그 부류라서 한 곳씩 판정해 고치거나 ADR로 정당화한다(TD-0014, 기한 2026-12-08).
   그 밖의 규칙(`noExplicitAny`, `noNonNullAssertion`, 정확성·타입 규칙)과 시험 밖의 `@ts-expect-error`, 건너뛴 시험, `continue-on-error`는 줄에 번호가 필요하다.
4. **수는 늘 수 없다(래칫).** `harness/config/ignores-baseline.json`에 종류별 개수를 적는다. 개수가 기준선보다 늘면 `IGN005`로 빨강이다. 줄었는데 기준선이 그대로면 `IGN006` 알림 한 줄만 내고 통과한다. 끄기를 줄인 변경이 빨강이 되면 안 되기 때문이다. 기준선은 5시간마다 도는 정리 작업이 `pnpm ratchet`으로 내린다. 줄어든 자리에 다른 끄기가 슬쩍 들어올 수 있는 틈은 그때까지 남는다. 커버리지 래칫과 부채 기준선(`DEBT030`은 고쳐진 항목이 남아 있으면 빨강)과 다른 점이다. PR에서는 `--base`로 기준선을 올렸는지도 본다(`IGN007`). `pnpm ratchet`은 올리거나 새 종류를 만들지 않는다.
5. **지금 있는 것의 정리.** 원인을 고칠 수 있는 하나(`apps/server/src/main.ts`의 `console.error`, 프로세스 진입점이므로 `process.stderr.write`로 바꿨다)는 끄기를 없앴다. 시험 밖에서 느슨한 JSON을 읽는 일회용 드라이버(`tests/e2e/harness/drive.ts`의 `type Json = any`)는 이 ADR을 근거로 적었다. 타입을 하나하나 쓰면 일회용 스크립트가 길어지고 얻는 것이 없다. 이유가 너무 짧던 `apps/web/src/styles.css`의 "as above"는 이유를 풀어 썼다. `.github/workflows/ci.yml`의 네 곳은 이유와 근거(커버리지 조각의 시간 초과는 게이트 조각이 판정한다는 ADR-0140 두 곳, 커버리지 하한 TD-0002, UX 측정 TD-0004)를 적었다. `apps/web/src/ui/`의 37곳은 다른 작업이 그 파일을 고치는 중이라 건드리지 않았고 세기만 했다. 그중 14곳은 이유만 부류이고, 접근성 16곳과 의존성 7곳은 규칙 단위 근거로 새 부채 TD-0013, TD-0014를 올렸다.

### B. 품질 등급표 (`harness/src/checks/quality.ts`)
6. `docs/generated/quality.md`는 하네스가 **만든다**(`pnpm quality write`). 사람이 고치지 않는다. 충돌하면 고치지 않고 다시 만든다. 구조 검사 `quality`는 표를 **만들 수 있는지**만 관문에서 본다(생성이 던지지 않는다, 기록 파일과 장부의 단위 이름이 맞다: `QUAL002`, `QUAL003`). 다시 만든 결과가 커밋된 것과 다르면 `QUAL001` 알림 한 줄(`낡음: pnpm quality write`)만 내고 빨강이 아니다. 표의 칸은 거의 모든 변경에서 바뀌어서, 낡음을 빨강으로 하면 모든 변경이 표를 다시 만들어야 하고 열린 PR끼리 늘 충돌한다. 표는 5시간마다 도는 정리 작업이 새로 만들어 올리고(AGENTS.md의 첫 단계), 일반 변경은 건드리지 않아도 된다. CI의 `structure` 작업은 그 변경 기준의 등급표를 job 요약(`$GITHUB_STEP_SUMMARY`)에 찍어 변경마다 자기 등급을 보게 한다(`quality.ts print`). 단위는 `architecture.yaml`의 단위 나눔이고 어느 단위에도 속하지 않는 파일은 "(단위 밖)" 줄이다. 단위마다 커버리지(값 / 하한), 끄기 수, 한도(파일 500줄, 함수 80줄, 복잡도 12)의 90%를 넘은 파일·함수 수와 한도를 넘은 수, 열린 부채 수와 가장 이른 기한, 그 단위의 코드를 `covers`하는 활성 문서 중 가장 오래된 `last_verified`, 등급과 이유를 적는다. 표는 등급이 가장 낮은 단위부터 나열하고, AGENTS.md가 정리 작업에게 그 위쪽부터 시작하라고 한다.
7. **등급 규칙.** 위에서부터 처음 맞는 줄이다. 값은 모두 재서 나오고 사람이 고칠 수 없다. 규칙은 표 위에 그대로 인쇄한다.
   - **D**: 기록된 커버리지가 하한 아래, 한도를 넘은 파일·함수, 열린 고위험(high) 부채 중 하나라도 있다.
   - **C**: D가 아니고 열린 부채 2건 이상, 한도 90%를 넘은 것 5개 이상, 끄기 10곳 이상 중 하나라도 있다.
   - **B**: C가 아니고 열린 부채 1건, 한도 90%를 넘은 것 1개 이상, 끄기 1곳 이상, 커버리지 모름 중 하나라도 있다.
   - **A**: 위에 하나도 걸리지 않는다.
8. **커버리지는 지어내지 않는다.** 커버리지는 CI의 coverage 작업만 잰다. 저장소에는 하한(`coverage-floor.json`)만 있고 잰 값이 없어서, 값은 `docs/generated/` 아래의 `coverage-record.json`을 읽는다(없으면 모든 칸이 "모름"). 모름은 A가 될 수 없고(B가 상한) D로 내리지도 않는다. 기록은 CI의 `coverage-floors`가 `quality.ts record`로 찍는 JSON을 커밋하는 것으로 갱신한다(UX 점수 파일과 같은 길이다). 하한이 없는 단위(`web.ui` 등)는 "—"이고 커버리지는 등급에 들지 않는다.
9. **날짜를 쓰지 않는다.** 오늘 날짜가 들어가면 아무도 손대지 않은 날에 빨강이 된다. 그래서 등급은 값만으로 정한다. 기한이 지난 부채는 `DEBT011`이, 오래된 문서는 `DOC020`이 따로 잡는다. 표에는 가장 이른 기한과 가장 오래된 `last_verified`를 적어 정리 작업이 직접 비교하게 한다. 기록의 `measuredOn`은 기록할 때만 바뀐다.
10. **부채가 어느 단위에 속하는지.** 장부 항목의 선택 필드 `units: [core.world]`와, 그 단위의 코드 주석이 `TD-NNNN`으로 가리킨 것을 합친다. 어느 쪽도 없는 항목은 "(단위 밖)"에 놓인다. 단위 이름이 틀리면 `QUAL003`이다. `TD-0002`에 `units: [core.world]`를 적었다.

### C. 같이 바뀌는 것
11. `run-all`에 검사 `ignores`와 `quality`를 더한다. 이름 목록을 대조하는 `harness/src/common.test.ts`의 시험을 amends_tests로 고쳤다(이름 두 개만 더했다). `debt-measure.ts`는 함수 크기와 복잡도를 파싱된 트리마다 한 번만 재도록 `functionStats`를 두고, 부채 검사와 품질표가 같이 쓴다(검사하는 사실은 그대로다, ADR-0147). `REQ-022`와 `REQ-024`의 글에 이 규칙을 더했다. 시험은 각 규칙마다 빨강이 되는 예를 하나 이상 든다.

## 이유
끄기는 부채처럼 늘 수 있고 늘어도 아무도 모른다. 이유와 근거가 함께 있으면 되돌릴 때를 찾을 수 있고, 근거가 닫히면 끄기도 닫힌다. 개수에 래칫을 걸면 새 끄기는 반드시 다른 끄기를 없애거나 장부 항목을 늘려서만 들어온다(장부는 예산이 있다). 등급표는 이미 있는 측정값(커버리지 래칫, 크기 한도, 장부, 문서 신선도)을 한 장에 모아 정리 작업이 어디서 시작할지 기계적으로 정하게 한다. 등급을 값에서 계산하므로 표를 좋게 보이게 하는 길은 값을 실제로 개선하는 것뿐이다.

## 버린 길
- **끄기를 전부 금지**: 휴리스틱 규칙의 틀린 경보와 타입 시험의 일부러 낸 오류처럼 정당한 경우가 있고, 금지하면 코드를 비틀어 같은 뜻을 쓰게 된다. 이유와 근거를 요구하고 수를 막는 쪽이 낫다.
- **모든 끄기에 근거 번호를 요구**: 모양 규칙(`noArrayIndexKey` 등) 17곳에 억지 번호를 붙이게 된다. 번호가 의미 없어진다.
- **a11y와 의존성 끄기를 이유만 부류에 두기**: 이유가 적혀 있다는 이유로 "지금 그대로 두기"가 되고, 고칠 빚이 어디에도 남지 않는다.
- **정규식으로 줄만 훑기**: 문자열이나 주석 속의 예시를 끄기로 세거나, 시작이 아닌 곳의 이름을 지시문으로 센다. 이 저장소의 검사 시험이 바로 그런 예시를 담는다.
- **기준선이 줄면 빨강으로 하기**: 끄기를 줄인 변경이 빨강이 되고, 병렬로 끄기를 줄이는 변경끼리 기준선 파일에서 부딪친다. 알림만 내고 정리 작업이 내린다.
- **등급표가 낡으면 빨강으로 하기**: 거의 모든 변경이 표를 바꾸므로 모든 변경이 `pnpm quality write`를 돌려야 하고 열린 PR끼리 표에서 늘 충돌한다. 방금 없앤 병합 병목을 다시 만든다.
- **오늘 날짜로 등급을 정하기**(기한 지난 부채는 D): 아무도 손대지 않은 날 표가 낡아 매일 빨강이 될 수 있다. 기한은 `DEBT011`이 이미 지킨다.
- **로컬에서 커버리지를 재서 표에 넣기**: 전체 측정은 CI만 한다. 값이 기계마다 달라지고, 없을 때 "모름"이 정직하다.
- **사람이 등급을 고칠 수 있게 하기**: 표가 의견이 된다.

## 결과
- 새 끄기는 이유와 근거가 없으면, 또는 개수가 늘면 빨강이다. 끄기를 줄인 변경은 통과하고 알림만 나온다(`IGN006`). 기준선은 정리 작업이 `pnpm ratchet`으로 내리므로 `apps/web/src/ui/`의 끄기를 다른 작업이 줄여도 빨강이 되지 않는다.
- 첫 등급표에서 커버리지는 모두 "모름"이다. 다음 `coverage-floors` 실행 로그의 기록을 커밋하면 채워진다. 그 전까지 모든 측정 단위는 B가 상한이다.
- 커밋된 등급표는 다음 정리 작업 때까지 조금 낡을 수 있다. 그동안 변경마다의 정확한 등급은 CI 요약에서 본다. 충돌하면 손으로 풀지 않고 다시 만든다.
- 새 부채 항목은 TD-0013(접근성), TD-0014(의존성) 두 건이다. 열린 항목이 부채 예산(12건)을 채웠으므로 다음 부채는 하나를 닫고서야 올릴 수 있다.
