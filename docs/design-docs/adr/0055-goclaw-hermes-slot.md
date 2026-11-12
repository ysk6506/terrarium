---
title: ADR-0055 GoClaw와 Hermes는 공식 소스를 읽고 만든 전용 연결로 붙이고, 설정 파일로만 도구를 받는 하네스에는 고정 도구 주소를 준다
kind: decision
status: active
enforced_by:
  - apps/server/src/adapters/connectors/goclaw.test.ts
  - apps/server/src/adapters/connectors/hermes.test.ts
  - apps/server/src/mcp/gateway-slot.test.ts
  - apps/server/src/runtime/connections.test.ts
amends_tests:
  - apps/server/src/adapters/connectors/connectors.test.ts::=MINIMAL
  - apps/server/src/adapters/connectors/connectors.test.ts::what every connector must be, so the screen and the server need not know it [REQ-051] > each kind is unique and the order is: harness products, generic, own protocol, built in
  - apps/server/src/runtime/connections.test.ts::the connections people register, and the ones the config file names [REQ-051] > a harness from the config file keeps its settings for display, and ports of any kind are listed
test_change_reason: 연결 종류가 둘(goclaw, hermes) 늘어서, 종류와 순서를 확인하는 두 시험의 기대 목록에 새 종류를 넣었다. 확인하는 규칙은 그대로다.
decision_hash: 8200e031c74f60df
---
# ADR-0055 GoClaw·Hermes 연결과 고정 도구 주소

## 맥락
ADR-0042는 하네스를 연결(connector)로 붙인다고 정했고 OpenCode, LangGraph, OpenClaw의 전용 연결을 만들었다. GoClaw와 Hermes Agent는 범용 HTTP/MCP 연결로 붙이면 두 가지가 맞지 않는다.
- **도구를 받는 길이 다르다.** 지금까지 하네스는 실행을 시작할 때 "이 실행의 도구 주소"를 받았다. GoClaw는 관리자가 등록한 MCP 서버만 쓰고, Hermes는 요청마다가 아니라 설정 파일(`mcp_servers`)에서만 읽는다.
- **멈추는 길이 다르다.** 끝낼 때와 사용자가 중지할 때 하네스에서 무엇을 정리해야 하는지가 하네스마다 다르다.

## 결정
1. **GoClaw 전용 연결** (`connectors/goclaw.ts`). 에이전트 목록은 `GET /v1/agents`. 한 번의 실행은 이렇게 한다: 이 실행의 도구 주소를 MCP 서버로 등록(`POST /v1/mcp/servers`) → 고른 에이전트에 허용(`.../grants/agent`) → 질문(`POST /v1/chat/completions`, 모델 `goclaw:<agent>`) → 허용과 서버를 거둔다(오류, 중지여도 `finally`). 요청 자체가 실행이라서 연결을 끊으면 멈춘다(HTTP로 멈추는 호출은 없다).
2. **허용은 에이전트 단위이므로 한 에이전트의 실행은 한 번에 하나**(`KeyedQueue`). 서로 다른 에이전트는 동시에 돈다.
3. **Hermes 전용 연결** (`connectors/hermes.ts`). `POST /v1/runs`로 시작하고, `GET /v1/runs/{id}`로 `pollSeconds`마다 살피고, 중지는 `POST /v1/runs/{id}/stop`. 다섯 번 잇따라 상태를 못 읽으면 오류. 사람의 승인을 기다리면 오류로 끝내고 이유를 알린다.
4. **고정 도구 주소(slot)**. 설정 파일로만 도구를 받는 하네스(`HarnessInfo.mcpSlot`)에는 `/mcp/slots/<slot>/<토큰>`을 준다. 토큰은 비밀 상자에서 `derive`한 값이라 서버를 다시 띄워도 같다. 이 주소는 평소에 도구 목록만 보여 주고(호출은 "돌고 있는 실험이 없어요"), 그 연결의 실행이 도는 동안에는 그 실행의 세계로 이어진다. 연결 카드가 이 주소와 복사 버튼을 보여 준다.
5. **한 고정 주소는 한 실행만 뜻할 수 있으므로 그 연결의 실험은 차례로 돈다.** 동시에 많이 돌리려면 하네스를 여러 개 두고 연결을 따로 만든다(toolGuide에 적었다).

## 이유
- 하네스가 받는 방식에 맞춘다. 우리 쪽을 하네스마다 모양을 바꿀 수는 있어도, 하네스 쪽을 우리에게 맞추라고 할 수는 없다.
- 거두기를 `finally`에 두어 실패와 중지에도 GoClaw에 남는 것이 없게 한다.

## 버린 대안
- Hermes를 범용 MCP 연결로만 쓰기: 도구 주소를 실행마다 받을 길이 없다.
- Hermes 설정 파일을 실행마다 고쳐 쓰기: 하네스 쪽 파일을 건드린다.
- 고정 주소로 여러 실행을 동시에 받기: 어느 실행의 호출인지 가를 단서가 요청에 없다.

## 한계 (솔직하게)
- 두 연결은 GoClaw·Hermes의 소스와 문서를 읽고 만들었고, 가짜 서버로 시험했다. **실제 GoClaw·Hermes에 붙여 끝까지 돌려 보지는 않았다.** 그 시험은 따로 둔다(하네스 실제 실행 과제).
- GoClaw는 사설망 주소의 MCP 서버를 기본으로 막는다. 사설망에서 쓰려면 GoClaw 쪽 허용 호스트 설정이 필요하다.
