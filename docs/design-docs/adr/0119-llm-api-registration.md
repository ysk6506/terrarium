---
title: ADR-0119 LLM API 등록 — 워크스페이스 단위 모델 연결, 키는 서버에만, 얇은 클라이언트
kind: decision
status: active
last_verified: 2026-11-06
enforced_by:
  - packages/core/src/llm/llm.test.ts
  - apps/server/src/http/models-api.test.ts
  - apps/web/src/logic/models.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/architecture.yaml
decision_hash: d720f1d0f8374e64
---
# ADR-0119 LLM API 등록 — 워크스페이스 단위 모델 연결, 키는 서버에만, 얇은 클라이언트

## 맥락
연수 님(2026-11-06): "테라리움에 LLM API 등록할 수 있게 해줘. LiteLLM, OpenAI, Claude 호환 API. 나중에 실험 결과 해석이나 사용자 가이드 용으로 쓸 건데 일단 등록할 수 있게만 먼저." 그래서 이번에는 **등록 + 연결 확인 + 얇은 클라이언트**까지만 한다. 모델을 쓰는 기능은 아직 없고, 화면이 그렇게 정직하게 말한다.

## 결정
1. **모델 연결은 워크스페이스 단위다.** 에이전트·MCP 연결은 실험이 고르는 것이지만, 모델은 워크스페이스가 나중에 결과 해석과 안내에 쓴다. 설정 화면에 "모델" 구역이 생기고 등록한 모델이 카드로 나온다 + "모델 더하기". 빈 상태: "아직 등록한 모델이 없어요. 등록해 두면 나중에 결과 해석과 안내에 써요." 목록은 모두에게 같고, 고치기·지우기는 등록한 사람만, 연결 확인과 기본 정하기는 누구나 한다.
2. **종류는 셋.** `litellm`, `openai`(OpenAI 호환: `/v1/chat/completions`, `/v1/models`, `Authorization: Bearer`), `anthropic`(Claude 호환: `/v1/messages`, `/v1/models`, `x-api-key`, `anthropic-version: 2023-06-01`). LiteLLM은 OpenAI 호환 프로토콜이지만 별도 종류로 두어 카드에 "LiteLLM" 라벨을 달고, 모델 목록을 `/v1/models`로 읽다가 그 경로가 없으면(404) `/model/info`로 읽는다(키 거부·서버 닿지 않음은 둘째 경로도 같을 테니 거기서 멈춘다). 입력은 이름(표시용, 같은 이름은 둘 못 둔다), 주소(base URL, 끝의 `/v1`은 있어도 없어도 된다), 키(선택), 기본 모델 이름(선택 — 연결 확인 뒤 목록에서 고를 수 있다), 추가 헤더(선택, 사내 게이트웨이용 이름·값 여러 개, 최대 10개). 주소는 연결 화면과 같은 규칙(http·https만, 클라우드 메타데이터 주소 거부, 서버가 `allowedHosts`를 정했으면 그 안)으로 본다.
3. **연결 확인.** "연결 확인" → 서버가 모델 목록을 읽고(`GET /v1/models`, anthropic도 같다), **실패하면 기본 모델 이름이 있을 때** `max_tokens: 1` 완성 호출 한 번으로 다시 확인한다. 서버가 밖으로 나가지 못하는 것(`network`)과 시간 초과(`timeout`)는 두 번째 요청으로 달라지지 않으므로 거기서 멈춘다. 결과는 "답했어요 · 412ms · 모델 23개"(한 토큰 호출이 답했으면 "짧은 호출로 확인했어요") 또는 정직한 실패 이유: 주소를 못 찾음/경로 없음(404), 키 거부(401·403), 시간 초과(15초), 모델 목록 없음, 요청 많음(429), 상대 서버 오류(5xx), 서버가 이 주소로 나가지 못함. 실패 문장은 **우리가 쓴 말**이고 상대가 돌려준 본문이나 던진 오류의 글을 옮기지 않는다(키가 섞여 나올 수 있다). 확인 결과와 시각은 기록에 남아 카드에 나온다. 주소·키·헤더를 고치면 옛 것을 확인한 결과이므로 지운다.
4. **키는 서버에만.** 서버 저장소(기존 `ExperimentStore` 포트와 SQLite `llm_models` 표)에 두고, 키와 헤더 값은 연결 화면의 토큰과 같은 **비밀 상자(AES-256-GCM)**로 봉인해서 둔다. 평문으로 남는 것은 마지막 네 글자뿐이고(8자 미만 키는 그것도 남기지 않는다), API 응답과 화면에는 `…ab12`와 헤더 이름만 나온다. 고칠 때 키 칸을 비워 두면 기존 키가 남고, 지우려면 `clearKey`를 따로 보낸다. 헤더는 `value` 없는 줄이 기존 값을 유지한다. 서버는 이 기능에서 아무 것도 로그로 쓰지 않으며, 키가 응답·서버 로그·콘솔·저장 파일에 평문으로 나오지 않는지 시험이 확인한다.
5. **기본 모델은 하나.** 여러 개를 등록할 수 있고 하나가 "기본"이다. 첫 등록이 기본이 되고, "기본으로"로 바꾼다. 기본을 지우면 가장 먼저 등록한 것이 기본이 된다(지우기 확인 문장이 그렇게 말한다). 나중에 쓰는 기능(결과 해석·안내)은 기본 모델을 쓴다.
6. **얇은 클라이언트.** 새 단위 `core.llm`(`packages/core/src/llm/`, 다른 단위를 가져오지 않는다)에 `LlmClient { listModels(): Promise<string[]>, complete({model?, system?, messages, maxTokens?}): Promise<{text, usage?}> }`와 어댑터 둘(`openai-compatible.ts` — litellm도 이것을 쓴다, `anthropic-compatible.ts`)을 둔다. `fetch`를 주입할 수 있어 시험이 실제 서버에 닿지 않는다. 오류는 `LlmError`(이유 `address·network·auth·timeout·no-models·rate·server·other`)로 통일한다. 연결 확인의 순서(`checkLlm`)도 여기 있고 시계를 받는다(core는 벽에 걸린 시계를 읽지 않는다). **스트리밍과 툴 호출은 지금 하지 않는다.**
7. **정직한 한계.** 설정의 목록 아래 한 줄: "아직 쓰는 곳은 없어요 — 결과 해석과 안내가 생기면 기본 모델을 써요." 연결 확인은 **서버에서 바깥 주소로** 나가므로, 서버가 외부로 나갈 수 없는 환경(방화벽·프록시)이면 "서버가 이 주소로 나가지 못했어요" 라고 그렇게 말한다.

## 결과
- 경로 여섯: `GET/POST /api/models`, `PATCH/DELETE /api/models/:id`, `POST /api/models/:id/check`, `POST /api/models/:id/default`. 계약은 `contract/models.ts`·`model-routes.ts`(routes.ts가 500줄을 넘지 않게 펼쳐 넣는다). `PATCH` 메서드가 계약 표에 처음 생긴다.
- `harness/config/architecture.yaml`에 단위 `core.llm`을 더하고 `core.contract`가 가져올 수 있게 했다(종류 목록·실패 이유 타입을 계약과 나눠 쓴다). 새 외부 패키지는 없다.
- 저장소 포트에 `putModel·getModel·listModels·deleteModel`이 늘고 메모리·SQLite 두 구현이 따른다. 기존 표는 건드리지 않는다.
- 쓰는 기능이 붙을 때 `LlmClient`를 `createLlmClient(kind, …)`로 만들어 기본 모델의 기록에서 연다. 그때 스트리밍·툴 호출·예산(토큰·비용 한도)을 따로 결정한다.
- REQ-099.
