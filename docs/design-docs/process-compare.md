---
title: 프로세스 비교 — 지금 하는 방식과 에이전트가 하는 방식을 단계·사람·시간으로 견주기 (REQ-112)
kind: spec
status: active
last_verified: 2026-11-11
covers:
  - packages/core/src/contract/process.ts
  - packages/core/src/contract/process-routes.ts
  - packages/core/src/experiments/current-process.ts
  - packages/core/src/analysis/process-steps.ts
  - packages/core/src/analysis/process-compare.ts
  - packages/core/src/analysis/ontology.ts
  - packages/core/src/analysis/ontology-use.ts
  - apps/server/src/runtime/processes.ts
  - apps/web/src/logic/process-compare/rows.ts
  - apps/web/src/logic/process-compare/words.ts
  - apps/web/src/logic/process-compare/export.ts
  - apps/web/src/ui/pages/process-table.tsx
  - apps/web/src/ui/pages/process-compare.tsx
  - apps/web/src/ui/pages/process-ontology.tsx
covers_hash: 726f7fe8a5db8a3c
verification_log:
  - "2026-11-10: 내려받는 파일 이름 규칙(exportName)을 코드와 대조해 더했다"
  - "2026-11-10: 파일 이름 규칙을 fileName 그대로(한글 유지)로 되돌려 대조했다"
  - "2026-11-11: 2026-11-11: ADR-0141 변경(레지스트리 분할, 한 가지 행동, 크기, aria)을 코드와 대조해 이 문서에 반영했다"
  - "2026-11-11: 2026-11-11: 이끼 동작 셋을 코드와 대조해 맞음 (ADR-0141)"
  - "2026-11-11: result page split into tabs (ADR-0171); checked against covered code"
  - "2026-11-11: step 가 (ADR-0174): identity and policy; statements checked against the code"
---
# 프로세스 비교 (REQ-112, [ADR-0135](adr/0135-process-compare.md))

실험은 "에이전트가 얼마나 잘 고쳤나"를 점수로 말해요. 이 기능은 한 걸음 더 가요. 지금 사람들이 이 일을 어떻게 하는지 **적은 값**과,
에이전트가 테라리움에서 한 **잰 값**을 같은 잣대(단계·사람·시간)로 나란히 놓아요. 두 값은 이름부터 달라요. 적은 값은 사람이
믿고 적은 것이고, 잰 값은 코드가 실행 기록에서 센 것이에요.

## 원칙

1. **잰 값은 코드가 세요.** 모델도 사람도 숫자를 만들지 않아요. 실행 기록(`RunResult.events`)을 `foldRun`이 접어서 단계·사람·시간을 세요.
2. **적은 값을 지어내지 않아요.** 표를 안 적은 시나리오는 잰 값 열만 보이고, 옆에 "지금 하는 방식 적기" 링크가 있어요. 기본값도 어림값도 없어요.
3. **표는 시나리오마다 하나, 시나리오를 만든 사람의 것이에요.** 적는 사람은 시나리오를 만든 사람과 관리자이고(먼저 적은 사람이 아니에요, [권한](permissions.md)), 다른 사람은 읽기만 해요. 아직 아무도 안 적었어도 만든 사람이 아니면 적을 수 없어요.
4. **이끼의 설명은 덤이에요.** 기본 모델이 등록돼 있을 때만 보이고, 숫자는 이미 코드가 센 것을 이끼가 풀어 말할 뿐이에요.

## 1. 지금 하는 방식 표 (#7)

시나리오 목록의 "지금 방식" 링크로 여는 화면(`/scenarios/:id/process`, 제목 "…일 때, 지금은 누가 뭘 하나요?")이에요. 한 줄이 한 단계예요.

| 칸 | 뜻 | 검증 |
|---|---|---|
| 순번 | 줄 위치 (자동) | 줄 순서가 곧 순번이에요 |
| 누가 | 역할 이름 | 1~40자 |
| 무엇을 | 하는 일 | 1~120자 |
| 걸리는 시간 | 숫자 + 분·시간·일 | 0 이상 정수, 분으로 저장 (`PROCESS_MAX_MINUTES` 이하) |
| 종류 | 확인 · 승인 · 물리 · 넘기기 | `check` `approve` `physical` `handoff` |

- 줄 추가·삭제·위아래 옮기기. 아래에 붙는 발 줄에 "N단계 · 사람 N명 · 시간"이 보이고 저장 버튼이 있어요.
- **사람 N명**은 "누가" 칸의 서로 다른 이름 수예요 (앞뒤 공백을 무시해요).
- **시간**은 줄 시간의 합이에요. 기다림은 줄 시간에 넣어 적어요.
- 저장은 `PUT /api/scenarios/:id/current-process` 한 번이고, 줄 수 상한과 글자 수는 `PutCurrentProcessBody`가 확인해요.
- "이 표로 실험 만들기"는 표가 있을 때만 켜져요 (같은 시나리오로 실험 만들기로 가요).

## 2. 실험 결과의 전후 비교 (#8)

실험 결과 화면의 "지금 하는 방식 vs 에이전트" 카드예요. `GET /api/experiments/:id/process`가 모든 숫자를 서버에서 세어 줘요.

| 열 | 값 | 이름 |
|---|---|---|
| 왼쪽 | 적은 표의 단계·사람·시간 | 지금 하는 방식 (적은 값) |
| 오른쪽 | 실행들의 평균 | 에이전트가 하면 (테라리움에서 잰 값 · N번 평균) |
| 차이 | 잰 값 − 적은 값 | 단계 −4 · 사람 −3 · 시간 +21시간 9분 |

시간 차이가 늘어날 수도 있어요. 물리 작업(부품 배송 등)을 에이전트가 기다린 시간도 시간에 들어가기 때문이에요. 그래서 장부에서 "물리"
줄을 따로 보여 줘요.

### 단계를 세는 법 (`foldRun`)

실행의 `events`를 앞에서부터 읽으며 줄(`LedgerRow`)로 접어요. 옛 실행은 `legacyEvents()`로 같은 모양이 돼요.

| 기록 | 장부 줄 | 종류 |
|---|---|---|
| 에이전트의 툴 호출이 이어지는 구간 (다른 줄이 나올 때까지) | 한 줄 "툴 N번" | `agent` |
| `ask_human` (사람에게 물음) | 한 줄 | `approve` |
| `escalate`와 상대 도메인의 넘겨받음·끝냄 | 한 줄, 리드타임 포함 | `handoff` |
| 같은 넘김인데 누군가 장비 앞에 와야 하는 일 | 한 줄, 리드타임 포함 | `physical` |

- **단계**는 장부 줄 수, **사람**은 장부에 나온 사람(에이전트가 아닌 쪽)의 서로 다른 수, **시간**은 에이전트가 일을 받은 때부터 끝까지의 시뮬레이션 초예요.
- 에이전트의 연속 호출을 한 줄로 접는 건 읽기 쉽게 하려는 것이고, 접힌 줄 안의 호출 수가 "툴 N번"이에요. 장부 위에 설명 한 줄이 있어요 ("에이전트의 연속 호출은 한 줄로 접었어요").
- 숫자는 `meanNumbers`가 실행들의 평균을 내요. 대표 장부는 평균에 가장 가까운 실행(`typicalRun`)이에요.

## 3. 이 세계를 E2E로 가려면 (온톨로지)

세계 화면(`GET /api/worlds/:id/ontology?experimentId=`)에서 시나리오의 정의가 무엇을 요구하는지 Object·Link·Action으로 보여 줘요.

- **Object**: 시나리오의 고장이 건드리는 물체 종류 (서버·스위치·냉각 장치 …). `deriveNeeds`가 시나리오 문서와 세계의 청사진에서 뽑아요.
- **Link**: 필요한 물체 종류와 이어진 관계 (전원·네트워크·냉각·스토리지 …). 양끝 가운데 한쪽이 필요한 물체면 세어요.
- **Action**: 고장 종류마다 풀 수 있는 조치. `MISTAKE_ACTIONS`·`TASK_ACTIONS`가 고장 종류를 조치로 옮기고, 사람이 해야 하는 일은 `physical.repair` ("현장 점검·부품 교체") 하나로 모아요. **모든 고장 종류는 적어도 한 조치에 닿아요.** 시험이 이를 확인해요.
- **쓴 것**: 고른 실험들의 실행이 실제로 부른 툴·넘긴 도메인·사람에게 물은 횟수를 `deriveUse`가 세요. "에이전트 2 · 승인 뒤 0 · 물리 1" 같은 줄이 돼요.

실험을 고르지 않으면 "필요한 것"만 나와요.

## 4. 내보내기

세계 요구 카드의 "Object · Link · Action 표로 내보내기"는 서버를 거치지 않고 브라우저에서 만들어요 (`logic/process-compare/export.ts`).

- 한 줄이 Object·Link·Action 하나예요. 칸은 `type·id·name·count·targets·faults·doer`예요. 실험을 골랐으면 Action의 `count`(쓴 횟수)와 `doer`(가장 많이 한 쪽)가 차요.
- **CSV**: 엑셀에서 한글이 깨지지 않게 BOM을 붙이고, `=`·`+`·`-`·`@`로 시작하는 글은 수식으로 읽히지 않게 막아요.
- **JSON**: `{ world, objects, links, actions }`예요.
- 파일 이름은 `<세계 이름>-ontology.csv`예요. 한글 이름은 그대로 쓰고, 글자·숫자·`_`·`-`가 아닌 것(공백, `/ \ : * ? " < > |`, 제어 문자)은 `-`로 바꿔요. 이름이 비면 `world`예요 (`fileName`).
- 실험을 안 골랐으면 쓴 횟수는 빈칸이에요 (0으로 채우지 않아요).
- 전후 비교의 숫자는 화면에서 보고, 내보내는 건 세계 요구 표예요.

## 5. 이끼 (REQ-092 연결)

| 자리 | 이끼가 하는 일 |
|---|---|
| 숫자 타일 (단계·사람·시간·툴) | `MossAsk`: "이 숫자는 뭐예요?" 눌러 물음 |
| "이끼의 설명" | 기본 모델이 있을 때만 그려요. 없으면 블록 자체가 없어요 |
| 화면 등록 | `scenarioProcess` 라우트 한 칸 (`apps/web/src/moss/registry-scenario.ts`). 읽기(`read`)로 적은 단계와 요약을 이끼에게 알려요 |

이끼의 동작은 셋이에요(ADR-0141): `process-add-step`("단계 한 줄 더하기"), `process-save`(저장, 카드로 확인), `process-experiment`(저장한 표로 새 실험). 이 화면의 큰 버튼은 `data-moss-action`이고, 행 안의 위·아래·지우기 같은 편집 버튼만 `data-moss-skip`이에요 (`moss.md`의 규칙).

## 저장과 경계

- `ExperimentStore`에 `currentProcess` 한 칸이 더해졌어요 (`MemoryStore`·`SqliteStore`; 표 `current_processes`).
- 규칙은 `core.analysis`(순수 함수)에, 저장은 `core.experiments`에, 손은 `apps/server/src/runtime/processes.ts`(`Processes`)에 있어요.
- 웹은 `logic/process-compare`의 순수 함수로 줄을 만들고 `ui/pages/process-*.tsx`가 그려요. 서버에서 온 숫자를 웹이 다시 계산하지 않아요 (내보내기도 받은 숫자를 옮겨 적기만 해요).

## 시험

| 시험 | 확인하는 것 |
|---|---|
| `packages/core/src/analysis/process.test.ts` | 접기 규칙(툴 묶음·승인·물리·넘기기), 평균·차이, 옛 실행, 표 없는 비교 |
| `packages/core/src/analysis/ontology.test.ts` | 필요한 Object·Link·Action, 모든 고장 종류가 조치에 닿음, 쓴 것 세기 |
| `apps/server/src/http/process-api.test.ts` | 표 저장·조회, 시나리오를 만든 사람만 고침, 검증 거절, 비교·온톨로지 응답 |
| `apps/web/src/logic/process-compare/process-compare.test.ts` | 줄·발 숫자, 말, 세계 요구의 CSV·JSON |
| 여정 `process-compare` | 표 적기 → 실험 → 전후 비교 → 내보내기 (`ux-honeycomb.md`) |

## 하지 않는 것

- 적은 값을 어림해 채우지 않아요. 모델이 표를 대신 적지도 않아요.
- 비용(돈)은 이 비교에 넣지 않아요. 돈은 실험의 "바꾸기"와 `capacity.md`가 다뤄요.
- 승인 줄은 에이전트가 `ask_human`을 부른 실행에만 나와요. 내장 에이전트는 부르지 않으므로 그 실행에는 승인 줄이 없어요.
