---
title: 하네스 프로토콜 (terrarium.harness/1)
kind: spec
status: active
last_verified: 2026-11-05
covers:
  - apps/server/src/adapters/harness/http.ts
covers_hash: addb8d1583b2a90e
verification_log:
  - "2026-10-29: first version, checked against HttpHarness (start, poll, stop, usage)"
  - "2026-10-30: 2026-10-30: http.ts의 설정 타입 위치와 ADR 번호만 바뀌었다. 엔드포인트와 필드는 코드와 같다. 화면 연결, 직접 입력한 토큰, 커스텀 헤더 안내를 더했다"
  - "2026-11-03: 서버·core가 사람에게 돌려주는 안내 문장이 해요체로 바뀐 것만 확인했다. 동작과 본문은 그대로 (ADR-0050)"
  - "2026-11-04: 2026-11-04: ADR-0073. 연결 오류 문장이 '닿을 수 없어요'에서 '연결할 수 없어요'로 바뀐 것에 맞춰 글을 고쳤다. 프로토콜은 그대로"
  - "2026-11-05: ADR-0085: 트레이스를 쌓는 곳이 연결마다 정해진다는 문장을 더했다. 덮는 코드의 동작은 그대로"
---
# 하네스 프로토콜 `terrarium.harness/1`

외부 하네스를 테라리움에 붙이는 방법의 하나다(연결 방식 `http`, [ADR-0042](adr/0042-connectors.md)). 하네스 앞에 아래 엔드포인트 넷만 만들면 된다.
화면의 "연결"에서 방식 `http`를 고르고 주소와 토큰(직접 입력하거나 서버의 환경 변수 이름)을 적는다. 커스텀 헤더가 필요하면 헤더 칸에 더한다. 파일로 하려면 테라리움 설정 파일에
`{"kind": "http", "id": "...", "name": "...", "url": "https://하네스", "tokenEnv": "토큰_변수"}`를 넣는다. 하네스 프로토콜이 아닌 에이전트(A2A, 평범한 HTTP API, MCP 서버의 툴 …)는 다른 연결 방식으로 붙인다.

## 큰 그림

```
테라리움                                하네스
  │  POST /runs  {runId, prompt, tools.mcpUrl, ...}  ─►  에이전트 시작
  │                                                       │
  │  ◄── MCP (tools/list, tools/call) ─────────────────  에이전트가 툴 호출
  │                                                       │
  │  GET /runs/{runId}  ─►  {"status": "running"}         │
  │  GET /runs/{runId}  ─►  {"status": "finished", usage} 끝
```

에이전트가 세계를 보고 바꾸는 길은 **MCP 툴뿐**이다(REQ-008). 에이전트가 `submit_diagnosis`를 부르면 그 실행의 과제는 끝나고,
이후 툴 호출은 "실행이 끝났다" 오류를 받는다.

## 엔드포인트

모든 요청에 `Authorization: Bearer <토큰>`이 붙는다(설정했을 때). 연결에 커스텀 헤더를 적었다면 그것도 모든 요청에 붙고, 같은 이름이면 사람이 적은 값이 우선한다.

### `GET /agents`
```json
{ "agents": [{ "id": "react-gpt", "name": "ReAct + 사내 모델", "description": "...", "model": "gauss-2" }] }
```

### `POST /runs` — 실행 시작
```json
{
  "protocol": "terrarium.harness/1",
  "runId": "r-01J...",
  "agentId": "react-gpt",
  "seed": 1,
  "prompt": "hall-1의 서버들이 과열 경보를 낸다. 원인을 찾아라 ...",
  "limits": { "maxToolCalls": 40, "timeLimitSeconds": 1800 },
  "tools": { "mcpUrl": "https://terrarium/mcp/runs/r-01J.../<토큰>", "specs": [{ "name": "list_alarms", "...": "..." }] },
  "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```
- 2xx로 바로 답하고, 에이전트는 비동기로 돌린다.
- `tools.mcpUrl`은 Streamable HTTP MCP 엔드포인트다. 이 실행에서 고른 툴만 있고, URL 자체가 비밀이다(다른 실행의 툴은 부를 수 없다).
- 툴의 `description`은 모든 툴이 같은 순서로 쓴다(ADR-0087): 한 줄 요약, `Use when:`, `Don't use when:`(대신 쓸 툴을 `(use X)`로), `Example:`(입력 예 하나), `Access:`(`read-only` 또는 `changes the world`), `Cost:`. 에이전트가 읽는 이 글은 테라리움 카탈로그의 `TOOL_DOCS`에서 만들어서 화면과 같다([툴 범위, 에스컬레이션, 절차서](tool-scope-and-sop.md)).
- 실험이 `ask_human`을 켰다면 에이전트는 이 툴로 사람에게 묻는다(`request`: 찾은 것, 해 본 것, 필요한 것). **응답이 늦을 수 있다.** 실험이 "사람 기다림"이면 사람이 답할 때까지 호출이 열려 있다. 하네스는 이 툴 호출에 시간 제한을 걸지 말아야 한다(테라리움의 실제 시간 제한은 기다린 시간을 빼고 센다). 답은 `{reply, from}`이고, 사람이 대신 조치했으면 `changes`, 툴을 더 줬으면 `newTools`가 같이 온다. MCP로 붙은 하네스는 `tools/list`를 다시 부르면 늘어난 툴이 보인다.
- `specs`는 같은 툴의 JSON Schema다. MCP 없이 함수 호출로 넘기고 싶은 하네스가 참고한다.
- `traceparent`를 에이전트의 OpenTelemetry 루트 스팬 부모로 쓰면, 연결이 ClickStack을 고른 경우 이 실행의 trace로 묶인다. 연결이 Langfuse를 고르면 같은 요청의 `x-terrarium-run-id` 헤더와 `baggage`의 `run_id`를 세션 ID(`langfuse.session.id`)나 메타데이터(`langfuse.trace.metadata.run_id`)로 남기면 찾는다([ADR-0085](adr/0085-telemetry-adapters.md)). 트레이스를 어디에 쌓는지는 연결마다 정한다.

### `GET /runs/{runId}` — 상태
```json
{
  "status": "running | finished | error | cancelled",
  "message": "선택: 사람이 읽을 한 줄",
  "traceId": "선택: traceparent를 쓰지 않았다면 자기 trace id",
  "usage": { "inputTokens": 12000, "outputTokens": 900, "costUsd": 0.04 },
  "wallSeconds": 73
}
```
테라리움은 `pollSeconds`(기본 2초)마다 묻는다. 5번 연속 실패하면 "하네스에 연결할 수 없어요"로 실행이 실패한다.

### `DELETE /runs/{runId}` — 중지
사람이 실험을 취소했거나 실행 시간이 다 됐을 때 부른다. 에이전트를 멈추고 2xx(이미 끝났으면 404도 괜찮다). 그 뒤 마지막으로 한 번
상태를 물어 토큰·비용을 받아 간다.

## 시간

기본 시간 정책(lockstep)에서는 툴 호출 한 번이 시뮬레이션 30초다. 하네스가 생각하는 시간은 세계 시간에 영향이 없다. 그래서 느린 모델과
빠른 모델이 같은 세계를 본다. 실시간 정책(realtime)을 고른 실험에서는 벽시계에 맞춰 세계가 흘러간다.
