---
title: 하네스 프로토콜 (terrarium.harness/1)
kind: spec
status: active
last_verified: 2026-11-11
covers:
  - apps/server/src/adapters/harness/http.ts
covers_hash: a9990aeea3947fb7
verification_log:
  - "2026-11-04: 2026-11-04: ADR-0073. 연결 오류 문장이 '닿을 수 없어요'에서 '연결할 수 없어요'로 바뀐 것에 맞춰 글을 고쳤다. 프로토콜은 그대로"
  - "2026-11-05: ADR-0085: 트레이스를 쌓는 곳이 연결마다 정해진다는 문장을 더했다. 덮는 코드의 동작은 그대로"
  - "2026-11-06: 2f: MCP 주소가 둘(실행·슬롯)이라는 절을 더하고 harness meta의 mcpSlot과 대조했다 (베타 피드백 14)"
  - "2026-11-06: POST /runs의 operation 필드 설명을 더하고 http.ts와 대조했다 (REQ-090)"
  - "2026-11-11: REQ-118 시드당 반복: 실행 키(시드·반복), 시드 단위 통계, 순위 조건(시드 3개), 한도 60, 화면 반영을 코드와 대조해 고쳤다. 이 문서의 나머지는 그대로 맞다"
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
{ "agents": [{ "id": "react-gpt", "name": "ReAct + 모델 A", "description": "...", "model": "model-a" }] }
```

### `POST /runs` — 실행 시작
```json
{
  "protocol": "terrarium.harness/1",
  "runId": "r-01J...",
  "agentId": "react-gpt",
  "seed": 1,
  "repeat": 1,
  "prompt": "hall-1의 서버들이 과열 경보를 낸다. 원인을 찾아라 ...",
  "limits": { "maxToolCalls": 40, "timeLimitSeconds": 1800 },
  "tools": { "mcpUrl": "https://terrarium/mcp/runs/r-01J.../<토큰>", "specs": [{ "name": "list_alarms", "...": "..." }] },
  "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```
- 2xx로 바로 답하고, 에이전트는 비동기로 돌린다.
- **`repeat`**(선택, 1부터): 같은 시드를 몇 번째로 돌리는지다([ADR-0158](adr/0158-repeats-per-seed-and-seed-level-statistics.md)). 세계의 우연은 `seed`만 따르므로 같은 `seed`의 실행은 `repeat`가 달라도 같은 세계 흐름에서 시작한다. 시드당 반복이 없는 실험은 `repeat`가 늘 1이다. 모르는 하네스는 이 필드를 무시해도 된다(선택 필드라 예전 하네스는 그대로 돈다). 명령 연결은 환경 변수 `TERRARIUM_REPEAT`와 `{{repeat}}`, LangGraph는 `terrarium_repeat`로 받는다.
- **운영 모드**(ADR-0094)면 `"operation": {"hours": 8}`이 더해진다. 이 실행은 진단을 내고 끝나지 않고 `hours` 동안(실시간이면 실제로 그만큼) 이어진다. `limits.timeLimitSeconds`가 그 시간이다. 에이전트는 `events_since`·`wait`로 계속 지켜보다가 테라리움이 끝내면(마지막 호출이 "실행이 끝났다"를 돌려준다) 멈춘다. 몇 시간짜리 요청을 받을 수 있게 프록시와 게이트웨이의 시간 제한을 먼저 확인하고, 상세는 [운영 에이전트 설계 가이드](../guides/operation-agent-guide.md)에 있다.
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

## MCP 주소는 둘이다

에이전트가 테라리움의 툴을 부르는 길은 MCP 주소 하나인데, 그 주소가 어디서 오느냐가 둘로 갈린다. 화면(연결 카드, 실험 만들기 2단계)은 연결마다 어느 쪽인지 말한다.

| | 실행 주소 | 슬롯 주소 |
|---|---|---|
| 모양 | `/mcp/runs/<runId>/<토큰>` | `/mcp/slots/<슬롯>/<토큰>` |
| 누가 만드나 | 테라리움이 **실행을 시작할 때마다** 새로 만들어 `POST /runs`의 `tools.mcpUrl`(또는 하네스의 MCP 등록 API)로 넘긴다 | 연결마다 **하나로 고정**. 연결을 만들면 정해지고 `ConnectionView.mcpSlotUrl`로 보인다 |
| 사람이 할 일 | **등록할 것이 없다** | 하네스 설정에 **한 번** 등록한다 |
| 쓰는 하네스 | 하네스 프로토콜, OpenCode, LangGraph, GoClaw(테라리움이 실행마다 GoClaw의 MCP 서버로 등록하고 끝나면 지운다) | 툴 주소를 설정 파일에서만 읽는 하네스: Hermes |
| 안에 든 툴 | 그 실행에서 고른 툴만. 다른 실행의 툴은 못 부른다 | 실행이 없을 때는 툴 목록만 보이고, 그 연결의 실행이 도는 동안은 그 실행의 세계로 이어진다. 슬롯 하나는 실행 하나라서 같은 연결의 실행은 차례로 돈다 |

하네스가 `mcpSlot`을 가지고 있으면 슬롯형이다(`HarnessInfo.mcpSlot`, `GET /api/meta`의 하네스에도 실린다). 슬롯형인 연결로 실험을 만들 때는 화면이 "슬롯 주소를 한 번 등록했는지"를 먼저 묻고, 확인하기 전에는 실험 시작이 막힌다. 등록했다는 표시는 **이 브라우저**에만 있고, 하네스가 실제로 툴 목록을 읽어 갔는지는 서버가 기록하지 않아서 "연결 확인"은 하네스에 닿는지만 본다.

## 시간

기본 시간 정책(lockstep)에서는 툴 호출 한 번이 시뮬레이션 30초다. 하네스가 생각하는 시간은 세계 시간에 영향이 없다. 그래서 느린 모델과
빠른 모델이 같은 세계를 본다. 실시간 정책(realtime)을 고른 실험에서는 벽시계에 맞춰 세계가 흘러간다.
