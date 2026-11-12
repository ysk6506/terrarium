---
title: 모델 등록 — LLM API를 워크스페이스에 등록하고 연결 확인까지
kind: spec
status: active
last_verified: 2026-11-12
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
covers_hash: 58a5757279a92ecb
verification_log:
  - "2026-11-11: step 가 (ADR-0174): identity and policy; statements checked against the code"
  - "2026-11-11: step 나 (ADR-0174): visibility scopes; statements checked against runtime/permissions.ts, gate.ts, scoping.ts and the stores"
  - "2026-11-12: step 나 review fixes (ADR-0179): default model is a model made for everyone, one scope route for five kinds; statements checked against the code"
  - "2026-11-12: main을 합친 뒤 공개 범위(ADR-0174 나 단계, ADR-0179)에서 더한 서술을 합쳐진 코드와 대조했고, 바뀐 화면 글(ADR-0183)과 옛 말이 없음을 확인했다"
  - "2026-11-12: runtime/models.ts의 바뀐 곳은 mustSee 호출에 감사용 대상 이름을 넘기는 것뿐이고 등록·기본 모델·이름 유일성 서술은 코드와 그대로 맞다 (ADR-0193)"
verified_body: a3d779c952220842
unchanged_reverifies: 1
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

## 공개 범위 (ADR-0174 나 단계)

- 등록한 모델은 처음에 **나만**이에요(`scope`, `group`을 만들 때 적고, 바꿀 때는 `PUT /api/models/:id/scope`예요). 목록에는 내게 보이는 것만 나오고, 보이지 않는 것을 확인·고치기·지우기 하면 404예요. 응답의 `sharing`에 범위와 내가 바꿀 수 있는지가 있어요.
- **모두의 기본 모델은 범위가 "모두"인 모델만 될 수 있어요**(관리자와 그 모델의 주인이 `POST /api/models/:id/default`로 정해요). "나만"·"우리 파트" 모델은 기본으로 정할 수 없고, 기본의 범위를 좁히는 것도 거절해요. 저절로 기본이 되는 건 "모두" 모델이 처음 생길 때뿐이고, 기본을 지우면 먼저 등록된 "모두" 모델로 넘어가요. 한 사람에게 보이는 기본은 모두의 기본, 없으면 그 사람이 볼 수 있는 모델 중 먼저 등록된 것이라 모델 하나를 혼자 쓰는 개발 모드는 그대로예요. 이끼는 이 함수(`defaultFor`)로 모델을 골라요.
- **이름은 만든 사람 안에서, 그리고 "모두"로 만든 등록 사이에서만 유일해요.** 남의 "나만" 모델과는 견주지 않아서 같은 이름의 충돌로 그 모델이 있다는 사실이 새지 않아요. 모델은 ID로 가리켜요.
- 범위가 없는 예전 등록은 "모두"로 읽어요. 자세한 규칙은 [권한](permissions.md).
