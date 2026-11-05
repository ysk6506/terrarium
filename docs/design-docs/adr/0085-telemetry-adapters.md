---
title: ADR-0085 텔레메트리는 연결마다 어댑터로 붙이고, 묶는 열쇠는 어댑터가 정한다
kind: decision
status: active
last_verified: 2026-11-05
enforced_by:
  - apps/server/src/adapters/telemetry/telemetry.test.ts
  - apps/server/src/adapters/connectors/honest-agents.test.ts
  - apps/server/src/runtime/connection-traces.test.ts
  - apps/server/src/http/connection-try-api.test.ts
  - apps/web/src/logic/connection-traces.test.ts
  - apps/web/src/logic/connection-presets.test.ts
  - apps/web/src/logic/agent-census.test.ts
  - apps/web/src/logic/try-talk.test.ts
amends_tests:
  - apps/server/src/adapters/adapters.test.ts::<import:b37a6b42>
test_change_reason: ClickStack 읽기 코드를 adapters/clickstack.ts에서 adapters/telemetry/clickstack.ts로 옮겨서, 잠긴 시험 파일의 가져오기 한 줄이 새 경로를 가리킨다. 시험이 재는 것(스팬·로그 변환과 쿼리)은 한 줄도 바뀌지 않았다.
touches_protected:
  - docs/product-specs/requirements.md
decision_hash: 969c6ce0db48ed9b
---
# ADR-0085 텔레메트리는 연결마다 어댑터로 붙이고, 묶는 열쇠는 어댑터가 정한다

## 맥락
클로즈 베타 사용자(피드백 11)가 GoClaw를 연결했더니 "연결됐다"는데 에이전트가 1개뿐이거나 없었다. 원인은 셋이었다.
1. 커넥터가 상태가 `active`가 아닌 에이전트를 조용히 숨기고 있었다. 화면은 숨겼다는 사실도, 몇 개를 왜 숨겼는지도 말하지 않았다.
2. 연결해 놓고도 에이전트가 정말 답하는지 확인할 길이 실험을 돌리는 것밖에 없었다.
3. "범용 HTTP" 연결은 칸이 너무 많아서 어디부터 채울지 알 수 없었다.

텔레메트리도 같은 뿌리였다. 지금은 서버 설정의 `telemetry` 하나(ClickStack)가 모든 하네스의 트레이스 창구이고, 하네스가 `telemetry: "clickstack"`이라고 말해야만 읽는다. 그런데 팀마다 하네스마다 트레이스를 쌓는 곳이 다르다(ClickStack, Langfuse, 없음). 그리고 도구마다 **실행을 찾는 열쇠가 다르다.** ClickStack은 W3C `traceparent`의 트레이스 번호, Langfuse는 세션 ID나 메타데이터, 다른 도구는 태그다. 열쇠가 어긋나면 트레이스는 쌓이는데 우리는 못 찾고, 사용자는 "텔레메트리가 안 돼요"라고만 느낀다.

## 결정
1. **에이전트 목록은 정직하다.** 하네스 포트에 `inventory()`를 더한다: 보여 주는 에이전트, 숨긴 에이전트(이유별 묶음), 아무것도 없으면 그 이유, 알아 둘 점. 연결 검사와 연결 목록이 `census: {shown, total, hidden: [{reason, count}], includesHidden, empty?, notes}`를 돌려준다. 문장은 서버가 아니라 화면이 만든다("에이전트 37개 중 1개가 보여요 · 36개는 상태가 'inactive'라 숨겼어요 · 모두 보기"). 상태 필터는 유지한다(실험에서 쉬는 에이전트를 고르면 답이 없다). 대신 "모두 보기"로 숨긴 것을 목록에 넣을 수 있고(커넥터의 `showHidden` 설정), 숨겼던 에이전트를 고르면 "답하지 않을 수 있어요"를 말한다. GoClaw는 페이지 처리를 따라가고(커서, `has_more`, `total`+`offset`), 같은 쪽을 되풀이하면 멈춘다. OpenCode의 도우미(`hidden`)와 서브에이전트(`subagent`)도 같은 구조로 센다.
2. **말 걸어 보기.** 하네스 포트에 `talk()`을 더한다: 한 턴, 툴 없음, 세계 영향 없음, 채점 없음. 라우트 `POST /api/connections/:id/try`는 에이전트와 한 문장을 받고 `TryResult`(답, 걸린 시간, 모델, 토큰, 툴 호출 수, 트레이스 이어짐)를 돌려준다. 60초 안에 답이 없으면 끊는다. 실패는 상태와 상대의 말 그대로 돌려준다("401 — 토큰이 거절됐어요"). 이 길로는 연결 주인이 아니어도 말을 걸 수 있다(읽기에 가깝고 세계를 바꾸지 않는다). 연결 방식이 `talk`을 못 하면 버튼을 끄고 이유를 버튼에 쓴다.
3. **HTTP API는 프리셋부터.** 커넥터 명세에 `presets`를 더한다. "OpenAI 호환 채팅"(주소·모델·토큰)과 "간단 JSON"(주소 하나; 요청 `{prompt, tools}`, 응답 `{text}`)을 먼저 보여 주고, 나머지 칸은 "고급"에 접는다. 프리셋은 커넥터의 설정으로 풀리는 템플릿일 뿐이라 서버에 새 개념은 없다. 프리셋이 하네스에 거는 약속(보내는 것, 받는 것)을 화면에 한 줄씩 보여 준다.
4. **텔레메트리는 어댑터다.** 코어에 `TelemetryAdapter { kind, name, attach(run), fetch(runId, hint?) }`를 둔다. `attach`는 하네스가 이 실행에서 실어 보내야 할 것(`traceparent`, 헤더, `run_id` 태그, 세션 ID)을 **계산만** 하고, `fetch`는 그 실행의 스팬·로그·토큰을 읽어 온다. 열쇠는 어댑터가 정한다: ClickStack은 `traceparent`의 트레이스 번호(하네스가 자기 번호를 쓰면 스팬의 `run_id` 속성), Langfuse는 세션 ID(`langfuse.session.id`), 그다음 트레이스 번호, 그다음 메타데이터 `run_id`. 새 도구는 `adapters/telemetry/`에 파일 하나와 `TELEMETRY_KINDS`의 한 줄이다. 코어와 실행기는 도구를 모른다.
5. **연결마다 고른다.** 연결 폼에 "이 하네스의 트레이스는 어디에 쌓이나요? 없음 · ClickStack · Langfuse"를 둔다. 값은 연결 기록의 `traces: {kind, config, secrets}`에 저장되고 비밀은 커넥터와 같은 규칙(비워 두면 그대로, 쓰면 바꿈, `null`이면 지움)으로 봉인한다. 설정 파일의 하네스 항목에도 `traces`를 쓸 수 있다. 서버 설정의 전역 `telemetry`는 **기본값으로만** 남는다: 연결이 "서버 기본값"을 고르면 그것을 쓰고, 아무것도 고르지 않은 옛 연결은 옛 규칙(하네스가 `telemetry: "clickstack"`이면 서버 기본값)을 그대로 따른다.
6. **실행은 고른 어댑터로 간다.** 실행기는 연결의 어댑터에서 `attach`를 받아 하네스 요청에 싣고(`traceparent`는 모든 연결 방식에 이미 있는 길로, 나머지는 커넥터가 실을 수 있는 만큼), 결과 화면은 같은 어댑터의 `fetch`로 읽는다. 결과 화면은 어디서 읽었는지 이름을 보여 준다. 읽지 못하면 "Langfuse에 연결할 수 없어요: …"라고 말하고 나머지 분석은 그대로 둔다.
7. **이어졌는지 보여 준다.** 연결 검사는 트레이스 도구가 답하는지 보고(없는 실행을 물어 본다), 말 걸어 보기는 한 턴이 끝나면 어댑터로 그 턴의 `run_id`를 최대 4번(1.5초 간격) 찾아본다. 찾으면 "트레이스 이어짐 ✓"와 스팬 수, 못 찾으면 "안 이어짐 — run_id 태그가 안 보여요"와 하네스에서 확인할 것(traceparent나 run_id를 스팬에 남기는지, 도구가 몇 초 늦게 쌓는지)을 말한다. 트레이스 도구를 정하지 않았으면 그렇게 말한다.

## 이유
- 숨긴 사실을 숨기면 사용자는 "연결이 고장"이라고 읽는다. 이유를 **데이터**로 돌려주면 화면이 정직해지고, 새 커넥터도 같은 구조를 채우기만 하면 된다.
- 실험을 돌려야 연결이 되는지 아는 것은 너무 비싸다. 한 문장을 보내 보는 것이 가장 짧은 확인이고, 같은 순간에 트레이스 열쇠도 확인할 수 있다.
- 열쇠는 도구의 성질이라 도구 옆에 있어야 한다. 실행기가 열쇠를 알면 도구 하나를 더할 때마다 실행기를 고쳐야 한다.
- 전역 설정 하나로는 한 서버에 여러 팀의 하네스가 붙는 현실을 못 담는다.

## 버린 대안
- **GoClaw 필터를 풀어 전부 보여 주기**: 쉬는 에이전트를 실험에서 골라 놓고 아무 답이 없는 일이 생긴다. 숨기되 말하고, 보려면 누른다.
- **커넥터마다 "말 걸어 보기"를 화면에서 따로 만들기**: 화면이 프로토콜을 알게 된다. 포트의 `talk()` 하나가 프로토콜을 가린다.
- **트레이스를 항상 `traceparent`로만 찾기**: ClickStack에는 맞지만 Langfuse는 세션 ID로 묶는 것이 보통이고, 트레이스 번호를 하네스가 새로 만드는 경우도 있다. 한 열쇠에 맞추면 다른 쪽이 조용히 비어 버린다.
- **텔레메트리 어댑터를 커넥터 안에 두기**: 같은 하네스가 팀에 따라 ClickStack에도 Langfuse에도 쌓인다. 하네스 종류와 트레이스 도구는 따로 고르는 것이다.
- **프리셋을 서버에 새 연결 종류로 만들기**: 프리셋은 기존 커넥터의 설정 모음일 뿐이다. 종류를 늘리면 저장된 연결과 검사 경로가 둘이 된다.

## 결과
- 요구사항 REQ-079가 적힌다. 새 시험은 `telemetry.test.ts`(어댑터 `attach`·`fetch`와 Langfuse 응답 읽기), `honest-agents.test.ts`(GoClaw 37개 중 1개, 페이지 처리, 말 걸어 보기, 프리셋), `connection-traces.test.ts`(저장·비밀·`try` 라우트·실행 연결), 웹 쪽 `agent-census`·`connection-presets`·`connection-traces`·`try-talk` 시험이다.
- 고쳐진 시험: `adapters.test.ts`는 ClickStack을 가져오는 경로 한 줄만 바뀌었다.
- GoClaw `GET /v1/agents`의 응답 모양과 페이지 처리는 공식 문서(`reference/rest-api.md`)에 적혀 있지 않다("List all agents."). 그래서 `{"agents": [...]}` 한 덩어리를 기본으로 읽고, 커서·`has_more`·`total`+`offset`이 오면 따라가며, 같은 쪽이 되풀이되면 멈춘다. 실제 GoClaw로 확인한 것이 아니다.
- Langfuse는 공개 API 문서(`GET /api/public/v2/observations`: `sessionId`·`traceId`·`filter`, `meta.cursor`, `usage`·`model` 필드 묶음)와 OpenTelemetry 속성 표(`langfuse.session.id`, `langfuse.trace.metadata.*`, `gen_ai.usage.*`, `gen_ai.usage.cost`)를 읽고 만들었다. v2는 Cloud와 자체 호스팅 v4에 있고 자체 호스팅 v3은 옛 경로(`/api/public/traces`)만 있어서, 404이면 옛 경로로 간다. 문서가 들어오는 `traceparent`를 트레이스 번호로 쓰는지 말하지 않아서 세션 ID와 메타데이터를 먼저 쓴다. 실제 Langfuse로 확인한 것이 아니다.
- 한계: 말 걸어 보기는 툴 없이 한 턴만 본다. 툴을 쓰는 에이전트가 실험에서 어떻게 움직일지는 알려 주지 않는다.
- 한계: 트레이스 확인은 도구가 몇 초 늦게 쌓으면 "안 이어짐"으로 잘못 말할 수 있다. 그래서 4번 찾아보고, 안내 문장에 "잠시 뒤 다시"를 적는다.
