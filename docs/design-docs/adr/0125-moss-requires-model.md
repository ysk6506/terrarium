---
title: ADR-0125 이끼는 LLM을 연결해야만 쓸 수 있다 — 기본 모델이 없으면 꺼져 있고, 점수 질문은 채점 문서를 먼저 찾는다
kind: decision
status: active
last_verified: 2026-11-07
enforced_by:
  - apps/web/src/moss/moss.test.ts
  - apps/web/src/ui/moss/moss-gate.test.ts
  - apps/server/src/runtime/moss.test.ts
  - apps/server/src/http/moss-api.test.ts
  - tests/spec/moss-questions.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/test-lock.json
amends_tests:
  - apps/web/src/moss/moss.test.ts::the store joins the screen and the panel [REQ-103] > the panel opens with a question to send once, and closes
  - tests/spec/moss-questions.test.ts::[REQ-103] 이끼의 문서 찾기 > the bank has a hundred questions or more, thirty of them hand-written 왜 questions
  - apps/server/src/http/moss-api.test.ts::POST /api/moss/ask answers from the docs and the screen state [REQ-103] > without a default model it is 503 with the way out, and nothing is guessed
  - apps/server/src/runtime/moss.test.ts::<import:c34bd671>
  - apps/server/src/runtime/moss.test.ts::<import:d2d0b133>
  - apps/server/src/runtime/moss.test.ts::이끼 asks the default model and never acts [REQ-103] > with no default model it says so (503) instead of guessing
  - apps/web/src/moss/moss.test.ts::<import:db6e1c41>
  - tests/spec/moss-questions.test.ts::<import:83f289b7>
test_change_reason: 기본 모델이 없을 때 서버가 503 대신 409(reason no_model)를 돌려주고, 이끼가 켜져 있어야 패널이 열리며(시험이 먼저 깨운다), 손으로 쓴 "왜" 질문에 "이 실행이 왜 18.2점이에요?" 같은 점수 질문이 더해져 "왜"로 시작한다는 조건이 "왜"가 든다로 바뀐다. 바뀐 시험의 가져오기 줄도 같이 고친다.
decision_hash: bf76d224d7797477
---
# ADR-0125 이끼는 LLM을 연결해야만 쓸 수 있다

## 맥락
연수 님이 2026-11-07에 정했다. **이끼는 LLM을 연결해야만 쓸 수 있는 기능이다.** [ADR-0124](0124-moss-assistant.md)는 기본 모델이 없어도 패널·`Cmd+K`·`/`·작은 "?"를 열어 두고, 버튼만 "모델을 등록하면 이끼가 깨어나요"로 바꿨다. 그러면 모델 없이 열린 패널이 "동작 이름만 알아듣는" 어정쩡한 도우미가 되고, 서버는 같은 상황을 503(연결된 서비스가 안 답함)으로 돌려줘 "없음"과 "고장"이 섞인다.

같은 날 찾기 품질에서 한 가지가 보였다. "이 실행이 왜 18.2점이에요?"의 출처가 채점 문서(`measurement.md`)가 아니라 `harness-e2e.md`와 `operation-agent-guide.md`였다. 질문에 문서의 말이 거의 없고("18.2점이에요") 낱말 점수만으로는 채점 문서가 밀렸다.

## 결정

### 1. 기본 모델이 있어야만 이끼가 있다
- 웹은 `GET /api/models`를 앱이 열 때 한 번 읽고, 설정의 모델 구역이 모델을 더하거나 바꾸거나 지우면(`terrarium:models-changed`) 다시 읽는다. 목록에 `isDefault`가 하나라도 있으면 깨어 있다(`logic/models.ts`의 `hasDefaultModel`).
- **꺼져 있으면** 떠 있는 자리에는 "모델을 등록하면 이끼가 깨어나요 → 설정"이라는 작고 조용한 알약 하나만 남고(`/settings#models`로 가서 모델 구역으로 스크롤), 그 밖의 이끼는 아무것도 그리거나 반응하지 않는다: 패널 없음, `Cmd+K`·`/` 없음, "?"(`MossAsk`)는 감싼 것만 그리고, 처음 온 사람에게 하는 한마디도 없다(그 한마디를 했다는 기억도 깨어난 뒤에야 적는다).
- 이끼의 열기는 모두 `openMoss` 하나를 지나고, 이 함수는 꺼져 있으면 아무것도 하지 않는다. 꺼지는 순간 열려 있던 패널과 채워 둔 질문도 거둔다. 그래서 키·물음표·동작 어디서도 모델 없이 열 길이 없다.
- 서버 `POST /api/moss/ask`는 기본 모델이 없으면 **409** `{ error: { code: "no_model", reason: "no_model", message } }`를 돌려주고 모델은 부르지 않는다. 모델이 답하지 않는 것(연결·시간 초과)은 그대로 503이다.
- 화면 등록부는 그대로 완전해야 한다(`moss` 검사는 바꾸지 않는다). 막는 것은 실행 중이고 등록이 아니다.

### 2. 점수를 묻는 말은 채점 문서를 먼저 찾는다
작고 고정된 규칙 둘이다(`apps/server/src/runtime/moss-scoring.ts`). 임베딩도 모델도 더하지 않는다.
- **채점 낱말 부스트.** 질문에 채점 낱말(점수, 숫자 뒤의 "점", 점이에요, 채점, 합격·불합격, 감점·만점, MTTR, 복구 시간·순서·점수, 진단 점수)이 있으면 `measurement.md`와 복구 우선 채점의 ADR-0091·ADR-0104 조각의 점수에 **2배**를 곱한다. 이미 낱말이 맞은 조각만 오르고 순서만 바뀐다. 2배는 은행 전체를 1.6·2·2.5·3으로 재서 고른 값이다(커질수록 채점 낱말이 든 다른 질문을 밀어낸다).
- **이 실행의 채점표.** 화면 상태에 실행 결과의 `채점표`가 있으면 그 표(점수, 합격, 항목별 판정·점수·이유, 요약)로 "이 실행의 채점표" 조각을 만들어 문서 조각 앞에 둔다. 모델은 이 실행의 숫자를 먼저 읽고, 출처에는 문서가 아니라 "이 실행의 사건 기록" 같은 **화면 상태**로 보인다.
- 질문 은행에 점수를 묻는 "왜" 질문을 손으로 더하고, 기대 문서는 `measurement.md`다.

## 이유
- "있는 듯 없는 듯한" 도우미는 쓰는 사람에게 설명할 거리만 만든다. 모델이 없으면 없다고 한 줄만 하고 설정으로 보낸다.
- 막는 곳을 `openMoss` 한 곳과 `MossAsk`로 모아서, 새 화면이 생겨도 모델 없이 이끼가 열리는 길이 생기지 않는다.
- 409는 "지금 상태로는 할 수 없다"이고 503은 "연결된 곳이 안 답한다"다. 화면이 까닭(`reason`)으로 갈라 읽을 수 있다.
- 점수 질문은 사람이 가장 자주, 가장 말이 짧게 묻는 질문이라 일반 낱말 점수가 약하다. 규칙 둘은 그 한 갈래만 고치고 나머지 찾기는 건드리지 않는다.

## 대안과 버린 이유
- **모델이 없어도 동작만 알아듣게 둔다**(ADR-0124): 반쪽 도우미가 되고, 모델 없이 열리는 길을 지키는 비용이 크다.
- **버튼도 숨긴다**: 이끼가 있다는 것과 켜는 길(모델 등록)을 알 수 없다. 알약 하나는 남긴다.
- **임베딩으로 점수 질문을 풀기**: 임베딩 없이 낱말로 찾는다는 ADR-0124의 선택을 흔든다. 규칙 둘이 훨씬 작다.
- **부스트를 더 키운다**: 은행 전체에서 맞는 비율이 내려간다.

## 결과
- 모델 없는 서버에서 이끼는 알약뿐이다. 이끼를 쓰려면 설정의 모델 구역에 기본 모델이 있어야 한다([모델 등록](../model-registration.md)).
- `pnpm moss-eval`은 이전과 같이 기본 모델이 있는 서버가 있어야 한다.
- 질문 은행에 점수 질문이 더해졌고 찾기 시험이 이를 따로 확인한다.
