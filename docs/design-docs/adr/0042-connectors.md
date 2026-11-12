---
title: ADR-0042 하네스·에이전트 연결은 커넥터 플러그인과 연결 레지스트리로 한다
kind: decision
status: active
enforced_by:
  - apps/server/src/adapters/connectors/connectors.test.ts
  - apps/server/src/adapters/connectors/a2a.test.ts
  - apps/server/src/adapters/connectors/mcp-agent.test.ts
  - apps/server/src/adapters/connectors/openclaw.test.ts
  - apps/server/src/runtime/connections.test.ts
  - apps/server/src/runtime/metadata.test.ts
  - apps/server/src/http/connections-api.test.ts
touches_protected:
  - docs/product-specs/requirements.md
  - harness/config/architecture.yaml
  - docs/design-docs/adr/0026-harness-adapters.md
supersedes: 0026-harness-adapters.md
amends_tests:
  - apps/server/src/adapters/adapters.test.ts::server configuration [REQ-031] [REQ-037] > a file with every kind of connection; relative paths follow the file
  - apps/server/src/adapters/adapters.test.ts::server configuration [REQ-031] [REQ-037] > adapters are built from the config; the sample graph is always there
  - apps/server/src/adapters/test-support/fake-fetch.ts::=FakeFetch
  - apps/server/src/runtime/test-support/platform.ts::=testPlatform
  - apps/server/src/adapters/adapters.test.ts::<import:d5ed7b04>
  - apps/server/src/adapters/harness.test.ts::<import:a93cd629>
  - apps/server/src/adapters/harness.test.ts::=openaiConfig
  - apps/server/src/adapters/harness.test.ts::=reply
  - apps/server/src/adapters/harness.test.ts::=toolCall
  - apps/server/src/adapters/harness.test.ts::an OpenAI-compatible model as a harness [REQ-031] > <suite>
  - apps/server/src/adapters/harness.test.ts::an OpenAI-compatible model as a harness [REQ-031] > a model that stops talking, runs out of turns, or errors is reported as such
  - apps/server/src/adapters/harness.test.ts::an OpenAI-compatible model as a harness [REQ-031] > cancelling stops the loop
  - apps/server/src/adapters/harness.test.ts::an OpenAI-compatible model as a harness [REQ-031] > the model calls tools as functions until it submits; tokens are counted
  - apps/server/src/adapters/harness.test.ts::an OpenAI-compatible model as a harness [REQ-031] > tool replies are JSON the model can read, cut when huge
  - apps/server/src/adapters/test-support/fake-fetch.ts::<import:28b66704>
test_change_reason: OpenAI 호환 내장 루프를 없애서 그 테스트와 도우미(openaiConfig, reply, toolCall)가 사라졌고, 설정 파일 시험은 openai 대신 새 커넥터 종류를 쓰게 바뀌었다. FakeFetch와 testPlatform은 커넥터와 연결 시험을 위해 넓혔다. 하네스 프로토콜의 요청·상태·취소 성질과 설정에서 어댑터가 만들어지는 성질은 커넥터 시험(connectors.test.ts, a2a.test.ts 등)과 연결 시험으로 옮겨 그대로 확인한다.
decision_hash: 56efaad1ceadb396
---
# ADR-0042 커넥터와 연결 레지스트리

## 맥락
ADR-0026은 연결 방식을 세 가지(내장, OpenAI 호환, 하네스 프로토콜)로 못 박았다. 사용자는 이것이 설계가 아니라 구현이라고 지적했다. 하네스와 에이전트는 많고 계속 바뀐다
(OpenClaw, GoClaw, Hermes, OpenCode, LangChain, LangGraph …). 새 하네스마다 테라리움 코드를 고쳐야 하고, 설정 파일을 손으로 고쳐 서버를 다시 띄워야 연결되는 구조는 맞지 않다.
사용자가 원한 것은 둘이다.
1. **하네스를 테라리움에 연결하면** 그 하네스의 에이전트를 실험에서 고를 수 있다.
2. **하네스 없이 에이전트를 바로 등록**할 수도 있고, 이때도 여러 프로토콜을 쓸 수 있다.
또 테라리움 안에서 내가 직접 만든 에이전트 루프(OpenAI 호환)는 필요 없다고 했다.

## 결정
1. **커넥터가 연결 방식의 단위다.** 커넥터는 프로토콜 하나를 안다. 커넥터는 네 가지를 스스로 설명하고 할 줄 안다.
   - `spec`: 종류(`kind`), 이름과 설명, 범위(`scope`: 하네스는 에이전트가 여럿, 에이전트는 하나), 툴을 건네는 방식, 입력 칸(`fields`)
   - `parse(raw)`: 입력을 검사해 설정으로 바꾼다(틀리면 무엇을 고칠지 말한다)
   - `connect(...)`: 설정으로 `HarnessPort`를 만든다. 에이전트 발견(`agents()`)과 실행(`run()`)은 포트가 이미 하는 일이다
   새 프로토콜은 커넥터 하나를 더하면 된다. 화면의 등록 폼과 연결 확인은 커넥터의 `spec`에서 만들어지므로 웹 코드를 고치지 않는다.
2. **모든 커넥터가 같은 약속을 지킨다.** 테라리움은 에이전트에게 "과제 문장과 이 실행 전용 MCP 주소를 줄 테니 끝나면 알려 달라"고만 한다.
   MCP 주소를 건네는 길만 커넥터마다 다르다. 하네스 프로토콜은 `POST /runs`의 `tools.mcpUrl`, A2A는 메시지의 데이터 부분과 안내 문장, 일반 HTTP는 템플릿 변수,
   MCP 에이전트는 툴 인자, 명령은 환경 변수와 인자다.
3. **커넥터 여섯 가지를 기본으로 둔다.**
   | 종류 | 범위 | 쓰임 |
   |---|---|---|
   | `scripted` | 하네스 | 내장 기준 에이전트. 항상 있다 |
   | `http` | 하네스 | 테라리움 하네스 프로토콜(`terrarium.harness/1`) |
   | `a2a` | 에이전트 | A2A 에이전트(에이전트 카드로 발견). 규격 0.3과 1.0을 모두 받는다 |
   | `http-template` | 에이전트 | 위 어느 것도 아닌 HTTP API. 요청·상태·취소를 템플릿으로 적는다(코드 없이 shim 대신) |
   | `mcp-agent` | 에이전트 | MCP 서버의 툴로 노출된 에이전트(에이전트 게이트웨이 방식) |
   | `command` | 에이전트 | 명령줄 도구나 스크립트. **서버 설정 파일에서만** 쓸 수 있다 |
4. **연결은 레지스트리에 있다.** 연결 = 커넥터 종류 + 이름 + 설정. 두 곳에서 온다.
   - 서버 설정 파일(`harnesses`): 읽기 전용, 서버가 뜰 때 읽는다. `command`는 서버에서 아무 프로그램이나 실행하므로 여기서만 쓸 수 있고 화면·API로는 만들 수 없다.
   - 화면과 API(`/api/connections`): 저장소에 저장되어 서버를 다시 띄워도 남는다. 만든 사람만 지울 수 있다.
   실험 레시피는 지금처럼 `harnessId` + `agentId`를 가리킨다. 에이전트로 직접 등록한 연결은 에이전트가 하나뿐인 하네스일 뿐이라 같은 길을 탄다.
5. **연결 확인은 저장 전에 한다.** `POST /api/connections/check`는 저장하지 않고 연결해 보고, 발견된 에이전트와 걸린 시간 또는 실패 이유를 돌려준다.
6. **비밀 값은 두 길로 준다.** 서버의 환경 변수 이름을 적거나(서버에 그 변수가 없으면 확인 결과가 말해 준다), 화면에서 직접 입력한다. 직접 입력한 값은 서버가 암호화해 보관하고 어떤 응답에도 다시 나오지 않는다. 헤더 이름·값, 보관 기간, 에이전트 버전은 [ADR-0043](0043-connection-secrets-retention-versions.md)이 정한다.
7. **서버가 임의 주소를 부르는 위험(SSRF)을 줄인다.** 설정 `connections.allowedHosts`(호스트 패턴 목록)가 있으면 그 호스트만 연결할 수 있다. 없으면 클라우드 메타데이터 주소(169.254.0.0/16)만 막는다.
8. **OpenAI 호환 내장 루프(`openai`)를 없앤다.** 테라리움 안에서 에이전트를 만드는 것은 테라리움의 일이 아니다. 모델을 직접 비교하고 싶으면 그 모델을 쓰는 하네스를 연결한다.

## 이유
- 사람이 연결을 직접 더하고 확인할 수 있어야 한다. 파일을 고치고 서버를 다시 띄우는 길은 여럿이 쓰는 플랫폼으로는 느리다.
- 프로토콜이 계속 늘어난다. 늘어나는 곳이 커넥터 하나로 한정되면 나머지는 그대로다(열려 있고 닫혀 있는 구조).
- MCP 주소 하나로 "과제와 도구"를 건네는 공통 약속 덕에, 에이전트는 테라리움을 몰라도 된다.
- `command`를 설정 파일에만 둔 이유는 원격 코드 실행을 막기 위해서다.

## 버린 대안
- **프로토콜마다 전용 화면**: 새 프로토콜마다 웹을 고쳐야 한다.
- **연결을 설정 파일에만 두기**: 사용자가 못 더하고, 확인할 길이 없다.
- **A2A 하나로 통일**: 하네스가 모두 A2A를 말하지 않는다.
- **내장 루프 유지**: 테라리움이 에이전트를 만드는 일은 범위 밖이고, 비교 결과가 실제 하네스를 대변하지 못한다.

## 결과
- 한계: A2A 1.0 쪽은 규격 문서에서 메서드 이름과 필드를 확인했고, 0.3 쪽은 알려진 이름을 따랐다. 둘 다 규격대로 만든 가짜 서버로만 검증했고 실제 A2A 에이전트로는 확인하지 못했다.
- 한계: 이 하네스들(OpenClaw, GoClaw, Hermes 등)의 실제 API는 확인하지 못했다. 일반 HTTP 템플릿이나 명령 커넥터로 붙일 수 있는지는 각각 써 보아야 안다.
- 한계: A2A에는 툴을 건네는 표준이 없어 MCP 주소를 메시지에 실어 보낸다. 에이전트가 그것을 읽어 쓰도록 만들어져 있어야 한다.
- ADR-0026은 이 결정으로 대체된다. 내장 루프를 지우면서 그 테스트도 함께 정리한다(`amends_tests`).
- 커넥터 `mcp-agent`는 MCP 클라이언트가 필요해 `server.adapters`가 MCP SDK를 쓴다. 그래서 `harness/config/architecture.yaml`의 `@modelcontextprotocol/sdk` 허용 단위에 `server.adapters`를 더했다(`server.mcp`는 그대로).
