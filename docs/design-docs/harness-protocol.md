---
title: 하네스 프로토콜 (terrarium.harness/1)
kind: spec
status: active
last_verified: 2026-10-29
covers:
  - apps/server/src/adapters/harness/http.ts
covers_hash: 10b5c6385dde6730
verification_log:
  - "2026-10-29: first version, checked against HttpHarness (start, poll, stop, usage)"
---
# 하네스 프로토콜 `terrarium.harness/1`

외부 하네스를 테라리움에 붙이는 방법이다([ADR-0026](adr/0026-harness-adapters.md)). 하네스 앞에 아래 엔드포인트 넷만 만들면 된다.
테라리움 설정 파일에 `{"kind": "http", "id": "...", "name": "...", "url": "https://하네스", "tokenEnv": "토큰_변수"}`를 넣는다.

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

모든 요청에 `Authorization: Bearer <토큰>`이 붙는다(설정했을 때).

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
- `specs`는 같은 툴의 JSON Schema다. MCP 없이 함수 호출로 넘기고 싶은 하네스가 참고한다.
- `traceparent`를 에이전트의 OpenTelemetry 루트 스팬 부모로 쓰면, ClickStack에서 이 실행의 trace로 묶인다.

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
테라리움은 `pollSeconds`(기본 2초)마다 묻는다. 5번 연속 실패하면 "하네스에 닿을 수 없다"로 실행이 실패한다.

### `DELETE /runs/{runId}` — 중지
사람이 실험을 취소했거나 실행 시간이 다 됐을 때 부른다. 에이전트를 멈추고 2xx(이미 끝났으면 404도 괜찮다). 그 뒤 마지막으로 한 번
상태를 물어 토큰·비용을 받아 간다.

## 시간

기본 시간 정책(lockstep)에서는 툴 호출 한 번이 시뮬레이션 30초다. 하네스가 생각하는 시간은 세계 시간에 영향이 없다. 그래서 느린 모델과
빠른 모델이 같은 세계를 본다. 실시간 정책(realtime)을 고른 실험에서는 벽시계에 맞춰 세계가 흘러간다.
