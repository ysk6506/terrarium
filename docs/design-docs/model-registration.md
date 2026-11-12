---
title: 모델 등록 — LLM API를 워크스페이스에 등록하고 연결 확인까지
kind: spec
status: active
last_verified: 2026-11-11
covers:
  - packages/core/src/llm/types.ts
  - packages/core/src/llm/http.ts
  - packages/core/src/llm/openai-compatible.ts
  - packages/core/src/llm/anthropic-compatible.ts
  - packages/core/src/llm/check.ts
  - packages/core/src/contract/models.ts
  - packages/core/src/contract/model-routes.ts
  - apps/server/src/runtime/models.ts
  - apps/web/src/logic/models.ts
  - apps/web/src/ui/pages/model-section.tsx
  - apps/web/src/ui/pages/model-dialog.tsx
covers_hash: 4a1c23a3ef8dd4c3
verification_log:
  - "2026-11-06: LLM API 등록"
  - "2026-11-07: REQ-103 이끼 추가 뒤 다시 읽음: 이끼 버튼 속성과 새 모듈 외에 이 문서의 서술과 어긋난 곳 없음"
  - "2026-11-07: ADR-0125: 이끼는 기본 모델이 있어야만 켜진다(꺼지면 알약만, 409 no_model), 점수 질문 찾기 규칙을 문서에 반영하고 코드와 대조함"
  - "2026-11-11: model-section.tsx에서 안 쓰는 useAction 호출만 지움, 문서 내용과 동작은 그대로"
  - "2026-11-11: step 가 (ADR-0174): identity and policy; statements checked against the code"
---
# 모델 등록 (REQ-099, [ADR-0119](adr/0119-llm-api-registration.md))

## 한 문장으로

**LiteLLM·OpenAI 호환·Claude 호환 API를 설정 화면에서 등록하고 "연결 확인"까지 한다. 쓰는 곳은 이끼 하나다.**
나중에 실험 결과 해석과 사용자 안내에 기본 모델을 쓰려는 준비이고, 화면도 그렇게 말한다.

## 무엇이 어디에 있나

| 조각 | 자리 | 하는 일 |
|---|---|---|
| 얇은 클라이언트 | `core/llm` (`LlmClient`) | `listModels()`와 `complete({model?, system?, messages, maxTokens?})` 둘뿐. `fetch` 주입, 15초 시간 제한, 오류는 `LlmError` |
| 어댑터 | `openai-compatible.ts`, `anthropic-compatible.ts` | litellm과 openai는 앞의 것, anthropic은 뒤의 것 |
| 연결 확인 | `llm/check.ts` (`checkLlm`) | 모델 목록 → 실패하면 `max_tokens: 1` 한 번. 시계를 받는다 |
| 계약 | `contract/models.ts`, `model-routes.ts` | 요청 검증(zod), 응답 `LlmModelView`, 경로 여섯 ([HTTP API](http-api.md)) |
| 서버 | `runtime/models.ts` (`Models`) | 등록·고치기·지우기·기본·확인. 키와 헤더 값을 비밀 상자로 봉인. 고치기·지우기·연결 확인은 등록한 사람과 관리자만, 기본 모델 정하기는 관리자만([권한](permissions.md)) |
| 저장 | `ExperimentStore`의 `putModel`·`getModel`·`listModels`·`deleteModel` | SQLite `llm_models` 표(기록 한 덩어리), 메모리 구현도 있다 |
| 화면 | `ui/pages/model-section.tsx`, `model-dialog.tsx`, `logic/models.ts` | 설정의 "모델" 구역 |

## 두 프로토콜, 세 종류

| 종류 | 카드 라벨 | 모델 목록 | 완성 | 인증 |
|---|---|---|---|---|
| `openai` | OpenAI 호환 | `GET /v1/models` | `POST /v1/chat/completions` (`system`은 첫 메시지) | `Authorization: Bearer 키` |
| `litellm` | LiteLLM | `GET /v1/models`, 그 경로가 없으면(404) `GET /model/info` | openai와 같다 | openai와 같다 |
| `anthropic` | Claude 호환 | `GET /v1/models?limit=1000` | `POST /v1/messages` (`system`은 따로, `max_tokens` 필수, 없으면 1024) | `x-api-key: 키`, `anthropic-version: 2023-06-01` |

주소 끝에 `/v1`이 있어도 없어도 된다(`joinUrl`이 겹치지 않게 잇는다). 추가 헤더는 기본 헤더보다 앞선다. 키가 없는 게이트웨이를 위해 키는 선택이다.

## 연결 확인이 하는 일

1. 모델 목록을 읽는다. 되면 끝이다: `ok`, 걸린 시간 `ms`, `modelCount`, 이름 목록(최대 200개), `via: "models"`.
2. 안 되면, **기본 모델 이름이 있을 때만** `max_tokens: 1` 완성 호출 한 번으로 다시 확인한다. 되면 `via: "completion"`("짧은 호출로 확인했어요").
3. 서버가 밖으로 나가지 못하는 것(`network`), 시간 초과, 이름을 못 찾는 주소(DNS)는 둘째 요청으로 달라지지 않으므로 거기서 멈춘다.

실패 이유는 `address`(주소를 못 찾음, 또는 404), `network`, `auth`(401·403), `timeout`, `no-models`, `rate`(429), `server`(5xx), `other`다. 문장은 우리가 쓴 것이고 상대가 돌려준 글을 옮기지 않는다. 결과와 시각이 기록에 남아 카드에 나온다.

## 키와 헤더 값

- 서버의 **비밀 상자**(연결 화면의 토큰과 같은 `SecretBox`, AES-256-GCM)로 봉인해 저장한다. 평문은 어디에도 없다. 남는 것은 키의 마지막 네 글자(8자 미만이면 그것도 없다).
- 어느 응답에도 키·헤더 값이 없다. 보이는 것은 `hasKey`, `keyHint`(`…ab12`), 헤더 이름들이다.
- 고칠 때 키 칸을 비워 두면 기존 키가 남는다. 지우려면 `clearKey`. 헤더는 `value`가 없는 줄이 기존 값을 유지한다.
- 이 기능은 로그를 쓰지 않는다. 오류가 나도 키나 헤더 값이 서버 로그·콘솔·응답에 나오지 않는다(시험이 확인한다).

## 한계 (화면도 그렇게 말한다)

- **쓰는 곳: 이끼** ([REQ-103](moss.md), [ADR-0124](adr/0124-moss-assistant.md)). 기본 모델 하나가 이끼의 답을 만든다. **기본 모델이 없으면 이끼는 꺼져 있어요**([ADR-0125](adr/0125-moss-requires-model.md)): 화면에는 설정으로 오는 알약만 남고, 모델을 더하거나 기본으로 정하면 바로 깨어난다. 모델 이름은 등록값, 마지막 연결 확인이 본 첫 이름, API 목록의 첫 이름 순으로 정한다. 카드 밑에 "쓰는 곳: 이끼 — 기본 모델이 이끼의 답을 만들어요. 작은 모델이면 이끼의 답이 거칠 수 있어요."가 있다.
- 연결 확인은 **서버에서 바깥 주소로** 나간다. 서버가 외부로 나갈 수 없는 환경이면 "서버가 이 주소로 나가지 못했어요"라고 한다.
- 스트리밍과 툴 호출은 하지 않는다. 한 번 묻고 한 번 받는다.
- 토큰·비용 한도는 없다. 이끼는 답 하나에 `max_tokens` 700으로 부르고, 한도는 쓰는 기능이 더 붙을 때 정한다.
- 기본 모델이 하나다. 기능마다 다른 모델을 고르는 것은 없다.
