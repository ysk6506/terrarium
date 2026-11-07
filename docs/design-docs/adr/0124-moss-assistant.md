---
title: "ADR-0124 이끼 — 테라리움 도우미: 이름, 지식 둘, 화면 등록, 누락 검사, 기본 모델, 품질 측정, 먼저 말 걸지 않는다"
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - harness/src/checks/moss.test.ts
  - apps/server/src/runtime/moss.test.ts
  - apps/server/src/http/moss-api.test.ts
  - apps/web/src/moss/moss.test.ts
  - tests/spec/moss-questions.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - AGENTS.md
  - package.json
  - harness/config/architecture.yaml
  - harness/config/moss-floor.json
  - harness/config/test-lock.json
  - harness/src/run-all.ts
  - harness/src/checks/moss.ts
  - harness/src/checks/moss-scan.ts
  - harness/src/checks/moss.test.ts
amends_tests:
  - apps/web/src/logic/models.test.ts::the model section's state and words [REQ-099] > the three kinds have cards in order, with the labels the card shows
test_change_reason: 모델 등록 화면의 "아직 쓰는 곳은 없어요" 한 줄이 이끼가 기본 모델을 쓰게 되면서 거짓이 되어, 쓰는 곳은 이끼이고 작은 모델이면 답이 거칠 수 있다는 말로 바꾼다.
decision_hash: eadf1ddd68d16e4c
---
# ADR-0124 이끼 — 테라리움 도우미

## 맥락
연수 님(2026-11-06/07)이 정했다. 테라리움은 세계·시나리오·실험·툴·채점까지 말이 많고, 처음 쓰는 사람이 "이 점수가 왜 30점이에요?", "실험은 어디서 만들어요?"를 물을 곳이 문서뿐이다. 문서는 리포에 잘 쓰여 있는데 화면 옆에 없다. 설정에 모델 등록(ADR-0119)이 생겼지만 쓰는 곳이 아직 없다. 그래서 문서와 지금 화면을 함께 읽는 도우미를 둔다. 모두 REQ-103.

## 결정

### 1. 이름은 이끼, 하는 일은 셋
- 이름은 **이끼**다. 주 역할은 사용자의 테라리움 사용을 돕는 것이다.
- **묻기**: 테라리움에 대한 어떤 질문이든. **안내**: 화면을 같이 넘긴다. **대신 하기**: 화면의 동작을 대신 누른다.

### 2. 지식은 둘
- (a) **리포 문서.** 서버가 시작할 때 `docs/**/*.md`(ADR과 목업 포함, `exec-plans` 제외)를 `#`·`##`·`###` 제목 단위 조각으로 색인한다(`apps/server/src/runtime/moss-index.ts`). 한국어·영어 낱말의 BM25 방식 점수이고 **임베딩도 네트워크도 없다.** 조각마다 파일과 제목 경로를 가진다.
- (b) **지금 화면의 상태.** 화면마다 등록된 읽기가 구조화된 JSON(세계·실험·실행·결과·시나리오·설정·연결·벤치마크)을 준다.

### 3. 화면 등록 (screen registry)
- `apps/web/src/moss/registry.ts`에 모든 라우트가 `{ route, title, oneLine, read(), actions: [{ id, label, kind: 'navigate' | 'read' | 'change', run(args), confirm? }] }`를 올린다.
- **동작은 버튼이 쓰는 같은 핸들러다.** DOM을 누르지 않고 좌표도 쓰지 않는다.
- `kind: 'change'`(세계·시나리오·실험을 바꾸거나 시작·삭제)는 "이렇게 할게요" 카드의 **하기 / 그만**을 눌러야 한다. `navigate`와 `read`는 바로 한다.
- 여러 단계 일은 체크리스트로 보이고, **사용자가 화면을 직접 누르면 멈추고 "이어서 할까요?"를 묻는다.**

### 4. 누락 없이 — 검사기
`harness/src/checks/moss.ts`를 `run-all`에 등록한다.
- **MOSS001** `App.tsx`의 모든 라우트가 등록부에 있다.
- **MOSS002** 화면이 쓰는 동작 id는 모두 등록돼 있고, 핸들러가 필요한 동작에는 핸들러가 있고, 쪽의 모든 버튼(`<Button>`, `btn` 클래스의 `<button>`·`<Go>`)이 등록된 `data-moss-action`을 달거나 이유를 적은 `data-moss-skip`을 단다(감싼 요소에 달아도 된다).
- **MOSS003** 색인이 만들어지고, 모든 조각이 자기 제목으로 다시 찾아진다.
- **MOSS004** 점수·지표·사다리·설정 타일은 `MossAsk`를 쓴다.
- 이 검사는 등록을 하기 전의 상태에서 130건으로 실패했고, 모두 등록한 뒤 통과한다.

### 5. 화면
- 오른쪽 아래의 조용한 "이끼" 버튼. 처음 한 번만 "처음이세요? 같이 만들어요"를 말하고 `localStorage`에 기억한다(`try/catch`).
- 오른쪽 360px 패널. 내용을 가리지 않고 쪽에 `padding-right`를 준다. 머리는 "이끼 · 화면 이름". 화면마다 질문 칩 셋(등록부), 입력칸 하나("무엇이든 물어보세요").
- `Cmd+K`·`/`는 같은 입력칸을 연다. 동작 이름과 맞는 짧은 글은 실행·이동, 문장은 질문이다.
- 답은 세 문장 안, 숫자에는 단위, 접힌 "출처"(문서 조각 제목 칩, "이 실행의 사건 기록"), 이어 물을 칩 둘~셋.
- 동작 중 대상에 1초 동안 이끼 초록 테두리와 "사다리로 갈게요" 같은 한 줄.
- 결과·사다리·설정·실험 화면의 숫자와 용어에 작은 "?"(`MossAsk`)가 붙고, 누르면 질문이 채워진 채 패널이 열린다.

### 6. 모델
- 설정에 등록한 **기본 모델**을 쓴다. `POST /api/moss/ask { screen, question, state }`가 프롬프트를 짠다: system은 테라리움 안내자라는 역할·해요체·세 문장 이하·조각 id로 근거·근거가 없거나 점수가 낮으면 "문서에 없어요", user는 찾은 조각과 상태 JSON. **서버는 동작을 실행하지 않는다.** 동작은 클라이언트가 등록부에서 고르고, 모델은 `{ answer, sources, suggestedActions?, followUps }` JSON만 돌려준다. 스트리밍은 하지 않는다.
- 기본 모델이 없으면 버튼이 "모델을 등록하면 이끼가 깨어나요"로 바뀌어 설정으로 잇는다.
- 정직한 한계: "문서에 없어요", 그리고 설정의 모델 카드에 "작은 모델이면 이끼의 답이 거칠 수 있어요".

### 7. 품질 측정
- `tests/spec/moss-questions.json`(100개 이상: 문서 조각마다 "X가 뭐예요?" 하나와 손으로 쓴 "왜" 30개)과 `tests/spec/moss-questions.test.ts`. 모델 없이 **찾기만** 시험한다: 위 세 조각에 기대한 문서가 든 비율 90% 이상.
- `pnpm moss-eval`은 기본 모델이 등록된 서버에 은행을 실제로 물어 "출처를 달고 답한 비율"과 "문서에 없어요" 비율을 잰다. 래칫 파일 `harness/config/moss-floor.json`이 있고 **바닥값은 아직 정하지 않는다.**

### 8. 먼저 말 걸지 않는다
팝업도 알림도 없다. 처음 한 번의 한마디 뒤로는 버튼이 그냥 있다.

## 이유
- 문서를 화면 옆에 두려면 화면이 무엇을 보여 주는지 이끼가 알아야 한다. 그래서 화면 상태를 읽는 길이 등록부 하나로 정해져 있고, 새 쪽이 생기면 검사가 막는다.
- 동작이 버튼의 핸들러라서 버튼이 바뀌면 이끼도 같이 바뀐다. 좌표나 DOM 클릭이면 화면을 고칠 때마다 조용히 깨진다.
- 바꾸는 동작에 카드를 두는 것은 사람이 모르는 새 세계·실험이 생기지 않게 하려는 것이다.
- 임베딩 없이 낱말로 찾는 것은 사내 망에서 모델 없이도 색인이 서고, 시험이 결정론적이기 때문이다.

## 대안과 버린 이유
- **임베딩 검색**: 임베딩 모델과 네트워크가 필요하고, 모델이 없을 때 이끼가 문서도 못 찾는다. 낱말 점수로 시작하고 못 찾는 것은 질문 은행이 수로 보여 준다.
- **서버가 동작을 실행**: 서버는 화면의 상태(어느 대화상자가 열렸는지)를 모른다. 그리고 모델이 서버에서 직접 세계를 만들면 카드를 거치지 못한다.
- **화면을 눌러 주는 에이전트(좌표·DOM)**: 화면이 바뀔 때마다 깨진다.
- **먼저 말 거는 도우미**: 조용히 쓰는 도구라는 이 화면의 원칙(web-ui.md)과 맞지 않는다.

## 결과
- 새 화면·버튼·문서는 이끼에게도 닿아야 한다. 안 그러면 `MOSS*`가 막는다.
- 이끼의 답 품질은 모델에 달렸다. 찾기 품질만 시험으로 지키고, 답 품질은 `pnpm moss-eval`로 재서 바닥값을 정한다.
- 모델 등록 화면의 "아직 쓰는 곳은 없어요"가 "쓰는 곳: 이끼"로 바뀌어 잠긴 시험 한 건을 이 ADR로 고친다.
