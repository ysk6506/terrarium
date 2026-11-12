---
title: 이끼 — 테라리움 도우미가 문서와 화면으로 답하고 화면을 같이 넘기는 법
kind: spec
status: active
last_verified: 2026-11-12
covers:
  - apps/web/src/moss/bar-offset.ts
  - apps/web/src/moss/ask.tsx
  - apps/web/src/ui/moss/Launcher.tsx
  - apps/server/src/runtime/moss.ts
  - apps/server/src/runtime/moss-index.ts
  - apps/server/src/runtime/moss-prompt.ts
  - apps/server/src/runtime/moss-scoring.ts
  - packages/core/src/contract/moss.ts
  - packages/core/src/contract/moss-routes.ts
  - apps/web/src/moss/registry.ts
  - apps/web/src/moss/registry-scenario.ts
  - apps/web/src/moss/registry-global.ts
  - apps/web/src/moss/types.ts
  - apps/web/src/moss/store.ts
  - apps/web/src/moss/ask.tsx
  - apps/web/src/ui/moss/Panel.tsx
  - apps/web/src/ui/moss/Launcher.tsx
  - apps/web/src/logic/models.ts
  - harness/src/checks/moss.ts
verification_log:
  - "2026-11-11: ADR-0146: 이끼 알약이 떠 있지 않고 홈에서만 흐름 안, 키보드 도움말은 3D 탭 첫 한 번, 좁은 폭 제목 줄 나눔을 코드와 대조해 맞춤"
  - "2026-11-11: step 가 (ADR-0174): identity and policy; statements checked against the code"
  - "2026-11-12: step 나 review fixes (ADR-0179): default model is a model made for everyone, one scope route for five kinds; statements checked against the code"
  - "2026-11-11: 문서 색인이 하네스가 만든 generated 폴더를 건너뛰게 된 것을 적음 (ADR-0180). 코드의 다른 변화는 없음"
  - "2026-11-12: 이끼가 묻는 사람마다 기본 모델을 정하는 것(defaultFor, ADR-0179)과 합친 main의 변화를 코드와 대조해 한 문장을 더함"
covers_hash: ff01f4eb25efaa4e
verified_body: 3be83a9ee1e0432f
unchanged_reverifies: 0
---
# 이끼 (REQ-103, [ADR-0124](adr/0124-moss-assistant.md), [ADR-0125](adr/0125-moss-requires-model.md))

## 한 문장으로

**이끼는 테라리움을 쓰는 사람 옆에서 묻는 말에 문서와 지금 화면으로 답하고, 화면을 같이 넘기고, 화면의 동작을 대신 눌러 주는 도우미다.**
먼저 말을 걸지 않고, 모르는 것은 "문서에 없어요"라고 한다. **LLM(기본 모델)을 연결해야만 쓸 수 있고, 연결하지 않으면 꺼져 있다.**

## 비유로 이해하기

이끼는 옆자리에 앉은 선배다. 위키(리포 문서)를 읽어 두었고, 내 모니터도 같이 본다. "이 점수가 왜 30점이에요?" 하면 위키와 내 화면을 보고 세 문장으로 답하고,
"실험 하나 만들어 줘" 하면 마우스를 대신 잡되 **시작 버튼만은 내 허락을 받고** 누른다.

## 하는 일 셋

| 일 | 무엇 | 예 |
|---|---|---|
| 묻기 | 테라리움에 대한 어떤 질문이든 | "복구 점수가 뭐예요?", "왜 점수 차이를 믿을 만하다고 해요?" |
| 안내 | 화면을 같이 넘김(`navigate`) | "사다리로 갈게요", "설정 열기" |
| 대신 하기 | 화면의 동작을 대신 누름(`read`·`change`) | "실험 만들기", "내 실험만 보기" |

## 지식 둘

1. **리포 문서.** 서버가 시작할 때 `docs/**/*.md`와 `docs/**/mockups/*.html`(`exec-plans`와 하네스가 만든 `generated` 제외 — 표뿐인 생성물은 검색어를 독차지해 서술 조각을 밀어낸다)을 `#`·`##`·`###` 제목 단위 조각으로 나눠 메모리에 올린다 (`runtime/moss-index.ts`).
   - 조각마다 **파일과 제목 경로**(`문서 제목 › 소제목`)와 고정된 id(`docs/…md#소제목`)가 있다. 글이 없는 제목은 조각이 아니다(아래 소제목이 가진다). 긴 칸은 줄 경계에서 1,600자 안팎으로 잘라 같은 제목의 조각 여럿이 된다.
   - 찾기는 **BM25 방식 낱말 점수**다. 한글은 낱말·두 글자 토막·조사를 뗀 말, 영어는 낱말로 자른다. 제목은 세 번 센다. 질문의 말이 조각 제목의 말을 모두 품으면 점수를 얹어, 제목으로 부른 조각이 길이에 묻히지 않는다.
   - **임베딩도 네트워크도 없다.** 파일을 읽어 메모리에 올릴 뿐이라 서버가 켜질 때 한 번 만들고(1,000여 조각) 질문마다 수 밀리초 안에 찾는다.
   - "찾았다"의 기준은 점수 8 이상**이고** 질문의 말 가운데 25% 이상을 조각이 가진 것이다(`coverage`). 점수만 높고 말이 맞지 않는 엉뚱한 질문(문서 밖의 요리나 날씨 이야기)을 거른다.
2. **지금 화면의 상태.** 화면마다 읽기 함수가 구조화된 JSON(세계·실험·실행·결과·시나리오·설정·연결·벤치마크)을 준다 (`apps/web/src/moss/states.ts`). 키는 한국어라 모델이 질문과 같은 말로 찾는다. 사건 기록은 앞 30건, 채점표는 전부다.

## 화면 등록부 (screen registry)

`apps/web/src/moss/registry.ts`가 라우트마다 한 칸을 모아 낸다. 칸은 영역별 파일(`registry-global|world|scenario|experiment|other.ts`, 보조 `registry-kit.ts`)에 적고, 한 파일이 500줄을 넘지 않는다. `moss` 검사는 `registry*.ts`를 모두 하나로 읽는다(ADR-0141).

```ts
{ route, title, oneLine, stateLabel, questions: [칩 셋],
  actions: [{ id, label, kind: 'navigate' | 'read' | 'change', go?, steps?, confirm?, aliases?, saying? }] }
```

- **동작은 버튼이 쓰는 같은 핸들러다.** 화면 컴포넌트가 `useMossScreen(route, { read, run: { [id]: handler } })`로 자기 핸들러를 붙인다. DOM을 누르거나 좌표를 찍지 않는다. 화면을 옮기는 동작은 등록부에 `go`(주소)만 적는다.
- **`change`**(세계·시나리오·실험을 바꾸거나 시작·삭제)는 "이렇게 할게요" 카드가 **하기 / 그만**을 물은 뒤에만 한다. `navigate`·`read`는 바로 한다. 카드의 한 줄에는 화면이 알려 준 지금 상태가 들어간다("IAP 실험용 · 시나리오 12개 · 기본 툴 묶음 · 5번").
- **여러 단계 일**(`steps`)은 체크리스트로 보인다. 마지막 `change`만 카드를 거친다. **사용자가 화면을 직접 누르거나 치면 멈추고 "이어서 할까요?"를 묻는다.**
- 동작 하나를 하는 동안 대상(`data-moss-action`)에 1초 동안 이끼 초록 테두리가 둘리고, 한 줄 말("사다리로 갈게요")이 뜬다.
- 프로세스 비교(REQ-112)의 `scenarioProcess` 화면은 읽기와 동작 셋을 이끼에게 알린다: `process-add-step`(빈 단계 한 줄), `process-save`(저장, 카드 확인), `process-experiment`(저장한 표로 새 실험). 행 안의 편집 버튼만 `data-moss-skip`이다. 결과 화면의 단계·사람·시간·툴 타일에 "?"가 있고, "이끼의 설명"은 기본 모델이 있을 때만 그려진다.
- 숫자와 용어에는 작은 **"?"**(`MossAsk`)가 붙는다. 누르면 "이 실행이 왜 30점이에요?"처럼 질문이 채워진 채 패널이 열려 바로 묻는다. 결과 화면의 점수 타일, 사다리의 층 이름과 칸 카드, 설정의 용어, 실험의 지표에 있다.

## 입력과 패널

- 오른쪽 아래의 "이끼" 버튼은 조용하다. 처음 온 사람에게만 "처음이세요? 같이 만들어요"를 한 번 말하고 이 브라우저에 기억한다(`localStorage`, 읽기·쓰기는 `try/catch`). 그 뒤로는 알림도 팝업도 없다.
- 패널은 오른쪽 360px이고, 열리면 쪽에 `padding-right`가 생겨 내용을 가리지 않는다. 머리는 "이끼 · 화면 이름", 화면마다 질문 칩 셋(등록부), 입력칸은 "무엇이든 물어보세요".
- `Cmd+K`와 `/`는 같은 입력칸을 연다. **동작 이름과 맞는 짧은 글**("실험 만들기")이나 "~해 줘" 부탁은 실행·이동, 물음표나 의문사가 든 문장은 질문이다.
- 답은 세 문장 안이고 숫자에는 단위가 붙는다. 그 밑에 접힌 **"출처"** 줄(문서 조각 제목 칩, 화면 상태를 썼다면 "이 실행의 사건 기록")과 이어 물을 칩 둘~셋이 있다.
- 모델이 없으면 이끼는 꺼져 있다. 아래 "기본 모델이 있어야 깨어난다"를 보라.

## 기본 모델이 있어야 깨어난다 (ADR-0125)

| | 기본 모델 있음 | 기본 모델 없음 |
|---|---|---|
| 떠 있는 자리 | "이끼" 버튼 | 떠 있는 것이 없다. 홈에서만 첫 화면 설명 아래 한 줄로 "모델을 등록하면 이끼가 깨어나요 → 설정"(`/settings#models`)이 흐름 안에 있다(`SleepPill`, ADR-0146) |
| 패널, `Cmd+K`·`/` | 열린다 | 없다(키를 가로채지도 않는다) |
| 작은 "?"(`MossAsk`) | 감싼 것 + "?" | 감싼 것만 |
| 처음 온 사람의 한마디 | 한 번 | 없다(했다는 기억도 깨어난 뒤에야 적는다) |
| `POST /api/moss/ask` | 답 | 409 `{ error: { code: "no_model", reason: "no_model" } }`, 모델은 부르지 않는다 |

- 웹은 `GET /api/models`를 앱이 열 때 한 번 읽고, 설정의 모델 구역이 모델을 바꿀 때 보내는 `terrarium:models-changed`에 다시 읽는다. 목록에 `isDefault`가 있으면 깨어 있다(`hasDefaultModel`, `logic/models.ts`). 읽기 전은 꺼진 것으로 친다.
- 이끼를 여는 길은 모두 `openMoss`(`moss/store.ts`) 하나를 지나고, 꺼져 있으면 이 함수는 아무것도 하지 않는다. 꺼지는 순간 열린 패널도 닫는다.
- 막는 것은 실행 중이고 **등록은 그대로 완전해야 한다**: `moss` 검사(MOSS001~004)는 모델이 있든 없든 같다.

## 서버: `POST /api/moss/ask`

| 들어오는 것 | 돌려주는 것 |
|---|---|
| `{ screen, question, state, actions: [{ id, label }] }` | `{ answer, answered, sources, suggestedActions, followUps, model, rough? }` |

서버가 프롬프트를 짠다.

- **system**: 테라리움 안내자라는 역할, 해요체, 세 문장 이하, 숫자에 단위, 근거는 조각 id로, 근거가 없으면 정확히 "문서에 없어요", 동작은 실행하지 않고 권하기만, 답은 JSON 하나.
- **user**: 화면 이름, 찾은 문서 조각(`[id] 경로` + 본문), 화면 상태 JSON(9,000자까지), 쓸 수 있는 동작(`id: 이름`), 질문.
- 문서에도 화면에도 근거가 없으면 **모델에게 묻지 않고** "문서에 없어요"를 돌려준다(지어낼 틈을 주지 않는다).
- 모델이 돌려준 JSON에서 **없는 출처와 등록 안 된 동작 id는 버리고**, 답은 세 문장으로 자른다. JSON이 아니면 글만 건져 `rough: true`로 알린다. `answered`는 출처가 있고 "문서에 없어요"가 아닐 때 참이다.
- **서버는 동작을 실행하지 않는다.** 동작은 클라이언트가 등록부에서 골라 누른다.
- 기본 모델은 묻는 사람마다 정해진다(`defaultFor`, ADR-0179): 범위가 "모두"인 기본 모델이 있으면 그것, 없으면 그 사람이 볼 수 있는 모델 중 가장 먼저 등록된 것. 남의 "나만" 모델의 키는 쓰지 않는다. 기본 모델이 없으면 409(`no_model`)다. 모델이 답하지 않거나 시간이 지나면 503이다. 모델 이름은 등록값, 마지막 연결 확인이 본 첫 이름, API의 목록 첫 이름 순으로 정한다.

## 점수를 묻는 말의 찾기 규칙 (ADR-0125)

낱말 점수만으로는 "이 실행이 왜 18.2점이에요?"가 채점 문서가 아니라 `harness-e2e.md`·`operation-agent-guide.md`로 갔다. 그래서 규칙 둘을 둔다 (`runtime/moss-scoring.ts`).

1. **부스트.** 질문에 채점 낱말이 있으면 `measurement.md`와 ADR-0091·ADR-0104 조각의 점수에 `SCORING_BOOST`(2배)를 곱한다. 채점 낱말은 `점수`, 숫자 바로 뒤의 `점`, `점이에요`·`점인가요`, `채점`, `합격`·`불합격`, `감점`·`만점`, `MTTR`, `복구 시간/순서/점수`, `진단 점수`다. 이미 낱말이 맞은 조각만 오르고, 곱셈이라 순서만 바뀐다. 2배는 은행 전체로 재서 고른 값이고 더 크게 하면 채점 낱말이 든 다른 질문의 문서를 밀어낸다.
2. **이 실행의 채점표.** 화면 상태에 `채점표`(결과 화면의 `runState`)가 있으면, 점수·합격·항목별 판정·점수·이유·요약으로 "이 실행의 채점표" 조각을 만들어 문서 조각 앞에 둔다. 모델 프롬프트의 첫 조각이고, 출처에는 문서가 아니라 "화면 상태"로 보인다.

## 화면에서의 자리 (REQ-104)
- **"?"는 올려 볼 때만 보인다.** `MossAsk`의 "?"(`.moss-q`)는 감싼 글자 위에 포인터가 있거나(`:hover`) 그 안에 포커스가 있거나(`:focus-within`, `:focus-visible`) 할 때만 보이고(`opacity`), 터치 화면(`hover: none`)에서는 늘 보인다. 화면 읽기 이름("이끼에게 묻기: …")은 그대로다.
- **떠 있는 이끼 버튼과 첫 인사는 아래 막대를 가리지 않는다.** 아래 막대(`we-bar`·빌더 `stage-steps`·실험 만들기 `summary-card`, 새 막대는 `data-bottom-bar`만 달면 된다)의 높이를 `moss/bar-offset.ts`가 재서 CSS 변수 `--bottom-bar-h`에 넣고, 버튼의 `bottom`은 `max(22px, 막대 높이 + 16px)`다. 막대가 없으면 제자리, 둘이면 가장 높은 것을 따른다. 막대 아래에 남는 틈(폰의 탭 줄)은 `--below-bar-h`에 따로 넣는다. 빌더의 "다음" 칩과 에이전트 칩은 무대 안에 있어서, 이끼 알약이 그 위로 올라갈 때 이 틈을 더한다(REQ-111, ADR-0134). 막대 둘레(부모)가 크기를 바꿔도 다시 재므로, 화면 폭을 바꿔도 값이 낡지 않는다.

## 누락 없이 — `moss` 검사

`pnpm structure`(`harness/src/checks/moss.ts`)가 매번 확인한다.

| 코드 | 막는 것 |
|---|---|
| `MOSS001` | `App.tsx`에 라우트가 있는데 등록부에 칸이 없다(거꾸로도) |
| `MOSS002` | 쓰는 동작 id가 등록부에 없다 · 핸들러가 필요한 동작에 핸들러가 없다 · 쪽의 버튼에 `data-moss-action`(등록된 id)도 `data-moss-skip="이유"`도 없다. `data-moss-skip`은 감싼 요소에 달아도 된다 |
| `MOSS003` | 문서 색인이 만들어지지 않는다 · 어떤 조각이 자기 제목으로 다시 찾아지지 않는다 |
| `MOSS004` | 점수·지표·사다리·설정 타일(`figure-label`·`we-lname`·`we-d-head`·`setting-term`…)을 그리는 파일이 `MossAsk`를 쓰지 않는다 |

## 찾기 품질을 재는 법

- `tests/spec/moss-questions.json`: 문서 조각마다 "X가 뭐예요?" 하나(자동, `pnpm moss-bank`로 다시 씀)와 손으로 쓴 "왜" 질문 37개(점수를 묻는 7개 포함, 기대 문서는 `measurement.md`). 질문마다 답이 들어 있어도 되는 문서를 적는다(설계 문서와 그 ADR).
- `tests/spec/moss-questions.test.ts`: 위 세 조각에 기대한 문서가 든 비율이 은행 전체에서 90% 이상, 지금 문서에서 새로 만든 자동 질문에서 90% 이상, 손으로 쓴 "왜" 질문만으로 80% 이상.
- `pnpm moss-eval`: 기본 모델이 등록된 서버에 은행을 실제로 물어 "출처를 달고 답한 비율"과 "문서에 없어요" 비율을 잰다(`--record`는 `harness/config/moss-floor.json`의 `measured`에 적는다). 바닥값(`floor`)은 아직 정하지 않았다.

## 정직한 한계

- **작은 모델이면 이끼의 답이 거칠 수 있어요.** 설정의 모델 카드 밑에 이 말이 있다. JSON을 못 지키면 `rough`로 알리고 출처 없이 글만 보인다.
- **낱말로 찾는다.** 뜻이 같아도 말이 다르면("잠가" ↔ "잠금") 못 찾을 수 있다. 손으로 쓴 "왜" 질문에서 못 찾는 것이 일부 있고(시험이 비율로 적는다), 그럴 때 이끼는 "문서에 없어요"라고 한다.
- 화면 상태는 줄여서 준다(사건 앞 30건). 그 뒤의 일은 모른다고 말한다.
- 동작은 등록된 것뿐이다. 세계를 한 칸씩 지어 주거나 시나리오 블록을 놓아 주지는 않는다. 폼 안의 세부 입력은 `data-moss-skip`으로 사람 몫이다.
- 먼저 말을 걸지 않는다. 문제를 알아채서 알려 주는 일은 하지 않는다.
